import type { BattlerIndex } from "#enums/battler-index";
import type { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import type { DamageResult } from "#types/damage-result";

export interface AttackMoveResult {
  move: MoveId;
  /** Resolved category of this hit; older records fall back to the move's default category. */
  category?: MoveCategory;
  result: DamageResult;
  damage: number;
  critical: boolean;
  sourceId: number;
  sourceBattlerIndex: BattlerIndex;
}
