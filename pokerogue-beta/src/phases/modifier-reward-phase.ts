import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { ModifierType } from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { getModifierType } from "#utils/modifier-utils";
import i18next from "i18next";

export class ModifierRewardPhase extends BattlePhase {
  // RibbonModifierRewardPhase extends ModifierRewardPhase and to make typescript happy
  // we need to use a union type here
  public readonly phaseName: "ModifierRewardPhase" | "RibbonModifierRewardPhase" | "GameOverModifierRewardPhase" =
    "ModifierRewardPhase";
  protected modifierType: ModifierType;
  protected playerIndex: PlayerIndex;

  constructor(modifierTypeFunc: ModifierTypeFunc, playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
    super();

    this.modifierType = getModifierType(modifierTypeFunc);
    this.playerIndex = playerIndex;
  }

  start() {
    super.start();

    this.setRewardPlayer();
    this.doReward().then(() => this.end());
  }

  protected setRewardPlayer(): void {
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(this.playerIndex);
    }
  }

  doReward(): Promise<void> {
    return new Promise<void>(resolve => {
      const newModifier = this.modifierType.newModifier();
      globalScene.addModifier(newModifier, undefined, undefined, undefined, undefined, undefined, this.playerIndex);
      audioManager.playSound("se/item_fanfare");
      globalScene.ui.showText(
        i18next.t("battle:rewardGain", {
          modifierName: newModifier?.type.name,
        }),
        null,
        () => resolve(),
        null,
        true,
      );
    });
  }
}
