import { Phase } from "#app/phase";
import { globalScene } from "#app/global-scene";
import { destroyContestUi } from "#ui/contest-ui";

export class ContestCleanupPhase extends Phase {
  public readonly phaseName = "ContestCleanupPhase";

  start(): void {
    globalScene.ui.getMessageHandler().bg.setVisible(true);
    destroyContestUi();
    this.end();
  }
}
