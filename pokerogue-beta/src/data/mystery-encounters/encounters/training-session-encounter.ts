import type { Ability } from "#abilities/ability";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities } from "#data/data-lists";
import { getNatureName } from "#data/nature";
import { AbilityAttr } from "#enums/ability-attr";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { getStatKey } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import { isPokemonValidForEncounterOptionSelection } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonData } from "#system/pokemon-data";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedShuffle } from "#utils/common";
import { getEnumValues } from "#utils/enums";
import i18next from "i18next";

/** The i18n namespace for the encounter */
const namespace = "mysteryEncounters/trainingSession";

const MIN_HEALTHY_POKEMON_FOR_TRAINING = 2;

type TrainingOptionIndex = 1 | 2 | 3 | 4;

interface TrainingChoice {
  playerIndex: PlayerIndex;
  optionIndex: TrainingOptionIndex;
  playerPokemon?: PlayerPokemon;
  chosenNature?: Nature;
  abilityIndex?: number;
  modifiers?: ModifiersHolder;
}

interface TrainingSessionData {
  trainingChoices: TrainingChoice[];
  selectingPlayerIndex?: PlayerIndex;
  skipSelectedDialogueOnce?: boolean;
}

class TrainingSessionSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return globalScene.getPokemonAllowedInBattle().length >= MIN_HEALTHY_POKEMON_FOR_TRAINING;
    }

    return ([0, 1] as PlayerIndex[]).every(
      playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length >= MIN_HEALTHY_POKEMON_FOR_TRAINING,
    );
  }

  override getDialogueToken(): [string, string] {
    return ["minHealthyPokemon", MIN_HEALTHY_POKEMON_FOR_TRAINING.toString()];
  }
}

function getTrainingSessionData(): TrainingSessionData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.trainingChoices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      trainingChoices: [],
      selectingPlayerIndex: 0,
    } satisfies TrainingSessionData;
  }

  return encounter.misc as TrainingSessionData;
}

function storeTrainingChoice(choice: TrainingChoice): void {
  const data = getTrainingSessionData();
  data.trainingChoices = data.trainingChoices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.trainingChoices.push(choice);
}

function getTrainingSelectableFilter() {
  return (pokemon: Pokemon) => isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
}

function promptSecondTrainingPlayer(startingCursorIndex: number): void {
  const data = getTrainingSessionData();
  data.selectingPlayerIndex = 1;
  globalScene.setActivePlayerIndex(1);
  updateWindowType(2);
  globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
    slideInDescription: false,
    overrideTitle: "Player 2",
    overrideQuery: i18next.t(`${namespace}:query`),
    startingCursorIndex,
  });
}

function finishTrainingChoiceCollection(playerIndex: PlayerIndex, optionIndex: TrainingOptionIndex): boolean {
  if (globalScene.twoPlayerMode && playerIndex === 0) {
    promptSecondTrainingPlayer(optionIndex - 1);
    return false;
  }

  const data = getTrainingSessionData();
  delete data.selectingPlayerIndex;
  if (globalScene.twoPlayerMode) {
    data.skipSelectedDialogueOnce = true;
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }
  return true;
}

async function collectTrainingChoice(optionIndex: TrainingOptionIndex): Promise<boolean> {
  const data = getTrainingSessionData();
  const playerIndex = globalScene.twoPlayerMode ? (data.selectingPlayerIndex ?? 0) : globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);
  if (globalScene.twoPlayerMode) {
    updateWindowType(playerIndex + 1);
  }

  if (optionIndex === 4) {
    storeTrainingChoice({ playerIndex, optionIndex });
    return finishTrainingChoiceCollection(playerIndex, optionIndex);
  }

  let choice: TrainingChoice | undefined;
  const selectableFilter = getTrainingSelectableFilter();

  if (optionIndex === 1) {
    const selected = await selectPokemonForOption(pokemon => {
      choice = { playerIndex, optionIndex, playerPokemon: pokemon };
    }, undefined, selectableFilter);
    if (!selected || !choice) {
      return false;
    }
    storeTrainingChoice(choice);
    return finishTrainingChoiceCollection(playerIndex, optionIndex);
  }

  if (optionIndex === 2) {
    const selected = await selectPokemonForOption(pokemon => {
      return getEnumValues(Nature).map((nature: Nature) => {
        const option: OptionSelectItem = {
          label: getNatureName(nature, true, true, true),
          handler: () => {
            globalScene.currentBattle.mysteryEncounter!.setDialogueToken("nature", getNatureName(nature));
            choice = { playerIndex, optionIndex, playerPokemon: pokemon, chosenNature: nature };
            return true;
          },
        };
        return option;
      });
    }, undefined, selectableFilter);
    if (!selected || !choice) {
      return false;
    }
    storeTrainingChoice(choice);
    return finishTrainingChoiceCollection(playerIndex, optionIndex);
  }

  const selected = await selectPokemonForOption(pokemon => {
    const speciesForm = pokemon.getFusionSpeciesForm() ? pokemon.getFusionSpeciesForm() : pokemon.getSpeciesForm();
    const abilityCount = speciesForm.getAbilityCount();
    const abilities: Ability[] = new Array(abilityCount)
      .fill(null)
      .map((_val, i) => allAbilities[speciesForm.getAbility(i)]);

    const optionSelectItems: OptionSelectItem[] = [];
    abilities.forEach((ability: Ability, index) => {
      if (!optionSelectItems.some(o => o.label === ability.name)) {
        const option: OptionSelectItem = {
          label: ability.name,
          handler: () => {
            globalScene.currentBattle.mysteryEncounter!.setDialogueToken("ability", ability.name);
            choice = { playerIndex, optionIndex, playerPokemon: pokemon, abilityIndex: index };
            return true;
          },
          onHover: () => {
            showEncounterText(ability.description, 0, 0, false);
          },
        };
        optionSelectItems.push(option);
      }
    });

    return optionSelectItems;
  }, undefined, selectableFilter);
  if (!selected || !choice) {
    return false;
  }
  storeTrainingChoice(choice);
  return finishTrainingChoiceCollection(playerIndex, optionIndex);
}

function getTrainingSegments(optionIndex: TrainingOptionIndex): number {
  switch (optionIndex) {
    case 1:
      return Math.min(2 + Math.floor(globalScene.currentBattle.waveIndex / 50), 5);
    case 2:
      return Math.min(2 + Math.floor(globalScene.currentBattle.waveIndex / 40), 6);
    case 3:
      return Math.min(2 + Math.floor(globalScene.currentBattle.waveIndex / 30), 6);
    default:
      return 0;
  }
}

function restoreTrainingPokemon(choice: TrainingChoice): PlayerPokemon {
  const playerPokemon = choice.playerPokemon!;
  globalScene.getPlayerParty(choice.playerIndex).push(playerPokemon);
  for (const mod of choice.modifiers?.value ?? []) {
    mod.pokemonId = playerPokemon.id;
    globalScene.addModifier(mod, true, false, false, true, undefined, choice.playerIndex);
  }
  globalScene.updateModifiers(true, undefined, choice.playerIndex);
  return playerPokemon;
}

function applyLightTrainingReward(choice: TrainingChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerPokemon = choice.playerPokemon!;
  encounter.setDialogueToken("stat1", "-");
  encounter.setDialogueToken("stat2", "-");

  let ivIndexes: any[] = [];
  playerPokemon.ivs.forEach((iv, index) => {
    if (iv < 31) {
      ivIndexes.push({ iv, index });
    }
  });

  let improvedCount = 0;
  while (ivIndexes.length > 0 && improvedCount < 2) {
    ivIndexes = randSeedShuffle(ivIndexes);
    const ivToChange = ivIndexes.pop();
    let newVal = ivToChange.iv;
    if (improvedCount === 0) {
      encounter.setDialogueToken("stat1", i18next.t(getStatKey(ivToChange.index)) ?? "");
    } else {
      encounter.setDialogueToken("stat2", i18next.t(getStatKey(ivToChange.index)) ?? "");
    }

    if (ivToChange.iv <= 21 && ivToChange.iv - (1 % 5) === 0) {
      newVal += 1;
    }

    newVal += ivToChange.iv <= 10 ? 10 : ivToChange.iv <= 20 ? 5 : 3;
    playerPokemon.ivs[ivToChange.index] = Math.min(newVal, 31);
    improvedCount++;
  }

  if (improvedCount > 0) {
    playerPokemon.calculateStats();
    globalScene.gameData.updateSpeciesDexIvs(playerPokemon.species.getRootSpeciesId(true), playerPokemon.ivs);
    globalScene.gameData.setPokemonCaught(playerPokemon, false);
  }

  restoreTrainingPokemon(choice);
  queueEncounterMessage(`${namespace}:option.1.finished`);
}

function applyModerateTrainingReward(choice: TrainingChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerPokemon = choice.playerPokemon!;
  encounter.setDialogueToken("nature", getNatureName(choice.chosenNature!));
  playerPokemon.setCustomNature(choice.chosenNature!);
  globalScene.gameData.unlockSpeciesNature(playerPokemon.species, choice.chosenNature!);
  restoreTrainingPokemon(choice);
  queueEncounterMessage(`${namespace}:option.2.finished`);
}

function applyHeavyTrainingReward(choice: TrainingChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerPokemon = choice.playerPokemon!;
  const abilityIndex = choice.abilityIndex!;
  const speciesForm = playerPokemon.getFusionSpeciesForm()
    ? playerPokemon.getFusionSpeciesForm()
    : playerPokemon.getSpeciesForm();
  encounter.setDialogueToken("ability", allAbilities[speciesForm.getAbility(abilityIndex)].name);

  if (playerPokemon.getFusionSpeciesForm()) {
    playerPokemon.fusionAbilityIndex = abilityIndex;

    const rootFusionSpecies = playerPokemon.fusionSpecies?.getRootSpeciesId();
    if (
      rootFusionSpecies != null
      && speciesDataRegistry.isStarter(rootFusionSpecies)
      && globalScene.gameData.dexData[rootFusionSpecies].caughtAttr
    ) {
      globalScene.gameData.starterData[rootFusionSpecies].abilityAttr |=
        playerPokemon.fusionAbilityIndex !== 1 || playerPokemon.fusionSpecies?.ability2
          ? 1 << playerPokemon.fusionAbilityIndex
          : AbilityAttr.ABILITY_HIDDEN;
    }
  } else {
    playerPokemon.abilityIndex = abilityIndex;
  }

  playerPokemon.calculateStats();
  globalScene.gameData.setPokemonCaught(playerPokemon, false);
  restoreTrainingPokemon(choice);
  queueEncounterMessage(`${namespace}:option.3.finished`);
}

function applyTrainingReward(choice: TrainingChoice): void {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  if (globalScene.twoPlayerMode) {
    updateWindowType(choice.playerIndex + 1);
  }

  globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
    "selectedPokemon",
    choice.playerPokemon!.getNameToRender(),
  );

  switch (choice.optionIndex) {
    case 1:
      applyLightTrainingReward(choice);
      break;
    case 2:
      applyModerateTrainingReward(choice);
      break;
    case 3:
      applyHeavyTrainingReward(choice);
      break;
  }
}

async function runTrainingSession(): Promise<boolean | void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getTrainingSessionData();
  const choices = data.trainingChoices.filter(choice => choice.optionIndex !== 4 && choice.playerPokemon);

  if (choices.length === 0) {
    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.4.selected`);
    }
    leaveEncounterWithoutBattle(true);
    return true;
  }

  if (globalScene.twoPlayerMode) {
    for (const choice of choices) {
      encounter.setDialogueToken("selectedPokemon", choice.playerPokemon!.getNameToRender());
      await showEncounterText(`${namespace}:option.selected`);
    }
  }

  const pokemonConfigs = choices.map(choice => {
    const modifiers = new ModifiersHolder();
    const config = getEnemyConfig(choice.playerPokemon!, getTrainingSegments(choice.optionIndex), modifiers);
    if (choice.optionIndex === 3) {
      config.pokemonConfigs![0].tags = [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON];
    }

    choice.modifiers = modifiers;
    globalScene.removePokemonFromPlayerParty(choice.playerPokemon!, false);
    setEncounterRewards({ fillRemaining: true }, undefined, () => applyTrainingReward(choice), choice.playerIndex);
    return config.pokemonConfigs![0];
  });

  await initBattleWithEnemyConfig({
    doubleBattle: globalScene.twoPlayerMode,
    pokemonConfigs,
  });
}

/**
 * Training Session encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3802 | GitHub Issue #3802}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TrainingSessionEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.TRAINING_SESSION,
  )
    .withEncounterTier(MysteryEncounterTier.ULTRA)
    .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new TrainingSessionSpawnRequirement()) // Both 2P players must have at least 2 healthy Pokemon
  .withFleeAllowed(false)
  .withHideWildIntroMessage(true)
  .withPreventGameStatsUpdates(true) // Do not count the Pokemon as seen or defeated since it is ours
  .withIntroSpriteConfigs([
    {
      spriteKey: "training_session_gear",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      y: 6,
      x: 5,
      yShadow: -2,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withHasDexProgress(true)
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
        return collectTrainingChoice(1);
      })
      .withOptionPhase(async () => {
        return runTrainingSession();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withHasDexProgress(true)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        secondOptionPrompt: `${namespace}:option.2.selectPrompt`,
        selected: [
          {
            text: `${namespace}:option.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        return collectTrainingChoice(2);
      })
      .withOptionPhase(async () => {
        return runTrainingSession();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withHasDexProgress(true)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        secondOptionPrompt: `${namespace}:option.3.selectPrompt`,
        selected: [
          {
            text: `${namespace}:option.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        return collectTrainingChoice(3);
      })
      .withOptionPhase(async () => {
        return runTrainingSession();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.4.label`,
        buttonTooltip: `${namespace}:option.4.tooltip`,
        selected: [
          {
            text: `${namespace}:option.4.selected`,
          },
        ],
      })
      .withPreOptionPhase(async (): Promise<boolean> => {
        return collectTrainingChoice(4);
      })
      .withOptionPhase(async () => {
        return runTrainingSession();
      })
      .build(),
  )
  .build();

function getEnemyConfig(playerPokemon: PlayerPokemon, segments: number, modifiers: ModifiersHolder): EnemyPartyConfig {
  playerPokemon.resetSummonData();

  // Passes modifiers by reference
  modifiers.value = playerPokemon.getHeldItems();
  const modifierConfigs = modifiers.value.map(mod => {
    return {
      modifier: mod.clone(),
      isTransferable: false,
      stackCount: mod.stackCount,
    };
  }) as HeldModifierConfig[];

  const data = new PokemonData(playerPokemon);
  return {
    pokemonConfigs: [
      {
        species: playerPokemon.species,
        isBoss: true,
        bossSegments: segments,
        formIndex: playerPokemon.formIndex,
        level: playerPokemon.level,
        dataSource: data,
        modifierConfigs,
      },
    ],
  };
}

class ModifiersHolder {
  public value: PokemonHeldItemModifier[] = [];
}
