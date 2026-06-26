import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { TrainerSlot } from "#enums/trainer-slot";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import { initBattleWithEnemyConfig, setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { trainerConfigs } from "#trainers/trainer-config";
import {
  TrainerPartyCompoundTemplate,
  TrainerPartyTemplate,
  trainerPartyTemplates,
} from "#trainers/trainer-party-template";
import { randSeedInt } from "#utils/common";
import type { TrainerConfig } from "#trainers/trainer-config";
import type { TrainerType } from "#enums/trainer-type";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/mysteriousChallengers";

type MysteriousChallengerOptionIndex = 1 | 2 | 3;

interface MysteriousChallengerChoice {
  playerIndex: PlayerIndex;
  optionIndex: MysteriousChallengerOptionIndex;
}

interface MysteriousChallengerData {
  choices: MysteriousChallengerChoice[];
  skipSelectedDialogueOnce?: boolean;
}

function getRandomTrainerTypeForChallenger(isBoss = false, excludedTrainerTypes: TrainerType[] = []): TrainerType {
  let retries = 0;
  let trainerType = globalScene.arena.randomTrainerType(globalScene.currentBattle.waveIndex, isBoss);

  while (
    retries < 8
    && (excludedTrainerTypes.includes(trainerType) || (globalScene.twoPlayerMode && trainerConfigs[trainerType].doubleOnly))
  ) {
    trainerType = globalScene.arena.randomTrainerType(globalScene.currentBattle.waveIndex, isBoss);
    retries++;
  }

  return trainerType;
}

function getTrainerFemale(config: TrainerConfig): boolean {
  return config.hasGenders ? !!randSeedInt(2) : false;
}

function applyBrutalTemplate(config: TrainerConfig, trainerType: TrainerType): void {
  config.title = trainerConfigs[trainerType].title;
  config.setPartyTemplates(trainerPartyTemplates.ELITE_FOUR);
  // @ts-expect-error
  config.partyTemplateFunc = null; // Overrides gym leader party template func
}

function getMysteriousChallengerData(): MysteriousChallengerData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies MysteriousChallengerData;
  }

  return encounter.misc as MysteriousChallengerData;
}

function getChallengerLevelAdditiveModifier(optionIndex: MysteriousChallengerOptionIndex): number {
  switch (optionIndex) {
    case 2:
      return 1;
    case 3:
      return 1.5;
    default:
      return 0;
  }
}

function getChallengerRewards(
  optionIndex: MysteriousChallengerOptionIndex,
): Parameters<typeof setEncounterRewards>[0] {
  switch (optionIndex) {
    case 1:
      return {
        guaranteedModifierTypeFuncs: [modifierTypes.TM_COMMON, modifierTypes.TM_GREAT, modifierTypes.MEMORY_MUSHROOM],
        fillRemaining: true,
      };
    case 2:
      return {
        guaranteedModifierTiers: [ModifierTier.ULTRA, ModifierTier.ULTRA, ModifierTier.GREAT, ModifierTier.GREAT],
        fillRemaining: true,
      };
    case 3:
      return {
        guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE, ModifierTier.ULTRA, ModifierTier.GREAT],
        fillRemaining: true,
      };
  }
}

function setChallengerRewards(optionIndex: MysteriousChallengerOptionIndex, playerIndex: PlayerIndex): void {
  setEncounterRewards(getChallengerRewards(optionIndex), undefined, undefined, playerIndex);
}

function chooseComputerPartnerChallengerOption(playerIndex: PlayerIndex): MysteriousChallengerOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  switch (confidence.level) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

function queueComputerPartnerChallengerChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: MysteriousChallengerOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function promptNextMysteriousChallengerPlayer(
  playerIndex: PlayerIndex,
  startingCursorIndex: number,
): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildMysteriousChallengerPlayerOptions(),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerChallengerOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeMysteriousChallengerChoice(optionIndex as MysteriousChallengerOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function storeMysteriousChallengerChoice(
  optionIndex: MysteriousChallengerOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getMysteriousChallengerData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerChallengerChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptNextMysteriousChallengerPlayer(nextPlayerIndex, optionIndex - 1);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function createMysteriousChallengerBattleConfig(choices: MysteriousChallengerChoice[]): EnemyPartyConfig {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const sortedChoices = choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const configs = sortedChoices.map(choice => encounter.enemyPartyConfigs[choice.optionIndex - 1]);
  const trainerLevelAdditiveModifiers: Partial<Record<TrainerSlot, number>> = {
    [TrainerSlot.TRAINER]: getChallengerLevelAdditiveModifier(sortedChoices[0].optionIndex),
  };
  if (sortedChoices[1]) {
    trainerLevelAdditiveModifiers[TrainerSlot.TRAINER_PARTNER] = getChallengerLevelAdditiveModifier(
      sortedChoices[1].optionIndex,
    );
  }
  if (sortedChoices[2]) {
    trainerLevelAdditiveModifiers[TrainerSlot.TRAINER_PARTNER_2] = getChallengerLevelAdditiveModifier(
      sortedChoices[2].optionIndex,
    );
  }

  return {
    trainerConfig: configs[0].trainerConfig,
    female: configs[0].female,
    partnerTrainerConfig: configs[1]?.trainerConfig,
    partnerFemale: configs[1]?.female,
    partnerTrainerConfig2: configs[2]?.trainerConfig,
    partnerFemale2: configs[2]?.female,
    doubleBattle: sortedChoices.length > 1,
    trainerLevelAdditiveModifiers,
  };
}

async function runMysteriousChallengerChoices(
  optionIndex: MysteriousChallengerOptionIndex,
): Promise<boolean> {
  const choices = globalScene.twoPlayerMode
    ? getMysteriousChallengerData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex)
    : [{ playerIndex: globalScene.activePlayerIndex, optionIndex }];

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.selected`);
    }
    setChallengerRewards(choice.optionIndex, choice.playerIndex);
  }

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (choices.some(choice => choice.optionIndex === 3)) {
    // To avoid player level snowballing from picking the brutal option
    encounter.expMultiplier = 0.9;
  }

  const battlePlayers = choices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);

  let initBattlePromise: Promise<void>;
  globalScene.executeWithSeedOffset(() => {
    initBattlePromise = initBattleWithEnemyConfig(createMysteriousChallengerBattleConfig(choices));
  }, globalScene.currentBattle.waveIndex * 1000 + choices.reduce((total, choice) => total + choice.optionIndex * (choice.playerIndex + 1), 0));
  await initBattlePromise!;
  return true;
}

function buildMysteriousChallengerOption(optionIndex: MysteriousChallengerOptionIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
      selected: [
        {
          text: `${namespace}:option.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeMysteriousChallengerChoice(optionIndex, globalScene.activePlayerIndex))
    .withOptionPhase(async () => runMysteriousChallengerChoices(optionIndex))
    .build();
}

function buildMysteriousChallengerPlayerOptions(): MysteryEncounterOption[] {
  return [
    buildMysteriousChallengerOption(1),
    buildMysteriousChallengerOption(2),
    buildMysteriousChallengerOption(3),
  ];
}

/**
 * Mysterious Challengers encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3801 | GitHub Issue #3801}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const MysteriousChallengersEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.MYSTERIOUS_CHALLENGERS,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([]) // These are set in onInit()
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Calculates what trainers are available for battle in the encounter

    // Normal difficulty trainer is randomly pulled from biome
    const normalTrainerType = getRandomTrainerTypeForChallenger();
    const normalConfig = trainerConfigs[normalTrainerType].clone();
    let female = getTrainerFemale(normalConfig);
    const normalSpriteKey = normalConfig.getSpriteKey(female, normalConfig.doubleOnly);
    const normalPartyConfig: EnemyPartyConfig = {
      trainerConfig: normalConfig,
      female,
    };
    encounter.enemyPartyConfigs.push(normalPartyConfig);

    // Hard difficulty trainer is another random trainer, but with AVERAGE_BALANCED config
    // Number of mons is based off wave: 1-20 is 2, 20-40 is 3, etc. capping at 6 after wave 100
    const hardTrainerType = getRandomTrainerTypeForChallenger(false, [normalTrainerType]);
    const hardTemplate = new TrainerPartyCompoundTemplate(
      new TrainerPartyTemplate(1, PartyMemberStrength.STRONGER, false, true),
      new TrainerPartyTemplate(
        Math.min(Math.ceil(globalScene.currentBattle.waveIndex / 20), 5),
        PartyMemberStrength.AVERAGE,
        false,
        true,
      ),
    );
    const hardConfig = trainerConfigs[hardTrainerType].clone();
    hardConfig.setPartyTemplates(hardTemplate);
    female = getTrainerFemale(hardConfig);
    const hardSpriteKey = hardConfig.getSpriteKey(female, hardConfig.doubleOnly);
    const hardPartyConfig: EnemyPartyConfig = {
      trainerConfig: hardConfig,
      levelAdditiveModifier: 1,
      female,
    };
    encounter.enemyPartyConfigs.push(hardPartyConfig);

    // Brutal trainer is pulled from pool of boss trainers (gym leaders) for the biome
    // They are given an E4 template team, so will be stronger than usual boss encounter and always have 6 mons
    const brutalTrainerType = getRandomTrainerTypeForChallenger(true);
    const brutalConfig = trainerConfigs[brutalTrainerType].clone();
    applyBrutalTemplate(brutalConfig, brutalTrainerType);
    female = getTrainerFemale(brutalConfig);
    const brutalSpriteKey = brutalConfig.getSpriteKey(female, brutalConfig.doubleOnly);
    const brutalPartyConfig: EnemyPartyConfig = {
      trainerConfig: brutalConfig,
      levelAdditiveModifier: 1.5,
      female,
    };
    encounter.enemyPartyConfigs.push(brutalPartyConfig);

    encounter.spriteConfigs = [
      {
        spriteKey: normalSpriteKey,
        fileRoot: "trainer",
        hasShadow: true,
        tint: 1,
      },
      {
        spriteKey: hardSpriteKey,
        fileRoot: "trainer",
        hasShadow: true,
        tint: 1,
      },
      {
        spriteKey: brutalSpriteKey,
        fileRoot: "trainer",
        hasShadow: true,
        tint: 1,
      },
    ];
    encounter.misc = {
      choices: [],
    } satisfies MysteriousChallengerData;

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildMysteriousChallengerOption(1))
  .withOption(buildMysteriousChallengerOption(2))
  .withOption(buildMysteriousChallengerOption(3))
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
