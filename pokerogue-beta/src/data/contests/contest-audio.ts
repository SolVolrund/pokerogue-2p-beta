import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import type { ContestState } from "#data/contests/contest-state";
import { randSeedInt } from "#utils/common";

export const CONTEST_LOBBY_BGM = "contests/pokemon_contest_lobby";
export const CONTEST_RESULT_ANNOUNCEMENT_BGM = "contests/pokemon_contest_result_announcement";
export const CONTEST_WINNER_BGM = "contests/pokemon_contest_winner";
export const CONTEST_APPEAL_HEART_CHANGE_SE = "se/contests/contest_appeal_heart_change";
export const CONTEST_CHEERING_SE = "se/contests/contest_cheering";
export const CONTEST_TURN_NOTIFICATION_SE = "se/contests/contest_turn_notification";

const CONTEST_STAGE_BGM_OPTIONS = [
  { key: "contests/pokemon_contest", weight: 52 },
  { key: "contests/pokemon_contest_alt_1", weight: 26 },
  { key: "contests/pokemon_contest_alt_2", weight: 13 },
  { key: "contests/pokemon_contest_alt_3", weight: 6 },
  { key: "contests/pokemon_contest_alt_4", weight: 3 },
] as const;

const CONTEST_STAGE_BGM_TOTAL_WEIGHT = CONTEST_STAGE_BGM_OPTIONS.reduce((total, option) => total + option.weight, 0);
const CONTEST_SE_FOLDER = "se/contests";
const CONTEST_SE_ASSETS = [
  { key: CONTEST_APPEAL_HEART_CHANGE_SE, name: "contest_appeal_heart_change", filename: "contest_appeal_heart_change.wav" },
  { key: CONTEST_CHEERING_SE, name: "contest_cheering", filename: "contest_cheering.wav" },
  { key: CONTEST_TURN_NOTIFICATION_SE, name: "contest_turn_notification", filename: "contest_turn_notification.wav" },
] as const;
const CONTEST_CHEERING_SHORT_DURATION = 450;

let contestAudioAssetsLoading: Promise<void> | undefined;

export function chooseContestStageBgm(): string {
  let roll = randSeedInt(CONTEST_STAGE_BGM_TOTAL_WEIGHT);

  for (const option of CONTEST_STAGE_BGM_OPTIONS) {
    if (roll < option.weight) {
      return option.key;
    }
    roll -= option.weight;
  }

  return CONTEST_STAGE_BGM_OPTIONS[0].key;
}

export function getContestEndBgm(contestState: ContestState): string {
  return hasPlayerWonContest(contestState) ? CONTEST_WINNER_BGM : CONTEST_RESULT_ANNOUNCEMENT_BGM;
}

export function ensureContestAudioAssetsLoaded(): Promise<void> {
  const unloadedAssets = CONTEST_SE_ASSETS.filter(asset => !globalScene.cache.audio.exists(asset.key));
  if (unloadedAssets.length === 0) {
    return Promise.resolve();
  }

  if (contestAudioAssetsLoading) {
    return contestAudioAssetsLoading;
  }

  contestAudioAssetsLoading = new Promise(resolve => {
    for (const asset of unloadedAssets) {
      globalScene.loadSe(asset.name, CONTEST_SE_FOLDER, asset.filename);
    }

    globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
      contestAudioAssetsLoading = undefined;
      resolve();
    });

    if (!globalScene.load.isLoading()) {
      globalScene.load.start();
    }
  });

  return contestAudioAssetsLoading;
}

export function playContestAppealHeartChange(stepIndex: number): void {
  audioManager.playSound(CONTEST_APPEAL_HEART_CHANGE_SE, {
    rate: Math.min(1.4, 1 + stepIndex * 0.06),
    volume: 0.8,
  });
}

export function playContestCheering(isFullApplause: boolean): void {
  const cheering = audioManager.playSound(CONTEST_CHEERING_SE, {
    volume: isFullApplause ? 0.9 : 0.35,
  });

  if (!isFullApplause && cheering) {
    globalScene.time.delayedCall(CONTEST_CHEERING_SHORT_DURATION, () => cheering.stop());
  }
}

export function playContestTurnNotification(): void {
  audioManager.playSound(CONTEST_TURN_NOTIFICATION_SE);
}

function hasPlayerWonContest(contestState: ContestState): boolean {
  const highestScore = Math.max(...contestState.contestants.map(contestant => contestant.totalScore));

  return contestState.contestants.some(contestant => contestant.id === "player" && contestant.totalScore === highestScore);
}
