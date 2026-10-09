import { readFileSync } from "node:fs";
import { getGameMode } from "#app/game-mode";
import { Phase } from "#app/phase";
import { dailyBiomeWeights } from "#balance/daily-biome-weights";
import { allBiomes } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { Arena, getBiomeAssetKey, getBiomePropCount } from "#field/arena";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Pokemon Tower framework", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 40;
    game.scene.arena = new Arena(BiomeId.POKEMON_TOWER);
  });

  it("registers an indoor branch from Graveyard to Ancient Ruins", () => {
    expect(allBiomes.get(BiomeId.GRAVEYARD).biomeLinks).toEqual([BiomeId.ABYSS, BiomeId.POKEMON_TOWER]);
    expect(allBiomes.get(BiomeId.POKEMON_TOWER).biomeLinks).toEqual([BiomeId.RUINS]);
    expect(allBiomes.get(BiomeId.POKEMON_TOWER).bgm).toBe("graveyard");
    expect(game.scene.arena.isOutside()).toBe(false);
    expect(getBiomeAssetKey(BiomeId.POKEMON_TOWER)).toBe("pokemon_tower");
    expect(getBiomePropCount(BiomeId.POKEMON_TOWER)).toBe(4);
    expect(dailyBiomeWeights[BiomeId.POKEMON_TOWER]).toBe(0);
  });

  it.each(["bg", "a", "b", "b_1", "b_2", "b_3", "b_4"])("provides a full-size %s PNG", suffix => {
    const bytes = readFileSync(`assets/images/arenas/pokemon_tower_${suffix}.png`);
    expect(bytes.subarray(1, 4).toString()).toBe("PNG");
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([320, 180]);
  });

  it("renders all four independent props and hides the extra when leaving", () => {
    const enemy = game.scene.arenaEnemy;
    const playerTexture = vi.spyOn(game.scene.arenaPlayer.base, "setTexture");
    const enemyTexture = vi.spyOn(enemy.base, "setTexture");
    game.scene.arenaPlayer.setBiome(BiomeId.POKEMON_TOWER);
    enemy.setBiome(BiomeId.POKEMON_TOWER, 15);
    expect(playerTexture).toHaveBeenCalledWith("pokemon_tower_a");
    expect(enemyTexture).toHaveBeenCalledWith("pokemon_tower_b");
    expect(enemy.props).toHaveLength(4);
    const visibility = enemy.props.map(prop => vi.spyOn(prop, "setVisible"));
    enemy.setBiome(BiomeId.POKEMON_TOWER, 15);
    visibility.forEach(show => expect(show).toHaveBeenLastCalledWith(true));
    const textures = enemy.props.map(prop => vi.spyOn(prop, "setTexture"));
    enemy.setBiome(BiomeId.POKEMON_TOWER, 8);
    visibility.forEach((show, index) => expect(show).toHaveBeenLastCalledWith(index === 3));
    textures.forEach((texture, index) => expect(texture).toHaveBeenLastCalledWith(`pokemon_tower_b_${index + 1}`));
    enemy.setBiome(BiomeId.POKEMON_TOWER, 0);
    visibility.forEach(show => expect(show).toHaveBeenLastCalledWith(false));
    textures[3].mockClear();
    enemy.setBiome(BiomeId.ROCKET_HQ, 7);
    visibility.forEach((show, index) => expect(show).toHaveBeenLastCalledWith(index < 3));
    expect(textures[3]).not.toHaveBeenCalled();
    enemy.setBiome(BiomeId.TOWN);
    visibility.forEach(show => expect(show).toHaveBeenLastCalledWith(false));
  });

  it("loads and clears the fourth decoration with the other arena assets", async () => {
    vi.spyOn(game.scene.textures, "exists").mockReturnValue(false);
    const load = vi.spyOn(game.scene, "loadImage").mockReturnValue(game.scene);
    vi.spyOn(game.scene.load, "start").mockImplementation(() => {});
    vi.spyOn(game.scene.load, "once").mockImplementation((event, callback) => {
      if (event === Phaser.Loader.Events.COMPLETE) {
        callback();
      }
      return game.scene.load;
    });
    await game.scene.loadBiomeAssets(BiomeId.POKEMON_TOWER);
    for (const suffix of ["bg", "a", "b", "b_1", "b_2", "b_3", "b_4"]) {
      expect(load).toHaveBeenCalledWith(`pokemon_tower_${suffix}`, "arenas");
    }
    vi.mocked(game.scene.textures.exists).mockReturnValue(true);
    const remove = vi.fn(() => game.scene.textures);
    game.scene.textures.remove = remove;
    game.scene.clearBiomeAssets(BiomeId.POKEMON_TOWER);
    expect(remove).toHaveBeenCalledWith("pokemon_tower_b_4");
    expect(remove).toHaveBeenCalledTimes(7);
  });

  it.each([1, 2, 3] as const)("keeps the entrance locked and the exit usable for %i players", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, count > 1, count);
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    game.scene.arena = new Arena(BiomeId.GRAVEYARD);
    new SelectBiomePhase().start();
    expect(queue).toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.ABYSS);
    expect(queue).not.toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.POKEMON_TOWER);
    queue.mockClear();
    game.scene.arena = new Arena(BiomeId.POKEMON_TOWER);
    new SelectBiomePhase().start();
    expect(queue).toHaveBeenCalledWith("SwitchBiomePhase", BiomeId.RUINS);
  });
});
