import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { ContestState } from "#data/contests/contest-state";
import { Button } from "#enums/buttons";
import type { PhaseString } from "#types/phase-types";
import { getContestUi } from "#ui/contest-ui";

export class ContestMessagePhase extends Phase {
  public readonly phaseName = "ContestMessagePhase";
  private readonly contestState: ContestState;
  private readonly displayPhaseName: PhaseString;
  private readonly message: string;
  private complete = false;

  constructor(contestState: ContestState, displayPhaseName: PhaseString, message: string) {
    super();
    this.contestState = contestState;
    this.displayPhaseName = displayPhaseName;
    this.message = message;
  }

  start(): void {
    globalScene.ui.clearText();
    const messageHandler = globalScene.ui.getMessageHandler();
    messageHandler.bg.setVisible(false);
    messageHandler.commandWindow.setVisible(false);
    messageHandler.movesWindowContainer.setVisible(false);
    messageHandler.prompt?.setVisible(false);
    const contestUi = getContestUi();
    contestUi.showMessage(this.displayPhaseName, this.contestState, this.message);
    globalScene.inputController.events.on("input_down", this.handleInput, this);
  }

  override end(): void {
    globalScene.inputController.events.off("input_down", this.handleInput, this);
    getContestUi().clearMessage();
    super.end();
  }

  private handleInput(input: { button: Button }): void {
    if (this.complete || (input.button !== Button.ACTION && input.button !== Button.CANCEL)) {
      return;
    }

    this.complete = true;
    this.end();
  }
}
