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
    [TimeOfDay.DAWN]: [SpeciesId.LEDYBA,SpeciesId.RIOLU],
    [TimeOfDay.DAY]: [SpeciesId.NIDORAN_F,SpeciesId.NIDORAN_M],
    [TimeOfDay.DUSK]: [SpeciesId.VOLBEAT,SpeciesId.ILLUMISE],
    [TimeOfDay.NIGHT]: [SpeciesId.YANMA,SpeciesId.ZORUA],
    [TimeOfDay.ALL]: [SpeciesId.SWABLU],
  },
  [BiomePoolTier.UNCOMMON]: {
    [TimeOfDay.DAWN]: [SpeciesId.KABUTO],
    [TimeOfDay.DAY]: [SpeciesId.ANORITH],
    [TimeOfDay.DUSK]: [SpeciesId.OMANYTE],
    [TimeOfDay.NIGHT]: [SpeciesId.LILEEP],
    [TimeOfDay.ALL]: [SpeciesId.DITTO],
  },
  [BiomePoolTier.RARE]: {
    [TimeOfDay.DAWN]: [SpeciesId.SHIELDON],
    [TimeOfDay.DAY]: [SpeciesId.TIRTOUGA],
    [TimeOfDay.DUSK]: [SpeciesId.CRANIDOS],
    [TimeOfDay.NIGHT]: [SpeciesId.ARCHEN],
    [TimeOfDay.ALL]: [],
  },
  [BiomePoolTier.SUPER_RARE]: {
    [TimeOfDay.DAWN]: [SpeciesId.TYRUNT],
    [TimeOfDay.DAY]: [SpeciesId.TYRUNT],
    [TimeOfDay.DUSK]: [SpeciesId.AMAURA],
    [TimeOfDay.NIGHT]: [SpeciesId.AMAURA],
    [TimeOfDay.ALL]: [SpeciesId.AERODACTYL],
  },
  [BiomePoolTier.ULTRA_RARE]: {
    [TimeOfDay.DAWN]: [SpeciesId.CELEBI,SpeciesId.PHIONE,SpeciesId.CRESSELIA,SpeciesId.DIANCIE],
    [TimeOfDay.DAY]: [SpeciesId.MANAPHY,SpeciesId.SHAYMIN,SpeciesId.VICTINI,SpeciesId.KELDEO],
    [TimeOfDay.DUSK]: [SpeciesId.DARKRAI,SpeciesId.MELOETTA,SpeciesId.ZERAORA,SpeciesId.ZARUDE],
    [TimeOfDay.NIGHT]: [SpeciesId.JIRACHI,SpeciesId.DEOXYS,SpeciesId.MARSHADOW,SpeciesId.HOOPA],
    [TimeOfDay.ALL]: [SpeciesId.REGICE,SpeciesId.REGISTEEL,SpeciesId.REGIROCK,SpeciesId.LATIAS,SpeciesId.LATIOS],
  },
  [BiomePoolTier.BOSS]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [SpeciesId.MEW],
  },
  [BiomePoolTier.BOSS_RARE]: {
    [TimeOfDay.DAWN]: [],
    [TimeOfDay.DAY]: [],
    [TimeOfDay.DUSK]: [],
    [TimeOfDay.NIGHT]: [],
    [TimeOfDay.ALL]: [],
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
    [TimeOfDay.ALL]: [SpeciesId.MEWTWO],
  },
};

const trainerPool: TrainerPools = {
  [BiomePoolTier.COMMON]: [TrainerType.DAWN_ZORUA],
  [BiomePoolTier.UNCOMMON]: [TrainerType.DAWN_ZORUA],
  [BiomePoolTier.RARE]: [TrainerType.DAWN_ZORUA, TrainerType.DUPLICA_DITTO],
  [BiomePoolTier.SUPER_RARE]: [TrainerType.DUPLICA_DITTO],
  [BiomePoolTier.ULTRA_RARE]: [TrainerType.BIANCA_LATIAS],
  [BiomePoolTier.BOSS]: [],
  [BiomePoolTier.BOSS_RARE]: [],
  [BiomePoolTier.BOSS_SUPER_RARE]: [],
  [BiomePoolTier.BOSS_ULTRA_RARE]: [],
};

const weatherPool: WeatherPool = {
  [WeatherType.FOG]: 7,
  [WeatherType.RAIN]: 3,
  [WeatherType.SUNNY]: 5,
};

const terrainPool: TerrainPool = {
  [TerrainType.NONE]: 1,
};

const biomeLinks: BiomeLinks = [BiomeId.TOWN];

export const farawayIslandBiome: Biome = {
  biomeId: BiomeId.FARAWAY_ISLAND,
  pokemonPool,
  trainerPool,
  trainerChance: 64,
  weatherPool,
  terrainPool,
  biomeLinks,
};
