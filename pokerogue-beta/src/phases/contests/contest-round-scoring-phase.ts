import { globalScene } from "#app/global-scene";
import { ContestPhase } from "./contest-phase";

export class ContestRoundScoringPhase extends ContestPhase {
  public readonly phaseName = "ContestRoundScoringPhase";

  start(): void {
    super.start();

    this.contestState.finishRound();
    globalScene.phaseManager.unshiftNew("ContestRoundEndPhase", this.contestState);
    this.end();
  }
}
