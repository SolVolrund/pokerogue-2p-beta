import { BattleScene } from "#app/battle-scene";
import { hasExpSprite } from "#sprites/sprite-utils";
import { populateVariantColorCache, variantColorCache } from "#sprites/variant";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const assets = path.join(getAppRootDir(), "assets");
const read = (relative: string) => JSON.parse(fs.readFileSync(path.join(assets, relative), "utf8"));
const registered: string[] = read("exp-sprites.json");
const variants = read("images/pokemon/variant/_masterlist.json");
const forms: [number, string][] = [
  [3, "mega"],
  [26, "mega-x"],
  [26, "mega-y"],
  [36, "mega"],
  [71, "mega"],
  [121, "mega"],
  [149, "mega"],
  [154, "mega"],
  [160, "mega"],
  [208, "mega"],
  [227, "mega"],
  [358, "mega"],
  [359, "mega-z"],
  [398, "mega"],
  [445, "mega-z"],
  [448, "mega-z"],
  [478, "mega"],
  [485, "mega"],
  [491, "mega"],
  [500, "mega"],
  [530, "mega"],
  [545, "mega"],
  [560, "mega"],
  [604, "mega"],
  [609, "mega"],
  [623, "mega"],
  [652, "mega"],
  [655, "mega"],
  [658, "mega"],
  [668, "mega"],
  [678, "mega"],
  [687, "mega"],
  [689, "mega"],
  [691, "mega"],
  [701, "mega"],
  [718, "mega"],
  [740, "mega"],
  [768, "mega"],
  [780, "mega"],
  [801, "mega"],
  [801, "mega-original"],
  [807, "mega"],
  [870, "mega"],
  [952, "mega"],
  [970, "mega"],
  [998, "mega"],
  [2670, "mega"],
];
const cases = forms.flatMap(([id, form]) =>
  [false, true].flatMap(back => {
    const modes = (back ? variants.back : variants)?.[`${id}-${form}`] ?? [0, 0, 0];
    return ["normal", "shiny", "rare", "epic"].flatMap((tier, index) => {
      const variant = Math.max(0, index - 1);
      return index > 1 && !modes[variant] ? [] : [{ id, form, back, tier, variant, mode: modes[variant] }];
    });
  }),
);

describe("Mega experimental sprites", () => {
  beforeAll(async () => {
    const game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
    await game.runToTitle();
    await game.scene.initExpSprites();
    game.scene.experimentalSprites = true;
    await game.scene.initVariantData();
  });

  it.each(cases)("loads $id-$form back=$back $tier through either sprite setting", ({
    id,
    form,
    back,
    tier,
    variant,
    mode,
  }) => {
    const species = getPokemonSpecies(id);
    const formIndex = species.forms.findIndex(value => value.formKey === form);
    expect(formIndex).toBeGreaterThanOrEqual(0);
    const shiny = tier !== "normal";
    const key = species.getSpriteKey(false, formIndex, shiny, variant, back);
    const atlasPath = species.getSpriteAtlasPath(false, formIndex, shiny, variant, back);
    const separateVariant = shiny && mode === 2;
    const relative = `${back ? "back/" : ""}${tier === "shiny" ? "shiny/" : ""}${id}-${form}${separateVariant ? `_${variant + 1}` : ""}`;
    expect(atlasPath).toBe(`${separateVariant ? "variant/" : ""}${relative}`);
    expect(hasExpSprite(key)).toBe(true);
    expect(species.getSpriteKey(true, formIndex, shiny, variant, back)).toBe(key);
    expect(
      registered.filter(value => value === `${id}${tier === "shiny" ? "s" : ""}${back ? "b" : ""}-${form}`),
    ).toHaveLength(1);

    for (const experimental of [false, true]) {
      const atlas = vi.fn();
      const scene = { experimentalSprites: experimental, load: { atlas } } as unknown as BattleScene;
      BattleScene.prototype.loadPokemonAtlas.call(scene, key, atlasPath);
      const base = `images/pokemon/${separateVariant ? "variant/" : ""}${experimental ? "exp/" : ""}${relative}`;
      expect(atlas).toHaveBeenLastCalledWith(key, `${base}.png`, `${base}.json`);
      expect(fs.existsSync(path.join(assets, `${base}.png`))).toBe(true);
      expect(fs.existsSync(path.join(assets, `${base}.json`))).toBe(true);
      if (!experimental) {
        continue;
      }

      const png = fs.readFileSync(path.join(assets, `${base}.png`));
      const width = png.readUInt32BE(16);
      const height = png.readUInt32BE(20);
      const data = read(`${base}.json`);
      const texture = data.textures[0];
      expect(data.meta.credit).toBe("EBDX");
      expect(texture.image).toBe(path.basename(`${base}.png`));
      expect(texture.size).toEqual({ w: width, h: height });
      expect(Math.max(width, height)).toBeLessThanOrEqual(2048);
      expect(texture.frames.length).toBeGreaterThan(1);
      for (const [index, frame] of texture.frames.entries()) {
        expect(frame.filename).toBe(`${String(index + 1).padStart(4, "0")}.png`);
        expect(frame.rotated).toBe(false);
        expect(frame.frame.x + frame.frame.w).toBeLessThanOrEqual(width);
        expect(frame.frame.y + frame.frame.h).toBeLessThanOrEqual(height);
      }
    }
  });

  it.each(
    cases.filter(value => value.tier === "rare" && value.mode === 1),
  )("loads EXP palettes for $id-$form back=$back", async ({ id, form, back }) => {
    const spritePath = `${back ? "back/" : ""}${id}-${form}`;
    const key = `mega-test:${spritePath}`;
    await populateVariantColorCache(key, true, spritePath);
    expect(variantColorCache[key]).toEqual(read(`images/pokemon/variant/exp/${spritePath}.json`));
    delete variantColorCache[key];
  });

  it("keeps Pyroar's independent shiny frames and Dragonite's original 48-frame back", () => {
    expect(read("images/pokemon/exp/668-mega.json").textures[0].frames).toHaveLength(61);
    expect(read("images/pokemon/exp/shiny/668-mega.json").textures[0].frames).toHaveLength(69);
    expect(read("images/pokemon/exp/back/149-mega.json").textures[0].frames).toHaveLength(48);
  });

  it("uses the normal Zygarde back as the temporary shiny back", () => {
    for (const extension of ["png", "json"]) {
      const base = fs.readFileSync(path.join(assets, `images/pokemon/exp/back/718-mega.${extension}`));
      const shiny = fs.readFileSync(path.join(assets, `images/pokemon/exp/back/shiny/718-mega.${extension}`));
      expect(shiny.equals(base)).toBe(true);
    }
  });

  it("leaves all three Mega Tatsugiri forms on their current artwork", () => {
    for (const form of ["mega-curly", "mega-droopy", "mega-stretchy"]) {
      for (const suffix of ["", "s", "b", "sb"]) {
        expect(registered).not.toContain(`978${suffix}-${form}`);
      }
    }
  });
});
