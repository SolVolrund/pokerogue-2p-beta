import { ContestPhase } from "./contest-phase";

export class ContestIntroScorePhase extends ContestPhase {
  public readonly phaseName = "ContestIntroScorePhase";

  start(): void {
    super.start();

    // Placeholder for primary judging / intro score calculation.
    this.end();
  }
}
