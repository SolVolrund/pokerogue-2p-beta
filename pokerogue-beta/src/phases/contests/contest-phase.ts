import { Phase } from "#app/phase";
import type { ContestState } from "#data/contests/contest-state";
import { getContestUi } from "#ui/contest-ui";

export abstract class ContestPhase extends Phase {
  protected readonly contestState: ContestState;

  constructor(contestState: ContestState) {
    super();
    this.contestState = contestState;
  }

  protected showContestUi(): void {
    getContestUi().showPhase(this.phaseName, this.contestState);
  }
}
