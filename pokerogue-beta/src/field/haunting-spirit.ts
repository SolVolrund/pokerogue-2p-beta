import { globalScene } from "#app/global-scene";
import { getCachedUrl } from "#utils/fetch-utils";

export const HAUNTING_SPIRIT_KEY = "haunting_spirit";
// Four extra rows in each frame round off the shadow below the trainer's feet.
export const HAUNTING_SPIRIT_FOOT_OFFSET = 4;
const frames = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

export function loadHauntingSpirit(): void {
  if (!globalScene.textures.exists(HAUNTING_SPIRIT_KEY)) {
    globalScene.load.spritesheet(HAUNTING_SPIRIT_KEY, getCachedUrl("images/trainer/haunting_spirit.png"), {
      frameWidth: 59, frameHeight: 127, endFrame: 11,
    });
  }
}

export function registerHauntingSpiritAnimation(): void {
  if (!globalScene.anims.exists(HAUNTING_SPIRIT_KEY) && globalScene.textures.exists(HAUNTING_SPIRIT_KEY)) {
    globalScene.anims.create({
      key: HAUNTING_SPIRIT_KEY, frames: frames.map(frame => ({ key: HAUNTING_SPIRIT_KEY, frame })), frameRate: 12, repeat: -1,
    });
  }
}
