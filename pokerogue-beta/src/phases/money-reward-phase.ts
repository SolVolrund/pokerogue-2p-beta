import { globalScene } from "#app/global-scene";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoneyMultiplierModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";
import { MoneyAchv } from "#system/achv";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export class MoneyRewardPhase extends BattlePhase {
  public readonly phaseName = "MoneyRewardPhase";
  private moneyMultiplier: number;

  constructor(moneyMultiplier: number) {
    super();

    this.moneyMultiplier = moneyMultiplier;
  }

  start() {
    if (globalScene.twoPlayerMode) {
      const previousPlayerIndex = globalScene.activePlayerIndex;
      const rewardPlayerIndexes = globalScene.getPlayerFieldOwners();
      const payouts = rewardPlayerIndexes.map(playerIndex => {
        const playerMoneyAmount = this.getMoneyAmount(playerIndex);
        globalScene.addMoneyForPlayer(playerMoneyAmount.value, playerIndex, false);
        return playerMoneyAmount.value;
      });
      globalScene.setActivePlayerIndex(previousPlayerIndex);
      globalScene.updateMoneyText();
      globalScene.validateAchvs(MoneyAchv);

      const userLocale = navigator.language || "en-US";
      const formattedMoneyAmount = Math.min(...payouts).toLocaleString(userLocale);
      const message = i18next.t("battle:moneyWon", {
        moneyAmount: formattedMoneyAmount,
      });

      globalScene.waitForSharedInput();
      globalScene.ui.showText(message, null, () => this.end(), null, true);
      return;
    }

    const moneyAmount = this.getMoneyAmount();

    globalScene.addMoney(moneyAmount.value);

    const userLocale = navigator.language || "en-US";
    const formattedMoneyAmount = moneyAmount.value.toLocaleString(userLocale);
    const message = i18next.t("battle:moneyWon", {
      moneyAmount: formattedMoneyAmount,
    });

    if (globalScene.twoPlayerMode) {
      globalScene.waitForSharedInput();
    }

    globalScene.ui.showText(message, null, () => this.end(), null, true);
  }

  private getMoneyAmount(playerIndex = globalScene.activePlayerIndex): NumberHolder {
    const moneyAmount = new NumberHolder(globalScene.getWaveMoneyAmount(this.moneyMultiplier));

    globalScene.applyModifiersForPlayer(MoneyMultiplierModifier, playerIndex, moneyAmount);

    if (globalScene.arena.getTag(ArenaTagType.HAPPY_HOUR)) {
      moneyAmount.value *= 2;
    }

    return moneyAmount;
  }
}
