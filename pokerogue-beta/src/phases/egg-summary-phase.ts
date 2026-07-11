import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { EggHatchData } from "#data/egg-hatch-data";
import { UiMode } from "#enums/ui-mode";

/**
 * Class that represents the egg summary phase
 * It does some of the function for updating egg data
 * Phase is handled mostly by the egg-hatch-scene-handler UI
 */
export class EggSummaryPhase extends Phase {
  public readonly phaseName = "EggSummaryPhase";
  private eggHatchData: EggHatchData[];
  private playerIndex: PlayerIndex;
  private restorePlayerIndex: PlayerIndex = 0;

  constructor(eggHatchData: EggHatchData[], playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
    super();
    this.eggHatchData = eggHatchData;
    this.playerIndex = playerIndex;
  }

  public override async start(): Promise<void> {
    super.start();

    this.restorePlayerIndex = globalScene.activePlayerIndex;
    if (globalScene.twoPlayerMode) {
      globalScene.setActivePlayerIndex(this.playerIndex);
    }
    const gameData = globalScene.getPlayerGameData(this.playerIndex);

    for (const eggHatchData of this.eggHatchData) {
      eggHatchData.setDex(gameData);
      await eggHatchData.updatePokemon(false, gameData);
    }
    globalScene.savePlayerSystemSaveLocal(this.playerIndex);

    await globalScene.ui.setModeForceTransition(UiMode.EGG_HATCH_SUMMARY, this.eggHatchData, this.playerIndex);
    audioManager.fadeOutBgm();
  }

  public override end(): void {
    this.eggHatchData.forEach(data => {
      data.pokemon?.destroy();
    });
    this.eggHatchData = [];
    globalScene.time.delayedCall(250, () => globalScene.setModifiersVisible(true));
    globalScene.ui.setModeForceTransition(UiMode.MESSAGE).then(() => {
      if (globalScene.twoPlayerMode) {
        globalScene.setActivePlayerIndex(this.restorePlayerIndex);
      }
      super.end();
    });
  }
}
