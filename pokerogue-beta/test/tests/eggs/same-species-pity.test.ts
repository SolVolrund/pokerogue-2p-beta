import type { PlayerIndex } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { BOOSTED_RARE_EGGMOVE_RATES, RARE_EGGMOVE_RATES } from "#balance/rates";
import { getSameSpeciesEggCandyCounts } from "#balance/starters";
import { Egg } from "#data/egg";
import { DexAttr } from "#enums/dex-attr";
import { EggSourceType } from "#enums/egg-source-types";
import { SpeciesId } from "#enums/species-id";
import { VariantTier } from "#enums/variant-tier";
import { EggData } from "#system/egg-data";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import * as Utils from "#utils/common";
import { createComputerPartnerStarter, getComputerPartnerProfile } from "#utils/computer-partner-profile";
import {
  ensureSameSpeciesEggPity,
  getMissingEggVariants,
  rollSameSpeciesEggShiny,
  rollSameSpeciesEggVariant,
  type SameSpeciesEggPity,
} from "#utils/egg-pity";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Same-species shiny pity", () => {
  it("keeps the base chance through egg 15, then rises to a guaranteed shiny on egg 21", () => {
    const pity: SameSpeciesEggPity = [0, 0];
    vi.spyOn(Utils, "randSeedFloat").mockReturnValue(0.999999);
    for (let count = 1; count <= 20; count++) {
      expect(rollSameSpeciesEggShiny(pity)).toBe(false);
      expect(pity[0]).toBe(count);
    }
    expect(rollSameSpeciesEggShiny(pity)).toBe(true);
    expect(pity[0]).toBe(0);
  });

  it.each([
    [14, 0.1, false],
    [15, 0.2, true],
    [18, 0.7, false],
    [19, 0.8, true],
  ] as const)("uses the probability ramp after %i misses with roll %f", (misses, roll, shiny) => {
    vi.spyOn(Utils, "randSeedFloat").mockReturnValue(roll);
    expect(rollSameSpeciesEggShiny([misses, 0])).toBe(shiny);
  });

  it.each([VariantTier.RARE, VariantTier.EPIC])("guarantees the missing tier %i on the eleventh shiny", missing => {
    const pity: SameSpeciesEggPity = [0, 0];
    vi.spyOn(Utils, "randSeedInt").mockReturnValue(9);
    for (let count = 1; count <= 10; count++) {
      expect(rollSameSpeciesEggVariant(pity, [missing])).toBe(VariantTier.STANDARD);
    }
    expect(rollSameSpeciesEggVariant(pity, [missing])).toBe(missing);
    expect(pity[1]).toBe(0);
  });

  it.each([
    [0, VariantTier.EPIC],
    [1, VariantTier.RARE],
    [2, VariantTier.RARE],
    [3, VariantTier.RARE],
  ])("uses the upstream 3:1 split when both tiers are missing (roll %i)", (roll, expected) => {
    vi.spyOn(Utils, "randSeedInt").mockReturnValue(roll);
    expect(rollSameSpeciesEggVariant([0, 10], [VariantTier.RARE, VariantTier.EPIC])).toBe(expected);
  });

  it("resets variant pity for a new variant rolled normally, but not for an owned variant", () => {
    vi.spyOn(Utils, "randSeedInt").mockReturnValue(2);
    const newVariant: SameSpeciesEggPity = [3, 7];
    const ownedVariant: SameSpeciesEggPity = [3, 7];
    rollSameSpeciesEggVariant(newVariant, [VariantTier.RARE]);
    rollSameSpeciesEggVariant(ownedVariant, [VariantTier.EPIC]);
    expect(newVariant).toEqual([3, 0]);
    expect(ownedVariant).toEqual([3, 8]);
  });

  it("does not advance variant pity when no tiers are missing", () => {
    vi.spyOn(Utils, "randSeedInt").mockReturnValue(9);
    const pity: SameSpeciesEggPity = [0, 4];
    rollSameSpeciesEggVariant(pity, []);
    expect(pity[1]).toBe(4);
    expect(getMissingEggVariants(0n, false)).toEqual([]);
    expect(getMissingEggVariants(DexAttr.VARIANT_2, true, [VariantTier.EPIC])).toEqual([]);
  });

  it("credits legacy discounts once without replacing existing counters", () => {
    const entry: { pity?: SameSpeciesEggPity } = {};
    expect(ensureSameSpeciesEggPity(entry, 2, 80, 0n, true)).toEqual([0, 9]);
    entry.pity = [4, 0];
    expect(ensureSameSpeciesEggPity(entry, 2, 80, 0n, true)).toEqual([4, 0]);
    expect(ensureSameSpeciesEggPity({}, 10, 32, DexAttr.VARIANT_2 | DexAttr.VARIANT_3, true)).toEqual([0, 0]);
    expect(ensureSameSpeciesEggPity({}, 2, 80, 0n, false)).toEqual([0, 0]);
  });

  it("uses the new rare egg move denominators", () => {
    expect(RARE_EGGMOVE_RATES).toEqual([36, 24, 12, 6]);
    expect(BOOSTED_RARE_EGGMOVE_RATES).toEqual([12, 8, 6, 4]);
  });
});

describe("Owner-aware egg pity and saves", () => {
  let game: GameManager;
  let phaserGame: Phaser.Game;
  const species = SpeciesId.BULBASAUR;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.setSeed("same-species-pity");
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
  });

  function buy(owner: PlayerIndex = 0, shiny?: boolean) {
    const egg = new Egg({
      species,
      playerIndex: owner,
      sourceType: EggSourceType.SAME_SPECIES_EGG,
      timestamp: 1793188800000,
      ...(shiny === undefined ? {} : { isShiny: shiny }),
    });
    egg.addEggToGameData(owner);
    return egg;
  }

  it("advances only the actual buyer's counter while another player is active", () => {
    game.scene.setActivePlayerIndex(0);
    vi.spyOn(Utils, "randSeedFloat").mockReturnValue(0.999999);
    buy(1);
    buy(2);
    buy(2);
    expect(([0, 1, 2] as const).map(owner => game.scene.getPlayerGameData(owner).starterData[species].pity)).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
  });

  it("ignores another player's variants but counts this buyer's unhatched shinies", () => {
    const owner = game.scene.getPlayerGameData(1);
    owner.starterData[species].pity = [0, 10];
    game.scene.getPlayerGameData(0).dexData[species].caughtAttr |= DexAttr.VARIANT_3;
    const pending = new Egg({ species, playerIndex: 1, isShiny: true, variantTier: VariantTier.RARE });
    pending.addEggToGameData(1);
    expect(buy(1, true).variantTier).toBe(VariantTier.EPIC);
    expect(owner.starterData[species].pity).toEqual([0, 0]);
  });

  it("keeps gacha and event eggs outside same-species pity", () => {
    const data = game.scene.getPlayerGameData(1);
    data.starterData[species].pity = [20, 10];
    for (const sourceType of [EggSourceType.GACHA_SHINY, EggSourceType.EVENT]) {
      new Egg({ species, playerIndex: 1, sourceType });
    }
    expect(data.starterData[species].pity).toEqual([20, 10]);
  });

  it("preserves counters, saved eggs and deterministic continuation across reloads", () => {
    const data = game.scene.getPlayerGameData(1);
    data.starterData[species].pity = [20, 10];
    const egg = buy(1);
    const raw = data.getSystemSaveDataString();
    const restored = GameData.fromRawSystem(raw, false, 1);
    expect(restored.starterData[species].pity).toEqual(data.starterData[species].pity);
    expect(restored.eggGenerationCount).toBe(1);
    expect(new EggData(restored.eggs[0])).toEqual(new EggData(egg));
    const next = buy(1);
    game.scene.systemSaves![1] = restored;
    expect(new EggData(buy(1))).toEqual(new EggData(next));
  });

  it("does not change pity when rebuilding an older incomplete egg", () => {
    const data = game.scene.getPlayerGameData(1);
    data.starterData[species].pity = [20, 10];
    new Egg({ species, playerIndex: 1, sourceType: EggSourceType.SAME_SPECIES_EGG, fromSave: true, id: 123 });
    expect(data.starterData[species].pity).toEqual([20, 10]);
    expect(data.eggGenerationCount).toBe(0);
  });

  it("initializes older profiles once even when their version matches this build", () => {
    const data = game.scene.getPlayerGameData(1);
    data.dexData[species].hatchedCount = 80;
    data.dexData[species].caughtAttr = DexAttr.NON_SHINY;
    data.starterData[species].passiveAttr = 15;
    delete data.starterData[species].pity;
    const restored = GameData.fromRawSystem(data.getSystemSaveDataString(), false, 1);
    expect(restored.starterData[species].pity).toEqual([0, 9]);
    expect(restored.starterData[species].passiveAttr).toBe(15);
    restored.starterData[species].pity = [2, 0];
    const secondLoad = GameData.fromRawSystem(restored.getSystemSaveDataString(), false, 1);
    expect(secondLoad.starterData[species].pity).toEqual([2, 0]);
  });

  it.each([false, true])("keeps the newer counter reset when merging cached/live profiles (reverse %s)", reverse => {
    const older = game.scene.getPlayerGameData(0).getSystemSaveData();
    const newer = game.scene.getPlayerGameData(1).getSystemSaveData();
    older.eggGenerationCount = 4;
    newer.eggGenerationCount = 5;
    older.starterData[species].pity = [20, 10];
    newer.starterData[species].pity = [0, 0];
    const target = reverse ? older : newer;
    GameData["mergeSystemSaveProgress"](target, reverse ? newer : older);
    expect(target.starterData[species].pity).toEqual([0, 0]);
  });

  it("gives CPU candy eggs the same prices and guarantees without touching human pity", () => {
    const data = game.scene.getPlayerGameData(0);
    data.getComputerPartnerStarterProgressEntry("alex", species);
    data.getComputerPartnerDexProgressEntry("alex", species);
    const progress = data.getComputerPartnerProgress("alex");
    const entry = progress.starterData[species]!;
    const dex = progress.dexData[species]!;
    const profile = {
      ...getComputerPartnerProfile("alex"),
      starterSpeciesId: species,
      startingStarters: [{ speciesId: species, points: speciesDataRegistry.getStarterCost(species) }],
    };
    entry.passiveAttr = 15;
    entry.valueReduction = 2;
    entry.candyCount = getSameSpeciesEggCandyCounts(speciesDataRegistry.getStarterCost(species));
    entry.pity = [20, 10];
    dex.caughtAttr = DexAttr.NON_SHINY | DexAttr.VARIANT_2;
    createComputerPartnerStarter(profile, progress);
    expect(progress.eggPurchases).toBe(1);
    expect(dex.caughtAttr & DexAttr.VARIANT_3).not.toBe(0n);
    expect(entry.pity).toEqual([0, 0]);
    expect(data.starterData[species].pity).toEqual([0, 0]);
    const restored = GameData.fromRawSystem(data.getSystemSaveDataString(), false, 0);
    expect(restored.getComputerPartnerStarterProgressEntry("alex", species).pity).toEqual([0, 0]);
  });

  it.each([false, true])("preserves a CPU's newer pity reset during profile merging (reverse %s)", reverse => {
    const older = game.scene.getPlayerGameData(0);
    const newer = game.scene.getPlayerGameData(1);
    older.getComputerPartnerProgress("alex").eggPurchases = 4;
    newer.getComputerPartnerProgress("alex").eggPurchases = 5;
    older.getComputerPartnerStarterProgressEntry("alex", species).pity = [20, 10];
    newer.getComputerPartnerStarterProgressEntry("alex", species).pity = [0, 0];
    const target = (reverse ? older : newer).getSystemSaveData();
    GameData["mergeSystemSaveProgress"](target, (reverse ? newer : older).getSystemSaveData());
    expect(target.computerPartnerProgress?.alex?.starterData[species]?.pity).toEqual([0, 0]);
  });
});
