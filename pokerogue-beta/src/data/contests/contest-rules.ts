import { MoveId } from "#enums/move-id";
import { randSeedFloat } from "#utils/common";
import { contestMoves } from "./contest-moves";
import {
  ContestSpectacularEffectBehavior,
  type ContestSpectacularEffectData,
  getContestSpectacularEffect,
} from "./contest-spectacular-effects";
import { type ContestSpectacularMoveData, getContestSpectacularMove } from "./contest-spectacular-moves";
import {
  ContestAppealOrderOverride,
  ContestJamProtection,
  type ContestParticipant,
  type ContestParticipantId,
  type ContestState,
} from "./contest-state";
import type { ContestType } from "./contest-type";

const REPEAT_APPEAL_PENALTY = 2;
const COMBO_APPEAL_BONUS = 3;
const MAX_CONDITION_STARS = 3;
const BASE_NERVOUS_CHANCE = 0.6;
const NERVOUS_CHANCE_CONDITION_STAR_REDUCTION = 0.1;
const NERVOUS_CHANCE_COMBO_STANDBY_REDUCTION = 0.1;

export interface ContestMoveResolutionOptions {
  random?: () => number;
}

export interface ContestJamResult {
  contestantId: ContestParticipantId;
  requestedJam: number;
  appliedJam: number;
}

export interface ContestMoveResolution {
  contestantId: ContestParticipantId;
  moveId: MoveId;
  moveData?: ContestSpectacularMoveData;
  effect?: ContestSpectacularEffectData;
  skipped: boolean;
  baseAppeal: number;
  appeal: number;
  repeatPenalty: number;
  comboBonus: number;
  applauseBonus: number;
  applauseDelta: number;
  jamResults: ContestJamResult[];
  messages: string[];
}

export function applyContestMove(
  contestState: ContestState,
  contestantId: ContestParticipantId,
  moveId: MoveId,
  options: ContestMoveResolutionOptions = {},
): ContestMoveResolution {
  const contestant = contestState.getContestant(contestantId);
  const moveData = getContestSpectacularMove(moveId);

  if (!moveData || moveId === MoveId.NONE) {
    return recordSkippedMove(contestState, contestantId, moveId, "No contest data exists for this move.");
  }

  const effect = getContestSpectacularEffect(moveData.effectId);
  if (contestant.cannotAppeal || contestant.nervous) {
    const reason = contestant.cannotAppeal
      ? `${contestant.name} could not appeal this turn.`
      : `${contestant.name} was too nervous to appeal.`;

    return recordSkippedMove(contestState, contestantId, moveId, reason, moveData, effect);
  }

  let appeal = moveData.appeal;
  const previousContestants = contestState.getPreviousAppealContestants(contestantId);
  const lastContestant = previousContestants.at(-1);
  const repeatPenalty = getRepeatPenalty(contestant, moveId, effect.behavior);
  const comboBonus = getComboBonus(contestant, moveId);
  const messages: string[] = [];
  const jamResults: ContestJamResult[] = [];
  const random = options.random ?? randSeedFloat;

  appeal = applyAppealBehavior({
    appeal,
    contestState,
    contestant,
    effect,
    lastContestant,
    moveData,
    previousContestants,
    random,
  });
  appeal = Math.max(0, appeal - repeatPenalty + comboBonus);

  const applauseResult = applyApplause(contestState, contestantId, moveData, effect.behavior);
  appeal += applauseResult.bonus;

  applyStatusBehavior(contestState, contestant, effect.behavior, previousContestants, messages, random);
  applyJamBehavior(contestState, contestantId, moveData, effect.behavior, previousContestants, jamResults);
  updateComboStandby(contestant, moveId);

  if (repeatPenalty > 0) {
    messages.push(`${contestant.name}'s repeated move lost ${repeatPenalty} appeal.`);
  }
  if (comboBonus > 0) {
    messages.push(`${contestant.name}'s move combo earned ${comboBonus} extra appeal.`);
  }
  if (applauseResult.bonus > 0) {
    messages.push(`${contestant.name} got the audience going and earned ${applauseResult.bonus} bonus appeal.`);
  }

  contestState.recordAppeal(contestantId, {
    moveId,
    appeal,
    jam: 0,
  });

  contestant.easilyStartled = effect.behavior === ContestSpectacularEffectBehavior.EASY_STARTLE;
  if (effect.behavior === ContestSpectacularEffectBehavior.BETTER_IF_PUMPED) {
    contestant.pumpedUp = false;
  }

  return {
    contestantId,
    moveId,
    moveData,
    effect,
    skipped: false,
    baseAppeal: moveData.appeal,
    appeal,
    repeatPenalty,
    comboBonus,
    applauseBonus: applauseResult.bonus,
    applauseDelta: applauseResult.delta,
    jamResults,
    messages,
  };
}

function recordSkippedMove(
  contestState: ContestState,
  contestantId: ContestParticipantId,
  moveId: MoveId,
  message: string,
  moveData?: ContestSpectacularMoveData,
  effect?: ContestSpectacularEffectData,
): ContestMoveResolution {
  contestState.recordAppeal(contestantId, {
    moveId,
    appeal: 0,
    jam: 0,
  });

  return {
    contestantId,
    moveId,
    ...(moveData ? { moveData } : {}),
    ...(effect ? { effect } : {}),
    skipped: true,
    baseAppeal: 0,
    appeal: 0,
    repeatPenalty: 0,
    comboBonus: 0,
    applauseBonus: 0,
    applauseDelta: 0,
    jamResults: [],
    messages: [message],
  };
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

function getComboBonus(contestant: ContestParticipant, moveId: MoveId): number {
  const currentMoveCombos = contestMoves[moveId]?.normalCombo;
  const previousMoveId = contestant.lastMoveId;
  if (!previousMoveId) {
    return 0;
  }

  const previousMoveCombos = contestMoves[previousMoveId]?.normalCombo;
  const currentMoveFollowsPrevious = currentMoveCombos?.useAfter.includes(previousMoveId) ?? false;
  const previousMoveLeadsToCurrent = previousMoveCombos?.useBefore.includes(moveId) ?? false;

  return currentMoveFollowsPrevious || previousMoveLeadsToCurrent ? COMBO_APPEAL_BONUS : 0;
}

function updateComboStandby(contestant: ContestParticipant, moveId: MoveId): void {
  if ((contestMoves[moveId]?.normalCombo?.useBefore.length ?? 0) > 0) {
    contestant.comboStandbyMoveId = moveId;
  } else {
    contestant.comboStandbyMoveId = undefined;
  }
}

function applyApplause(
  contestState: ContestState,
  contestantId: ContestParticipantId,
  moveData: ContestSpectacularMoveData,
  behavior: ContestSpectacularEffectBehavior,
): { bonus: number; delta: number } {
  if (behavior === ContestSpectacularEffectBehavior.PAUSE_EXCITEMENT) {
    return { bonus: 0, delta: 0 };
  }

  const isFirst = contestState.currentRoundAppeals.length === 0;
  const isLast = contestState.getRemainingContestants(contestantId).length === 0;
  const shouldRaiseApplause =
    moveData.contestType === contestState.contestType
    || behavior === ContestSpectacularEffectBehavior.EXCITE_ANY_CONTEST
    || (behavior === ContestSpectacularEffectBehavior.EXCITE_IF_FIRST && isFirst)
    || (behavior === ContestSpectacularEffectBehavior.EXCITE_IF_LAST && isLast);
  if (!shouldRaiseApplause) {
    return { bonus: 0, delta: 0 };
  }

  const delta =
    behavior === ContestSpectacularEffectBehavior.EXCITE_IF_FIRST
    || behavior === ContestSpectacularEffectBehavior.EXCITE_IF_LAST
      ? 2
      : 1;

  contestState.applause += delta;
  if (contestState.applause >= contestState.maxApplause) {
    contestState.applause = 0;
    return { bonus: 5, delta };
  }

  return { bonus: 0, delta };
}

function applyAppealBehavior(args: {
  appeal: number;
  contestState: ContestState;
  contestant: ContestParticipant;
  effect: ContestSpectacularEffectData;
  lastContestant: ContestParticipant | undefined;
  moveData: ContestSpectacularMoveData;
  previousContestants: ContestParticipant[];
  random: () => number;
}): number {
  const { contestState, contestant, effect, lastContestant, moveData, previousContestants, random } = args;

  switch (effect.behavior) {
    case ContestSpectacularEffectBehavior.BEST_FIRST:
      return previousContestants.length === 0 ? 6 : args.appeal;
    case ContestSpectacularEffectBehavior.BEST_LAST:
      return contestState.getRemainingContestants(contestant.id).length === 0 ? 6 : args.appeal;
    case ContestSpectacularEffectBehavior.COPY_PREVIOUS_APPEALS:
      return Math.max(1, previousContestants.reduce((total, other) => total + other.roundScore, 0) + 1);
    case ContestSpectacularEffectBehavior.COPY_PREVIOUS_APPEAL:
      return Math.max(1, (lastContestant?.roundScore ?? 0) + 1);
    case ContestSpectacularEffectBehavior.BETTER_LATER:
      return [1, 2, 4, 6][previousContestants.length] ?? args.appeal;
    case ContestSpectacularEffectBehavior.RANDOM_APPEAL:
      return [1, 2, 4, 8][Math.floor(random() * 4)] ?? args.appeal;
    case ContestSpectacularEffectBehavior.MATCH_PREVIOUS_TYPE:
      return lastContestant
        && getContestSpectacularMove(lastContestant.lastMoveId ?? MoveId.NONE)?.contestType === moveData.contestType
        ? 6
        : args.appeal;
    case ContestSpectacularEffectBehavior.BASED_ON_PREVIOUS_APPEAL:
      if (!lastContestant || lastContestant.roundScore < 3) {
        return 6;
      }
      return lastContestant.roundScore === 3 ? 3 : 0;
    case ContestSpectacularEffectBehavior.BETTER_IF_PUMPED:
      return contestant.pumpedUp ? 6 : args.appeal;
    case ContestSpectacularEffectBehavior.BETTER_WITH_EXCITEMENT:
      return [1, 1, 3, 4, 6][contestState.applause] ?? args.appeal;
    default:
      return args.appeal;
  }
}

function applyStatusBehavior(
  contestState: ContestState,
  contestant: ContestParticipant,
  behavior: ContestSpectacularEffectBehavior,
  previousContestants: ContestParticipant[],
  messages: string[],
  random: () => number,
): void {
  switch (behavior) {
    case ContestSpectacularEffectBehavior.FINAL_APPEAL:
      contestant.skipNextRound = true;
      messages.push(`${contestant.name} cannot appeal again after this move.`);
      break;
    case ContestSpectacularEffectBehavior.PREVENT_NEXT_STARTLE:
      contestant.jamProtection = ContestJamProtection.NEXT_JAM;
      break;
    case ContestSpectacularEffectBehavior.PREVENT_STARTLES:
      contestant.jamProtection = ContestJamProtection.FULL_ROUND;
      break;
    case ContestSpectacularEffectBehavior.STARTLE_ALL_SKIP_NEXT:
      contestant.skipNextRound = true;
      break;
    case ContestSpectacularEffectBehavior.MAKE_FOLLOWING_NERVOUS:
      applyFollowingNervousness(contestState, contestant, messages, random);
      break;
    case ContestSpectacularEffectBehavior.LOWER_PREVIOUS_ENERGY:
      for (const other of previousContestants) {
        other.pumpedUp = false;
        other.conditionStars = 0;
      }
      break;
    case ContestSpectacularEffectBehavior.PUMPED_UP:
      contestant.pumpedUp = true;
      contestant.conditionStars = Math.min(MAX_CONDITION_STARS, contestant.conditionStars + 1);
      break;
    case ContestSpectacularEffectBehavior.MOVE_EARLIER_NEXT:
      contestant.appealOrderOverride = ContestAppealOrderOverride.FIRST;
      break;
    case ContestSpectacularEffectBehavior.MOVE_LATER_NEXT:
      contestant.appealOrderOverride = ContestAppealOrderOverride.LAST;
      break;
    case ContestSpectacularEffectBehavior.RANDOMIZE_NEXT_ORDER:
      contestState.randomizeNextTurnOrder = true;
      break;
    default:
      break;
  }
}

function applyFollowingNervousness(
  contestState: ContestState,
  contestant: ContestParticipant,
  messages: string[],
  random: () => number,
): void {
  const targets = contestState.getRemainingContestants(contestant.id);
  const baseChance = getBaseNervousChance(targets.length);

  for (const target of targets) {
    const targetName = getContestantNervousMessageName(target);
    if (target.jamProtection === ContestJamProtection.FULL_ROUND) {
      messages.push(`${targetName} resisted being startled.`);
      continue;
    }

    if (target.jamProtection === ContestJamProtection.NEXT_JAM) {
      target.jamProtection = ContestJamProtection.NONE;
      messages.push(`${targetName} resisted being startled.`);
      continue;
    }

    const nervousChance = getNervousChance(baseChance, target);
    if (nervousChance > 0 && random() < nervousChance) {
      target.nervous = true;
      messages.push(`${targetName} was startled and became nervous.`);
    } else {
      messages.push(`${targetName} resisted being startled.`);
    }
  }
}

function getContestantNervousMessageName(contestant: ContestParticipant): string {
  return contestant.pokemon?.getNameToRender() ?? contestant.pokemonNickname ?? contestant.name;
}

function getBaseNervousChance(remainingContestantCount: number): number {
  return remainingContestantCount > 0 ? BASE_NERVOUS_CHANCE / remainingContestantCount : 0;
}

function getNervousChance(baseChance: number, target: ContestParticipant): number {
  const conditionReduction = target.conditionStars * NERVOUS_CHANCE_CONDITION_STAR_REDUCTION;
  const comboReduction = target.comboStandbyMoveId === undefined ? 0 : NERVOUS_CHANCE_COMBO_STANDBY_REDUCTION;

  return Math.max(0, Math.min(1, baseChance - conditionReduction - comboReduction));
}

function applyJamBehavior(
  contestState: ContestState,
  contestantId: ContestParticipantId,
  moveData: ContestSpectacularMoveData,
  behavior: ContestSpectacularEffectBehavior,
  previousContestants: ContestParticipant[],
  jamResults: ContestJamResult[],
): void {
  const jamTargets = getJamTargets(contestState, contestantId, moveData.contestType, behavior, previousContestants);
  const requestedJam = moveData.jam;
  if (requestedJam <= 0 || jamTargets.length === 0) {
    return;
  }

  for (const target of jamTargets) {
    const appliedJam = contestState.applyJam(target.id, requestedJam);
    jamResults.push({
      contestantId: target.id,
      requestedJam,
      appliedJam,
    });
  }
}

function getJamTargets(
  contestState: ContestState,
  contestantId: ContestParticipantId,
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
        contestant => getContestSpectacularMove(contestant.lastMoveId ?? MoveId.NONE)?.contestType === contestType,
      );
    case ContestSpectacularEffectBehavior.STARTLE_HIGH_EXPECTATION:
    case ContestSpectacularEffectBehavior.STARTLE_GOOD_APPEALS:
      return previousContestants.filter(contestant => contestant.roundScore > 0);
    default:
      return contestState.currentRoundAppeals
        .filter(id => id !== contestantId)
        .map(id => contestState.getContestant(id));
  }
}
