import { MoveId } from "#enums/move-id";
import { contestMoves } from "./contest-moves";
import {
  ContestSpectacularEffectBehavior,
  type ContestSpectacularEffectData,
  getContestSpectacularEffect,
} from "./contest-spectacular-effects";
import {
  type ContestSpectacularMoveData,
  getContestSpectacularMove,
} from "./contest-spectacular-moves";
import {
  ContestAppealOrderOverride,
  ContestJamProtection,
  contestScoreToHearts,
  type ContestParticipant,
  type ContestState,
} from "./contest-state";
import { isSecondaryContestType, type ContestType } from "./contest-type";

const FALLBACK_CONTEST_MOVES = [MoveId.TACKLE, MoveId.GROWL, MoveId.TAIL_WHIP, MoveId.QUICK_ATTACK] as const;
const REPEAT_APPEAL_PENALTY = 2;
const COMBO_APPEAL_BONUS = 3;
const HIGH_EXPECTATION_JAM = 5;
const MAX_CONDITION_STARS = 3;
const FINAL_ROUND_ONLY_PENALTY = 1000;
const COMBO_SETUP_LOOKAHEAD_WEIGHT = 0.55;
const ORDER_SETUP_LOOKAHEAD_WEIGHT = 0.4;
const EPSILON = 0.0001;

interface ContestAiMoveScore {
  moveId: MoveId;
  score: number;
}

export function chooseContestAiMove(contestant: ContestParticipant, contestState: ContestState): MoveId {
  const moveIds = getContestAiMoveCandidates(contestant);
  const scoredMoves = moveIds
    .map(moveId => scoreContestAiMove(contestant, contestState, moveId))
    .filter(score => score !== undefined);

  if (scoredMoves.length === 0) {
    return FALLBACK_CONTEST_MOVES[(contestState.round - 1) % FALLBACK_CONTEST_MOVES.length] ?? MoveId.TACKLE;
  }

  return scoredMoves.sort((a, b) => {
    const scoreDifference = b.score - a.score;
    if (Math.abs(scoreDifference) > EPSILON) {
      return scoreDifference;
    }

    return compareContestAiMoveTieBreakers(contestant, contestState, a.moveId, b.moveId);
  })[0].moveId;
}

function getContestAiMoveCandidates(contestant: ContestParticipant): MoveId[] {
  const scriptedMoves = contestant.contestMoves?.filter(
    moveId => moveId !== MoveId.NONE && getContestSpectacularMove(moveId),
  );
  if (scriptedMoves && scriptedMoves.length > 0) {
    return [...new Set(scriptedMoves)];
  }

  const moveset = contestant.pokemon
    ?.getMoveset()
    .map(move => move.moveId)
    .filter(moveId => moveId !== MoveId.NONE && getContestSpectacularMove(moveId));

  if (moveset && moveset.length > 0) {
    return [...new Set(moveset)];
  }

  return [...FALLBACK_CONTEST_MOVES];
}

function scoreContestAiMove(
  contestant: ContestParticipant,
  contestState: ContestState,
  moveId: MoveId,
): ContestAiMoveScore | undefined {
  const moveData = getContestSpectacularMove(moveId);
  if (!moveData) {
    return undefined;
  }

  const effect = getContestSpectacularEffect(moveData.effectId);
  const previousContestants = contestState.getPreviousAppealContestants(contestant.id);
  const remainingContestants = contestState.getRemainingContestants(contestant.id);
  const lastContestant = previousContestants.at(-1);
  const isFinalRound = contestState.round >= contestState.totalRounds;
  const repeatPenalty = getRepeatPenalty(contestant, moveId, effect.behavior);
  const comboBonus = getComboBonus(contestant, moveId);
  const applauseScore = getApplauseScore(contestState, contestant, moveData, effect.behavior, remainingContestants);

  let score = getExpectedAppeal({
    contestState,
    contestant,
    effect,
    lastContestant,
    moveData,
    previousContestants,
    remainingContestants,
  });

  score += comboBonus;
  score += applauseScore.selfBonus;
  score += applauseScore.denialBonus;
  score -= repeatPenalty * 1.6;
  score += scoreJamPressure(contestState, contestant, moveData, effect.behavior, previousContestants);
  score += scoreDisruption(contestState, contestant, effect.behavior, remainingContestants);
  score += scoreFuturePlan(contestant, contestState, moveId, effect.behavior);

  if (effect.behavior === ContestSpectacularEffectBehavior.FINAL_APPEAL && !isFinalRound) {
    score -= FINAL_ROUND_ONLY_PENALTY;
  }

  if (contestant.comboStandbyMoveId !== undefined && comboBonus === 0 && !startsContestCombo(moveId)) {
    score -= COMBO_APPEAL_BONUS;
  }

  return { moveId, score };
}

function getExpectedAppeal(args: {
  contestState: ContestState;
  contestant: ContestParticipant;
  effect: ContestSpectacularEffectData;
  lastContestant: ContestParticipant | undefined;
  moveData: ContestSpectacularMoveData;
  previousContestants: ContestParticipant[];
  remainingContestants: ContestParticipant[];
}): number {
  const { contestState, contestant, effect, lastContestant, moveData, previousContestants, remainingContestants } =
    args;

  switch (effect.behavior) {
    case ContestSpectacularEffectBehavior.BEST_FIRST:
      return previousContestants.length === 0 ? 6 : moveData.appeal;
    case ContestSpectacularEffectBehavior.BEST_LAST:
      return remainingContestants.length === 0 ? 6 : moveData.appeal;
    case ContestSpectacularEffectBehavior.COPY_PREVIOUS_APPEALS:
      return Math.max(
        1,
        Math.floor(
          previousContestants.reduce((total, other) => total + contestScoreToHearts(other.roundScore), 0) / 2,
        ) + 1,
      );
    case ContestSpectacularEffectBehavior.COPY_PREVIOUS_APPEAL:
      return Math.max(1, contestScoreToHearts(lastContestant?.roundScore ?? 0) + 1);
    case ContestSpectacularEffectBehavior.BETTER_LATER:
      return [1, 2, 4, 6][previousContestants.length] ?? moveData.appeal;
    case ContestSpectacularEffectBehavior.RANDOM_APPEAL:
      return 3.75;
    case ContestSpectacularEffectBehavior.MATCH_PREVIOUS_TYPE:
      return lastContestant
        && getContestSpectacularMove(lastContestant.lastMoveId ?? MoveId.NONE)?.contestType === moveData.contestType
        ? 6
        : moveData.appeal;
    case ContestSpectacularEffectBehavior.BASED_ON_PREVIOUS_APPEAL:
      if (!lastContestant || contestScoreToHearts(lastContestant.roundScore) < 3) {
        return 6;
      }
      return contestScoreToHearts(lastContestant.roundScore) === 3 ? 3 : 0;
    case ContestSpectacularEffectBehavior.BETTER_IF_PUMPED:
      return getConditionAppeal(contestant.conditionStars);
    case ContestSpectacularEffectBehavior.BETTER_WITH_EXCITEMENT:
      return [1, 1, 3, 4, 6][contestState.applause] ?? moveData.appeal;
    default:
      return moveData.appeal;
  }
}

function getRepeatPenalty(
  contestant: ContestParticipant,
  moveId: MoveId,
  behavior: ContestSpectacularEffectBehavior,
): number {
  if (behavior === ContestSpectacularEffectBehavior.NO_REPEAT_PENALTY) {
    return 0;
  }

  return contestant.lastMoveId === moveId ? REPEAT_APPEAL_PENALTY : 0;
}

function getConditionAppeal(conditionStars: number): number {
  return [1, 3, 5, 7][Math.min(MAX_CONDITION_STARS, Math.max(0, conditionStars))] ?? 1;
}

function getComboBonus(contestant: ContestParticipant, moveId: MoveId): number {
  const standbyMoveId = contestant.comboStandbyMoveId;
  if (!standbyMoveId || contestant.lastMoveId !== standbyMoveId) {
    return 0;
  }

  const currentMoveCombos = contestMoves[moveId]?.normalCombo;
  const previousMoveCombos = contestMoves[standbyMoveId]?.normalCombo;
  const currentMoveFollowsPrevious = currentMoveCombos?.useAfter.includes(standbyMoveId) ?? false;
  const previousMoveLeadsToCurrent = previousMoveCombos?.useBefore.includes(moveId) ?? false;

  return currentMoveFollowsPrevious || previousMoveLeadsToCurrent ? COMBO_APPEAL_BONUS : 0;
}

function startsContestCombo(moveId: MoveId): boolean {
  return (contestMoves[moveId]?.normalCombo?.useBefore.length ?? 0) > 0;
}

function getApplauseScore(
  contestState: ContestState,
  contestant: ContestParticipant,
  moveData: ContestSpectacularMoveData,
  behavior: ContestSpectacularEffectBehavior,
  remainingContestants: ContestParticipant[],
): { selfBonus: number; denialBonus: number } {
  const isFirst = contestState.currentRoundAppeals.length === 0;
  const isLast = remainingContestants.length === 0;
  const isPrimaryType = moveData.contestType === contestState.contestType;
  const isSecondaryType = isSecondaryContestType(contestState.contestType, moveData.contestType);
  const hasExciteOverride =
    behavior === ContestSpectacularEffectBehavior.EXCITE_ANY_CONTEST
    || (behavior === ContestSpectacularEffectBehavior.EXCITE_IF_FIRST && isFirst)
    || (behavior === ContestSpectacularEffectBehavior.EXCITE_IF_LAST && isLast);
  const shouldRaiseApplause = isPrimaryType || hasExciteOverride;
  const shouldLowerApplause = !shouldRaiseApplause && !isSecondaryType;

  if (behavior === ContestSpectacularEffectBehavior.PAUSE_EXCITEMENT) {
    return { selfBonus: 0, denialBonus: scoreApplauseDenial(contestState, contestant, remainingContestants) };
  }

  if (shouldLowerApplause) {
    return {
      selfBonus: 0,
      denialBonus: contestState.applause > 0 ? scoreApplauseDenial(contestState, contestant, remainingContestants) : 0,
    };
  }

  if (!shouldRaiseApplause || contestState.applausePaused) {
    return { selfBonus: 0, denialBonus: 0 };
  }

  const delta =
    (behavior === ContestSpectacularEffectBehavior.EXCITE_IF_FIRST && isFirst)
    || (behavior === ContestSpectacularEffectBehavior.EXCITE_IF_LAST && isLast)
      ? 2
      : 1;

  const selfBonus = contestState.applause + delta >= contestState.maxApplause ? 5 : delta * 0.45;

  return { selfBonus, denialBonus: 0 };
}

function scoreApplauseDenial(
  contestState: ContestState,
  contestant: ContestParticipant,
  remainingContestants: ContestParticipant[],
): number {
  const leadingRemainingContestants = remainingContestants.filter(other => other.totalScore > contestant.totalScore);
  if (leadingRemainingContestants.length === 0) {
    return 0;
  }

  const pressure = leadingRemainingContestants.reduce(
    (total, other) => total + getOpponentPressure(contestState, contestant, other),
    0,
  );
  const nearBonus = contestState.applause >= contestState.maxApplause - 1 ? 3 : 1;

  return nearBonus + pressure * 0.3;
}

function scoreJamPressure(
  contestState: ContestState,
  contestant: ContestParticipant,
  moveData: ContestSpectacularMoveData,
  behavior: ContestSpectacularEffectBehavior,
  previousContestants: ContestParticipant[],
): number {
  const targets = getJamTargets(contestState, contestant, moveData.contestType, behavior, previousContestants);
  if (targets.length === 0 || moveData.jam <= 0) {
    return 0;
  }

  return targets.reduce((total, target) => {
    const jam = getRequestedJamForTarget(target, behavior, moveData.jam);
    const expectedJam = estimateAppliedJam(target, jam);
    return total + expectedJam * getOpponentPressure(contestState, contestant, target);
  }, 0);
}

function getJamTargets(
  contestState: ContestState,
  contestant: ContestParticipant,
  contestType: ContestType,
  behavior: ContestSpectacularEffectBehavior,
  previousContestants: ContestParticipant[],
): ContestParticipant[] {
  const lastContestant = previousContestants.at(-1);

  switch (behavior) {
    case ContestSpectacularEffectBehavior.STARTLE_PREVIOUS:
    case ContestSpectacularEffectBehavior.BADLY_STARTLE_PREVIOUS:
      return lastContestant ? [lastContestant] : [];
    case ContestSpectacularEffectBehavior.STARTLE_PREVIOUS_ALL:
    case ContestSpectacularEffectBehavior.BADLY_STARTLE_PREVIOUS_ALL:
    case ContestSpectacularEffectBehavior.STARTLE_ALL_SKIP_NEXT:
      return previousContestants;
    case ContestSpectacularEffectBehavior.STARTLE_SAME_TYPE:
      return previousContestants.filter(
        other => getContestSpectacularMove(other.lastMoveId ?? MoveId.NONE)?.contestType === contestType,
      );
    case ContestSpectacularEffectBehavior.STARTLE_HIGH_EXPECTATION:
      return previousContestants;
    case ContestSpectacularEffectBehavior.STARTLE_GOOD_APPEALS:
      return previousContestants.filter(other => contestScoreToHearts(other.roundScore) > 0);
    default:
      return contestState.currentRoundAppeals
        .filter(id => id !== contestant.id)
        .map(id => contestState.getContestant(id));
  }
}

function getRequestedJamForTarget(
  target: ContestParticipant,
  behavior: ContestSpectacularEffectBehavior,
  requestedJam: number,
): number {
  if (
    behavior === ContestSpectacularEffectBehavior.STARTLE_HIGH_EXPECTATION
    && target.comboStandbyMoveId !== undefined
  ) {
    return HIGH_EXPECTATION_JAM;
  }

  return requestedJam;
}

function estimateAppliedJam(target: ContestParticipant, jam: number): number {
  if (target.jamProtection === ContestJamProtection.FULL_ROUND) {
    return 0;
  }

  if (target.jamProtection === ContestJamProtection.NEXT_JAM) {
    return 0;
  }

  return target.easilyStartled ? jam * 2 : jam;
}

function scoreDisruption(
  contestState: ContestState,
  contestant: ContestParticipant,
  behavior: ContestSpectacularEffectBehavior,
  remainingContestants: ContestParticipant[],
): number {
  switch (behavior) {
    case ContestSpectacularEffectBehavior.LOWER_EXPECTATIONS:
      return contestState.contestants
        .filter(other => other.id !== contestant.id && other.comboStandbyMoveId !== undefined)
        .reduce(
          (total, other) => total + COMBO_APPEAL_BONUS * getOpponentPressure(contestState, contestant, other),
          0,
        );
    case ContestSpectacularEffectBehavior.MAKE_FOLLOWING_NERVOUS:
      return remainingContestants.reduce(
        (total, other) => total + 1.5 * getOpponentPressure(contestState, contestant, other),
        0,
      );
    case ContestSpectacularEffectBehavior.LOWER_PREVIOUS_ENERGY:
      return contestState.currentRoundAppeals
        .filter(id => id !== contestant.id)
        .map(id => contestState.getContestant(id))
        .reduce(
          (total, other) => total + (other.conditionStars > 0 ? getOpponentPressure(contestState, contestant, other) : 0),
          0,
        );
    case ContestSpectacularEffectBehavior.PREVENT_NEXT_STARTLE:
      return scoreStartleProtection(contestState, contestant, remainingContestants, 1);
    case ContestSpectacularEffectBehavior.PREVENT_STARTLES:
      return scoreStartleProtection(contestState, contestant, remainingContestants, 1.45);
    default:
      return 0;
  }
}

function scoreFuturePlan(
  contestant: ContestParticipant,
  contestState: ContestState,
  moveId: MoveId,
  behavior: ContestSpectacularEffectBehavior,
): number {
  if (contestState.round >= contestState.totalRounds) {
    return 0;
  }

  let score = 0;
  if (startsContestCombo(moveId)) {
    score += getBestComboFollowUpValue(contestant, moveId) * COMBO_SETUP_LOOKAHEAD_WEIGHT;
  }

  if (behavior === ContestSpectacularEffectBehavior.MOVE_EARLIER_NEXT) {
    score += getBestOrderFollowUpValue(contestant, ContestAppealOrderOverride.FIRST) * ORDER_SETUP_LOOKAHEAD_WEIGHT;
  }

  if (behavior === ContestSpectacularEffectBehavior.MOVE_LATER_NEXT) {
    score += getBestOrderFollowUpValue(contestant, ContestAppealOrderOverride.LAST) * ORDER_SETUP_LOOKAHEAD_WEIGHT;
  }

  if (
    behavior === ContestSpectacularEffectBehavior.PUMPED_UP
    && hasBehavior(contestant, ContestSpectacularEffectBehavior.BETTER_IF_PUMPED)
  ) {
    score += 2;
  }

  if (behavior === ContestSpectacularEffectBehavior.PUMPED_UP) {
    score += getConditionStarSetupValue(contestant, contestState);
  }

  return score;
}

function getBestComboFollowUpValue(contestant: ContestParticipant, setupMoveId: MoveId): number {
  const setupMoveCombos = contestMoves[setupMoveId]?.normalCombo;
  if (!setupMoveCombos) {
    return 0;
  }

  return getContestAiMoveCandidates(contestant).reduce((bestValue, followUpMoveId) => {
    const followUpData = getContestSpectacularMove(followUpMoveId);
    if (!followUpData) {
      return bestValue;
    }

    const followUpCombos = contestMoves[followUpMoveId]?.normalCombo;
    const followsSetup = followUpCombos?.useAfter.includes(setupMoveId) ?? false;
    const setupLeadsToFollowUp = setupMoveCombos.useBefore.includes(followUpMoveId);

    return followsSetup || setupLeadsToFollowUp
      ? Math.max(bestValue, followUpData.appeal + COMBO_APPEAL_BONUS)
      : bestValue;
  }, 0);
}

function getBestOrderFollowUpValue(contestant: ContestParticipant, override: ContestAppealOrderOverride): number {
  return getContestAiMoveCandidates(contestant).reduce((bestValue, followUpMoveId) => {
    const followUpData = getContestSpectacularMove(followUpMoveId);
    if (!followUpData) {
      return bestValue;
    }

    const followUpEffect = getContestSpectacularEffect(followUpData.effectId);
    if (
      override === ContestAppealOrderOverride.FIRST
      && followUpEffect.behavior === ContestSpectacularEffectBehavior.BEST_FIRST
    ) {
      return Math.max(bestValue, 6);
    }

    if (
      override === ContestAppealOrderOverride.LAST
      && (followUpEffect.behavior === ContestSpectacularEffectBehavior.BEST_LAST
        || followUpEffect.behavior === ContestSpectacularEffectBehavior.BETTER_LATER)
    ) {
      return Math.max(bestValue, 6);
    }

    return bestValue;
  }, 0);
}

function hasBehavior(contestant: ContestParticipant, behavior: ContestSpectacularEffectBehavior): boolean {
  return getContestAiMoveCandidates(contestant).some(moveId => {
    const moveData = getContestSpectacularMove(moveId);
    return moveData !== undefined && getContestSpectacularEffect(moveData.effectId).behavior === behavior;
  });
}

function scoreStartleProtection(
  contestState: ContestState,
  contestant: ContestParticipant,
  remainingContestants: ContestParticipant[],
  strength: number,
): number {
  if (remainingContestants.length === 0) {
    return 0;
  }

  const comboValue = contestant.comboStandbyMoveId !== undefined ? 1.2 : 0;
  const leaderValue = isContestLeader(contestState, contestant) ? 1.6 : 0;
  const incomingPressure = remainingContestants.reduce(
    (total, other) => total + getOpponentPressure(contestState, contestant, other),
    0,
  );

  return strength * (0.4 + comboValue + leaderValue + incomingPressure * 0.2);
}

function getConditionStarSetupValue(contestant: ContestParticipant, contestState: ContestState): number {
  const currentStars = Math.min(MAX_CONDITION_STARS, contestant.conditionStars);
  const nextStarValue = [2, 1, 0, 0][currentStars] ?? 0;
  if (nextStarValue <= 0) {
    return 0;
  }

  const futureRounds = Math.max(0, contestState.totalRounds - contestState.round);
  const persistenceMultiplier = Math.min(1.5, 0.75 + futureRounds * 0.25);

  return nextStarValue * persistenceMultiplier;
}

function getOpponentPressure(
  contestState: ContestState,
  contestant: ContestParticipant,
  opponent: ContestParticipant,
): number {
  const totalGap = opponent.totalScore - contestant.totalScore;
  const roundGap = contestScoreToHearts(opponent.roundScore - contestant.roundScore);

  if (totalGap > 0) {
    return 1.25 + Math.min(1.25, totalGap / 10) + Math.max(0, roundGap) * 0.08;
  }

  if (isContestLeader(contestState, contestant)) {
    return Math.max(0.45, 1.35 - Math.abs(totalGap) / 10) + Math.max(0, roundGap) * 0.05;
  }

  return 0.35 + Math.max(0, roundGap) * 0.05;
}

function isContestLeader(contestState: ContestState, contestant: ContestParticipant): boolean {
  return contestState.contestants.every(
    other => other.id === contestant.id || contestant.totalScore >= other.totalScore,
  );
}

function compareContestAiMoveTieBreakers(
  contestant: ContestParticipant,
  contestState: ContestState,
  aMoveId: MoveId,
  bMoveId: MoveId,
): number {
  const salt = `${contestState.round}:${contestState.contestType}:${contestState.rank ?? "none"}:${contestant.id}`;
  return hashContestAiTieBreaker(`${salt}:${aMoveId}`) - hashContestAiTieBreaker(`${salt}:${bMoveId}`)
    || aMoveId - bMoveId;
}

function hashContestAiTieBreaker(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}
