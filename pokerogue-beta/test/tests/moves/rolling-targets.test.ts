import { Battle } from "#app/battle";
import { MovePhasePriorityQueue } from "#app/queues/move-phase-priority-queue";
import { allMoves } from "#data/data-lists";
import { PokemonSummonData } from "#data/pokemon/pokemon-data";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";
import { resolveAbsentMoveTarget } from "#moves/move-utils";
import { PokemonMove } from "#moves/pokemon-move";
import { beginRollingMove, finishRollingMove } from "#moves/rolling-move";
import { MovePhase } from "#phases/move-phase";
import { GameManager } from "#test/framework/game-manager";
import type { TurnMove } from "#types/turn-move";
import { getEnemyBattlerIndex, getPlayerBattlerIndex } from "#utils/battler-index-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Rolling moves and triple-battle retargeting", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let players: Pokemon[];
  let enemies: Pokemon[];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  function battler(player: boolean, slot: number): Pokemon {
    const data = new PokemonSummonData();
    return {
      fieldPosition: [FieldPosition.LEFT, FieldPosition.RIGHT, FieldPosition.CENTER][slot],
      summonData: data,
      isPlayer: () => player,
      isActive: vi.fn(() => true),
      isAlly: (other: Pokemon) => other.isPlayer() === player,
      isOpponent: (other: Pokemon) => other.isPlayer() !== player,
      getBattlerIndex: () => (player ? getPlayerBattlerIndex(slot) : getEnemyBattlerIndex(slot)),
      getFieldIndex: () => slot,
      randBattleSeedInt: vi.fn(() => 0),
      getMoveQueue(this: Pokemon) {
        return this.summonData.moveQueue;
      },
      getMoveHistory(this: Pokemon) {
        return this.summonData.moveHistory;
      },
      pushMoveQueue(this: Pokemon, move: TurnMove) {
        this.summonData.moveQueue.push(move);
      },
    } as unknown as Pokemon;
  }

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 5,
      battleType: BattleType.WILD,
      double: true,
      wildBattlerCount: 3,
    });
    vi.spyOn(game.scene, "isVsLaneBattle").mockReturnValue(false);
    players = [0, 1, 2].map(slot => battler(true, slot));
    enemies = [0, 1, 2].map(slot => battler(false, slot));
    vi.spyOn(game.scene, "getPlayerField").mockReturnValue(players as never);
    vi.spyOn(game.scene, "getEnemyField").mockReturnValue(enemies as never);
    vi.spyOn(game.scene, "getField").mockImplementation((activeOnly = false) => {
      const field: Pokemon[] = [];
      for (const pokemon of [...players, ...enemies]) {
        field[pokemon.getBattlerIndex()] = pokemon;
      }
      return (activeOnly ? field.filter(p => p?.isActive(true)) : field) as never;
    });
  });

  function faint(pokemon: Pokemon) {
    vi.mocked(pokemon.isActive).mockReturnValue(false);
  }

  it.each([
    MoveId.TACKLE,
    MoveId.ROLLOUT,
    MoveId.ICE_BALL,
  ])("retargets %i from the near edge to the center, not the far edge", moveId => {
    faint(enemies[0]);
    expect(resolveAbsentMoveTarget(players[0], allMoves[moveId], BattlerIndex.ENEMY)).toBe(BattlerIndex.ENEMY_3);
  });

  it.each([MoveId.TACKLE, MoveId.ROLLOUT, MoveId.ICE_BALL])("fails %i when only the far edge remains", moveId => {
    faint(enemies[0]);
    faint(enemies[2]);
    expect(resolveAbsentMoveTarget(players[0], allMoves[moveId], BattlerIndex.ENEMY)).toBeUndefined();
    expect(resolveAbsentMoveTarget(players[0], allMoves[moveId], BattlerIndex.ENEMY_3)).toBeUndefined();
  });

  it("respects an explicitly unrestricted target type", () => {
    faint(enemies[0]);
    faint(enemies[2]);
    const move = allMoves[MoveId.TACKLE];
    const originalTarget = move.moveTarget;
    try {
      move.moveTarget = MoveTarget.OTHER;
      expect(resolveAbsentMoveTarget(players[0], move, BattlerIndex.ENEMY)).toBe(BattlerIndex.ENEMY_2);
    } finally {
      move.moveTarget = originalTarget;
    }
  });

  it("chooses between legal alternatives using the attacker's seeded RNG", () => {
    faint(enemies[2]);
    vi.mocked(players[2].randBattleSeedInt).mockReturnValue(1);
    expect(resolveAbsentMoveTarget(players[2], allMoves[MoveId.ROLLOUT], BattlerIndex.ENEMY_3)).toBe(
      BattlerIndex.ENEMY_2,
    );
    expect(players[2].randBattleSeedInt).toHaveBeenCalledWith(2);
  });

  it("does not retarget a present opponent or explicitly selected fainted ally", () => {
    expect(resolveAbsentMoveTarget(players[0], allMoves[MoveId.ROLLOUT], BattlerIndex.ENEMY)).toBe(BattlerIndex.ENEMY);
    faint(players[2]);
    expect(resolveAbsentMoveTarget(players[0], allMoves[MoveId.TACKLE], BattlerIndex.PLAYER_3)).toBe(
      BattlerIndex.PLAYER_3,
    );
    expect(players[0].randBattleSeedInt).not.toHaveBeenCalled();
  });

  it("cannot retarget across a Vs lane", () => {
    vi.mocked(game.scene.isVsLaneBattle).mockReturnValue(true);
    faint(enemies[0]);
    expect(resolveAbsentMoveTarget(players[0], allMoves[MoveId.ROLLOUT], BattlerIndex.ENEMY)).toBeUndefined();
  });

  it("uses the same range checks for enemy attacks", () => {
    faint(players[0]);
    expect(resolveAbsentMoveTarget(enemies[0], allMoves[MoveId.ICE_BALL], BattlerIndex.PLAYER)).toBe(
      BattlerIndex.PLAYER_3,
    );
    faint(players[2]);
    expect(resolveAbsentMoveTarget(enemies[0], allMoves[MoveId.ICE_BALL], BattlerIndex.PLAYER)).toBeUndefined();
  });

  it("fixes the queued ordinary-move redirection path too", () => {
    const queue = new MovePhasePriorityQueue();
    const phase = new MovePhase(players[0], [BattlerIndex.ENEMY], new PokemonMove(MoveId.TACKLE), MoveUseMode.NORMAL);
    queue.push(phase);
    faint(enemies[0]);
    // The old doubles helper can supply the far edge; it must not determine the replacement.
    queue.redirectMoves(enemies[0], enemies[1]);
    expect(phase.targets).toEqual([BattlerIndex.ENEMY_3]);
    faint(enemies[2]);
    queue.redirectMoves(enemies[2], enemies[1]);
    expect(resolveAbsentMoveTarget(players[0], phase.move.getMove(), phase.targets[0])).toBeUndefined();
  });

  it.each([
    MoveId.ROLLOUT,
    MoveId.ICE_BALL,
  ])("preserves %i's preferred slot through a temporary redirect and returns to its replacement", moveId => {
    const user = players[0];
    const queue = new MovePhasePriorityQueue();
    const phase = new MovePhase(user, [BattlerIndex.ENEMY], new PokemonMove(moveId), MoveUseMode.NORMAL);
    queue.push(phase);
    faint(enemies[0]);
    queue.redirectMoves(enemies[0], enemies[2]);
    expect(phase.targets).toEqual([BattlerIndex.ENEMY]);
    const execution = beginRollingMove(user, moveId, phase.targets[0]);
    const fallback = resolveAbsentMoveTarget(user, allMoves[moveId], execution.state.target);
    expect(fallback).toBe(BattlerIndex.ENEMY_3);
    user
      .getMoveHistory()
      .push({ move: moveId, targets: [fallback!], result: MoveResult.SUCCESS, useMode: MoveUseMode.NORMAL });
    finishRollingMove(execution);
    expect(user.getMoveQueue()[0].targets).toEqual([BattlerIndex.ENEMY]);
    enemies[0] = battler(false, 0);
    const next = beginRollingMove(user, moveId, user.getMoveQueue()[0].targets[0]);
    expect(next.state.count).toBe(1);
    expect(resolveAbsentMoveTarget(user, allMoves[moveId], next.state.target)).toBe(BattlerIndex.ENEMY);
  });

  it("keeps simultaneous users' counters and Defense Curl flags independent", () => {
    const first = beginRollingMove(players[0], MoveId.ROLLOUT, BattlerIndex.ENEMY);
    players[0].summonData.defenseCurled = true;
    players[0].getMoveHistory().push({
      move: MoveId.ROLLOUT,
      targets: [BattlerIndex.ENEMY],
      result: MoveResult.SUCCESS,
      useMode: MoveUseMode.NORMAL,
    });
    finishRollingMove(first);
    const second = beginRollingMove(players[1], MoveId.ROLLOUT, BattlerIndex.ENEMY_2);
    expect(first.state.count).toBe(1);
    expect(second.state.count).toBe(0);
    expect(players[1].summonData.defenseCurled).toBe(false);
    finishRollingMove(second);
    expect(players[1].summonData.rollingMove).toBeUndefined();
    expect(players[0].summonData.rollingMove?.count).toBe(1);
    expect(players[0].getMoveQueue()).toHaveLength(1);
  });
});
