import { BattleScene } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { SpeciesFormChangeLapseTeraTrigger, SpeciesFormChangeTeraTrigger } from "#data/form-change-triggers";
import { SpeciesId } from "#enums/species-id";
import { hasExpSprite } from "#sprites/sprite-utils";
import { GameManager } from "#test/framework/game-manager";
import { getAppRootDir } from "#test/utils/sprite-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import fs from "node:fs";
import path from "node:path";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const masks = ["teal", "wellspring", "hearthflame", "cornerstone"];
const forms = [...masks.map(mask => `${mask}-mask`), ...masks.map(mask => `${mask}-mask-tera`)];
const assets = path.join(getAppRootDir(), "assets");
const registered: string[] = JSON.parse(fs.readFileSync(path.join(assets, "exp-sprites.json"), "utf8"));
const cases = forms.flatMap((form, formIndex) =>
  [false, true].flatMap(back => [false, true].map(shiny => ({ form, formIndex, back, shiny }))),
);

describe("Ogerpon experimental sprites", () => {
  beforeAll(async () => {
    const game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
    await game.runToTitle();
    await game.scene.initExpSprites();
  });

  it.each(cases)("routes $form back=$back shiny=$shiny without replacing Consistent assets", ({
    form,
    formIndex,
    back,
    shiny,
  }) => {
    const species = getPokemonSpecies(SpeciesId.OGERPON);
    expect(species.forms[formIndex].formKey).toBe(form);
    const key = species.getSpriteKey(true, formIndex, shiny, 0, back);
    const atlasPath = species.getSpriteAtlasPath(true, formIndex, shiny, 0, back);
    const relative = `${back ? "back/" : ""}${shiny ? "shiny/" : ""}1017-${form}`;
    expect(atlasPath).toBe(relative);
    expect(hasExpSprite(key)).toBe(true);
    expect(registered.filter(value => value === `1017${shiny ? "s" : ""}${back ? "b" : ""}-${form}`)).toHaveLength(1);

    const atlas = vi.fn();
    for (const experimental of [false, true]) {
      const scene = { experimentalSprites: experimental, load: { atlas } } as unknown as BattleScene;
      BattleScene.prototype.loadPokemonAtlas.call(scene, key, atlasPath);
      const base = `images/pokemon/${experimental ? "exp/" : ""}${relative}`;
      expect(atlas).toHaveBeenLastCalledWith(key, `${base}.png`, `${base}.json`);
      expect(fs.existsSync(path.join(assets, `${base}.png`))).toBe(true);
      expect(fs.existsSync(path.join(assets, `${base}.json`))).toBe(true);
    }

    const png = fs.readFileSync(path.join(assets, `images/pokemon/exp/${relative}.png`));
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    expect(Math.max(width, height)).toBeLessThanOrEqual(1024);
    const data = JSON.parse(fs.readFileSync(path.join(assets, `images/pokemon/exp/${relative}.json`), "utf8"));
    const texture = data.textures[0];
    expect(texture.image).toBe(`1017-${form}.png`);
    expect(texture.size).toEqual({ w: width, h: height });
    expect(data.meta.credit).toBe("EBDX");
    const count = form.endsWith("-tera") ? (back ? 7 : 38) : back ? 20 : 63;
    expect(texture.frames).toHaveLength(count);
    for (const [index, frame] of texture.frames.entries()) {
      expect(frame.filename).toBe(`${String(index + 1).padStart(4, "0")}.png`);
      expect(frame.rotated).toBe(false);
      expect(frame.frame.x + frame.frame.w).toBeLessThanOrEqual(width);
      expect(frame.frame.y + frame.frame.h).toBeLessThanOrEqual(height);
    }
  });

  it.each(masks)("keeps the %s mask's forward and reverse Tera sprite paths", mask => {
    const changes = speciesDataRegistry.getFormChanges(SpeciesId.OGERPON);
    const normal = `${mask}-mask`;
    const tera = `${normal}-tera`;
    const forward = changes.find(change => change.preFormKey === normal && change.formKey === tera);
    const reverse = changes.find(change => change.preFormKey === tera && change.formKey === normal);
    expect(forward?.findTrigger(SpeciesFormChangeTeraTrigger)).toBeTruthy();
    expect(reverse?.findTrigger(SpeciesFormChangeLapseTeraTrigger)).toBeTruthy();
    expect(forward?.quiet).toBe(true);
    expect(reverse?.quiet).toBe(true);
  });
});
