import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { NON_LEGEND_PARADOX_POKEMON, NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { PlayerPokemon } from "#field/pokemon";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  catchPokemon,
  getRandomSpeciesByStarterCost,
  getSpriteKeysFromPokemon,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonData } from "#system/pokemon-data";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/thePokemonSalesman";

const MAX_POKEMON_PRICE_MULTIPLIER = 4;

/** Odds of shiny magikarp will be 1/value */
const SHINY_MAGIKARP_WEIGHT = 100;

/** Odds of event sale will be value/100 */
const EVENT_THRESHOLD = 50;

type PokemonSalesmanOptionIndex = 1 | 2;

interface PokemonSalesmanChoice {
  playerIndex: PlayerIndex;
  optionIndex: PokemonSalesmanOptionIndex;
}

interface PokemonSalesmanOffer {
  price: number;
  pokemon: PlayerPokemon;
  shinyDescription: boolean;
}

interface PokemonSalesmanData {
  price: number;
  pokemon: PlayerPokemon;
  offers?: PokemonSalesmanOffer[];
  choices?: PokemonSalesmanChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class TwoPlayerAnyPlayerSalesmanMoneyRequirement extends MoneyRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return super.meetsRequirement();
    }

    if (this.scalingMultiplier > 0) {
      this.requiredMoney = globalScene.getWaveMoneyAmount(this.scalingMultiplier);
    }

    return ([0, 1] as PlayerIndex[]).some(playerIndex => globalScene.getPlayerMoney(playerIndex) >= this.requiredMoney);
  }
}

class PokemonSalesmanPlayerMoneyRequirement extends MoneyRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super(0);
  }

  override meetsRequirement(): boolean {
    this.requiredMoney = getPokemonSalesmanPlayerPrice(this.playerIndex);
    return globalScene.getPlayerMoney(this.playerIndex) >= this.requiredMoney;
  }

  override getDialogueToken(): [string, string] {
    return ["money", getPokemonSalesmanPlayerPrice(this.playerIndex).toString()];
  }
}

function getPokemonSalesmanData(): PokemonSalesmanData {
  return globalScene.currentBattle.mysteryEncounter!.misc as PokemonSalesmanData;
}

function getPokemonSalesmanOffer(playerIndex: PlayerIndex): PokemonSalesmanOffer {
  const data = getPokemonSalesmanData();
  return data.offers?.[playerIndex] ?? { price: data.price, pokemon: data.pokemon, shinyDescription: data.pokemon.shiny };
}

function getPokemonSalesmanPrice(): number {
  const data = globalScene.currentBattle?.mysteryEncounter?.misc as Partial<PokemonSalesmanData> | undefined;
  return typeof data?.price === "number" ? data.price : globalScene.getWaveMoneyAmount(MAX_POKEMON_PRICE_MULTIPLIER);
}

function getPokemonSalesmanPlayerPrice(playerIndex: PlayerIndex): number {
  const data = globalScene.currentBattle?.mysteryEncounter?.misc as Partial<PokemonSalesmanData> | undefined;
  return data?.offers?.[playerIndex]?.price ?? getPokemonSalesmanPrice();
}

function setPokemonSalesmanOfferTokens(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const offer = getPokemonSalesmanOffer(playerIndex);

  encounter.setDialogueToken("purchasePokemon", offer.pokemon.getNameToRender());
  encounter.setDialogueToken("price", offer.price.toString());
  encounter.dialogue.encounterOptionsDialogue!.description = offer.shinyDescription
    ? `${namespace}:descriptionShiny`
    : `${namespace}:description`;
}

function spendPokemonSalesmanMoney(price: number, playerIndex: PlayerIndex): void {
  globalScene.setPlayerMoney(Math.max(globalScene.getPlayerMoney(playerIndex) - price, 0), playerIndex);
  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
  }

  audioManager.playSound("se/buy");
  globalScene.phaseManager.queueMessage(i18next.t("mysteryEncounterMessages:paidMoney", { amount: price }), null, true);
}

function showPokemonSalesmanPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setPokemonSalesmanOfferTokens(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: [buildPokemonSalesmanAcceptOption(playerIndex), buildPokemonSalesmanRefuseOption(playerIndex)],
      startingCursorIndex,
    });
  });
}

async function storePokemonSalesmanChoice(
  optionIndex: PokemonSalesmanOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getPokemonSalesmanData();
  data.choices = (data.choices ?? []).filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (playerIndex === 0) {
    showPokemonSalesmanPlayerMenu(1, optionIndex - 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function buySalesmanPokemonForPlayer(playerIndex: PlayerIndex, showPurchaseMessage = true): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const offer = getPokemonSalesmanOffer(playerIndex);
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setPokemonSalesmanOfferTokens(playerIndex);

  spendPokemonSalesmanMoney(offer.price, playerIndex);
  if (showPurchaseMessage) {
    await showEncounterText(`${namespace}:option.1.selectedMessage`);
  }
  await showEncounterDialogue(`${namespace}:option.1.selectedDialogue`, `${namespace}:speaker`);
  await transitionMysteryEncounterIntroVisuals();

  const pokemonData = new PokemonData(offer.pokemon);
  pokemonData.player = false;
  await catchPokemon(pokemonData.toPokemon() as EnemyPokemon, null, PokeballType.POKEBALL, true, true, playerIndex);
}

async function runTwoPlayerPokemonSalesmanChoices(): Promise<boolean> {
  const data = getPokemonSalesmanData();
  const choices = (data.choices ?? []).toSorted((a, b) => a.playerIndex - b.playerIndex);
  const buyers = choices.filter(choice => choice.optionIndex === 1);

  if (buyers.length === 0) {
    await showEncounterText(`${namespace}:option.2.selected`);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  for (const choice of choices) {
    if (choice.optionIndex === 2) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      await showEncounterText(`${namespace}:option.2.selected`);
      continue;
    }

    await buySalesmanPokemonForPlayer(choice.playerIndex);
  }

  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  leaveEncounterWithoutBattle(true);
  return true;
}

function buildPokemonSalesmanAcceptOption(playerIndex: PlayerIndex) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withHasDexProgress(true)
    .withSceneRequirement(new PokemonSalesmanPlayerMoneyRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: getPokemonSalesmanTooltip(playerIndex),
      selected: [
        {
          text: `${namespace}:option.1.selectedMessage`,
        },
      ],
    })
    .withPreOptionPhase(async () => storePokemonSalesmanChoice(1, playerIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerPokemonSalesmanChoices();
      }

      await buySalesmanPokemonForPlayer(0, false);
      leaveEncounterWithoutBattle(true);
      return true;
    })
    .build();
}

function getPokemonSalesmanTooltip(playerIndex: PlayerIndex): string {
  try {
    return getPokemonSalesmanOffer(playerIndex).shinyDescription
      ? `${namespace}:option.1.tooltipShiny`
      : `${namespace}:option.1.tooltip`;
  } catch (_err) {
    return `${namespace}:option.1.tooltip`;
  }
}

function buildPokemonSalesmanRefuseOption(playerIndex: PlayerIndex) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storePokemonSalesmanChoice(2, playerIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerPokemonSalesmanChoices();
      }

      leaveEncounterWithoutBattle(true);
      return true;
    })
    .build();
}

function generatePokemonSalesmanOffer(): PokemonSalesmanOffer {
  let isEventEncounter = false;

  let species = getSalesmanSpeciesOffer();
  let tries = 0;

  // Reroll any species that don't have HAs
  while ((species.abilityHidden == null || species.abilityHidden === AbilityId.NONE) && tries < 5) {
    species = getSalesmanSpeciesOffer();
    tries++;
  }

  const r = randSeedInt(SHINY_MAGIKARP_WEIGHT);

  const validEventEncounters = timedEventManager.getAllValidEventEncounters(
    false,
    false,
    false,
    s =>
      !NON_LEGEND_PARADOX_POKEMON.includes(s.speciesId)
      && !NON_LEGEND_ULTRA_BEASTS.includes(s.speciesId)
      && speciesDataRegistry.isStarter(s.speciesId), // The event expects the chosen pokemon to be a valid starter, and will break if a non-starter is chosen
  );

  let pokemon: PlayerPokemon;
  /*
   * Mon is determined as follows:
   * - If you roll the 1% for Shiny Magikarp, you get Magikarp with a random variant
   * - If an event with more than 1 valid event encounter species is active, you have 20% chance to get one of those
   * - If the rolled species has no HA, and there are valid event encounters, you will get one of those
   * - If the rolled species has no HA and there are no valid event encounters, you will get Shiny Magikarp
   *
   * Mons rolled from the event encounter pool get 3 extra shiny rolls
   */
  if (
    r === 0
    || ((species.abilityHidden == null || species.abilityHidden === AbilityId.NONE) && validEventEncounters.length === 0)
  ) {
    // If you roll 1%, give shiny Magikarp with random variant
    species = getPokemonSpecies(SpeciesId.MAGIKARP);
    pokemon = new PlayerPokemon(species, 5, 2, undefined, undefined, true);
  } else if (
    validEventEncounters.length > 0
    && (r <= EVENT_THRESHOLD || species.abilityHidden == null || species.abilityHidden === AbilityId.NONE)
  ) {
    tries = 0;
    do {
      // If you roll 50%, give event encounter with 3 extra shiny rolls and its HA, if it has one
      const enc = randSeedItem(validEventEncounters);
      species = getPokemonSpecies(enc.species);
      pokemon = new PlayerPokemon(
        species,
        5,
        species.abilityHidden === AbilityId.NONE ? undefined : 2,
        enc.formIndex,
      );
      pokemon.trySetShinySeed();
      pokemon.trySetShinySeed();
      pokemon.trySetShinySeed();
      if (pokemon.shiny || pokemon.abilityIndex === 2) {
        isEventEncounter = true;
        break;
      }
      tries++;
    } while (tries < 6);
    if (!pokemon.shiny && pokemon.abilityIndex !== 2) {
      // If, after 6 tries, you STILL somehow don't have an HA or shiny mon, pick from only the event mons that have an HA.
      if (validEventEncounters.some(s => !!getPokemonSpecies(s.species).abilityHidden)) {
        validEventEncounters.filter(s => !!getPokemonSpecies(s.species).abilityHidden);
        const enc = randSeedItem(validEventEncounters);
        species = getPokemonSpecies(enc.species);
        pokemon = new PlayerPokemon(species, 5, 2, enc.formIndex);
        pokemon.trySetShinySeed();
        pokemon.trySetShinySeed();
        pokemon.trySetShinySeed();
        isEventEncounter = true;
      } else {
        // If there's, and this would never happen, no eligible event encounters with a hidden ability, just do Magikarp
        species = getPokemonSpecies(SpeciesId.MAGIKARP);
        pokemon = new PlayerPokemon(species, 5, 2, undefined, undefined, true);
      }
    }
  } else {
    pokemon = new PlayerPokemon(species, 5, 2, species.formIndex);
  }

  pokemon.generateAndPopulateMoveset();

  const starterTier = speciesDataRegistry.getStarterCost(species.speciesId);
  // Prices decrease by starter tier less than 5, but only reduces cost by half at max
  let priceMultiplier = MAX_POKEMON_PRICE_MULTIPLIER * (Math.max(starterTier, 2.5) / 5);
  if (pokemon.shiny) {
    // Always max price for shiny (flip HA back to normal), and add special messaging
    priceMultiplier = MAX_POKEMON_PRICE_MULTIPLIER;
    if (!isEventEncounter) {
      pokemon.abilityIndex = 0;
    }
  }

  pokemon.calculateStats();

  return {
    price: globalScene.getWaveMoneyAmount(priceMultiplier),
    pokemon,
    shinyDescription: pokemon.shiny,
  };
}

/**
 * Pokemon Salesman encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3799 | GitHub Issue #3799}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const ThePokemonSalesmanEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.THE_POKEMON_SALESMAN,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new TwoPlayerAnyPlayerSalesmanMoneyRequirement(0, MAX_POKEMON_PRICE_MULTIPLIER))
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "pokemon_salesman",
      fileRoot: "mystery-encounters",
      hasShadow: true,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      text: `${namespace}:introDialogue`,
      speaker: `${namespace}:speaker`,
    },
  ])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const offers = Array.from({ length: globalScene.twoPlayerMode ? 2 : 1 }, () => generatePokemonSalesmanOffer());

    for (const [index, offer] of offers.entries()) {
      const { spriteKey, fileRoot } = getSpriteKeysFromPokemon(offer.pokemon);
      encounter.spriteConfigs.push({
        spriteKey,
        fileRoot,
        hasShadow: true,
        repeat: true,
        isPokemon: true,
        isShiny: offer.pokemon.shiny,
        variant: offer.pokemon.variant,
        ...(globalScene.twoPlayerMode ? { x: -22 + index * 44 } : {}),
      });
    }

    encounter.misc = {
      price: offers[0].price,
      pokemon: offers[0].pokemon,
      offers,
      choices: [],
    };

    setPokemonSalesmanOfferTokens(0);
    encounter.options[0].dialogue!.buttonTooltip = getPokemonSalesmanTooltip(0);

    return true;
  })
  .withOption(buildPokemonSalesmanAcceptOption(0))
  .withOption(buildPokemonSalesmanRefuseOption(0))
  .build();

/**
 * @returns A random species that has at most 5 starter cost and is not Mythical, Paradox, etc.
 */
export function getSalesmanSpeciesOffer(): PokemonSpecies {
  return getPokemonSpecies(
    getRandomSpeciesByStarterCost([0, 5], NON_LEGEND_PARADOX_POKEMON, undefined, false, false, false),
  );
}
