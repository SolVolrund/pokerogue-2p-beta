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
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { getEncounterText, queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
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
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
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
  selectingPlayerIndex?: PlayerIndex;
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

    return ([0, 1] as PlayerIndex[]).some(playerIndex => globalScene.getPlayerMoney(playerIndex) >= this.requiredMoney);
  }
}

function getVitaminDealerData(): VitaminDealerData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      selectingPlayerIndex: 0,
    } satisfies VitaminDealerData;
  }

  return encounter.misc as VitaminDealerData;
}

function getVitaminDealerPrice(optionIndex: 1 | 2): number {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  return (encounter.options[optionIndex - 1].requirements[0] as MoneyRequirement).requiredMoney;
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

function getCheapDealSelectableFilter(encounter: MysteryEncounter): (pokemon: Pokemon) => string | null {
  return (pokemon: Pokemon) => {
    if (!pokemon.isAllowedInChallenge()) {
      return (
        i18next.t("partyUiHandler:cantBeUsed", {
          pokemonName: pokemon.getNameToRender(),
        }) ?? null
      );
    }
    if (!encounter.pokemonMeetsPrimaryRequirements(pokemon)) {
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

function storeVitaminDealerChoice(choice: VitaminDealerChoice): boolean {
  const data = getVitaminDealerData();
  const playerIndex = globalScene.twoPlayerMode ? (data.selectingPlayerIndex ?? 0) : globalScene.activePlayerIndex;
  data.choices = data.choices.filter(existingChoice => existingChoice.playerIndex !== playerIndex);
  data.choices.push({ ...choice, playerIndex });

  if (globalScene.twoPlayerMode && playerIndex === 0) {
    data.selectingPlayerIndex = 1;
    globalScene.setActivePlayerIndex(1);
    updateWindowType(2);
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: "Player 2",
      overrideQuery: i18next.t(`${namespace}:query`),
      startingCursorIndex: choice.optionIndex - 1,
    });
    return false;
  }

  delete data.selectingPlayerIndex;
  if (globalScene.twoPlayerMode) {
    data.skipSelectedDialogueOnce = true;
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }
  return true;
}

async function collectVitaminDealerDealChoice(optionIndex: 1 | 2): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getVitaminDealerData();
  const playerIndex = globalScene.twoPlayerMode ? (data.selectingPlayerIndex ?? 0) : globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex === 0 ? 1 : 2);

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
    optionIndex === 1 ? getCheapDealSelectableFilter(encounter) : getPriceyDealSelectableFilter(),
  );

  if (!selected || !choice) {
    return false;
  }

  return storeVitaminDealerChoice(choice);
}

function collectVitaminDealerLeaveChoice(): boolean {
  const data = getVitaminDealerData();
  const playerIndex = globalScene.twoPlayerMode ? (data.selectingPlayerIndex ?? 0) : globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex === 0 ? 1 : 2);

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
    updateWindowType(choice.playerIndex === 0 ? 1 : 2);

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
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneMoneyRequirement(0, VITAMIN_DEALER_CHEAP_PRICE_MULTIPLIER)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [
          {
            text: `${namespace}:option.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        return collectVitaminDealerDealChoice(1);
      })
      .withOptionPhase(async () => {
        return runVitaminDealerChoices();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneMoneyRequirement(0, VITAMIN_DEALER_EXPENSIVE_PRICE_MULTIPLIER)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [
          {
            text: `${namespace}:option.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        return collectVitaminDealerDealChoice(2);
      })
      .withOptionPhase(async () => {
        return runVitaminDealerChoices();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
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
      .withPreOptionPhase(async () => collectVitaminDealerLeaveChoice())
      .withOptionPhase(async () => runVitaminDealerChoices())
      .build(),
  )
  .build();
