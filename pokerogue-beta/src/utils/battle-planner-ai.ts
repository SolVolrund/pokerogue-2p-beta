import { globalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { type BattleStat, Stat } from "#enums/stat";
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

interface PlannerOffensivePressure {
  maxDamageRatio: number;
  canKo: boolean;
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
  allyAlreadySwitching = false,
): number | undefined {
  if (partyMemberScores.length === 0 || activePokemon.getOpponents().length === 0) {
    return;
  }

  const enemyParty = globalScene.getEnemyParty();
  const activePartyIndex = enemyParty.indexOf(activePokemon as (typeof enemyParty)[number]);
  if (activePokemon.isPlayer() || activePartyIndex === -1) {
    return;
  }

  const currentScore = getAverageMatchupScore(activePokemon);
  const bestScore = Math.max(...partyMemberScores.map(([, score]) => score));
  const bestAdjustedScore = bestScore * switchMultiplier;
  const hpRatio = activePokemon.getHpRatio();
  const canThreatenKo = activePokemon
    .getOpponents()
    .some(opponent => estimateBestDamage(activePokemon, opponent).damage >= opponent.hp);
  const currentIncomingDamage = estimateIncomingDamage(activePokemon);
  const likelyFaints = currentIncomingDamage >= activePokemon.hp;
  const activePressure = getBestOffensivePressure(activePokemon);
  const canContributeThisTurn = !likelyFaints && (activePressure.maxDamageRatio >= 0.18 || canThreatenKo);

  const multiplierThreshold = isBossTrainer ? 1.6 : 2.1;
  const improvement = bestAdjustedScore - currentScore;
  const severeMismatch = currentScore < 4 && improvement >= 4;
  const strongUpgrade = bestAdjustedScore >= currentScore * multiplierThreshold;
  const preserveLowHpThreat = hpRatio < 0.35 && improvement >= 3 && !canThreatenKo && !canContributeThisTurn;
  const escapeKo = likelyFaints && improvement >= 2 && !canThreatenKo;

  if (!severeMismatch && !strongUpgrade && !preserveLowHpThreat && !escapeKo) {
    return;
  }

  const viableCandidates = partyMemberScores
    .map(([partyIndex, score]) =>
      scoreSwitchCandidate({
        activePokemon,
        candidate: enemyParty[partyIndex],
        partyIndex,
        matchupScore: score,
        bestMatchupScore: bestScore,
        currentIncomingDamage,
        likelyActiveFaints: likelyFaints,
        canActiveContribute: canContributeThisTurn,
        allyAlreadySwitching,
      }),
    )
    .filter((candidate): candidate is PlannerSwitchCandidate => !!candidate && candidate.score > FAIL_SCORE)
    .sort((a, b) => b.score - a.score);

  const bestCandidateScore = viableCandidates[0]?.score;
  if (bestCandidateScore === undefined) {
    return;
  }

  const bestIndexes = viableCandidates
    .filter(candidate => candidate.score >= bestCandidateScore - 0.5)
    .map(candidate => candidate.partyIndex);

  return bestIndexes[globalScene.randBattleSeedInt(bestIndexes.length)];
}

interface PlannerSwitchCandidate {
  partyIndex: number;
  score: number;
}

interface PlannerSwitchCandidateContext {
  activePokemon: Pokemon;
  candidate?: Pokemon;
  partyIndex: number;
  matchupScore: number;
  bestMatchupScore: number;
  currentIncomingDamage: number;
  likelyActiveFaints: boolean;
  canActiveContribute: boolean;
  allyAlreadySwitching: boolean;
}

function scoreSwitchCandidate(context: PlannerSwitchCandidateContext): PlannerSwitchCandidate | undefined {
  const {
    activePokemon,
    candidate,
    partyIndex,
    matchupScore,
    bestMatchupScore,
    currentIncomingDamage,
    likelyActiveFaints,
    canActiveContribute,
    allyAlreadySwitching,
  } = context;

  if (!candidate?.isAllowedInBattle() || candidate.isOnField()) {
    return;
  }

  const switchIn = evaluateSwitchIn(activePokemon, candidate);
  if (!switchIn) {
    return;
  }

  const hpAfterSwitch = candidate.hp - switchIn.incomingDamage;
  const hpAfterSwitchRatio = candidate.getMaxHp() > 0 ? hpAfterSwitch / candidate.getMaxHp() : 0;
  const switchInDamageRatio = candidate.hp > 0 ? switchIn.incomingDamage / candidate.hp : 1;
  const getsKoedOnEntry = hpAfterSwitch <= 0;
  const getsCrippledOnEntry = hpAfterSwitchRatio < 0.28;
  const candidateHasPlan = switchIn.offensivePressure.maxDamageRatio >= 0.22 || switchIn.offensivePressure.canKo;
  const candidateIsBestMatchup = matchupScore === bestMatchupScore;

  if (getsKoedOnEntry) {
    return { partyIndex, score: FAIL_SCORE };
  }

  if (canActiveContribute && getsCrippledOnEntry && !candidateHasPlan) {
    return { partyIndex, score: FAIL_SCORE };
  }

  if (canActiveContribute && switchIn.incomingDamage >= currentIncomingDamage * 0.85 && !candidateHasPlan) {
    return { partyIndex, score: FAIL_SCORE };
  }

  if (allyAlreadySwitching && canActiveContribute && !likelyActiveFaints) {
    return { partyIndex, score: FAIL_SCORE };
  }

  let score = matchupScore * 3;
  score += candidateIsBestMatchup ? 2 : 0;
  score += switchIn.offensivePressure.canKo ? 3 : switchIn.offensivePressure.maxDamageRatio * 4;
  score += likelyActiveFaints && hpAfterSwitchRatio > 0.45 ? 3 : 0;
  score -= switchInDamageRatio * 7;
  score -= getsCrippledOnEntry ? 4 : 0;
  score -= canActiveContribute ? 3 : 0;
  score -= allyAlreadySwitching ? 2 : 0;

  return { partyIndex, score };
}

function evaluateSwitchIn(
  activePokemon: Pokemon,
  candidate: Pokemon,
): { incomingDamage: number; offensivePressure: PlannerOffensivePressure } | undefined {
  return withEnemyPartySlotSimulation(activePokemon, candidate, () => ({
    incomingDamage: estimateIncomingDamage(candidate),
    offensivePressure: getBestOffensivePressure(candidate),
  }));
}

function withEnemyPartySlotSimulation<T>(activePokemon: Pokemon, candidate: Pokemon, callback: () => T): T | undefined {
  const enemyParty = globalScene.getEnemyParty();
  const activePartyIndex = enemyParty.indexOf(activePokemon as (typeof enemyParty)[number]);
  const candidatePartyIndex = enemyParty.indexOf(candidate as (typeof enemyParty)[number]);

  if (activePartyIndex === -1 || candidatePartyIndex === -1 || activePartyIndex === candidatePartyIndex) {
    return;
  }

  enemyParty[activePartyIndex] = candidate as (typeof enemyParty)[number];
  enemyParty[candidatePartyIndex] = activePokemon as (typeof enemyParty)[number];
  try {
    return callback();
  } finally {
    enemyParty[activePartyIndex] = activePokemon as (typeof enemyParty)[number];
    enemyParty[candidatePartyIndex] = candidate as (typeof enemyParty)[number];
  }
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
  const targetThreatScore = targetIsOpponent ? getTargetThreatScore(user, target) : 0;
  let score = getBenefitScore(user, target, move, targetIsOpponent);

  if (move.is("AttackMove")) {
    score += scoreAttackMove(user, target, move, targetIsOpponent);
    if (targetIsOpponent) {
      score += targetThreatScore;
    }
  } else {
    const statusScore = scoreStatusMove(user, target, move, targetIsOpponent, targetThreatScore);
    score += statusScore;

    if (targetIsOpponent && statusScore <= 0) {
      score -= Math.min(90, 35 + targetThreatScore * 0.2);
    }
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

function scoreStatusMove(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  targetIsOpponent: boolean,
  targetThreatScore: number,
): number {
  const incomingDamage = estimateIncomingDamage(user);
  const canSurviveSetup = incomingDamage < user.hp || move.priority > 0;

  return (
    getHealingMoveScore(target, move, targetIsOpponent)
    + getSetupMoveScore(user, move, canSurviveSetup)
    + getSideSupportMoveScore(user, move, incomingDamage)
    + getOpponentStatusMoveScore(user, target, move, targetIsOpponent, incomingDamage, targetThreatScore)
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
  const setupAttrs = move.getAttrs("StatStageChangeAttr").filter(attr => attr.selfTarget && attr.getLevels(user) > 0);
  if (setupAttrs.length === 0) {
    return 0;
  }

  const setupStages = setupAttrs.reduce((total, attr) => total + attr.stats.length * attr.getLevels(user), 0);
  return (canSurviveSetup ? 18 : -18) + Math.min(24, setupStages * 6) - (user.getHpRatio() < 0.25 ? 12 : 0);
}

function getSideSupportMoveScore(user: Pokemon, move: Move, incomingDamage: number): number {
  return move.moveTarget === MoveTarget.USER_SIDE ? (incomingDamage > user.getMaxHp() * 0.25 ? 28 : 10) : 0;
}

function getOpponentStatusMoveScore(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  targetIsOpponent: boolean,
  incomingDamage: number,
  targetThreatScore: number,
): number {
  if (!targetIsOpponent) {
    return 0;
  }

  const statStageScore = getOpponentStatStageMoveScore(user, target, move, incomingDamage);
  const hasImmediateDisruption = move.hasAttr("StatusEffectAttr") || move.hasAttr("ForceSwitchOutAttr");
  const tempoRisk = isHighTempoStatusRisk(user, target, move, incomingDamage);

  let score = statStageScore;

  if (move.hasAttr("StatusEffectAttr")) {
    score += Math.min(60, targetThreatScore * 0.35);
  }

  if (move.hasAttr("ForceSwitchOutAttr")) {
    score += Math.min(50, targetThreatScore * 0.25);
  }

  if (statStageScore > 0) {
    score += Math.min(35, targetThreatScore * 0.12);
  }

  if (tempoRisk && !hasImmediateDisruption && statStageScore <= 0) {
    score -= Math.min(120, 45 + targetThreatScore * 0.25);
  }

  return score;
}

function getOpponentStatStageMoveScore(user: Pokemon, target: Pokemon, move: Move, incomingDamage: number): number {
  const attrs = move.getAttrs("StatStageChangeAttr").filter(attr => !attr.selfTarget && attr.getLevels(user) < 0);
  if (attrs.length === 0) {
    return 0;
  }

  const tempoRisk = isHighTempoStatusRisk(user, target, move, incomingDamage);
  const canApplyBeforeTarget =
    move.priority > 0
    || user.getEffectiveStat(Stat.SPD, { opponent: target }) > target.getEffectiveStat(Stat.SPD, { opponent: user });

  return attrs.reduce((total, attr) => {
    const stages = Math.abs(attr.getLevels(user));
    return (
      total
      + attr.stats.reduce(
        (statTotal, stat) =>
          statTotal + scoreOpponentStatDrop(user, target, stat, stages, tempoRisk, canApplyBeforeTarget),
        0,
      )
    );
  }, 0);
}

function scoreOpponentStatDrop(
  user: Pokemon,
  target: Pokemon,
  stat: BattleStat,
  stages: number,
  tempoRisk: boolean,
  canApplyBeforeTarget: boolean,
): number {
  switch (stat) {
    case Stat.ATK:
      return scoreOffensiveStatDrop(target, MoveCategory.PHYSICAL, stages, tempoRisk, canApplyBeforeTarget);
    case Stat.SPATK:
      return scoreOffensiveStatDrop(target, MoveCategory.SPECIAL, stages, tempoRisk, canApplyBeforeTarget);
    case Stat.DEF:
      return scoreDefensiveStatDrop(user, target, MoveCategory.PHYSICAL, stages, tempoRisk);
    case Stat.SPDEF:
      return scoreDefensiveStatDrop(user, target, MoveCategory.SPECIAL, stages, tempoRisk);
    case Stat.SPD:
      return (tempoRisk ? 4 : 18) * stages;
    case Stat.ACC:
    case Stat.EVA:
      return (canApplyBeforeTarget ? 18 : 6) * stages;
    default:
      return 0;
  }
}

function scoreOffensiveStatDrop(
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  stages: number,
  tempoRisk: boolean,
  canApplyBeforeTarget: boolean,
): number {
  const relevant = targetReliesOnAttackCategory(target, category);
  if (!relevant) {
    return -70 * stages;
  }

  return (canApplyBeforeTarget ? 24 : 10) * stages - (tempoRisk && !canApplyBeforeTarget ? 22 * stages : 0);
}

function scoreDefensiveStatDrop(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  stages: number,
  tempoRisk: boolean,
): number {
  const canExploit = enemySideCanExploitDefenseDrop(user, target, category);
  if (!canExploit) {
    return -28 * stages;
  }

  return 12 * stages - (tempoRisk ? 34 * stages : 0);
}

function isHighTempoStatusRisk(user: Pokemon, target: Pokemon, move: Move, incomingDamage: number): boolean {
  const slowerOrTied =
    move.priority <= 0
    && target.getEffectiveStat(Stat.SPD, { opponent: user }) >= user.getEffectiveStat(Stat.SPD, { opponent: target });
  return slowerOrTied && incomingDamage >= user.hp * 0.55;
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

function estimateBestDamageByCategory(
  attacker: Pokemon,
  defender: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): number {
  return attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category === category)
    .filter(move => !!move && canMoveReachTarget(attacker, defender, move.id))
    .map(move => estimateDamage(attacker, defender, move).damage)
    .reduce((best, damage) => Math.max(best, damage), 0);
}

function estimateIncomingDamage(user: Pokemon): number {
  return user
    .getOpponents()
    .reduce((highestDamage, opponent) => Math.max(highestDamage, estimateBestDamage(opponent, user).damage), 0);
}

function getBestOffensivePressure(user: Pokemon): PlannerOffensivePressure {
  return user.getOpponents().reduce<PlannerOffensivePressure>(
    (best, opponent) => {
      const damage = estimateBestDamage(user, opponent).damage;
      const maxDamageRatio = opponent.hp > 0 ? damage / opponent.hp : 0;
      return {
        maxDamageRatio: Math.max(best.maxDamageRatio, maxDamageRatio),
        canKo: best.canKo || damage >= opponent.hp,
      };
    },
    { maxDamageRatio: 0, canKo: false },
  );
}

function canMoveReachTarget(user: Pokemon, target: Pokemon, moveId: MoveId): boolean {
  const targetSet = getMoveTargets(user, moveId);
  return targetSet.targets.includes(target.getBattlerIndex());
}

function targetReliesOnAttackCategory(
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): boolean {
  const oppositeCategory = category === MoveCategory.PHYSICAL ? MoveCategory.SPECIAL : MoveCategory.PHYSICAL;
  const defenders = target.getOpponents();
  const categoryDamage = defenders.reduce(
    (best, defender) => Math.max(best, estimateBestDamageByCategory(target, defender, category)),
    0,
  );
  const oppositeDamage = defenders.reduce(
    (best, defender) => Math.max(best, estimateBestDamageByCategory(target, defender, oppositeCategory)),
    0,
  );

  return categoryDamage > 0 && categoryDamage >= Math.max(1, oppositeDamage * 0.8);
}

function enemySideCanExploitDefenseDrop(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): boolean {
  return globalScene
    .getField(true)
    .filter(pokemon => !user.isOpponent(pokemon) && pokemon.isAllowedInBattle())
    .some(pokemon => estimateBestDamageByCategory(pokemon, target, category) >= target.getMaxHp() * 0.18);
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

  const activeThreatScore = Math.min(70, strongestDamageRatio * 34);
  const partyThreatScore = user.isPlayer() ? 0 : getEnemyPartyThreatScore(user, target);

  return Math.min(300, activeThreatScore + partyThreatScore);
}

function getEnemyPartyThreatScore(user: Pokemon, target: Pokemon): number {
  const enemyParty = globalScene.getEnemyParty().filter(pokemon => pokemon.isAllowedInBattle());
  if (enemyParty.length === 0) {
    return 0;
  }

  const pressureScores = enemyParty
    .map(pokemon => getTargetPressureAgainstEnemyPartyMember(user, target, pokemon))
    .filter((pressure): pressure is PlannerThreatPressure => !!pressure);

  if (pressureScores.length === 0) {
    return 0;
  }

  const vulnerableCount = pressureScores.filter(pressure => pressure.incomingRatio >= 0.35).length;
  const severeCount = pressureScores.filter(pressure => pressure.incomingRatio >= 0.65 || pressure.canBeKoed).length;
  const answerCount = pressureScores.filter(pressure => pressure.answerRatio >= 0.35 || pressure.canAnswerKo).length;
  const averageIncomingRatio =
    pressureScores.reduce((total, pressure) => total + pressure.incomingRatio, 0) / pressureScores.length;

  if (vulnerableCount === 0 && severeCount === 0) {
    return 0;
  }

  const noReliableAnswer = answerCount === 0;
  const spreadPressure = hasSpreadDamagePressure(target, user) ? 24 : 0;
  const wholeTeamPressure = vulnerableCount >= Math.max(2, Math.ceil(enemyParty.length * 0.65)) ? 28 : 0;

  return Math.min(
    220,
    vulnerableCount * 18
      + severeCount * 14
      + averageIncomingRatio * 36
      + (noReliableAnswer ? 34 : 0)
      + spreadPressure
      + wholeTeamPressure
      - answerCount * 10,
  );
}

interface PlannerThreatPressure {
  incomingRatio: number;
  answerRatio: number;
  canBeKoed: boolean;
  canAnswerKo: boolean;
}

function getTargetPressureAgainstEnemyPartyMember(
  activeUser: Pokemon,
  target: Pokemon,
  defender: Pokemon,
): PlannerThreatPressure | undefined {
  const evaluatePressure = () => {
    const incomingDamage = estimateBestDamage(target, defender).damage;
    const answerDamage = estimateBestDamage(defender, target).damage;
    return {
      incomingRatio: defender.getMaxHp() > 0 ? incomingDamage / defender.getMaxHp() : 0,
      answerRatio: target.getMaxHp() > 0 ? answerDamage / target.getMaxHp() : 0,
      canBeKoed: incomingDamage >= defender.hp,
      canAnswerKo: answerDamage >= target.hp,
    };
  };

  if (defender.isOnField()) {
    return evaluatePressure();
  }

  return withEnemyPartySlotSimulation(activeUser, defender, evaluatePressure);
}

function hasSpreadDamagePressure(attacker: Pokemon, defender: Pokemon): boolean {
  return attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .some(move => {
      const moveTargets = getMoveTargets(attacker, move.id);
      return moveTargets.multiple && moveTargets.targets.includes(defender.getBattlerIndex());
    });
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
