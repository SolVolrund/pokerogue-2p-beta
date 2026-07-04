import { globalScene } from "#app/global-scene";
import { formatContestStartMessage } from "#data/contests/contest-debug-text";
import { ensureContestUiAssetsLoaded } from "#ui/contest-ui";
import { ContestPhase } from "./contest-phase";

export class ContestStartPhase extends ContestPhase {
  public readonly phaseName = "ContestStartPhase";

  start(): void {
    super.start();

    ensureContestUiAssetsLoaded().then(() => {
      this.showContestUi();
      globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, formatContestStartMessage(this.contestState));
      globalScene.phaseManager.pushNew("ContestIntroScorePhase", this.contestState);
      globalScene.phaseManager.pushNew("ContestRoundStartPhase", this.contestState);
      this.end();
    });
  }
}
