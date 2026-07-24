import type { BattleScene, PlayerIndex } from "#app/battle-scene";
import { ensureContestHallScheduledWave } from "#data/contests/contest-hall-schedule";
import { BattleType } from "#enums/battle-type";
import type { GameModes } from "#enums/game-modes";
import { getGtsMalfunctionTargetWave } from "#mystery-encounters/gts-malfunction-encounter";
import type { DejaVuScheduledEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import type { DejaVuGhostData } from "#types/save-data";

const DEJA_VU_BUCKET_SIZE = 10;

export interface DejaVuGhostContext {
  playerIndex: PlayerIndex;
  ghost: DejaVuGhostData;
}

type DejaVuScheduleWaveValidator = (waveIndex: number) => boolean;

function getDejaVuBucketStart(waveIndex: number): number {
  return Math.max(Math.floor(waveIndex / DEJA_VU_BUCKET_SIZE) * DEJA_VU_BUCKET_SIZE, 1);
}

function isHumanProfilePlayer(scene: BattleScene, playerIndex: PlayerIndex): boolean {
  return !scene.isComputerPartnerPlayer(playerIndex);
}

function getActiveGhostForPlayer(
  scene: BattleScene,
  playerIndex: PlayerIndex,
  mode: GameModes = scene.gameMode.modeId,
): DejaVuGhostData | undefined {
  if (!isHumanProfilePlayer(scene, playerIndex)) {
    return undefined;
  }

  const ghost = scene.getPlayerGameData(playerIndex).getDejaVuGhost(mode);
  return ghost?.party?.length ? ghost : undefined;
}

function getScheduleGhostContexts(scene: BattleScene, schedule: DejaVuScheduledEncounterData): DejaVuGhostContext[] {
  const activePlayerIndexes = new Set(scene.getActivePlayerIndexes());
  return Object.entries(schedule.ghostTimestampsByPlayer)
    .map(([playerIndexKey, timestamp]) => {
      const playerIndex = Number(playerIndexKey) as PlayerIndex;
      if (!activePlayerIndexes.has(playerIndex)) {
        return undefined;
      }

      const ghost = getActiveGhostForPlayer(scene, playerIndex, schedule.mode);
      return ghost && ghost.timestamp === timestamp ? { playerIndex, ghost } : undefined;
    })
    .filter((entry): entry is DejaVuGhostContext => !!entry);
}

function getScheduledWaveForGhost(
  scene: BattleScene,
  ghost: DejaVuGhostData,
  isValidScheduleWave: DejaVuScheduleWaveValidator,
): number | undefined {
  const [lowestMysteryEncounterWave, highestMysteryEncounterWave] = scene.gameMode.getMysteryEncounterLegalWaves();
  const bucketStart = Math.max(getDejaVuBucketStart(ghost.waveIndex), lowestMysteryEncounterWave);
  const bucketEnd = Math.min(bucketStart + DEJA_VU_BUCKET_SIZE - 1, highestMysteryEncounterWave);

  for (let waveIndex = bucketStart; waveIndex <= bucketEnd; waveIndex++) {
    if (isValidScheduleWave(waveIndex)) {
      return waveIndex;
    }
  }

  for (let waveIndex = bucketEnd + 1; waveIndex <= highestMysteryEncounterWave; waveIndex++) {
    if (isValidScheduleWave(waveIndex)) {
      return waveIndex;
    }
  }

  return undefined;
}

export function isValidDejaVuScheduleWave(scene: BattleScene, waveIndex: number): boolean {
  const contestHallWave = ensureContestHallScheduledWave(scene.currentBattle.waveIndex);
  const gtsMalfunctionWave = getGtsMalfunctionTargetWave();
  return (
    scene.isMysteryEncounterValidForWave(BattleType.WILD, waveIndex)
    && !scene.gameMode.isFixedBattle(waveIndex)
    && !scene.gameMode.isWaveTrainer(waveIndex)
    && !scene.gameMode.isWaveFinal(waveIndex)
    && waveIndex !== contestHallWave
    && waveIndex !== gtsMalfunctionWave
  );
}

export function ensureDejaVuScheduledEncounters(
  scene: BattleScene,
  isValidScheduleWave: DejaVuScheduleWaveValidator = waveIndex => isValidDejaVuScheduleWave(scene, waveIndex),
): void {
  const saveData = scene.mysteryEncounterSaveData;
  if (saveData.dejaVuScheduleInitialized) {
    return;
  }

  const mode = scene.gameMode.modeId;
  const schedulesByWave = new Map<number, DejaVuScheduledEncounterData>();
  for (const playerIndex of scene.getActivePlayerIndexes()) {
    const ghost = getActiveGhostForPlayer(scene, playerIndex, mode);
    if (!ghost) {
      continue;
    }

    const scheduledWave = getScheduledWaveForGhost(scene, ghost, isValidScheduleWave);
    if (scheduledWave == null) {
      continue;
    }

    const schedule = schedulesByWave.get(scheduledWave) ?? {
      scheduledWave,
      mode,
      ghostTimestampsByPlayer: {},
    };
    schedule.ghostTimestampsByPlayer[playerIndex] = ghost.timestamp;
    schedulesByWave.set(scheduledWave, schedule);
  }

  saveData.dejaVuScheduledEncounters = [...schedulesByWave.values()].sort(
    (a, b) => a.scheduledWave - b.scheduledWave,
  );
  saveData.dejaVuScheduleInitialized = true;
}

export function getDueDejaVuSchedule(
  scene: BattleScene,
  waveIndex: number = scene.currentBattle.waveIndex,
): DejaVuScheduledEncounterData | undefined {
  ensureDejaVuScheduledEncounters(scene);

  return scene.mysteryEncounterSaveData.dejaVuScheduledEncounters.find(schedule => (
    !schedule.completed
    && schedule.mode === scene.gameMode.modeId
    && schedule.scheduledWave <= waveIndex
    && getScheduleGhostContexts(scene, schedule).length > 0
  ));
}

export function getDueDejaVuGhostContexts(
  scene: BattleScene,
  waveIndex: number = scene.currentBattle.waveIndex,
): DejaVuGhostContext[] {
  const schedule = getDueDejaVuSchedule(scene, waveIndex);
  return schedule ? getScheduleGhostContexts(scene, schedule) : [];
}

export function completeDueDejaVuSchedule(scene: BattleScene, waveIndex: number = scene.currentBattle.waveIndex): void {
  const schedule = getDueDejaVuSchedule(scene, waveIndex);
  if (schedule) {
    schedule.completed = true;
  }
}
