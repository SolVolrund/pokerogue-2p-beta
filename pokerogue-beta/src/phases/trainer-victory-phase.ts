import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { BiomeId } from "#enums/biome-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { BattlePhase } from "#phases/battle-phase";
import { achvs } from "#system/achv";
import { vouchers } from "#system/voucher";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedItem } from "#utils/common";
import i18next from "i18next";

export class TrainerVictoryPhase extends BattlePhase {
  public readonly phaseName = "TrainerVictoryPhase";
  start() {
    globalScene.disableMenu = true;

    audioManager.playBgm(globalScene.currentBattle.trainer?.config.victoryBgm);

    globalScene.phaseManager.unshiftNew("MoneyRewardPhase", globalScene.currentBattle.trainer?.config.moneyMultiplier!); // TODO: is this bang correct?

    const modifierRewardFuncs = globalScene.currentBattle.trainer?.config.modifierRewardFuncs!; // TODO: is this bang correct?
    for (const modifierRewardFunc of modifierRewardFuncs) {
      this.unshiftModifierReward(modifierRewardFunc);
    }

    const trainerType = globalScene.currentBattle.trainer?.config.trainerType!; // TODO: is this bang correct?
    // Validate Voucher for boss trainers
    if (Object.hasOwn(vouchers, TrainerType[trainerType]) && globalScene.currentBattle.trainer?.config.isBoss) {
      const trainerVoucher = vouchers[TrainerType[trainerType]];
      const voucherRewardFunc = timedEventManager.getUpgradeUnlockedVouchers()
        ? [
            modifierTypes.VOUCHER_PLUS,
            modifierTypes.VOUCHER_PLUS,
            modifierTypes.VOUCHER_PLUS,
            modifierTypes.VOUCHER_PREMIUM,
          ][trainerVoucher.voucherType]
        : [modifierTypes.VOUCHER, modifierTypes.VOUCHER, modifierTypes.VOUCHER_PLUS, modifierTypes.VOUCHER_PREMIUM][
            trainerVoucher.voucherType
          ];

      if (globalScene.twoPlayerMode) {
        ([1, 0] as const).forEach(playerIndex => {
          if (!globalScene.validateVoucherForPlayer(trainerVoucher, playerIndex)) {
            this.unshiftModifierRewardForPlayer(voucherRewardFunc, playerIndex);
          }
        });
      } else if (!globalScene.validateVoucher(trainerVoucher)) {
        this.unshiftModifierReward(voucherRewardFunc);
      }
    }
    // Breeders in Space achievement
    if (
      globalScene.arena.biomeId === BiomeId.SPACE
      && (trainerType === TrainerType.BREEDER || trainerType === TrainerType.EXPERT_POKEMON_BREEDER)
    ) {
      globalScene.validateAchv(achvs.BREEDERS_IN_SPACE);
    }

    if (trainerType === TrainerType.DAWN_ZORUA) {
      this.unlockDawnZoruaComputerPartner();
    }

    globalScene.ui.showText(
      i18next.t("battle:trainerDefeated", {
        trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
      }),
      null,
      () => {
        const victoryMessages = globalScene.currentBattle.trainer?.getVictoryMessages()!; // TODO: is this bang correct?
        let message: string;
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(victoryMessages)),
          globalScene.currentBattle.waveIndex,
        );
        message = message!; // tell TS compiler it's defined now

        const showMessage = () => {
          const originalFunc = showMessageOrEnd;
          showMessageOrEnd = () =>
            globalScene.ui.showDialogue(
              message,
              globalScene.currentBattle.trainer?.getName(TrainerSlot.TRAINER, true),
              null,
              originalFunc,
            );

          showMessageOrEnd();
        };
        let showMessageOrEnd = () => this.end();
        if (victoryMessages?.length > 0) {
          if (globalScene.currentBattle.trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
            const originalFunc = showMessageOrEnd;
            showMessageOrEnd = () =>
              globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => originalFunc()));
            globalScene
              .showFieldOverlay(500)
              .then(() =>
                globalScene.charSprite
                  .showCharacter(
                    globalScene.currentBattle.trainer?.getKey()!,
                    getCharVariantFromDialogue(victoryMessages[0]),
                  )
                  .then(() => showMessage()),
              ); // TODO: is this bang correct?
          } else {
            showMessage();
          }
        } else {
          showMessageOrEnd();
        }
      },
      null,
      true,
    );

    this.showEnemyTrainer();
  }

  private unshiftModifierReward(modifierTypeFunc: ModifierTypeFunc): void {
    if (globalScene.twoPlayerMode) {
      globalScene.getActivePlayerIndexes()
        .slice()
        .reverse()
        .forEach(playerIndex => this.unshiftModifierRewardForPlayer(modifierTypeFunc, playerIndex));
      return;
    }

    globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypeFunc);
  }

  private unlockDawnZoruaComputerPartner(): void {
    const playerIndexes = globalScene.twoPlayerMode
      ? globalScene.getActivePlayerIndexes().filter(playerIndex => !globalScene.isComputerPartnerPlayer(playerIndex))
      : ([0] as PlayerIndex[]);

    playerIndexes.forEach(playerIndex => {
      const gameData = globalScene.getPlayerGameData(playerIndex);
      if (gameData.unlockComputerPartner("dawn_zorua")) {
        globalScene.savePlayerSystemSaveLocal(playerIndex);
      }
    });
  }

  private unshiftModifierRewardForPlayer(modifierTypeFunc: ModifierTypeFunc, playerIndex: PlayerIndex): void {
    globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypeFunc, playerIndex);
  }
}
