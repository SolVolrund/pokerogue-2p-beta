import { globalScene } from "#app/global-scene";
import { ContestPhase } from "./contest-phase";

export class ContestRoundEndPhase extends ContestPhase {
  public readonly phaseName = "ContestRoundEndPhase";

  start(): void {
    super.start();

    this.showContestUi();
    if (this.contestState.isComplete()) {
      globalScene.phaseManager.unshiftNew("ContestEndPhase", this.contestState);
    } else {
      this.contestState.advanceRound();
      globalScene.phaseManager.unshiftNew("ContestRoundStartPhase", this.contestState);
    }

    this.end();
  }
}
