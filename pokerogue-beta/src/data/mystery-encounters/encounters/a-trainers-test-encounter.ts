import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import type { IEggOptions } from "#data/egg";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { getSpriteKeysFromSpecies } from "#mystery-encounters/encounter-pokemon-utils";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { TrainerConfig } from "#trainers/trainer-config";
import { trainerConfigs } from "#trainers/trainer-config";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/aTrainersTest";

type ATrainersTestOptionIndex = 1 | 2;

interface StatTrainerInfo {
  trainerType: TrainerType;
  partnerSpecies: SpeciesId;
  trainerNameKey: string;
}

interface ATrainersTestChoice {
  playerIndex: PlayerIndex;
  optionIndex: ATrainersTestOptionIndex;
}

interface ATrainersTestData {
  choices: ATrainersTestChoice[];
  trainerInfos: Partial<Record<PlayerIndex, StatTrainerInfo>>;
  skipSelectedDialogueOnce?: boolean;
}

const STAT_TRAINERS: StatTrainerInfo[] = [
  {
    trainerType: TrainerType.BUCK,
    partnerSpecies: SpeciesId.CLAYDOL,
    trainerNameKey: "buck",
  },
  {
    trainerType: TrainerType.CHERYL,
    partnerSpecies: SpeciesId.BLISSEY,
    trainerNameKey: "cheryl",
  },
  {
    trainerType: TrainerType.MARLEY,
    partnerSpecies: SpeciesId.ARCANINE,
    trainerNameKey: "marley",
  },
  {
    trainerType: TrainerType.MIRA,
    partnerSpecies: SpeciesId.ALAKAZAM,
    trainerNameKey: "mira",
  },
  {
    trainerType: TrainerType.RILEY,
    partnerSpecies: SpeciesId.LUCARIO,
    trainerNameKey: "riley",
  },
];

function rollStatTrainer(excludedTrainerTypes: TrainerType[] = []): StatTrainerInfo {
  const candidates = STAT_TRAINERS.filter(info => !excludedTrainerTypes.includes(info.trainerType));
  return candidates[randSeedInt(candidates.length)];
}

function rollTrainerInfos(
  playerIndexes: PlayerIndex[] = getMysteryEncounterPlayerIndexes(),
): Partial<Record<PlayerIndex, StatTrainerInfo>> {
  const trainerInfos: Partial<Record<PlayerIndex, StatTrainerInfo>> = {};
  const excludedTrainerTypes: TrainerType[] = [];

  for (const playerIndex of playerIndexes) {
    const trainerInfo = rollStatTrainer(excludedTrainerTypes);
    trainerInfos[playerIndex] = trainerInfo;
    excludedTrainerTypes.push(trainerInfo.trainerType);
  }

  return trainerInfos;
}

function getATrainersTestData(): ATrainersTestData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      trainerInfos: rollTrainerInfos(),
    } satisfies ATrainersTestData;
  }

  return encounter.misc as ATrainersTestData;
}

function getTrainerDisplayName(info: StatTrainerInfo): string {
  return i18next.t(`trainerNames:${info.trainerNameKey}`);
}

function getTrainerEggDescription(info: StatTrainerInfo): string {
  return `${i18next.t(`${namespace}:title`)}:\n${getTrainerDisplayName(info)}`;
}

function createEggOptions(info: StatTrainerInfo, tier: EggTier): IEggOptions {
  return {
    pulled: false,
    sourceType: EggSourceType.EVENT,
    eggDescriptor: getTrainerEggDescription(info),
    tier,
  };
}

function getTrainerConfig(info: StatTrainerInfo): TrainerConfig {
  return trainerConfigs[info.trainerType].clone();
}

function getTrainerInfoForPlayer(playerIndex: PlayerIndex): StatTrainerInfo {
  const data = getATrainersTestData();
  return data.trainerInfos[playerIndex] ?? data.trainerInfos[0]!;
}

function formatTrainerNameList(trainerNames: string[]): string {
  if (trainerNames.length <= 2) {
    return trainerNames.join(" and ");
  }

  return `${trainerNames.slice(0, -1).join(", ")} and ${trainerNames.at(-1)}`;
}

function setSinglePlayerTrainerDialogue(info: StatTrainerInfo): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.dialogue.intro = [
    {
      speaker: `trainerNames:${info.trainerNameKey}`,
      text: `${namespace}:${info.trainerNameKey}.introDialogue`,
    },
  ];
  encounter.options[0].dialogue!.selected = [
    {
      speaker: `trainerNames:${info.trainerNameKey}`,
      text: `${namespace}:${info.trainerNameKey}.accept`,
    },
  ];
  encounter.options[1].dialogue!.selected = [
    {
      speaker: `trainerNames:${info.trainerNameKey}`,
      text: `${namespace}:${info.trainerNameKey}.decline`,
    },
  ];
  encounter.setDialogueToken("statTrainerName", getTrainerDisplayName(info));
  encounter.misc = {
    ...(encounter.misc ?? {}),
    trainerType: info.trainerType,
    trainerNameKey: info.trainerNameKey,
    trainerEggDescription: getTrainerEggDescription(info),
  };
}

function setMultiPlayerTrainerDialogue(
  playerIndexes: PlayerIndex[],
  trainerInfos: Partial<Record<PlayerIndex, StatTrainerInfo>>,
): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.dialogue.intro = playerIndexes.map(playerIndex => {
    const info = trainerInfos[playerIndex]!;
    return {
      speaker: `trainerNames:${info.trainerNameKey}`,
      text: `${namespace}:${info.trainerNameKey}.introDialogue`,
    };
  });
  encounter.dialogue.outro = [];
  const trainerNames = playerIndexes.map(playerIndex => getTrainerDisplayName(trainerInfos[playerIndex]!));
  encounter.setDialogueToken("statTrainerName", formatTrainerNameList(trainerNames));
}

function buildIntroSpriteConfigs(trainerInfos: StatTrainerInfo[]) {
  return trainerInfos.flatMap((info, index) => {
    const spriteKeys = getSpriteKeysFromSpecies(info.partnerSpecies);
    const trainerSpriteKey = getTrainerConfig(info).getSpriteKey();
    const xOffsets = trainerInfos.length === 1 ? [0] : trainerInfos.length === 2 ? [-34, 32] : [-58, 0, 58];
    const xOffset = xOffsets[index] ?? 0;

    return [
      {
        spriteKey: spriteKeys.spriteKey,
        fileRoot: spriteKeys.fileRoot,
        hasShadow: true,
        repeat: true,
        isPokemon: true,
        x: 22 + xOffset,
        y: -2,
        yShadow: -2,
      },
      {
        spriteKey: trainerSpriteKey,
        fileRoot: "trainer",
        hasShadow: true,
        disableAnimation: true,
        x: -24 + xOffset,
        y: 4,
        yShadow: 4,
      },
    ];
  });
}

function chooseComputerPartnerATrainersTestOption(playerIndex: PlayerIndex): ATrainersTestOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return confidence.level === "medium" || confidence.level === "high" ? 1 : 2;
}

function queueComputerPartnerATrainersTestChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: ATrainersTestOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function promptNextATrainersTestPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildATrainersTestPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerATrainersTestOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeATrainersTestChoice(optionIndex as ATrainersTestOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function hideATrainersTestNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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

async function storeATrainersTestChoice(
  optionIndex: ATrainersTestOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getATrainersTestData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerATrainersTestChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptNextATrainersTestPlayer(nextPlayerIndex, optionIndex - 1);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function showATrainersTestSelectedDialogue(choice: ATrainersTestChoice): Promise<void> {
  const info = getTrainerInfoForPlayer(choice.playerIndex);

  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  await showEncounterDialogue(
    `${namespace}:${info.trainerNameKey}.${choice.optionIndex === 1 ? "accept" : "decline"}`,
    `trainerNames:${info.trainerNameKey}`,
  );
}

function setATrainersTestBattleRewards(choice: ATrainersTestChoice): void {
  const info = getTrainerInfoForPlayer(choice.playerIndex);
  const eggOptions = createEggOptions(info, EggTier.EPIC);

  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.RELIC_GOLD],
      guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE],
      fillRemaining: true,
    },
    [eggOptions],
    undefined,
    choice.playerIndex,
  );
}

function setATrainersTestRefuseRewards(choice: ATrainersTestChoice): void {
  const info = getTrainerInfoForPlayer(choice.playerIndex);
  const eggOptions = createEggOptions(info, EggTier.RARE);

  globalScene.phaseManager.unshiftNew("PartyHealPhase", true, choice.playerIndex);
  setEncounterRewards({ fillRemaining: false, rerollMultiplier: -1 }, [eggOptions], undefined, choice.playerIndex);
}

function createATrainersTestBattleConfig(acceptChoices: ATrainersTestChoice[]): EnemyPartyConfig {
  const acceptedInfos = acceptChoices.map(choice => getTrainerInfoForPlayer(choice.playerIndex));

  if (acceptedInfos.length === 1) {
    return {
      levelAdditiveModifier: 1,
      trainerConfig: getTrainerConfig(acceptedInfos[0]),
    };
  }

  return {
    levelAdditiveModifier: 1,
    doubleBattle: true,
    trainerConfig: getTrainerConfig(acceptedInfos[0]),
    partnerTrainerConfig: getTrainerConfig(acceptedInfos[1]),
    partnerTrainerConfig2: acceptedInfos[2] ? getTrainerConfig(acceptedInfos[2]) : undefined,
  };
}

function setATrainersTestRewardMessages(choices: ATrainersTestChoice[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getATrainersTestData();

  encounter.onRewards = async () => {
    for (const choice of choices.toSorted((a, b) => a.playerIndex - b.playerIndex)) {
      globalScene.waitForPlayerInput(choice.playerIndex);
      const info = data.trainerInfos[choice.playerIndex]!;
      const trainerName = getTrainerDisplayName(info);
      const eggType = i18next.t(
        `${namespace}:eggTypes.${choice.optionIndex === 1 ? "epic" : "rare"}`,
      ).replace(/^a[n]? /, "");
      await showEncounterText(`${trainerName} gave Player ${choice.playerIndex + 1} ${eggType}!`);
    }
  };
}

async function runOnePlayerAcceptChallenge(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const info = getTrainerInfoForPlayer(0);
  const config: EnemyPartyConfig = encounter.enemyPartyConfigs[0];

  await transitionMysteryEncounterIntroVisuals();

  const eggOptions = createEggOptions(info, EggTier.EPIC);
  encounter.setDialogueToken("eggType", i18next.t(`${namespace}:eggTypes.epic`));
  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.RELIC_GOLD],
      guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE],
      fillRemaining: true,
    },
    [eggOptions],
  );
  await initBattleWithEnemyConfig(config);
}

async function runOnePlayerRefuseChallenge(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const info = getTrainerInfoForPlayer(0);

  globalScene.phaseManager.unshiftNew("PartyHealPhase", true);

  const eggOptions = createEggOptions(info, EggTier.RARE);
  encounter.setDialogueToken("eggType", i18next.t(`${namespace}:eggTypes.rare`));
  setEncounterRewards({ fillRemaining: false, rerollMultiplier: -1 }, [eggOptions]);
  leaveEncounterWithoutBattle();
}

async function runMultiPlayerATrainersTestChoices(): Promise<boolean> {
  const choices = getATrainersTestData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const acceptChoices = choices.filter(choice => choice.optionIndex === 1);
  const refuseChoices = choices.filter(choice => choice.optionIndex === 2);

  for (const choice of choices) {
    await showATrainersTestSelectedDialogue(choice);
  }

  for (const choice of refuseChoices) {
    setATrainersTestRefuseRewards(choice);
  }

  for (const choice of acceptChoices) {
    setATrainersTestBattleRewards(choice);
  }

  setATrainersTestRewardMessages(choices);

  if (acceptChoices.length === 0) {
    leaveEncounterWithoutBattle();
    return true;
  }

  const battlePlayers = acceptChoices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  await transitionMysteryEncounterIntroVisuals();
  await hideATrainersTestNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createATrainersTestBattleConfig(acceptChoices));
  return true;
}

function buildAcceptChallengeOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [],
    })
    .withPreOptionPhase(async () => storeATrainersTestChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiPlayerATrainersTestChoices() : runOnePlayerAcceptChallenge(),
    )
    .build();
}

function buildRefuseChallengeOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [],
    })
    .withPreOptionPhase(async () => storeATrainersTestChoice(2, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiPlayerATrainersTestChoices() : runOnePlayerRefuseChallenge(),
    )
    .build();
}

function buildATrainersTestPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildAcceptChallengeOption(playerIndex), buildRefuseChallengeOption(playerIndex)];
}

/**
 * A Trainer's Test encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3816 | GitHub Issue #3816}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const ATrainersTestEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.A_TRAINERS_TEST,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(100, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withIntroSpriteConfigs([]) // These are set in onInit()
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withAutoHideIntroVisuals(false)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const playerIndexes = getMysteryEncounterPlayerIndexes();
    const trainerInfos = rollTrainerInfos(playerIndexes);
    const activeTrainerInfo = trainerInfos[0] ?? trainerInfos[playerIndexes[0]]!;

    encounter.misc = {
      choices: [],
      trainerInfos,
    } satisfies ATrainersTestData;

    if (globalScene.twoPlayerMode) {
      setMultiPlayerTrainerDialogue(playerIndexes, trainerInfos);
      encounter.spriteConfigs = buildIntroSpriteConfigs(playerIndexes.map(playerIndex => trainerInfos[playerIndex]!));
    } else {
      setSinglePlayerTrainerDialogue(activeTrainerInfo);
      encounter.spriteConfigs = buildIntroSpriteConfigs([activeTrainerInfo]);
    }

    encounter.enemyPartyConfigs = [
      {
        levelAdditiveModifier: 1,
        trainerConfig: getTrainerConfig(activeTrainerInfo),
      },
    ];

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withIntroDialogue()
  .withOption(buildAcceptChallengeOption(0))
  .withOption(buildRefuseChallengeOption(0))
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
