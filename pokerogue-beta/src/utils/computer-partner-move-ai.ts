import { allMoves } from "#data/data-lists";
import { getTypeDamageMultiplier } from "#data/type";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { getHealingSupportMoveCapabilities } from "#utils/computer-partner-healing-support";
import type { ComputerPartnerProfile, ComputerPartnerRole } from "#utils/computer-partner-profile";

export interface ComputerPartnerMoveLearningDecision {
  shouldLearn: boolean;
  replaceIndex: number;
  improvementRatio: number;
}

export interface ComputerPartnerMoveLearningContext {
  profile?: ComputerPartnerProfile;
  role?: ComputerPartnerRole;
}

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

const LEVEL_UP_IMPROVEMENT_THRESHOLD = 1.05;
const TM_IMPROVEMENT_THRESHOLD = 1.15;
const MEMORY_IMPROVEMENT_THRESHOLD = 1.08;

export function chooseComputerPartnerMoveLearningDecision(
  pokemon: Pokemon,
  currentMoveIds: MoveId[],
  newMove: Move,
  learnMoveType: LearnMoveType,
  context: ComputerPartnerMoveLearningContext = {},
): ComputerPartnerMoveLearningDecision {
  if (currentMoveIds.length < 4) {
    return { shouldLearn: true, replaceIndex: currentMoveIds.length, improvementRatio: Number.POSITIVE_INFINITY };
  }

  const oldScore = scoreMoveset(pokemon, currentMoveIds, context);
  const minimumImprovementRatio = getImprovementThreshold(learnMoveType);
  let bestReplaceIndex = -1;
  let bestScore = oldScore;

  for (const [index] of currentMoveIds.entries()) {
    const candidateMoveIds = currentMoveIds.slice();
    candidateMoveIds[index] = newMove.id;
    const candidateScore = scoreMoveset(pokemon, candidateMoveIds, context);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestReplaceIndex = index;
    }
  }

  const improvementRatio = oldScore <= 0 ? Number.POSITIVE_INFINITY : bestScore / oldScore;
  const shouldLearn =
    bestReplaceIndex >= 0
    && (improvementRatio >= minimumImprovementRatio || bestScore - oldScore >= getFlatImprovementFloor(learnMoveType));

  return {
    shouldLearn,
    replaceIndex: shouldLearn ? bestReplaceIndex : -1,
    improvementRatio,
  };
}

function getImprovementThreshold(learnMoveType: LearnMoveType): number {
  switch (learnMoveType) {
    case LearnMoveType.TM:
      return TM_IMPROVEMENT_THRESHOLD;
    case LearnMoveType.MEMORY:
      return MEMORY_IMPROVEMENT_THRESHOLD;
    case LearnMoveType.LEARN_MOVE:
    default:
      return LEVEL_UP_IMPROVEMENT_THRESHOLD;
  }
}

function getFlatImprovementFloor(learnMoveType: LearnMoveType): number {
  switch (learnMoveType) {
    case LearnMoveType.TM:
      return 18;
    case LearnMoveType.MEMORY:
      return 12;
    case LearnMoveType.LEARN_MOVE:
    default:
      return 8;
  }
}

function scoreMoveset(
  pokemon: Pokemon,
  moveIds: MoveId[],
  context: ComputerPartnerMoveLearningContext = {},
): number {
  const moves = moveIds.map(moveId => allMoves[moveId]).filter((move): move is Move => !!move);
  const moveScores = moves.map(move => scoreMove(pokemon, move));
  return (
    moveScores.reduce((total, score) => total + score, 0)
    + scoreOffensiveCoverage(moves)
    + scoreStabOptions(pokemon, moves)
    + scoreCherylHealingSupportMoveset(moves, context)
    - scoreRedundancy(moves, context)
  );
}

function scoreMove(pokemon: Pokemon, move: Move): number {
  const damageScore = scoreDamage(pokemon, move);
  const effectScore = scoreMoveEffects(pokemon, move);
  const utilityScore = scoreUtility(move);
  const drawbackPenalty = scoreDrawbacks(move);
  return Math.max(0, damageScore + effectScore + utilityScore - drawbackPenalty);
}

function scoreDamage(pokemon: Pokemon, move: Move): number {
  if (move.category === MoveCategory.STATUS || move.power <= 0) {
    return 0;
  }

  const stabMultiplier = pokemon.isOfType(move.type, { includeTeraType: false }) ? 1.5 : 1;
  const attackStat = pokemon.getStat(Stat.ATK);
  const specialAttackStat = pokemon.getStat(Stat.SPATK);
  const statFit = move.category === MoveCategory.PHYSICAL
    ? getClampedRatio(attackStat, specialAttackStat)
    : getClampedRatio(specialAttackStat, attackStat);
  const priorityBonus = move.priority > 0 ? 1 + Math.min(move.priority, 2) * 0.08 : 1;
  const lowPpPenalty = move.pp > 0 && move.pp <= 5 ? 0.92 : 1;

  return move.calculateEffectivePower(pokemon) * stabMultiplier * statFit * priorityBonus * lowPpPenalty;
}

function getClampedRatio(primaryStat: number, secondaryStat: number): number {
  const ratio = primaryStat / Math.max(secondaryStat, 1);
  return Math.max(0.75, Math.min(1.25, ratio));
}

function scoreMoveEffects(pokemon: Pokemon, move: Move): number {
  let score = 0;

  for (const attr of move.getAttrs("StatusEffectAttr")) {
    score += scoreStatusEffect(attr.effect) * getEffectChanceScale(move, attr.effectChanceOverride);
  }
  for (const attr of move.getAttrs("MultiStatusEffectAttr")) {
    const bestStatusScore = Math.max(...attr.effects.map(effect => scoreStatusEffect(effect)));
    score += bestStatusScore * getEffectChanceScale(move, attr.effectChanceOverride);
  }
  for (const attr of move.getAttrs("StatStageChangeAttr")) {
    score += scoreStatStageChange(pokemon, attr.stats, attr.stages, attr.selfTarget)
      * getEffectChanceScale(move, attr.effectChanceOverride);
  }

  if (move.hasAttr("HealAttr") || move.hasAttr("WeatherHealAttr") || move.hasAttr("PlantHealAttr")) {
    score += 24;
  }
  if (move.hasAttr("HitHealAttr")) {
    score += move.category === MoveCategory.STATUS ? 20 : 14;
  }
  if (move.hasAttr("HealStatusEffectAttr")) {
    score += 10;
  }
  if (move.hasAttr("FlinchAttr")) {
    score += pokemon.getStat(Stat.SPD) >= averageCoreStat(pokemon) ? 10 : 5;
  }

  return score;
}

function scoreStatusEffect(effect: StatusEffect): number {
  switch (effect) {
    case StatusEffect.SLEEP:
    case StatusEffect.FREEZE:
      return 34;
    case StatusEffect.BURN:
      return 27;
    case StatusEffect.PARALYSIS:
      return 24;
    case StatusEffect.TOXIC:
      return 22;
    case StatusEffect.POISON:
      return 14;
    default:
      return 0;
  }
}

function scoreStatStageChange(pokemon: Pokemon, stats: readonly Stat[], stages: number, selfTarget: boolean): number {
  const stageValue = Math.abs(stages) * stats.reduce((total, stat) => total + scoreBattleStat(pokemon, stat), 0);

  if (selfTarget) {
    return stages > 0 ? stageValue : -stageValue * 0.85;
  }

  return stages < 0 ? stageValue * 0.75 : -stageValue;
}

function scoreBattleStat(pokemon: Pokemon, stat: Stat): number {
  switch (stat) {
    case Stat.ATK:
      return pokemon.getStat(Stat.ATK) >= pokemon.getStat(Stat.SPATK) ? 18 : 8;
    case Stat.SPATK:
      return pokemon.getStat(Stat.SPATK) >= pokemon.getStat(Stat.ATK) ? 18 : 8;
    case Stat.SPD:
      return 12;
    case Stat.DEF:
    case Stat.SPDEF:
      return 8;
    case Stat.ACC:
      return 6;
    case Stat.EVA:
      return 5;
    default:
      return 0;
  }
}

function getEffectChanceScale(move: Move, chanceOverride?: number): number {
  const chance = chanceOverride ?? (move.chance > 0 ? move.chance : 100);
  return Math.max(0, Math.min(1, chance / 100));
}

function scoreUtility(move: Move): number {
  let score = 0;
  if (move.hasAttr("ProtectAttr")) {
    score += 8;
  }
  if (move.hasAttr("ForceSwitchOutAttr")) {
    score += 8;
  }
  if (move.hasAttr("AddArenaTagAttr") || move.hasAttr("AddArenaTrapTagAttr")) {
    score += 8;
  }
  if (move.hasAttr("OneHitKOAccuracyAttr")) {
    score -= 30;
  }
  return score;
}

function scoreDrawbacks(move: Move): number {
  let penalty = 0;
  if (move.hasAttr("RechargeAttr")) {
    penalty += 30;
  }
  if (move.hasAttr("RecoilAttr")) {
    penalty += 12;
  }
  if (move.hasAttr("HalfSacrificialAttr")) {
    penalty += 35;
  }
  if (move.hasAttr("SacrificialAttr") || move.hasAttr("SacrificialAttrOnHit")) {
    penalty += 80;
  }
  if (move.accuracy > 0 && move.accuracy < 75) {
    penalty += 12;
  }
  return penalty;
}

function scoreOffensiveCoverage(moves: readonly Move[]): number {
  const damagingMoves = moves.filter(move => move.category !== MoveCategory.STATUS && move.power > 0);
  if (!damagingMoves.length) {
    return 0;
  }

  return REGULAR_TYPES.reduce((total, defendingType) => {
    const bestMultiplier = Math.max(...damagingMoves.map(move => getTypeDamageMultiplier(move.type, defendingType)));
    if (bestMultiplier >= 2) {
      return total + 5;
    }
    if (bestMultiplier === 1) {
      return total + 1.5;
    }
    return total;
  }, 0);
}

function scoreStabOptions(pokemon: Pokemon, moves: readonly Move[]): number {
  const damagingTypes = new Set(
    moves
      .filter(move => move.category !== MoveCategory.STATUS && move.power > 0)
      .map(move => move.type),
  );
  return pokemon
    .getTypes({ includeTeraType: false, ignoreThirdType: true })
    .filter(type => type !== PokemonType.UNKNOWN)
    .reduce((score, type) => score + (damagingTypes.has(type) ? 7 : 0), 0);
}

function scoreRedundancy(
  moves: readonly Move[],
  context: ComputerPartnerMoveLearningContext = {},
): number {
  let penalty = 0;
  const damagingMovesByType = new Map<PokemonType, Move[]>();
  let statusMoveCount = 0;

  for (const move of moves) {
    if (move.category === MoveCategory.STATUS) {
      statusMoveCount++;
      continue;
    }
    const sameTypeMoves = damagingMovesByType.get(move.type) ?? [];
    sameTypeMoves.push(move);
    damagingMovesByType.set(move.type, sameTypeMoves);
  }

  for (const sameTypeMoves of damagingMovesByType.values()) {
    if (sameTypeMoves.length <= 2) {
      continue;
    }
    penalty += (sameTypeMoves.length - 2) * 16;
  }

  if (statusMoveCount > 2) {
    penalty += (statusMoveCount - 2) * 10;
  }

  penalty += scoreCherylHealingRedundancy(moves, context);

  const physicalCount = moves.filter(move => move.category === MoveCategory.PHYSICAL).length;
  const specialCount = moves.filter(move => move.category === MoveCategory.SPECIAL).length;
  if (physicalCount > 0 && specialCount > 0) {
    penalty -= 5;
  }

  return penalty;
}

function scoreCherylHealingSupportMoveset(
  moves: readonly Move[],
  context: ComputerPartnerMoveLearningContext,
): number {
  const preferenceScale = getCherylHealingPreferenceScale(context);
  if (!preferenceScale) {
    return 0;
  }

  const capabilities = moves.map(move => getHealingSupportMoveCapabilities(move));
  const hasSelfHeal = capabilities.some(capability => capability.healsSelf);
  const hasPartnerHeal = capabilities.some(capability => capability.healsPartner);
  const hasAllAlliesHeal = capabilities.some(capability => capability.healsAllAllies);

  return (
    (hasSelfHeal ? 32 : 0)
    + (hasPartnerHeal ? 36 : 0)
    + (hasAllAlliesHeal ? 16 : 0)
  ) * preferenceScale;
}

function scoreCherylHealingRedundancy(
  moves: readonly Move[],
  context: ComputerPartnerMoveLearningContext,
): number {
  const preferenceScale = getCherylHealingPreferenceScale(context);
  if (!preferenceScale) {
    return 0;
  }

  const healCounts = moves
    .map(move => getHealingSupportMoveCapabilities(move))
    .reduce(
      (counts, capability) => ({
        self: counts.self + (capability.healsSelf ? 1 : 0),
        partner: counts.partner + (capability.healsPartner ? 1 : 0),
      }),
      { self: 0, partner: 0 },
    );

  return (Math.max(healCounts.self - 1, 0) * 34 + Math.max(healCounts.partner - 1, 0) * 38) * preferenceScale;
}

function getCherylHealingPreferenceScale(context: ComputerPartnerMoveLearningContext): number {
  if (context.profile?.key !== "cheryl") {
    return 0;
  }

  switch (context.role) {
    case "ace":
    case "hpBulk":
      return 1;
    case "bulk":
    case "defense":
    case "specialDefense":
      return 0.55;
    default:
      return 0.3;
  }
}

function averageCoreStat(pokemon: Pokemon): number {
  return (
    pokemon.getStat(Stat.HP)
    + pokemon.getStat(Stat.ATK)
    + pokemon.getStat(Stat.DEF)
    + pokemon.getStat(Stat.SPATK)
    + pokemon.getStat(Stat.SPDEF)
    + pokemon.getStat(Stat.SPD)
  ) / 6;
}
