import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
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
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { OptionSelectConfig } from "#ui/abstract-option-select-ui-handler";
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
const MIN_HEALTHY_POKEMON_FOR_ONE_CHEST = 2;
const MIN_HEALTHY_POKEMON_FOR_TWO_CHESTS = 3;

class PlayerHealthyPokemonRequirement extends EncounterSceneRequirement {
  constructor(
    private readonly playerIndex: PlayerIndex,
    private readonly minHealthyPokemon: number,
  ) {
    super();
  }

  override meetsRequirement(): boolean {
    return globalScene.getPokemonAllowedInBattle(this.playerIndex).length >= this.minHealthyPokemon;
  }

  override getDialogueToken(): [string, string] {
    return ["minHealthyPokemon", this.minHealthyPokemon.toString()];
  }
}

class MysteriousChestSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return globalScene.getPokemonAllowedInBattle().length >= MIN_HEALTHY_POKEMON_FOR_ONE_CHEST;
    }

    return ([0, 1] as PlayerIndex[]).some(
      playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length >= MIN_HEALTHY_POKEMON_FOR_ONE_CHEST,
    );
  }

  override getDialogueToken(): [string, string] {
    return ["minHealthyPokemon", MIN_HEALTHY_POKEMON_FOR_ONE_CHEST.toString()];
  }
}

interface MysteriousChestChoice {
  playerIndex: PlayerIndex;
  openChest: boolean;
}

interface MysteriousChestData {
  choices: MysteriousChestChoice[];
  skipSelectedDialogueOnce?: boolean;
}

interface MysteriousChestOutcome {
  playerIndex: PlayerIndex;
  roll: number;
  rewardTiers: ModifierTier[] | null;
  messageKey: string;
  extraChest: boolean;
}

function getGimmighoulConfig(count = 1): EnemyPartyConfig {
  return {
    levelAdditiveModifier: 0.5,
    disableSwitch: true,
    doubleBattle: count > 1,
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

function getChestRewardMessageKey(roll: number, extraChest = false): string {
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT) {
    return `${namespace}:option.1.${extraChest ? "otherNormal" : "normal"}`;
  }
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT) {
    return `${namespace}:option.1.${extraChest ? "otherGood" : "good"}`;
  }
  if (roll >= RAND_LENGTH - COMMON_REWARDS_PERCENT - ULTRA_REWARDS_PERCENT - ROGUE_REWARDS_PERCENT) {
    return `${namespace}:option.1.${extraChest ? "otherGreat" : "great"}`;
  }

  return `${namespace}:option.1.${extraChest ? "otherAmazing" : "amazing"}`;
}

function getMysteriousChestData(): MysteriousChestData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies MysteriousChestData;
  }

  return encounter.misc as MysteriousChestData;
}

async function storeMysteriousChestChoice(openChest: boolean, playerIndex: PlayerIndex = 0): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  let canOpenChest = openChest;
  if (openChest && globalScene.getPokemonAllowedInBattle(playerIndex).length < MIN_HEALTHY_POKEMON_FOR_ONE_CHEST) {
    canOpenChest = false;
  }

  const data = getMysteriousChestData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, openChest: canOpenChest });

  if (!canOpenChest) {
    hideMysteriousChestTrainer(playerIndex);
  }

  if (playerIndex === 0) {
    showMysteriousChestPlayerMenu(1, canOpenChest ? 0 : 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function showMysteriousChestPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: "Will you open it?",
      overrideOptions: buildMysteriousChestPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function buildMysteriousChestPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildMysteriousChestOpenOption(playerIndex), buildMysteriousChestLeaveOption(playerIndex)];
}

function buildMysteriousChestOpenOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new PlayerHealthyPokemonRequirement(playerIndex, MIN_HEALTHY_POKEMON_FOR_ONE_CHEST))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      disabledButtonLabel: `${namespace}:option.1.labelDisabled`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      disabledButtonTooltip: `${namespace}:option.1.tooltipDisabled`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () =>
      globalScene.twoPlayerMode ? storeMysteriousChestChoice(true, playerIndex) : runOnePlayerChestOpenPreOption(),
    )
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerMysteriousChestChoices() : runOnePlayerChestOpen(),
    )
    .build();
}

function buildMysteriousChestLeaveOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeMysteriousChestChoice(false, playerIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerMysteriousChestChoices();
      }

      leaveEncounterWithoutBattle(true);
      return true;
    })
    .build();
}

function playChestOpenAnimation(hasTrap = false): void {
  const introVisuals = globalScene.currentBattle.mysteryEncounter!.introVisuals!;
  const blueChestSprites = introVisuals.getSpriteAtIndex(0);
  const redChestSprites = introVisuals.getSpriteAtIndex(1);
  blueChestSprites[0].setAlpha(hasTrap ? 0.001 : 1);
  redChestSprites[0].setAlpha(hasTrap ? 1 : 0);
  introVisuals.spriteConfigs[0].disableAnimation = false;
  introVisuals.spriteConfigs[1].disableAnimation = false;
  introVisuals.playAnim();
}

async function promptSingleOpenerForSecondChest(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  await showEncounterText(`${namespace}:option.1.openBothPrompt`);
  const canOpenBothChests =
    globalScene.getPokemonAllowedInBattle(playerIndex).length >= MIN_HEALTHY_POKEMON_FOR_TWO_CHESTS;

  return new Promise(resolve => {
    const config: OptionSelectConfig = {
      options: [
        {
          label: canOpenBothChests ? "Open both chests!" : "You dont feel too confident, so...",
          disabled: !canOpenBothChests,
          style: canOpenBothChests ? TextStyle.WINDOW : TextStyle.SUMMARY_GRAY,
          handler: () => {
            if (!canOpenBothChests) {
              return false;
            }
            globalScene.ui.setMode(UiMode.MESSAGE);
            resolve(true);
            return true;
          },
        },
        {
          label: "Just open one chest",
          handler: () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            resolve(false);
            return true;
          },
        },
      ],
      noCancel: true,
      supportHover: true,
    };

    globalScene.ui.setMode(UiMode.OPTION_SELECT, config);
  });
}

function getMysteriousChestTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

function setMysteriousChestTrainerVisible(playerIndex: PlayerIndex): void {
  const trainerSprite = getMysteriousChestTrainerSprite(playerIndex);
  globalScene.tweens.killTweensOf(trainerSprite);
  trainerSprite
    .setVisible(true)
    .setTexture(globalScene.getTrainerBackTextureKey(playerIndex))
    .setFrame(0)
    .setPosition(playerIndex === 1 ? 122 : 90, 186);
}

function showTwoPlayerMysteriousChestTrainers(): void {
  setMysteriousChestTrainerVisible(0);
  setMysteriousChestTrainerVisible(1);
}

function hideMysteriousChestTrainer(playerIndex: PlayerIndex, animate = true): void {
  const trainerSprite = getMysteriousChestTrainerSprite(playerIndex);
  globalScene.tweens.killTweensOf(trainerSprite);
  if (!trainerSprite.visible) {
    return;
  }

  if (!animate) {
    trainerSprite.setVisible(false);
    return;
  }

  globalScene.tweens.add({
    targets: trainerSprite,
    x: -36,
    duration: 500,
    onComplete: () => trainerSprite.setVisible(false),
  });
}

function prepareMysteriousChestBattleTrainers(playerIndexes: PlayerIndex[]): void {
  const battlePlayerIndexes = new Set(playerIndexes);
  ([0, 1] as PlayerIndex[]).forEach(playerIndex => {
    if (battlePlayerIndexes.has(playerIndex)) {
      setMysteriousChestTrainerVisible(playerIndex);
      getMysteriousChestTrainerSprite(playerIndex).setVisible(false);
    } else {
      hideMysteriousChestTrainer(playerIndex, false);
    }
  });
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
  .withSceneRequirement(new MysteriousChestSpawnRequirement())
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
    if (globalScene.twoPlayerMode) {
      encounter.misc = {
        ...(encounter.misc ?? {}),
        choices: [],
      } satisfies MysteriousChestData;
    }

    encounter.setDialogueToken("gimmighoulName", getPokemonSpecies(SpeciesId.GIMMIGHOUL).getName());
    encounter.setDialogueToken("trapPercent", TRAP_PERCENT.toString());
    encounter.setDialogueToken("commonPercent", COMMON_REWARDS_PERCENT.toString());
    encounter.setDialogueToken("ultraPercent", ULTRA_REWARDS_PERCENT.toString());
    encounter.setDialogueToken("roguePercent", ROGUE_REWARDS_PERCENT.toString());
    encounter.setDialogueToken("masterPercent", MASTER_REWARDS_PERCENT.toString());

    return true;
  })
  .withOnVisualsStart(() => {
    if (globalScene.twoPlayerMode) {
      showTwoPlayerMysteriousChestTrainers();
    }

    return true;
  })
  .withOption(buildMysteriousChestOpenOption(0))
  .withOption(buildMysteriousChestLeaveOption(0))
  .build();

async function runOnePlayerChestOpenPreOption(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const roll = randSeedInt(RAND_LENGTH);
  encounter.misc = { roll };
  playChestOpenAnimation(roll < TRAP_PERCENT);
}

async function runOnePlayerChestOpen(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const roll = encounter.misc.roll;
  const rewardTiers = getChestRewardTiers(roll);
  if (rewardTiers) {
    setEncounterRewards({
      guaranteedModifierTiers: rewardTiers,
    });
    queueEncounterMessage(getChestRewardMessageKey(roll));
    leaveEncounterWithoutBattle();
    return;
  }

  const highestLevelPokemon = getHighestLevelPlayerPokemon(true, false);
  koPlayerPokemon(highestLevelPokemon);

  encounter.setDialogueToken("pokeName", highestLevelPokemon.getNameToRender());
  await showEncounterText(`${namespace}:option.1.bad`);

  const allowedPokemon = globalScene.getPokemonAllowedInBattle();
  if (allowedPokemon.length === 0) {
    globalScene.phaseManager.clearPhaseQueue();
    globalScene.phaseManager.unshiftNew("GameOverPhase");
    return;
  }

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  setEncounterRewards({ fillRemaining: true });
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

async function runTwoPlayerMysteriousChestChoices(): Promise<boolean> {
  const data = getMysteriousChestData();
  const openingPlayers = data.choices
    .filter(choice => choice.openChest)
    .map(choice => choice.playerIndex)
    .toSorted();

  if (openingPlayers.length === 0) {
    await showEncounterText(`${namespace}:option.2.selected`);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  let rollRequests = openingPlayers.map(playerIndex => ({
    playerIndex,
    extraChest: false,
  }));
  if (openingPlayers.length === 1 && await promptSingleOpenerForSecondChest(openingPlayers[0])) {
    rollRequests = [
      {
        playerIndex: openingPlayers[0],
        extraChest: false,
      },
      {
        playerIndex: openingPlayers[0],
        extraChest: true,
      },
    ];
  }

  const outcomes: MysteriousChestOutcome[] = rollRequests.map(({ playerIndex, extraChest }) => {
    const roll = randSeedInt(RAND_LENGTH);
    return {
      playerIndex,
      roll,
      rewardTiers: getChestRewardTiers(roll),
      messageKey: getChestRewardMessageKey(roll, extraChest),
      extraChest,
    };
  });
  const trappedPlayers = outcomes
    .filter(outcome => !outcome.rewardTiers)
    .map(outcome => outcome.playerIndex);
  const treasureRewards = outcomes.filter(
    (outcome): outcome is MysteriousChestOutcome & { rewardTiers: ModifierTier[] } => !!outcome.rewardTiers,
  );

  playChestOpenAnimation(trappedPlayers.length > 0);
  await showEncounterText(`${namespace}:option.1.${outcomes.length > 1 ? "selectedPlural" : "selected"}`);

  for (const outcome of outcomes) {
    globalScene.setActivePlayerIndex(outcome.playerIndex);
    updateWindowType(outcome.playerIndex + 1);

    if (outcome.rewardTiers) {
      await showEncounterText(outcome.messageKey);
      continue;
    }

    const highestLevelPokemon = getHighestLevelPlayerPokemon(true, false, outcome.playerIndex);
    koPlayerPokemon(highestLevelPokemon);

    globalScene.currentBattle.mysteryEncounter!.setDialogueToken("pokeName", highestLevelPokemon.getNameToRender());
    await showEncounterText(`${namespace}:option.1.${outcome.extraChest ? "badOther" : "bad"}`);
    setEncounterRewards({ fillRemaining: true }, undefined, undefined, outcome.playerIndex);
  }

  const fightingPlayers = [...new Set(trappedPlayers)] as PlayerIndex[];
  if (fightingPlayers.some(playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length === 0)) {
    globalScene.phaseManager.clearPhaseQueue();
    globalScene.phaseManager.unshiftNew("GameOverPhase");
    return true;
  }

  for (const playerIndex of fightingPlayers) {
    globalScene.setActivePlayerIndex(playerIndex);
    updateWindowType(playerIndex + 1);
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
    }
    leaveEncounterWithoutBattle();
    return true;
  }

  for (const treasureReward of treasureRewards) {
    setEncounterRewards(
      {
        guaranteedModifierTiers: treasureReward.rewardTiers,
      },
      undefined,
      undefined,
      treasureReward.playerIndex,
    );
  }

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(trappedPlayers);
  prepareMysteriousChestBattleTrainers(fightingPlayers);
  await initBattleWithEnemyConfig(getGimmighoulConfig(trappedPlayers.length));
  return true;
}
