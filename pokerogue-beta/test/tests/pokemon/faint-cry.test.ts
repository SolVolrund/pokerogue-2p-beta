import type { BattleScene } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { Pokemon } from "#field/pokemon";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Faint cry animation", () => {
  let previousScene: BattleScene;
  let tick: () => void;
  let failsafe: () => void;
  const timer = { destroy: vi.fn() };

  beforeEach(() => {
    previousScene = globalScene;
    timer.destroy.mockClear();
    initGlobalScene({
      time: {
        addEvent: (config: { callback: () => void }) => {
          tick = config.callback;
          return timer;
        },
        delayedCall: (_delay: number, callback: () => void) => {
          failsafe = callback;
        },
      },
    } as unknown as BattleScene);
    vi.spyOn(audioManager, "getVolume").mockReturnValue(1);
  });

  afterEach(() => {
    initGlobalScene(previousScene);
  });

  function setup(fused: boolean, msPerFrame: number) {
    let durationReads = 0;
    const anims = {
      msPerFrame,
      pause: vi.fn(),
      nextFrame: vi.fn(),
      get duration() {
        // Fail a zero-threshold loop without locking the test worker itself.
        if (++durationReads > 20) {
          throw new Error("Non-terminating faint animation loop");
        }
        return msPerFrame > 0 ? 1000 : 0;
      },
    };
    const cry = {
      totalDuration: 1,
      pendingRemove: false,
      isPlaying: true,
      setRate: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    };
    const fusionCry = { ...cry, pendingRemove: true, isPlaying: false };
    vi.spyOn(audioManager, "playSound")
      .mockReturnValueOnce(cry as unknown as Phaser.Sound.WebAudioSound)
      .mockReturnValueOnce(fusionCry as unknown as Phaser.Sound.WebAudioSound);
    const pokemon = {
      species: { getCryKey: () => "cry" },
      formIndex: 0,
      fusionSpecies: fused ? { getCryKey: () => "fusion-cry" } : undefined,
      fusionFormIndex: 0,
      getSpeciesForm: () => "base",
      getFusionSpeciesForm: () => "fusion",
      fusionFaintCry: Pokemon.prototype["fusionFaintCry"],
      isPlayer: () => false,
      getSprite: () => ({ anims }),
      getTintSprite: () => undefined,
    } as unknown as Pokemon;
    const complete = vi.fn();
    Pokemon.prototype.faintCry.call(pokemon, complete);
    return { anims, cry, complete };
  }

  it.each([false, true])("finishes a static sprite's cry without looping (fused: %s)", fused => {
    const { anims, cry, complete } = setup(fused, 0);
    expect(() => tick()).not.toThrow();
    expect(anims.nextFrame).not.toHaveBeenCalled();
    expect(cry.setRate).toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    cry.pendingRemove = true;
    tick();
    expect(timer.destroy).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
    failsafe();
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([false, true])("still advances animated sprites (fused: %s)", fused => {
    const { anims, cry, complete } = setup(fused, 20);
    tick();
    expect(anims.nextFrame).toHaveBeenCalledTimes(2);
    cry.pendingRemove = true;
    tick();
    expect(complete).toHaveBeenCalledOnce();
  });

  it.each([false, true])("keeps the audio failsafe for static sprites (fused: %s)", fused => {
    const { cry, complete } = setup(fused, 0);
    tick();
    failsafe();
    expect(cry.stop).toHaveBeenCalled();
    expect(timer.destroy).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });
});
