import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { PhaseManager } from "#app/phase-manager";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("Phase manager dynamic markers", () => {
  let manager: PhaseManager;
  let previousScene: BattleScene;

  beforeEach(() => {
    previousScene = globalScene;
    initGlobalScene({
      executeWithSeedOffset: (callback: () => void) => callback(),
      currentBattle: { turn: 1 },
      turnCommandManager: {},
      arena: { applyTags: vi.fn() },
    } as unknown as BattleScene);
    manager = new PhaseManager();
    vi.spyOn(manager as any, "startCurrentPhase").mockImplementation(() => {});
  });

  afterEach(() => {
    initGlobalScene(previousScene);
  });

  it("skips cancelled dynamic markers without starting a turn or clearing surviving actions", () => {
    manager.pushNew("DynamicPhaseMarker", "MovePhase");
    manager.pushNew("DynamicPhaseMarker", "EnemyCommandPhase");
    const message = manager.create("MessagePhase", "Transition");
    manager.pushPhase(message);
    const clear = vi.spyOn(manager.dynamicQueueManager, "clearQueues");

    manager.shiftPhase();

    expect(manager.getCurrentPhase()).toBe(message);
    expect(clear).not.toHaveBeenCalled();
  });

  it("starts exactly one new turn when only cancelled markers remain", () => {
    manager.pushNew("DynamicPhaseMarker", "MovePhase");
    manager.pushNew("DynamicPhaseMarker", "MovePhase");
    const clear = vi.spyOn(manager.dynamicQueueManager, "clearQueues");

    manager.shiftPhase();
    expect(manager.getCurrentPhase().phaseName).toBe("TurnInitPhase");
    expect(clear).toHaveBeenCalledOnce();
    expect(manager.hasPhaseOfType("DynamicPhaseMarker")).toBe(false);
  });
});
