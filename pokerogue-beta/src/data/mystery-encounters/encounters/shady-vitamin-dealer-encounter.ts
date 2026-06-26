import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { getNatureName } from "#data/nature";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { getEncounterText, queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterExp,
} from "#mystery-encounters/encounter-phase-utils";
import {
  applyDamageToPokemon,
  applyModifierTypeToPlayerPokemon,
  isPokemonValidForEncounterOptionSelection,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement, MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/shadyVitaminDealer";

const VITAMIN_DEALER_CHEAP_PRICE_MULTIPLIER = 1.5;
const VITAMIN_DEALER_EXPENSIVE_PRICE_MULTIPLIER = 5;

type VitaminDealerOptionIndex = 1 | 2 | 3;

interface VitaminDealerChoice {
  playerIndex: PlayerIndex;
  optionIndex: VitaminDealerOptionIndex;
  chosenPokemon?: PlayerPokemon;
  modifiers?: PokemonHeldItemModifierType[];
  cost?: number;
}

interface VitaminDealerData {
  choices: VitaminDealerChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class TwoPlayerAnyPlayerMoneyRequirement extends MoneyRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return super.meetsRequirement();
    }

    if (this.scalingMultiplier > 0) {
      this.requiredMoney = globalScene.getWaveMoneyAmount(this.scalingMultiplier);
    }

    return getMysteryEncounterPlayerIndexes().some(playerIndex =>
      globalScene.getPlayerMoney(playerIndex) >= this.requiredMoney,
    );
  }
}

class VitaminDealerPlayerMoneyRequirement extends MoneyRequirement {
  constructor(
    private readonly playerIndex: PlayerIndex,
    private readonly optionIndex: 1 | 2,
  ) {
    super(0);
  }

  override meetsRequirement(): boolean {
    this.requiredMoney = getVitaminDealerPrice(this.optionIndex);
    return globalScene.getPlayerMoney(this.playerIndex) >= this.requiredMoney;
  }

  override getDialogueToken(): [string, string] {
    return ["money", getVitaminDealerPrice(this.optionIndex).toString()];
  }
}

class VitaminDealerPlayerPokemonRequirement extends EncounterSceneRequirement {
  constructor(
    private readonly playerIndex: PlayerIndex,
    private readonly optionIndex: 1 | 2,
  ) {
    super();
  }

  override meetsRequirement(): boolean {
    return getVitaminDealerDealCandidates(this.playerIndex, this.optionIndex).length > 0;
  }

  override getDialogueToken(): [string, string] {
    return ["", ""];
  }
}

function getVitaminDealerData(): VitaminDealerData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies VitaminDealerData;
  }

  return encounter.misc as VitaminDealerData;
}

function getVitaminDealerPrice(optionIndex: 1 | 2): number {
  const multiplier =
    optionIndex === 1 ? VITAMIN_DEALER_CHEAP_PRICE_MULTIPLIER : VITAMIN_DEALER_EXPENSIVE_PRICE_MULTIPLIER;
  return globalScene.getWaveMoneyAmount(multiplier);
}

function createVitaminDealerModifiers(): PokemonHeldItemModifierType[] {
  return [
    generateModifierType(modifierTypes.BASE_STAT_BOOSTER)! as PokemonHeldItemModifierType,
    generateModifierType(modifierTypes.BASE_STAT_BOOSTER)! as PokemonHeldItemModifierType,
  ];
}

function spendVitaminDealerMoney(cost: number, playerIndex: PlayerIndex): void {
  globalScene.setPlayerMoney(Math.max(globalScene.getPlayerMoney(playerIndex) - cost, 0), playerIndex);

  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
  }

  audioManager.playSound("se/buy");
  globalScene.phaseManager.queueMessage(i18next.t("mysteryEncounterMessages:paidMoney", { amount: cost }), null, true);
}

function meetsCheapDealPokemonRequirement(pokemon: Pokemon): boolean {
  return pokemon.getHpRatio() >= 0.51 && pokemon.getHpRatio() <= 1;
}

function getCheapDealSelectableFilter(): (pokemon: Pokemon) => string | null {
  return (pokemon: Pokemon) => {
    if (!pokemon.isAllowedInChallenge()) {
      return (
        i18next.t("partyUiHandler:cantBeUsed", {
          pokemonName: pokemon.getNameToRender(),
        }) ?? null
      );
    }
    if (!meetsCheapDealPokemonRequirement(pokemon)) {
      return getEncounterText(`${namespace}:invalidSelection`) ?? null;
    }

    return null;
  };
}

function getPriceyDealSelectableFilter(): (pokemon: Pokemon) => string | null {
  return (pokemon: Pokemon) => {
    return isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
  };
}

function getVitaminDealerDealCandidates(playerIndex: PlayerIndex, optionIndex: 1 | 2): PlayerPokemon[] {
  const selectableFilter = optionIndex === 1 ? getCheapDealSelectableFilter() : getPriceyDealSelectableFilter();
  return globalScene.getPlayerParty(playerIndex).filter(pokemon => !selectableFilter(pokemon));
}

function getComputerPartnerVitaminDealerAce(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  const party = globalScene.getPlayerParty(playerIndex);
  return party.find(pokemon => pokemon.computerPartnerAce) ?? party[0];
}

function chooseComputerPartnerVitaminDealerOption(playerIndex: PlayerIndex): VitaminDealerOptionIndex {
  const money = globalScene.getPlayerMoney(playerIndex);
  if (money >= getVitaminDealerPrice(2) && getVitaminDealerDealCandidates(playerIndex, 2).length > 0) {
    return 2;
  }
  if (money >= getVitaminDealerPrice(1) && getVitaminDealerDealCandidates(playerIndex, 1).length > 0) {
    return 1;
  }
  return 3;
}

function chooseComputerPartnerVitaminDealerChoice(playerIndex: PlayerIndex): VitaminDealerChoice {
  const optionIndex = chooseComputerPartnerVitaminDealerOption(playerIndex);
  if (optionIndex === 3) {
    return { playerIndex, optionIndex };
  }

  const candidates = getVitaminDealerDealCandidates(playerIndex, optionIndex);
  const chosenPokemon =
    optionIndex === 2
      ? candidates.find(pokemon => pokemon === getComputerPartnerVitaminDealerAce(playerIndex)) ?? candidates[0]
      : candidates[randSeedInt(candidates.length)];

  return chosenPokemon
    ? {
        playerIndex,
        optionIndex,
        chosenPokemon,
        modifiers: createVitaminDealerModifiers(),
        cost: getVitaminDealerPrice(optionIndex),
      }
    : { playerIndex, optionIndex: 3 };
}

function queueComputerPartnerVitaminDealerChoiceMessage(choice: VitaminDealerChoice): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(choice.playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${choice.optionIndex}.label`);
  const pokemonText = choice.chosenPokemon ? ` for ${choice.chosenPokemon.getNameToRender()}` : "";
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}${pokemonText}.`, null, true);
}

async function promptNextVitaminDealerPlayer(
  playerIndex: PlayerIndex,
  startingCursorIndex: number,
): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildVitaminDealerPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerVitaminDealerOption,
      onOptionChosen: (_optionIndex, choicePlayerIndex) =>
        collectComputerPartnerVitaminDealerChoice(choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function storeVitaminDealerChoice(choice: VitaminDealerChoice): Promise<boolean> {
  const data = getVitaminDealerData();
  data.choices = data.choices.filter(existingChoice => existingChoice.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (globalScene.isComputerPartnerPlayer(choice.playerIndex)) {
    queueComputerPartnerVitaminDealerChoiceMessage(choice);
  }

  if (globalScene.twoPlayerMode) {
    const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(choice.playerIndex);
    if (nextPlayerIndex != null) {
      return promptNextVitaminDealerPlayer(nextPlayerIndex, choice.optionIndex - 1);
    }
  }

  if (globalScene.twoPlayerMode) {
    data.skipSelectedDialogueOnce = true;
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }
  return true;
}

async function collectVitaminDealerDealChoice(optionIndex: 1 | 2, playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  let choice: VitaminDealerChoice | undefined;
  const selected = await selectPokemonForOption(
    pokemon => {
      const modifiers = createVitaminDealerModifiers();
      choice = {
        playerIndex,
        optionIndex,
        chosenPokemon: pokemon,
        modifiers,
        cost: getVitaminDealerPrice(optionIndex),
      };
    },
    undefined,
    optionIndex === 1 ? getCheapDealSelectableFilter() : getPriceyDealSelectableFilter(),
  );

  if (!selected || !choice) {
    return false;
  }

  return storeVitaminDealerChoice(choice);
}

function collectComputerPartnerVitaminDealerChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  return storeVitaminDealerChoice(chooseComputerPartnerVitaminDealerChoice(playerIndex));
}

function collectVitaminDealerLeaveChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  return storeVitaminDealerChoice({
    playerIndex,
    optionIndex: 3,
  });
}

async function runVitaminDealerChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getVitaminDealerData();
  const choices = data.choices.filter(choice => choice.optionIndex !== 3);

  if (choices.length === 0) {
    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.3.selected`);
    }
    leaveEncounterWithoutBattle(true);
    return true;
  }

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);

    const chosenPokemon = choice.chosenPokemon!;
    const modifiers = choice.modifiers!;
    spendVitaminDealerMoney(choice.cost ?? 0, choice.playerIndex);
    encounter.setDialogueToken("selectedPokemon", chosenPokemon.getNameToRender());
    encounter.setDialogueToken("boost1", modifiers[0].name);
    encounter.setDialogueToken("boost2", modifiers[1].name);

    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.selected`);
    }

    for (const modType of modifiers) {
      await applyModifierTypeToPlayerPokemon(chosenPokemon, modType);
    }

    if (choice.optionIndex === 1) {
      applyDamageToPokemon(chosenPokemon, Math.floor(chosenPokemon.getMaxHp() / 2));

      const currentNature = chosenPokemon.nature;
      let newNature = randSeedInt(25) as Nature;
      while (newNature === currentNature) {
        newNature = randSeedInt(25) as Nature;
      }

      chosenPokemon.setCustomNature(newNature);
      encounter.setDialogueToken("newNature", getNatureName(newNature));
      queueEncounterMessage(`${namespace}:cheapSideEffects`);
    } else {
      queueEncounterMessage(`${namespace}:noBadEffects`);
    }

    setEncounterExp([chosenPokemon.id], 100, true, choice.playerIndex);
    await chosenPokemon.updateInfo();
  }

  if (globalScene.twoPlayerMode) {
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }

  leaveEncounterWithoutBattle(true);
  return true;
}

function buildCheapVitaminDealerOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new VitaminDealerPlayerMoneyRequirement(playerIndex, 1))
    .withSceneRequirement(new VitaminDealerPlayerPokemonRequirement(playerIndex, 1))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.selected`,
        },
      ],
    })
    .withPreOptionPhase(async (): Promise<boolean> => collectVitaminDealerDealChoice(1, playerIndex))
    .withOptionPhase(async () => runVitaminDealerChoices())
    .build();
}

function buildPriceyVitaminDealerOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new VitaminDealerPlayerMoneyRequirement(playerIndex, 2))
    .withSceneRequirement(new VitaminDealerPlayerPokemonRequirement(playerIndex, 2))
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.selected`,
        },
      ],
    })
    .withPreOptionPhase(async (): Promise<boolean> => collectVitaminDealerDealChoice(2, playerIndex))
    .withOptionPhase(async () => runVitaminDealerChoices())
    .build();
}

function buildLeaveVitaminDealerOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
          speaker: `${namespace}:speaker`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectVitaminDealerLeaveChoice(playerIndex))
    .withOptionPhase(async () => runVitaminDealerChoices())
    .build();
}

function buildVitaminDealerPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildCheapVitaminDealerOption(playerIndex),
    buildPriceyVitaminDealerOption(playerIndex),
    buildLeaveVitaminDealerOption(playerIndex),
  ];
}

/**
 * Shady Vitamin Dealer encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3798 | GitHub Issue #3798}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const ShadyVitaminDealerEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.SHADY_VITAMIN_DEALER,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new TwoPlayerAnyPlayerMoneyRequirement(0, VITAMIN_DEALER_CHEAP_PRICE_MULTIPLIER)) // Must have the money for at least the cheap deal
  .withPrimaryPokemonHealthRatioRequirement([0.51, 1]) // At least 1 Pokemon must have above half HP
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.KROKOROK,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: false,
      scale: 1.1,
      x: 24,
      y: 0,
      yShadow: 0,
    },
    {
      spriteKey: "shady_vitamin_dealer",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      x: -12,
      y: 3,
      yShadow: 3,
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
  .withOption(buildCheapVitaminDealerOption(0))
  .withOption(buildPriceyVitaminDealerOption(0))
  .withOption(buildLeaveVitaminDealerOption(0))
  .build();
