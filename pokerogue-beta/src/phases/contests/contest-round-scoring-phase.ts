import { globalScene } from "#app/global-scene";
import { formatContestRoundSummaryMessage } from "#data/contests/contest-debug-text";
import { getContestUi } from "#ui/contest-ui";
import { ContestPhase } from "./contest-phase";

export class ContestRoundScoringPhase extends ContestPhase {
  public readonly phaseName = "ContestRoundScoringPhase";

  start(): void {
    super.start();

    this.showContestUi();
    getContestUi().lowerCurtain().then(() => {
      this.contestState.finishRound();
      this.showContestUi();
      globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, formatContestRoundSummaryMessage(this.contestState));
      globalScene.phaseManager.unshiftNew("ContestRoundEndPhase", this.contestState);
      this.end();
    });
  }
}
