import { globalScene } from "#app/global-scene";
import type { ContestParticipantId, ContestState } from "#data/contests/contest-state";
import { ContestPhase } from "./contest-phase";

export class ContestAppealPhase extends ContestPhase {
  public readonly phaseName = "ContestAppealPhase";
  private readonly contestantId: ContestParticipantId;

  constructor(contestState: ContestState, contestantId: ContestParticipantId) {
    super(contestState);
    this.contestantId = contestantId;
  }

  start(): void {
    super.start();

    this.showContestUi();
    globalScene.phaseManager.unshiftNew("ContestAppealResultPhase", this.contestState, this.contestantId);
    this.end();
  }
}
