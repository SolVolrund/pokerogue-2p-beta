import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";

/** Name the action's owner in shared messages; retain second-person text in solo. */
export function getPlayerMessageOptions(playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
  return {
    context: globalScene.twoPlayerMode ? "named" : undefined,
    playerName: globalScene.getPlayerDisplayName(playerIndex),
  };
}
