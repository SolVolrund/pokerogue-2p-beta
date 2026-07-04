import { globalScene } from "#app/global-scene";
import { formatContestFinalMessage } from "#data/contests/contest-debug-text";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { ContestPhase } from "./contest-phase";

export class ContestEndPhase extends ContestPhase {
  public readonly phaseName = "ContestEndPhase";

  start(): void {
    super.start();

    // Placeholder for final ranking, rewards, and transition back to the run.
    this.showContestUi();
    leaveEncounterWithoutBattle(true);
    globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, formatContestFinalMessage(this.contestState));
    globalScene.phaseManager.unshiftNew("ContestCleanupPhase");
    this.end();
  }
}
