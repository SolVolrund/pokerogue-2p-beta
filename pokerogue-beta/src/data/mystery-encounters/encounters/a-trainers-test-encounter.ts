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
import { UiMode } from "#enums/ui-mode";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { getSpriteKeysFromSpecies } from "#mystery-encounters/encounter-pokemon-utils";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { TrainerConfig } from "#trainers/trainer-config";
import { trainerConfigs } from "#trainers/trainer-config";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
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
  trainerInfos: Record<PlayerIndex, StatTrainerInfo>;
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

function rollTrainerInfos(): Record<PlayerIndex, StatTrainerInfo> {
  const firstTrainer = rollStatTrainer();
  const secondTrainer = rollStatTrainer([firstTrainer.trainerType]);
  return {
    0: firstTrainer,
    1: secondTrainer,
  };
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

function setTwoPlayerTrainerDialogue(trainerInfos: Record<PlayerIndex, StatTrainerInfo>): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.dialogue.intro = ([0, 1] as PlayerIndex[]).map(playerIndex => {
    const info = trainerInfos[playerIndex];
    return {
      speaker: `trainerNames:${info.trainerNameKey}`,
      text: `${namespace}:${info.trainerNameKey}.introDialogue`,
    };
  });
  encounter.dialogue.outro = [];
  encounter.setDialogueToken(
    "statTrainerName",
    ([0, 1] as PlayerIndex[]).map(playerIndex => getTrainerDisplayName(trainerInfos[playerIndex])).join(" and "),
  );
}

function buildIntroSpriteConfigs(trainerInfos: StatTrainerInfo[]) {
  return trainerInfos.flatMap((info, index) => {
    const spriteKeys = getSpriteKeysFromSpecies(info.partnerSpecies);
    const trainerSpriteKey = getTrainerConfig(info).getSpriteKey();
    const xOffset = trainerInfos.length > 1 ? (index === 0 ? -34 : 32) : 0;

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

function showATrainersTestPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildATrainersTestPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function getATrainersTestTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

async function hideATrainersTestNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  await Promise.all(
    ([0, 1] as PlayerIndex[])
      .filter(playerIndex => !battlePlayerSet.has(playerIndex))
      .map(
        playerIndex =>
          new Promise<void>(resolve => {
            const trainerSprite = getATrainersTestTrainerSprite(playerIndex);
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

function storeATrainersTestChoice(optionIndex: ATrainersTestOptionIndex, playerIndex: PlayerIndex): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getATrainersTestData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (playerIndex === 0) {
    showATrainersTestPlayerMenu(1, optionIndex - 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function showATrainersTestSelectedDialogue(choice: ATrainersTestChoice): Promise<void> {
  const data = getATrainersTestData();
  const info = data.trainerInfos[choice.playerIndex];

  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  await showEncounterDialogue(
    `${namespace}:${info.trainerNameKey}.${choice.optionIndex === 1 ? "accept" : "decline"}`,
    `trainerNames:${info.trainerNameKey}`,
  );
}

function setATrainersTestBattleRewards(choice: ATrainersTestChoice): void {
  const data = getATrainersTestData();
  const info = data.trainerInfos[choice.playerIndex];
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
  const data = getATrainersTestData();
  const info = data.trainerInfos[choice.playerIndex];
  const eggOptions = createEggOptions(info, EggTier.RARE);

  globalScene.phaseManager.unshiftNew("PartyHealPhase", true, choice.playerIndex);
  setEncounterRewards({ fillRemaining: false, rerollMultiplier: -1 }, [eggOptions], undefined, choice.playerIndex);
}

function createATrainersTestBattleConfig(acceptChoices: ATrainersTestChoice[]): EnemyPartyConfig {
  const data = getATrainersTestData();
  const acceptedInfos = acceptChoices.map(choice => data.trainerInfos[choice.playerIndex]);

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
  };
}

function setATrainersTestRewardMessages(choices: ATrainersTestChoice[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getATrainersTestData();

  encounter.onRewards = async () => {
    for (const choice of choices.toSorted((a, b) => a.playerIndex - b.playerIndex)) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      const info = data.trainerInfos[choice.playerIndex];
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
  const info = getATrainersTestData().trainerInfos[0];
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
  const info = getATrainersTestData().trainerInfos[0];

  globalScene.phaseManager.unshiftNew("PartyHealPhase", true);

  const eggOptions = createEggOptions(info, EggTier.RARE);
  encounter.setDialogueToken("eggType", i18next.t(`${namespace}:eggTypes.rare`));
  setEncounterRewards({ fillRemaining: false, rerollMultiplier: -1 }, [eggOptions]);
  leaveEncounterWithoutBattle();
}

async function runTwoPlayerATrainersTestChoices(): Promise<boolean> {
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
      globalScene.twoPlayerMode ? runTwoPlayerATrainersTestChoices() : runOnePlayerAcceptChallenge(),
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
      globalScene.twoPlayerMode ? runTwoPlayerATrainersTestChoices() : runOnePlayerRefuseChallenge(),
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
    const trainerInfos = rollTrainerInfos();
    const activeTrainerInfo = trainerInfos[0];

    encounter.misc = {
      choices: [],
      trainerInfos,
    } satisfies ATrainersTestData;

    if (globalScene.twoPlayerMode) {
      setTwoPlayerTrainerDialogue(trainerInfos);
      encounter.spriteConfigs = buildIntroSpriteConfigs([trainerInfos[0], trainerInfos[1]]);
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
