import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import type { ModifierType, ModifierTypeKeys } from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { getModifierType } from "#utils/modifier-utils";
import { getPlayerMessageOptions } from "#utils/player-messages";
import i18next from "i18next";

const fullStackRewardBalls: Partial<Record<ModifierTier, ModifierTypeKeys>> = {
  [ModifierTier.COMMON]: "POKEBALL",
  [ModifierTier.GREAT]: "GREAT_BALL",
  [ModifierTier.ULTRA]: "ULTRA_BALL",
  [ModifierTier.ROGUE]: "ROGUE_BALL",
  [ModifierTier.MASTER]: "MASTER_BALL",
};

export class ModifierRewardPhase extends BattlePhase {
  // RibbonModifierRewardPhase extends ModifierRewardPhase and to make typescript happy
  // we need to use a union type here
  public readonly phaseName: "ModifierRewardPhase" | "RibbonModifierRewardPhase" | "GameOverModifierRewardPhase" =
    "ModifierRewardPhase";
  protected modifierType: ModifierType;
  protected playerIndex: PlayerIndex;
  private readonly substituteFullStack: boolean;

  constructor(
    modifierTypeFunc: ModifierTypeFunc,
    playerIndex: PlayerIndex = globalScene.activePlayerIndex,
    substituteFullStack = false,
  ) {
    super();

    this.modifierType = getModifierType(modifierTypeFunc);
    this.playerIndex = playerIndex;
    this.substituteFullStack = substituteFullStack;
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
    const rewardType = this.substituteFullStack ? this.getEventRewardType() : this.modifierType;
    if (!rewardType) {
      return Promise.resolve();
    }
    return new Promise<void>(resolve => {
      const newModifier = rewardType.newModifier();
      globalScene.addModifier(newModifier, undefined, undefined, undefined, undefined, undefined, this.playerIndex);
      audioManager.playSound("se/item_fanfare");
      globalScene.ui.showText(
        i18next.t("battle:rewardGain", {
          ...getPlayerMessageOptions(this.playerIndex),
          modifierName: newModifier?.type.name,
        }),
        null,
        () => resolve(),
        null,
        true,
      );
    });
  }

  private getEventRewardType(): ModifierType | undefined {
    // Resolve after battle-end restoration and earlier rewards, using the recipient's inventory.
    const existingItem = globalScene.getPlayerModifiers(this.playerIndex).find(m => m.type.id === this.modifierType.id);
    if (!existingItem || existingItem.getStackCount() < existingItem.getMaxStackCount()) {
      return this.modifierType;
    }

    const tier = existingItem.type.getOrInferTier();
    const replacement = tier == null ? undefined : fullStackRewardBalls[tier];
    if (!replacement) {
      console.warn(`Event reward ${this.modifierType.id} is at max stacks but has no matching ball tier.`);
      return;
    }
    return getModifierType(modifierTypes[replacement]);
  }
}
