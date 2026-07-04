import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { ContestPhase } from "./contest-phase";

export class ContestEndPhase extends ContestPhase {
  public readonly phaseName = "ContestEndPhase";

  start(): void {
    super.start();

    // Placeholder for final ranking, rewards, and transition back to the run.
    leaveEncounterWithoutBattle(true);
    this.end();
  }
}
