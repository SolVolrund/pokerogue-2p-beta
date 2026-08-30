import type { BattleScene } from "#app/battle-scene";
import type { GameModes } from "#enums/game-modes";

export type DejaVuGhostRunKey = string;

export function getDejaVuGhostRunKey(
  scene: BattleScene,
  mode: GameModes = scene.gameMode.modeId,
): DejaVuGhostRunKey {
  if (!scene.twoPlayerMode) {
    return `${mode}:single`;
  }

  const modeKind = scene.twoPlayerVsMode ? "vs" : "coop";
  return `${mode}:${modeKind}-${scene.multiplayerPlayerCount}p-${scene.twoPlayerPartySize}`;
}
