import { Battle } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { BattleType } from "#enums/battle-type";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { onlineLoadedState } from "#utils/online-save-session";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Player vote tie-break persistence", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 23,
      battleType: BattleType.WILD,
      double: true,
    });
    for (const player of game.scene.getActivePlayerIndexes()) {
      game.scene.getPlayerParty(player).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20));
    }
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function snapshot(): string {
    return JSON.stringify(game.scene.gameData.getSessionSaveData(), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  }

  it.each([2, 3] as const)("continues the %i-player rotation after saving and resetting the scene", async count => {
    game.scene.configureTwoPlayerMode(true, 6, false, count);
    const players = game.scene.getActivePlayerIndexes();
    expect(game.scene.resolvePlayerTieBreak(players)).toBe(0);
    const saved = game.scene.gameData.getSessionSaveData();
    expect(saved.playerDecisionTieBreakPriorities).toEqual({ [players.join("-")]: 1 });
    expect(game.scene.resolvePlayerTieBreak(players)).toBe(1);
    expect(saved.playerDecisionTieBreakPriorities).toEqual({ [players.join("-")]: 1 });
    game.scene.reset();
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual({});
    vi.spyOn(game.scene.gameData, "getSession").mockResolvedValue(saved);
    expect(await game.scene.gameData.loadSession(0)).toBe(true);
    expect(game.scene.resolvePlayerTieBreak(players)).toBe(1);
    expect(game.scene.resolvePlayerTieBreak(players)).toBe(count === 3 ? 2 : 0);
    expect(saved.playerDecisionTieBreakPriorities).toEqual({ [players.join("-")]: 1 });
  });

  it("preserves every participant group's independent rotation through a snapshot", async () => {
    const groups: PlayerIndex[][] = [
      [0, 1],
      [0, 2],
      [1, 2],
      [0, 1, 2],
    ];
    groups.forEach(players => game.scene.resolvePlayerTieBreak(players));
    game.scene.resolvePlayerTieBreak([1, 2]);
    game.scene.resolvePlayerTieBreak([0, 1, 2]);
    const expected = { "0-1": 1, "0-2": 2, "1-2": 1, "0-1-2": 2 };
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual(expected);
    const saved = snapshot();
    game.scene.playerDecisionTieBreakPriorities = {};
    game.scene.twoPlayerMysteryDecisionPriority = 0;
    await game.scene.gameData.loadSessionSnapshot(saved);
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual(expected);
    expect(game.scene.twoPlayerMysteryDecisionPriority).toBe(1);
    expect(groups.map(players => game.scene.resolvePlayerTieBreak(players))).toEqual([1, 2, 1, 2]);
  });

  it("replaces in-memory priorities when switching between saved runs", async () => {
    game.scene.resolvePlayerTieBreak([0, 1]);
    const first = snapshot();
    game.scene.resolvePlayerTieBreak([0, 1]);
    const second = snapshot();
    game.scene.resolvePlayerTieBreak([0, 2]);
    await game.scene.gameData.loadSessionSnapshot(first);
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual({ "0-1": 1 });
    expect(game.scene.resolvePlayerTieBreak([0, 1])).toBe(1);
    await game.scene.gameData.loadSessionSnapshot(second);
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual({ "0-1": 0 });
    expect(game.scene.twoPlayerMysteryDecisionPriority).toBe(0);
    expect(game.scene.resolvePlayerTieBreak([0, 1])).toBe(0);
  });

  it("starts older saves without inheriting another run's priorities", async () => {
    const { playerDecisionTieBreakPriorities, ...oldSave } = game.scene.gameData.getSessionSaveData();
    expect(playerDecisionTieBreakPriorities).toEqual({});
    game.scene.resolvePlayerTieBreak([0, 1]);
    game.scene.resolvePlayerTieBreak([0, 2]);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(oldSave));
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual({});
    expect(game.scene.twoPlayerMysteryDecisionPriority).toBe(0);
    expect(game.scene.resolvePlayerTieBreak([0, 1])).toBe(0);
  });

  it("resets all player voting priorities for a new run", () => {
    game.scene.resolvePlayerTieBreak([0, 1]);
    game.scene.resolvePlayerTieBreak([0, 2]);
    game.scene.resolvePlayerTieBreak([1, 2]);
    game.scene.resolvePlayerTieBreak([0, 1, 2]);
    game.scene.reset();
    expect(game.scene.playerDecisionTieBreakPriorities).toEqual({});
    expect(game.scene.twoPlayerMysteryDecisionPriority).toBe(0);
    expect(game.scene.resolvePlayerTieBreak([0, 1])).toBe(0);
  });

  it("includes voting priorities in the online restored-state comparison", () => {
    const before = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    game.scene.resolvePlayerTieBreak([0, 1]);
    const after = game.scene.getTwoPlayerDebugStateCheckpoint()!;
    expect(before.summary.playerDecisionTieBreakPriorities).toEqual({});
    expect(after.summary.playerDecisionTieBreakPriorities).toEqual({ "0-1": 1 });
    expect(onlineLoadedState(before.summary)).not.toBe(onlineLoadedState(after.summary));
  });
});
