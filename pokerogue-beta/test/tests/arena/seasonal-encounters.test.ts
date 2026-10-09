import { isHauntingSeason, SeasonalEncounterState } from "#data/seasonal-encounters";
import { describe, expect, it, vi } from "vitest";

describe("Seasonal Haunting pity", () => {
  it.each([
    ["2026-09-30T23:59:59Z", false],
    ["2026-10-01T00:00:00Z", true],
    ["2026-10-31T23:59:59Z", true],
    ["2026-11-01T00:00:00Z", false],
    ["2027-10-15T00:00:00Z", true],
  ])("uses an annually recurring October season: %s", (date, active) => {
    expect(isHauntingSeason(new Date(date))).toBe(active);
  });

  it("increases from 2% by one point per miss, capped at 25%", () => {
    const state = new SeasonalEncounterState({ active: true });
    expect(state.getChance()).toBe(2);
    for (let wave = 11; wave <= 60; wave++) {
      expect(state.roll(wave, () => 99)).toBe(false);
      expect(state.getChance()).toBe(Math.min(2 + wave - 10, 25));
    }
  });

  it("resets pity and skips three ordinary battles after a Haunting", () => {
    const state = new SeasonalEncounterState({ active: true, misses: 15 });
    const roll = vi.fn(() => 0);
    expect(state.roll(11, roll)).toBe(true);
    expect(state.getChance()).toBe(2);
    // Gaps in wave numbers represent protected waves which never call the scheduler.
    for (const wave of [12, 14, 17]) {
      expect(state.roll(wave, roll)).toBe(false);
    }
    expect(roll).toHaveBeenCalledTimes(1);
    expect(state.roll(18, roll)).toBe(true);
    expect(roll).toHaveBeenCalledTimes(2);
  });

  it.each([0, 99])("does not reroll or increment twice on the same wave (%i)", value => {
    const state = new SeasonalEncounterState({ active: true });
    const first = state.roll(11, () => value);
    const restored = new SeasonalEncounterState(JSON.parse(JSON.stringify(state)));
    const reroll = vi.fn(() => 100 - value);
    expect(restored.roll(11, reroll)).toBe(first);
    expect(restored).toEqual(state);
    expect(reroll).not.toHaveBeenCalled();
  });

  it("keeps the saved season active after October, and disables old saves by default", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-12-01T00:00:00Z"));
      expect(new SeasonalEncounterState({ active: true }).roll(11, () => 0)).toBe(true);
      expect(new SeasonalEncounterState().roll(11, () => 0)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops spawning permanently for the run after Pokemon Tower's completion hook", () => {
    const state = new SeasonalEncounterState({ active: true, misses: 20 });
    state.resolveHauntings();
    const restored = new SeasonalEncounterState(JSON.parse(JSON.stringify(state)));
    const roll = vi.fn(() => 0);
    expect(restored.hauntingsResolved).toBe(true);
    expect(restored.misses).toBe(0);
    expect(restored.roll(50, roll)).toBe(false);
    expect(roll).not.toHaveBeenCalled();
  });

  it("normalizes invalid saved counters", () => {
    const state = new SeasonalEncounterState({ misses: Infinity, battlesUntilEligible: -1, lastProcessedWave: NaN });
    expect(state.misses).toBe(0);
    expect(state.battlesUntilEligible).toBe(0);
    expect(state.lastProcessedWave).toBe(0);
  });
});
