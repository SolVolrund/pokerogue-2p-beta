import type { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { ContestType } from "./contest-type";

export type ContestParticipantId = string;

export interface ContestParticipant {
  id: ContestParticipantId;
  name: string;
  pokemon?: Pokemon;
  totalScore: number;
  roundScore: number;
  lastMoveId?: MoveId;
  moveHistory: MoveId[];
  repeatMoveCounts: Partial<Record<MoveId, number>>;
  comboStandbyMoveId?: MoveId;
  nervous: boolean;
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
  contestants: readonly ContestParticipant[];
  totalRounds?: number;
  maxApplause?: number;
}

export interface ContestAppealResult {
  moveId: MoveId;
  appeal: number;
  jam: number;
}

export class ContestState {
  public readonly contestType: ContestType;
  public readonly contestants: ContestParticipant[];
  public readonly totalRounds: number;
  public readonly maxApplause: number;
  public round = 0;
  public applause = 0;
  public turnOrder: ContestParticipantId[];

  constructor(options: ContestStateOptions) {
    this.contestType = options.contestType;
    this.contestants = options.contestants.map(contestant => ({ ...contestant }));
    this.totalRounds = options.totalRounds ?? 5;
    this.maxApplause = options.maxApplause ?? 5;
    this.turnOrder = this.contestants.map(contestant => contestant.id);
  }

  public beginRound(): void {
    if (this.round === 0) {
      this.round = 1;
    }

    for (const contestant of this.contestants) {
      contestant.roundScore = 0;
      contestant.nervous = false;
      contestant.jamProtection = ContestJamProtection.NONE;
    }
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
    contestant.roundScore += result.appeal - result.jam;
    contestant.totalScore += result.appeal - result.jam;
    contestant.lastMoveId = result.moveId;
    contestant.moveHistory.push(result.moveId);
    contestant.repeatMoveCounts[result.moveId] = (contestant.repeatMoveCounts[result.moveId] ?? 0) + 1;
  }

  public finishRound(): void {
    this.turnOrder = this.contestants
      .slice()
      .sort((a, b) => b.roundScore - a.roundScore)
      .map(contestant => contestant.id);
  }

  public advanceRound(): void {
    this.round++;
  }

  public isComplete(): boolean {
    return this.round >= this.totalRounds;
  }
}

export function createContestParticipant(
  id: ContestParticipantId,
  name: string,
  pokemon?: Pokemon,
): ContestParticipant {
  return {
    id,
    name,
    ...(pokemon ? { pokemon } : {}),
    totalScore: 0,
    roundScore: 0,
    moveHistory: [],
    repeatMoveCounts: {},
    nervous: false,
    jamProtection: ContestJamProtection.NONE,
    skipNextRound: false,
    appealOrderOverride: ContestAppealOrderOverride.NONE,
    conditionStars: 0,
  };
}
