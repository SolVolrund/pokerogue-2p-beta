import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { ContestState } from "#data/contests/contest-state";
import type { PhaseString } from "#types/phase-types";
import { clearContestInputMode, setContestInputMode } from "#ui/contest-input-ui-handler";
import { getContestUi } from "#ui/contest-ui";

export class ContestMessagePhase extends Phase {
  public readonly phaseName = "ContestMessagePhase";
  private readonly contestState: ContestState;
  private readonly displayPhaseName: PhaseString;
  private readonly message: string;
  private messagePages: string[] = [];
  private messagePageIndex = 0;
  private complete = false;

  constructor(contestState: ContestState, displayPhaseName: PhaseString, message: string) {
    super();
    this.contestState = contestState;
    this.displayPhaseName = displayPhaseName;
    this.message = message;
  }

  start(): void {
    super.start();

    globalScene.waitForSharedInput();
    globalScene.ui.clearText();
    const messageHandler = globalScene.ui.getMessageHandler();
    messageHandler.bg.setVisible(false);
    messageHandler.commandWindow.setVisible(false);
    messageHandler.movesWindowContainer.setVisible(false);
    messageHandler.prompt?.setVisible(false);
    const contestUi = getContestUi();
    this.messagePages = contestUi.getMessagePages(this.message);
    this.messagePageIndex = 0;
    this.showCurrentMessagePage();
    setContestInputMode({
      onConfirm: () => this.completeMessage(),
      onCancel: () => this.completeMessage(),
    });
  }

  override end(): void {
    clearContestInputMode();
    getContestUi().clearMessage();
    super.end();
  }

  private showCurrentMessagePage(): void {
    getContestUi().showMessage(
      this.displayPhaseName,
      this.contestState,
      this.messagePages[this.messagePageIndex] ?? "",
    );
  }

  private completeMessage(): boolean {
    if (this.complete) {
      return false;
    }

    if (this.messagePageIndex < this.messagePages.length - 1) {
      this.messagePageIndex++;
      this.showCurrentMessagePage();
      return true;
    }

    this.complete = true;
    this.end();
    return true;
  }
}
