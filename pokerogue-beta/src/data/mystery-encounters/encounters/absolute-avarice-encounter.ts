import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { Gender } from "#data/gender";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { EnemyPokemon } from "#field/pokemon";
import { BerryModifier, PokemonInstantReviveModifier } from "#modifiers/modifier";
import type { BerryModifierType, PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  applyModifierTypeToPlayerPokemon,
  catchPokemon,
  getHighestLevelPlayerPokemon,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PersistentModifierRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import { updateWindowType } from "#ui/ui-theme";
import { randInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/absoluteAvarice";

type AbsoluteAvariceOptionIndex = 1 | 2 | 3;

interface AbsoluteAvariceChoice {
  playerIndex: PlayerIndex;
  optionIndex: AbsoluteAvariceOptionIndex;
}

interface AbsoluteAvariceData {
  choices: AbsoluteAvariceChoice[];
  berryItemsByPlayer: Record<PlayerIndex, Map<number, BerryModifier[]>>;
  berryItemsMap: Map<number, BerryModifier[]>;
  skipSelectedDialogueOnce?: boolean;
}

class TwoPlayerAnyPlayerBerryRequirement extends PersistentModifierRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return super.meetsRequirement();
    }

    return ([0, 1] as PlayerIndex[]).some(playerIndex => getPlayerBerryCount(playerIndex) >= this.minNumberOfItems);
  }
}

function getAbsoluteAvariceData(): AbsoluteAvariceData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      berryItemsByPlayer: buildBerryItemsByPlayer(),
      berryItemsMap: buildBerryItemsMap(0),
    } satisfies AbsoluteAvariceData;
  }

  return encounter.misc as AbsoluteAvariceData;
}

function getAvaricePlayerIndexes(): PlayerIndex[] {
  return globalScene.twoPlayerMode ? ([0, 1] as PlayerIndex[]) : [globalScene.activePlayerIndex];
}

function getPlayerBerryItems(playerIndex: PlayerIndex): BerryModifier[] {
  return globalScene.findModifiersForPlayer(m => m instanceof BerryModifier, playerIndex) as BerryModifier[];
}

function getPlayerBerryCount(playerIndex: PlayerIndex): number {
  return getPlayerBerryItems(playerIndex).reduce((total, berryMod) => total + berryMod.stackCount, 0);
}

function buildBerryItemsMap(playerIndex: PlayerIndex): Map<number, BerryModifier[]> {
  const berryItems = getPlayerBerryItems(playerIndex);
  const berryItemsMap = new Map<number, BerryModifier[]>();
  globalScene.getPlayerParty(playerIndex).forEach(pokemon => {
    const pokemonBerries = berryItems.filter(b => b.pokemonId === pokemon.id);
    if (pokemonBerries.length > 0) {
      berryItemsMap.set(pokemon.id, pokemonBerries);
    }
  });
  return berryItemsMap;
}

function buildBerryItemsByPlayer(): Record<PlayerIndex, Map<number, BerryModifier[]>> {
  return {
    0: buildBerryItemsMap(0),
    1: buildBerryItemsMap(1),
  };
}

function seedAbsoluteAvariceTestBerries(): void {
  if (!globalScene.twoPlayerMode || globalScene.currentBattle.waveIndex > 2) {
    return;
  }

  const berryTypes = [BerryType.SITRUS, BerryType.LUM, BerryType.ENIGMA, BerryType.LIECHI, BerryType.GANLON, BerryType.PETAYA];
  for (const playerIndex of [0, 1] as PlayerIndex[]) {
    const party = globalScene.getPlayerParty(playerIndex);
    if (party.length === 0 || getPlayerBerryCount(playerIndex) >= 6) {
      continue;
    }

    globalScene.setActivePlayerIndex(playerIndex);
    for (const [index, berryType] of berryTypes.entries()) {
      const target = party[index % party.length];
      const berryModType = generateModifierType(modifierTypes.BERRY, [berryType]) as BerryModifierType;
      void applyModifierTypeToPlayerPokemon(target, berryModType);
    }
    globalScene.updateModifiers(true, undefined, playerIndex);
  }

  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
}

function getBossModifierConfigs(playerIndex: PlayerIndex): HeldModifierConfig[] {
  const bossModifierConfigs: HeldModifierConfig[] = [];
  getPlayerBerryItems(playerIndex).forEach(berryMod => {
    // Can't define stack count on a ModifierType, so create separate instances for each stack.
    for (let i = 0; i < berryMod.stackCount; i++) {
      const modifierType = generateModifierType(modifierTypes.BERRY, [
        berryMod.berryType,
      ]) as PokemonHeldItemModifierType;
      bossModifierConfigs.push({ modifier: modifierType });
    }
  });
  return bossModifierConfigs;
}

function getGreedentPokemonConfig(playerIndex: PlayerIndex, gender: Gender): EnemyPokemonConfig {
  const statChangesForBattle: (Stat.ATK | Stat.DEF | Stat.SPATK | Stat.SPDEF | Stat.SPD | Stat.ACC | Stat.EVA)[] =
    globalScene.currentBattle.waveIndex < 50 ? [Stat.SPDEF] : [Stat.SPDEF, Stat.SPD];

  return {
    species: getPokemonSpecies(SpeciesId.GREEDENT),
    isBoss: true,
    bossSegments: 3,
    shiny: false, // Shiny lock because of consistency issues between the different options
    gender,
    moveSet: [MoveId.THRASH, MoveId.CRUNCH, MoveId.BODY_PRESS, MoveId.SLACK_OFF],
    modifierConfigs: getBossModifierConfigs(playerIndex),
    tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
    mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
      queueEncounterMessage(`${namespace}:option.1.bossEnraged`);
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        statChangesForBattle,
        1,
      );
    },
  };
}

function createGreedentEnemyPartyConfig(playerIndexes: PlayerIndex[]): EnemyPartyConfig {
  return {
    levelAdditiveModifier: 1,
    doubleBattle: playerIndexes.length > 1,
    disableSwitch: true,
    pokemonConfigs: playerIndexes.map((playerIndex, index) =>
      getGreedentPokemonConfig(playerIndex, index === 0 ? Gender.MALE : Gender.FEMALE),
    ),
  };
}

function queueGreedentStartOfBattleEffects(greedentCount: 1 | 2): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.startOfBattleEffects.push({
    sourceBattlerIndex: BattlerIndex.ENEMY,
    targets: [BattlerIndex.ENEMY],
    move: new PokemonMove(MoveId.STUFF_CHEEKS),
    useMode: MoveUseMode.IGNORE_PP,
  });

  if (greedentCount > 1) {
    encounter.startOfBattleEffects.push({
      sourceBattlerIndex: BattlerIndex.ENEMY_2,
      targets: [BattlerIndex.ENEMY_2],
      move: new PokemonMove(MoveId.STUFF_CHEEKS),
      useMode: MoveUseMode.IGNORE_PP,
    });
  }
}

function getAbsoluteAvariceTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

async function hideAbsoluteAvariceNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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
            const trainerSprite = getAbsoluteAvariceTrainerSprite(playerIndex);
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

function showAbsoluteAvaricePlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildAbsoluteAvaricePlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function storeAbsoluteAvariceChoice(optionIndex: AbsoluteAvariceOptionIndex, playerIndex: PlayerIndex): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getAbsoluteAvariceData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (playerIndex === 0) {
    showAbsoluteAvaricePlayerMenu(1, optionIndex - 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function returnSomeBerries(playerIndex: PlayerIndex): void {
  const data = getAbsoluteAvariceData();
  const berryMap = data.berryItemsByPlayer[playerIndex] ?? data.berryItemsMap;

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  globalScene.getPlayerParty(playerIndex).forEach(pokemon => {
    const stolenBerries: BerryModifier[] = berryMap.get(pokemon.id) ?? [];
    const berryTypesAsArray: BerryType[] = [];
    stolenBerries.forEach(bMod => berryTypesAsArray.push(...new Array(bMod.stackCount).fill(bMod.berryType)));
    const returnedBerryCount = Math.floor((berryTypesAsArray.length * 2) / 5);

    if (returnedBerryCount > 0) {
      for (let i = 0; i < returnedBerryCount; i++) {
        Phaser.Math.RND.shuffle(berryTypesAsArray);
        const randBerryType = berryTypesAsArray.pop();
        const berryModType = generateModifierType(modifierTypes.BERRY, [randBerryType]) as BerryModifierType;
        applyModifierTypeToPlayerPokemon(pokemon, berryModType);
      }
    }
  });
}

function givePartyPokemonReviverSeeds(playerIndex: PlayerIndex): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const revSeed = generateModifierType(modifierTypes.REVIVER_SEED);
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
    "foodReward",
    revSeed?.name ?? i18next.t("modifierType:ModifierType.REVIVER_SEED.name"),
  );
  globalScene.getPlayerParty(playerIndex).forEach(p => {
    const heldItems = p.getHeldItems();
    if (revSeed && !heldItems.some(item => item instanceof PokemonInstantReviveModifier)) {
      const seedModifier = revSeed.newModifier(p);
      globalScene.addModifier(seedModifier, false, false, false, true, undefined, playerIndex);
    }
  });
  queueEncounterMessage(`${namespace}:option.1.foodStash`);
}

async function giveGreedentToPlayer(playerIndex: PlayerIndex): Promise<void> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const level = Math.max(getHighestLevelPlayerPokemon(false, true, playerIndex).level - 2, 1);
  const greedent = new EnemyPokemon(getPokemonSpecies(SpeciesId.GREEDENT), level, TrainerSlot.NONE, false, true);
  greedent.gender = playerIndex === 0 ? Gender.MALE : Gender.FEMALE;
  greedent.moveset = [
    new PokemonMove(MoveId.THRASH),
    new PokemonMove(MoveId.BODY_PRESS),
    new PokemonMove(MoveId.STUFF_CHEEKS),
    new PokemonMove(MoveId.SLACK_OFF),
  ];
  greedent.passive = true;

  await catchPokemon(greedent, null, PokeballType.POKEBALL, false, true, playerIndex);
}

function buildAbsoluteAvariceBattleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeAbsoluteAvariceChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerAbsoluteAvariceChoices() : runOnePlayerBattleGreedent(),
    )
    .build();
}

function buildAbsoluteAvariceReasonOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeAbsoluteAvariceChoice(2, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerAbsoluteAvariceChoices() : runOnePlayerReasonWithGreedent(),
    )
    .build();
}

function buildAbsoluteAvariceFeedOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeAbsoluteAvariceChoice(3, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerAbsoluteAvariceChoices() : runOnePlayerFeedGreedent(),
    )
    .build();
}

function buildAbsoluteAvaricePlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildAbsoluteAvariceBattleOption(playerIndex),
    buildAbsoluteAvariceReasonOption(playerIndex),
    buildAbsoluteAvariceFeedOption(playerIndex),
  ];
}

async function runOnePlayerBattleGreedent(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  setEncounterRewards({ fillRemaining: true }, undefined, () => givePartyPokemonReviverSeeds(globalScene.activePlayerIndex));
  queueGreedentStartOfBattleEffects(1);

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

async function runOnePlayerReasonWithGreedent(): Promise<boolean> {
  returnSomeBerries(globalScene.activePlayerIndex);
  await globalScene.updateModifiers(true);

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  leaveEncounterWithoutBattle(true);
  return true;
}

async function runOnePlayerFeedGreedent(): Promise<boolean> {
  doGreedentEatBerries();
  doBerrySpritePile(true);
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await giveGreedentToPlayer(globalScene.activePlayerIndex);
  leaveEncounterWithoutBattle(true);
  return true;
}

async function runTwoPlayerAbsoluteAvariceChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choices = getAbsoluteAvariceData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battleChoices = choices.filter(choice => choice.optionIndex === 1);
  const reasonChoices = choices.filter(choice => choice.optionIndex === 2);
  const feedChoices = choices.filter(choice => choice.optionIndex === 3);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
  }

  for (const choice of reasonChoices) {
    returnSomeBerries(choice.playerIndex);
  }
  if (reasonChoices.length > 0) {
    await globalScene.updateModifiers(true);
  }

  if (feedChoices.length > 0 && battleChoices.length === 0) {
    doGreedentEatBerries();
    doBerrySpritePile(true);
    await transitionMysteryEncounterIntroVisuals(true, true, 500);
    for (const choice of feedChoices) {
      await giveGreedentToPlayer(choice.playerIndex);
    }
    leaveEncounterWithoutBattle(true);
    return true;
  }

  if (battleChoices.length === 0) {
    await transitionMysteryEncounterIntroVisuals(true, true, 500);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const battlePlayers = battleChoices.map(choice => choice.playerIndex);
  for (const choice of battleChoices) {
    setEncounterRewards(
      { fillRemaining: true },
      undefined,
      () => givePartyPokemonReviverSeeds(choice.playerIndex),
      choice.playerIndex,
    );
  }

  if (feedChoices.length > 0) {
    encounter.onRewards = async () => {
      for (const choice of feedChoices) {
        await giveGreedentToPlayer(choice.playerIndex);
      }
      encounter.onRewards = undefined;
    };
  }

  const greedentCount = battlePlayers.length > 1 ? 2 : 1;
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  queueGreedentStartOfBattleEffects(greedentCount);
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await hideAbsoluteAvariceNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createGreedentEnemyPartyConfig(battlePlayers));
  return true;
}

/**
 * Absolute Avarice encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3805 | GitHub Issue #3805}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const AbsoluteAvariceEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.ABSOLUTE_AVARICE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(20, 180)
  .withSceneRequirement(new TwoPlayerAnyPlayerBerryRequirement("BerryModifier", 6)) // Must have at least 6 berries to spawn
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      // This sprite has the shadow
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.GREEDENT,
      hasShadow: true,
      alpha: 0.001,
      repeat: true,
      x: -5,
    },
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.GREEDENT,
      hasShadow: false,
      repeat: true,
      x: -5,
    },
    {
      spriteKey: "lum_berry",
      fileRoot: "items",
      isItem: true,
      x: 7,
      y: -14,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "salac_berry",
      fileRoot: "items",
      isItem: true,
      x: 2,
      y: 4,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "lansat_berry",
      fileRoot: "items",
      isItem: true,
      x: 32,
      y: 5,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "liechi_berry",
      fileRoot: "items",
      isItem: true,
      x: 6,
      y: -5,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "sitrus_berry",
      fileRoot: "items",
      isItem: true,
      x: 7,
      y: 8,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "enigma_berry",
      fileRoot: "items",
      isItem: true,
      x: 26,
      y: -4,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "leppa_berry",
      fileRoot: "items",
      isItem: true,
      x: 16,
      y: -27,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "petaya_berry",
      fileRoot: "items",
      isItem: true,
      x: 30,
      y: -17,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "ganlon_berry",
      fileRoot: "items",
      isItem: true,
      x: 16,
      y: -11,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "apicot_berry",
      fileRoot: "items",
      isItem: true,
      x: 14,
      y: -2,
      hidden: true,
      disableAnimation: true,
    },
    {
      spriteKey: "starf_berry",
      fileRoot: "items",
      isItem: true,
      x: 18,
      y: 9,
      hidden: true,
      disableAnimation: true,
    },
  ])
  .withHideWildIntroMessage(true)
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

    globalScene
      .loadSe("PRSFX- Bug Bite", "battle_anims", "PRSFX- Bug Bite.wav")
      .loadSe("Follow Me", "battle_anims", "Follow Me.wav");

    seedAbsoluteAvariceTestBerries();

    const berryItemsByPlayer = buildBerryItemsByPlayer();
    const berryItemsMap = berryItemsByPlayer[globalScene.activePlayerIndex];

    encounter.misc = {
      berryItemsMap,
      berryItemsByPlayer,
      choices: [],
    } satisfies AbsoluteAvariceData;

    // Do NOT remove the real berries yet or else it will be persisted in the session data
    encounter.enemyPartyConfigs = [createGreedentEnemyPartyConfig([globalScene.activePlayerIndex])];
    encounter.setDialogueToken("greedentName", getPokemonSpecies(SpeciesId.GREEDENT).getName());

    return true;
  })
  .withOnVisualsStart(() => {
    doGreedentSpriteSteal();
    doBerrySpritePile();

    // Remove the berries from the party
    // Session has been safely saved at this point, so data won't be lost
    getAvaricePlayerIndexes().forEach(playerIndex => {
      const berryItems = getPlayerBerryItems(playerIndex);
      berryItems.forEach(berryMod => {
        globalScene.removeModifier(berryMod, false, playerIndex);
      });
      globalScene.updateModifiers(true, undefined, playerIndex);
    });

    return true;
  })
  .withOption(buildAbsoluteAvariceBattleOption(0))
  .withOption(buildAbsoluteAvariceReasonOption(0))
  .withOption(buildAbsoluteAvariceFeedOption(0))
  .build();

function doGreedentSpriteSteal() {
  const shakeDelay = 50;
  const slideDelay = 500;

  const greedentSprites = globalScene.currentBattle.mysteryEncounter!.introVisuals?.getSpriteAtIndex(1);

  audioManager.playSound("battle_anims/Follow Me");
  globalScene.tweens.chain({
    targets: greedentSprites,
    tweens: [
      {
        // Slide Greedent diagonally
        duration: slideDelay,
        ease: "Cubic.easeOut",
        y: "+=75",
        x: "-=65",
        scale: 1.1,
      },
      {
        // Shake
        duration: shakeDelay,
        ease: "Cubic.easeOut",
        yoyo: true,
        x: (randInt(2) > 0 ? "-=" : "+=") + 5,
        y: (randInt(2) > 0 ? "-=" : "+=") + 5,
      },
      {
        // Shake
        duration: shakeDelay,
        ease: "Cubic.easeOut",
        yoyo: true,
        x: (randInt(2) > 0 ? "-=" : "+=") + 5,
        y: (randInt(2) > 0 ? "-=" : "+=") + 5,
      },
      {
        // Shake
        duration: shakeDelay,
        ease: "Cubic.easeOut",
        yoyo: true,
        x: (randInt(2) > 0 ? "-=" : "+=") + 5,
        y: (randInt(2) > 0 ? "-=" : "+=") + 5,
      },
      {
        // Shake
        duration: shakeDelay,
        ease: "Cubic.easeOut",
        yoyo: true,
        x: (randInt(2) > 0 ? "-=" : "+=") + 5,
        y: (randInt(2) > 0 ? "-=" : "+=") + 5,
      },
      {
        // Shake
        duration: shakeDelay,
        ease: "Cubic.easeOut",
        yoyo: true,
        x: (randInt(2) > 0 ? "-=" : "+=") + 5,
        y: (randInt(2) > 0 ? "-=" : "+=") + 5,
      },
      {
        // Shake
        duration: shakeDelay,
        ease: "Cubic.easeOut",
        yoyo: true,
        x: (randInt(2) > 0 ? "-=" : "+=") + 5,
        y: (randInt(2) > 0 ? "-=" : "+=") + 5,
      },
      {
        // Slide Greedent diagonally
        duration: slideDelay,
        ease: "Cubic.easeOut",
        y: "-=75",
        x: "+=65",
        scale: 1,
      },
      {
        // Bounce at the end
        duration: 300,
        ease: "Cubic.easeOut",
        yoyo: true,
        y: "-=20",
        loop: 1,
      },
    ],
  });
}

function doGreedentEatBerries() {
  const greedentSprites = globalScene.currentBattle.mysteryEncounter!.introVisuals?.getSpriteAtIndex(1);
  let index = 1;
  globalScene.tweens.add({
    targets: greedentSprites,
    duration: 150,
    ease: "Cubic.easeOut",
    yoyo: true,
    y: "-=8",
    loop: 5,
    onStart: () => {
      audioManager.playSound("battle_anims/PRSFX- Bug Bite");
    },
    onLoop: () => {
      if (index % 2 === 0) {
        audioManager.playSound("battle_anims/PRSFX- Bug Bite");
      }
      index++;
    },
  });
}

/**
 * @param isEat Default false. Will "create" pile when false, and remove pile when true.
 */
function doBerrySpritePile(isEat = false) {
  const berryAddDelay = 150;
  let animationOrder = [
    "starf",
    "sitrus",
    "lansat",
    "salac",
    "apicot",
    "enigma",
    "liechi",
    "ganlon",
    "lum",
    "petaya",
    "leppa",
  ];
  if (isEat) {
    animationOrder = animationOrder.reverse();
  }
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  animationOrder.forEach((berry, i) => {
    const introVisualsIndex = encounter.spriteConfigs.findIndex(config => config.spriteKey?.includes(berry));
    let sprite: Phaser.GameObjects.Sprite;
    let tintSprite: Phaser.GameObjects.Sprite;
    const sprites = encounter.introVisuals?.getSpriteAtIndex(introVisualsIndex);
    if (sprites) {
      sprite = sprites[0];
      tintSprite = sprites[1];
    }
    globalScene.time.delayedCall(berryAddDelay * i + 400, () => {
      if (sprite) {
        sprite.setVisible(!isEat);
      }
      if (tintSprite) {
        tintSprite.setVisible(!isEat);
      }

      // Animate Petaya berry falling off the pile
      if (berry === "petaya" && sprite && tintSprite && !isEat) {
        globalScene.time.delayedCall(200, () => {
          doBerryBounce([sprite, tintSprite], 30, 500);
        });
      }
    });
  });
}

function doBerryBounce(berrySprites: Phaser.GameObjects.Sprite[], yd: number, baseBounceDuration: number) {
  let bouncePower = 1;
  let bounceYOffset = yd;

  const doBounce = () => {
    globalScene.tweens.add({
      targets: berrySprites,
      y: "+=" + bounceYOffset,
      x: { value: "+=" + bouncePower * bouncePower * 10, ease: "Linear" },
      duration: bouncePower * baseBounceDuration,
      ease: "Cubic.easeIn",
      onComplete: () => {
        bouncePower = bouncePower > 0.01 ? bouncePower * 0.5 : 0;

        if (bouncePower) {
          bounceYOffset *= bouncePower;

          globalScene.tweens.add({
            targets: berrySprites,
            y: "-=" + bounceYOffset,
            x: { value: "+=" + bouncePower * bouncePower * 10, ease: "Linear" },
            duration: bouncePower * baseBounceDuration,
            ease: "Cubic.easeOut",
            onComplete: () => doBounce(),
          });
        }
      },
    });
  };

  doBounce();
}
