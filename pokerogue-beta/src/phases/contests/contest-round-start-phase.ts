import { globalScene } from "#app/global-scene";
import { getContestUi } from "#ui/contest-ui";
import { ContestPhase } from "./contest-phase";

export class ContestRoundStartPhase extends ContestPhase {
  public readonly phaseName = "ContestRoundStartPhase";

  start(): void {
    super.start();

    this.contestState.beginRound();
    this.showContestUi();
    getContestUi().raiseCurtain().then(() => {
      globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, `Round ${this.contestState.round} begins!`);
      const firstContestant = this.contestState.getOrderedContestants()[0];
      if (firstContestant) {
        globalScene.phaseManager.pushNew("ContestCommandPhase", this.contestState, firstContestant.id);
      } else {
        globalScene.phaseManager.pushNew("ContestRoundScoringPhase", this.contestState);
      }
      this.end();
    });
  }
}
