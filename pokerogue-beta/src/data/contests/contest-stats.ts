import { CONTEST_TYPES, ContestType } from "./contest-type";

export const CONTEST_STAT_MAX = 240;
export const CONTEST_INTRO_SCORE_PER_HEART = 40;
export const CONTEST_INTRO_MAX_HEARTS = CONTEST_STAT_MAX / CONTEST_INTRO_SCORE_PER_HEART;

export type ContestStats = Record<ContestType, number>;
export type PartialContestStats = Partial<Record<ContestType, number>>;

export function createEmptyContestStats(): ContestStats {
  return {
    [ContestType.COOL]: 0,
    [ContestType.BEAUTY]: 0,
    [ContestType.CUTE]: 0,
    [ContestType.SMART]: 0,
    [ContestType.TOUGH]: 0,
  };
}

export function normalizeContestStats(stats?: PartialContestStats | null): ContestStats {
  const normalized = createEmptyContestStats();

  if (!stats) {
    return normalized;
  }

  for (const contestType of CONTEST_TYPES) {
    normalized[contestType] = clampContestStat(stats[contestType]);
  }

  return normalized;
}

export function getContestStatValue(stats: PartialContestStats | undefined, contestType: ContestType): number {
  return clampContestStat(stats?.[contestType]);
}

export function addContestStatValue(
  stats: PartialContestStats | undefined,
  contestType: ContestType,
  amount: number,
): ContestStats {
  const nextStats = normalizeContestStats(stats);
  nextStats[contestType] = clampContestStat(nextStats[contestType] + amount);
  return nextStats;
}

export function getContestIntroHearts(stats: PartialContestStats | undefined, contestType: ContestType): number {
  return Math.min(
    CONTEST_INTRO_MAX_HEARTS,
    Math.floor(getContestStatValue(stats, contestType) / CONTEST_INTRO_SCORE_PER_HEART),
  );
}

export function getContestIntroJudgingScores(stats: PartialContestStats | undefined): ContestStats {
  const normalized = normalizeContestStats(stats);

  for (const contestType of CONTEST_TYPES) {
    normalized[contestType] = getContestIntroHearts(stats, contestType);
  }

  return normalized;
}

function clampContestStat(value: number | undefined): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(CONTEST_STAT_MAX, Math.floor(value!)));
}
