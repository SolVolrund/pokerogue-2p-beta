import { globalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import type { PokemonMove } from "#moves/pokemon-move";
import type { TurnMove } from "#types/turn-move";

const FAIL_SCORE = -100_000;
const KO_SCORE = 220;

interface PlannerMoveChoice {
  move: PokemonMove;
  targets: BattlerIndex[];
  score: number;
}

interface PlannerTargetScore {
  battlerIndex: BattlerIndex;
  score: number;
}

export function choosePlannerMove(user: Pokemon, movePool: PokemonMove[]): TurnMove {
  const choices = movePool
    .map(move => scorePlannerMove(user, move))
    .filter((scoredMove): scoredMove is PlannerMoveChoice => !!scoredMove)
    .sort((a, b) => b.score - a.score);

  const chosenMove = chooseFromBestPlannerChoices(choices);
  if (!chosenMove) {
    return {
      move: MoveId.STRUGGLE,
      targets: getPlannerMoveTargets(user, MoveId.STRUGGLE),
      useMode: MoveUseMode.IGNORE_PP,
    };
  }

  return {
    move: chosenMove.move.moveId,
    targets: chosenMove.targets,
    useMode: MoveUseMode.NORMAL,
  };
}

export function getPlannerSwitchIndex(
  activePokemon: Pokemon,
  partyMemberScores: [number, number][],
  switchMultiplier: number,
  isBossTrainer = false,
): number | undefined {
  if (partyMemberScores.length === 0 || activePokemon.getOpponents().length === 0) {
    return;
  }

  const currentScore = getAverageMatchupScore(activePokemon);
  const bestScore = Math.max(...partyMemberScores.map(([, score]) => score));
  const bestAdjustedScore = bestScore * switchMultiplier;
  const hpRatio = activePokemon.getHpRatio();
  const canThreatenKo = activePokemon
    .getOpponents()
    .some(opponent => estimateBestDamage(activePokemon, opponent).damage >= opponent.hp);
  const likelyFaints = estimateIncomingDamage(activePokemon) >= activePokemon.hp;

  const multiplierThreshold = isBossTrainer ? 1.6 : 2.1;
  const improvement = bestAdjustedScore - currentScore;
  const severeMismatch = currentScore < 4 && improvement >= 4;
  const strongUpgrade = bestAdjustedScore >= currentScore * multiplierThreshold;
  const preserveLowHpThreat = hpRatio < 0.35 && improvement >= 3 && !canThreatenKo;
  const escapeKo = likelyFaints && improvement >= 2 && !canThreatenKo;

  if (!severeMismatch && !strongUpgrade && !preserveLowHpThreat && !escapeKo) {
    return;
  }

  const bestIndexes = partyMemberScores.filter(([, score]) => score === bestScore).map(([partyIndex]) => partyIndex);

  return bestIndexes[globalScene.randBattleSeedInt(bestIndexes.length)];
}

function scorePlannerMove(user: Pokemon, pokemonMove: PokemonMove): PlannerMoveChoice | undefined {
  const move = pokemonMove.getMove();
  if (!move) {
    return;
  }

  const targetSet = getMoveTargets(user, move.id);
  const targets = globalScene.getField(true).filter(pokemon => targetSet.targets.includes(pokemon.getBattlerIndex()));

  if (targetSet.multiple) {
    const targetIndexes = targets.map(fieldTarget => fieldTarget.getBattlerIndex());
    return {
      move: pokemonMove,
      targets: targetIndexes,
      score: targets.reduce((total, fieldTarget) => total + scoreMoveAgainstTarget(user, fieldTarget, move), 0),
    };
  }

  if (targets.length === 0) {
    if (move.hasAttr("CounterDamageAttr")) {
      return {
        move: pokemonMove,
        targets: [BattlerIndex.ATTACKER],
        score: 30,
      };
    }

    return;
  }

  const targetScores = targets
    .map(fieldTarget => ({
      battlerIndex: fieldTarget.getBattlerIndex(),
      score: scoreMoveAgainstTarget(user, fieldTarget, move),
    }))
    .sort((a, b) => b.score - a.score);

  const chosenTarget = chooseFromBestTargets(targetScores);
  if (!chosenTarget) {
    return;
  }

  return {
    move: pokemonMove,
    targets: [chosenTarget.battlerIndex],
    score: chosenTarget.score,
  };
}

function scoreMoveAgainstTarget(user: Pokemon, target: Pokemon, move: Move): number {
  if (!doesMoveWork(user, target, move)) {
    return FAIL_SCORE;
  }

  const targetIsOpponent = user.isOpponent(target);
  let score = getBenefitScore(user, target, move, targetIsOpponent);

  if (move.is("AttackMove")) {
    score += scoreAttackMove(user, target, move, targetIsOpponent);
  } else {
    score += scoreStatusMove(user, target, move, targetIsOpponent);
  }

  if (targetIsOpponent) {
    score += getTargetThreatScore(user, target);
  }

  return Number.isNaN(score) ? 0 : score;
}

function doesMoveWork(user: Pokemon, target: Pokemon, move: Move): boolean {
  if (move.name.endsWith(" (N)")) {
    return false;
  }

  if (
    !move.applyConditions(user, target, -1)
    && ![MoveId.SUCKER_PUNCH, MoveId.UPPER_HAND, MoveId.THUNDERCLAP].includes(move.id)
  ) {
    return false;
  }

  return (
    !globalScene.arena.isMoveWeatherCancelled(user, move)
    && !globalScene.arena.isMoveTerrainCancelled(user, [target.getBattlerIndex()], move)
  );
}

function getBenefitScore(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  return (
    move.getUserBenefitScore(user, target, move)
    + move.getTargetBenefitScore(user, target, move) * (targetIsOpponent ? -1 : 1)
  );
}

function scoreAttackMove(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  const damage = estimateDamage(user, target, move);
  const accuracy = getAccuracyFactor(user, target, move);
  const damageRatio = target.hp > 0 ? damage.damage / target.hp : 0;
  const maxHpRatio = target.getMaxHp() > 0 ? damage.damage / target.getMaxHp() : 0;
  const isKo = damage.damage >= target.hp;

  if (!targetIsOpponent) {
    return getAllyAttackPenalty(damageRatio, maxHpRatio, accuracy);
  }

  return (
    getOpponentAttackDamageScore(user, target, move, damageRatio, maxHpRatio, accuracy, isKo)
    + getAttackMoveRiskAdjustment(user, target, move, isKo)
  );
}

function scoreStatusMove(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  const incomingDamage = estimateIncomingDamage(user);
  const canSurviveSetup = incomingDamage < user.hp || move.priority > 0;

  return (
    getHealingMoveScore(target, move, targetIsOpponent)
    + getSetupMoveScore(user, move, canSurviveSetup)
    + getSideSupportMoveScore(user, move, incomingDamage)
    + getStatusMoveRedundancyPenalty(target, targetIsOpponent)
    + getProtectMoveScore(user, move, incomingDamage)
  );
}

function getAllyAttackPenalty(damageRatio: number, maxHpRatio: number, accuracy: number): number {
  const allyPenalty = Math.max(30, damageRatio * 170 + maxHpRatio * 80);
  return -allyPenalty * accuracy;
}

function getOpponentAttackDamageScore(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  damageRatio: number,
  maxHpRatio: number,
  accuracy: number,
  isKo: boolean,
): number {
  let score = (damageRatio * 90 + maxHpRatio * 40) * accuracy;

  if (isKo) {
    score += KO_SCORE + getTargetThreatScore(user, target);
  } else if (damageRatio >= 0.75) {
    score += 45;
  } else if (damageRatio >= 0.5) {
    score += 24;
  }

  if (user.isOfType(move.type)) {
    score += 12;
  }

  if (move.priority > 0 && isKo) {
    score += 24;
  }

  return score;
}

function getAttackMoveRiskAdjustment(user: Pokemon, target: Pokemon, move: Move, isKo: boolean): number {
  let score = 0;

  if (isSlowerKoRisk(user, target, move, isKo)) {
    score -= estimateBestDamage(target, user).damage >= user.hp ? 32 : 0;
  }

  if (move.hasAttr("RechargeAttr")) {
    score -= 45;
  }

  if (move.hasAttr("SacrificialAttr") || move.moveTarget === MoveTarget.ATTACKER) {
    score -= user.getHpRatio() > 0.5 ? 55 : 20;
  }

  return score;
}

function isSlowerKoRisk(user: Pokemon, target: Pokemon, move: Move, isKo: boolean): boolean {
  return (
    move.priority <= 0
    && isKo
    && target.getEffectiveStat(Stat.SPD, { opponent: user }) > user.getEffectiveStat(Stat.SPD, { opponent: target })
  );
}

function getHealingMoveScore(target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  return !targetIsOpponent && target.getHpRatio() < 0.55 && move.hasAttr("HealAttr")
    ? 40 + (1 - target.getHpRatio()) * 70
    : 0;
}

function getSetupMoveScore(user: Pokemon, move: Move, canSurviveSetup: boolean): number {
  if (!move.hasAttr("StatStageChangeAttr")) {
    return 0;
  }

  return (canSurviveSetup ? 26 : -18) - (user.getHpRatio() < 0.25 ? 12 : 0);
}

function getSideSupportMoveScore(user: Pokemon, move: Move, incomingDamage: number): number {
  return move.moveTarget === MoveTarget.USER_SIDE ? (incomingDamage > user.getMaxHp() * 0.25 ? 28 : 10) : 0;
}

function getStatusMoveRedundancyPenalty(target: Pokemon, targetIsOpponent: boolean): number {
  return targetIsOpponent && target.status ? -16 : 0;
}

function getProtectMoveScore(user: Pokemon, move: Move, incomingDamage: number): number {
  return move.hasAttr("ProtectAttr") ? (incomingDamage >= user.hp ? 70 : 8) : 0;
}

function estimateDamage(user: Pokemon, target: Pokemon, move: Move) {
  return target.getAttackDamage({
    source: user,
    move,
    ignoreAbility: !target.waveData.abilityRevealed,
    ignoreSourceAbility: false,
    ignoreAllyAbility: !target.getAlly()?.waveData.abilityRevealed,
    ignoreSourceAllyAbility: false,
    isCritical: move.hasAttr("CritOnlyAttr") || !!user.getTag(BattlerTagType.ALWAYS_CRIT),
    simulated: true,
  });
}

function estimateBestDamage(attacker: Pokemon, defender: Pokemon): { damage: number } {
  const bestDamage = attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .filter(move => !!move && canMoveReachTarget(attacker, defender, move.id))
    .map(move => estimateDamage(attacker, defender, move).damage)
    .reduce((best, damage) => Math.max(best, damage), 0);

  return { damage: bestDamage };
}

function estimateIncomingDamage(user: Pokemon): number {
  return user
    .getOpponents()
    .reduce((highestDamage, opponent) => Math.max(highestDamage, estimateBestDamage(opponent, user).damage), 0);
}

function canMoveReachTarget(user: Pokemon, target: Pokemon, moveId: MoveId): boolean {
  const targetSet = getMoveTargets(user, moveId);
  return targetSet.targets.includes(target.getBattlerIndex());
}

function getPlannerMoveTargets(user: Pokemon, moveId: MoveId): BattlerIndex[] {
  const moveTargets = getMoveTargets(user, moveId);
  const targets = globalScene.getField(true).filter(p => moveTargets.targets.includes(p.getBattlerIndex()));
  return targets.map(target => target.getBattlerIndex());
}

function getAccuracyFactor(user: Pokemon, target: Pokemon, move: Move): number {
  if (move.accuracy === -1) {
    return 1;
  }

  return Math.max(0.35, Math.min(1, move.calculateBattleAccuracy(user, target, true) / 100));
}

function getTargetThreatScore(user: Pokemon, target: Pokemon): number {
  const friendlyField = globalScene.getField(true).filter(pokemon => !user.isOpponent(pokemon) && !pokemon.isFainted());

  const strongestDamageRatio = friendlyField.reduce((highestRatio, friendlyPokemon) => {
    const damage = estimateBestDamage(target, friendlyPokemon).damage;
    const ratio = friendlyPokemon.hp > 0 ? damage / friendlyPokemon.hp : 0;
    return Math.max(highestRatio, ratio);
  }, 0);

  return Math.min(60, strongestDamageRatio * 28);
}

function getAverageMatchupScore(pokemon: Pokemon): number {
  const opponents = pokemon.getOpponents();
  if (opponents.length === 0) {
    return 0;
  }

  return (
    opponents.map(opponent => pokemon.getMatchupScore(opponent)).reduce((total, score) => total + score, 0)
    / opponents.length
  );
}

function chooseFromBestPlannerChoices(choices: PlannerMoveChoice[]): PlannerMoveChoice | undefined {
  if (choices.length === 0) {
    return;
  }

  const topScore = choices[0].score;
  const closeChoices = choices.filter(choice => choice.score >= topScore - 8);
  return closeChoices[globalScene.randBattleSeedInt(closeChoices.length)];
}

function chooseFromBestTargets(targetScores: PlannerTargetScore[]): PlannerTargetScore | undefined {
  if (targetScores.length === 0) {
    return;
  }

  const topScore = targetScores[0].score;
  const closeTargets = targetScores.filter(target => target.score >= topScore - 6);
  return closeTargets[globalScene.randBattleSeedInt(closeTargets.length)];
}
