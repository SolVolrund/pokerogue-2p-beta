import { Phase } from "#app/phase";
import type { ContestState } from "#data/contests/contest-state";

export abstract class ContestPhase extends Phase {
  protected readonly contestState: ContestState;

  constructor(contestState: ContestState) {
    super();
    this.contestState = contestState;
  }
}
