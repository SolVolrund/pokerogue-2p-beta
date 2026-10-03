import type { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import type { Pokemon } from "#field/pokemon";

export interface RollingMoveState {
  move: MoveId;
  target: BattlerIndex;
  /** Successful attacks in this sequence, not individual Multi-Lens hits. */
  count: number;
}

export interface RollingMoveExecution {
  user: Pokemon;
  state: RollingMoveState;
  historyStart: number;
}

export function isRollingMove(move: MoveId): boolean {
  return move === MoveId.ROLLOUT || move === MoveId.ICE_BALL;
}

export function clearRollingMove(user: Pokemon): void {
  const state = user.summonData.rollingMove;
  if (state) {
    user.summonData.moveQueue = user.getMoveQueue().filter(entry => entry.move !== state.move);
    user.summonData.rollingMove = undefined;
  }
}

export function beginRollingMove(user: Pokemon, move: MoveId, target: BattlerIndex): RollingMoveExecution {
  let state = user.summonData.rollingMove;
  if (state?.move !== move || !user.getMoveQueue().some(entry => entry.move === move)) {
    state = { move, target, count: 0 };
    user.summonData.rollingMove = state;
  }
  return { user, state, historyStart: user.getMoveHistory().length };
}

/** Called after all hits and failure checks, so each attack advances the sequence only once. */
export function finishRollingMove({ user, state, historyStart }: RollingMoveExecution): void {
  if (user.summonData.rollingMove !== state) {
    return;
  }
  const results = user
    .getMoveHistory()
    .slice(historyStart)
    .filter(entry => entry.move === state.move);
  const succeeded = results.length > 0 && results.every(entry => entry.result === MoveResult.SUCCESS);
  if (!user.isActive(true) || !succeeded || ++state.count >= 5) {
    clearRollingMove(user);
    return;
  }
  user.pushMoveQueue({ move: state.move, targets: [state.target], useMode: MoveUseMode.IGNORE_PP });
}
