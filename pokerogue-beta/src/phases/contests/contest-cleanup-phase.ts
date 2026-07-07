import { Phase } from "#app/phase";
import { globalScene } from "#app/global-scene";
import { CONTEST_SCREEN_FADE_DURATION } from "#data/contests/contest-transition";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { destroyContestUi } from "#ui/contest-ui";

export class ContestCleanupPhase extends Phase {
  public readonly phaseName = "ContestCleanupPhase";

  constructor(private readonly addHealPhase = true) {
    super();
  }

  start(): void {
    void this.cleanupContest();
  }

  private async cleanupContest(): Promise<void> {
    await globalScene.ui.fadeOut(CONTEST_SCREEN_FADE_DURATION);
    globalScene.ui.getMessageHandler().bg.setVisible(true);
    destroyContestUi();
    leaveEncounterWithoutBattle(this.addHealPhase);
    await globalScene.ui.fadeIn(CONTEST_SCREEN_FADE_DURATION);
    this.end();
  }
}
