import { BattleScene } from "#app/battle-scene";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const assets = path.join(getAppRootDir(), "assets");
const read = (relative: string) => JSON.parse(fs.readFileSync(path.join(assets, relative), "utf8"));
for (const experimental of [false, true]) {
  describe("Reviewed battle forms: " + (experimental ? "Experimental" : "Consistent"), () => {
    beforeAll(async () => {
      const game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
      await game.runToTitle();
      game.scene.experimentalSprites = experimental;
      await game.scene.initExpSprites();
      await game.scene.initVariantData();
    });

    it.each([
      [SpeciesId.TERAPAGOS, 3],
      [SpeciesId.FURFROU, 10],
      [SpeciesId.ALCREMIE, 9],
    ] as const)("loads all approved forms of species %i", (id, count) => {
      const species = getPokemonSpecies(id);
      const forms = species.forms.map((form, index) => ({ form, index })).filter(f => f.form.formKey !== "gigantamax");
      expect(forms).toHaveLength(count);
      for (const { index } of forms) {
        const form = species.getFormSpriteKey(index);
        const stem = String(id) + (form ? "-" + form : "");
        for (const back of [false, true]) {
          for (const tier of id === SpeciesId.FURFROU ? [-1, 0, 1, 2] : [-1, 0]) {
            const variant = Math.max(0, tier);
            const key = species.getSpriteKey(false, index, tier >= 0, variant, back);
            const atlasPath = species.getSpriteAtlasPath(false, index, tier >= 0, variant, back);
            // Furfrou Rare/Epic must load the normal sheet and use its palette swaps.
            const rel = (back ? "back/" : "") + (tier === 0 ? "shiny/" : "") + stem;
            expect(atlasPath).toBe(rel);
            const base = "images/pokemon/" + (experimental ? "exp/" : "") + rel;
            const atlas = vi.fn();
            BattleScene.prototype.loadPokemonAtlas.call(
              { experimentalSprites: experimental, load: { atlas } } as unknown as BattleScene, key, atlasPath,
            );
            expect(atlas).toHaveBeenCalledWith(key, base + ".png", base + ".json");
            expect(fs.existsSync(path.join(assets, base + ".png"))).toBe(true);
            if (experimental) {
              const data = read(base + ".json");
              expect(data.textures[0].frames.length).toBeGreaterThan(1);
              expect(data.meta.credit).toBe("EBDX");
            }
          }
        }
      }
    });
  });
}

it("uses the existing EXP coat colors on Natural Furfrou's 16-frame back", () => {
  const front = read("images/pokemon/variant/exp/676.json");
  const back = read("images/pokemon/variant/exp/back/676.json");
  for (const tier of [1, 2]) {
    for (const shade of ["efeeda", "ccc8b1", "a8a592", "68675c"]) {
      expect(front[tier][shade]).toMatch(/^[0-9a-f]{6}$/);
      expect(back[tier][shade]).toBe(front[tier][shade]);
    }
  }
  expect(read("images/pokemon/exp/back/676.json").textures[0].frames).toHaveLength(16);
});

it.each(["", "heart", "star", "diamond", "debutante", "matron", "dandy", "la-reine", "kabuki", "pharaoh"])(
  "keeps Furfrou %s on a stable, tightly bounded animation canvas",
  form => {
    const stem = "676" + (form ? "-" + form : "");
    for (const view of ["", "back/"]) {
      const base = read(`images/pokemon/exp/${view}${stem}.json`).textures[0];
      const shiny = read(`images/pokemon/exp/${view}shiny/${stem}.json`).textures[0];
      expect(shiny.frames).toEqual(base.frames);
      const size = base.frames[0].sourceSize;
      // The old full 96x96 cells left 15-16 empty rows below most forms' feet.
      expect(size.w).toBeLessThan(96);
      expect(size.h).toBeLessThanOrEqual(80);
      const png = fs.readFileSync(path.join(assets, `images/pokemon/exp/${view}${stem}.png`));
      expect(base.size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
      for (const frame of base.frames) {
        expect(frame.sourceSize).toEqual(size);
        expect(frame.rotated).toBe(false);
        expect(frame.trimmed).toBe(false);
        expect(frame.spriteSourceSize).toEqual({ x: 0, y: 0, ...size });
        expect(frame.frame.w).toBe(size.w);
        expect(frame.frame.h).toBe(size.h);
        expect(frame.frame.x + size.w).toBeLessThanOrEqual(base.size.w);
        expect(frame.frame.y + size.h).toBeLessThanOrEqual(base.size.h);
      }
    }
  },
);
