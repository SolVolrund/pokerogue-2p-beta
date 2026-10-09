import { BiomePoolTier } from "#enums/biome-pool-tier";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";

export const TOWER_GHOST_SPRITE = "tower_ghost_f";
export const TOWER_TRAINER_CHANCE = 6;

export interface TowerPokemonEntry {
  species: SpeciesId;
  nickname?: string;
  fixed?: boolean;
  formIndex?: number;
}

export interface TowerTrainerEntry {
  type: TrainerType;
  name: string;
  reference: string;
  tier: BiomePoolTier;
  party: TowerPokemonEntry[];
}

const p = (species: SpeciesId, nickname?: string, fixed = false): TowerPokemonEntry => ({
  species,
  ...(nickname ? { nickname } : {}),
  fixed,
});
const unown = (letter: string): TowerPokemonEntry => ({
  species: SpeciesId.UNOWN,
  formIndex: letter.charCodeAt(0) - "A".charCodeAt(0),
});

// Keep the intended species here: the normal evolution resolver handles pre-evolutions
// without losing regional or split evolution branches, and may evolve unfinished lines.
export const towerWildPools: Partial<Record<BiomePoolTier, TowerPokemonEntry[]>> = {
  [BiomePoolTier.COMMON]: [
    p(SpeciesId.SABLEYE),
    p(SpeciesId.ROTOM),
    p(SpeciesId.BANETTE),
    p(SpeciesId.TREVENANT),
    p(SpeciesId.MIMIKYU),
    p(SpeciesId.PALOSSAND),
    p(SpeciesId.JELLICENT),
    p(SpeciesId.FROSLASS),
    p(SpeciesId.RUNERIGUS),
    p(SpeciesId.COFAGRIGUS),
    p(SpeciesId.SPIRITOMB),
    p(SpeciesId.HOUNDSTONE),
    p(SpeciesId.GOURGEIST),
    p(SpeciesId.MISMAGIUS),
    p(SpeciesId.DRIFBLIM),
    p(SpeciesId.GENGAR),
    p(SpeciesId.AEGISLASH),
  ],
  [BiomePoolTier.UNCOMMON]: [
    p(SpeciesId.HISUI_ZOROARK),
    p(SpeciesId.CHANDELURE),
    p(SpeciesId.DUSKNOIR),
    p(SpeciesId.CERULEDGE),
    p(SpeciesId.FLUTTER_MANE),
    p(SpeciesId.DRAGAPULT),
    p(SpeciesId.SHEDINJA, undefined, true),
    p(SpeciesId.CLEFAIRY),
    p(SpeciesId.PARAS),
    p(SpeciesId.HYPNO),
    p(SpeciesId.ZORUA),
    p(SpeciesId.DITTO, "Battery"),
    p(SpeciesId.ARCANINE),
    p(SpeciesId.RATTATA),
    p(SpeciesId.AUDINO),
  ],
  [BiomePoolTier.RARE]: [
    p(SpeciesId.CYNDAQUIL, "HURRY"),
    p(SpeciesId.JIGGLYPUFF, "Juun"),
    p(SpeciesId.CHARMANDER, "Miki"),
    p(SpeciesId.LINOONE, "Breeze"),
    p(SpeciesId.ABSOL, "Reaper"),
    p(SpeciesId.ELECTRIKE, "Jolt"),
    p(SpeciesId.SKITTY, "Blush"),
    p(SpeciesId.VULPIX, "Foxfire"),
    p(SpeciesId.PIKACHU, "Jessica", true),
    p(SpeciesId.EEVEE, "Cindy"),
    p(SpeciesId.CYNDAQUIL, "wildfire"),
    p(SpeciesId.FEAROW, "Skai"),
    p(SpeciesId.SUDOWOODO, "Uso"),
    p(SpeciesId.ZUBAT, "Kaze"),
    p(SpeciesId.HOOTHOOT, "Voice"),
    p(SpeciesId.RATTATA, "Top%", true),
    p(SpeciesId.DRAGONITE, "GORORO"),
  ],
  [BiomePoolTier.ULTRA_RARE]: [
    p(SpeciesId.MELOETTA, "S\u266aREN"),
    p(SpeciesId.MEWTWO, "Original"),
    p(SpeciesId.KYUREM, "Whole"),
    p(SpeciesId.MEW),
  ],
};

export const towerTrainers: TowerTrainerEntry[] = [
  {
    type: TrainerType.TOWER_JOEY,
    name: "Youngster Joey",
    reference: "Top Percentage",
    tier: BiomePoolTier.COMMON,
    party: [p(SpeciesId.RATTATA, "Top%", true)],
  },
  {
    type: TrainerType.TOWER_GOLD,
    name: "Gold",
    reference: "Snow on Mt Silver",
    tier: BiomePoolTier.COMMON,
    party: [p(SpeciesId.MEGANIUM), p(SpeciesId.PIDGEOT), p(SpeciesId.TYPHLOSION)],
  },
  {
    type: TrainerType.TOWER_STEVEN,
    name: "Steven",
    reference: "Strangled Red",
    tier: BiomePoolTier.COMMON,
    party: [p(SpeciesId.CHARIZARD, "Miki"), p(SpeciesId.GASTLY)],
  },
  {
    type: TrainerType.TOWER_DISABLED,
    name: "???",
    reference: "Disabled",
    tier: BiomePoolTier.COMMON,
    party: [p(SpeciesId.JIGGLYPUFF, "Juun"), p(SpeciesId.CYNDAQUIL, "HURRY")],
  },
  {
    type: TrainerType.TOWER_LOST_SILVER,
    name: "...",
    reference: "Lost Silver",
    tier: BiomePoolTier.UNCOMMON,
    party: [unown("L"), unown("E"), unown("A"), unown("V"), unown("E"), p(SpeciesId.CYNDAQUIL, "HURRY")],
  },
  {
    type: TrainerType.TOWER_FAMILY,
    name: "Family",
    reference: "Absol",
    tier: BiomePoolTier.UNCOMMON,
    party: [
      p(SpeciesId.LINOONE, "Breeze"),
      p(SpeciesId.ELECTRIKE, "Jolt"),
      p(SpeciesId.SKITTY, "Blush"),
      p(SpeciesId.VULPIX, "Foxfire"),
      p(SpeciesId.ABSOL, "Reaper"),
    ],
  },
  {
    type: TrainerType.TOWER_RED,
    name: "Red",
    reference: "Snow on Mt Silver",
    tier: BiomePoolTier.RARE,
    party: [
      p(SpeciesId.VENUSAUR),
      p(SpeciesId.BLASTOISE),
      p(SpeciesId.CHARIZARD),
      p(SpeciesId.ESPEON),
      p(SpeciesId.PIKACHU),
      p(SpeciesId.SNORLAX),
    ],
  },
  {
    type: TrainerType.TOWER_HIROSHI,
    name: "Hiroshi",
    reference: "Battery Ditto",
    tier: BiomePoolTier.RARE,
    party: [
      p(SpeciesId.ARCANINE),
      p(SpeciesId.HOUNDOUR),
      p(SpeciesId.HOUNDOOM),
      p(SpeciesId.PIKACHU),
      p(SpeciesId.MAGMAR),
      p(SpeciesId.DITTO, "Battery"),
    ],
  },
  {
    type: TrainerType.TOWER_YELLOW,
    name: "Yellow",
    reference: "Jessica",
    tier: BiomePoolTier.RARE,
    party: [
      p(SpeciesId.PIKACHU, "jessica", true),
      p(SpeciesId.SANDSLASH),
      p(SpeciesId.DRAGONITE, "GORORO"),
      p(SpeciesId.CHARMANDER),
      p(SpeciesId.SQUIRTLE),
      p(SpeciesId.BULBASAUR),
    ],
  },
  {
    type: TrainerType.TOWER_EVENT,
    name: "Event",
    reference: "Event gone wrong",
    tier: BiomePoolTier.ULTRA_RARE,
    party: [
      p(SpeciesId.CYNDAQUIL, "wildfire"),
      p(SpeciesId.FEAROW, "Skai"),
      p(SpeciesId.SUDOWOODO, "Uso"),
      p(SpeciesId.ZUBAT, "Kaze"),
      p(SpeciesId.HOOTHOOT, "Voice"),
      p(SpeciesId.MEW, "LoveMe?"),
    ],
  },
  {
    type: TrainerType.TOWER_NOT,
    name: "Not",
    reference: "not a clone",
    tier: BiomePoolTier.ULTRA_RARE,
    party: [
      p(SpeciesId.FERALIGATR),
      p(SpeciesId.BEEDRILL),
      p(SpeciesId.NOCTOWL),
      p(SpeciesId.UMBREON),
      p(SpeciesId.RAPIDASH),
      p(SpeciesId.MEWTWO, "Original"),
    ],
  },
  {
    type: TrainerType.TOWER_BLAKE,
    name: "Blake",
    reference: "Snow on Mt Silver",
    tier: BiomePoolTier.ULTRA_RARE,
    party: [
      p(SpeciesId.TYPHLOSION),
      p(SpeciesId.FERALIGATR),
      p(SpeciesId.MEGANIUM),
      p(SpeciesId.PIDGEOT),
      p(SpeciesId.TYRANITAR),
      p(SpeciesId.LUGIA),
    ],
  },
];
