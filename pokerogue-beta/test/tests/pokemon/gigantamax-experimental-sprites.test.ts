import { BattleScene } from "#app/battle-scene";
import { SpeciesId } from "#enums/species-id";
import { hasExpSprite } from "#sprites/sprite-utils";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const assets = path.join(getAppRootDir(), "assets");
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(assets, file), "utf8"));
const master = read("images/pokemon/variant/_masterlist.json");
const expMaster = read("images/pokemon/variant/_exp_masterlist.json");
const registered: string[] = read("exp-sprites.json");
const speciesIds = [
  SpeciesId.VENUSAUR,
  SpeciesId.CHARIZARD,
  SpeciesId.BLASTOISE,
  SpeciesId.BUTTERFREE,
  SpeciesId.PIKACHU,
  SpeciesId.MEOWTH,
  SpeciesId.MACHAMP,
  SpeciesId.GENGAR,
  SpeciesId.KINGLER,
  SpeciesId.SNORLAX,
  SpeciesId.GARBODOR,
  SpeciesId.MELMETAL,
  SpeciesId.RILLABOOM,
  SpeciesId.INTELEON,
  SpeciesId.CORVIKNIGHT,
  SpeciesId.ORBEETLE,
  SpeciesId.DREDNAW,
  SpeciesId.COALOSSAL,
  SpeciesId.SANDACONDA,
  SpeciesId.CENTISKORCH,
  SpeciesId.HATTERENE,
  SpeciesId.GRIMMSNARL,
  SpeciesId.ALCREMIE,
  SpeciesId.COPPERAJAH,
  SpeciesId.DURALUDON,
];

for (const experimental of [false, true]) {
  describe("Gigantamax sprites: " + (experimental ? "Experimental" : "Consistent"), () => {
    beforeAll(async () => {
      const game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
      await game.runToTitle();
      game.scene.experimentalSprites = experimental;
      await game.scene.initExpSprites();
      await game.scene.initVariantData();
    });

    it.each(speciesIds)("routes the supported front/back tiers for species %i", id => {
      const species = getPokemonSpecies(id);
      const form = species.forms.findIndex(f => f.formKey === "gigantamax");
      expect(form).toBeGreaterThanOrEqual(0);
      for (const back of [false, true]) {
        const stem = id + "-gigantamax";
        const standard = (back ? master.back : master)[stem];
        const override = experimental && (back ? expMaster.back : expMaster)[stem];
        const modes = override || standard || [0, 0, 0];
        for (const tier of [-1, 0, 1, 2]) {
          if (tier > 0 && !modes[tier]) continue;
          const shiny = tier >= 0,
            index = Math.max(0, tier);
          const mode = shiny ? modes[tier] : 0;
          const key = species.getSpriteKey(false, form, shiny, index, back);
          const atlasPath = species.getSpriteAtlasPath(false, form, shiny, index, back);
          const storedShiny = tier === 0 && !mode;
          const expKey = id + (storedShiny ? "s" : "") + (back ? "b" : "") + "-gigantamax";
          const retainedFront = id === SpeciesId.CENTISKORCH && !back && storedShiny;
          expect(hasExpSprite(key)).toBe(!retainedFront);
          expect(registered.filter(k => k === expKey)).toHaveLength(retainedFront ? 0 : 1);
          const rel =
            (back ? "back/" : "") + (storedShiny ? "shiny/" : "") + stem + (mode === 2 ? "_" + (index + 1) : "");
          expect(atlasPath).toBe((mode === 2 ? "variant/" : "") + rel);
          const exp = experimental && !retainedFront;
          const prefix = "images/pokemon/" + (mode === 2 ? "variant/" : "") + (exp ? "exp/" : "");
          const base = prefix + rel;
          const atlas = vi.fn();
          BattleScene.prototype.loadPokemonAtlas.call(
            { experimentalSprites: experimental, load: { atlas } } as unknown as BattleScene,
            key,
            atlasPath,
          );
          expect(atlas).toHaveBeenLastCalledWith(key, base + ".png", base + ".json");
          expect(fs.existsSync(path.join(assets, base + ".png"))).toBe(true);
          const data = read(base + ".json");
          if (exp && mode !== 2) {
            expect(Object.keys(data.textures?.[0]?.frames ?? data.frames).length).toBeGreaterThan(1);
            if (id !== SpeciesId.COALOSSAL) expect(data.meta.credit).toBe("EBDX");
          }
          if (exp && mode === 1) {
            const palette = read("images/pokemon/variant/exp/" + (back ? "back/" : "") + stem + ".json");
            expect(Object.keys(palette[tier]).length).toBeGreaterThan(0);
          }
        }
      }
    });
  });
}

describe("Gigantamax sprite exceptions", () => {
  it.each(["", "back/"])("uses Butterfree's standard shiny as its Rare and Epic EXP placeholders (%s)", view => {
    const key = "12-gigantamax";
    expect((view ? master.back : master)[key]).toEqual([0, 1, 1]);
    expect((view ? expMaster.back : expMaster)[key]).toEqual([0, 2, 2]);
    const normal = read("images/pokemon/exp/" + view + key + ".json").textures[0];
    expect(normal.frames).toHaveLength(18);
    const shinyPath = "images/pokemon/exp/" + view + "shiny/" + key;
    const shiny = read(shinyPath + ".json");
    const pixels = fs.readFileSync(path.join(assets, shinyPath + ".png"));
    expect(shiny.textures[0].frames).toHaveLength(view ? 26 : 18);
    for (const suffix of ["_2", "_3"]) {
      const base = "images/pokemon/variant/exp/" + view + key + suffix;
      const variant = read(base + ".json");
      expect(variant.textures).toEqual([{ ...shiny.textures[0], image: key + suffix + ".png" }]);
      expect(variant.meta).toEqual(shiny.meta);
      expect(fs.readFileSync(path.join(assets, base + ".png")).equals(pixels)).toBe(true);
    }
  });

  it.each([SpeciesId.CHARIZARD, SpeciesId.BLASTOISE])("retains the separate Epic artwork for %i", id => {
    for (const view of ["", "back/"])
      for (const ext of [".png", ".json"]) {
        const rel = view + id + "-gigantamax_3" + ext;
        const standard = fs.readFileSync(path.join(assets, "images/pokemon/variant", rel));
        const experimental = fs.readFileSync(path.join(assets, "images/pokemon/variant/exp", rel));
        expect(experimental.equals(standard)).toBe(true);
      }
  });
  it("keeps Orbeetle's longer shiny front loop and Corviknight's complete last cell", () => {
    expect(read("images/pokemon/exp/826-gigantamax.json").textures[0].frames).toHaveLength(84);
    expect(read("images/pokemon/exp/shiny/826-gigantamax.json").textures[0].frames).toHaveLength(92);
    const frames = read("images/pokemon/exp/823-gigantamax.json").textures[0].frames;
    expect(frames).toHaveLength(49);
    expect(frames.at(-1).frame.w).toBe(248);
  });
});
