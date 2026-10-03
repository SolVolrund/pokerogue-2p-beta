interface TrainerThrowTiming {
  /** Time at which the ball (or Safari item) starts moving. */
  releaseDelay?: number;
  /** Preserve the original timing for three-frame trainer sheets. */
  windupDelay?: number;
  frameDuration?: number;
}

const activeThrows = new WeakMap<Phaser.GameObjects.Sprite, object>();

/** Animate the numbered frames of the trainer's current throwing atlas. */
export function playTrainerThrowAnimation(
  sprite: Phaser.GameObjects.Sprite,
  { releaseDelay = 750, windupDelay = 562, frameDuration = 64 }: TrainerThrowTiming = {},
): void {
  const texture = sprite.texture;
  const frames = texture
    .getFrameNames()
    .filter(name => /^\d+$/.test(name))
    .sort((a, b) => Number(a) - Number(b));
  const playback = {};
  activeThrows.set(sprite, playback);
  if (frames.length === 0) {
    return;
  }

  sprite.setFrame(frames[0]);
  // Longer sheets finish with a release pose followed by a follow-through pose.
  const releaseIndex = frames.length - 2;
  const poseDuration = frames.length > 3 ? Math.min(frameDuration, releaseDelay / (releaseIndex - 1)) : frameDuration;
  frames.slice(1).forEach((frame, index) => {
    const delay =
      frames.length > 3
        ? releaseDelay + (index + 1 - releaseIndex) * poseDuration
        : windupDelay + index * frameDuration;
    sprite.scene.time.delayedCall(delay, () => {
      if (sprite.scene && sprite.texture === texture && activeThrows.get(sprite) === playback) {
        sprite.setFrame(frame);
      }
    });
  });
}
