import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { getHighestLevelPlayerPokemon, koPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** i18n namespace for encounter */
const namespace = "mysteryEncounters/mysteriousChest";

const RAND_LENGTH = 100;
const TRAP_PERCENT = 30;
const COMMON_REWARDS_PERCENT = 25;
const ULTRA_REWARDS_PERCENT = 30;
const ROGUE_REWARDS_PERCENT = 10;
const MASTER_REWARDS_PERCENT = 5;

function getGimmighoulConfig(count = 1): EnemyPartyConfig {
  return {
    levelAdditiveModifier: 0.5,
    disableSwitch: true,
    doubleBattle: globalScene.twoPlayerMode,
    pokemonConfigs: Array.from({ length: count }, () => ({
      species: getPokemonSpecies(SpeciesId.GIMMIGHOUL),
      formIndex: 0,
      isBoss: true,
      moveSet: [MoveId.NASTY_PLOT, MoveId.SHADOW_BALL, MoveId.POWER_GEM, MoveId.THIEF],
    })),
  };
}

function getChestRewardTiers(roll: number): ModifierTier[] | null {
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT) {
    return [ModifierTier.COMMON, ModifierTier.COMMON, ModifierTier.GREAT, ModifierTier.GREAT];
  }
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT) {
    return [ModifierTier.ULTRA, ModifierTier.ULTRA, ModifierTier.ULTRA];
  }
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT - ROGUE_REWARDS_PERCENT) {
    return [ModifierTier.ROGUE, ModifierTier.ROGUE];
  }
  if (
    roll
    >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT - ROGUE_REWARDS_PERCENT - MASTER_REWARDS_PERCENT
  ) {
    return [ModifierTier.MASTER];
  }

  return null;
}

function getChestRewardMessageKey(roll: number): string {
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT) {
    return `${namespace}:option.1.normal`;
  }
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT) {
    return `${namespace}:option.1.good`;
  }
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT - ROGUE_REWARDS_PERCENT) {
    return `${namespace}:option.1.great`;
  }

  return `${namespace}:option.1.amazing`;
}

function promptPlayerToOpenChest(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const playerLabel = `Player ${playerIndex + 1}`;
  const allowedPokemon = globalScene.getPokemonAllowedInBattle(playerIndex);
  if (allowedPokemon.length <= 1) {
    return showEncounterText(`${playerLabel} does not have enough healthy Pokemon to risk opening the chest.`).then(
      () => false,
    );
  }

  return new Promise(resolve => {
    globalScene.ui.showText(`${playerLabel}: Open the mysterious chest?`, null, () => {
      globalScene.ui.setMode(
        UiMode.CONFIRM,
        () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          resolve(true);
        },
        () => {
          globalScene.ui.setMode(UiMode.MESSAGE);
          resolve(false);
        },
      );
    });
  });
}

function queueImmediateChestReward(rewardTiers: ModifierTier[], playerIndex: PlayerIndex, messageKey: string): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  queueEncounterMessage(messageKey);
  globalScene.phaseManager.unshiftNew(
    "SelectModifierPhase",
    0,
    undefined,
    {
      guaranteedModifierTiers: rewardTiers,
    },
    false,
    playerIndex,
  );
}

/**
 * Mysterious Chest encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3796 | GitHub Issue #3796}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const MysteriousChestEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.MYSTERIOUS_CHEST,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withScenePartySizeRequirement(2, 6, true)
  .withAutoHideIntroVisuals(false)
  .withCatchAllowed(true)
  .withIntroSpriteConfigs([
    {
      spriteKey: "mysterious_chest_blue",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      y: 8,
      yShadow: 6,
      alpha: 1,
      disableAnimation: true, // Re-enabled after option select
    },
    {
      spriteKey: "mysterious_chest_red",
      fileRoot: "mystery-encounters",
      hasShadow: false,
      y: 8,
      yShadow: 6,
      alpha: 0,
      disableAnimation: true, // Re-enabled after option select
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
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    encounter.enemyPartyConfigs = [getGimmighoulConfig()];

    encounter.setDialogueToken("gimmighoulName", getPokemonSpecies(SpeciesId.GIMMIGHOUL).getName());
    encounter.setDialogueToken("trapPercent", TRAP_PERCENT.toString());
    encounter.setDialogueToken("commonPercent", COMMON_REWARDS_PERCENT.toString());
    encounter.setDialogueToken("ultraPercent", ULTRA_REWARDS_PERCENT.toString());
    encounter.setDialogueToken("roguePercent", ROGUE_REWARDS_PERCENT.toString());
    encounter.setDialogueToken("masterPercent", MASTER_REWARDS_PERCENT.toString());

    return true;
  })
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      })
      .withPreOptionPhase(async () => {
        // Play animation
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const introVisuals = encounter.introVisuals!;

        if (globalScene.twoPlayerMode) {
          encounter.misc = {};
          introVisuals.spriteConfigs[0].disableAnimation = false;
          introVisuals.spriteConfigs[1].disableAnimation = false;
          introVisuals.playAnim();
          return;
        }

        // Determine roll first
        const roll = randSeedInt(RAND_LENGTH);
        encounter.misc = {
          roll,
        };

        if (roll < TRAP_PERCENT) {
          // Chest is springing trap, change to red chest sprite
          const blueChestSprites = introVisuals.getSpriteAtIndex(0);
          const redChestSprites = introVisuals.getSpriteAtIndex(1);
          redChestSprites[0].setAlpha(1);
          blueChestSprites[0].setAlpha(0.001);
        }
        introVisuals.spriteConfigs[0].disableAnimation = false;
        introVisuals.spriteConfigs[1].disableAnimation = false;
        introVisuals.playAnim();
      })
      .withOptionPhase(async () => {
        // Open the chest
        const encounter = globalScene.currentBattle.mysteryEncounter!;

        if (!globalScene.twoPlayerMode) {
          const roll = encounter.misc.roll;
          const rewardTiers = getChestRewardTiers(roll);
          if (rewardTiers) {
            setEncounterRewards({
              guaranteedModifierTiers: rewardTiers,
            });
            queueEncounterMessage(getChestRewardMessageKey(roll));
            leaveEncounterWithoutBattle();
          } else {
            const highestLevelPokemon = getHighestLevelPlayerPokemon(true, false);
            koPlayerPokemon(highestLevelPokemon);

            encounter.setDialogueToken("pokeName", highestLevelPokemon.getNameToRender());
            await showEncounterText(`${namespace}:option.1.bad`);

            const allowedPokemon = globalScene.getPokemonAllowedInBattle();
            if (allowedPokemon.length === 0) {
              globalScene.phaseManager.clearPhaseQueue();
              globalScene.phaseManager.unshiftNew("GameOverPhase");
            } else {
              await transitionMysteryEncounterIntroVisuals(true, true, 500);
              setEncounterRewards({ fillRemaining: true });
              await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
            }
          }
          return;
        }

        const openingPlayers: PlayerIndex[] = [];
        for (const playerIndex of [0, 1] as PlayerIndex[]) {
          if (await promptPlayerToOpenChest(playerIndex)) {
            openingPlayers.push(playerIndex);
          }
        }

        if (openingPlayers.length === 0) {
          leaveEncounterWithoutBattle(true);
          return;
        }

        const trappedPlayers: PlayerIndex[] = [];
        const treasureRewards: { playerIndex: PlayerIndex; rewardTiers: ModifierTier[]; messageKey: string }[] = [];
        for (const playerIndex of openingPlayers) {
          globalScene.setActivePlayerIndex(playerIndex);
          updateWindowType(playerIndex + 1);

          const roll = randSeedInt(RAND_LENGTH);
          const rewardTiers = getChestRewardTiers(roll);
          if (rewardTiers) {
            treasureRewards.push({
              playerIndex,
              rewardTiers,
              messageKey: getChestRewardMessageKey(roll),
            });
            continue;
          }

          const highestLevelPokemon = getHighestLevelPlayerPokemon(true, false, playerIndex);
          koPlayerPokemon(highestLevelPokemon);
          trappedPlayers.push(playerIndex);

          encounter.setDialogueToken("pokeName", highestLevelPokemon.getNameToRender());
          await showEncounterText(`${namespace}:option.1.bad`);
          setEncounterRewards({ fillRemaining: true }, undefined, undefined, playerIndex);
        }

        if (trappedPlayers.length === 0) {
          for (const treasureReward of treasureRewards) {
            setEncounterRewards(
              {
                guaranteedModifierTiers: treasureReward.rewardTiers,
              },
              undefined,
              undefined,
              treasureReward.playerIndex,
            );
            queueEncounterMessage(treasureReward.messageKey);
          }
          leaveEncounterWithoutBattle();
          return;
        }

        for (const treasureReward of treasureRewards) {
          queueImmediateChestReward(
            treasureReward.rewardTiers,
            treasureReward.playerIndex,
            treasureReward.messageKey,
          );
        }
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        await initBattleWithEnemyConfig(getGimmighoulConfig(trappedPlayers.length));
      })
      .build(),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
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
