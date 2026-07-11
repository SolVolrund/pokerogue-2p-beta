import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import type { Unlockables } from "#enums/unlockables";
import { getUnlockableName } from "#system/unlockables";
import i18next from "i18next";

export class UnlockPhase extends Phase {
  public readonly phaseName = "UnlockPhase";
  private unlockable: Unlockables;
  private playerIndexes: PlayerIndex[];

  constructor(unlockable: Unlockables, playerIndexes?: PlayerIndex[]) {
    super();

    this.unlockable = unlockable;
    this.playerIndexes = playerIndexes?.length ? playerIndexes : [globalScene.activePlayerIndex];
  }

  start(): void {
    globalScene.time.delayedCall(2000, () => {
      for (const playerIndex of this.playerIndexes) {
        const gameData = globalScene.getPlayerGameData(playerIndex);
        gameData.unlocks[this.unlockable] = true;
        if (globalScene.twoPlayerMode) {
          globalScene.savePlayerSystemSaveLocal(playerIndex);
        } else {
          gameData.saveSystemLocal();
        }
      }
      // Sound loaded into game as is
      audioManager.playSound("se/level_up_fanfare");
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.showText(
        i18next.t("battle:unlockedSomething", {
          unlockedThing: getUnlockableName(this.unlockable),
        }),
        null,
        () => {
          globalScene.time.delayedCall(1500, () => globalScene.arenaBg.setVisible(true));
          this.end();
        },
        null,
        true,
        1500,
      );
    });
  }
}
