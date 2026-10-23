import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getPokeballAtlasKey, getPokeballCatchMultiplier, getPokeballName } from "#data/pokeball";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { BallUiHandler } from "#ui/ball-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Safari Ball cosmetics", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.newBattle();
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  it("appends the new ball without renumbering existing saved ball types", () => {
    expect([
      PokeballType.POKEBALL, PokeballType.GREAT_BALL, PokeballType.ULTRA_BALL,
      PokeballType.ROGUE_BALL, PokeballType.MASTER_BALL, PokeballType.LUXURY_BALL,
      PokeballType.GLASS_BALL, PokeballType.CLONE_BALL, PokeballType.SAFARI_BALL,
    ]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(getPokeballAtlasKey(PokeballType.SAFARI_BALL)).toBe("sb");
    expect(getPokeballName(PokeballType.SAFARI_BALL)).toBe("Safari Ball");
    expect(getPokeballCatchMultiplier(PokeballType.SAFARI_BALL)).toBe(1.5);
  });

  it("does not add Safari Balls to any player's inventory or ordinary Ball menu", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const menu = new BallUiHandler();
    for (const player of game.scene.getActivePlayerIndexes()) {
      const balls = game.scene.getPlayerPokeballCounts(player);
      expect(Object.hasOwn(balls, PokeballType.SAFARI_BALL)).toBe(false);
      expect(menu["getPokeballTypes"](balls)).not.toContain(PokeballType.SAFARI_BALL);
      expect(game.scene.canPlayerUsePokeballs(player, PokeballType.SAFARI_BALL)).toBe(false);
      expect(game.scene.canPlayerUsePokeballs(player, PokeballType.POKEBALL)).toBe(true);
    }
  });

  it.each([0, 1, 2] as const)("preserves player %i's caught-ball icon and send-out ball through save/load", player => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE);
    const caught = enemy.addToParty(PokeballType.SAFARI_BALL, -1, player)!;
    expect(game.scene.getPlayerParty(player)).toContain(caught);
    const saved = new PokemonData(caught);
    const restored = new PokemonData(JSON.parse(JSON.stringify(saved))).toPokemon();
    expect(restored.pokeball).toBe(PokeballType.SAFARI_BALL);
    expect(getPokeballAtlasKey(restored.pokeball)).toBe("sb");
    expect(getPokeballAtlasKey(restored.getPokeball(true))).toBe("sb");
  });

  it("has valid atlas pages and all three frames for every ball", () => {
    const atlas = JSON.parse(readFileSync(resolve("assets/images/pb.json"), "utf8"));
    const names = new Set<string>();
    for (const page of atlas.textures) {
      const png = readFileSync(resolve("assets", page.image));
      expect(png.readUInt32BE(16)).toBe(page.size.w);
      expect(png.readUInt32BE(20)).toBe(page.size.h);
      for (const entry of page.frames) {
        expect(names.has(entry.filename)).toBe(false);
        names.add(entry.filename);
        expect(entry.frame.x + entry.frame.w).toBeLessThanOrEqual(page.size.w);
        expect(entry.frame.y + entry.frame.h).toBeLessThanOrEqual(page.size.h);
      }
    }
    for (const key of ["pb", "gb", "ub", "rb", "mb", "lb", "glass_ball", "cb", "sb"]) {
      for (const suffix of ["", "_opening", "_open"]) {
        expect(names.has(`${key}${suffix}`)).toBe(true);
      }
    }
  });
});
