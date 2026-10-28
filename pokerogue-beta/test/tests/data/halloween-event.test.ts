import { timedEventManager } from "#app/global-event-manager";
import { SceneBase } from "#app/scene-base";
import { TimedEventManager } from "#app/timed-event-manager";
import { timedEvents } from "#balance/timed-events";
import { halloweenSprites } from "#data/halloween-cosmetics";
import { BiomeId } from "#enums/biome-id";
import { TrainerType } from "#enums/trainer-type";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("Halloween event and annual cosmetics", () => {
  afterEach(() => vi.useRealTimers());

  function at(date: string) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(date));
    return new TimedEventManager();
  }

  it.each([
    ["2026-09-30T23:59:59Z", false, false],
    ["2026-10-01T00:00:00Z", true, false],
    ["2026-10-23T00:00:01Z", true, true],
    ["2026-10-31T23:59:59Z", true, true],
    ["2026-11-01T00:00:00Z", false, true],
    ["2026-11-09T00:00:00Z", false, false],
    ["2027-10-15T00:00:00Z", true, false],
  ])("keeps cosmetics and bonuses separate at %s", (date, cosmetic, bonus) => {
    const manager = at(date);
    expect(manager.isHalloweenCosmeticsActive()).toBe(cosmetic);
    expect(manager.getEventImageReplacement("pkmn__sub")).toBe(cosmetic ? "subcharx" : null);
    expect(manager.getEventTrainerSpriteReplacement(TrainerType.RIVAL_6)).toBe(cosmetic ? "halloween_rival" : null);
    expect(manager.getEventBgmReplacement("title")).toBe(cosmetic ? "halloween_title" : "title");
    expect(manager.getShinyEncounterMultiplier()).toBe(bonus ? 2 : 1);
    expect(manager.getExtraCatchCandy()).toBe(bonus ? 1 : 0);
    expect(manager.isSootheBellBoosted()).toBe(bonus);
    expect(manager.getEventBiomeLinks(BiomeId.METROPOLIS)).toEqual(bonus ? [BiomeId.GRAVEYARD] : []);
  });

  it("provides the event rewards without duplicating the overlapping equipment event", () => {
    const manager = at("2026-10-28T12:00:00Z");
    expect(manager.getFixedBattleEventRewards(8)).toEqual(["SHINY_CHARM", "ABILITY_CHARM", "CATCHING_CHARM"]);
    expect(manager.getFixedBattleEventRewards(25)).toEqual(["SHINY_CHARM", "CANDY_JAR"]);
    expect(manager.getFixedBattleEventRewards(115)).toEqual(["MEGA_BRACELET", "DYNAMAX_BAND", "Z_RING"]);
    expect(manager.getEventDailyStartingItems()).toEqual(["ABILITY_CHARM", "SHINY_CHARM", "CANDY_JAR"]);
    expect(manager.getEventEncounters()).toHaveLength(32);
    expect(manager.getEventBiomeLinks(BiomeId.TALL_GRASS)).toEqual([BiomeId.GRAVEYARD]);
    expect(manager.getEventBiomeLinks(BiomeId.PLAINS)).toEqual([]);
  });

  it("keeps equipment rewards on their own upstream schedule, not an annual giveaway", () => {
    expect(at("2026-11-10T00:00:00Z").getFixedBattleEventRewards(115)).toEqual([
      "MEGA_BRACELET",
      "DYNAMAX_BAND",
      "Z_RING",
    ]);
    expect(at("2027-10-15T00:00:00Z").getFixedBattleEventRewards(115)).toEqual([]);
    expect(timedEvents.find(event => event.name === "Halloween 26")?.sprites).toBeUndefined();
  });

  it("disables cosmetics as well as bonuses for test scenes", () => {
    const manager = at("2026-10-28T12:00:00Z");
    manager.disable();
    expect(manager.getEventImageReplacement("logo")).toBeNull();
    expect(manager.getEventTrainerSpriteReplacement(TrainerType.RIVAL)).toBeNull();
    expect(manager.getEventBgmReplacement("title")).toBe("title");
    expect(manager.getFixedBattleEventRewards(115)).toEqual([]);
  });

  it("does not alter unrelated textures, trainers or music", () => {
    const manager = at("2027-10-15T00:00:00Z");
    expect(manager.getEventImageReplacement("pokeball")).toBeNull();
    expect(manager.getEventTrainerSpriteReplacement(TrainerType.YOUNGSTER)).toBeNull();
    expect(manager.getEventBgmReplacement("battle_wild")).toBe("battle_wild");
    for (const [trainer, sprite] of halloweenSprites.trainerReplacements) {
      expect(manager.getEventTrainerSpriteReplacement(trainer)).toBe(sprite);
    }
  });

  it("loads event image and atlas files under the original texture keys", () => {
    vi.spyOn(timedEventManager, "getEventImageReplacement").mockImplementation(
      key => halloweenSprites.imageReplacements?.find(([source]) => source === key)?.[1] ?? null,
    );
    const scene = new SceneBase();
    const load = { image: vi.fn(), atlas: vi.fn() };
    Object.assign(scene, { load });
    scene.loadImage("pkmn__sub", "pokemon", "sub.png");
    scene.loadAtlas("training_session_gear", "mystery-encounters");
    expect(load.image.mock.calls[0][0]).toBe("pkmn__sub");
    expect(load.image.mock.calls[0][1]).toContain("images/events/subcharx.png");
    expect(load.atlas.mock.calls[0][0]).toBe("training_session_gear");
    expect(load.atlas.mock.calls[0][1]).toContain("images/events/training_session_gearcharx.png");
    expect(load.atlas.mock.calls[0][2]).toContain("images/events/training_session_gearcharx.json");
  });
});
