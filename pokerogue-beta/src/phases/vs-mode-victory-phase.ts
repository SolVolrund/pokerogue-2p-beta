import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";

export class VsModeVictoryPhase extends BattlePhase {
  public readonly phaseName = "VsModeVictoryPhase";

  constructor(private readonly winnerPlayerIndex: PlayerIndex) {
    super();
  }

  start() {
    super.start();

    globalScene.disableMenu = true;
    globalScene.setActivePlayerIndex(this.winnerPlayerIndex);
    globalScene.phaseManager.hideAbilityBar();

    if (globalScene.twoPlayerMode) {
      globalScene.waitForSharedInput();
    }

    globalScene.ui.showText(
      `Player ${this.winnerPlayerIndex + 1} wins!`,
      null,
      () => this.finishRun(),
      null,
      true,
    );
  }

  private finishRun(): void {
    const fadeDuration = 2500;
    audioManager.fadeOutBgm(fadeDuration);

    const activeBattlers = globalScene.getField().filter(pokemon => pokemon?.isActive(true));
    activeBattlers.forEach(pokemon => pokemon.hideInfo());

    globalScene.ui.fadeOut(fadeDuration).then(() => {
      activeBattlers.forEach(pokemon => pokemon.setVisible(false));
      globalScene.setFieldScale(1, true);
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.ui.clearText();
      globalScene.phaseManager.pushNew("PostGameOverPhase", globalScene.sessionSlotId);
      this.end();
    });
  }
}
