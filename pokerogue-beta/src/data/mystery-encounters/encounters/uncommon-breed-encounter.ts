import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  getRandomEncounterPokemon,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterExp,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import {
  catchPokemon,
  getHighestLevelPlayerPokemon,
  getSpriteKeysFromPokemon,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import {
  EncounterPokemonRequirement,
  EncounterSceneRequirement,
  MoveRequirement,
} from "#mystery-encounters/mystery-encounter-requirements";
import { CHARMING_MOVES } from "#mystery-encounters/requirement-groups";
import { PokemonData } from "#system/pokemon-data";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/uncommonBreed";

type UncommonBreedOptionIndex = 1 | 2 | 3;

interface UncommonBreedChoice {
  playerIndex: PlayerIndex;
  optionIndex: UncommonBreedOptionIndex;
  helperPokemon?: PlayerPokemon;
}

interface UncommonBreedData {
  choices: UncommonBreedChoice[];
  pokemonDataByPlayer: Record<PlayerIndex, PokemonData>;
  eggMoveByPlayer: Partial<Record<PlayerIndex, MoveId>>;
  skipSelectedDialogueOnce?: boolean;
}

class PlayerBerryRequirement extends EncounterSceneRequirement {
  constructor(private readonly playerIndex: PlayerIndex, private readonly requiredCount: number) {
    super();
  }

  override meetsRequirement(): boolean {
    return getPlayerBerryCount(this.playerIndex) >= this.requiredCount;
  }

  override getDialogueToken(): [string, string] {
    return ["requiredItem", "Berry"];
  }
}

class PlayerCharmMoveRequirement extends EncounterPokemonRequirement {
  private readonly requirement = new MoveRequirement(CHARMING_MOVES, true);

  constructor(private readonly playerIndex: PlayerIndex) {
    super();
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryParty([]).length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.requirement.queryParty(globalScene.getPlayerParty(this.playerIndex));
  }

  override getDialogueToken(pokemon?: PlayerPokemon): [string, string] {
    return this.requirement.getDialogueToken(pokemon);
  }
}

function getUncommonBreedData(): UncommonBreedData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      pokemonDataByPlayer: encounter.misc?.pokemonDataByPlayer ?? {
        0: new PokemonData(encounter.misc?.pokemon),
        1: new PokemonData(encounter.misc?.pokemon),
      },
      eggMoveByPlayer: encounter.misc?.eggMoveByPlayer ?? {
        0: encounter.misc?.eggMove,
        1: encounter.misc?.eggMove,
      },
    } satisfies UncommonBreedData;
  }

  return encounter.misc as UncommonBreedData;
}

function getPlayerBerryCount(playerIndex: PlayerIndex): number {
  return (globalScene.findModifiersForPlayer(m => m instanceof BerryModifier, playerIndex) as BerryModifier[]).reduce(
    (count, berry) => count + berry.stackCount,
    0,
  );
}

function createUncommonBreedPokemon(playerIndex: PlayerIndex): { pokemon: EnemyPokemon; eggMove?: MoveId } {
  const level = Math.max(getHighestLevelPlayerPokemon(false, true, playerIndex).level - 2, 1);
  const pokemon = getRandomEncounterPokemon({
    level,
    isBoss: true,
    eventShinyRerolls: 2,
    eventHiddenRerolls: 1,
  });

  const eggMoves = pokemon.getEggMoves();
  const eggMove = eggMoves?.[randSeedInt(4)];
  if (eggMove != null) {
    if (pokemon.moveset.length < 4) {
      pokemon.moveset.push(new PokemonMove(eggMove));
    } else {
      pokemon.moveset[0] = new PokemonMove(eggMove);
    }
  }

  return eggMove == null ? { pokemon } : { pokemon, eggMove };
}

function getUncommonBreedPokemon(playerIndex: PlayerIndex): EnemyPokemon {
  return getUncommonBreedData().pokemonDataByPlayer[playerIndex].toPokemon() as EnemyPokemon;
}

function getUncommonBreedBattleConfig(enemyOwnerIndexes: PlayerIndex[]): EnemyPartyConfig {
  return {
    doubleBattle: enemyOwnerIndexes.length > 1,
    pokemonConfigs: enemyOwnerIndexes.map(playerIndex => getUncommonBreedPokemonConfig(playerIndex)),
  };
}

function getUncommonBreedPokemonConfig(playerIndex: PlayerIndex): EnemyPokemonConfig {
  const data = getUncommonBreedData();
  const pokemon = data.pokemonDataByPlayer[playerIndex].toPokemon() as EnemyPokemon;
  const statChangesForBattle: (Stat.ATK | Stat.DEF | Stat.SPATK | Stat.SPDEF | Stat.SPD | Stat.ACC | Stat.EVA)[] =
    globalScene.currentBattle.waveIndex < 50
      ? [Stat.DEF, Stat.SPDEF, Stat.SPD]
      : [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];

  return {
    species: pokemon.species,
    dataSource: data.pokemonDataByPlayer[playerIndex],
    isBoss: false,
    tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
    mysteryEncounterBattleEffects: (battlePokemon: Pokemon) => {
      queueEncounterMessage(`${namespace}:option.1.statBoost`);
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
        battlerIndex: battlePokemon.getBattlerIndex(),
        changes: statChangesForBattle.map(stat => ({ stat, stages: 1 })),
        sourcePokemon: battlePokemon,
      });
    },
  };
}

function queueUncommonBreedStartOfBattleEffects(
  battlePlayers: PlayerIndex[],
  enemyOwnerIndexes: PlayerIndex[],
): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getUncommonBreedData();
  for (const [enemyIndex, playerIndex] of enemyOwnerIndexes.entries()) {
    const eggMove = data.eggMoveByPlayer[playerIndex];
    if (eggMove == null) {
      continue;
    }

    const pokemonMove = new PokemonMove(eggMove);
    const move = pokemonMove.getMove();
    const target =
      move.is("SelfStatusMove")
        ? enemyIndex === 0
          ? BattlerIndex.ENEMY
          : BattlerIndex.ENEMY_2
        : battlePlayers.length > 1 && enemyIndex === 1
          ? BattlerIndex.PLAYER_2
          : BattlerIndex.PLAYER;

    encounter.startOfBattleEffects.push({
      sourceBattlerIndex: enemyIndex === 0 ? BattlerIndex.ENEMY : BattlerIndex.ENEMY_2,
      targets: [target],
      move: pokemonMove,
      useMode: MoveUseMode.IGNORE_PP,
    });
  }
}

function setUncommonBreedPlayerOptionTokens(playerIndex: PlayerIndex): void {
  const data = getUncommonBreedData();
  const pokemon = data.pokemonDataByPlayer[playerIndex].toPokemon() as EnemyPokemon;
  const helperPokemon = new MoveRequirement(CHARMING_MOVES, true).queryParty(globalScene.getPlayerParty(playerIndex))[0];
  const helperMove = helperPokemon?.moveset.find(move => move && CHARMING_MOVES.includes(move.getMove().id));
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("enemyPokemon", pokemon.getNameToRender());
  encounter.setDialogueToken("option3PrimaryName", helperPokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("option3PrimaryMove", helperMove?.getName() ?? "");
}

function showUncommonBreedPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setUncommonBreedPlayerOptionTokens(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildUncommonBreedPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function storeUncommonBreedChoice(choice: UncommonBreedChoice, startingCursorIndex: number): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const data = getUncommonBreedData();
  data.choices = data.choices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (choice.playerIndex === 0) {
    showUncommonBreedPlayerMenu(1, startingCursorIndex);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function removePlayerBerries(playerIndex: PlayerIndex): Promise<void> {
  const berryItems = globalScene.findModifiersForPlayer(m => m instanceof BerryModifier, playerIndex) as BerryModifier[];
  for (let i = 0; i < 4; i++) {
    const index = randSeedInt(berryItems.length);
    const randBerry = berryItems[index];
    randBerry.stackCount--;
    if (randBerry.stackCount === 0) {
      globalScene.removeModifier(randBerry, false, playerIndex);
      berryItems.splice(index, 1);
    }
  }
  await globalScene.updateModifiers(true, true, playerIndex);
}

async function recruitUncommonBreedPokemon(choice: UncommonBreedChoice): Promise<void> {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  setUncommonBreedPlayerOptionTokens(choice.playerIndex);

  const data = getUncommonBreedData();
  const pokemon = data.pokemonDataByPlayer[choice.playerIndex].toPokemon() as EnemyPokemon;
  givePokemonExtraEggMove(pokemon, data.eggMoveByPlayer[choice.playerIndex]);

  if (choice.optionIndex === 3) {
    pokemon.ivs = pokemon.ivs.map(iv => {
      const newValue = randSeedInt(31);
      return newValue > iv ? newValue : iv;
    });
  }

  await catchPokemon(pokemon, null, PokeballType.POKEBALL, false, false, choice.playerIndex);
  if (choice.optionIndex === 3 && choice.helperPokemon?.id) {
    setEncounterExp(choice.helperPokemon.id, pokemon.getExpValue(), false, choice.playerIndex);
  }
  setEncounterRewards({ fillRemaining: true }, undefined, undefined, choice.playerIndex);
}

async function runTwoPlayerUncommonBreedChoices(): Promise<boolean> {
  const choices = getUncommonBreedData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battleChoices = choices.filter(choice => choice.optionIndex === 1);
  const recruitChoices = choices.filter(choice => choice.optionIndex !== 1);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    setUncommonBreedPlayerOptionTokens(choice.playerIndex);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);

    if (choice.optionIndex === 2) {
      await removePlayerBerries(choice.playerIndex);
      await recruitUncommonBreedPokemon(choice);
    } else if (choice.optionIndex === 3) {
      await recruitUncommonBreedPokemon(choice);
    }
  }

  if (battleChoices.length === 0) {
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const recruitedPlayerSet = new Set(recruitChoices.map(choice => choice.playerIndex));
  const enemyOwnerIndexes = ([0, 1] as PlayerIndex[]).filter(playerIndex => !recruitedPlayerSet.has(playerIndex));
  const battlePlayers = battleChoices.map(choice => choice.playerIndex);
  for (const playerIndex of battlePlayers) {
    setEncounterRewards({ fillRemaining: true }, undefined, undefined, playerIndex);
  }

  globalScene.setActivePlayerIndex(battlePlayers[0]);
  updateWindowType(battlePlayers[0] + 1);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  queueUncommonBreedStartOfBattleEffects(battlePlayers, enemyOwnerIndexes);
  await initBattleWithEnemyConfig(getUncommonBreedBattleConfig(enemyOwnerIndexes));
  return true;
}

async function runOnePlayerBattleUncommonBreed(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getUncommonBreedData();
  const eggMove = data.eggMoveByPlayer[0];

  if (eggMove != null) {
    const pokemonMove = new PokemonMove(eggMove);
    const move = pokemonMove.getMove();
    const target = move.is("SelfStatusMove") ? BattlerIndex.ENEMY : BattlerIndex.PLAYER;

    encounter.startOfBattleEffects.push({
      sourceBattlerIndex: BattlerIndex.ENEMY,
      targets: [target],
      move: pokemonMove,
      useMode: MoveUseMode.IGNORE_PP,
    });
  }

  setEncounterRewards({ fillRemaining: true });
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
  return true;
}

async function runOnePlayerFoodUncommonBreed(): Promise<boolean> {
  await removePlayerBerries(0);
  await recruitUncommonBreedPokemon({ playerIndex: 0, optionIndex: 2 });
  leaveEncounterWithoutBattle();
  return true;
}

async function runOnePlayerBefriendUncommonBreed(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choice: UncommonBreedChoice = {
    playerIndex: 0,
    optionIndex: 3,
  };
  if (encounter.selectedOption?.primaryPokemon) {
    choice.helperPokemon = encounter.selectedOption.primaryPokemon;
  }

  await recruitUncommonBreedPokemon(choice);
  leaveEncounterWithoutBattle();
  return true;
}

function buildUncommonBreedBattleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeUncommonBreedChoice({ playerIndex, optionIndex: 1 }, 0))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerUncommonBreedChoices() : runOnePlayerBattleUncommonBreed(),
    )
    .build();
}

function buildUncommonBreedFoodOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withSceneRequirement(new PlayerBerryRequirement(playerIndex, 4))
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
    .withPreOptionPhase(async () => storeUncommonBreedChoice({ playerIndex, optionIndex: 2 }, 1))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerUncommonBreedChoices() : runOnePlayerFoodUncommonBreed(),
    )
    .build();
}

function buildUncommonBreedBefriendOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerCharmMoveRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      disabledButtonTooltip: `${namespace}:option.3.disabledTooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => {
      const helperPokemon = new MoveRequirement(CHARMING_MOVES, true).queryParty(globalScene.getPlayerParty(playerIndex))[0];
      return storeUncommonBreedChoice({ playerIndex, optionIndex: 3, helperPokemon }, 2);
    })
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerUncommonBreedChoices() : runOnePlayerBefriendUncommonBreed(),
    )
    .build();
}

function buildUncommonBreedPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildUncommonBreedBattleOption(playerIndex),
    buildUncommonBreedFoodOption(playerIndex),
    buildUncommonBreedBefriendOption(playerIndex),
  ];
}

/**
 * Uncommon Breed encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3811 | GitHub Issue #3811}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const UncommonBreedEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.UNCOMMON_BREED,
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
    const primary = createUncommonBreedPokemon(0);
    const secondary = globalScene.twoPlayerMode ? createUncommonBreedPokemon(1) : primary;
    const pokemonDataByPlayer: Record<PlayerIndex, PokemonData> = {
      0: new PokemonData(primary.pokemon),
      1: new PokemonData(secondary.pokemon),
    };
    const eggMoveByPlayer: Partial<Record<PlayerIndex, MoveId>> = {};
    if (primary.eggMove != null) {
      eggMoveByPlayer[0] = primary.eggMove;
    }
    if (secondary.eggMove != null) {
      eggMoveByPlayer[1] = secondary.eggMove;
    }
    const visualPlayerIndexes = globalScene.twoPlayerMode ? ([0, 1] as PlayerIndex[]) : ([0] as PlayerIndex[]);

    const misc: UncommonBreedData & { pokemon: EnemyPokemon; eggMove?: MoveId } = {
      choices: [],
      pokemon: primary.pokemon,
      pokemonDataByPlayer,
      eggMoveByPlayer,
    };
    if (primary.eggMove != null) {
      misc.eggMove = primary.eggMove;
    }
    encounter.misc = misc;
    encounter.enemyPartyConfigs = [getUncommonBreedBattleConfig([0])];

    encounter.spriteConfigs = visualPlayerIndexes.map((playerIndex, spriteIndex) => {
      const pokemon = playerIndex === 0 ? primary.pokemon : secondary.pokemon;
      const { spriteKey, fileRoot } = getSpriteKeysFromPokemon(pokemon);
      return {
        spriteKey,
        fileRoot,
        hasShadow: true,
        x: visualPlayerIndexes.length > 1 ? (spriteIndex === 0 ? -28 : 28) : -5,
        repeat: true,
        isPokemon: true,
        isShiny: pokemon.shiny,
        variant: pokemon.variant,
      };
    });

    encounter.setDialogueToken("enemyPokemon", primary.pokemon.getNameToRender());
    globalScene.loadSe("PRSFX- Spotlight2", "battle_anims", "PRSFX- Spotlight2.wav");
    return true;
  })
  .withOnVisualsStart(() => {
    // Animate the pokemon
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const pokemonSprite = encounter.introVisuals!.getSprites();

    // Bounce at the end, then shiny sparkle if the Pokemon is shiny
    globalScene.tweens.add({
      targets: pokemonSprite,
      duration: 300,
      ease: "Cubic.easeOut",
      yoyo: true,
      y: "-=20",
      loop: 1,
      onComplete: () => encounter.introVisuals?.playShinySparkles(),
    });

    globalScene.time.delayedCall(500, () => audioManager.playSound("battle_anims/PRSFX- Spotlight2"));
    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildUncommonBreedBattleOption(0))
  .withOption(buildUncommonBreedFoodOption(0))
  .withOption(buildUncommonBreedBefriendOption(0))
  .build();

function givePokemonExtraEggMove(pokemon: EnemyPokemon, previousEggMove?: MoveId) {
  const eggMoves = pokemon.getEggMoves();
  if (eggMoves) {
    let randomEggMove: MoveId = eggMoves[randSeedInt(4)];
    let rerollGuard = 0;
    while (previousEggMove != null && randomEggMove === previousEggMove && rerollGuard < 8) {
      randomEggMove = eggMoves[randSeedInt(4)];
      rerollGuard++;
    }
    if (pokemon.moveset.length < 4) {
      pokemon.moveset.push(new PokemonMove(randomEggMove));
    } else {
      pokemon.moveset[1] = new PokemonMove(randomEggMove);
    }
  }
}
