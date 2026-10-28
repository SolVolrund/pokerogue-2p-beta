import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import { getCachedUrl } from "#utils/fetch-utils";
import Phaser from "phaser";

const FRAME_COUNT = 99;
const FRAME_MS = 50;
const SOUND_KEY = "battle_anims/yes.wav";

/** The lab exports full-screen frames, rather than the ordinary 96px particle sheets. */
export function loadYesAnimationAssets(): void {
  for (const direction of ["player", "enemy"]) {
    const key = `yes-${direction}`;
    if (!globalScene.textures.exists(key)) {
      globalScene.load.spritesheet(key, getCachedUrl(`images/battle_anims/${key}.png`), {
        frameWidth: 320,
        frameHeight: 180,
        endFrame: FRAME_COUNT - 1,
      });
    }
  }
  if (!globalScene.cache.audio.exists(SOUND_KEY)) {
    globalScene.loadSe("yes.wav", "battle_anims", "yes.wav");
  }
}

export function playYesAnimation(user: Pokemon, callback?: () => void): void {
  const key = `yes-${user.isPlayer() ? "player" : "enemy"}`;
  if (!globalScene.moveAnimations || !globalScene.textures.exists(key)) {
    callback?.();
    return;
  }
  const sprite = globalScene.add.image(0, 0, key, 0).setOrigin(0);
  globalScene.field.add(sprite);
  // Timers are accelerated by the game's speed wrapper; match the sound to that rate.
  const sound = audioManager.playSound(SOUND_KEY, { rate: globalScene.gameSpeed });
  let frame = 0;
  const frames = globalScene.time.addEvent({
    delay: FRAME_MS,
    repeat: FRAME_COUNT - 1,
    callback: () => {
      frame++;
      if (frame < FRAME_COUNT) {
        sprite.setFrame(frame);
      } else {
        sprite.destroy();
      }
    },
  });
  const cleanup = () => {
    frames.remove();
    sprite.destroy();
    sound?.stop();
  };
  globalScene.events.once(Phaser.Scenes.Events.SHUTDOWN, cleanup);
  // Keep the audio tail instead of truncating it to the 4.95-second sheet.
  globalScene.time.delayedCall(Math.max(FRAME_COUNT * FRAME_MS, (sound?.duration ?? 0) * 1000), () => {
    globalScene.events.off(Phaser.Scenes.Events.SHUTDOWN, cleanup);
    cleanup();
    callback?.();
  });
}
