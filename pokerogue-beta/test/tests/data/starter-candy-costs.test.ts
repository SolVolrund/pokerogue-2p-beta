import { getPassiveCandyCount, getSameSpeciesEggCandyCounts, getValueReductionCandyCounts } from "#balance/starters";
import { describe, expect, it } from "vitest";

describe("Starter Candy Costs", () => {
  it.each(
    [20, 20, 15, 12, 10, 8, 7, 6, 6, 5].map((cost, index) => [index + 1, cost]),
  )("prices %i-point starter eggs at %i candies", (points, cost) =>
    expect(getSameSpeciesEggCandyCounts(points)).toBe(cost));

  it("leaves passive and starter point reduction prices unchanged", () => {
    expect(Array.from({ length: 10 }, (_, i) => getPassiveCandyCount(i + 1))).toEqual([
      40, 40, 35, 30, 25, 20, 15, 10, 10, 10,
    ]);
    expect(Array.from({ length: 10 }, (_, i) => getValueReductionCandyCounts(i + 1))).toEqual([
      [25, 60],
      [25, 60],
      [20, 50],
      [15, 40],
      [12, 35],
      [10, 30],
      [8, 20],
      [5, 15],
      [5, 15],
      [5, 15],
    ]);
  });
});
