import { globalScene } from "#app/global-scene";
import { formatContestIntroScoreMessage } from "#data/contests/contest-debug-text";
import { getContestUi } from "#ui/contest-ui";
import { ContestPhase } from "./contest-phase";

export class ContestIntroScorePhase extends ContestPhase {
  public readonly phaseName = "ContestIntroScorePhase";

  start(): void {
    super.start();

    this.showContestUi();
    getContestUi().playIntroJudging(this.contestState)
      .then(() => {
        this.contestState.sortTurnOrderByPrimaryJudgingScore();
        globalScene.phaseManager.unshiftNew(
          "ContestMessagePhase",
          this.contestState,
          this.phaseName,
          formatContestIntroScoreMessage(this.contestState),
        );
        this.end();
      });
  }
}
