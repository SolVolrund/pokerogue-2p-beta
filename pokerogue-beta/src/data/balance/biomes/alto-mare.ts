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
    [TimeOfDay.DAWN]: [SpeciesId.POLIWAG,SpeciesId.QUAGSIRE],
    [TimeOfDay.DAY]: [SpeciesId.POLIWAG,SpeciesId.QUAGSIRE],
    [TimeOfDay.DUSK]: [SpeciesId.MURKROW,SpeciesId.HOOTHOOT],
    [TimeOfDay.NIGHT]: [SpeciesId.MURKROW,SpeciesId.HOOTHOOT],
    [TimeOfDay.ALL]: [SpeciesId.PIDGEY, SpeciesId.POLIWAG, SpeciesId.STARYU],
  },
  [BiomePoolTier.UNCOMMON]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.CHINCHOU, SpeciesId.CORSOLA, SpeciesId.HORSEA],
  },
  [BiomePoolTier.RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [SpeciesId.MURKROW],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [SpeciesId.HOOTHOOT],
    [TimeOfDay.ALL]: [SpeciesId.MARILL, SpeciesId.LAPRAS],
  },
  [BiomePoolTier.SUPER_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.VAPOREON, SpeciesId.SMEARGLE],
  },
  [BiomePoolTier.ULTRA_RARE]: {
    [TimeOfDay.DAWN]: [SpeciesId.LATIAS],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [SpeciesId.LATIOS],
    [TimeOfDay.ALL]: [],
  },
  [BiomePoolTier.BOSS]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.KABUTO, SpeciesId.OMANYTE],
  },
  [BiomePoolTier.BOSS_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.LILEEP, SpeciesId.ANORITH],
  },
  [BiomePoolTier.BOSS_SUPER_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.AERODACTYL],
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
  [BiomePoolTier.COMMON]: [TrainerType.SAILOR,TrainerType.FISHERMAN],
  [BiomePoolTier.UNCOMMON]: [TrainerType.MUSICIAN,TrainerType.SCUBA_DIVER,TrainerType.WAITER],
  [BiomePoolTier.RARE]: [TrainerType.SCUBA_DIVER,TrainerType.SWIMMER],
  [BiomePoolTier.SUPER_RARE]: [TrainerType.BIANCA],
  [BiomePoolTier.ULTRA_RARE]: [TrainerType.BIANCA_LATIAS],
  [BiomePoolTier.BOSS]: [],
  [BiomePoolTier.BOSS_RARE]: [],
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

const biomeLinks: BiomeLinks = [BiomeId.SECRET_GARDEN];

export const altoMareBiome: Biome = {
  biomeId: BiomeId.ALTO_MARE,
  pokemonPool,
  trainerPool,
  trainerChance: 12,
  weatherPool,
  terrainPool,
  bgm: "island",
  biomeLinks,
};
