import { speciesDataRegistry } from "#app/global-species-data-registry";
import { EvoCondKey } from "#balance/pokemon-evolutions";
import { BattlerTagType } from "#enums/battler-tag-type";
import { AbilityId } from "#enums/ability-id";
import { allMoves } from "#data/data-lists";
import { BerryType } from "#enums/berry-type";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { ModifierTier } from "#enums/modifier-tier";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat, type PermanentStat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { PlayerPokemon } from "#field/pokemon";
import {
  AttackTypeBoosterModifierType,
  BaseStatBoosterModifierType,
  BerryModifierType,
  ContactHeldItemTransferChanceModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonMoveAccuracyBoosterModifierType,
  PokemonMultiHitModifierType,
  SpeciesStatBoosterModifierType,
  TerastallizeModifierType,
  TmModifierType,
  TurnHeldItemTransferModifierType,
  type ModifierType,
  type ModifierTypeOption,
} from "#modifiers/modifier-type";
import type { PokemonMove } from "#moves/pokemon-move";
import { randSeedItem } from "#utils/common";
import { getDawnStrategyMoveCapabilities } from "#utils/computer-partner-hazard-support";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import {
  isComputerPartnerAcePokemon,
  type ComputerPartnerProfile,
  type ComputerPartnerRole,
} from "#utils/computer-partner-profile";
import { isLoadedDiceBoostedMove } from "#utils/loaded-dice-utils";

export type ComputerPartnerRecoveryItemId =
  | "POTION"
  | "SUPER_POTION"
  | "HYPER_POTION"
  | "MAX_POTION"
  | "FULL_RESTORE"
  | "REVIVE"
  | "MAX_REVIVE"
  | "FULL_HEAL"
  | "SACRED_ASH"
  | "ETHER"
  | "MAX_ETHER"
  | "ELIXIR"
  | "MAX_ELIXIR";

export type ComputerPartnerRecoveryKind = "heal" | "revive" | "status" | "pp";

interface RecoveryItemProfile {
  id: ComputerPartnerRecoveryItemId;
  kind: ComputerPartnerRecoveryKind;
  healPoints?: number;
  healPercent?: number;
  healStatus?: boolean;
  revivePercent?: number;
  partyRevive?: boolean;
  ppPoints?: number;
  allMoves?: boolean;
}

export interface ComputerPartnerRecoveryChoice {
  option: ModifierTypeOption;
  optionIndex: number;
  itemId: ComputerPartnerRecoveryItemId;
  kind: ComputerPartnerRecoveryKind;
  score: number;
  targetPokemonIndex?: number;
  targetMoveIndex?: number;
  reason: string;
  usefulValue: number;
  wastedValue: number;
  cost: number;
  isEmergency: boolean;
  reserveCost?: number;
  moneyAfterPurchase?: number;
}

export interface ComputerPartnerRewardChoice {
  option: ModifierTypeOption;
  optionIndex: number;
  itemId: string;
  score: number;
  effectiveTier: ModifierTier;
  priority: number;
  targetPokemonIndex?: number;
  targetMoveIndex?: number;
  reason: string;
  recoveryChoice?: ComputerPartnerRecoveryChoice;
}

export interface ComputerPartnerRewardContext {
  pokeballCounts?: Partial<Record<PokeballType, number>>;
  computerPartnerProfile?: ComputerPartnerProfile;
}

interface RewardTarget {
  targetPokemonIndex?: number;
  targetMoveIndex?: number;
  targetScore?: number;
}

const MIN_HEALING_MISSING_HP_RATIO = 0.2;
const URGENT_HEALING_HP_RATIO = 0.35;
const MIN_SINGLE_MOVE_PP_MISSING = 4;
const MIN_TOTAL_PP_MISSING = 8;
const MAINTENANCE_PP_MISSING_RATIO = 0.5;
const WASTE_PENALTY = 0.35;

const RECOVERY_ITEM_PROFILES: Record<ComputerPartnerRecoveryItemId, RecoveryItemProfile> = {
  POTION: { id: "POTION", kind: "heal", healPoints: 20, healPercent: 10 },
  SUPER_POTION: { id: "SUPER_POTION", kind: "heal", healPoints: 50, healPercent: 25 },
  HYPER_POTION: { id: "HYPER_POTION", kind: "heal", healPoints: 200, healPercent: 50 },
  MAX_POTION: { id: "MAX_POTION", kind: "heal", healPercent: 100 },
  FULL_RESTORE: { id: "FULL_RESTORE", kind: "heal", healPercent: 100, healStatus: true },
  REVIVE: { id: "REVIVE", kind: "revive", revivePercent: 50 },
  MAX_REVIVE: { id: "MAX_REVIVE", kind: "revive", revivePercent: 100 },
  FULL_HEAL: { id: "FULL_HEAL", kind: "status" },
  SACRED_ASH: { id: "SACRED_ASH", kind: "revive", revivePercent: 100, partyRevive: true },
  ETHER: { id: "ETHER", kind: "pp", ppPoints: 10 },
  MAX_ETHER: { id: "MAX_ETHER", kind: "pp", ppPoints: -1 },
  ELIXIR: { id: "ELIXIR", kind: "pp", ppPoints: 10, allMoves: true },
  MAX_ELIXIR: { id: "MAX_ELIXIR", kind: "pp", ppPoints: -1, allMoves: true },
};

const ICON_TO_RECOVERY_ITEM_ID: Partial<Record<string, ComputerPartnerRecoveryItemId>> = {
  potion: "POTION",
  super_potion: "SUPER_POTION",
  hyper_potion: "HYPER_POTION",
  max_potion: "MAX_POTION",
  full_restore: "FULL_RESTORE",
  revive: "REVIVE",
  max_revive: "MAX_REVIVE",
  full_heal: "FULL_HEAL",
  sacred_ash: "SACRED_ASH",
  ether: "ETHER",
  max_ether: "MAX_ETHER",
  elixir: "ELIXIR",
  max_elixir: "MAX_ELIXIR",
};

const REWARD_PRIORITY: Partial<Record<ComputerPartnerRecoveryItemId | string, number>> = {
  MINI_BLACK_HOLE: 1,
  GAMMA_RAY_BURST: 2,
  GRAND_LAUREL: 3,
  EON_FLUTE: 4,
  SHINY_CHARM: 4,
  MULTI_LENS: 5,
  HEALING_CHARM: 6,
  SHINY_BADGE: 7,
  MASTER_BALL: 8,
  LINKING_CORD_GOLD: 9,

  LEFTOVERS: 1,
  DYNAMAX_BAND: 2,
  MEGA_BRACELET: 3,
  RARE_FORM_CHANGE_ITEM: 4,
  GRIP_CLAW: 5,
  BERRY_POUCH: 6,
  SHELL_BELL: 7,
  SCOPE_LENS: 8,
  KINGS_ROCK: 9,
  FOCUS_BAND: 10,
  BATON: 11,
  CATCHING_CHARM: 12,
  ABILITY_CHARM: 13,
  SOUL_DEW: 14,
  ROGUE_BALL: 15,
  RELIC_GOLD: 16,
  SUPER_EXP_CHARM: 17,

  GOLDEN_PUNCH: 1,
  RARE_EVOLUTION_ITEM: 2,
  FORM_CHANGE_ITEM: 3,
  RARE_SPECIES_STAT_BOOSTER: 4,
  AMULET_COIN: 5,
  TERA_ORB: 6,
  REVIVER_SEED: 7,
  QUICK_CLAW: 8,
  WIDE_LENS: 9,
  CANDY_JAR: 10,
  EXP_CHARM: 12,
  EXP_SHARE: 13,
  ATTACK_TYPE_BOOSTER: 14,
  LEEK: 15,
  MYSTICAL_ROCK: 16,
  LIGHT_CLAY: 16,
  LOADED_DICE: 17,
  UNOWN_BOX: 17,
  TM_ULTRA: 17,
  MINT: 18,
  PP_MAX: 19,
  ULTRA_BALL: 20,
  BIG_NUGGET: 21,
  EVIOLITE: 22,
  FLAME_ORB: 23,
  TOXIC_ORB: 24,
  RARER_CANDY: 25,

  EVOLUTION_ITEM: 1,
  SPECIES_STAT_BOOSTER: 2,
  BASE_STAT_BOOSTER: 3,
  TERA_SHARD: 4,
  TM_GREAT: 5,
  GREAT_BALL: 6,
  PP_UP: 7,
  SACRED_ASH: 8,
  MAX_REVIVE: 9,
  REVIVE: 10,
  DIRE_HIT: 11,
  NUGGET: 12,
  FULL_HEAL: 13,
  HYPER_POTION: 13,
  MAX_POTION: 13,
  FULL_RESTORE: 13,
  MAX_ELIXIR: 13,
  ELIXIR: 13,
  SOOTHE_BELL: 14,

  POKEBALL: 1,
  TM_COMMON: 2,
  RARE_CANDY: 3,
  TEMP_STAT_STAGE_BOOSTER: 4,
  POTION: 5,
  SUPER_POTION: 5,
  ETHER: 5,
  MAX_ETHER: 5,
  MIRROR_HERB: 6,
  BERRY: 7,
};

const ZERO_BALL_REWARD_PRIORITY: Partial<Record<string, number>> = {
  POKEBALL: 1,
  GREAT_BALL: 3,
  ULTRA_BALL: 10,
  ROGUE_BALL: 8,
};

const IGNORED_REWARD_IDS = new Set<string>([
  "VOUCHER_PREMIUM",
  "VOUCHER_PLUS",
  "VOUCHER",
  "DNA_SPLICERS",
  "LOCK_CAPSULE",
  "MAX_LURE",
  "IV_SCANNER",
  "SUPER_LURE",
  "MAP",
  "MEMORY_MUSHROOM",
  "LURE",
]);

function getRecoveryItemProfile(type: ModifierType): RecoveryItemProfile | undefined {
  const id = type.id as ComputerPartnerRecoveryItemId | undefined;
  if (id && Object.hasOwn(RECOVERY_ITEM_PROFILES, id)) {
    return RECOVERY_ITEM_PROFILES[id];
  }

  const iconId = ICON_TO_RECOVERY_ITEM_ID[type.iconImage];
  return iconId ? RECOVERY_ITEM_PROFILES[iconId] : undefined;
}

function getRewardItemId(type: ModifierType): string | undefined {
  if (type instanceof TmModifierType) {
    switch (type.tier) {
      case ModifierTier.COMMON:
        return "TM_COMMON";
      case ModifierTier.GREAT:
        return "TM_GREAT";
      case ModifierTier.ULTRA:
        return "TM_ULTRA";
      default:
        return "TM";
    }
  }

  if (type instanceof BerryModifierType) {
    return "BERRY";
  }

  if (type.id) {
    return type.id;
  }

  return ICON_TO_RECOVERY_ITEM_ID[type.iconImage] ?? type.iconImage?.toUpperCase();
}

function getTierRank(tier: ModifierTier): number {
  switch (tier) {
    case ModifierTier.COMMON:
      return 0;
    case ModifierTier.GREAT:
      return 1;
    case ModifierTier.ULTRA:
      return 2;
    case ModifierTier.ROGUE:
      return 3;
    case ModifierTier.MASTER:
      return 4;
    default:
      return -1;
  }
}

function getEmergencyRecoveryTier(tier: ModifierTier): ModifierTier {
  switch (tier) {
    case ModifierTier.COMMON:
      return ModifierTier.GREAT;
    case ModifierTier.GREAT:
      return ModifierTier.ULTRA;
    case ModifierTier.ULTRA:
      return ModifierTier.ROGUE;
    case ModifierTier.ROGUE:
      return ModifierTier.MASTER;
    default:
      return tier;
  }
}

function getPokeballTypeForReward(itemId: string): PokeballType | undefined {
  switch (itemId) {
    case "POKEBALL":
      return PokeballType.POKEBALL;
    case "GREAT_BALL":
      return PokeballType.GREAT_BALL;
    case "ULTRA_BALL":
      return PokeballType.ULTRA_BALL;
    case "ROGUE_BALL":
      return PokeballType.ROGUE_BALL;
    default:
      return undefined;
  }
}

function getRewardPriority(itemId: string, listedPriority: number, context: ComputerPartnerRewardContext): number {
  const pokeballType = getPokeballTypeForReward(itemId);
  const zeroBallPriority = ZERO_BALL_REWARD_PRIORITY[itemId];
  if (
    pokeballType !== undefined
    && zeroBallPriority !== undefined
    && context.pokeballCounts?.[pokeballType] === 0
  ) {
    return Math.min(listedPriority, zeroBallPriority);
  }

  return listedPriority;
}

function getTargetablePartyIndexes(
  type: PokemonModifierType,
  party: PlayerPokemon[],
  predicate: (pokemon: PlayerPokemon) => boolean = () => true,
): number[] {
  return party
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon }) => predicate(pokemon) && (!type.selectFilter || type.selectFilter(pokemon) === null))
    .map(({ index }) => index);
}

function chooseGenericPokemonTarget(type: PokemonModifierType, party: PlayerPokemon[]): number | undefined {
  return getTargetablePartyIndexes(type, party)[0];
}

function chooseComputerPartnerAceTarget(
  type: PokemonModifierType,
  party: PlayerPokemon[],
  profile?: ComputerPartnerProfile,
): number | undefined {
  if (!profile) {
    return undefined;
  }

  return getTargetablePartyIndexes(type, party, pokemon => isComputerPartnerAcePokemon(pokemon, profile))[0];
}

function chooseMoveModifierTarget(
  type: PokemonMoveModifierType,
  party: PlayerPokemon[],
): { pokemonIndex: number; moveIndex: number } | undefined {
  let bestTarget: { pokemonIndex: number; moveIndex: number; moveMaxPp: number; ppUp: number } | undefined;

  for (const [pokemonIndex, pokemon] of party.entries()) {
    if (type.selectFilter && type.selectFilter(pokemon) !== null) {
      continue;
    }

    for (const [moveIndex, move] of pokemon.getMoveset().entries()) {
      if (type.moveSelectFilter && type.moveSelectFilter(move) !== null) {
        continue;
      }

      const candidate = {
        pokemonIndex,
        moveIndex,
        moveMaxPp: move.getMovePp(),
        ppUp: move.ppUp,
      };
      if (
        !bestTarget
        || candidate.ppUp < bestTarget.ppUp
        || (candidate.ppUp === bestTarget.ppUp && candidate.moveMaxPp < bestTarget.moveMaxPp)
      ) {
        bestTarget = candidate;
      }
    }
  }

  return bestTarget ? { pokemonIndex: bestTarget.pokemonIndex, moveIndex: bestTarget.moveIndex } : undefined;
}

function chooseAttackTypeBoosterTarget(type: AttackTypeBoosterModifierType, party: PlayerPokemon[]): number | undefined {
  return getTargetablePartyIndexes(type, party, pokemon =>
    pokemon.isOfType(type.moveType, { includeTeraType: false, returnOriginalTypesIfStellar: true }),
  )[0];
}

function chooseLoadedDiceTarget(type: PokemonModifierType, party: PlayerPokemon[]): RewardTarget | undefined {
  return getTargetablePartyIndexes(type, party, pokemon =>
    pokemon.getMoveset(true).some(move => move && isLoadedDiceBoostedMove(move.getMove())),
  )
    .map(targetPokemonIndex => {
      const usefulMoveCount = party[targetPokemonIndex]
        .getMoveset(true)
        .filter(move => move && isLoadedDiceBoostedMove(move.getMove())).length;

      return {
        targetPokemonIndex,
        targetScore: usefulMoveCount * 35 - targetPokemonIndex,
      };
    })
    .sort((a, b) => b.targetScore - a.targetScore)[0];
}

function chooseTeraShardTarget(type: TerastallizeModifierType, party: PlayerPokemon[]): number | undefined {
  const teraType = type.getPregenArgs()[0];
  return getTargetablePartyIndexes(type, party, pokemon =>
    pokemon.isOfType(teraType, { includeTeraType: false, returnOriginalTypesIfStellar: true }),
  )[0];
}

const STAT_BERRY_STATS: Partial<Record<BerryType, PermanentStat>> = {
  [BerryType.LIECHI]: Stat.ATK,
  [BerryType.GANLON]: Stat.DEF,
  [BerryType.PETAYA]: Stat.SPATK,
  [BerryType.APICOT]: Stat.SPDEF,
  [BerryType.SALAC]: Stat.SPD,
};

const SPECIES_STAT_BOOSTER_SPECIES: Partial<Record<string, SpeciesId[]>> = {
  LIGHT_BALL: [SpeciesId.PIKACHU],
  THICK_CLUB: [SpeciesId.CUBONE, SpeciesId.MAROWAK, SpeciesId.ALOLA_MAROWAK],
  METAL_POWDER: [SpeciesId.DITTO],
  QUICK_POWDER: [SpeciesId.DITTO],
  DEEP_SEA_SCALE: [SpeciesId.CLAMPERL],
  DEEP_SEA_TOOTH: [SpeciesId.CLAMPERL],
};

const LEEK_SPECIES = [SpeciesId.FARFETCHD, SpeciesId.GALAR_FARFETCHD, SpeciesId.SIRFETCHD];

const WEATHER_OR_TERRAIN_MOVE_IDS = new Set<MoveId>([
  MoveId.SUNNY_DAY,
  MoveId.RAIN_DANCE,
  MoveId.SANDSTORM,
  MoveId.SNOWSCAPE,
  MoveId.HAIL,
  MoveId.CHILLY_RECEPTION,
  MoveId.ELECTRIC_TERRAIN,
  MoveId.PSYCHIC_TERRAIN,
  MoveId.GRASSY_TERRAIN,
  MoveId.MISTY_TERRAIN,
]);

const WEATHER_OR_TERRAIN_ABILITY_IDS = [
  AbilityId.DROUGHT,
  AbilityId.ORICHALCUM_PULSE,
  AbilityId.DRIZZLE,
  AbilityId.SAND_STREAM,
  AbilityId.SAND_SPIT,
  AbilityId.SNOW_WARNING,
  AbilityId.ELECTRIC_SURGE,
  AbilityId.HADRON_ENGINE,
  AbilityId.PSYCHIC_SURGE,
  AbilityId.GRASSY_SURGE,
  AbilityId.SEED_SOWER,
  AbilityId.MISTY_SURGE,
] as const;

const SCREEN_MOVE_IDS = new Set<MoveId>([
  MoveId.LIGHT_SCREEN,
  MoveId.REFLECT,
  MoveId.AURORA_VEIL,
  MoveId.GLITZY_GLOW,
  MoveId.BADDY_BAD,
]);

const SETUP_MOVE_IDS = new Set<MoveId>([
  MoveId.SWORDS_DANCE,
  MoveId.GROWTH,
  MoveId.AGILITY,
  MoveId.AMNESIA,
  MoveId.COSMIC_POWER,
  MoveId.IRON_DEFENSE,
  MoveId.BULK_UP,
  MoveId.CALM_MIND,
  MoveId.DRAGON_DANCE,
  MoveId.NASTY_PLOT,
  MoveId.HONE_CLAWS,
  MoveId.QUIVER_DANCE,
  MoveId.COIL,
  MoveId.SHELL_SMASH,
  MoveId.WORK_UP,
  MoveId.PSYSHIELD_BASH,
  MoveId.MYSTICAL_POWER,
  MoveId.VICTORY_DANCE,
  MoveId.ESPER_WING,
  MoveId.SHELTER,
  MoveId.TAKE_HEART,
  MoveId.TIDY_UP,
  MoveId.TORCH_SONG,
  MoveId.AQUA_STEP,
  MoveId.TRAILBLAZE,
  MoveId.ELECTRO_SHOT,
]);

function toRewardTarget(targetPokemonIndex: number, targetScore = 0): RewardTarget {
  return { targetPokemonIndex, targetScore };
}

function getKnownMoves(pokemon: PlayerPokemon): PokemonMove[] {
  return pokemon.getMoveset(true).filter((move): move is PokemonMove => move != null);
}

function hasMoveId(pokemon: PlayerPokemon, moveIds: ReadonlySet<MoveId>): boolean {
  return getKnownMoves(pokemon).some(move => moveIds.has(move.moveId));
}

function hasSpeciesInList(pokemon: PlayerPokemon, speciesIds: readonly SpeciesId[]): boolean {
  return (
    speciesIds.includes(pokemon.getSpeciesForm(true).speciesId)
    || (pokemon.isFusion() && speciesIds.includes(pokemon.getFusionSpeciesForm(true).speciesId))
  );
}

function chooseRandomPokemonTarget(type: PokemonModifierType, party: PlayerPokemon[]): RewardTarget | undefined {
  const indexes = getTargetablePartyIndexes(type, party);
  return indexes.length ? toRewardTarget(randSeedItem(indexes)) : undefined;
}

function chooseScoredPokemonTarget(
  type: PokemonModifierType,
  party: PlayerPokemon[],
  scorer: (pokemon: PlayerPokemon, targetPokemonIndex: number) => number | undefined,
  predicate: (pokemon: PlayerPokemon) => boolean = () => true,
  profile?: ComputerPartnerProfile,
  excludeAce = false,
): RewardTarget | undefined {
  const bestTarget = getTargetablePartyIndexes(
    type,
    party,
    pokemon => predicate(pokemon) && !(excludeAce && profile && isComputerPartnerAcePokemon(pokemon, profile)),
  )
    .map(targetPokemonIndex => ({
      targetPokemonIndex,
      targetScore: scorer(party[targetPokemonIndex], targetPokemonIndex),
    }))
    .filter((target): target is { targetPokemonIndex: number; targetScore: number } => target.targetScore !== undefined)
    .sort((a, b) => b.targetScore - a.targetScore || a.targetPokemonIndex - b.targetPokemonIndex)[0];

  return bestTarget;
}

function chooseAcePreferredTarget(
  type: PokemonModifierType,
  party: PlayerPokemon[],
  profile: ComputerPartnerProfile | undefined,
  fallback: () => RewardTarget | undefined = () => chooseRandomPokemonTarget(type, party),
): RewardTarget | undefined {
  const aceTargetPokemonIndex = chooseComputerPartnerAceTarget(type, party, profile);
  if (aceTargetPokemonIndex !== undefined) {
    return toRewardTarget(aceTargetPokemonIndex, 500);
  }

  return fallback();
}

function chooseStrongestTarget(
  type: PokemonModifierType,
  party: PlayerPokemon[],
  profile?: ComputerPartnerProfile,
  excludeAce = false,
): RewardTarget | undefined {
  return (
    chooseScoredPokemonTarget(type, party, getAttackingStatScore, undefined, profile, excludeAce)
    ?? (excludeAce ? chooseScoredPokemonTarget(type, party, getAttackingStatScore) : undefined)
  );
}

function chooseBulkiestTarget(
  type: PokemonModifierType,
  party: PlayerPokemon[],
  profile?: ComputerPartnerProfile,
  excludeAce = false,
): RewardTarget | undefined {
  return (
    chooseScoredPokemonTarget(type, party, getBulkScore, undefined, profile, excludeAce)
    ?? (excludeAce ? chooseScoredPokemonTarget(type, party, getBulkScore) : undefined)
  );
}

function getAttackingStatScore(pokemon: PlayerPokemon, targetPokemonIndex: number): number {
  return Math.max(pokemon.getStat(Stat.ATK), pokemon.getStat(Stat.SPATK)) - targetPokemonIndex;
}

function getBulkScore(pokemon: PlayerPokemon, targetPokemonIndex: number): number {
  return pokemon.getMaxHp() + pokemon.getStat(Stat.DEF) + pokemon.getStat(Stat.SPDEF) - targetPokemonIndex;
}

function getSlowestScore(pokemon: PlayerPokemon, targetPokemonIndex: number): number {
  return -pokemon.getStat(Stat.SPD) - targetPokemonIndex / 100;
}

function getFastestScore(pokemon: PlayerPokemon, targetPokemonIndex: number): number {
  return pokemon.getStat(Stat.SPD) - targetPokemonIndex;
}

function getLowestHealthScore(pokemon: PlayerPokemon, targetPokemonIndex: number): number | undefined {
  if (pokemon.isFainted()) {
    return undefined;
  }
  return -pokemon.getHpRatio() * 1000 - targetPokemonIndex;
}

function getLeastAccurateMoveScore(pokemon: PlayerPokemon, targetPokemonIndex: number): number | undefined {
  const leastAccuracy = getKnownMoves(pokemon)
    .map(move => move.getMove().accuracy)
    .filter(accuracy => accuracy > 0)
    .sort((a, b) => a - b)[0];

  return leastAccuracy !== undefined ? 100 - leastAccuracy - targetPokemonIndex / 100 : undefined;
}

function hasMultiHitMove(pokemon: PlayerPokemon): boolean {
  return getKnownMoves(pokemon).some(move => isLoadedDiceBoostedMove(move.getMove()));
}

function hasContactMove(pokemon: PlayerPokemon): boolean {
  return getKnownMoves(pokemon).some(move => move.getMove().hasFlag(MoveFlags.MAKES_CONTACT));
}

function hasHighCritMoveOrAbility(pokemon: PlayerPokemon): boolean {
  return (
    [AbilityId.SUPER_LUCK, AbilityId.SNIPER, AbilityId.MERCILESS].some(ability => pokemon.hasAbility(ability, false, true))
    || getKnownMoves(pokemon).some(move => move.getMove().hasAttr("HighCritAttr"))
  );
}

function hasFriendshipEvolution(pokemon: PlayerPokemon): boolean {
  const speciesIds = [
    pokemon.getSpeciesForm(true).speciesId,
    ...(pokemon.isFusion() ? [pokemon.getFusionSpeciesForm(true).speciesId] : []),
  ];

  return speciesIds.some(speciesId =>
    speciesDataRegistry.hasEvolutions(speciesId)
    && speciesDataRegistry
      .getEvolutions(speciesId)
      .some(evolution => evolution.condition?.data.some(condition => condition.key === EvoCondKey.FRIENDSHIP)),
  );
}

function canBenefitFromEviolite(pokemon: PlayerPokemon): boolean {
  return (
    !pokemon.isMax()
    && (
      speciesDataRegistry.hasEvolutions(pokemon.getSpeciesForm(true).speciesId)
      || (pokemon.isFusion() && speciesDataRegistry.hasEvolutions(pokemon.getFusionSpeciesForm(true).speciesId))
    )
  );
}

function hasWeatherOrTerrainSource(pokemon: PlayerPokemon): boolean {
  return (
    hasMoveId(pokemon, WEATHER_OR_TERRAIN_MOVE_IDS)
    || WEATHER_OR_TERRAIN_ABILITY_IDS.some(ability => pokemon.hasAbility(ability, false, true))
  );
}

function getSpeciesStatBoosterTarget(type: SpeciesStatBoosterModifierType, party: PlayerPokemon[]): RewardTarget | undefined {
  const key = type.getPregenArgs()[0] as string | undefined;
  const speciesIds = key ? SPECIES_STAT_BOOSTER_SPECIES[key] : undefined;
  if (!speciesIds) {
    return undefined;
  }

  const targetPokemonIndex = getTargetablePartyIndexes(type, party, pokemon => hasSpeciesInList(pokemon, speciesIds))[0];
  return targetPokemonIndex !== undefined ? toRewardTarget(targetPokemonIndex, 250) : undefined;
}

function getBerryTarget(type: BerryModifierType, party: PlayerPokemon[], profile?: ComputerPartnerProfile): RewardTarget | undefined {
  const berryType = type.getPregenArgs()[0] as BerryType | undefined;
  const stat = berryType === undefined ? undefined : STAT_BERRY_STATS[berryType];
  if (stat !== undefined) {
    return chooseScoredPokemonTarget(type, party, (pokemon, targetPokemonIndex) => pokemon.getStat(stat) - targetPokemonIndex);
  }

  if (berryType === BerryType.LANSAT) {
    return (
      chooseAcePreferredTarget(type, party, profile, () =>
        chooseScoredPokemonTarget(type, party, pokemon => hasHighCritMoveOrAbility(pokemon) ? 200 : undefined))
      ?? chooseRandomPokemonTarget(type, party)
    );
  }

  return chooseAcePreferredTarget(type, party, profile, () => chooseRandomPokemonTarget(type, party));
}

function getOrbTargetScore(itemId: string, pokemon: PlayerPokemon, targetPokemonIndex: number): number | undefined {
  if (pokemon.getHeldItems().some(item => item.type.id === "FLAME_ORB" || item.type.id === "TOXIC_ORB")) {
    return undefined;
  }

  const statusEffect = itemId === "FLAME_ORB" ? StatusEffect.BURN : StatusEffect.TOXIC;
  const canSetStatus = pokemon.canSetStatus(statusEffect, true, true, null, true);
  const moveset = getKnownMoves(pokemon).map(move => move.moveId);
  const hasStatusMove = [MoveId.FACADE, MoveId.PSYCHO_SHIFT].some(move => moveset.includes(move));

  if (!canSetStatus && !hasStatusMove) {
    return undefined;
  }

  const hasGeneralAbility = [
    AbilityId.QUICK_FEET,
    AbilityId.GUTS,
    AbilityId.MARVEL_SCALE,
    AbilityId.MAGIC_GUARD,
  ].some(ability => pokemon.hasAbility(ability, false, true));
  const hasSpecificAbility =
    itemId === "FLAME_ORB"
      ? pokemon.hasAbility(AbilityId.FLARE_BOOST, false, true)
      : [AbilityId.TOXIC_BOOST, AbilityId.POISON_HEAL].some(ability => pokemon.hasAbility(ability, false, true));
  const hasOppositeAbility =
    itemId === "FLAME_ORB"
      ? [AbilityId.TOXIC_BOOST, AbilityId.POISON_HEAL].some(ability => pokemon.hasAbility(ability, false, true))
      : pokemon.hasAbility(AbilityId.FLARE_BOOST, false, true);

  if (hasSpecificAbility) {
    return 400 - targetPokemonIndex;
  }
  if (hasGeneralAbility && !hasOppositeAbility) {
    return 300 - targetPokemonIndex;
  }
  if (hasStatusMove) {
    return 150 - targetPokemonIndex;
  }

  return undefined;
}

function chooseOrbTarget(type: PokemonModifierType, itemId: string, party: PlayerPokemon[]): RewardTarget | undefined {
  return chooseScoredPokemonTarget(type, party, (pokemon, targetPokemonIndex) =>
    getOrbTargetScore(itemId, pokemon, targetPokemonIndex));
}

function getBetterOffensiveStat(pokemon: PlayerPokemon): PermanentStat {
  return pokemon.getStat(Stat.ATK) >= pokemon.getStat(Stat.SPATK) ? Stat.ATK : Stat.SPATK;
}

function getWeakerBulkStat(pokemon: PlayerPokemon): PermanentStat {
  return pokemon.getStat(Stat.DEF) <= pokemon.getStat(Stat.SPDEF) ? Stat.DEF : Stat.SPDEF;
}

function getComputerPartnerRolePreferredStats(role: ComputerPartnerRole, pokemon: PlayerPokemon): PermanentStat[] {
  switch (role) {
    case "physical":
      return [Stat.ATK, Stat.SPD, Stat.HP];
    case "special":
      return [Stat.SPATK, Stat.SPD, Stat.HP];
    case "bulk":
      return [Stat.HP, getWeakerBulkStat(pokemon), Stat.DEF, Stat.SPDEF];
    case "hpBulk":
      return [Stat.HP, Stat.DEF, Stat.SPDEF];
    case "defense":
      return [Stat.DEF, Stat.HP, Stat.SPDEF];
    case "specialDefense":
      return [Stat.SPDEF, Stat.HP, Stat.DEF];
    case "speed":
      return [Stat.SPD, getBetterOffensiveStat(pokemon), Stat.HP];
    case "ace":
    case "balanced":
      return [getBetterOffensiveStat(pokemon), Stat.SPD, Stat.HP, getWeakerBulkStat(pokemon)];
  }
}

function scoreBaseStatBoosterTarget(
  vitaminStat: PermanentStat,
  pokemon: PlayerPokemon,
  targetPokemonIndex: number,
  profile?: ComputerPartnerProfile,
): number {
  if (!profile) {
    return 0 - targetPokemonIndex;
  }

  const role = profile.roles[targetPokemonIndex] ?? "balanced";
  const preferredStats = getComputerPartnerRolePreferredStats(role, pokemon);
  const preferenceIndex = preferredStats.indexOf(vitaminStat);
  const roleScore = preferenceIndex === -1 ? 15 : 300 - preferenceIndex * 50;
  return roleScore - targetPokemonIndex;
}

function chooseBaseStatBoosterTarget(
  type: BaseStatBoosterModifierType,
  party: PlayerPokemon[],
  profile?: ComputerPartnerProfile,
): RewardTarget | undefined {
  const vitaminStat = type.getPregenArgs()[0] as PermanentStat | undefined;
  if (vitaminStat === undefined) {
    const targetPokemonIndex = chooseGenericPokemonTarget(type, party);
    return targetPokemonIndex !== undefined ? { targetPokemonIndex } : undefined;
  }

  const bestTarget = getTargetablePartyIndexes(type, party)
    .map(targetPokemonIndex => ({
      targetPokemonIndex,
      targetScore: scoreBaseStatBoosterTarget(vitaminStat, party[targetPokemonIndex], targetPokemonIndex, profile),
    }))
    .sort((a, b) => b.targetScore - a.targetScore)[0];

  return bestTarget;
}

function chooseTmTarget(
  type: TmModifierType,
  party: PlayerPokemon[],
  profile?: ComputerPartnerProfile,
): RewardTarget | undefined {
  const move = allMoves[type.moveId];
  let bestTarget:
    | { targetPokemonIndex: number; improvementRatio: number; replaceIndex: number; targetScore: number }
    | undefined;

  for (const [targetPokemonIndex, pokemon] of party.entries()) {
    if (type.selectFilter && type.selectFilter(pokemon) !== null) {
      continue;
    }

    const role = profile
      ? isComputerPartnerAcePokemon(pokemon, profile)
        ? "ace"
        : profile.roles[targetPokemonIndex] ?? "balanced"
      : undefined;
    const moveLearningContext = profile ? { profile, role: role ?? "balanced" } : {};
    const decision = chooseComputerPartnerMoveLearningDecision(
      pokemon,
      pokemon.getMoveset().map(pokemonMove => pokemonMove.moveId),
      move,
      LearnMoveType.TM,
      moveLearningContext,
    );

    if (!decision.shouldLearn) {
      continue;
    }

    if (
      !bestTarget
      || decision.improvementRatio > bestTarget.improvementRatio
      || (
        decision.improvementRatio === bestTarget.improvementRatio
        && getDawnTmPreferenceScore(profile, role, move) > bestTarget.targetScore
      )
      || (decision.improvementRatio === bestTarget.improvementRatio && decision.replaceIndex < bestTarget.replaceIndex)
    ) {
      bestTarget = {
        targetPokemonIndex,
        improvementRatio: decision.improvementRatio,
        replaceIndex: decision.replaceIndex,
        targetScore: getTmTargetScore(decision.improvementRatio) + getDawnTmPreferenceScore(profile, role, move),
      };
    }
  }

  return bestTarget
    ? { targetPokemonIndex: bestTarget.targetPokemonIndex, targetScore: bestTarget.targetScore }
    : undefined;
}

function getTmTargetScore(improvementRatio: number): number {
  if (!Number.isFinite(improvementRatio)) {
    return 80;
  }

  return Math.max(0, Math.min(80, (improvementRatio - 1) * 180));
}

function getDawnTmPreferenceScore(
  profile: ComputerPartnerProfile | undefined,
  role: ComputerPartnerRole | undefined,
  move: typeof allMoves[number],
): number {
  if (profile?.key !== "dawn_zorua") {
    return 0;
  }

  const capabilities = getDawnStrategyMoveCapabilities(move);
  let score = 0;

  if (capabilities.entryHazard) {
    score += role === "speed" ? 180 : 95;
  }
  if (capabilities.offensiveSetup && (role === "ace" || role === "physical" || role === "special")) {
    score += 115;
  }
  if (
    capabilities.defensiveSetup
    && (role === "bulk" || role === "hpBulk" || role === "defense" || role === "specialDefense")
  ) {
    score += 110;
  }

  return score;
}

function hasUsefulOrbTarget(itemId: string, type: PokemonModifierType, party: PlayerPokemon[]): boolean {
  if (itemId === "FLAME_ORB" || itemId === "TOXIC_ORB") {
    return !!chooseOrbTarget(type, itemId, party);
  }

  return true;
}

function getRewardTarget(
  type: ModifierType,
  itemId: string,
  party: PlayerPokemon[],
  context: ComputerPartnerRewardContext,
): RewardTarget | undefined {
  if (!(type instanceof PokemonModifierType)) {
    return {};
  }

  if (!hasUsefulOrbTarget(itemId, type, party)) {
    return undefined;
  }

  if (itemId === "SHINY_BADGE") {
    const aceTargetPokemonIndex = chooseComputerPartnerAceTarget(type, party, context.computerPartnerProfile);
    if (aceTargetPokemonIndex !== undefined) {
      return { targetPokemonIndex: aceTargetPokemonIndex };
    }
  }

  if (type instanceof BerryModifierType) {
    return getBerryTarget(type, party, context.computerPartnerProfile);
  }

  if (itemId === "MIRROR_HERB") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile);
  }

  if (type instanceof SpeciesStatBoosterModifierType) {
    return getSpeciesStatBoosterTarget(type, party);
  }

  if (itemId === "SOOTHE_BELL") {
    return (
      chooseScoredPokemonTarget(type, party, pokemon => hasFriendshipEvolution(pokemon) ? 300 : undefined)
      ?? chooseAcePreferredTarget(type, party, context.computerPartnerProfile)
    );
  }

  if (itemId === "REVIVER_SEED") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseStrongestTarget(type, party, context.computerPartnerProfile, true));
  }

  if (itemId === "EVIOLITE") {
    return chooseScoredPokemonTarget(type, party, getBulkScore, canBenefitFromEviolite);
  }

  if (itemId === "LEEK") {
    return chooseScoredPokemonTarget(type, party, getAttackingStatScore, pokemon => hasSpeciesInList(pokemon, LEEK_SPECIES));
  }

  if (itemId === "UNOWN_BOX") {
    return chooseScoredPokemonTarget(type, party, (_pokemon, targetPokemonIndex) => 300 - targetPokemonIndex, pokemon =>
      hasSpeciesInList(pokemon, [SpeciesId.UNOWN]));
  }

  if (itemId === "MYSTICAL_ROCK") {
    return chooseScoredPokemonTarget(type, party, getBulkScore, hasWeatherOrTerrainSource);
  }

  if (itemId === "LIGHT_CLAY") {
    return chooseScoredPokemonTarget(type, party, getBulkScore, pokemon => hasMoveId(pokemon, SCREEN_MOVE_IDS));
  }

  if (itemId === "GOLDEN_PUNCH") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseStrongestTarget(type, party, context.computerPartnerProfile, true));
  }

  if (itemId === "QUICK_CLAW") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(type, party, getSlowestScore));
  }

  if (type instanceof PokemonMoveAccuracyBoosterModifierType || itemId === "WIDE_LENS") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(type, party, getLeastAccurateMoveScore));
  }

  if (itemId === "LEFTOVERS") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseBulkiestTarget(type, party, context.computerPartnerProfile, true));
  }

  if (itemId === "SHELL_BELL") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseStrongestTarget(type, party, context.computerPartnerProfile, true));
  }

  if (type instanceof ContactHeldItemTransferChanceModifierType || itemId === "GRIP_CLAW") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(
        type,
        party,
        (pokemon, targetPokemonIndex) => {
          if (hasMultiHitMove(pokemon)) {
            return 300 - targetPokemonIndex;
          }
          if (hasContactMove(pokemon)) {
            return 100 - targetPokemonIndex;
          }
          return undefined;
        },
      )
      ?? chooseRandomPokemonTarget(type, party));
  }

  if (itemId === "SCOPE_LENS") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(type, party, (pokemon, targetPokemonIndex) =>
        hasHighCritMoveOrAbility(pokemon) ? 250 - targetPokemonIndex : undefined)
      ?? chooseRandomPokemonTarget(type, party));
  }

  if (itemId === "BATON") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(type, party, (pokemon, targetPokemonIndex) =>
        hasMoveId(pokemon, SETUP_MOVE_IDS) ? 250 - targetPokemonIndex : undefined)
      ?? chooseRandomPokemonTarget(type, party));
  }

  if (itemId === "SOUL_DEW") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile);
  }

  if (itemId === "FOCUS_BAND") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(type, party, getLowestHealthScore));
  }

  if (itemId === "KINGS_ROCK") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseScoredPokemonTarget(type, party, getFastestScore));
  }

  if (type instanceof PokemonMultiHitModifierType || itemId === "MULTI_LENS") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseStrongestTarget(type, party, context.computerPartnerProfile, true));
  }

  if (type instanceof TurnHeldItemTransferModifierType || itemId === "MINI_BLACK_HOLE" || itemId === "GAMMA_RAY_BURST") {
    return chooseAcePreferredTarget(type, party, context.computerPartnerProfile, () =>
      chooseBulkiestTarget(type, party, context.computerPartnerProfile, true));
  }

  if (itemId === "EON_FLUTE") {
    return { targetScore: 0 };
  }

  if (itemId === "FLAME_ORB" || itemId === "TOXIC_ORB") {
    return chooseOrbTarget(type, itemId, party);
  }

  if (itemId === "LOADED_DICE") {
    return chooseLoadedDiceTarget(type, party);
  }

  if (type instanceof AttackTypeBoosterModifierType) {
    const targetPokemonIndex = chooseAttackTypeBoosterTarget(type, party);
    return targetPokemonIndex !== undefined ? { targetPokemonIndex } : undefined;
  }

  if (type instanceof TerastallizeModifierType) {
    const targetPokemonIndex = chooseTeraShardTarget(type, party);
    return targetPokemonIndex !== undefined ? { targetPokemonIndex } : undefined;
  }

  if (type instanceof BaseStatBoosterModifierType) {
    return chooseBaseStatBoosterTarget(type, party, context.computerPartnerProfile);
  }

  if (type instanceof TmModifierType) {
    return chooseTmTarget(type, party, context.computerPartnerProfile);
  }

  if (type instanceof PokemonMoveModifierType) {
    const target = chooseMoveModifierTarget(type, party);
    return target ? { targetPokemonIndex: target.pokemonIndex, targetMoveIndex: target.moveIndex } : undefined;
  }

  const targetPokemonIndex = chooseGenericPokemonTarget(type, party);
  return targetPokemonIndex !== undefined ? { targetPokemonIndex } : undefined;
}

function shouldIgnoreReward(itemId: string, context: ComputerPartnerRewardContext): boolean {
  if (IGNORED_REWARD_IDS.has(itemId)) {
    return true;
  }

  const pokeballType = getPokeballTypeForReward(itemId);
  if (pokeballType !== undefined && itemId !== "MASTER_BALL") {
    return (context.pokeballCounts?.[pokeballType] ?? 0) >= 10;
  }

  return false;
}

function getPokemonHpNeed(pokemon: PlayerPokemon): { missingHp: number; missingRatio: number; hpRatio: number } {
  const maxHp = pokemon.getMaxHp();
  const missingHp = Math.max(maxHp - pokemon.hp, 0);
  return {
    missingHp,
    missingRatio: maxHp ? missingHp / maxHp : 0,
    hpRatio: maxHp ? pokemon.hp / maxHp : 0,
  };
}

function getHealAmount(profile: RecoveryItemProfile, pokemon: PlayerPokemon): number {
  return Math.max(
    profile.healPoints ?? 0,
    Math.ceil(((profile.healPercent ?? 0) / 100) * pokemon.getMaxHp()),
    profile.healPercent ? 1 : 0,
  );
}

function getMoveMissingPp(move: PokemonMove): number {
  return move.ppUsed;
}

function getMoveRemainingPp(move: PokemonMove): number {
  return Math.max(move.getMovePp() - move.ppUsed, 0);
}

function isMoveOutOfPp(move: PokemonMove): boolean {
  const maxPp = move.getMovePp();
  return maxPp > 0 && move.ppUsed >= maxPp;
}

function isMoveMeaningfullyLowPp(move: PokemonMove): boolean {
  const maxPp = move.getMovePp();
  return maxPp > 0 && move.ppUsed / maxPp >= MAINTENANCE_PP_MISSING_RATIO && getMoveRemainingPp(move) <= 5;
}

function getMoveEffectiveRestore(profile: RecoveryItemProfile, move: PokemonMove): number {
  const missingPp = getMoveMissingPp(move);
  if ((profile.ppPoints ?? 0) < 0) {
    return missingPp;
  }
  return Math.min(profile.ppPoints ?? 0, missingPp);
}

function getMovePpCapacity(profile: RecoveryItemProfile, move: PokemonMove): number {
  if ((profile.ppPoints ?? 0) < 0) {
    return getMoveMissingPp(move);
  }
  return profile.ppPoints ?? 0;
}

function getCostPenalty(cost: number): number {
  return cost > 0 ? cost / 50 : 0;
}

function hasCurableStatus(pokemon: PlayerPokemon): boolean {
  return !!pokemon.status || !!pokemon.getTag(BattlerTagType.CONFUSED);
}

function hasEmergencyStatus(pokemon: PlayerPokemon): boolean {
  return (
    pokemon.status?.effect === StatusEffect.BURN
    || pokemon.status?.effect === StatusEffect.FREEZE
    || pokemon.status?.effect === StatusEffect.POISON
    || pokemon.status?.effect === StatusEffect.SLEEP
    || pokemon.status?.effect === StatusEffect.TOXIC
  );
}

function getNonFaintedPartyCount(party: PlayerPokemon[]): number {
  return party.filter(pokemon => !pokemon.isFainted()).length;
}

export function getComputerPartnerShopReserve(options: ModifierTypeOption[]): number {
  const recoveryOptions = options
    .map(option => ({ option, profile: getRecoveryItemProfile(option.type) }))
    .filter((entry): entry is { option: ModifierTypeOption; profile: RecoveryItemProfile } => !!entry.profile);
  const reviveCosts = recoveryOptions
    .filter(({ profile }) => profile.kind === "revive" && !profile.partyRevive)
    .map(({ option }) => option.cost)
    .filter(cost => cost > 0);
  const healCosts = recoveryOptions
    .filter(({ profile }) => profile.kind === "heal" && profile.id !== "FULL_RESTORE")
    .map(({ option }) => option.cost)
    .filter(cost => cost > 0);

  const reviveReserve = reviveCosts.length > 0 ? Math.min(...reviveCosts) : 0;
  const healReserve = healCosts.length > 0 ? Math.min(...healCosts) : 0;

  return reviveReserve + healReserve;
}

function scoreHealOption(
  option: ModifierTypeOption,
  optionIndex: number,
  profile: RecoveryItemProfile,
  party: PlayerPokemon[],
): ComputerPartnerRecoveryChoice | undefined {
  let bestChoice: ComputerPartnerRecoveryChoice | undefined;

  party.forEach((pokemon, targetPokemonIndex) => {
    if (pokemon.isFainted()) {
      return;
    }

    const hpNeed = getPokemonHpNeed(pokemon);
    const hasStatus = hasCurableStatus(pokemon);
    if (hpNeed.missingRatio < MIN_HEALING_MISSING_HP_RATIO && !(profile.healStatus && hasStatus)) {
      return;
    }

    const healAmount = getHealAmount(profile, pokemon);
    const usefulHeal = Math.min(healAmount, hpNeed.missingHp);
    const wastedHeal = Math.max(healAmount - hpNeed.missingHp, 0);
    const statusValue = profile.healStatus && hasStatus ? 35 : 0;
    const urgencyMultiplier = hpNeed.hpRatio <= URGENT_HEALING_HP_RATIO ? 1.5 : 1;
    const score = (usefulHeal * urgencyMultiplier + statusValue - wastedHeal * WASTE_PENALTY) - getCostPenalty(option.cost);
    const isEmergency =
      hpNeed.hpRatio <= URGENT_HEALING_HP_RATIO || (!!profile.healStatus && hasEmergencyStatus(pokemon));

    if (score <= 0) {
      return;
    }

    const choice: ComputerPartnerRecoveryChoice = {
      option,
      optionIndex,
      itemId: profile.id,
      kind: profile.kind,
      score,
      targetPokemonIndex,
      reason: hasStatus && profile.healStatus ? "heals HP and status" : "heals meaningful HP loss",
      usefulValue: usefulHeal + statusValue,
      wastedValue: wastedHeal,
      cost: option.cost,
      isEmergency,
    };

    if (!bestChoice || choice.score > bestChoice.score) {
      bestChoice = choice;
    }
  });

  return bestChoice;
}

function scoreReviveOption(
  option: ModifierTypeOption,
  optionIndex: number,
  profile: RecoveryItemProfile,
  party: PlayerPokemon[],
): ComputerPartnerRecoveryChoice | undefined {
  const faintedIndexes = party
    .map((pokemon, targetPokemonIndex) => ({ pokemon, targetPokemonIndex }))
    .filter(({ pokemon }) => pokemon.isFainted());
  if (faintedIndexes.length === 0) {
    return undefined;
  }

  if (profile.partyRevive) {
    const usefulValue = faintedIndexes.reduce((total, { pokemon }) => total + pokemon.getMaxHp(), 0);
    const score = usefulValue - getCostPenalty(option.cost);
    const isEmergency = getNonFaintedPartyCount(party) <= 2 || faintedIndexes.length > 1;
    return score > 0
      ? {
          option,
          optionIndex,
          itemId: profile.id,
          kind: profile.kind,
          score,
          reason: "revives multiple fainted Pokemon",
          usefulValue,
          wastedValue: 0,
          cost: option.cost,
          isEmergency,
        }
      : undefined;
  }

  let bestChoice: ComputerPartnerRecoveryChoice | undefined;
  const isEmergency = getNonFaintedPartyCount(party) <= 2;
  for (const { pokemon, targetPokemonIndex } of faintedIndexes) {
    const restoredHp = Math.ceil(((profile.revivePercent ?? 0) / 100) * pokemon.getMaxHp());
    const score = 80 + restoredHp * 0.25 - getCostPenalty(option.cost);
    if (score <= 0) {
      continue;
    }

    const choice: ComputerPartnerRecoveryChoice = {
      option,
      optionIndex,
      itemId: profile.id,
      kind: profile.kind,
      score,
      targetPokemonIndex,
      reason: "revives a fainted Pokemon",
      usefulValue: restoredHp,
      wastedValue: 0,
      cost: option.cost,
      isEmergency,
    };
    if (!bestChoice || choice.score > bestChoice.score) {
      bestChoice = choice;
    }
  }

  return bestChoice;
}

function scoreStatusOption(
  option: ModifierTypeOption,
  optionIndex: number,
  profile: RecoveryItemProfile,
  party: PlayerPokemon[],
): ComputerPartnerRecoveryChoice | undefined {
  const statusTargets = party
    .map((pokemon, targetPokemonIndex) => ({ pokemon, targetPokemonIndex }))
    .filter(({ pokemon }) => !pokemon.isFainted() && hasCurableStatus(pokemon));
  if (statusTargets.length === 0) {
    return undefined;
  }

  const target = statusTargets[0];
  const score = 45 - getCostPenalty(option.cost);
  const isEmergency = hasEmergencyStatus(target.pokemon);
  return score > 0
    ? {
        option,
        optionIndex,
        itemId: profile.id,
        kind: profile.kind,
        score,
        targetPokemonIndex: target.targetPokemonIndex,
        reason: "cures status without overspending on HP",
        usefulValue: 45,
        wastedValue: 0,
        cost: option.cost,
        isEmergency,
      }
    : undefined;
}

function scorePpOption(
  option: ModifierTypeOption,
  optionIndex: number,
  profile: RecoveryItemProfile,
  party: PlayerPokemon[],
): ComputerPartnerRecoveryChoice | undefined {
  let bestChoice: ComputerPartnerRecoveryChoice | undefined;

  party.forEach((pokemon, targetPokemonIndex) => {
    if (pokemon.isFainted()) {
      return;
    }

    const moves = pokemon.getMoveset();
    if (profile.allMoves) {
      const usefulValue = moves.reduce((total, move) => total + getMoveEffectiveRestore(profile, move), 0);
      const capacity = moves.reduce((total, move) => total + getMovePpCapacity(profile, move), 0);
      const wastedValue = Math.max(capacity - usefulValue, 0);
      const hasOutOfPpMove = moves.some(isMoveOutOfPp);
      const lowMoveCount = moves.filter(isMoveMeaningfullyLowPp).length;
      if (usefulValue < MIN_TOTAL_PP_MISSING && !hasOutOfPpMove) {
        return;
      }

      const score = usefulValue * 4 - wastedValue * WASTE_PENALTY - getCostPenalty(option.cost);
      if (score <= 0) {
        return;
      }

      const choice: ComputerPartnerRecoveryChoice = {
        option,
        optionIndex,
        itemId: profile.id,
        kind: profile.kind,
        score,
        targetPokemonIndex,
        reason: "restores several depleted moves",
        usefulValue,
        wastedValue,
        cost: option.cost,
        isEmergency: hasOutOfPpMove || lowMoveCount > 1,
      };
      if (!bestChoice || choice.score > bestChoice.score) {
        bestChoice = choice;
      }
      return;
    }

    moves.forEach((move, targetMoveIndex) => {
      const usefulValue = getMoveEffectiveRestore(profile, move);
      const wastedValue = Math.max(getMovePpCapacity(profile, move) - usefulValue, 0);
      const isOutOfPp = isMoveOutOfPp(move);
      if (usefulValue < MIN_SINGLE_MOVE_PP_MISSING && !isOutOfPp) {
        return;
      }

      const score = usefulValue * 4 - wastedValue * WASTE_PENALTY - getCostPenalty(option.cost);
      if (score <= 0) {
        return;
      }

      const choice: ComputerPartnerRecoveryChoice = {
        option,
        optionIndex,
        itemId: profile.id,
        kind: profile.kind,
        score,
        targetPokemonIndex,
        targetMoveIndex,
        reason: "restores one depleted move",
        usefulValue,
        wastedValue,
        cost: option.cost,
        isEmergency: isOutOfPp,
      };
      if (!bestChoice || choice.score > bestChoice.score) {
        bestChoice = choice;
      }
    });
  });

  return bestChoice;
}

export function scoreComputerPartnerRecoveryOption(
  option: ModifierTypeOption,
  optionIndex: number,
  party: PlayerPokemon[],
): ComputerPartnerRecoveryChoice | undefined {
  const profile = getRecoveryItemProfile(option.type);
  if (!profile) {
    return undefined;
  }

  switch (profile.kind) {
    case "heal":
      return scoreHealOption(option, optionIndex, profile, party);
    case "revive":
      return scoreReviveOption(option, optionIndex, profile, party);
    case "status":
      return scoreStatusOption(option, optionIndex, profile, party);
    case "pp":
      return scorePpOption(option, optionIndex, profile, party);
  }
}

export function chooseComputerPartnerRecoveryOption(
  options: ModifierTypeOption[],
  party: PlayerPokemon[],
  money = Number.MAX_SAFE_INTEGER,
  reserveCost = getComputerPartnerShopReserve(options),
): ComputerPartnerRecoveryChoice | undefined {
  return options
    .map((option, optionIndex) => scoreComputerPartnerRecoveryOption(option, optionIndex, party))
    .filter((choice): choice is ComputerPartnerRecoveryChoice => {
      if (!choice || choice.cost > money) {
        return false;
      }
      return choice.isEmergency || money - choice.cost >= reserveCost;
    })
    .map(choice => ({
      ...choice,
      reserveCost,
      moneyAfterPurchase: money - choice.cost,
    }))
    .sort((a, b) => Number(b.isEmergency) - Number(a.isEmergency) || b.score - a.score)[0];
}

export function chooseComputerPartnerRewardOption(
  options: ModifierTypeOption[],
  party: PlayerPokemon[],
  context: ComputerPartnerRewardContext = {},
): ComputerPartnerRewardChoice | undefined {
  return options
    .map((option, optionIndex): ComputerPartnerRewardChoice | undefined => {
      const itemId = getRewardItemId(option.type);
      if (!itemId || shouldIgnoreReward(itemId, context)) {
        return undefined;
      }

      const recoveryChoice = scoreComputerPartnerRecoveryOption(option, optionIndex, party);
      const listedPriority = REWARD_PRIORITY[itemId] ?? 999;
      const isEmergencyRecovery = !!recoveryChoice?.isEmergency;
      const effectiveTier = isEmergencyRecovery
        ? getEmergencyRecoveryTier(option.type.tier ?? ModifierTier.COMMON)
        : (option.type.tier ?? ModifierTier.COMMON);
      const priority = isEmergencyRecovery ? 999 : getRewardPriority(itemId, listedPriority, context);

      if (!recoveryChoice && listedPriority === 999) {
        return undefined;
      }

      const rewardTarget = recoveryChoice ? undefined : getRewardTarget(option.type, itemId, party, context);
      const target = recoveryChoice ?? rewardTarget;
      if (!target) {
        return undefined;
      }

      const tierScore = getTierRank(effectiveTier) * 10000;
      const priorityScore = (1000 - priority) * 10;
      const recoveryScore = recoveryChoice ? Math.min(recoveryChoice.score, 500) : 0;
      const targetScore = rewardTarget?.targetScore ?? 0;

      return {
        option,
        optionIndex,
        itemId,
        score: tierScore + priorityScore + recoveryScore + targetScore,
        effectiveTier,
        priority,
        reason: recoveryChoice
          ? `recovery reward: ${recoveryChoice.reason}`
          : `priority ${priority} ${ModifierTier[effectiveTier]} reward`,
        ...(target.targetPokemonIndex !== undefined ? { targetPokemonIndex: target.targetPokemonIndex } : {}),
        ...(target.targetMoveIndex !== undefined ? { targetMoveIndex: target.targetMoveIndex } : {}),
        ...(recoveryChoice ? { recoveryChoice } : {}),
      };
    })
    .filter((choice): choice is ComputerPartnerRewardChoice => !!choice)
    .sort((a, b) => b.score - a.score)[0];
}
