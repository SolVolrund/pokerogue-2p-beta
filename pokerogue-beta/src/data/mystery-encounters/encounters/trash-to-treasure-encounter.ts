import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { HitHealModifier, PokemonHeldItemModifier, TurnHealModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import {
  type EnemyPartyConfig,
  type EnemyPokemonConfig,
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { applyModifierTypeToPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import { type MysteryEncounter, MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import {
  getComputerPartnerTeamConfidence,
  isComputerPartnerConfidentForDanger,
} from "#utils/computer-partner-team-confidence";
import { randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/trashToTreasure";

const SOUND_EFFECT_WAIT_TIME = 700;

// Items will cost 2.5x as much for remainder of the run
const SHOP_ITEM_COST_MULTIPLIER = 2.5;

type TrashToTreasureOptionIndex = 1 | 2;

interface TrashToTreasureChoice {
  playerIndex: PlayerIndex;
  optionIndex: TrashToTreasureOptionIndex;
}

interface TrashToTreasureData {
  choices: TrashToTreasureChoice[];
  skipSelectedDialogueOnce?: boolean;
}

function getTrashToTreasureData(): TrashToTreasureData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies TrashToTreasureData;
  }

  return encounter.misc as TrashToTreasureData;
}

async function showTrashToTreasurePlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildTrashToTreasurePlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerTrashToTreasureOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeTrashToTreasureChoice(optionIndex as TrashToTreasureOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

function getTrashToTreasureTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return globalScene.getPlayerTrainerBackSprite(playerIndex);
}

async function hideTrashToTreasureNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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
            const trainerSprite = getTrashToTreasureTrainerSprite(playerIndex);
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

function chooseComputerPartnerTrashToTreasureOption(playerIndex: PlayerIndex): TrashToTreasureOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return isComputerPartnerConfidentForDanger(confidence, "high") ? 1 : 2;
}

function queueComputerPartnerTrashToTreasureChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: TrashToTreasureOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function storeTrashToTreasureChoice(
  optionIndex: TrashToTreasureOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getTrashToTreasureData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerTrashToTreasureChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return showTrashToTreasurePlayerMenu(nextPlayerIndex, optionIndex - 1);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function createGarbodorBattleConfig(battlePlayers: PlayerIndex[]): EnemyPartyConfig {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const fieldPosition = battlePlayers.length > 2 ? FieldPosition.CENTER : undefined;
  return {
    ...encounter.enemyPartyConfigs[0],
    doubleBattle: battlePlayers.length > 1,
    pokemonConfigs: encounter.enemyPartyConfigs[0].pokemonConfigs?.map((config, index) =>
      index === 0 && fieldPosition != null ? { ...config, fieldPosition } : config,
    ),
  };
}

function queueGarbodorStartOfBattleEffects(battlePlayers: PlayerIndex[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const garbodorBattlerIndex = BattlerIndex.ENEMY;
  encounter.startOfBattleEffects.push(
    ...battlePlayers.map((_playerIndex, fieldIndex) => ({
      sourceBattlerIndex: garbodorBattlerIndex,
      targets: [globalScene.getPlayerBattlerIndex(fieldIndex)],
      move: new PokemonMove(MoveId.TOXIC),
      useMode: MoveUseMode.IGNORE_PP,
    })),
    ...battlePlayers.map(() => ({
      sourceBattlerIndex: garbodorBattlerIndex,
      targets: [garbodorBattlerIndex],
      move: new PokemonMove(MoveId.STOCKPILE),
      useMode: MoveUseMode.IGNORE_PP,
    })),
  );
}

function setGarbodorBattleRewards(playerIndex: PlayerIndex): void {
  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.LEFTOVERS],
      guaranteedModifierTiers: [ModifierTier.ROGUE, ModifierTier.ULTRA, ModifierTier.GREAT],
      fillRemaining: true,
    },
    undefined,
    undefined,
    playerIndex,
  );
}

async function applyDigOutcome(playerIndex: PlayerIndex): Promise<void> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  await tryApplyDigRewardItems(playerIndex);

  const blackSludge = generateModifierType(modifierTypes.MYSTERY_ENCOUNTER_BLACK_SLUDGE, [
    SHOP_ITEM_COST_MULTIPLIER,
  ]);
  const modifier = blackSludge?.newModifier();
  if (modifier) {
    await globalScene.addModifier(modifier, false, false, false, true, undefined, playerIndex);
    audioManager.playSound("battle_anims/PRSFX- Venom Drench", {
      volume: 2,
    });
    await showEncounterText(
      i18next.t("battle:rewardGain", {
        modifierName: modifier.type.name,
      }),
      null,
      undefined,
      true,
    );
  }
}

async function runOnePlayerInvestigate(): Promise<void> {
  globalScene.setFieldScale(0.75);
  await showEncounterText(`${namespace}:option.1.selected2`);
  await transitionMysteryEncounterIntroVisuals();

  setGarbodorBattleRewards(globalScene.activePlayerIndex);
  queueGarbodorStartOfBattleEffects([globalScene.activePlayerIndex]);
  await initBattleWithEnemyConfig(createGarbodorBattleConfig([globalScene.activePlayerIndex]));
}

async function runOnePlayerDig(): Promise<void> {
  doGarbageDig();
  await transitionMysteryEncounterIntroVisuals();
  await applyDigOutcome(globalScene.activePlayerIndex);
  leaveEncounterWithoutBattle(true);
}

async function runMultiplayerTrashToTreasureChoices(): Promise<boolean> {
  const choices = getTrashToTreasureData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const investigateChoices = choices.filter(choice => choice.optionIndex === 1);
  const digChoices = choices.filter(choice => choice.optionIndex === 2);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
  }

  if (digChoices.length > 0) {
    doGarbageDig();
    for (const choice of digChoices) {
      await applyDigOutcome(choice.playerIndex);
    }
  }

  if (investigateChoices.length === 0) {
    await transitionMysteryEncounterIntroVisuals();
    leaveEncounterWithoutBattle(true);
    return true;
  }

  globalScene.setFieldScale(0.75);
  await showEncounterText(`${namespace}:option.1.selected2`);

  const battlePlayers = investigateChoices.map(choice => choice.playerIndex);
  for (const playerIndex of battlePlayers) {
    setGarbodorBattleRewards(playerIndex);
  }

  globalScene.setActivePlayerIndex(battlePlayers[0]);
  updateWindowType(battlePlayers[0] + 1);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  queueGarbodorStartOfBattleEffects(battlePlayers);
  await transitionMysteryEncounterIntroVisuals();
  await hideTrashToTreasureNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createGarbodorBattleConfig(battlePlayers));
  return true;
}

function buildInvestigateOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeTrashToTreasureChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerTrashToTreasureChoices() : runOnePlayerInvestigate(),
    )
    .build();
}

function buildDigOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeTrashToTreasureChoice(2, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerTrashToTreasureChoices() : runOnePlayerDig(),
    )
    .build();
}

function buildTrashToTreasurePlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildInvestigateOption(playerIndex), buildDigOption(playerIndex)];
}

/**
 * Trash to Treasure encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3809 | GitHub Issue #3809}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TrashToTreasureEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.TRASH_TO_TREASURE,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(100, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withScenePartySizeRequirement(3, 6)
  .withMaxAllowedEncounters(1)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: SpeciesId.GARBODOR.toString() + "-gigantamax",
      fileRoot: "pokemon",
      hasShadow: false,
      disableAnimation: true,
      scale: 1.5,
      y: 8,
      tint: 0.4,
    },
  ])
  .withAutoHideIntroVisuals(false)
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

    // Calculate boss mon (shiny locked)
    const bossSpecies = getPokemonSpecies(SpeciesId.GARBODOR);
    const pokemonConfig: EnemyPokemonConfig = {
      species: bossSpecies,
      isBoss: true,
      shiny: false, // Shiny lock because of custom intro sprite
      formIndex: 1, // Gmax
      bossSegmentModifier: 1, // +1 Segment from normal
      moveSet: [MoveId.GUNK_SHOT, MoveId.STOMPING_TANTRUM, MoveId.HAMMER_ARM, MoveId.PAYBACK],
      modifierConfigs: [
        {
          modifier: generateModifierType(modifierTypes.BERRY) as PokemonHeldItemModifierType,
        },
        {
          modifier: generateModifierType(modifierTypes.BERRY) as PokemonHeldItemModifierType,
        },
        {
          modifier: generateModifierType(modifierTypes.BERRY) as PokemonHeldItemModifierType,
        },
        {
          modifier: generateModifierType(modifierTypes.BERRY) as PokemonHeldItemModifierType,
        },
        {
          modifier: generateModifierType(modifierTypes.BASE_STAT_BOOSTER) as PokemonHeldItemModifierType,
        },
        {
          modifier: generateModifierType(modifierTypes.BASE_STAT_BOOSTER) as PokemonHeldItemModifierType,
        },
        {
          modifier: generateModifierType(modifierTypes.TOXIC_ORB) as PokemonHeldItemModifierType,
          stackCount: randSeedInt(2, 0),
        },
        {
          modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
          stackCount: randSeedInt(2, 1),
        },
        {
          modifier: generateModifierType(modifierTypes.LUCKY_EGG) as PokemonHeldItemModifierType,
          stackCount: randSeedInt(3, 1),
        },
        {
          modifier: generateModifierType(modifierTypes.GOLDEN_EGG) as PokemonHeldItemModifierType,
          stackCount: randSeedInt(2, 0),
        },
      ],
    };
    const config: EnemyPartyConfig = {
      levelAdditiveModifier: 0.5,
      pokemonConfigs: [pokemonConfig],
      disableSwitch: true,
    };
    encounter.enemyPartyConfigs = [config];

    // Load animations/sfx for Garbodor fight start moves
    loadCustomMovesForEncounter([MoveId.TOXIC, MoveId.STOCKPILE]);

    globalScene
      .loadSe("PRSFX- Dig2", "battle_anims", "PRSFX- Dig2.wav")
      .loadSe("PRSFX- Venom Drench", "battle_anims", "PRSFX- Venom Drench.wav");

    encounter.setDialogueToken("costMultiplier", SHOP_ITEM_COST_MULTIPLIER.toString());
    encounter.misc = {
      choices: [],
    } satisfies TrashToTreasureData;

    return true;
  })
  .withOption(buildInvestigateOption(0))
  .withOption(buildDigOption(0))
  .build();

async function tryApplyDigRewardItems(playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
  const shellBell = generateModifierType(modifierTypes.SHELL_BELL) as PokemonHeldItemModifierType;
  const leftovers = generateModifierType(modifierTypes.LEFTOVERS) as PokemonHeldItemModifierType;

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  const party = globalScene.getPlayerParty(playerIndex);

  // Iterate over the party until an item was successfully given
  // Only Leftovers
  for (const pokemon of party) {
    const heldItems = globalScene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id,
      true,
      playerIndex,
    ) as PokemonHeldItemModifier[];
    const existingLeftovers = heldItems.find(m => m instanceof TurnHealModifier) as TurnHealModifier;

    if (!existingLeftovers || existingLeftovers.getStackCount() < existingLeftovers.getMaxStackCount()) {
      await applyModifierTypeToPlayerPokemon(pokemon, leftovers);
      break;
    }
  }

  audioManager.playSound("se/item_fanfare");
  await showEncounterText(
    i18next.t("battle:rewardGainCount", {
      modifierName: leftovers.name,
      count: 1,
    }),
    null,
    undefined,
    true,
  );

  // Only Shell bell
  for (const pokemon of party) {
    const heldItems = globalScene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id,
      true,
      playerIndex,
    ) as PokemonHeldItemModifier[];
    const existingShellBell = heldItems.find(m => m instanceof HitHealModifier) as HitHealModifier;

    if (!existingShellBell || existingShellBell.getStackCount() < existingShellBell.getMaxStackCount()) {
      await applyModifierTypeToPlayerPokemon(pokemon, shellBell);
      break;
    }
  }

  audioManager.playSound("se/item_fanfare");
  await showEncounterText(
    i18next.t("battle:rewardGainCount", {
      modifierName: shellBell.name,
      count: 1,
    }),
    null,
    undefined,
    true,
  );
}

function doGarbageDig() {
  audioManager.playSound("battle_anims/PRSFX- Dig2");
  globalScene.time.delayedCall(SOUND_EFFECT_WAIT_TIME, () => {
    audioManager.playSound("battle_anims/PRSFX- Dig2");
    audioManager.playSound("battle_anims/PRSFX- Venom Drench", { volume: 2 });
  });
  globalScene.time.delayedCall(SOUND_EFFECT_WAIT_TIME * 2, () => {
    audioManager.playSound("battle_anims/PRSFX- Dig2");
  });
}
