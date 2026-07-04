import { globalScene } from "#app/global-scene";
import { ContestPhase } from "./contest-phase";

export class ContestStartPhase extends ContestPhase {
  public readonly phaseName = "ContestStartPhase";

  start(): void {
    super.start();

    globalScene.phaseManager.pushNew("ContestIntroScorePhase", this.contestState);
    globalScene.phaseManager.pushNew("ContestRoundStartPhase", this.contestState);
    this.end();
  }
}
