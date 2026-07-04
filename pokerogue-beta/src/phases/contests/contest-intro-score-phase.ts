import { globalScene } from "#app/global-scene";
import { formatContestIntroScoreMessage } from "#data/contests/contest-debug-text";
import { ContestPhase } from "./contest-phase";

export class ContestIntroScorePhase extends ContestPhase {
  public readonly phaseName = "ContestIntroScorePhase";

  start(): void {
    super.start();

    this.contestState.sortTurnOrderByPrimaryJudgingScore();
    this.showContestUi();
    globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, formatContestIntroScoreMessage(this.contestState));
    this.end();
  }
}
