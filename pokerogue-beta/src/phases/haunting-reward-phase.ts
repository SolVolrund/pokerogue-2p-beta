import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { grantHauntingVictoryRewards } from "#utils/haunting-utils";

export class HauntingRewardPhase extends BattlePhase {
  public readonly phaseName = "HauntingRewardPhase";

  start(): void {
    super.start();
    const messages = grantHauntingVictoryRewards();
    if (messages.length) {
      audioManager.playSound("se/item_fanfare");
      globalScene.waitForPlayerSideProgressionInput();
    }
    const showNext = () => {
      const message = messages.shift();
      if (!message) {
        this.end();
        return;
      }
      globalScene.ui.showText(message, null, showNext, null, true);
    };
    showNext();
  }
}
