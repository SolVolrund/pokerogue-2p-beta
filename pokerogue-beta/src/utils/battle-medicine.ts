import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";

/** Pending actions reserve inventory without consuming it during command selection. */
export function getAvailableBattleMedicineCount(
  playerIndex: PlayerIndex,
  typeId: string,
  replacingBattler?: BattlerIndex,
): number {
  const quantity = globalScene.getPlayerBagMedicines(playerIndex).find(item => item.typeId === typeId)?.quantity ?? 0;
  const reserved = Object.entries(globalScene.currentBattle.turnCommands).filter(
    ([battler, command]) =>
      Number(battler) !== replacingBattler
      && command?.command === Command.MEDICINE
      && !command.skip
      && command.playerIndex === playerIndex
      && command.medicine?.typeId === typeId,
  ).length;
  return Math.max(0, quantity - reserved);
}
