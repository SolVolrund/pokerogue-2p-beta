import { globalScene } from "#app/global-scene";
import { ContestPhase } from "./contest-phase";

export class ContestCommandPhase extends ContestPhase {
  public readonly phaseName = "ContestCommandPhase";

  start(): void {
    super.start();

    for (const contestant of this.contestState.getOrderedContestants()) {
      globalScene.phaseManager.pushNew("ContestAppealPhase", this.contestState, contestant.id);
    }

    globalScene.phaseManager.pushNew("ContestRoundScoringPhase", this.contestState);
    this.end();
  }
}
