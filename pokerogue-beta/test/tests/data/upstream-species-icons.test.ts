import { speciesDataRegistry } from "#app/global-species-data-registry";
import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Upstream species metadata with custom sprite compatibility", () => {
  let game: GameManager;
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
  });

  it.each([
    SpeciesId.PUMPKABOO,
    SpeciesId.GOURGEIST,
  ])("renames species %i's sizes without rerouting EXP sprites", id => {
    const species = speciesDataRegistry.getSpecies(id);
    expect(species.forms.map(form => form.formName)).toEqual([
      "Medium Variety",
      "Small Variety",
      "Large Variety",
      "Jumbo Variety",
    ]);
    expect(species.forms.map(form => form.formKey)).toEqual(["", "small", "large", "super"]);
    expect(species.forms.map(form => form.getFormSpriteKey())).toEqual(["", "", "", ""]);
    for (const form of species.forms) {
      expect(form.getSpriteAtlasPath(false, form.formIndex)).toBe(String(id));
    }
  });

  it("retains Gourgeist's custom form passive pairs", () => {
    expect(speciesDataRegistry.getSpeciesData(SpeciesId.GOURGEIST).passives).toEqual({
      0: [AbilityId.ILLUMINATE, AbilityId.PRANKSTER],
      1: AbilityId.ADAPTABILITY,
      2: [AbilityId.WELL_BAKED_BODY, AbilityId.THICK_FAT],
      3: [AbilityId.SEED_SOWER, AbilityId.REGENERATOR],
    });
  });

  it.each([
    SpeciesId.HYPNO,
    SpeciesId.OCTILLERY,
    SpeciesId.STEELIX,
  ])("uses existing icon frames for both genders of %i", id => {
    const species = speciesDataRegistry.getSpecies(id);
    for (const female of [false, true]) {
      for (const shiny of [false, true]) {
        for (const variant of [0, 1, 2]) {
          const atlasKey = species.getIconAtlasKey(0, shiny, variant);
          const atlas = JSON.parse(readFileSync(`assets/images/${atlasKey}.json`, "utf8"));
          const frames = atlas.textures.flatMap((texture: { frames: { filename: string }[] }) =>
            texture.frames.map(frame => frame.filename),
          );
          expect(frames).toContain(species.getIconId(female, 0, shiny, variant));
        }
      }
    }
    expect(species.getIconId(true, 0, false, 0)).toBe(`${id}-f`);
    expect(species.getIconId(true, 0, true, 0)).toBe(`${id}s-f`);
  });

  it("does not request a gender-specific Mega Steelix icon", () => {
    const species = speciesDataRegistry.getSpecies(SpeciesId.STEELIX);
    const mega = species.forms.findIndex(form => form.formKey === "mega");
    expect(species.getIconId(true, mega, false, 0)).toBe("208-mega");
    expect(species.getIconId(true, mega, true, 0)).toBe("208s-mega");
  });

  it.each([false, true])("packs every requested Mega party icon (experimental: %s)", async experimental => {
    game.scene.experimentalSprites = experimental;
    await game.scene.initVariantData();
    const atlases = new Map<string, Set<string>>();
    const missing = new Set<string>();
    for (const species of speciesDataRegistry.getAllSpecies()) {
      for (const form of species.forms.filter(form => form.formKey.startsWith("mega"))) {
        for (const [shiny, variant] of [[false, 0], [true, 0], [true, 1], [true, 2]] as const) {
          const key = form.getIconAtlasKey(form.formIndex, shiny, variant);
          if (!atlases.has(key)) {
            const atlas = JSON.parse(readFileSync(`assets/images/${key}.json`, "utf8"));
            atlases.set(key, new Set(atlas.textures.flatMap((texture: { frames: { filename: string }[] }) =>
              texture.frames.map(frame => frame.filename),
            )));
          }
          for (const female of [false, true]) {
            const id = form.getIconId(female, form.formIndex, shiny, variant);
            if (!atlases.get(key)!.has(id)) {
              missing.add(`${key}/${id}`);
            }
          }
        }
      }
    }
    expect([...missing]).toEqual([]);
  });
});
