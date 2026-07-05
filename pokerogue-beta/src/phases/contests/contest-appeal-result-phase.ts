import { globalScene } from "#app/global-scene";
import { playContestCheering } from "#data/contests/contest-audio";
import { formatContestAppealMessage } from "#data/contests/contest-debug-text";
import { applyContestMove } from "#data/contests/contest-rules";
import type { ContestParticipantId, ContestState } from "#data/contests/contest-state";
import { MoveId } from "#enums/move-id";
import { getContestUi } from "#ui/contest-ui";
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

    const moveId = this.contestState.getQueuedMove(this.contestantId) ?? MoveId.NONE;
    const previousScores = new Map(this.contestState.contestants.map(contestant => [contestant.id, contestant.roundScore]));
    const resolution = applyContestMove(this.contestState, this.contestantId, moveId);
    const nextContestant = this.contestState.getOrderedContestants()[this.contestState.currentRoundAppeals.length];

    this.showContestUi();
    if (resolution.applauseDelta > 0) {
      playContestCheering(resolution.applauseBonus > 0);
    }
    getContestUi().animateAppealScoreChanges(this.contestState, previousScores)
      .then(() => getContestUi().playContestantAppealExit())
      .then(() => {
        globalScene.phaseManager.unshiftNew(
          "ContestMessagePhase",
          this.contestState,
          this.phaseName,
          formatContestAppealMessage(this.contestState, resolution),
        );
        if (nextContestant) {
          globalScene.phaseManager.unshiftNew("ContestCommandPhase", this.contestState, nextContestant.id);
        } else {
          globalScene.phaseManager.unshiftNew("ContestRoundScoringPhase", this.contestState);
        }
        this.end();
      });
  }
}
