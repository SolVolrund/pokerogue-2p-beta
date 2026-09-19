import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { UiHandler } from "#ui/ui-handler";

export interface VoltorbFlipInputConfig {
  inputDelayMs?: number;
  onMove?: (dx: number, dy: number) => boolean;
  onConfirm?: () => boolean;
  onCancel?: () => boolean;
}

export class VoltorbFlipInputUiHandler extends UiHandler {
  private config: VoltorbFlipInputConfig | undefined;
  private inputReadyAt = 0;

  constructor() {
    super(UiMode.VOLTORB_FLIP_INPUT);
  }

  setup(): void {}

  show(args: any[]): boolean {
    super.show(args);
    this.config = args[0] as VoltorbFlipInputConfig | undefined;
    this.inputReadyAt = Date.now() + (this.config?.inputDelayMs ?? 0);
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.config || Date.now() < this.inputReadyAt) {
      return false;
    }

    switch (button) {
      case Button.UP:
        return this.handleMove(0, -1);
      case Button.DOWN:
        return this.handleMove(0, 1);
      case Button.LEFT:
        return this.handleMove(-1, 0);
      case Button.RIGHT:
        return this.handleMove(1, 0);
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

  private handleMove(dx: number, dy: number): boolean {
    const success = this.config?.onMove?.(dx, dy) ?? false;
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

export function setVoltorbFlipInputMode(config: VoltorbFlipInputConfig): void {
  const handler = globalScene.ui.handlers[UiMode.VOLTORB_FLIP_INPUT] as VoltorbFlipInputUiHandler;
  if (globalScene.ui.getMode() === UiMode.VOLTORB_FLIP_INPUT) {
    handler.show([config]);
    setTimeout(() => globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("voltorb-flip-input-ready"), 0);
    return;
  }

  void globalScene.ui.setMode(UiMode.VOLTORB_FLIP_INPUT, config);
}

export function clearVoltorbFlipInputMode(): void {
  const handler = globalScene.ui.handlers[UiMode.VOLTORB_FLIP_INPUT] as VoltorbFlipInputUiHandler;
  handler.clear();
}
