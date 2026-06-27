import { BattlerTagType } from "#enums/battler-tag-type";
import { AbilityId } from "#enums/ability-id";
import { allMoves } from "#data/data-lists";
import { LearnMoveType } from "#enums/learn-move-type";
import { ModifierTier } from "#enums/modifier-tier";
import { PokeballType } from "#enums/pokeball";
import { Stat, type PermanentStat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { PlayerPokemon } from "#field/pokemon";
import {
  AttackTypeBoosterModifierType,
  BaseStatBoosterModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpUpModifierType,
  TerastallizeModifierType,
  TmModifierType,
  type ModifierType,
  type ModifierTypeOption,
} from "#modifiers/modifier-type";
import type { PokemonMove } from "#moves/pokemon-move";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import {
  isComputerPartnerAcePokemon,
  type ComputerPartnerProfile,
  type ComputerPartnerRole,
} from "#utils/computer-partner-profile";

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
  SHINY_CHARM: 2,
  MULTI_LENS: 3,
  HEALING_CHARM: 4,
  SHINY_BADGE: 5,
  MASTER_BALL: 6,
  LINKING_CORD_GOLD: 7,

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

  POKEBALL: 1,
  TM_COMMON: 2,
  RARE_CANDY: 3,
  TEMP_STAT_STAGE_BOOSTER: 4,
  POTION: 5,
  SUPER_POTION: 5,
  ETHER: 5,
  MAX_ETHER: 5,
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
  "SOOTHE_BELL",
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

function chooseTeraShardTarget(type: TerastallizeModifierType, party: PlayerPokemon[]): number | undefined {
  const teraType = type.getPregenArgs()[0];
  return getTargetablePartyIndexes(type, party, pokemon =>
    pokemon.isOfType(teraType, { includeTeraType: false, returnOriginalTypesIfStellar: true }),
  )[0];
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
): { targetPokemonIndex: number } | undefined {
  const move = allMoves[type.moveId];
  let bestTarget: { targetPokemonIndex: number; improvementRatio: number; replaceIndex: number } | undefined;

  for (const [targetPokemonIndex, pokemon] of party.entries()) {
    if (type.selectFilter && type.selectFilter(pokemon) !== null) {
      continue;
    }

    const decision = chooseComputerPartnerMoveLearningDecision(
      pokemon,
      pokemon.getMoveset().map(pokemonMove => pokemonMove.moveId),
      move,
      LearnMoveType.TM,
      {
        profile,
        role: profile
          ? isComputerPartnerAcePokemon(pokemon, profile)
            ? "ace"
            : profile.roles[targetPokemonIndex] ?? "balanced"
          : undefined,
      },
    );

    if (!decision.shouldLearn) {
      continue;
    }

    if (
      !bestTarget
      || decision.improvementRatio > bestTarget.improvementRatio
      || (decision.improvementRatio === bestTarget.improvementRatio && decision.replaceIndex < bestTarget.replaceIndex)
    ) {
      bestTarget = {
        targetPokemonIndex,
        improvementRatio: decision.improvementRatio,
        replaceIndex: decision.replaceIndex,
      };
    }
  }

  return bestTarget ? { targetPokemonIndex: bestTarget.targetPokemonIndex } : undefined;
}

function hasUsefulOrbTarget(itemId: string, type: PokemonModifierType, party: PlayerPokemon[]): boolean {
  if (itemId === "FLAME_ORB") {
    return getTargetablePartyIndexes(type, party, pokemon => pokemon.hasAbility(AbilityId.GUTS, false, true)).length > 0;
  }
  if (itemId === "TOXIC_ORB") {
    return getTargetablePartyIndexes(type, party, pokemon => pokemon.hasAbility(AbilityId.POISON_HEAL, false, true))
      .length > 0;
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
