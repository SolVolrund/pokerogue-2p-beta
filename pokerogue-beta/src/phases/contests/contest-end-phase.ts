import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getContestEndBgm } from "#data/contests/contest-audio";
import { markContestHallCompleted } from "#data/contests/contest-hall-schedule";
import { formatContestFinalMessage } from "#data/contests/contest-debug-text";
import { setContestPlacementRewards } from "#data/contests/contest-rewards";
import { ContestPhase } from "./contest-phase";
import { ContestRank } from "#data/contests/contest-opponents";
import { compareContestantTieBreakers } from "#data/contests/contest-state";

export class ContestEndPhase extends ContestPhase {
  public readonly phaseName = "ContestEndPhase";

  start(): void {
    super.start();
    const progress = globalScene.mysteryEncounterSaveData.contestHallProgress;
    const winner = this.contestState.contestants
      .slice()
      .sort((a, b) => b.totalScore - a.totalScore || compareContestantTieBreakers(a, b, "final-summary"))[0];
    const playerWon = winner?.pokemon
      ? globalScene.getPlayerIndexForPokemon(winner.pokemon) !== undefined
      : winner?.id === "player" || winner?.id.startsWith("player_");

    if (playerWon) {
      if (this.contestState.rank === ContestRank.NORMAL) {
        progress.wonNormal = true;
      }
      if (this.contestState.rank === ContestRank.SUPER) {
        progress.wonSuper = true;
      }
      if (this.contestState.rank === ContestRank.HYPER) {
        progress.wonHyper = true;
      }
      if (this.contestState.rank === ContestRank.MASTER) {
        progress.wonMaster = true;
      }
      if (this.contestState.rank === ContestRank.GRAND) {
        progress.wonGrand = true;
      }
    }
    markContestHallCompleted();

    // Placeholder for final ranking, rewards, and transition back to the run.
    audioManager.playBgm(getContestEndBgm(this.contestState), true);
    setContestPlacementRewards(this.contestState);
    this.showContestUi();
    globalScene.phaseManager.unshiftNew(
      "ContestMessagePhase",
      this.contestState,
      this.phaseName,
      formatContestFinalMessage(this.contestState),
    );
    globalScene.phaseManager.unshiftNew("ContestCleanupPhase", true);
    this.end();
  }
}
