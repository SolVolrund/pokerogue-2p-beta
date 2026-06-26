import type { Ability } from "#abilities/ability";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities } from "#data/data-lists";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { AbilityAttr } from "#enums/ability-attr";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { getStatKey, Stat, type EffectiveStat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
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
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonData } from "#system/pokemon-data";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerProfile, type ComputerPartnerKey, type ComputerPartnerRole } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
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

    return getMysteryEncounterPlayerIndexes().every(
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

function getTrainableParty(playerIndex: PlayerIndex): PlayerPokemon[] {
  const selectableFilter = getTrainingSelectableFilter();
  return globalScene.getPlayerParty(playerIndex).filter(pokemon => !selectableFilter(pokemon));
}

function getTrainingPokemonRole(playerIndex: PlayerIndex, pokemon: PlayerPokemon): ComputerPartnerRole {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const party = globalScene.getPlayerParty(playerIndex);
  const slotIndex = party.indexOf(pokemon);

  if (pokemon.computerPartnerAce || slotIndex === 0) {
    switch (profile.key as ComputerPartnerKey) {
      case "riley":
        return "physical";
      case "mira":
        return "special";
      case "buck":
      case "cheryl":
        return "bulk";
      case "marley":
        return "speed";
      default:
        return profile.roles[0] ?? "balanced";
    }
  }

  return profile.roles[slotIndex] ?? "balanced";
}

function getPokemonNaturalStat(pokemon: PlayerPokemon, stat: Stat): number {
  return pokemon.getSpeciesForm().getBaseStat(stat);
}

function getLessNeededOffensiveStat(pokemon: PlayerPokemon): Stat.ATK | Stat.SPATK {
  return getPokemonNaturalStat(pokemon, Stat.ATK) <= getPokemonNaturalStat(pokemon, Stat.SPATK)
    ? Stat.ATK
    : Stat.SPATK;
}

function getPreferredDefensiveStat(pokemon: PlayerPokemon): Stat.DEF | Stat.SPDEF {
  return getPokemonNaturalStat(pokemon, Stat.DEF) <= getPokemonNaturalStat(pokemon, Stat.SPDEF)
    ? Stat.DEF
    : Stat.SPDEF;
}

function getTrainingDesiredStat(playerIndex: PlayerIndex, pokemon: PlayerPokemon): EffectiveStat {
  const role = getTrainingPokemonRole(playerIndex, pokemon);
  switch (role) {
    case "physical":
      return Stat.ATK;
    case "special":
      return Stat.SPATK;
    case "speed":
      return Stat.SPD;
    case "defense":
      return Stat.DEF;
    case "specialDefense":
      return Stat.SPDEF;
    case "bulk":
    case "hpBulk":
      return getPreferredDefensiveStat(pokemon);
    case "ace":
    case "balanced":
      return getPokemonNaturalStat(pokemon, Stat.ATK) >= getPokemonNaturalStat(pokemon, Stat.SPATK)
        ? Stat.ATK
        : Stat.SPATK;
  }
}

function getTrainingDumpStat(pokemon: PlayerPokemon, desiredStat: EffectiveStat): EffectiveStat {
  if (desiredStat === Stat.ATK) {
    return Stat.SPATK;
  }
  if (desiredStat === Stat.SPATK) {
    return Stat.ATK;
  }

  return getLessNeededOffensiveStat(pokemon);
}

function getPreferredTrainingNature(playerIndex: PlayerIndex, pokemon: PlayerPokemon): Nature {
  const desiredStat = getTrainingDesiredStat(playerIndex, pokemon);
  const dumpStat = getTrainingDumpStat(pokemon, desiredStat);
  const natures = getEnumValues(Nature) as Nature[];

  return (
    natures.find(
      nature =>
        getNatureStatMultiplier(nature, desiredStat) > 1 && getNatureStatMultiplier(nature, dumpStat) < 1,
    )
    ?? natures.find(nature => getNatureStatMultiplier(nature, desiredStat) > 1)
    ?? pokemon.getNature()
  );
}

function isPokemonNatureBadForTraining(playerIndex: PlayerIndex, pokemon: PlayerPokemon): boolean {
  return getNatureStatMultiplier(pokemon.getNature(), getTrainingDesiredStat(playerIndex, pokemon)) < 1;
}

function getHiddenAbilityIndex(pokemon: PlayerPokemon): number | undefined {
  const speciesForm = pokemon.getFusionSpeciesForm() ? pokemon.getFusionSpeciesForm() : pokemon.getSpeciesForm();
  const abilityCount = speciesForm.getAbilityCount();
  if (abilityCount < 3) {
    return undefined;
  }

  return abilityCount - 1;
}

function canBenefitFromHeavyTraining(pokemon: PlayerPokemon): boolean {
  const hiddenAbilityIndex = getHiddenAbilityIndex(pokemon);
  if (hiddenAbilityIndex == null) {
    return false;
  }

  const currentAbilityIndex = pokemon.getFusionSpeciesForm() ? pokemon.fusionAbilityIndex : pokemon.abilityIndex;
  return currentAbilityIndex !== hiddenAbilityIndex;
}

function getTrainingCandidateScore(playerIndex: PlayerIndex, pokemon: PlayerPokemon): number {
  const desiredStat = getTrainingDesiredStat(playerIndex, pokemon);
  const ivDeficit = pokemon.ivs.reduce((total, iv) => total + (31 - iv), 0);
  return getPokemonNaturalStat(pokemon, desiredStat) * 4 + ivDeficit;
}

function getBestTrainingCandidate(
  playerIndex: PlayerIndex,
  predicate: (pokemon: PlayerPokemon) => boolean,
): PlayerPokemon | undefined {
  return getTrainableParty(playerIndex)
    .filter(predicate)
    .sort((a, b) => getTrainingCandidateScore(playerIndex, b) - getTrainingCandidateScore(playerIndex, a))[0];
}

function chooseComputerPartnerTrainingChoice(playerIndex: PlayerIndex): TrainingChoice {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));

  if (confidence.level === "none") {
    return { playerIndex, optionIndex: 4 };
  }

  if (confidence.level === "high") {
    const heavyCandidate = getBestTrainingCandidate(playerIndex, canBenefitFromHeavyTraining);
    const abilityIndex = heavyCandidate ? getHiddenAbilityIndex(heavyCandidate) : undefined;
    if (heavyCandidate && abilityIndex != null) {
      return { playerIndex, optionIndex: 3, playerPokemon: heavyCandidate, abilityIndex };
    }
  }

  if (confidence.level === "high" || confidence.level === "medium") {
    const moderateCandidate = getBestTrainingCandidate(playerIndex, pokemon =>
      isPokemonNatureBadForTraining(playerIndex, pokemon),
    );
    if (moderateCandidate) {
      return {
        playerIndex,
        optionIndex: 2,
        playerPokemon: moderateCandidate,
        chosenNature: getPreferredTrainingNature(playerIndex, moderateCandidate),
      };
    }
  }

  const lightCandidate = getBestTrainingCandidate(playerIndex, pokemon => pokemon.ivs.some(iv => iv < 31))
    ?? getTrainableParty(playerIndex)[0];
  return lightCandidate
    ? { playerIndex, optionIndex: 1, playerPokemon: lightCandidate }
    : { playerIndex, optionIndex: 4 };
}

function queueComputerPartnerTrainingChoiceMessage(choice: TrainingChoice): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(choice.playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${choice.optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function promptTrainingPlayer(playerIndex: PlayerIndex, startingCursorIndex: number): Promise<boolean> {
  const data = getTrainingSessionData();
  data.selectingPlayerIndex = playerIndex;
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildTrainingSessionPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: choicePlayerIndex => chooseComputerPartnerTrainingChoice(choicePlayerIndex).optionIndex,
      onOptionChosen: (_optionIndex, choicePlayerIndex) => collectComputerPartnerTrainingChoice(choicePlayerIndex),
    },
  });
  return result ?? false;
}

function finishTrainingChoiceCollection(playerIndex: PlayerIndex, optionIndex: TrainingOptionIndex): boolean | Promise<boolean> {
  if (globalScene.twoPlayerMode) {
    const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
    if (nextPlayerIndex != null) {
      return promptTrainingPlayer(nextPlayerIndex, optionIndex - 1);
    }
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

async function collectComputerPartnerTrainingChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const choice = chooseComputerPartnerTrainingChoice(playerIndex);
  storeTrainingChoice(choice);
  queueComputerPartnerTrainingChoiceMessage(choice);
  return finishTrainingChoiceCollection(playerIndex, choice.optionIndex);
}

async function collectTrainingChoice(
  optionIndex: TrainingOptionIndex,
  choosingPlayerIndex?: PlayerIndex,
): Promise<boolean> {
  const data = getTrainingSessionData();
  const playerIndex = globalScene.twoPlayerMode
    ? choosingPlayerIndex ?? data.selectingPlayerIndex ?? globalScene.activePlayerIndex
    : globalScene.activePlayerIndex;
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
  const gameData = globalScene.getPlayerGameData(choice.playerIndex);
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
    gameData.updateSpeciesDexIvs(playerPokemon.species.getRootSpeciesId(true), playerPokemon.ivs);
    gameData.setPokemonCaught(playerPokemon, false);
  }

  restoreTrainingPokemon(choice);
  queueEncounterMessage(`${namespace}:option.1.finished`);
}

function applyModerateTrainingReward(choice: TrainingChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerPokemon = choice.playerPokemon!;
  const gameData = globalScene.getPlayerGameData(choice.playerIndex);
  encounter.setDialogueToken("nature", getNatureName(choice.chosenNature!));
  playerPokemon.setCustomNature(choice.chosenNature!);
  gameData.unlockSpeciesNature(playerPokemon.species, choice.chosenNature!);
  restoreTrainingPokemon(choice);
  queueEncounterMessage(`${namespace}:option.2.finished`);
}

function applyHeavyTrainingReward(choice: TrainingChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerPokemon = choice.playerPokemon!;
  const gameData = globalScene.getPlayerGameData(choice.playerIndex);
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
      && gameData.dexData[rootFusionSpecies].caughtAttr
    ) {
      gameData.starterData[rootFusionSpecies].abilityAttr |=
        playerPokemon.fusionAbilityIndex !== 1 || playerPokemon.fusionSpecies?.ability2
          ? 1 << playerPokemon.fusionAbilityIndex
          : AbilityAttr.ABILITY_HIDDEN;
    }
  } else {
    playerPokemon.abilityIndex = abilityIndex;
  }

  playerPokemon.calculateStats();
  gameData.setPokemonCaught(playerPokemon, false);
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

async function hideTrainingSessionNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  await Promise.all(
    getMysteryEncounterPlayerIndexes()
      .filter(playerIndex => !battlePlayerSet.has(playerIndex))
      .map(
        playerIndex =>
          new Promise<void>(resolve => {
            const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
            globalScene.tweens.killTweensOf(trainerSprite);

            if (!trainerSprite.visible) {
              resolve();
              return;
            }

            globalScene.tweens.add({
              targets: trainerSprite,
              x: -36,
              duration: 500,
              onComplete: () => {
                trainerSprite.setVisible(false);
                resolve();
              },
            });
          }),
      ),
  );
}

async function runTrainingSession(): Promise<boolean | void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getTrainingSessionData();
  const sortedChoices = data.trainingChoices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const choices = sortedChoices.filter(choice => choice.optionIndex !== 4 && choice.playerPokemon);

  if (choices.length === 0) {
    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.4.selected`);
    }
    leaveEncounterWithoutBattle(true);
    return true;
  }

  if (globalScene.twoPlayerMode) {
    for (const choice of sortedChoices) {
      if (choice.optionIndex === 4 || !choice.playerPokemon) {
        await showEncounterText(`${namespace}:option.4.selected`);
      } else {
        encounter.setDialogueToken("selectedPokemon", choice.playerPokemon.getNameToRender());
        await showEncounterText(`${namespace}:option.selected`);
      }
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

  const battlePlayers = choices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  await hideTrainingSessionNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig({
    doubleBattle: choices.length > 1,
    pokemonConfigs,
  });
}

function buildLightTrainingOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
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
    .withPreOptionPhase(async (): Promise<boolean> => collectTrainingChoice(1, playerIndex))
    .withOptionPhase(async () => runTrainingSession())
    .build();
}

function buildModerateTrainingOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
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
    .withPreOptionPhase(async (): Promise<boolean> => collectTrainingChoice(2, playerIndex))
    .withOptionPhase(async () => runTrainingSession())
    .build();
}

function buildHeavyTrainingOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
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
    .withPreOptionPhase(async (): Promise<boolean> => collectTrainingChoice(3, playerIndex))
    .withOptionPhase(async () => runTrainingSession())
    .build();
}

function buildLeaveTrainingOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.4.label`,
      buttonTooltip: `${namespace}:option.4.tooltip`,
      selected: [
        {
          text: `${namespace}:option.4.selected`,
        },
      ],
    })
    .withPreOptionPhase(async (): Promise<boolean> => collectTrainingChoice(4, playerIndex))
    .withOptionPhase(async () => runTrainingSession())
    .build();
}

function buildTrainingSessionPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildLightTrainingOption(playerIndex),
    buildModerateTrainingOption(playerIndex),
    buildHeavyTrainingOption(playerIndex),
    buildLeaveTrainingOption(playerIndex),
  ];
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
  .withSceneRequirement(new TrainingSessionSpawnRequirement())
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
  .withOption(buildLightTrainingOption(0))
  .withOption(buildModerateTrainingOption(0))
  .withOption(buildHeavyTrainingOption(0))
  .withOption(buildLeaveTrainingOption(0))
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
