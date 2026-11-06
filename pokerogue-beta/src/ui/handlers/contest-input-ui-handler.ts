import { globalScene } from "#app/global-scene";
import type { ContestMoveSelection } from "#data/contests/contest-state";
import { Button } from "#enums/buttons";
import type { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { UiHandler } from "#ui/ui-handler";

export interface ContestInputConfig {
  inputDelayMs?: number;
  getMoveSelection?: () => ContestMoveSelection;
  onMoveSelection?: (delta: number) => boolean;
  onConfirm?: (moveId?: MoveId) => boolean;
  onCancel?: () => boolean;
}

export class ContestInputUiHandler extends UiHandler {
  private config: ContestInputConfig | undefined;
  private inputReadyAt = 0;

  constructor() {
    super(UiMode.CONTEST_INPUT);
  }

  setup(): void {}

  show(args: any[]): boolean {
    super.show(args);
    this.config = args[0] as ContestInputConfig | undefined;
    this.inputReadyAt = Date.now() + (this.config?.inputDelayMs ?? 0);
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.isInputReady()) {
      return false;
    }
    return this.handleInput(button);
  }

  isInputReady(): boolean {
    return !!this.config && Date.now() >= this.inputReadyAt;
  }

  getMoveSelection(): ContestMoveSelection | undefined {
    return this.config?.getMoveSelection?.();
  }

  getTwoPlayerInputContextPromptState(): Record<string, unknown> {
    const selection = this.getMoveSelection();
    return selection ? { round: selection.round, contestantId: selection.contestantId } : {};
  }

  processSyncedInput(button: Button, selection: ContestMoveSelection | undefined): boolean {
    const current = this.getMoveSelection();
    if (!current || !selection || selection.round !== current.round
      || selection.contestantId !== current.contestantId || !Number.isInteger(selection.moveId)) {
      return false;
    }

    // The controlling client already passed its delay. Replays must not depend on another client's clock.
    return this.handleInput(button, selection.moveId);
  }

  private handleInput(button: Button, moveId?: MoveId): boolean {
    switch (button) {
      case Button.UP:
      case Button.LEFT:
        return this.handleMoveSelection(-1);
      case Button.DOWN:
      case Button.RIGHT:
        return this.handleMoveSelection(1);
      case Button.ACTION:
      case Button.SUBMIT:
        return this.handleConfirm(moveId);
      case Button.CANCEL:
        return this.handleCancel();
      default:
        return false;
    }
  }

  clear(): void {
    super.clear();
    this.config = undefined;
    this.inputReadyAt = 0;
  }

  private handleMoveSelection(delta: number): boolean {
    const success = this.config?.onMoveSelection?.(delta) ?? false;
    if (success) {
      this.getUi().playSelect();
    }

    return success;
  }

  private handleConfirm(moveId?: MoveId): boolean {
    const success = this.config?.onConfirm?.(moveId) ?? false;
    if (success) {
      this.getUi().playSelect();
    }

    return success;
  }

  private handleCancel(): boolean {
    const success = this.config?.onCancel?.() ?? false;
    if (success) {
      this.getUi().playSelect();
    }

    return success;
  }
}

export function setContestInputMode(config: ContestInputConfig): void {
  const handler = globalScene.ui.handlers[UiMode.CONTEST_INPUT] as ContestInputUiHandler;
  if (globalScene.ui.getMode() === UiMode.CONTEST_INPUT) {
    handler.show([config]);
    setTimeout(() => globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("contest-input-ready"), 0);
    return;
  }

  void globalScene.ui.setMode(UiMode.CONTEST_INPUT, config);
}

export function clearContestInputMode(): void {
  const handler = globalScene.ui.handlers[UiMode.CONTEST_INPUT] as ContestInputUiHandler;
  handler.clear();
}
