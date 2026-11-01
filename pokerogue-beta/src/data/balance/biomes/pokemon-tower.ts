import { graveyardBiome } from "#biomes/graveyard";
import { towerTrainers, towerWildPools, TOWER_TRAINER_CHANCE } from "#data/pokemon-tower-encounters";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { TimeOfDay } from "#enums/time-of-day";
import type { Biome, BiomePokemonPools, TrainerPools } from "#types/biomes";
import { getEnumValues } from "#utils/enums";

export const pokemonTowerBiome: Biome = {
  ...structuredClone(graveyardBiome),
  biomeId: BiomeId.POKEMON_TOWER,
  pokemonPool: Object.fromEntries(
    getEnumValues(BiomePoolTier).map(tier => [
      tier,
      Object.fromEntries(
        getEnumValues(TimeOfDay).map(time => [
          time,
          time === TimeOfDay.ALL ? (towerWildPools[tier] ?? []).map(entry => entry.species) : [],
        ]),
      ),
    ]),
  ) as BiomePokemonPools,
  trainerPool: Object.fromEntries(
    getEnumValues(BiomePoolTier).map(tier => [
      tier,
      towerTrainers.filter(entry => entry.tier === tier).map(entry => entry.type),
    ]),
  ) as TrainerPools,
  trainerChance: TOWER_TRAINER_CHANCE,
  bgm: "Haunting",
  biomeLinks: [BiomeId.RUINS],
};
