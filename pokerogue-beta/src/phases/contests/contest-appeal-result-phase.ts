import type { ContestParticipantId, ContestState } from "#data/contests/contest-state";
import { MoveId } from "#enums/move-id";
import { ContestPhase } from "./contest-phase";

export class ContestAppealResultPhase extends ContestPhase {
  public readonly phaseName = "ContestAppealResultPhase";
  private readonly contestantId: ContestParticipantId;

  constructor(contestState: ContestState, contestantId: ContestParticipantId) {
    super(contestState);
    this.contestantId = contestantId;
  }

  start(): void {
    super.start();

    // Placeholder until ContestCommandPhase selects real moves.
    this.contestState.recordAppeal(this.contestantId, {
      moveId: MoveId.NONE,
      appeal: 0,
      jam: 0,
    });
    this.end();
  }
}
