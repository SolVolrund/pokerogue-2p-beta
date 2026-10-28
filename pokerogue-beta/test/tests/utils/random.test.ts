/*
 * SPDX-FileCopyrightText: 2024-2025 Pagefault Games
 * SPDX-FileContributor: SirzBenjie
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { GameManager } from "#test/framework/game-manager";
import * as common from "#utils/common";
import { randSeedUniqueItem, weightedPick } from "#utils/random";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Utils - Random", () => {
  let phaserGame: Phaser.Game;

  describe("weightedPick", () => {
    let originalState: string;

    beforeEach(() => {
      originalState = Phaser.Math.RND.state();
      Phaser.Math.RND.sow(["weighted-pick-regression"]);
    });

    afterEach(() => {
      Phaser.Math.RND.state(originalState);
    });

    it.each<[number, string]>([
      [0, "first"],
      [1, "first"],
      [2, "second"],
      [4, "second"],
    ])("preserves weight boundaries and skips zero weights at roll %i", (roll, expected) => {
      const random = vi.spyOn(common, "randSeedInt").mockReturnValue(roll);
      const weights = new Map([
        ["zero-before", 0],
        ["first", 2],
        ["zero-between", 0],
        ["second", 3],
        ["zero-after", 0],
      ]);
      expect(weightedPick(weights)).toBe(expected);
      expect(random).toHaveBeenCalledExactlyOnceWith(5);
    });

    it("rejects an empty map without consuming RNG", () => {
      const state = Phaser.Math.RND.state();
      const random = vi.spyOn(common, "randSeedInt");
      expect(() => weightedPick(new Map())).toThrow("Input to `weightedPick` function has no items!");
      expect(random).not.toHaveBeenCalled();
      expect(Phaser.Math.RND.state()).toBe(state);
    });

    it.each([
      [0, 0],
      [-3, 1],
    ])("returns the first actual key when weights total zero or less (%i, %i)", (firstWeight, secondWeight) => {
      const first = { id: "first" };
      const weights = new Map([
        [first, firstWeight],
        [{ id: "second" }, secondWeight],
      ]);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const state = Phaser.Math.RND.state();
      expect(weightedPick(weights)).toBe(first);
      expect(warning).toHaveBeenCalledExactlyOnceWith(expect.any(String), weights);
      expect(Phaser.Math.RND.state()).toBe(state);
    });

    it("does not consume RNG when the total weight is one", () => {
      const state = Phaser.Math.RND.state();
      expect(
        weightedPick(
          new Map([
            ["unavailable", 0],
            ["only", 1],
          ]),
        ),
      ).toBe("only");
      expect(Phaser.Math.RND.state()).toBe(state);
    });

    // Reference the previous algorithm for valid pools to catch changes to seeded results or draw counts.
    function previousWeightedPick<T>(weights: Map<T, number>): T {
      const total = [...weights.values()].reduce((sum, weight) => sum + weight, 0);
      const roll = common.randSeedInt(total);
      let cumulative = 0;
      for (const [key, weight] of weights) {
        cumulative += weight;
        if (roll < cumulative) {
          return key;
        }
      }
      throw new Error("Invalid reference pool");
    }

    it.each([
      [0, 2, 0, 3, 11],
      [0, 0, 1, 0, 0],
      [100, 75, 150, 110, 90],
      [10_000, 1, 0, 500, 40],
    ])("matches the old selection and RNG progression for weights %j", (...weights) => {
      const pool = new Map(weights.map((weight, index) => [index, weight]));
      const entries = [...pool];
      for (let seed = 0; seed < 32; seed++) {
        Phaser.Math.RND.sow([`weighted-regression-${seed}`]);
        const start = Phaser.Math.RND.state();
        const expected = Array.from({ length: 64 }, () => previousWeightedPick(pool));
        const expectedState = Phaser.Math.RND.state();
        Phaser.Math.RND.state(start);
        expect(Array.from({ length: 64 }, () => weightedPick(pool))).toEqual(expected);
        expect(Phaser.Math.RND.state()).toBe(expectedState);
      }
      expect([...pool]).toEqual(entries);
    });

    it("replays the same next rolls after restoring a saved RNG state", () => {
      const pool = new Map([
        ["a", 3],
        ["b", 7],
        ["c", 1],
      ]);
      weightedPick(pool);
      const savedState = Phaser.Math.RND.state();
      const expected = Array.from({ length: 50 }, () => weightedPick(pool));
      const expectedState = Phaser.Math.RND.state();
      Phaser.Math.RND.state(savedState);
      expect(Array.from({ length: 50 }, () => weightedPick(pool))).toEqual(expected);
      expect(Phaser.Math.RND.state()).toBe(expectedState);
    });
  });

  describe("randSeedUniqueItem", () => {
    // TODO: Remove `initialization of game` once `randSeedUniqueItem` stops using `executeWithSeedOffset`
    beforeAll(() => {
      phaserGame = new Phaser.Game({
        type: Phaser.HEADLESS,
      });
    });

    beforeEach(() => {
      new GameManager(phaserGame);
    });

    it("should prevent duplicates when provided with different offsets", async () => {
      const choices = ["a", "b", "c", "d"];
      const choice1 = randSeedUniqueItem(choices, 0);
      const choice2 = randSeedUniqueItem(choices, 1);
      const choice3 = randSeedUniqueItem(choices, 2);
      expect(choice2).not.toEqual(choice1);
      expect(choice2).not.toEqual(choice3);
      expect(choice1).not.toEqual(choice3);
    });

    it("should gracefully handle an offset larger than the choices", () => {
      const choices = ["a", "b", "c"];
      // 1) the function must not throw
      // 2) The output must be one of the choices
      const choice = randSeedUniqueItem(choices, 5);
      expect(choices).toContain(choice);
    });
  });
});
