import { speciesDataRegistry } from "#app/global-species-data-registry";
import { EvoCondKey, EvolutionItem, type SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import { getTypeDamageMultiplier } from "#data/type";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PlayerGender } from "#enums/player-gender";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat, type PermanentStat } from "#enums/stat";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Starter, StarterMoveset } from "#types/save-data";
import { randSeedShuffle } from "#utils/common";
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
}

export interface ComputerPartnerStarterConfig {
  speciesId: SpeciesId;
  points: number;
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
    starterMoveset: [MoveId.CONFUSION],
    startingStarters: [
      { speciesId: SpeciesId.ABRA, points: 4, moveset: [MoveId.CONFUSION] },
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
      { speciesId: SpeciesId.ELECTRODE, points: 2 },
      { speciesId: SpeciesId.ZUBAT, points: 3 },
    ],
  },
};

export const COMPUTER_PARTNER_KEYS = Object.keys(COMPUTER_PARTNER_PROFILES) as ComputerPartnerKey[];

export function getComputerPartnerProfile(key: ComputerPartnerKey): ComputerPartnerProfile {
  return COMPUTER_PARTNER_PROFILES[key] ?? COMPUTER_PARTNER_PROFILES.alex;
}

export function getComputerPartnerProfileWithRolePreferences(
  key: ComputerPartnerKey,
  rolePreferences?: ComputerPartnerRolePreferences,
): ComputerPartnerProfile {
  const profile = getComputerPartnerProfile(key);
  if (key !== "alex" || !rolePreferences?.length) {
    return profile;
  }

  const defaultRoles = profile.roles.slice(1);
  return {
    ...profile,
    roles: ["ace", ...rolePreferences, ...defaultRoles.slice(rolePreferences.length)],
  };
}

export function createComputerPartnerStarter(profile: ComputerPartnerProfile): Starter[] {
  const startingStarters = getComputerPartnerStartingStarters(profile);

  if (!startingStarters.length) {
    return [];
  }

  return startingStarters.map(starter => ({
    speciesId: starter.speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    abilityIndex: 0,
    passive: false,
    nature: starter.nature ?? profile.starterNature,
    moveset: starter.moveset ?? getDefaultComputerPartnerStarterMoveset(starter.speciesId),
    pokerus: false,
    ivs: [...DEFAULT_PARTNER_IVS],
  }));
}

function getComputerPartnerStartingStarters(profile: ComputerPartnerProfile): ComputerPartnerStarterConfig[] {
  if (profile.startingStarters?.length) {
    return buildComputerPartnerStarterTeam(profile.startingStarters);
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

function buildComputerPartnerStarterTeam(starters: ComputerPartnerStarterConfig[]): ComputerPartnerStarterConfig[] {
  const [ace, ...candidates] = starters;

  if (!ace) {
    return [];
  }

  const selectedStarters = [ace];
  let remainingPoints = COMPUTER_PARTNER_STARTER_POINT_LIMIT - ace.points;

  for (const starter of randSeedShuffle([...candidates])) {
    if (starter.points > remainingPoints) {
      continue;
    }

    selectedStarters.push(starter);
    remainingPoints -= starter.points;
  }

  return selectedStarters;
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
  candidate: ComputerPartnerScoringPokemon,
): ComputerPartnerSlotScore[] {
  const currentTeamScore = scoreComputerPartnerTeam(profile, party);
  const replacementOptions =
    party.length < profile.roles.length
      ? [{ slotIndex: party.length, replacedPokemon: undefined, replacedPokemonIndex: undefined }]
      : party
          .map((replacedPokemon, replacedPokemonIndex) => ({ slotIndex: replacedPokemonIndex, replacedPokemon, replacedPokemonIndex }))
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
    !!profile.starterSpeciesId
    && "metBiome" in pokemon
    && pokemon.metBiome === -1
    && pokemon.metSpecies === profile.starterSpeciesId
  );
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
  if (!pokemon.length || !roles.length) {
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
    const leftScore = scorePokemonForPartnerRole(b.species, role) + getPersonalityTypeBonus(profile, b.species) - b.growthCost;
    const rightScore = scorePokemonForPartnerRole(a.species, role) + getPersonalityTypeBonus(profile, a.species) - a.growthCost;
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
  const conditionCost = evolution.condition?.data.reduce((total, condition) => total + getEvolutionConditionCost(condition.key), 0) ?? 0;

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

function getOffensiveCoverageGain(pokemon: ComputerPartnerScoringPokemon, party: ComputerPartnerScoringPokemon[]): number {
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

function getSharedWeaknessPenalty(pokemon: ComputerPartnerScoringPokemon, party: ComputerPartnerScoringPokemon[]): number {
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
