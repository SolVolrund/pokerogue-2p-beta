import type { PlayerIndex } from "#app/battle-scene";
import { Egg } from "#data/egg";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { SpeciesId } from "#enums/species-id";
import { EggData } from "#system/egg-data";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Egg generation counter", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const seed = "egg-counter-regression";

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.setSeed(seed);
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
  });

  function pull(playerIndex: PlayerIndex = 0): Egg {
    return new Egg({
      playerIndex,
      pulled: true,
      sourceType: EggSourceType.GACHA_SHINY,
      tier: EggTier.EPIC,
      isShiny: false,
      timestamp: 1780000000000,
    });
  }

  it("does not replay seeds when eggs hatch between single pulls", () => {
    const data = game.scene.getPlayerGameData(0);
    const seeded = vi.spyOn(game.scene, "executeWithSeedOffset");
    const ids: number[] = [];
    for (let i = 0; i < 4; i++) {
      ids.push(pull().id);
      data.eggs.splice(0, 1);
    }

    expect(seeded.mock.calls.map(call => call[2])).toEqual(
      [0, 1, 2, 3].map(count => `${seed}:egg:0:generated:${count}`),
    );
    expect(new Set(ids).size).toBe(4);
    expect(data.eggGenerationCount).toBe(4);
    expect(data.gameStats.eggsPulled).toBe(4);
    expect(data.eggs).toHaveLength(0);
  });

  it("advances once per egg in consecutive purchases and saves the updated counter", () => {
    const data = game.scene.getPlayerGameData(0);
    const savedCounts: number[] = [];
    vi.mocked(game.scene.savePlayerSystemSaveLocal).mockImplementation(owner => {
      savedCounts.push(game.scene.getPlayerGameData(owner).getSystemSaveData().eggGenerationCount!);
    });
    for (let i = 0; i < 4; i++) {
      pull();
    }
    expect(data.eggs).toHaveLength(4);
    expect(savedCounts).toEqual([1, 2, 3, 4]);
  });

  it("tracks the egg owner independently of the active player", () => {
    game.scene.setActivePlayerIndex(0);
    pull(0);
    pull(1);
    pull(1);
    pull(2);
    expect(([0, 1, 2] as const).map(owner => game.scene.getPlayerGameData(owner).eggGenerationCount)).toEqual([
      1, 2, 1,
    ]);
  });

  it("also advances for candy and reward eggs without excluding duplicate species", () => {
    const data = game.scene.getPlayerGameData(0);
    for (const sourceType of [EggSourceType.SAME_SPECIES_EGG, EggSourceType.EVENT]) {
      const egg = new Egg({ playerIndex: 0, species: SpeciesId.REGIDRAGO, sourceType });
      egg.addEggToGameData(0);
      expect(egg.species).toBe(SpeciesId.REGIDRAGO);
    }
    expect(data.eggGenerationCount).toBe(2);
    expect(data.gameStats.eggsPulled).toBe(0);
  });

  it("continues after saving and reloading an empty egg inventory", () => {
    const data = game.scene.getPlayerGameData(1);
    pull(1);
    data.eggs.splice(0, 1);
    const reloaded = GameData.fromRawSystem(data.getSystemSaveDataString(), false, 1);
    game.scene.systemSaves![1] = reloaded;
    const seeded = vi.spyOn(game.scene, "executeWithSeedOffset");

    pull(1);

    expect(seeded).toHaveBeenCalledWith(expect.any(Function), 0, `${seed}:egg:1:generated:1`);
    expect(reloaded.eggGenerationCount).toBe(2);
    expect(reloaded.eggs).toHaveLength(1);
  });

  it("restores saved eggs without consuming the counter or changing their contents", () => {
    const egg = pull(1);
    const data = game.scene.getPlayerGameData(1);
    const reloaded = GameData.fromRawSystem(data.getSystemSaveDataString(), false, 1);

    expect(reloaded.eggGenerationCount).toBe(1);
    expect(data.eggGenerationCount).toBe(1);
    expect(new EggData(reloaded.eggs[0])).toEqual(new EggData(egg));
  });

  it("restores legacy eggs without consuming the counter", () => {
    const data = game.scene.getPlayerGameData(0);
    data.eggGenerationCount = 25;
    const egg = new EggData({
      id: 2077000788,
      species: 0,
      hatchWaves: 25,
      timestamp: 1718908955085,
      gachaType: 1,
    }).toEgg(0);

    expect(egg.id).toBe(2077000788);
    expect(data.eggGenerationCount).toBe(25);
  });

  it("migrates older profiles without replaying inventory-based seeds", () => {
    const raw = JSON.parse(game.scene.getPlayerGameData(0).getSystemSaveDataString());
    delete raw.eggGenerationCount;
    const migrated = GameData.fromRawSystem(JSON.stringify(raw), false, 0);
    game.scene.systemSaves![0] = migrated;
    expect(migrated.eggGenerationCount).toBe(0);
    const seeded = vi.spyOn(game.scene, "executeWithSeedOffset");

    pull();

    expect(seeded).toHaveBeenCalledWith(expect.any(Function), 0, `${seed}:egg:0:generated:0`);
    expect(migrated.eggGenerationCount).toBe(1);
  });

  it.each([
    [4, 9],
    [9, 4],
    [undefined, 9],
    [9, undefined],
  ] as const)("keeps the highest counter when merging saves (%s, %s)", (targetCount, sourceCount) => {
    const target = game.scene.getPlayerGameData(0).getSystemSaveData();
    const source = game.scene.getPlayerGameData(1).getSystemSaveData();
    if (targetCount === undefined) {
      delete target.eggGenerationCount;
    } else {
      target.eggGenerationCount = targetCount;
    }
    if (sourceCount === undefined) {
      delete source.eggGenerationCount;
    } else {
      source.eggGenerationCount = sourceCount;
    }

    GameData["mergeSystemSaveProgress"](target, source);

    expect(target.eggGenerationCount).toBe(9);
  });

  it("remains deterministic across peers with matching profile snapshots", () => {
    const data = game.scene.getPlayerGameData(1);
    data.eggGenerationCount = 7;
    const snapshot = data.getSystemSaveDataString();
    const firstPeerEgg = pull(1);
    const secondPeer = GameData.fromRawSystem(snapshot, false, 1);
    game.scene.systemSaves![1] = secondPeer;

    const secondPeerEgg = pull(1);

    expect(new EggData(secondPeerEgg)).toEqual(new EggData(firstPeerEgg));
    expect(data.eggGenerationCount).toBe(8);
    expect(secondPeer.eggGenerationCount).toBe(8);
  });

  it.each([false, true])("preserves battle RNG and counts fresh eggs with multiplayer %s", multiplayer => {
    game.scene.configureTwoPlayerMode(multiplayer);
    const data = game.scene.getPlayerGameData(0);
    const initialCount = data.eggGenerationCount;
    const rngState = Phaser.Math.RND.state();

    pull();

    expect(Phaser.Math.RND.state()).toBe(rngState);
    expect(data.eggGenerationCount).toBe(initialCount + 1);
  });
});
