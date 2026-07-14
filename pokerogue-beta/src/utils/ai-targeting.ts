import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { getMoveTargets, isForcedDuelAlly, isForcedDuelOpponent } from "#moves/move-utils";
import type { MoveTargetSet } from "#types/move-target-set";
import { areBattlerIndexesAllies } from "#utils/battler-index-utils";

export interface AiMoveTargetData {
  targetSet: MoveTargetSet;
  allTargets: Pokemon[];
  selectableTargets: Pokemon[];
  opponentTargets: Pokemon[];
  lacksRequiredOpponent: boolean;
}

export function getAiMoveTargetData(user: Pokemon, moveId: MoveId): AiMoveTargetData {
  const move = allMoves[moveId];
  const targetSet = getMoveTargets(user, moveId);
  const allTargets = globalScene
    .getField(true)
    .filter(pokemon => targetSet.targets.includes(pokemon.getBattlerIndex()));
  const opponentTargets = allTargets.filter(target => user.isOpponent(target));
  const requiresOpponent = isAiOpponentSeekingMove(move);
  const lacksRequiredOpponent = requiresOpponent && opponentTargets.length === 0;
  const selectableTargets =
    !targetSet.multiple && requiresOpponent && !lacksRequiredOpponent ? opponentTargets : allTargets;

  return {
    targetSet,
    allTargets,
    selectableTargets: lacksRequiredOpponent ? [] : selectableTargets,
    opponentTargets,
    lacksRequiredOpponent,
  };
}

export function shouldAiRepositionToCenter(user: Pokemon): boolean {
  if ((globalScene.currentBattle?.getBattlerCount() ?? 1) < 3 || user.fieldPosition === FieldPosition.CENTER) {
    return false;
  }

  const activeAllies = globalScene
    .getField(true)
    .filter(target => target !== user && !user.isOpponent(target) && !isForcedDuelOpponent(user, target));
  if (activeAllies.length > 0) {
    return false;
  }

  const opponents = globalScene.getField(true).filter(target => target !== user && user.isOpponent(target));
  return opponents.length > 0 && !opponents.some(target => areAiBattlersAdjacent(user, target));
}

function isAiOpponentSeekingMove(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.NEAR_OTHER:
    case MoveTarget.OTHER:
    case MoveTarget.ALL_NEAR_OTHERS:
    case MoveTarget.ALL_OTHERS:
    case MoveTarget.NEAR_ENEMY:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.RANDOM_NEAR_ENEMY:
    case MoveTarget.ENEMY_SIDE:
      return true;
    default:
      return false;
  }
}

function areAiBattlersAdjacent(user: Pokemon, target: Pokemon): boolean {
  const userIndex = user.getBattlerIndex();
  const targetIndex = target.getBattlerIndex();

  if (userIndex === targetIndex || userIndex === BattlerIndex.ATTACKER || targetIndex === BattlerIndex.ATTACKER) {
    return false;
  }

  if (isForcedDuelOpponent(user, target) || isForcedDuelAlly(user, target)) {
    return true;
  }

  const userCenter = user.fieldPosition === FieldPosition.CENTER;
  const targetCenter = target.fieldPosition === FieldPosition.CENTER;

  if (areBattlerIndexesAllies(userIndex, targetIndex)) {
    return userCenter || targetCenter;
  }

  return userCenter || targetCenter || user.fieldPosition === target.fieldPosition;
}
