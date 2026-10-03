import { playTrainerThrowAnimation } from "#utils/trainer-throw-animation";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function createTrainer(frames: string[]) {
  let now = 0;
  const changes: { at: number; frame: string }[] = [];
  const timers: { at: number; callback: () => void }[] = [];
  const sprite = {
    texture: { getFrameNames: () => frames },
    scene: {
      time: {
        delayedCall: (delay: number, callback: () => void) => {
          timers.push({ at: now + delay, callback });
        },
      },
    },
    setFrame: (frame: string) => changes.push({ at: now, frame }),
  } as unknown as Phaser.GameObjects.Sprite;

  function advanceTo(time: number): void {
    timers.sort((a, b) => a.at - b.at);
    while (timers.length > 0 && timers[0].at <= time) {
      const timer = timers.shift()!;
      now = timer.at;
      timer.callback();
    }
    now = time;
  }

  return { sprite, changes, timers, advanceTo };
}

function readTrainerFrames(key: string): string[] {
  const atlas = JSON.parse(readFileSync(`assets/images/trainer/${key}.json`, "utf8")) as {
    textures: { frames: { filename: string }[] }[];
  };
  return atlas.textures.flatMap(texture => texture.frames.map(frame => frame.filename));
}

describe("Trainer throw animation", () => {
  it.each([
    { releaseDelay: 750, windupDelay: 562, frameDuration: 64 },
    { releaseDelay: 512, windupDelay: 512, frameDuration: 256 },
    { releaseDelay: 512, windupDelay: 512, frameDuration: 184 },
  ])("preserves three-frame timing: $windupDelay / $frameDuration", timing => {
    const trainer = createTrainer(readTrainerFrames("cheryl_back_pb"));
    playTrainerThrowAnimation(trainer.sprite, timing);
    trainer.advanceTo(2000);
    expect(trainer.changes).toEqual([
      { at: 0, frame: "1" },
      { at: timing.windupDelay, frame: "2" },
      { at: timing.windupDelay + timing.frameDuration, frame: "3" },
    ]);
  });

  it.each([
    "bianca_pb",
    "duplica_back_mid117_pb",
    "bianca_latias_back_pb",
    "duplica_ditto_back_mid117_pb",
    "molly_hale_back_pb",
    "whitney_back_pb",
    "sabrina_back_pb",
    "amber_two_back_pb",
  ])("plays every pose of %s with frame 4 at ball release", key => {
    const trainer = createTrainer(readTrainerFrames(key));
    playTrainerThrowAnimation(trainer.sprite);
    trainer.advanceTo(749);
    expect(trainer.changes).toEqual([
      { at: 0, frame: "1" },
      { at: 622, frame: "2" },
      { at: 686, frame: "3" },
    ]);
    trainer.advanceTo(750);
    expect(trainer.changes.at(-1)).toEqual({ at: 750, frame: "4" });
    trainer.advanceTo(1000);
    expect(trainer.changes.at(-1)).toEqual({ at: 814, frame: "5" });
    expect(trainer.changes).toHaveLength(5);
  });

  it("cuts Dawn?'s packed poses at their actual boundaries and aligns their bottoms", () => {
    const atlas = JSON.parse(readFileSync("assets/images/trainer/dawn_zorua_back_pb.json", "utf8"));
    const frames = atlas.textures[0].frames;
    expect(frames.map(({ frame }) => frame)).toEqual([
      { x: 3, y: 0, w: 56, h: 71 },
      { x: 3, y: 71, w: 54, h: 68 },
      { x: 3, y: 139, w: 77, h: 69 },
    ]);
    for (const { frame, spriteSourceSize, sourceSize } of frames) {
      expect(spriteSourceSize.y + spriteSourceSize.h).toBe(sourceSize.h);
      expect(spriteSourceSize.h).toBe(frame.h);
      expect(sourceSize).toEqual({ w: 80, h: 80 });
    }
  });

  it("uses AmberTwo's five fixed cells without borders or the empty sixth cell", () => {
    const atlas = JSON.parse(readFileSync("assets/images/trainer/amber_two_back_pb.json", "utf8"));
    expect(atlas.textures[0].size).toEqual({ w: 164, h: 246 });
    expect(atlas.textures[0].frames.map(({ frame }) => frame)).toEqual([
      { x: 1, y: 1, w: 80, h: 80 },
      { x: 83, y: 1, w: 80, h: 80 },
      { x: 1, y: 83, w: 80, h: 80 },
      { x: 83, y: 83, w: 80, h: 80 },
      { x: 1, y: 165, w: 80, h: 80 },
    ]);
  });

  it.each([184, 256])("aligns five-frame event throws without delaying the event: %d ms poses", frameDuration => {
    const trainer = createTrainer(["1", "2", "3", "4", "5"]);
    playTrainerThrowAnimation(trainer.sprite, { releaseDelay: 512, windupDelay: 512, frameDuration });
    trainer.advanceTo(512 + frameDuration);
    expect(trainer.changes).toEqual([
      { at: 0, frame: "1" },
      { at: 512 - 2 * frameDuration, frame: "2" },
      { at: 512 - frameDuration, frame: "3" },
      { at: 512, frame: "4" },
      { at: 512 + frameDuration, frame: "5" },
    ]);
    expect(trainer.timers).toHaveLength(0);
  });

  it("orders numbered frames numerically and ignores non-pose frames", () => {
    const trainer = createTrainer(["__BASE", "10", "2", "idle", "1", "4", "3"]);
    playTrainerThrowAnimation(trainer.sprite);
    trainer.advanceTo(2000);
    expect(trainer.changes.map(change => change.frame)).toEqual(["1", "2", "3", "4", "10"]);
  });

  it("fits longer sheets into the available windup without negative timers", () => {
    const trainer = createTrainer(Array.from({ length: 10 }, (_, index) => String(index + 1)));
    playTrainerThrowAnimation(trainer.sprite, { releaseDelay: 100 });
    expect(trainer.timers.every(timer => timer.at >= 0)).toBe(true);
    trainer.advanceTo(1000);
    expect(trainer.changes).toHaveLength(10);
    expect(trainer.changes.find(change => change.frame === "9")?.at).toBe(100);
  });

  it("does not let an earlier throw overwrite a restarted animation", () => {
    const trainer = createTrainer(["1", "2", "3", "4", "5"]);
    playTrainerThrowAnimation(trainer.sprite);
    trainer.advanceTo(700);
    trainer.changes.length = 0;
    playTrainerThrowAnimation(trainer.sprite);
    trainer.advanceTo(1200);
    expect(trainer.changes).toEqual([{ at: 700, frame: "1" }]);
    trainer.advanceTo(2000);
    expect(trainer.changes.map(change => change.frame)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("does not apply throw frames to a different texture", () => {
    const trainer = createTrainer(["1", "2", "3", "4", "5"]);
    playTrainerThrowAnimation(trainer.sprite);
    trainer.sprite.texture = {} as Phaser.Textures.Texture;
    trainer.advanceTo(2000);
    expect(trainer.changes).toEqual([{ at: 0, frame: "1" }]);
  });

  it("ignores callbacks after the sprite is destroyed", () => {
    const trainer = createTrainer(["1", "2", "3", "4", "5"]);
    playTrainerThrowAnimation(trainer.sprite);
    Object.assign(trainer.sprite, { scene: undefined });
    trainer.advanceTo(2000);
    expect(trainer.changes).toEqual([{ at: 0, frame: "1" }]);
  });

  it("keeps simultaneous trainers independent", () => {
    const first = createTrainer(["1", "2", "3"]);
    const second = createTrainer(["1", "2", "3", "4", "5"]);
    playTrainerThrowAnimation(first.sprite);
    playTrainerThrowAnimation(second.sprite);
    first.advanceTo(1000);
    second.advanceTo(1000);
    expect(first.changes.map(change => change.frame)).toEqual(["1", "2", "3"]);
    expect(second.changes.map(change => change.frame)).toEqual(["1", "2", "3", "4", "5"]);
  });

  it.each([{ frames: [] }, { frames: ["1"] }])("handles an atlas without animated poses: $frames", ({ frames }) => {
    const trainer = createTrainer(frames);
    playTrainerThrowAnimation(trainer.sprite);
    expect(trainer.timers).toHaveLength(0);
    expect(trainer.changes.map(change => change.frame)).toEqual(frames);
  });
});
