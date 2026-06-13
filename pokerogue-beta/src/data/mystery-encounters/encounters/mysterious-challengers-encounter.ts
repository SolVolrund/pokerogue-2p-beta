import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import { initBattleWithEnemyConfig, setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { trainerConfigs } from "#trainers/trainer-config";
import {
  TrainerPartyCompoundTemplate,
  TrainerPartyTemplate,
  trainerPartyTemplates,
} from "#trainers/trainer-party-template";
import { randSeedInt } from "#utils/common";
import type { TrainerConfig } from "#trainers/trainer-config";
import type { TrainerType } from "#enums/trainer-type";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/mysteriousChallengers";

function getRandomTrainerTypeForChallenger(isBoss = false, excludedTrainerTypes: TrainerType[] = []): TrainerType {
  let retries = 0;
  let trainerType = globalScene.arena.randomTrainerType(globalScene.currentBattle.waveIndex, isBoss);

  while (retries < 8 && excludedTrainerTypes.includes(trainerType)) {
    trainerType = globalScene.arena.randomTrainerType(globalScene.currentBattle.waveIndex, isBoss);
    retries++;
  }

  return trainerType;
}

function getTrainerFemale(config: TrainerConfig): boolean {
  return config.hasGenders ? !!randSeedInt(2) : false;
}

function addTwoPlayerPartnerConfig(
  enemyPartyConfig: EnemyPartyConfig,
  isBoss: boolean,
  excludedTrainerTypes: TrainerType[],
  configurePartner?: (config: TrainerConfig, trainerType: TrainerType) => void,
): void {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const partnerTrainerType = getRandomTrainerTypeForChallenger(isBoss, excludedTrainerTypes);
  const partnerConfig = trainerConfigs[partnerTrainerType].clone();
  configurePartner?.(partnerConfig, partnerTrainerType);

  enemyPartyConfig.doubleBattle = true;
  enemyPartyConfig.partnerTrainerConfig = partnerConfig;
  enemyPartyConfig.partnerFemale = getTrainerFemale(partnerConfig);
}

function applyBrutalTemplate(config: TrainerConfig, trainerType: TrainerType): void {
  config.title = trainerConfigs[trainerType].title;
  config.setPartyTemplates(trainerPartyTemplates.ELITE_FOUR);
  // @ts-expect-error
  config.partyTemplateFunc = null; // Overrides gym leader party template func
}

function setChallengerRewards(rewards: Parameters<typeof setEncounterRewards>[0]): void {
  setEncounterRewards(rewards, undefined, undefined, 0);
  if (globalScene.twoPlayerMode) {
    setEncounterRewards(rewards, undefined, undefined, 1);
  }
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
    addTwoPlayerPartnerConfig(normalPartyConfig, false, [normalTrainerType]);
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
    addTwoPlayerPartnerConfig(hardPartyConfig, false, [normalTrainerType, hardTrainerType], partnerConfig =>
      partnerConfig.setPartyTemplates(hardTemplate),
    );
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
    addTwoPlayerPartnerConfig(brutalPartyConfig, true, [brutalTrainerType], applyBrutalTemplate);
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

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.selected`,
        },
      ],
    },
    async () => {
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      // Spawn standard trainer battle with memory mushroom reward
      const config: EnemyPartyConfig = encounter.enemyPartyConfigs[0];

      setChallengerRewards({
        guaranteedModifierTypeFuncs: [modifierTypes.TM_COMMON, modifierTypes.TM_GREAT, modifierTypes.MEMORY_MUSHROOM],
        fillRemaining: true,
      });

      // Seed offsets to remove possibility of different trainers having exact same teams
      let initBattlePromise: Promise<void>;
      globalScene.executeWithSeedOffset(() => {
        initBattlePromise = initBattleWithEnemyConfig(config);
      }, globalScene.currentBattle.waveIndex * 10);
      await initBattlePromise!;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.selected`,
        },
      ],
    },
    async () => {
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      // Spawn hard fight
      const config: EnemyPartyConfig = encounter.enemyPartyConfigs[1];

      setChallengerRewards({
        guaranteedModifierTiers: [ModifierTier.ULTRA, ModifierTier.ULTRA, ModifierTier.GREAT, ModifierTier.GREAT],
        fillRemaining: true,
      });

      // Seed offsets to remove possibility of different trainers having exact same teams
      let initBattlePromise: Promise<void>;
      globalScene.executeWithSeedOffset(() => {
        initBattlePromise = initBattleWithEnemyConfig(config);
      }, globalScene.currentBattle.waveIndex * 100);
      await initBattlePromise!;
    },
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.selected`,
        },
      ],
    },
    async () => {
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      // Spawn brutal fight
      const config: EnemyPartyConfig = encounter.enemyPartyConfigs[2];

      // To avoid player level snowballing from picking this option
      encounter.expMultiplier = 0.9;

      setChallengerRewards({
        guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ROGUE, ModifierTier.ULTRA, ModifierTier.GREAT],
        fillRemaining: true,
      });

      // Seed offsets to remove possibility of different trainers having exact same teams
      let initBattlePromise: Promise<void>;
      globalScene.executeWithSeedOffset(() => {
        initBattlePromise = initBattleWithEnemyConfig(config);
      }, globalScene.currentBattle.waveIndex * 1000);
      await initBattlePromise!;
    },
  )
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
