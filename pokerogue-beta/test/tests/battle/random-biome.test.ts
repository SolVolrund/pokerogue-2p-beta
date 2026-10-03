import { getGameMode } from "#app/game-mode";
import { Phase } from "#app/phase";
import { biomeDepths } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { Arena } from "#field/arena";
import { SelectBiomePhase } from "#phases/select-biome-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Random biome selection", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.ENDLESS);
  });

  it.each([1, 51, 101, 151, 201, 251])("selects a weighted route biome at wave %i despite unlinked special biomes", wave => {
    expect(biomeDepths[BiomeId.ALTO_MARE]).toBeUndefined();
    expect(biomeDepths[BiomeId.SECRET_GARDEN]).toBeUndefined();
    for (let i = 0; i < 30; i++) {
      const biome = game.scene.generateRandomBiome(wave);
      expect(biomeDepths[biome]).toBeDefined();
      expect([BiomeId.TOWN, BiomeId.END, BiomeId.FARAWAY_ISLAND, BiomeId.ROCKET_HQ]).not.toContain(biome);
    }
  });

  it("leaves the wave-50 End biome and queues the next biome without getting stuck", () => {
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 50;
    game.scene.arena = new Arena(BiomeId.END);
    const end = vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    new SelectBiomePhase().start();
    const transition = queue.mock.calls.find(call => call[0] === "SwitchBiomePhase");
    expect(transition).toBeDefined();
    const biome = transition![1] as BiomeId;
    expect(biome).not.toBe(BiomeId.END);
    expect(biomeDepths[biome]).toBeDefined();
    expect(end).toHaveBeenCalledOnce();
  });

  it("keeps selection deterministic for clients using the same seed", () => {
    game.scene.setSeed("random-biome-regression");
    game.scene.resetSeed(50);
    const first = game.scene.generateRandomBiome(51);
    game.scene.resetSeed(50);
    expect(game.scene.generateRandomBiome(51)).toBe(first);
  });
});
