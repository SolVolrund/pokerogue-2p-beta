import { getTypeDamageMultiplier } from "#data/type";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PlayerGender } from "#enums/player-gender";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat, type PermanentStat } from "#enums/stat";
import type { PlayerPokemon } from "#field/pokemon";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Starter, StarterMoveset } from "#types/save-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export type ComputerPartnerKey = "alex" | "cheryl" | "riley" | "mira" | "buck" | "marley";

export type ComputerPartnerRole =
  | "ace"
  | "balanced"
  | "physical"
  | "special"
  | "bulk"
  | "hpBulk"
  | "defense"
  | "specialDefense"
  | "speed";

export interface ComputerPartnerProfile {
  key: ComputerPartnerKey;
  name: string;
  starterSpeciesId?: SpeciesId;
  starterNature: Nature;
  trainerSprite?: PlayerTrainerSprite;
  trainerGender?: PlayerGender;
  roles: ComputerPartnerRole[];
  personalityTypes: PokemonType[];
  usesPlayerSelectedStarters?: boolean;
  starterMoveset?: Starter["moveset"];
}

export interface ComputerPartnerSlotScore {
  slotIndex: number;
  role: ComputerPartnerRole;
  currentScore: number | undefined;
  candidateScore: number;
  improvementRatio: number;
  canReplace: boolean;
}

const DEFAULT_PARTNER_IVS = [10, 10, 10, 10, 10, 10];
const MAX_STARTER_MOVE_COUNT = 4;
const REPLACEMENT_IMPROVEMENT_RATIO = 1.1;
const COVERAGE_PATCH_IMPROVEMENT_RATIO = 0.95;

const REGULAR_TYPES = [
  PokemonType.NORMAL,
  PokemonType.FIGHTING,
  PokemonType.FLYING,
  PokemonType.POISON,
  PokemonType.GROUND,
  PokemonType.ROCK,
  PokemonType.BUG,
  PokemonType.GHOST,
  PokemonType.STEEL,
  PokemonType.FIRE,
  PokemonType.WATER,
  PokemonType.GRASS,
  PokemonType.ELECTRIC,
  PokemonType.PSYCHIC,
  PokemonType.ICE,
  PokemonType.DRAGON,
  PokemonType.DARK,
  PokemonType.FAIRY,
] as const;

export const COMPUTER_PARTNER_PROFILES: Record<ComputerPartnerKey, ComputerPartnerProfile> = {
  alex: {
    key: "alex",
    name: "Alex",
    starterNature: Nature.HARDY,
    roles: ["ace", "balanced", "balanced", "physical", "special", "bulk"],
    personalityTypes: [],
    usesPlayerSelectedStarters: true,
  },
  cheryl: {
    key: "cheryl",
    name: "Cheryl",
    starterSpeciesId: SpeciesId.HAPPINY,
    starterNature: Nature.CALM,
    trainerSprite: PlayerTrainerSprite.CHERYL,
    trainerGender: PlayerGender.FEMALE,
    roles: ["ace", "hpBulk", "hpBulk", "physical", "special", "speed"],
    personalityTypes: [PokemonType.NORMAL, PokemonType.FAIRY, PokemonType.GRASS, PokemonType.WATER],
  },
  riley: {
    key: "riley",
    name: "Riley",
    starterSpeciesId: SpeciesId.RIOLU,
    starterNature: Nature.ADAMANT,
    trainerSprite: PlayerTrainerSprite.RILEY,
    trainerGender: PlayerGender.MALE,
    roles: ["ace", "physical", "physical", "special", "bulk", "speed"],
    personalityTypes: [PokemonType.FIGHTING, PokemonType.STEEL, PokemonType.GROUND],
  },
  mira: {
    key: "mira",
    name: "Mira",
    starterSpeciesId: SpeciesId.ABRA,
    starterNature: Nature.MODEST,
    trainerSprite: PlayerTrainerSprite.MIRA,
    trainerGender: PlayerGender.FEMALE,
    roles: ["ace", "special", "special", "physical", "bulk", "speed"],
    personalityTypes: [PokemonType.PSYCHIC, PokemonType.GHOST, PokemonType.ELECTRIC, PokemonType.ICE],
    starterMoveset: [MoveId.CONFUSION],
  },
  buck: {
    key: "buck",
    name: "Buck",
    starterSpeciesId: SpeciesId.BALTOY,
    starterNature: Nature.RELAXED,
    trainerSprite: PlayerTrainerSprite.BUCK,
    trainerGender: PlayerGender.MALE,
    roles: ["ace", "defense", "specialDefense", "physical", "special", "speed"],
    personalityTypes: [PokemonType.GROUND, PokemonType.ROCK, PokemonType.STEEL, PokemonType.FIRE],
  },
  marley: {
    key: "marley",
    name: "Marley",
    starterSpeciesId: SpeciesId.GROWLITHE,
    starterNature: Nature.JOLLY,
    trainerSprite: PlayerTrainerSprite.MARLEY,
    trainerGender: PlayerGender.FEMALE,
    roles: ["ace", "speed", "speed", "physical", "special", "bulk"],
    personalityTypes: [PokemonType.FIRE, PokemonType.FLYING, PokemonType.ELECTRIC, PokemonType.DARK],
  },
};

export const COMPUTER_PARTNER_KEYS = Object.keys(COMPUTER_PARTNER_PROFILES) as ComputerPartnerKey[];

export function getComputerPartnerProfile(key: ComputerPartnerKey): ComputerPartnerProfile {
  return COMPUTER_PARTNER_PROFILES[key] ?? COMPUTER_PARTNER_PROFILES.alex;
}

export function createComputerPartnerStarter(profile: ComputerPartnerProfile): Starter[] {
  if (!profile.starterSpeciesId) {
    return [];
  }

  return [
    {
      speciesId: profile.starterSpeciesId,
      shiny: false,
      variant: 0,
      formIndex: 0,
      abilityIndex: 0,
      passive: false,
      nature: profile.starterNature,
      moveset: profile.starterMoveset ?? getDefaultComputerPartnerStarterMoveset(profile.starterSpeciesId),
      pokerus: false,
      ivs: [...DEFAULT_PARTNER_IVS],
    },
  ];
}

function getDefaultComputerPartnerStarterMoveset(speciesId: SpeciesId): StarterMoveset {
  const moves = getPokemonSpecies(speciesId)
    .getLevelMoves()
    .filter(([level]) => level > 0 && level <= 5)
    .map(([, move]) => move)
    .filter((move, index, moveset) => moveset.indexOf(move) === index)
    .slice(0, MAX_STARTER_MOVE_COUNT);

  return (moves.length ? moves : [MoveId.TACKLE]) as StarterMoveset;
}

export function getComputerPartnerReplacementScores(
  profile: ComputerPartnerProfile,
  party: PlayerPokemon[],
  candidate: PlayerPokemon | PokemonSpecies,
): ComputerPartnerSlotScore[] {
  const candidateCoveragePatch = getDefensiveCoveragePatchValue(candidate, party) + getOffensiveCoverageGain(candidate, party);

  return profile.roles.map((role, slotIndex) => {
    const current = party[slotIndex];
    if (role === "ace") {
      return {
        slotIndex,
        role,
        currentScore: current ? scorePokemonForPartnerRole(current, role) : undefined,
        candidateScore: 0,
        improvementRatio: 0,
        canReplace: false,
      };
    }

    const candidateScore = scorePokemonForPartnerSlot(profile, role, candidate, party);
    const currentScore = current ? scorePokemonForPartnerSlot(profile, role, current, party, current) : undefined;
    const improvementRatio = currentScore ? candidateScore / currentScore : Number.POSITIVE_INFINITY;
    const canReplace =
      currentScore === undefined
      || improvementRatio >= REPLACEMENT_IMPROVEMENT_RATIO
      || (candidateCoveragePatch >= 8 && improvementRatio >= COVERAGE_PATCH_IMPROVEMENT_RATIO);

    return {
      slotIndex,
      role,
      currentScore,
      candidateScore,
      improvementRatio,
      canReplace,
    };
  });
}

export function getBestComputerPartnerReplacementSlot(
  profile: ComputerPartnerProfile,
  party: PlayerPokemon[],
  candidate: PlayerPokemon | PokemonSpecies,
): ComputerPartnerSlotScore | undefined {
  return getComputerPartnerReplacementScores(profile, party, candidate)
    .filter(score => score.canReplace)
    .sort((a, b) => b.improvementRatio - a.improvementRatio || b.candidateScore - a.candidateScore)[0];
}

export function scorePokemonForPartnerSlot(
  profile: ComputerPartnerProfile,
  role: ComputerPartnerRole,
  pokemon: PlayerPokemon | PokemonSpecies,
  party: PlayerPokemon[],
  replacingPokemon?: PlayerPokemon | PokemonSpecies,
): number {
  const comparisonParty = replacingPokemon ? party.filter(partyPokemon => partyPokemon !== replacingPokemon) : party;
  return (
    scorePokemonForPartnerRole(pokemon, role)
    + getOffensiveCoverageGain(pokemon, comparisonParty)
    + getDefensiveCoveragePatchValue(pokemon, comparisonParty)
    + getPersonalityTypeBonus(profile, pokemon)
    - getSharedWeaknessPenalty(pokemon, comparisonParty)
  );
}

export function scorePokemonForPartnerRole(pokemon: PlayerPokemon | PokemonSpecies, role: ComputerPartnerRole): number {
  const hp = getPokemonStat(pokemon, Stat.HP);
  const atk = getPokemonStat(pokemon, Stat.ATK);
  const def = getPokemonStat(pokemon, Stat.DEF);
  const spatk = getPokemonStat(pokemon, Stat.SPATK);
  const spdef = getPokemonStat(pokemon, Stat.SPDEF);
  const spd = getPokemonStat(pokemon, Stat.SPD);

  switch (role) {
    case "physical":
      return atk;
    case "special":
      return spatk;
    case "bulk":
      return (hp + def + spdef) / 3;
    case "hpBulk":
      return hp * 0.6 + def * 0.2 + spdef * 0.2;
    case "defense":
      return def;
    case "specialDefense":
      return spdef;
    case "speed":
      return spd * 0.6 + Math.max(atk, spatk) * 0.4;
    case "balanced":
      return (hp + atk + def + spatk + spdef + spd) / 6;
    case "ace":
      return Number.POSITIVE_INFINITY;
  }
}

function getOffensiveCoverageGain(pokemon: PlayerPokemon | PokemonSpecies, party: PlayerPokemon[]): number {
  let gain = 0;
  for (const defenderType of REGULAR_TYPES) {
    const currentBest = Math.max(1, ...party.map(partyPokemon => getBestOffensiveMultiplier(partyPokemon, defenderType)));
    const candidateBest = getBestOffensiveMultiplier(pokemon, defenderType);
    if (candidateBest > currentBest) {
      gain += (candidateBest - currentBest) * 3;
    }
  }
  return gain;
}

function getDefensiveCoveragePatchValue(pokemon: PlayerPokemon | PokemonSpecies, party: PlayerPokemon[]): number {
  let value = 0;
  for (const attackType of REGULAR_TYPES) {
    const weakCount = party.filter(partyPokemon => getDefensiveMultiplier(partyPokemon, attackType) > 1).length;
    const resistCount = party.filter(partyPokemon => getDefensiveMultiplier(partyPokemon, attackType) < 1).length;
    const candidateMultiplier = getDefensiveMultiplier(pokemon, attackType);
    const pressure = Math.max(weakCount - resistCount, 0);

    if (pressure && candidateMultiplier < 1) {
      value += pressure * (candidateMultiplier === 0 ? 4 : 2);
    }
  }
  return value;
}

function getSharedWeaknessPenalty(pokemon: PlayerPokemon | PokemonSpecies, party: PlayerPokemon[]): number {
  let penalty = 0;
  for (const attackType of REGULAR_TYPES) {
    const weakCount = party.filter(partyPokemon => getDefensiveMultiplier(partyPokemon, attackType) > 1).length;
    if (weakCount >= 2 && getDefensiveMultiplier(pokemon, attackType) > 1) {
      penalty += weakCount * 2;
    }
  }
  return penalty;
}

function getPersonalityTypeBonus(profile: ComputerPartnerProfile, pokemon: PlayerPokemon | PokemonSpecies): number {
  return getPokemonTypes(pokemon).filter(type => profile.personalityTypes.includes(type)).length * 3;
}

function getBestOffensiveMultiplier(pokemon: PlayerPokemon | PokemonSpecies, defenderType: PokemonType): number {
  return Math.max(...getPokemonTypes(pokemon).map(attackType => getTypeDamageMultiplier(attackType, defenderType)));
}

function getDefensiveMultiplier(pokemon: PlayerPokemon | PokemonSpecies, attackType: PokemonType): number {
  return getPokemonTypes(pokemon).reduce((multiplier, defenderType) => {
    return multiplier * getTypeDamageMultiplier(attackType, defenderType);
  }, 1);
}

function getPokemonTypes(pokemon: PlayerPokemon | PokemonSpecies): PokemonType[] {
  if ("getTypes" in pokemon) {
    return pokemon.getTypes({ includeTeraType: false }).filter(type => isRegularType(type));
  }
  return [pokemon.type1, pokemon.type2].filter(type => isRegularType(type));
}

function getPokemonStat(pokemon: PlayerPokemon | PokemonSpecies, stat: PermanentStat): number {
  if ("getStat" in pokemon) {
    return pokemon.getStat(stat);
  }
  return pokemon.getBaseStat(stat);
}

function isRegularType(type: PokemonType | null | undefined): type is PokemonType {
  return type !== undefined && type !== null && type !== PokemonType.UNKNOWN && type !== PokemonType.STELLAR;
}
