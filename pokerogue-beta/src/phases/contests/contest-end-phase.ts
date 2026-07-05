import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getContestEndBgm } from "#data/contests/contest-audio";
import { formatContestFinalMessage } from "#data/contests/contest-debug-text";
import { setContestPlacementRewards } from "#data/contests/contest-rewards";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { ContestPhase } from "./contest-phase";

export class ContestEndPhase extends ContestPhase {
  public readonly phaseName = "ContestEndPhase";

  start(): void {
    super.start();

    // Placeholder for final ranking, rewards, and transition back to the run.
    audioManager.playBgm(getContestEndBgm(this.contestState), true);
    setContestPlacementRewards(this.contestState);
    this.showContestUi();
    leaveEncounterWithoutBattle(true);
    globalScene.phaseManager.unshiftNew("ContestMessagePhase", this.contestState, this.phaseName, formatContestFinalMessage(this.contestState));
    globalScene.phaseManager.unshiftNew("ContestCleanupPhase");
    this.end();
  }
}
