import type { PlayerIndex } from "#app/battle-scene";

export function getPlayerSelectCursorTexture(playerIndex: PlayerIndex | undefined): string {
  switch (playerIndex) {
    case 1:
      return "select_cursor_player_2";
    case 2:
      return "select_cursor_player_3";
    default:
      return "select_cursor";
  }
}
