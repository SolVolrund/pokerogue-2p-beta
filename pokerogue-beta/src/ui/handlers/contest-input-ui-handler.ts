import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { UiHandler } from "#ui/ui-handler";

export interface ContestInputConfig {
  inputDelayMs?: number;
  onMoveSelection?: (delta: number) => boolean;
  onConfirm?: () => boolean;
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
    if (!this.config) {
      return false;
    }

    if (Date.now() < this.inputReadyAt) {
      return false;
    }

    switch (button) {
      case Button.UP:
      case Button.LEFT:
        return this.handleMoveSelection(-1);
      case Button.DOWN:
      case Button.RIGHT:
        return this.handleMoveSelection(1);
      case Button.ACTION:
        return this.handleConfirm();
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

  private handleConfirm(): boolean {
    const success = this.config?.onConfirm?.() ?? false;
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
