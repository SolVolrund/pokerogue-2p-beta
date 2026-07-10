import { MultiHitType } from "#enums/multi-hit-type";
import type { Move } from "#moves/move";

export function isLoadedDiceBoostedMove(move: Move): boolean {
  return move.getAttrs("MultiHitAttr").some(attr => attr.getIntrinsicMultiHitType() === MultiHitType.TWO_TO_FIVE);
}
