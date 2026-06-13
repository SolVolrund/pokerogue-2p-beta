import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Pokemon } from "#field/pokemon";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { getPlayerModifierTypeOptions, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  getRandomEncounterPokemon,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterExp,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getEncounterPokemonLevelForWave,
  getSpriteKeysFromPokemon,
  STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { STEALING_MOVES } from "#mystery-encounters/requirement-groups";
import { PokemonData } from "#system/pokemon-data";
import { randSeedInt } from "#utils/common";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/fightOrFlight";

type FightOrFlightReward = {
  playerIndex: PlayerIndex;
  item: ModifierTypeOption;
};

type FightOrFlightData = {
  rewards: FightOrFlightReward[];
  bossConfigs: EnemyPokemonConfig[];
};

function getFightOrFlightRewardTier(): ModifierTier {
  return globalScene.currentBattle.waveIndex > 160
    ? ModifierTier.MASTER
    : globalScene.currentBattle.waveIndex > 120
      ? ModifierTier.ROGUE
      : globalScene.currentBattle.waveIndex > 40
        ? ModifierTier.ULTRA
        : ModifierTier.GREAT;
}

function getFightOrFlightReward(playerIndex: PlayerIndex, tier: ModifierTier): FightOrFlightReward {
  const previousPlayerIndex = globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);

  const party = globalScene.getPlayerParty(playerIndex);
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  let item: ModifierTypeOption | null = null;
  // TMs and Candy Jar excluded from possible rewards as they're too swingy in value for a singular item reward
  while (!item || item.type.id.includes("TM_") || item.type.id === "CANDY_JAR") {
    item = getPlayerModifierTypeOptions(1, party, [], {
      guaranteedModifierTiers: [tier],
      allowLuckUpgrades: false,
    })[0];
  }

  globalScene.setActivePlayerIndex(previousPlayerIndex);
  return { playerIndex, item };
}

function getFightOrFlightBossConfig(level: number): { pokemonConfig: EnemyPokemonConfig; pokemon: Pokemon } {
  const bossPokemon = getRandomEncounterPokemon({
    level,
    isBoss: true,
    eventShinyRerolls: 2,
    eventHiddenRerolls: 1,
  });

  return {
    pokemon: bossPokemon,
    pokemonConfig: {
      level,
      species: bossPokemon.species,
      dataSource: new PokemonData(bossPokemon),
      isBoss: true,
      tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
      mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
        globalScene.currentBattle.mysteryEncounter?.setDialogueToken("enemyPokemon", pokemon.getNameToRender());
        queueEncounterMessage(`${namespace}:option.1.statBoost`);
        // Randomly boost 1 stat 2 stages. Cannot boost Spd, Acc, or Evasion.
        globalScene.phaseManager.unshiftNew(
          "StatStageChangePhase",
          pokemon.getBattlerIndex(),
          true,
          [randSeedInt(4, 1)],
          2,
        );
      },
    },
  };
}

function setFightOrFlightRewards(data: FightOrFlightData): void {
  for (const reward of data.rewards) {
    setEncounterRewards(
      {
        guaranteedModifierTypeOptions: [reward.item],
        fillRemaining: false,
      },
      undefined,
      undefined,
      reward.playerIndex,
    );
  }
}

/**
 * Fight or Flight encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3795 | GitHub Issue #3795}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const FightOrFlightEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.FIGHT_OR_FLIGHT,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([]) // Set in onInit()
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    const level = getEncounterPokemonLevelForWave(STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER);
    const bossCount = globalScene.twoPlayerMode ? 2 : 1;
    const bosses = Array.from({ length: bossCount }, () => getFightOrFlightBossConfig(level));
    const config: EnemyPartyConfig = {
      doubleBattle: globalScene.twoPlayerMode,
      pokemonConfigs: bosses.map(boss => boss.pokemonConfig),
    };
    encounter.enemyPartyConfigs = [config];

    // Waves 10-40 GREAT, 60-120 ULTRA, 120-160 ROGUE, 160-180 MASTER
    const tier = getFightOrFlightRewardTier();
    const rewardPlayers = (globalScene.twoPlayerMode ? [0, 1] : [globalScene.activePlayerIndex]) as PlayerIndex[];
    const rewards = rewardPlayers.map(playerIndex => getFightOrFlightReward(playerIndex, tier));
    encounter.setDialogueToken("enemyPokemon", bosses.map(boss => boss.pokemon.getNameToRender()).join(" and "));
    encounter.setDialogueToken("itemName", rewards.map(reward => reward.item.type.name).join(" and "));
    encounter.misc = {
      rewards,
      bossConfigs: bosses.map(boss => boss.pokemonConfig),
    } satisfies FightOrFlightData;

    const itemSprites = rewards.map((reward, index) => ({
      spriteKey: reward.item.type.iconImage,
      fileRoot: "items",
      hasShadow: false,
      x: globalScene.twoPlayerMode ? 25 + index * 20 : 35,
      y: -5,
      scale: 0.75,
      isItem: true,
      disableAnimation: true,
    }));
    const pokemonSprites = bosses.map((boss, index) => {
      const { spriteKey, fileRoot } = getSpriteKeysFromPokemon(boss.pokemon);
      return {
        spriteKey,
        fileRoot,
        hasShadow: true,
        tint: 0.25,
        x: globalScene.twoPlayerMode ? -20 + index * 30 : -5,
        repeat: true,
        isPokemon: true,
        isShiny: boss.pokemon.shiny,
        variant: boss.pokemon.variant,
      };
    });
    encounter.spriteConfigs = [...itemSprites, ...pokemonSprites];

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
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => {
      // Pick battle
      // Pokemon will randomly boost 1 stat by 2 stages
      const data = globalScene.currentBattle.mysteryEncounter!.misc as FightOrFlightData;
      setFightOrFlightRewards(data);
      await initBattleWithEnemyConfig(globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0]);
    },
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      .withPrimaryPokemonRequirement(new MoveRequirement(STEALING_MOVES, true)) // Will set option2PrimaryName and option2PrimaryMove dialogue tokens automatically
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        disabledButtonTooltip: `${namespace}:option.2.disabledTooltip`,
        selected: [
          {
            text: `${namespace}:option.2.selected`,
          },
        ],
      })
      .withOptionPhase(async () => {
        // Pick steal
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const data = encounter.misc as FightOrFlightData;
        setFightOrFlightRewards(data);

        // Use primaryPokemon to execute the thievery
        const primaryPokemon = encounter.options[1].primaryPokemon!;
        const playerIndex = globalScene.getPlayerIndexForPokemon(primaryPokemon) ?? globalScene.activePlayerIndex;
        const baseExp = data.bossConfigs.reduce((total, bossConfig) => total + bossConfig.species.baseExp, 0);
        setEncounterExp(primaryPokemon.id, baseExp, true, playerIndex);
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    },
    async () => {
      // Leave encounter with no rewards or exp
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();
