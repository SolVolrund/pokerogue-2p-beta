import type { MoveId } from "#enums/move-id";
import type { SpeciesId } from "#enums/species-id";
import type { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { ContestCoordinatorType } from "./contest-coordinator-types";
import type { ContestPrimaryJudgingScores, ContestRank } from "./contest-opponents";
import type { ContestType } from "./contest-type";

export type ContestParticipantId = string;

export interface ContestParticipant {
  id: ContestParticipantId;
  name: string;
  pokemon?: Pokemon;
  coordinatorName?: string;
  coordinatorType?: ContestCoordinatorType;
  pokemonSpecies?: SpeciesId;
  pokemonNickname?: string;
  rank?: ContestRank;
  contestMoves?: readonly [MoveId, MoveId, MoveId, MoveId];
  primaryJudgingScores?: ContestPrimaryJudgingScores;
  trainerType?: TrainerType;
  spriteKey?: string;
  totalScore: number;
  roundScore: number;
  lastMoveId?: MoveId;
  moveHistory: MoveId[];
  repeatMoveCounts: Partial<Record<MoveId, number>>;
  comboStandbyMoveId?: MoveId | undefined;
  nervous: boolean;
  easilyStartled: boolean;
  cannotAppeal: boolean;
  appealLocked: boolean;
  jamProtection: ContestJamProtection;
  skipNextRound: boolean;
  appealOrderOverride: ContestAppealOrderOverride;
  conditionStars: number;
}

export enum ContestJamProtection {
  NONE = "none",
  NEXT_JAM = "next_jam",
  FULL_ROUND = "full_round",
}

export enum ContestAppealOrderOverride {
  NONE = "none",
  FIRST = "first",
  LAST = "last",
}

export interface ContestStateOptions {
  contestType: ContestType;
  rank?: ContestRank;
  contestants: readonly ContestParticipant[];
  bgmKey?: string;
  // Reserved for contest-local RNG if move effects begin desyncing again.
  seedSalt?: string;
  totalRounds?: number;
  maxApplause?: number;
}

export interface ContestAppealResult {
  moveId: MoveId;
  appeal: number;
  jam: number;
}

export interface ContestParticipantOptions {
  coordinatorName?: string;
  coordinatorType?: ContestCoordinatorType;
  pokemonSpecies?: SpeciesId;
  pokemonNickname?: string;
  rank?: ContestRank;
  contestMoves?: readonly [MoveId, MoveId, MoveId, MoveId];
  primaryJudgingScores?: ContestPrimaryJudgingScores;
  trainerType?: TrainerType;
  spriteKey?: string;
}

const INTRO_JUDGING_SCORE_PER_HEART = 40;
export const CONTEST_SCORE_PER_APPEAL_HEART = 10;
const MAX_INTRO_JUDGING_HEARTS = 6;

export function contestHeartsToScore(hearts: number): number {
  return hearts * CONTEST_SCORE_PER_APPEAL_HEART;
}

export function contestScoreToHearts(score: number): number {
  return score / CONTEST_SCORE_PER_APPEAL_HEART;
}

export class ContestState {
  public readonly contestType: ContestType;
  public readonly rank?: ContestRank;
  public readonly contestants: ContestParticipant[];
  public readonly totalRounds: number;
  public readonly maxApplause: number;
  public readonly seedSalt: string;
  public round = 0;
  public applause = 0;
  public turnOrder: ContestParticipantId[];
  public bgmKey: string | undefined;
  public currentRoundAppeals: ContestParticipantId[] = [];
  public currentCommandContestantId: ContestParticipantId | undefined;
  public applausePaused = false;
  public audienceBoredomQuickened = false;
  public randomizeNextTurnOrder = false;
  private introJudgingScoresApplied = false;
  private readonly queuedMoves: Partial<Record<ContestParticipantId, MoveId>> = {};

  constructor(options: ContestStateOptions) {
    this.contestType = options.contestType;
    if (options.rank !== undefined) {
      this.rank = options.rank;
    }
    this.contestants = options.contestants.map(contestant => ({ ...contestant }));
    this.totalRounds = options.totalRounds ?? 5;
    this.maxApplause = options.maxApplause ?? 5;
    this.seedSalt = options.seedSalt ?? "";
    this.turnOrder = this.contestants.map(contestant => contestant.id);
    this.bgmKey = options.bgmKey;
  }

  public beginRound(): void {
    if (this.round === 0) {
      this.round = 1;
    }

    this.applausePaused = false;
    this.audienceBoredomQuickened = false;

    for (const contestant of this.contestants) {
      contestant.roundScore = 0;
      contestant.nervous = false;
      contestant.cannotAppeal = contestant.appealLocked || contestant.skipNextRound;
      contestant.skipNextRound = false;
      contestant.easilyStartled = false;
      contestant.jamProtection = ContestJamProtection.NONE;
      contestant.appealOrderOverride = ContestAppealOrderOverride.NONE;
    }

    this.currentRoundAppeals = [];
  }

  public getOrderedContestants(): ContestParticipant[] {
    return this.turnOrder.map(id => this.getContestant(id));
  }

  public getContestant(id: ContestParticipantId): ContestParticipant {
    const contestant = this.contestants.find(candidate => candidate.id === id);
    if (!contestant) {
      throw new Error(`Contest participant ${id} does not exist.`);
    }
    return contestant;
  }

  public recordAppeal(contestantId: ContestParticipantId, result: ContestAppealResult): void {
    const contestant = this.getContestant(contestantId);
    const scoreDelta = contestHeartsToScore(result.appeal - result.jam);
    contestant.roundScore += scoreDelta;
    contestant.totalScore += scoreDelta;
    contestant.lastMoveId = result.moveId;
    contestant.moveHistory.push(result.moveId);
    contestant.repeatMoveCounts[result.moveId] = (contestant.repeatMoveCounts[result.moveId] ?? 0) + 1;
    this.currentRoundAppeals.push(contestantId);
    delete this.queuedMoves[contestantId];
  }

  public applyJam(contestantId: ContestParticipantId, jam: number): number {
    const contestant = this.getContestant(contestantId);
    if (contestant.jamProtection === ContestJamProtection.FULL_ROUND) {
      return 0;
    }

    const appliedJam = contestant.easilyStartled ? jam * 2 : jam;
    if (contestant.jamProtection === ContestJamProtection.NEXT_JAM) {
      contestant.jamProtection = ContestJamProtection.NONE;
      return 0;
    }

    const scoreDelta = contestHeartsToScore(appliedJam);
    contestant.roundScore -= scoreDelta;
    contestant.totalScore -= scoreDelta;

    return appliedJam;
  }

  public queueMove(contestantId: ContestParticipantId, moveId: MoveId): void {
    this.getContestant(contestantId);
    this.queuedMoves[contestantId] = moveId;
  }

  public getQueuedMove(contestantId: ContestParticipantId): MoveId | undefined {
    this.getContestant(contestantId);
    return this.queuedMoves[contestantId];
  }

  public getPreviousAppealContestants(contestantId: ContestParticipantId): ContestParticipant[] {
    const contestantIndex = this.currentRoundAppeals.indexOf(contestantId);
    const previousIds =
      contestantIndex >= 0 ? this.currentRoundAppeals.slice(0, contestantIndex) : this.currentRoundAppeals;

    return previousIds.map(id => this.getContestant(id));
  }

  public getRemainingContestants(contestantId: ContestParticipantId): ContestParticipant[] {
    const orderedIds = this.turnOrder;
    const contestantIndex = orderedIds.indexOf(contestantId);
    if (contestantIndex < 0) {
      return [];
    }

    const previousAppeals = new Set(this.currentRoundAppeals);

    return orderedIds
      .slice(contestantIndex + 1)
      .filter(id => !previousAppeals.has(id))
      .map(id => this.getContestant(id));
  }

  public getPrimaryJudgingScore(contestantId: ContestParticipantId): number {
    return this.getContestant(contestantId).primaryJudgingScores?.[this.contestType] ?? 0;
  }

  public getIntroJudgingHearts(contestantId: ContestParticipantId): number {
    return Math.min(MAX_INTRO_JUDGING_HEARTS, Math.max(0, this.getPrimaryJudgingScore(contestantId)));
  }

  public getIntroJudgingFinalScore(contestantId: ContestParticipantId): number {
    return this.getIntroJudgingHearts(contestantId) * INTRO_JUDGING_SCORE_PER_HEART;
  }

  public applyIntroJudgingScores(): void {
    if (this.introJudgingScoresApplied) {
      return;
    }

    for (const contestant of this.contestants) {
      contestant.totalScore += this.getIntroJudgingFinalScore(contestant.id);
    }

    this.introJudgingScoresApplied = true;
  }

  public sortTurnOrderByPrimaryJudgingScore(): void {
    this.turnOrder = this.contestants
      .slice()
      .sort((a, b) => {
        const scoreDifference = this.getPrimaryJudgingScore(b.id) - this.getPrimaryJudgingScore(a.id);
        return (
          scoreDifference || compareContestantTieBreakers(a, b, `intro-${this.contestType}-${this.rank ?? "none"}`)
        );
      })
      .map(contestant => contestant.id);
  }

  public finishRound(): void {
    if (this.randomizeNextTurnOrder) {
      this.turnOrder = this.contestants
        .slice()
        .sort((a, b) => compareContestantTieBreakers(a, b, `randomize-${this.round}`))
        .map(contestant => contestant.id);
      this.randomizeNextTurnOrder = false;
      return;
    }

    const nextTurnContestants = this.contestants.slice().sort((a, b) => {
      if (a.appealOrderOverride !== b.appealOrderOverride) {
        if (a.appealOrderOverride === ContestAppealOrderOverride.FIRST) {
          return -1;
        }
        if (b.appealOrderOverride === ContestAppealOrderOverride.FIRST) {
          return 1;
        }
        if (a.appealOrderOverride === ContestAppealOrderOverride.LAST) {
          return 1;
        }
        if (b.appealOrderOverride === ContestAppealOrderOverride.LAST) {
          return -1;
        }
      }

      const scoreDifference = b.roundScore - a.roundScore;
      return scoreDifference || compareContestantTieBreakers(a, b, `round-${this.round}`);
    });

    this.turnOrder = nextTurnContestants.map(contestant => contestant.id);
    this.randomizeNextTurnOrder = false;
  }

  public advanceRound(): void {
    this.round++;
  }

  public isComplete(): boolean {
    return this.round >= this.totalRounds;
  }
}

export function compareContestantTieBreakers(a: ContestParticipant, b: ContestParticipant, salt: string): number {
  const aHash = hashContestantTieBreaker(`${salt}:${a.id}`);
  const bHash = hashContestantTieBreaker(`${salt}:${b.id}`);

  return aHash - bHash || a.id.localeCompare(b.id);
}

function hashContestantTieBreaker(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function createContestParticipant(
  id: ContestParticipantId,
  name: string,
  pokemon?: Pokemon,
  options: ContestParticipantOptions = {},
): ContestParticipant {
  return {
    id,
    name,
    ...(pokemon ? { pokemon } : {}),
    ...options,
    totalScore: 0,
    roundScore: 0,
    moveHistory: [],
    repeatMoveCounts: {},
    nervous: false,
    easilyStartled: false,
    cannotAppeal: false,
    appealLocked: false,
    jamProtection: ContestJamProtection.NONE,
    skipNextRound: false,
    appealOrderOverride: ContestAppealOrderOverride.NONE,
    conditionStars: 0,
  };
}
