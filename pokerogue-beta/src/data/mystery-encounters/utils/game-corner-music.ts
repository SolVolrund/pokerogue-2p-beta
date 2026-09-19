import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";

const GAME_CORNER_BGM_KEY = "game_corner";
let gameCornerBgmRequestId = 0;

export function startGameCornerBgm(): void {
  const requestId = ++gameCornerBgmRequestId;

  void globalScene
    .loadBgm(GAME_CORNER_BGM_KEY)
    .then(() => {
      if (requestId !== gameCornerBgmRequestId) {
        return;
      }
      audioManager.playBgm(GAME_CORNER_BGM_KEY, true);
    })
    .catch(error => {
      if (requestId !== gameCornerBgmRequestId) {
        return;
      }
      console.warn("Failed to load Game Corner BGM", error);
      audioManager.playBgm(undefined, true);
    });
}

export function restoreGameCornerBgm(): void {
  gameCornerBgmRequestId++;
  audioManager.playBgm(undefined, true);
}
