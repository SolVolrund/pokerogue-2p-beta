import { globalScene } from "#app/global-scene";
import { ContestPhase } from "./contest-phase";

export class ContestRoundStartPhase extends ContestPhase {
  public readonly phaseName = "ContestRoundStartPhase";

  start(): void {
    super.start();

    this.contestState.beginRound();
    globalScene.phaseManager.pushNew("ContestCommandPhase", this.contestState);
    this.end();
  }
}
