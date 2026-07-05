import { globalScene } from "#app/global-scene";
import type { ContestParticipantId, ContestState } from "#data/contests/contest-state";
import { MoveId } from "#enums/move-id";
import { getContestUi } from "#ui/contest-ui";
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
    getContestUi().playContestantAppeal(
      this.contestState.getContestant(this.contestantId),
      this.contestState.getQueuedMove(this.contestantId) ?? MoveId.NONE,
    )
      .then(() => {
        globalScene.phaseManager.unshiftNew("ContestAppealResultPhase", this.contestState, this.contestantId);
        this.end();
      });
  }
}
