import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { ensureContestAudioAssetsLoaded } from "#data/contests/contest-audio";
import { formatContestStartMessage } from "#data/contests/contest-debug-text";
import { ensureContestUiAssetsLoaded } from "#ui/contest-ui";
import { ContestPhase } from "./contest-phase";

export class ContestStartPhase extends ContestPhase {
  public readonly phaseName = "ContestStartPhase";

  start(): void {
    super.start();

    ensureContestUiAssetsLoaded().then(() => ensureContestAudioAssetsLoaded()).then(() => {
      if (this.contestState.bgmKey) {
        audioManager.playBgm(this.contestState.bgmKey, true);
      }
      this.showContestUi();
      globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, formatContestStartMessage(this.contestState));
      globalScene.phaseManager.pushNew("ContestIntroScorePhase", this.contestState);
      globalScene.phaseManager.pushNew("ContestRoundStartPhase", this.contestState);
      this.end();
    });
  }
}
