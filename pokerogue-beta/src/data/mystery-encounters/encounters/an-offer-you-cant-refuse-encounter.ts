import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities, modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  setEncounterExp,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { EXTORTION_ABILITIES, EXTORTION_MOVES } from "#mystery-encounters/requirement-groups";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/anOfferYouCantRefuse";

/**
 * Money offered starts at base value of Relic Gold, increasing linearly up to 3x Relic Gold based on the starter tier of the Pokemon being purchased
 * Starter value 1-3 -> Relic Gold
 * Starter value 10 -> 3 * Relic Gold
 */
const MONEY_MINIMUM_MULTIPLIER = 10;
const MONEY_MAXIMUM_MULTIPLIER = 30;

type OfferChoiceIndex = 1 | 2 | 3;

interface OfferChoice {
  playerIndex: PlayerIndex;
  optionIndex: OfferChoiceIndex;
  pokemon?: PlayerPokemon;
  price?: number;
  moveOrAbility?: string;
}

interface OfferPlayerData {
  strongestPokemon?: PlayerPokemon;
  price: number;
  extortionPokemon?: PlayerPokemon;
  moveOrAbility?: string;
}

interface OfferData {
  players: Partial<Record<PlayerIndex, OfferPlayerData>>;
  choices: OfferChoice[];
  skipSelectedDialogueOnce?: boolean;
}

const MIN_VALID_POKEMON_FOR_OFFER = 2;

function getValidOfferPokemonCount(playerIndex: PlayerIndex): number {
  return globalScene.getPlayerParty(playerIndex).filter(pokemon => pokemon.isAllowedInChallenge()).length;
}

class OfferSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return getValidOfferPokemonCount(0) >= MIN_VALID_POKEMON_FOR_OFFER;
    }

    return getMysteryEncounterPlayerIndexes().some(
      playerIndex => getValidOfferPokemonCount(playerIndex) >= MIN_VALID_POKEMON_FOR_OFFER,
    );
  }

  override getDialogueToken(): [string, string] {
    return ["minPartySize", MIN_VALID_POKEMON_FOR_OFFER.toString()];
  }
}

class PlayerOfferSellRequirement extends EncounterSceneRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super();
  }

  override meetsRequirement(): boolean {
    return getValidOfferPokemonCount(this.playerIndex) >= MIN_VALID_POKEMON_FOR_OFFER;
  }

  override getDialogueToken(): [string, string] {
    return ["minPartySize", MIN_VALID_POKEMON_FOR_OFFER.toString()];
  }
}

class PlayerExtortionRequirement extends EncounterSceneRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super();
  }

  override meetsRequirement(): boolean {
    return getExtortionOption(globalScene.getPlayerParty(this.playerIndex)).pokemon != null;
  }

  override getDialogueToken(): [string, string] {
    return ["moveOrAbility", getExtortionOption(globalScene.getPlayerParty(this.playerIndex)).moveOrAbility ?? ""];
  }
}

function getOfferData(): OfferData {
  return globalScene.currentBattle.mysteryEncounter!.misc as OfferData;
}

function getOfferPlayerData(playerIndex: PlayerIndex): OfferPlayerData {
  return getOfferData().players[playerIndex] ?? createOfferPlayerData(playerIndex);
}

function getHighestStatTotalPlayerPokemon(
  playerIndex: PlayerIndex,
  isAllowed = false,
  isFainted = false,
): PlayerPokemon | undefined {
  const party = globalScene.getPlayerParty(playerIndex);
  let pokemon: PlayerPokemon | null = null;

  for (const p of party) {
    if (isAllowed && !p.isAllowedInChallenge()) {
      continue;
    }
    if (!isFainted && p.isFainted()) {
      continue;
    }

    pokemon = pokemon ? (pokemon.stats.reduce((a, b) => a + b) < p.stats.reduce((a, b) => a + b) ? p : pokemon) : p;
  }

  return pokemon ?? undefined;
}

function getOfferPrice(pokemon: PlayerPokemon): number {
  const baseSpecies = pokemon.getSpeciesForm().getRootSpeciesId();
  const starterValue: number = speciesDataRegistry.getStarterCost(baseSpecies) ?? 1;
  const multiplier = Math.max((MONEY_MAXIMUM_MULTIPLIER / 10) * starterValue, MONEY_MINIMUM_MULTIPLIER);
  return globalScene.getWaveMoneyAmount(multiplier);
}

function getExtortionOption(party: PlayerPokemon[]): { pokemon?: PlayerPokemon; moveOrAbility?: string } {
  for (const pokemon of party) {
    if (!pokemon.isAllowedInBattle()) {
      continue;
    }

    const matchingMove = pokemon.moveset.find(move => move.moveId && EXTORTION_MOVES.includes(move.moveId));
    if (matchingMove) {
      return { pokemon, moveOrAbility: matchingMove.getName() };
    }

    const matchingAbility = EXTORTION_ABILITIES.find(ability => pokemon.hasAbility(ability, false));
    if (matchingAbility != null) {
      return { pokemon, moveOrAbility: allAbilities[matchingAbility].name };
    }
  }

  return {};
}

function createOfferPlayerData(playerIndex: PlayerIndex): OfferPlayerData {
  const strongestPokemon = getHighestStatTotalPlayerPokemon(playerIndex, true, true);
  const extortion = getExtortionOption(globalScene.getPlayerParty(playerIndex));
  const playerData: OfferPlayerData = {
    price: strongestPokemon ? getOfferPrice(strongestPokemon) : 0,
  };
  if (strongestPokemon) {
    playerData.strongestPokemon = strongestPokemon;
  }
  if (extortion.pokemon) {
    playerData.extortionPokemon = extortion.pokemon;
  }
  if (extortion.moveOrAbility) {
    playerData.moveOrAbility = extortion.moveOrAbility;
  }
  return playerData;
}

function setOfferTokens(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerData = getOfferPlayerData(playerIndex);
  encounter.setDialogueToken("strongestPokemon", playerData.strongestPokemon?.getNameToRender() ?? "your Pokemon");
  encounter.setDialogueToken("price", playerData.price.toString());
  encounter.setDialogueToken("option2PrimaryName", playerData.extortionPokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("moveOrAbility", playerData.moveOrAbility ?? "");
}

function getOfferIntroPlayerIndex(): PlayerIndex {
  if (!globalScene.twoPlayerMode) {
    return 0;
  }

  return getMysteryEncounterPlayerIndexes().find(
    playerIndex => getValidOfferPokemonCount(playerIndex) >= MIN_VALID_POKEMON_FOR_OFFER,
  ) ?? 0;
}

function chooseComputerPartnerOfferOption(playerIndex: PlayerIndex): OfferChoiceIndex {
  return getOfferPlayerData(playerIndex).extortionPokemon ? 2 : 3;
}

function queueComputerPartnerOfferChoiceMessage(playerIndex: PlayerIndex, optionIndex: OfferChoiceIndex): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const playerData = getOfferPlayerData(playerIndex);
  const message =
    optionIndex === 2
      ? `${profile.name}'s ${playerData.extortionPokemon?.getNameToRender()} used ${playerData.moveOrAbility} to rob the rich kid.`
      : `${profile.name} refused the offer.`;
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(message, null, true);
}

async function promptNextOfferPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  setOfferTokens(playerIndex);
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildOfferOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerOfferOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        collectOfferChoice(choicePlayerIndex, optionIndex as OfferChoiceIndex),
    },
  });
  return result ?? false;
}

function storeOfferChoice(choice: OfferChoice): boolean | Promise<boolean> {
  const data = getOfferData();
  data.choices = data.choices.filter(existingChoice => existingChoice.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (globalScene.isComputerPartnerPlayer(choice.playerIndex)) {
    queueComputerPartnerOfferChoiceMessage(choice.playerIndex, choice.optionIndex);
  }

  const nextPlayerIndex = globalScene.twoPlayerMode ? getNextMysteryEncounterPlayerIndex(choice.playerIndex) : undefined;
  if (nextPlayerIndex != null) {
    return promptNextOfferPlayer(nextPlayerIndex, choice.optionIndex - 1);
  }

  if (globalScene.twoPlayerMode) {
    data.skipSelectedDialogueOnce = true;
    globalScene.waitForPlayerInput(0);
  }
  return true;
}

function collectOfferChoice(playerIndex: PlayerIndex, optionIndex: OfferChoiceIndex): boolean | Promise<boolean> {
  globalScene.waitForPlayerInput(playerIndex);
  setOfferTokens(playerIndex);

  const playerData = getOfferPlayerData(playerIndex);
  const choice: OfferChoice = { playerIndex, optionIndex };
  if (optionIndex === 1) {
    if (!playerData.strongestPokemon) {
      choice.optionIndex = 3;
      return storeOfferChoice(choice);
    }
    choice.pokemon = playerData.strongestPokemon;
    choice.price = playerData.price;
  } else if (optionIndex === 2) {
    if (playerData.extortionPokemon) {
      choice.pokemon = playerData.extortionPokemon;
    }
    choice.price = playerData.price;
    if (playerData.moveOrAbility) {
      choice.moveOrAbility = playerData.moveOrAbility;
    }
  }

  return storeOfferChoice(choice);
}

function addOfferMoney(amount: number, playerIndex: PlayerIndex): void {
  globalScene.addMoneyForPlayer(amount, playerIndex);
  globalScene.phaseManager.queueMessage(
    i18next.t("mysteryEncounterMessages:receiveMoney", { amount }),
    null,
    true,
  );
}

async function resolveOfferChoice(choice: OfferChoice): Promise<void> {
  globalScene.waitForPlayerInput(choice.playerIndex);
  setOfferTokens(choice.playerIndex);

  if (globalScene.twoPlayerMode) {
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
  }

  if (choice.optionIndex === 1) {
    const offeredPokemon = choice.pokemon ?? getOfferPlayerData(choice.playerIndex).strongestPokemon;
    if (!offeredPokemon) {
      return;
    }
    addOfferMoney(choice.price ?? getOfferPlayerData(choice.playerIndex).price, choice.playerIndex);
    globalScene.removePokemonFromPlayerParty(offeredPokemon);
    globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.SHINY_CHARM, choice.playerIndex);
    return;
  }

  if (choice.optionIndex === 2) {
    const helperPokemon = choice.pokemon ?? getOfferPlayerData(choice.playerIndex).extortionPokemon;
    addOfferMoney(choice.price ?? getOfferPlayerData(choice.playerIndex).price, choice.playerIndex);
    if (helperPokemon) {
      setEncounterExp(helperPokemon.id, getPokemonSpecies(SpeciesId.LIEPARD).baseExp, true, choice.playerIndex);
    }
  }
}

async function runOfferChoices(): Promise<boolean> {
  const choices = getOfferData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);

  for (const choice of choices) {
    await resolveOfferChoice(choice);
  }

  if (globalScene.twoPlayerMode) {
    globalScene.waitForPlayerInput(0);
  }
  leaveEncounterWithoutBattle(true);
  return true;
}

/**
 * An Offer You Can't Refuse encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3808 | GitHub Issue #3808}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const AnOfferYouCantRefuseEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.AN_OFFER_YOU_CANT_REFUSE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new OfferSpawnRequirement()) // At least one player must have 2+ valid Pokemon
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.LIEPARD,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      x: 0,
      y: -4,
      yShadow: -4,
    },
    {
      spriteKey: "rich_kid_m",
      fileRoot: "trainer",
      hasShadow: true,
      x: 2,
      y: 5,
      yShadow: 5,
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
    const players = Object.fromEntries(
      getMysteryEncounterPlayerIndexes().map(playerIndex => [playerIndex, createOfferPlayerData(playerIndex)]),
    ) as Partial<Record<PlayerIndex, OfferPlayerData>>;
    encounter.misc = {
      players,
      choices: [],
    } satisfies OfferData;

    const shinyCharm = generateModifierType(modifierTypes.SHINY_CHARM);
    encounter.setDialogueToken("itemName", shinyCharm?.name ?? i18next.t("modifierType:ModifierType.SHINY_CHARM.name"));
    encounter.setDialogueToken("liepardName", getPokemonSpecies(SpeciesId.LIEPARD).getName());
    setOfferTokens(getOfferIntroPlayerIndex());

    return true;
  })
  .withOption(buildAcceptOfferOption(0))
  .withOption(buildExtortKidOption(0))
  .withOption(buildLeaveOfferOption(0))
  .build();

function buildAcceptOfferOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new PlayerOfferSellRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      disabledButtonLabel: `${namespace}:option.1.labelDisabled`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      disabledButtonTooltip: `${namespace}:option.1.tooltipDisabled`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
          speaker: `${namespace}:speaker`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectOfferChoice(playerIndex, 1))
    .withOptionPhase(async () => runOfferChoices())
    .build();
}

function buildExtortKidOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withSceneRequirement(new PlayerExtortionRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      disabledButtonTooltip: `${namespace}:option.2.tooltipDisabled`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectOfferChoice(playerIndex, 2))
    .withOptionPhase(async () => runOfferChoices())
    .build();
}

function buildLeaveOfferOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectOfferChoice(playerIndex, 3))
    .withOptionPhase(async () => runOfferChoices())
    .build();
}

function buildOfferOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildAcceptOfferOption(playerIndex),
    buildExtortKidOption(playerIndex),
    buildLeaveOfferOption(playerIndex),
  ];
}
