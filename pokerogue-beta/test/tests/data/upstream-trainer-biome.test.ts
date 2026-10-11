import { laboratoryBiome } from "#balance/biomes/laboratory";
import { BiomeId } from "#enums/biome-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerPoolTier } from "#enums/trainer-pool-tier";
import { TrainerType } from "#enums/trainer-type";
import { trainerConfigs } from "#trainers/trainer-config";
import { describe, expect, it } from "vitest";

describe("Upstream trainer and biome adjustments", () => {
  it("adds Island while retaining the existing Laboratory exit", () => {
    expect(laboratoryBiome.biomeLinks).toEqual([BiomeId.CONSTRUCTION_SITE, BiomeId.ISLAND]);
  });

  it("moves Scientist Rotom to Rare and leaves Meltan in Ultra Rare", () => {
    const pools = trainerConfigs[TrainerType.SCIENTIST].speciesPools;
    expect(pools[TrainerPoolTier.RARE]).toContain(SpeciesId.ROTOM);
    expect(pools[TrainerPoolTier.ULTRA_RARE]).toEqual([SpeciesId.MELTAN]);
  });

  it.each([SpeciesId.TYRUNT, SpeciesId.AMAURA])("includes fossil %i in Scientist Super Rare", species => {
    expect(trainerConfigs[TrainerType.SCIENTIST].speciesPools[TrainerPoolTier.SUPER_RARE]).toContain(species);
  });
});
