import { TerrainType } from "#data/terrain";
import { BiomeId } from "#enums/biome-id";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import { SpeciesId } from "#enums/species-id";
import { TimeOfDay } from "#enums/time-of-day";
import { TrainerType } from "#enums/trainer-type";
import { WeatherType } from "#enums/weather-type";
import type { Biome, BiomeLinks, BiomePokemonPools, TerrainPool, TrainerPools, WeatherPool } from "#types/biomes";

const pokemonPool: BiomePokemonPools = {
  [BiomePoolTier.COMMON]: {
    [TimeOfDay.DAWN]: [SpeciesId.CATERPIE, SpeciesId.WEEDLE, SpeciesId.CHATOT],
    [TimeOfDay.DAY]: [SpeciesId.CATERPIE, SpeciesId.WEEDLE],
    [TimeOfDay.DUSK]: [SpeciesId.YANMA, SpeciesId.VOLBEAT, SpeciesId.ILLUMISE],
    [TimeOfDay.NIGHT]: [SpeciesId.YANMA, SpeciesId.VOLBEAT, SpeciesId.ILLUMISE],
    [TimeOfDay.ALL]: [SpeciesId.ODDISH],
  },
  [BiomePoolTier.UNCOMMON]: {
    [TimeOfDay.DAWN]: [SpeciesId.POLIWAG, SpeciesId.CHATOT],
    [TimeOfDay.DAY]: [SpeciesId.POLIWAG, SpeciesId.CHATOT],
    [TimeOfDay.DUSK]: [SpeciesId.WOOPER, SpeciesId.MURKROW],
    [TimeOfDay.NIGHT]: [SpeciesId.WOOPER, SpeciesId.MURKROW],
    [TimeOfDay.ALL]: [],
  },
  [BiomePoolTier.RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.PICHU,SpeciesId.EEVEE],
  },
  [BiomePoolTier.SUPER_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.SMEARGLE],
  },
  [BiomePoolTier.ULTRA_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.MANAPHY],
  },
  [BiomePoolTier.BOSS]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [],
  },
  [BiomePoolTier.BOSS_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.LATIAS,SpeciesId.LATIOS],
  },
  [BiomePoolTier.BOSS_SUPER_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [],
  },
  [BiomePoolTier.BOSS_ULTRA_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [],
  },
};

const trainerPool: TrainerPools = {
  [BiomePoolTier.COMMON]: [],
  [BiomePoolTier.UNCOMMON]: [],
  [BiomePoolTier.RARE]: [TrainerType.BIANCA],
  [BiomePoolTier.SUPER_RARE]: [],
  [BiomePoolTier.ULTRA_RARE]: [],
  [BiomePoolTier.BOSS]: [],
  [BiomePoolTier.BOSS_RARE]: [TrainerType.BIANCA_LATIAS],
  [BiomePoolTier.BOSS_SUPER_RARE]: [],
  [BiomePoolTier.BOSS_ULTRA_RARE]: [],
};

const weatherPool: WeatherPool = {
  [WeatherType.RAIN]: 3,
  [WeatherType.SUNNY]: 5,
};

const terrainPool: TerrainPool = {
  [TerrainType.NONE]: 1,
};

const biomeLinks: BiomeLinks = [BiomeId.ISLAND];

export const secretGardenBiome: Biome = {
  biomeId: BiomeId.SECRET_GARDEN,
  pokemonPool,
  trainerPool,
  trainerChance: 64,
  weatherPool,
  terrainPool,
  bgm: "island",
  biomeLinks,
};
