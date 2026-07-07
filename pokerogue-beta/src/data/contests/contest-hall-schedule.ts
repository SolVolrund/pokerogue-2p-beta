import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import type { ContestHallProgress } from "#mystery-encounters/mystery-encounter-save-data";
import { randSeedInt } from "#utils/common";

const CONTEST_HALL_INITIAL_MIN_WAVE = 10;
const CONTEST_HALL_INITIAL_MAX_WAVE = 20;
const CONTEST_HALL_REPEAT_MIN_DELAY = 20;
const CONTEST_HALL_REPEAT_MAX_DELAY = 30;
const CONTEST_HALL_MISSED_SEARCH_WINDOW = 10;
const CONTEST_HALL_SCHEDULE_SEED_OFFSET = 94731;

function getContestHallProgress(): ContestHallProgress {
  return globalScene.mysteryEncounterSaveData.contestHallProgress;
}

function isContestHallScheduleFinished(progress: ContestHallProgress): boolean {
  return !!progress.declined || !!progress.wonGrand;
}

function isContestHallEligibleWave(wave: number): boolean {
  return (
    globalScene.isMysteryEncounterValidForWave(BattleType.WILD, wave)
    && !globalScene.gameMode.isFixedBattle(wave)
    && !globalScene.gameMode.isWaveFinal(wave)
  );
}

function getContestHallEligibleWaves(minWave: number, maxWave: number): number[] {
  const waves: number[] = [];
  for (let wave = minWave; wave <= maxWave; wave++) {
    if (isContestHallEligibleWave(wave)) {
      waves.push(wave);
    }
  }

  return waves;
}

function chooseContestHallWave(minWave: number, maxWave: number, seedBaseWave: number): number | undefined {
  const eligibleWaves = getContestHallEligibleWaves(minWave, maxWave);
  if (eligibleWaves.length === 0) {
    return undefined;
  }

  let scheduledWave = eligibleWaves[0];
  globalScene.executeWithSeedOffset(() => {
    scheduledWave = eligibleWaves[randSeedInt(eligibleWaves.length)];
  }, CONTEST_HALL_SCHEDULE_SEED_OFFSET + seedBaseWave * 97);

  return scheduledWave;
}

function getContestHallScheduledWindow(progress: ContestHallProgress): [number, number, number] {
  if (progress.lastContestWave != null) {
    return [
      progress.lastContestWave + CONTEST_HALL_REPEAT_MIN_DELAY,
      progress.lastContestWave + CONTEST_HALL_REPEAT_MAX_DELAY,
      progress.lastContestWave,
    ];
  }

  return [CONTEST_HALL_INITIAL_MIN_WAVE, CONTEST_HALL_INITIAL_MAX_WAVE, 0];
}

function pickContestHallScheduledWave(progress: ContestHallProgress, currentWave: number): number | undefined {
  const [minWave, maxWave, seedBaseWave] = getContestHallScheduledWindow(progress);
  const scheduledWave = chooseContestHallWave(Math.max(currentWave, minWave), maxWave, seedBaseWave);
  if (scheduledWave != null) {
    return scheduledWave;
  }

  const missedMinWave = Math.max(currentWave, maxWave + 1);
  const missedMaxWave = missedMinWave + CONTEST_HALL_MISSED_SEARCH_WINDOW - 1;
  return chooseContestHallWave(missedMinWave, missedMaxWave, seedBaseWave + missedMinWave);
}

export function ensureContestHallScheduledWave(currentWave = globalScene.currentBattle.waveIndex): number | undefined {
  const progress = getContestHallProgress();
  if (isContestHallScheduleFinished(progress)) {
    delete progress.nextScheduledWave;
    return undefined;
  }

  if (
    progress.nextScheduledWave != null
    && progress.nextScheduledWave >= currentWave
    && isContestHallEligibleWave(progress.nextScheduledWave)
  ) {
    return progress.nextScheduledWave;
  }

  const scheduledWave = pickContestHallScheduledWave(progress, currentWave);
  if (scheduledWave == null) {
    delete progress.nextScheduledWave;
    return undefined;
  }

  progress.nextScheduledWave = scheduledWave;
  return scheduledWave;
}

export function isContestHallScheduledEncounterDue(currentWave = globalScene.currentBattle.waveIndex): boolean {
  return ensureContestHallScheduledWave(currentWave) === currentWave;
}

export function markContestHallCompleted(): void {
  const progress = getContestHallProgress();
  progress.lastContestWave = globalScene.currentBattle.waveIndex;
  delete progress.nextScheduledWave;
}

export function markContestHallDeclined(): void {
  const progress = getContestHallProgress();
  progress.declined = true;
  delete progress.nextScheduledWave;
}
