import { speciesDataRegistry } from "#app/global-species-data-registry";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { EvoCondKey, EvolutionItem, type SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import {
  SAME_SPECIES_EGG_HA_RATE,
  SAME_SPECIES_EGG_SHINY_RATE,
  SHINY_EPIC_CHANCE,
  SHINY_VARIANT_CHANCE,
} from "#balance/rates";
import { getPassiveCandyCount, getSameSpeciesEggCandyCounts, getValueReductionCandyCounts } from "#balance/starters";
import { MAX_STARTER_CANDY_COUNT } from "#constants/game-constants";
import type { PokemonSpecies } from "#data/pokemon-species";
import { getTypeDamageMultiplier } from "#data/type";
import { AbilityAttr } from "#enums/ability-attr";
import { DexAttr } from "#enums/dex-attr";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { Passive as PassiveAttr } from "#enums/passive";
import { PlayerGender } from "#enums/player-gender";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type PermanentStat, Stat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type {
  ComputerPartnerDexProgressEntry,
  ComputerPartnerProgressData,
  ComputerPartnerStarterProgressEntry,
  Starter,
  StarterMoveset,
} from "#types/save-data";
import { randSeedInt, randSeedIntRange, randSeedShuffle } from "#utils/common";
import { getSpeciesEntryHazardAccessScore } from "#utils/computer-partner-hazard-support";
import { getSpeciesHealingSupportAccessScore } from "#utils/computer-partner-healing-support";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export type ComputerPartnerKey =
  | "alex"
  | "cheryl"
  | "riley"
  | "mira"
  | "buck"
  | "marley"
  | "dawn_zorua"
  | "bianca_latias"
  | "duplica_ditto";

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

export type ComputerPartnerRolePreferences = ComputerPartnerRole[];

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
  startingStarters?: ComputerPartnerStarterConfig[];
  aceStarterSpeciesIds?: SpeciesId[];
  allowedReplacementSpeciesIds?: readonly SpeciesId[];
  requiresUnlock?: boolean;
}

export interface ComputerPartnerStarterConfig {
  speciesId: SpeciesId;
  points?: number;
  nature?: Nature;
  moveset?: Starter["moveset"];
}

export interface ComputerPartnerSlotScore {
  slotIndex: number;
  role: ComputerPartnerRole;
  currentScore: number | undefined;
  candidateScore: number;
  improvementRatio: number;
  canReplace: boolean;
  replacedPokemon: PlayerPokemon | undefined;
  replacedPokemonIndex: number | undefined;
  currentTeamScore: number;
  candidateTeamScore: number;
}

interface ComputerPartnerRoleAssignment {
  role: ComputerPartnerRole;
  pokemon: ComputerPartnerScoringPokemon;
  score: number;
}

interface ComputerPartnerTeamScore {
  totalScore: number;
  assignments: ComputerPartnerRoleAssignment[];
}

type ComputerPartnerScoringPokemon = Pokemon | PokemonSpecies;

interface ProjectedPartnerPokemon {
  species: PokemonSpecies;
  growthCost: number;
}

const DEFAULT_PARTNER_IVS = [10, 10, 10, 10, 10, 10];
const COMPUTER_PARTNER_STARTER_POINT_LIMIT = 10;
const MAX_STARTER_MOVE_COUNT = 4;
const MAX_VALUE_REDUCTION = 2;
const COMPUTER_PARTNER_EGG_CANDY_RETURN = 2;
const TEAM_REPLACEMENT_IMPROVEMENT_RATIO = 1.03;
const TEAM_FILL_IMPROVEMENT_RATIO = 1.005;
const LEVEL_GROWTH_COST = 0.45;
const MAX_LEVEL_GROWTH_COST = 20;
const COMMON_EVOLUTION_ITEM_COST = 8;
const RARE_EVOLUTION_ITEM_COST = 12;
const EVOLUTION_CONDITION_COST = 5;
const PROJECT_GROWTH_COST_THRESHOLD = 8;
const PROJECT_OVERLOAD_COST = 4;

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
    startingStarters: [
      { speciesId: SpeciesId.HAPPINY, points: 2 },
      { speciesId: SpeciesId.WOBBUFFET, points: 2 },
      { speciesId: SpeciesId.DRIFLOON, points: 2 },
      { speciesId: SpeciesId.MAKUHITA, points: 3 },
      { speciesId: SpeciesId.WAILMER, points: 2 },
    ],
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
    startingStarters: [
      { speciesId: SpeciesId.RIOLU, points: 3 },
      { speciesId: SpeciesId.ABSOL, points: 4 },
      { speciesId: SpeciesId.TEDDIURSA, points: 4 },
      { speciesId: SpeciesId.BAGON, points: 4 },
      { speciesId: SpeciesId.BELDUM, points: 4 },
    ],
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
    startingStarters: [
      { speciesId: SpeciesId.ABRA, points: 4 },
      { speciesId: SpeciesId.MAGNEMITE, points: 4 },
      { speciesId: SpeciesId.TOGEPI, points: 3 },
      { speciesId: SpeciesId.GASTLY, points: 4 },
      { speciesId: SpeciesId.PORYGON, points: 4 },
    ],
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
    startingStarters: [
      { speciesId: SpeciesId.BALTOY, points: 2 },
      { speciesId: SpeciesId.EEVEE, points: 3 },
      { speciesId: SpeciesId.SHUCKLE, points: 3 },
      { speciesId: SpeciesId.TORKOAL, points: 3 },
      { speciesId: SpeciesId.DUSKULL, points: 3 },
    ],
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
    startingStarters: [
      { speciesId: SpeciesId.GROWLITHE, points: 4 },
      { speciesId: SpeciesId.SNEASEL, points: 4 },
      { speciesId: SpeciesId.NINCADA, points: 4 },
      { speciesId: SpeciesId.VOLTORB, points: 2 },
      { speciesId: SpeciesId.ZUBAT, points: 3 },
    ],
  },
  dawn_zorua: {
    key: "dawn_zorua",
    name: "Dawn?",
    starterSpeciesId: SpeciesId.ZORUA,
    starterNature: Nature.HASTY,
    trainerSprite: PlayerTrainerSprite.DAWN_ZORUA,
    trainerGender: PlayerGender.FEMALE,
    roles: ["ace", "ace", "physical", "special", "bulk", "speed"],
    personalityTypes: [PokemonType.DARK, PokemonType.GHOST, PokemonType.POISON, PokemonType.BUG, PokemonType.ROCK],
    aceStarterSpeciesIds: [SpeciesId.ZORUA, SpeciesId.HISUI_ZORUA],
    requiresUnlock: true,
    startingStarters: [
      { speciesId: SpeciesId.ZORUA, points: 0, nature: Nature.HASTY },
      { speciesId: SpeciesId.HISUI_ZORUA, points: 0, nature: Nature.TIMID },
    ],
  },
  bianca_latias: {
    key: "bianca_latias",
    name: "Bianca?",
    starterSpeciesId: SpeciesId.LATIOS,
    starterNature: Nature.TIMID,
    trainerSprite: PlayerTrainerSprite.BIANCA_LATIAS,
    trainerGender: PlayerGender.FEMALE,
    roles: ["ace", "special", "speed", "bulk", "balanced", "balanced"],
    personalityTypes: [
      PokemonType.DRAGON,
      PokemonType.PSYCHIC,
      PokemonType.WATER,
      PokemonType.GRASS,
      PokemonType.BUG,
      PokemonType.GROUND,
    ],
    requiresUnlock: true,
    startingStarters: [
      { speciesId: SpeciesId.LATIOS },
      { speciesId: SpeciesId.CATERPIE },
      { speciesId: SpeciesId.ODDISH },
      { speciesId: SpeciesId.POLIWAG },
      { speciesId: SpeciesId.YANMA },
      { speciesId: SpeciesId.WOOPER },
    ],
  },
  duplica_ditto: {
    key: "duplica_ditto",
    name: "Duplica",
    starterSpeciesId: SpeciesId.DITTO,
    starterNature: Nature.HARDY,
    trainerSprite: PlayerTrainerSprite.DUPLICA_DITTO,
    trainerGender: PlayerGender.FEMALE,
    roles: ["ace", "balanced", "balanced", "balanced", "balanced", "balanced"],
    personalityTypes: [PokemonType.NORMAL],
    allowedReplacementSpeciesIds: [SpeciesId.DITTO],
    requiresUnlock: true,
    startingStarters: [
      { speciesId: SpeciesId.DITTO },
      { speciesId: SpeciesId.DITTO },
      { speciesId: SpeciesId.DITTO },
      { speciesId: SpeciesId.DITTO },
      { speciesId: SpeciesId.DITTO },
      { speciesId: SpeciesId.DITTO },
    ],
  },
};

export const COMPUTER_PARTNER_KEYS = Object.keys(COMPUTER_PARTNER_PROFILES) as ComputerPartnerKey[];

export function getComputerPartnerProfile(key: ComputerPartnerKey): ComputerPartnerProfile {
  return COMPUTER_PARTNER_PROFILES[key] ?? COMPUTER_PARTNER_PROFILES.alex;
}

export function isComputerPartnerKey(key: unknown): key is ComputerPartnerKey {
  return typeof key === "string" && (COMPUTER_PARTNER_KEYS as readonly string[]).includes(key);
}

export function isComputerPartnerLockedByDefault(key: ComputerPartnerKey): boolean {
  return !!getComputerPartnerProfile(key).requiresUnlock;
}

export function getComputerPartnerProfileWithRolePreferences(
  key: ComputerPartnerKey,
  rolePreferences?: ComputerPartnerRolePreferences,
): ComputerPartnerProfile {
  const profile = getComputerPartnerProfile(key);
  if (key !== "alex" || !rolePreferences || rolePreferences.length === 0) {
    return profile;
  }

  const defaultRoles = profile.roles.slice(1);
  return {
    ...profile,
    roles: ["ace", ...rolePreferences, ...defaultRoles.slice(rolePreferences.length)],
  };
}

export function createComputerPartnerStarter(
  profile: ComputerPartnerProfile,
  progress?: ComputerPartnerProgressData,
): Starter[] {
  if (progress) {
    spendComputerPartnerStarterProgress(profile, progress);
  }

  const startingStarters = getComputerPartnerStartingStarters(profile, progress);

  if (startingStarters.length === 0) {
    return [];
  }

  return startingStarters.map(starter => createComputerPartnerStarterData(profile, starter, progress));
}

export function isComputerPartnerStarterAce(
  profile: ComputerPartnerProfile,
  starter: Pick<Starter, "speciesId">,
  starterIndex: number,
): boolean {
  return starterIndex === 0 || !!profile.aceStarterSpeciesIds?.includes(starter.speciesId);
}

function getComputerPartnerStartingStarters(
  profile: ComputerPartnerProfile,
  progress?: ComputerPartnerProgressData,
): ComputerPartnerStarterConfig[] {
  const startingStarters = profile.startingStarters;
  if (startingStarters && startingStarters.length > 0) {
    return buildComputerPartnerStarterTeam(startingStarters, progress);
  }

  if (!profile.starterSpeciesId) {
    return [];
  }

  const starter: ComputerPartnerStarterConfig = {
    speciesId: profile.starterSpeciesId,
    points: 0,
  };

  if (profile.starterMoveset) {
    starter.moveset = profile.starterMoveset;
  }

  return [starter];
}

function buildComputerPartnerStarterTeam(
  starters: ComputerPartnerStarterConfig[],
  progress?: ComputerPartnerProgressData,
): ComputerPartnerStarterConfig[] {
  const [ace, ...candidates] = starters;

  if (!ace) {
    return [];
  }

  const selectedStarters = [ace];
  let remainingPoints = COMPUTER_PARTNER_STARTER_POINT_LIMIT - getComputerPartnerStarterPoints(ace, progress);

  for (const starter of randSeedShuffle([...candidates])) {
    const points = getComputerPartnerStarterPoints(starter, progress);
    if (points > remainingPoints) {
      continue;
    }

    selectedStarters.push(starter);
    remainingPoints -= points;
  }

  return selectedStarters;
}

function getComputerPartnerStarterPoints(
  starter: ComputerPartnerStarterConfig,
  progress?: ComputerPartnerProgressData,
): number {
  const basePoints = getComputerPartnerStarterBasePoints(starter);
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const valueReduction = progress?.starterData[progressSpeciesId]?.valueReduction ?? 0;
  return reduceComputerPartnerStarterPoints(basePoints, valueReduction);
}

function getComputerPartnerStarterBasePoints(starter: ComputerPartnerStarterConfig): number {
  return starter.points ?? speciesDataRegistry.getStarterCost(starter.speciesId);
}

function reduceComputerPartnerStarterPoints(basePoints: number, valueReduction: number): number {
  let points = basePoints;
  for (let i = 0; i < valueReduction; i++) {
    points = points > 1 ? points - 1 : points / 2;
  }
  return points;
}

function createComputerPartnerStarterData(
  profile: ComputerPartnerProfile,
  starter: ComputerPartnerStarterConfig,
  progress?: ComputerPartnerProgressData,
): Starter {
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const progressEntries = progress ? ensureComputerPartnerProgressEntries(profile, starter, progress) : undefined;
  const dexEntry = progressEntries?.dexEntry;
  const starterEntry = progressEntries?.starterEntry;
  const species = getPokemonSpecies(starter.speciesId);
  const dexProps = getComputerPartnerStarterDexProps(species, dexEntry);
  const ivs = dexEntry?.ivs;

  return {
    speciesId: starter.speciesId,
    shiny: dexProps.shiny,
    variant: dexProps.variant,
    formIndex: starter.speciesId === progressSpeciesId ? dexProps.formIndex : 0,
    female: dexProps.female,
    abilityIndex: getComputerPartnerStarterAbilityIndex(species, starterEntry),
    passive: !!(
      starterEntry
      && starterEntry.passiveAttr & PassiveAttr.UNLOCKED
      && starterEntry.passiveAttr & PassiveAttr.ENABLED
    ),
    nature: getComputerPartnerStarterNature(profile, starter, dexEntry),
    moveset: getComputerPartnerStarterMoveset(starter, starterEntry),
    pokerus: false,
    ivs: ivs && ivs.length > 0 ? [...ivs] : [...DEFAULT_PARTNER_IVS],
  };
}

function getComputerPartnerStarterMoveset(
  starter: ComputerPartnerStarterConfig,
  starterEntry?: ComputerPartnerStarterProgressEntry,
): StarterMoveset {
  const baseMoves = starter.moveset ?? getDefaultComputerPartnerStarterMoveset(starter.speciesId);
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const eggMoves = Object.hasOwn(speciesEggMoves, progressSpeciesId)
    ? speciesEggMoves[progressSpeciesId].filter(
        (_move, index) => !!(starterEntry?.eggMoves && starterEntry.eggMoves & (1 << index)),
      )
    : [];
  const moves = [...eggMoves, ...baseMoves].filter((move, index, moveset) => moveset.indexOf(move) === index);

  return (moves.length > 0 ? moves.slice(0, MAX_STARTER_MOVE_COUNT) : [MoveId.TACKLE]) as StarterMoveset;
}

function getComputerPartnerStarterNature(
  profile: ComputerPartnerProfile,
  starter: ComputerPartnerStarterConfig,
  dexEntry?: ComputerPartnerDexProgressEntry,
): Nature {
  const preferredNature = starter.nature ?? profile.starterNature;
  if (!dexEntry?.natureAttr || dexEntry.natureAttr & (1 << (preferredNature + 1))) {
    return preferredNature;
  }

  for (let nature = 0; nature < 25; nature++) {
    if (dexEntry.natureAttr & (1 << (nature + 1))) {
      return nature as Nature;
    }
  }
  return preferredNature;
}

function getComputerPartnerStarterAbilityIndex(
  species: PokemonSpecies,
  starterEntry?: ComputerPartnerStarterProgressEntry,
): number {
  const abilityAttr = starterEntry?.abilityAttr ?? AbilityAttr.ABILITY_1;
  if (species.abilityHidden && abilityAttr & AbilityAttr.ABILITY_HIDDEN) {
    return species.ability2 ? 2 : 1;
  }
  if (species.ability2 && abilityAttr & AbilityAttr.ABILITY_2) {
    return 1;
  }
  return 0;
}

function getComputerPartnerStarterDexProps(
  species: PokemonSpecies,
  dexEntry?: ComputerPartnerDexProgressEntry,
): Pick<Starter, "shiny" | "variant" | "formIndex" | "female"> {
  const caughtAttr = dexEntry?.caughtAttr ?? 0n;
  const shiny = !!(caughtAttr & DexAttr.SHINY);
  const variant = shiny && caughtAttr & DexAttr.VARIANT_3 ? 2 : shiny && caughtAttr & DexAttr.VARIANT_2 ? 1 : 0;
  const female = species.malePercent !== null && !(caughtAttr & DexAttr.MALE) && !!(caughtAttr & DexAttr.FEMALE);
  const formIndex = getComputerPartnerFormIndex(caughtAttr);

  return { shiny, variant, formIndex, female };
}

function getComputerPartnerFormIndex(caughtAttr: bigint): number {
  if (!caughtAttr || caughtAttr < DexAttr.DEFAULT_FORM) {
    return 0;
  }

  let formIndex = 0;
  while (!(caughtAttr & getComputerPartnerFormAttr(formIndex))) {
    formIndex++;
  }
  return formIndex;
}

function getComputerPartnerFormAttr(formIndex: number): bigint {
  return BigInt(1) << BigInt(7 + formIndex);
}

function getDefaultComputerPartnerStarterMoveset(speciesId: SpeciesId): StarterMoveset {
  const moves = getPokemonSpecies(speciesId)
    .getLevelMoves()
    .filter(([level]) => level > 0 && level <= 5)
    .map(([, move]) => move)
    .filter((move, index, moveset) => moveset.indexOf(move) === index)
    .slice(0, MAX_STARTER_MOVE_COUNT);

  return (moves.length > 0 ? moves : [MoveId.TACKLE]) as StarterMoveset;
}

function spendComputerPartnerStarterProgress(
  profile: ComputerPartnerProfile,
  progress: ComputerPartnerProgressData,
): void {
  const starters = getUniqueComputerPartnerStarterConfigs(profile);
  starters.forEach(starter => ensureComputerPartnerProgressEntries(profile, starter, progress));

  for (const starter of starters) {
    spendComputerPartnerPassiveCandy(starter, progress);
  }

  for (const starter of starters) {
    spendComputerPartnerCostReductionCandy(starter, progress);
  }

  for (const starter of starters) {
    spendComputerPartnerEggCandy(starter, progress);
  }
}

function getUniqueComputerPartnerStarterConfigs(profile: ComputerPartnerProfile): ComputerPartnerStarterConfig[] {
  let starters: ComputerPartnerStarterConfig[];
  if (profile.startingStarters && profile.startingStarters.length > 0) {
    starters = profile.startingStarters;
  } else if (profile.starterSpeciesId) {
    starters = [{ speciesId: profile.starterSpeciesId, points: 0, moveset: profile.starterMoveset }];
  } else {
    starters = [];
  }
  const seenSpeciesIds = new Set<SpeciesId>();
  const uniqueStarters: ComputerPartnerStarterConfig[] = [];

  for (const starter of starters) {
    const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
    if (seenSpeciesIds.has(progressSpeciesId)) {
      continue;
    }
    seenSpeciesIds.add(progressSpeciesId);
    uniqueStarters.push(starter);
  }

  return uniqueStarters;
}

function spendComputerPartnerPassiveCandy(
  starter: ComputerPartnerStarterConfig,
  progress: ComputerPartnerProgressData,
): void {
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const starterEntry = ensureComputerPartnerStarterProgressEntry(progress, progressSpeciesId);
  if (starterEntry.passiveAttr & PassiveAttr.UNLOCKED) {
    return;
  }

  const basePoints = getComputerPartnerStarterBasePoints(starter);
  if (basePoints <= 0) {
    return;
  }

  const passiveCost = getPassiveCandyCount(basePoints);
  if (starterEntry.candyCount < passiveCost) {
    return;
  }

  starterEntry.candyCount -= passiveCost;
  starterEntry.passiveAttr |= PassiveAttr.UNLOCKED | PassiveAttr.ENABLED;
}

function spendComputerPartnerCostReductionCandy(
  starter: ComputerPartnerStarterConfig,
  progress: ComputerPartnerProgressData,
): void {
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const starterEntry = ensureComputerPartnerStarterProgressEntry(progress, progressSpeciesId);
  const basePoints = getComputerPartnerStarterBasePoints(starter);
  if (basePoints <= 0) {
    return;
  }

  while (starterEntry.valueReduction < MAX_VALUE_REDUCTION) {
    const reductionCost = getValueReductionCandyCounts(basePoints)[starterEntry.valueReduction];
    if (starterEntry.candyCount < reductionCost) {
      return;
    }

    starterEntry.candyCount -= reductionCost;
    starterEntry.valueReduction++;
  }
}

function spendComputerPartnerEggCandy(
  starter: ComputerPartnerStarterConfig,
  progress: ComputerPartnerProgressData,
): void {
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const starterEntry = ensureComputerPartnerStarterProgressEntry(progress, progressSpeciesId);
  const dexEntry = ensureComputerPartnerDexProgressEntry(progress, progressSpeciesId);
  const basePoints = getComputerPartnerStarterBasePoints(starter);
  if (basePoints <= 0) {
    return;
  }

  const eggCost = getSameSpeciesEggCandyCounts(basePoints, dexEntry.hatchedCount);
  if (starterEntry.candyCount < eggCost) {
    return;
  }

  starterEntry.candyCount -= eggCost;
  hatchComputerPartnerInstantEgg(progress, progressSpeciesId);
}

function hatchComputerPartnerInstantEgg(progress: ComputerPartnerProgressData, speciesId: SpeciesId): void {
  const species = getPokemonSpecies(speciesId);
  const dexEntry = ensureComputerPartnerDexProgressEntry(progress, speciesId);
  const starterEntry = ensureComputerPartnerStarterProgressEntry(progress, speciesId);
  const shiny = !randSeedInt(SAME_SPECIES_EGG_SHINY_RATE);
  const variant = shiny ? rollComputerPartnerShinyVariant() : 0;
  const nature = randSeedInt(25) as Nature;
  const ivs = Array.from({ length: 6 }, () => randSeedIntRange(10, 31));

  dexEntry.caughtAttr |= getComputerPartnerEggDexAttr(species, shiny, variant);
  dexEntry.natureAttr |= 1 << (nature + 1);
  dexEntry.hatchedCount++;
  dexEntry.ivs = Array.from({ length: 6 }, (_, i) => Math.max(dexEntry.ivs?.[i] ?? 0, ivs[i]));

  if (species.abilityHidden && !randSeedInt(SAME_SPECIES_EGG_HA_RATE)) {
    starterEntry.abilityAttr |= AbilityAttr.ABILITY_HIDDEN;
  } else if (species.ability2 && species.ability2 !== species.ability1) {
    starterEntry.abilityAttr |= randSeedInt(2) ? AbilityAttr.ABILITY_2 : AbilityAttr.ABILITY_1;
  } else {
    starterEntry.abilityAttr |= AbilityAttr.ABILITY_1;
  }

  unlockComputerPartnerEggMove(starterEntry, speciesId);
  starterEntry.candyCount = Math.min(
    starterEntry.candyCount + COMPUTER_PARTNER_EGG_CANDY_RETURN,
    MAX_STARTER_CANDY_COUNT,
  );
  progress.eggPurchases = (progress.eggPurchases ?? 0) + 1;
}

function unlockComputerPartnerEggMove(starterEntry: ComputerPartnerStarterProgressEntry, speciesId: SpeciesId): void {
  if (!Object.hasOwn(speciesEggMoves, speciesId)) {
    return;
  }

  const eggMoves = speciesEggMoves[speciesId];
  const missingEggMoveIndexes = eggMoves
    .map((_move, index) => index)
    .filter(index => !(starterEntry.eggMoves & (1 << index)));
  if (missingEggMoveIndexes.length === 0) {
    return;
  }

  const rolledIndex = randSeedInt(16) ? randSeedInt(3) : 3;
  const eggMoveIndex = missingEggMoveIndexes.includes(rolledIndex)
    ? rolledIndex
    : randSeedShuffle([...missingEggMoveIndexes])[0];
  starterEntry.eggMoves |= 1 << eggMoveIndex;
}

function rollComputerPartnerShinyVariant(): 0 | 1 | 2 {
  const roll = randSeedInt(10);
  if (roll >= SHINY_VARIANT_CHANCE) {
    return 0;
  }
  if (roll >= SHINY_EPIC_CHANCE) {
    return 1;
  }
  return 2;
}

function getComputerPartnerEggDexAttr(species: PokemonSpecies, shiny: boolean, variant: 0 | 1 | 2): bigint {
  let dexAttr = shiny ? DexAttr.SHINY : DexAttr.NON_SHINY;
  dexAttr |= variant === 2 ? DexAttr.VARIANT_3 : variant === 1 ? DexAttr.VARIANT_2 : DexAttr.DEFAULT_VARIANT;

  if (species.malePercent !== null) {
    dexAttr |= species.malePercent === 0 ? DexAttr.FEMALE : DexAttr.MALE;
  }

  dexAttr |= DexAttr.DEFAULT_FORM;
  return dexAttr & species.getFullUnlocksData();
}

function ensureComputerPartnerProgressEntries(
  profile: ComputerPartnerProfile,
  starter: ComputerPartnerStarterConfig,
  progress: ComputerPartnerProgressData,
): { dexEntry: ComputerPartnerDexProgressEntry; starterEntry: ComputerPartnerStarterProgressEntry } {
  const progressSpeciesId = getComputerPartnerProgressSpeciesId(starter.speciesId);
  const dexEntry = ensureComputerPartnerDexProgressEntry(progress, progressSpeciesId);
  const starterEntry = ensureComputerPartnerStarterProgressEntry(progress, progressSpeciesId);

  if (!dexEntry.caughtAttr) {
    const species = getPokemonSpecies(progressSpeciesId);
    dexEntry.caughtAttr = getComputerPartnerDefaultDexAttr(species);
    dexEntry.natureAttr = 1 << ((starter.nature ?? profile.starterNature) + 1);
    dexEntry.ivs = [...DEFAULT_PARTNER_IVS];
  }

  return { dexEntry, starterEntry };
}

function ensureComputerPartnerDexProgressEntry(
  progress: ComputerPartnerProgressData,
  speciesId: SpeciesId,
): ComputerPartnerDexProgressEntry {
  progress.dexData[speciesId] ??= {
    caughtAttr: 0n,
    natureAttr: 0,
    caughtCount: 0,
    hatchedCount: 0,
    ivs: [0, 0, 0, 0, 0, 0],
  };
  return progress.dexData[speciesId]!;
}

function ensureComputerPartnerStarterProgressEntry(
  progress: ComputerPartnerProgressData,
  speciesId: SpeciesId,
): ComputerPartnerStarterProgressEntry {
  progress.starterData[speciesId] ??= {
    eggMoves: 0,
    candyCount: 0,
    friendship: 0,
    abilityAttr: AbilityAttr.ABILITY_1,
    passiveAttr: 0,
    valueReduction: 0,
  };
  return progress.starterData[speciesId]!;
}

function getComputerPartnerDefaultDexAttr(species: PokemonSpecies): bigint {
  let dexAttr = DexAttr.NON_SHINY | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
  if (species.malePercent !== null) {
    if (species.malePercent > 0) {
      dexAttr |= DexAttr.MALE;
    }
    if (species.malePercent < 100) {
      dexAttr |= DexAttr.FEMALE;
    }
  }
  return dexAttr & species.getFullUnlocksData();
}

function getComputerPartnerProgressSpeciesId(speciesId: SpeciesId): SpeciesId {
  return getPokemonSpecies(speciesId).getRootSpeciesId(true);
}

export function getComputerPartnerReplacementScores(
  profile: ComputerPartnerProfile,
  party: PlayerPokemon[],
  candidate: ComputerPartnerScoringPokemon,
): ComputerPartnerSlotScore[] {
  if (!isComputerPartnerCandidateAllowed(profile, candidate)) {
    return [];
  }

  const currentTeamScore = scoreComputerPartnerTeam(profile, party);
  const replacementOptions =
    party.length < profile.roles.length
      ? [{ slotIndex: party.length, replacedPokemon: undefined, replacedPokemonIndex: undefined }]
      : party
          .map((replacedPokemon, replacedPokemonIndex) => ({
            slotIndex: replacedPokemonIndex,
            replacedPokemon,
            replacedPokemonIndex,
          }))
          .filter(option => !isComputerPartnerAcePokemon(option.replacedPokemon, profile));

  return replacementOptions.map(option => {
    const candidateParty =
      option.replacedPokemonIndex === undefined
        ? [...party, candidate]
        : party.map((pokemon, index) => (index === option.replacedPokemonIndex ? candidate : pokemon));
    const candidateTeamScore = scoreComputerPartnerTeam(profile, candidateParty);
    const candidateAssignment = candidateTeamScore.assignments.find(assignment => assignment.pokemon === candidate);
    const currentAssignment =
      option.replacedPokemon === undefined
        ? undefined
        : currentTeamScore.assignments.find(assignment => assignment.pokemon === option.replacedPokemon);
    const improvementRatio =
      currentTeamScore.totalScore > 0
        ? candidateTeamScore.totalScore / currentTeamScore.totalScore
        : Number.POSITIVE_INFINITY;
    const requiredImprovement =
      option.replacedPokemonIndex === undefined ? TEAM_FILL_IMPROVEMENT_RATIO : TEAM_REPLACEMENT_IMPROVEMENT_RATIO;

    return {
      slotIndex: option.slotIndex,
      role: candidateAssignment?.role ?? "balanced",
      currentScore: currentAssignment?.score,
      candidateScore: candidateAssignment?.score ?? 0,
      improvementRatio,
      canReplace: candidateAssignment !== undefined && improvementRatio >= requiredImprovement,
      replacedPokemon: option.replacedPokemon,
      replacedPokemonIndex: option.replacedPokemonIndex,
      currentTeamScore: currentTeamScore.totalScore,
      candidateTeamScore: candidateTeamScore.totalScore,
    };
  });
}

export function getBestComputerPartnerReplacementSlot(
  profile: ComputerPartnerProfile,
  party: PlayerPokemon[],
  candidate: ComputerPartnerScoringPokemon,
): ComputerPartnerSlotScore | undefined {
  return getComputerPartnerReplacementScores(profile, party, candidate)
    .filter(score => score.canReplace)
    .sort((a, b) => b.candidateTeamScore - a.candidateTeamScore || b.improvementRatio - a.improvementRatio)[0];
}

export function isComputerPartnerAcePokemon(
  pokemon: ComputerPartnerScoringPokemon | undefined,
  profile: ComputerPartnerProfile,
): boolean {
  if (!pokemon || !("computerPartnerAce" in pokemon)) {
    return false;
  }

  if (pokemon.computerPartnerAce) {
    return true;
  }

  return (
    (!!profile.starterSpeciesId || (profile.aceStarterSpeciesIds?.length ?? 0) > 0)
    && "metBiome" in pokemon
    && pokemon.metBiome === -1
    && (pokemon.metSpecies === profile.starterSpeciesId || !!profile.aceStarterSpeciesIds?.includes(pokemon.metSpecies))
  );
}

export function isComputerPartnerCandidateAllowed(
  profile: ComputerPartnerProfile,
  candidate: ComputerPartnerScoringPokemon,
): boolean {
  const allowedSpeciesIds = profile.allowedReplacementSpeciesIds;
  if (!allowedSpeciesIds || allowedSpeciesIds.length === 0) {
    return true;
  }

  return allowedSpeciesIds.includes(getPokemonSpeciesForScoring(candidate).speciesId);
}

function scoreComputerPartnerTeam(
  profile: ComputerPartnerProfile,
  party: ComputerPartnerScoringPokemon[],
): ComputerPartnerTeamScore {
  const assignablePokemon = party.filter(pokemon => !isComputerPartnerAcePokemon(pokemon, profile));
  const roles = profile.roles.filter(role => role !== "ace");

  return findBestComputerPartnerRoleAssignments(profile, party, roles, assignablePokemon);
}

function findBestComputerPartnerRoleAssignments(
  profile: ComputerPartnerProfile,
  party: ComputerPartnerScoringPokemon[],
  roles: ComputerPartnerRole[],
  pokemon: ComputerPartnerScoringPokemon[],
): ComputerPartnerTeamScore {
  if (pokemon.length === 0 || roles.length === 0) {
    return { totalScore: 0, assignments: [] };
  }

  let bestTeamScore: ComputerPartnerTeamScore = { totalScore: Number.NEGATIVE_INFINITY, assignments: [] };
  const [currentPokemon, ...remainingPokemon] = pokemon;

  if (remainingPokemon.length >= roles.length) {
    bestTeamScore = findBestComputerPartnerRoleAssignments(profile, party, roles, remainingPokemon);
  }

  roles.forEach((role, roleIndex) => {
    const remainingRoles = roles.filter((_, index) => index !== roleIndex);
    const score = scorePokemonForPartnerSlot(profile, role, currentPokemon, party, currentPokemon);
    const remainderScore = findBestComputerPartnerRoleAssignments(profile, party, remainingRoles, remainingPokemon);
    const totalScore = score + remainderScore.totalScore;

    if (totalScore > bestTeamScore.totalScore) {
      bestTeamScore = {
        totalScore,
        assignments: [{ role, pokemon: currentPokemon, score }, ...remainderScore.assignments],
      };
    }
  });

  return bestTeamScore;
}

export function scorePokemonForPartnerSlot(
  profile: ComputerPartnerProfile,
  role: ComputerPartnerRole,
  pokemon: ComputerPartnerScoringPokemon,
  party: ComputerPartnerScoringPokemon[],
  replacingPokemon?: ComputerPartnerScoringPokemon,
): number {
  const comparisonParty = replacingPokemon ? party.filter(partyPokemon => partyPokemon !== replacingPokemon) : party;
  const projectedPokemon = getProjectedPartnerPokemon(profile, pokemon, role);
  const projectedComparisonParty = comparisonParty.map(partyPokemon => {
    return getProjectedPartnerPokemon(profile, partyPokemon, "balanced").species;
  });
  return (
    scorePokemonForPartnerRole(projectedPokemon.species, role)
    + getOffensiveCoverageGain(projectedPokemon.species, projectedComparisonParty)
    + getDefensiveCoveragePatchValue(projectedPokemon.species, projectedComparisonParty)
    + getPersonalityTypeBonus(profile, projectedPokemon.species)
    + getCherylHealingSupportSpeciesBonus(profile, role, projectedPokemon.species)
    + getDawnHazardSupportSpeciesBonus(profile, role, projectedPokemon.species)
    - getSharedWeaknessPenalty(projectedPokemon.species, projectedComparisonParty)
    - projectedPokemon.growthCost
    - getProjectOverloadPenalty(profile, projectedPokemon.growthCost, comparisonParty)
  );
}

export function scorePokemonForPartnerRole(pokemon: ComputerPartnerScoringPokemon, role: ComputerPartnerRole): number {
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

function getProjectedPartnerPokemon(
  profile: ComputerPartnerProfile,
  pokemon: ComputerPartnerScoringPokemon,
  role: ComputerPartnerRole,
): ProjectedPartnerPokemon {
  const species = getPokemonSpeciesForScoring(pokemon);
  const currentLevel = getPokemonLevelForScoring(pokemon);
  const projections = getEvolutionProjections(species, currentLevel);

  return projections.sort((a, b) => {
    const leftScore =
      scorePokemonForPartnerRole(b.species, role)
      + getPersonalityTypeBonus(profile, b.species)
      + getCherylHealingSupportSpeciesBonus(profile, role, b.species)
      - b.growthCost;
    const rightScore =
      scorePokemonForPartnerRole(a.species, role)
      + getPersonalityTypeBonus(profile, a.species)
      + getCherylHealingSupportSpeciesBonus(profile, role, a.species)
      - a.growthCost;
    return leftScore - rightScore;
  })[0];
}

function getEvolutionProjections(
  species: PokemonSpecies,
  currentLevel: number,
  accumulatedCost = 0,
  visitedSpeciesIds = new Set<SpeciesId>(),
): ProjectedPartnerPokemon[] {
  if (visitedSpeciesIds.has(species.speciesId)) {
    return [];
  }

  const nextVisitedSpeciesIds = new Set(visitedSpeciesIds);
  nextVisitedSpeciesIds.add(species.speciesId);
  const projections: ProjectedPartnerPokemon[] = [{ species, growthCost: accumulatedCost }];
  const evolutions = speciesDataRegistry.hasEvolutions(species.speciesId)
    ? speciesDataRegistry.getEvolutions(species.speciesId)
    : [];
  const splitEvolutionCost = Math.max(evolutions.length - 1, 0) * 2;

  for (const evolution of evolutions) {
    const evolvedSpecies = getPokemonSpecies(evolution.speciesId);
    const evolutionCost = getEvolutionGrowthCost(evolution, currentLevel) + splitEvolutionCost;
    projections.push(
      ...getEvolutionProjections(
        evolvedSpecies,
        Math.max(currentLevel, evolution.level),
        accumulatedCost + evolutionCost,
        nextVisitedSpeciesIds,
      ),
    );
  }

  return projections;
}

function getEvolutionGrowthCost(evolution: SpeciesFormEvolution, currentLevel: number): number {
  const levelsAway = Math.max(evolution.level - currentLevel, 0);
  const levelCost = Math.min(levelsAway * LEVEL_GROWTH_COST, MAX_LEVEL_GROWTH_COST);
  const evolutionItem = evolution.item ?? EvolutionItem.NONE;
  const itemCost =
    evolutionItem === EvolutionItem.NONE
      ? 0
      : evolutionItem >= EvolutionItem.BLACK_AUGURITE
        ? RARE_EVOLUTION_ITEM_COST
        : COMMON_EVOLUTION_ITEM_COST;
  const conditionCost =
    evolution.condition?.data.reduce((total, condition) => total + getEvolutionConditionCost(condition.key), 0) ?? 0;

  return levelCost + itemCost + conditionCost;
}

function getEvolutionConditionCost(conditionKey: number): number {
  switch (conditionKey) {
    case EvoCondKey.FRIENDSHIP:
    case EvoCondKey.MOVE:
    case EvoCondKey.MOVE_TYPE:
    case EvoCondKey.TIME:
      return EVOLUTION_CONDITION_COST;
    case EvoCondKey.RANDOM_FORM:
      return 2;
    case EvoCondKey.GENDER:
    case EvoCondKey.NATURE:
      return 4;
    case EvoCondKey.PARTY_TYPE:
    case EvoCondKey.BIOME:
    case EvoCondKey.WEATHER:
    case EvoCondKey.SPECIES_CAUGHT:
    case EvoCondKey.HELD_ITEM:
      return EVOLUTION_CONDITION_COST * 2;
    case EvoCondKey.EVO_TREASURE_TRACKER:
      return EVOLUTION_CONDITION_COST * 3;
    case EvoCondKey.SHEDINJA:
      return EVOLUTION_CONDITION_COST * 4;
    case EvoCondKey.TYROGUE:
      return 3;
    default:
      return EVOLUTION_CONDITION_COST;
  }
}

function getProjectOverloadPenalty(
  profile: ComputerPartnerProfile,
  growthCost: number,
  party: ComputerPartnerScoringPokemon[],
): number {
  if (growthCost < PROJECT_GROWTH_COST_THRESHOLD) {
    return 0;
  }

  const existingProjects = party.filter(partyPokemon => {
    const projectedPokemon = getProjectedPartnerPokemon(profile, partyPokemon, "balanced");
    return projectedPokemon.growthCost >= PROJECT_GROWTH_COST_THRESHOLD;
  }).length;

  return existingProjects * PROJECT_OVERLOAD_COST;
}

function getOffensiveCoverageGain(
  pokemon: ComputerPartnerScoringPokemon,
  party: ComputerPartnerScoringPokemon[],
): number {
  let gain = 0;
  for (const defenderType of REGULAR_TYPES) {
    const currentBest = Math.max(
      1,
      ...party.map(partyPokemon => getBestOffensiveMultiplier(partyPokemon, defenderType)),
    );
    const candidateBest = getBestOffensiveMultiplier(pokemon, defenderType);
    if (candidateBest > currentBest) {
      gain += (candidateBest - currentBest) * 3;
    }
  }
  return gain;
}

function getDefensiveCoveragePatchValue(
  pokemon: ComputerPartnerScoringPokemon,
  party: ComputerPartnerScoringPokemon[],
): number {
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

function getSharedWeaknessPenalty(
  pokemon: ComputerPartnerScoringPokemon,
  party: ComputerPartnerScoringPokemon[],
): number {
  let penalty = 0;
  for (const attackType of REGULAR_TYPES) {
    const weakCount = party.filter(partyPokemon => getDefensiveMultiplier(partyPokemon, attackType) > 1).length;
    if (weakCount >= 2 && getDefensiveMultiplier(pokemon, attackType) > 1) {
      penalty += weakCount * 2;
    }
  }
  return penalty;
}

function getPersonalityTypeBonus(profile: ComputerPartnerProfile, pokemon: ComputerPartnerScoringPokemon): number {
  return getPokemonTypes(pokemon).filter(type => profile.personalityTypes.includes(type)).length * 3;
}

function getCherylHealingSupportSpeciesBonus(
  profile: ComputerPartnerProfile,
  role: ComputerPartnerRole,
  pokemon: ComputerPartnerScoringPokemon,
): number {
  if (profile.key !== "cheryl") {
    return 0;
  }

  const species = getPokemonSpeciesForScoring(pokemon);
  const accessScore = getSpeciesHealingSupportAccessScore(species);
  if (!accessScore) {
    return 0;
  }

  switch (role) {
    case "ace":
    case "hpBulk":
      return accessScore;
    case "bulk":
    case "defense":
    case "specialDefense":
      return accessScore * 0.7;
    default:
      return accessScore * 0.45;
  }
}

function getDawnHazardSupportSpeciesBonus(
  profile: ComputerPartnerProfile,
  role: ComputerPartnerRole,
  species: PokemonSpecies,
): number {
  if (profile.key !== "dawn_zorua") {
    return 0;
  }

  const accessScore = getSpeciesEntryHazardAccessScore(species);
  if (!accessScore) {
    return 0;
  }

  switch (role) {
    case "speed":
      return accessScore * 1.35;
    case "physical":
    case "special":
      return accessScore * 0.85;
    case "ace":
      return accessScore * 0.75;
    case "bulk":
    case "defense":
    case "specialDefense":
    case "hpBulk":
      return accessScore * 0.55;
    default:
      return accessScore * 0.7;
  }
}

function getBestOffensiveMultiplier(pokemon: ComputerPartnerScoringPokemon, defenderType: PokemonType): number {
  return Math.max(...getPokemonTypes(pokemon).map(attackType => getTypeDamageMultiplier(attackType, defenderType)));
}

function getDefensiveMultiplier(pokemon: ComputerPartnerScoringPokemon, attackType: PokemonType): number {
  return getPokemonTypes(pokemon).reduce((multiplier, defenderType) => {
    return multiplier * getTypeDamageMultiplier(attackType, defenderType);
  }, 1);
}

function getPokemonTypes(pokemon: ComputerPartnerScoringPokemon): PokemonType[] {
  if ("getTypes" in pokemon) {
    return pokemon.getTypes({ includeTeraType: false }).filter(type => isRegularType(type));
  }
  return [pokemon.type1, pokemon.type2].filter(type => isRegularType(type));
}

function getPokemonStat(pokemon: ComputerPartnerScoringPokemon, stat: PermanentStat): number {
  if ("getStat" in pokemon) {
    return pokemon.getStat(stat);
  }
  return pokemon.getBaseStat(stat);
}

function getPokemonSpeciesForScoring(pokemon: ComputerPartnerScoringPokemon): PokemonSpecies {
  if ("species" in pokemon) {
    return pokemon.species;
  }
  return pokemon;
}

function getPokemonLevelForScoring(pokemon: ComputerPartnerScoringPokemon): number {
  if ("level" in pokemon) {
    return pokemon.level;
  }
  return 1;
}

function isRegularType(type: PokemonType | null | undefined): type is PokemonType {
  return type !== undefined && type !== null && type !== PokemonType.UNKNOWN && type !== PokemonType.STELLAR;
}
