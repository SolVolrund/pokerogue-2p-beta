import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { UiHandler } from "#ui/ui-handler";

export interface MiningInputConfig {
  inputDelayMs?: number;
  onMove?: (dx: number, dy: number) => boolean;
  onConfirm?: () => boolean;
  onToolToggle?: () => boolean;
}

export class MiningInputUiHandler extends UiHandler {
  private config: MiningInputConfig | undefined;
  private inputReadyAt = 0;

  constructor() {
    super(UiMode.MINING_INPUT);
  }

  setup(): void {}

  show(args: any[]): boolean {
    super.show(args);
    this.config = args[0] as MiningInputConfig | undefined;
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
      case Button.STATS:
      case Button.CYCLE_FORM:
        return this.handleToolToggle();
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

  private handleToolToggle(): boolean {
    const success = this.config?.onToolToggle?.() ?? false;
    if (success) {
      this.getUi().playSelect();
    }
    return success;
  }

}

export function setMiningInputMode(config: MiningInputConfig): void {
  const handler = globalScene.ui.handlers[UiMode.MINING_INPUT] as MiningInputUiHandler;
  if (globalScene.ui.getMode() === UiMode.MINING_INPUT) {
    handler.show([config]);
    setTimeout(() => globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("mining-input-ready"), 0);
    return;
  }

  void globalScene.ui.setMode(UiMode.MINING_INPUT, config);
}

export function clearMiningInputMode(): void {
  const handler = globalScene.ui.handlers[UiMode.MINING_INPUT] as MiningInputUiHandler;
  handler.clear();
}
