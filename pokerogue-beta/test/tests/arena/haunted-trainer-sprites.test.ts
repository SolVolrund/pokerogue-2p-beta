import { Battle } from "#app/battle";
import { BattleType } from "#enums/battle-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { BattlePhase } from "#phases/battle-phase";
import { TrainerData } from "#system/trainer-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

class TrainerDialoguePhase extends BattlePhase {
  public readonly phaseName = "TrainerVictoryPhase";
}

describe("Haunted trainer sprites", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    // Use real Phaser children so ordering, visibility, transforms and destruction are exercised.
    vi.spyOn(game.scene, "addFieldSprite").mockImplementation((x, y, texture) =>
      new Phaser.GameObjects.Sprite(game.scene, x, y, texture).setSize(80, 80),
    );
    vi.spyOn(Phaser.GameObjects.Sprite.prototype, "play").mockReturnThis();
    vi.spyOn(game.scene.textures, "exists").mockImplementation(key => key === "haunting_spirit");
    const animations = new Set<string>();
    vi.spyOn(game.scene.anims, "exists").mockImplementation(key => animations.has(key));
    vi.spyOn(game.scene.anims, "create").mockImplementation(config => {
      if (config.key) animations.add(config.key);
      return false;
    });
  });

  function spirits(trainer: Trainer): Phaser.GameObjects.Sprite[] {
    return trainer.list.filter(child => child.name === "haunting_spirit") as Phaser.GameObjects.Sprite[];
  }

  function makeTrainer(count: 1 | 2 | 3 = 1, haunted = true): Trainer {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    trainer.haunted = haunted;
    trainer.initSprite();
    return trainer;
  }

  it.each([1, 2, 3] as const)("leaves ordinary rendering unchanged with %i trainers", count => {
    const trainer = makeTrainer(count, false);
    expect(spirits(trainer)).toHaveLength(0);
    expect(trainer.list).toEqual(trainer.getSprites().flatMap((sprite, index) => [sprite, trainer.getTintSprites()[index]]));
    expect(game.scene.anims.create).not.toHaveBeenCalled();
  });

  it.each([1, 2, 3] as const)("keeps one spirit behind each of %i trainer bodies with the preview alignment", count => {
    const trainer = makeTrainer(count);
    const bodies = trainer.getSprites();
    const tints = trainer.getTintSprites();
    expect(bodies).toHaveLength(count);
    expect(spirits(trainer)).toHaveLength(count);
    spirits(trainer).forEach((spirit, index) => {
      expect(trainer.list.indexOf(spirit)).toBeLessThan(trainer.list.indexOf(bodies[0]));
      expect([spirit.x, spirit.y]).toEqual([bodies[index].x, bodies[index].y + 4]);
      expect([spirit.originX, spirit.originY, spirit.scaleX, spirit.scaleY, spirit.alpha]).toEqual([0.5, 1, 1, 1, 1]);
      expect(spirit.parentContainer).toBe(trainer);
      expect(tints).not.toContain(spirit);
    });
    trainer.initSprite();
    expect(spirits(trainer)).toHaveLength(count);
    expect(trainer.getSprites()).toEqual(bodies);
    expect(trainer.getTintSprites()).toEqual(tints);
    expect(game.scene.anims.create).toHaveBeenCalledTimes(1);
    const config = vi.mocked(game.scene.anims.create).mock.calls[0][0];
    expect(config.frameRate).toBe(12);
    expect(config.repeat).toBe(-1);
    expect((config.frames as Phaser.Types.Animations.AnimationFrame[]).map(frame => frame.frame)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0,
    ]);
  });

  it("uses one spirit for a paired trainer drawn as a single composite sprite", () => {
    const trainer = new Trainer(TrainerType.TWINS, TrainerVariant.DOUBLE);
    trainer.haunted = true;
    trainer.initSprite();
    expect(trainer.getSprites()).toHaveLength(1);
    expect(spirits(trainer)).toHaveLength(1);
  });

  it("follows the selected dialogue partner and restores all spirits for group dialogue", () => {
    const trainer = makeTrainer(3);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 52,
      battleType: BattleType.TRAINER,
      trainer,
      double: true,
    });
    const phase = new TrainerDialoguePhase();
    phase.showEnemyTrainer(TrainerSlot.TRAINER_PARTNER_2);
    expect(spirits(trainer).map(sprite => sprite.visible)).toEqual([false, false, true]);
    expect(spirits(trainer)[2].x).toBe(0);
    phase.showEnemyTrainer();
    expect(spirits(trainer).map(sprite => sprite.visible)).toEqual([true, true, true]);
    expect(spirits(trainer).map(sprite => sprite.x)).toEqual([-16, 0, 16]);
  });

  it("recreates the visual after save/load, but never serializes sprite objects", () => {
    const source = makeTrainer(2);
    const saved = JSON.parse(JSON.stringify(new TrainerData(source)));
    expect(saved.haunted).toBe(true);
    expect(saved.hauntedSprites).toBeUndefined();
    const restored = new TrainerData(saved).toTrainer();
    restored.initSprite();
    expect(spirits(restored)).toHaveLength(2);
  });

  it("destroys spirits with their parent and removes them if Haunted is cleared", () => {
    const trainer = makeTrainer();
    const first = spirits(trainer)[0];
    trainer.haunted = false;
    trainer.syncHauntedSprites();
    expect(spirits(trainer)).toHaveLength(0);
    expect(first.scene).toBeUndefined();
    trainer.haunted = true;
    trainer.syncHauntedSprites();
    const next = spirits(trainer)[0];
    trainer.destroy();
    expect(next.scene).toBeUndefined();
  });

  it("does not create missing-texture sprites when the asset has not loaded", () => {
    vi.mocked(game.scene.textures.exists).mockReturnValue(false);
    const trainer = makeTrainer();
    expect(spirits(trainer)).toHaveLength(0);
  });

  it("queues only the twelve occupied sheet cells, and reuses an already-loaded texture", async () => {
    const trainer = makeTrainer();
    const load = vi.spyOn(game.scene.load, "spritesheet");
    vi.mocked(game.scene.textures.exists).mockReturnValue(false);
    await trainer.loadAssets();
    expect(load).toHaveBeenCalledWith(
      "haunting_spirit",
      expect.stringContaining("images/trainer/haunting_spirit.png"),
      {
        frameWidth: 59,
        frameHeight: 127,
        endFrame: 11,
      },
    );
    load.mockClear();
    vi.mocked(game.scene.textures.exists).mockReturnValue(true);
    await trainer.loadAssets();
    expect(load).not.toHaveBeenCalled();
    vi.mocked(game.scene.textures.exists).mockReturnValue(false);
    trainer.haunted = false;
    await trainer.loadAssets();
    expect(load).not.toHaveBeenCalled();
  });
});
