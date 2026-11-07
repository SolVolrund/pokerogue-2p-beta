import type { MedicineCommand } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { getBagMedicineType, useBagMedicine } from "#utils/item-bag";
import { getPlayerMessageOptions } from "#utils/player-messages";
import i18next from "i18next";

export class UseBagMedicinePhase extends BattlePhase {
  public readonly phaseName = "UseBagMedicinePhase";

  constructor(
    private readonly playerIndex: PlayerIndex,
    private readonly medicine: MedicineCommand,
  ) {
    super();
  }

  start(): void {
    super.start();
    const { typeId, targetId, moveIndex } = this.medicine;
    // Follow the selected individual through switches, not its old party or field slot.
    const target = globalScene.getPlayerParty(this.playerIndex).find(pokemon => pokemon.id === targetId);
    const item = globalScene.getPlayerBagMedicines(this.playerIndex).find(entry => entry.typeId === typeId);
    const type = item && getBagMedicineType(item);
    const used = !!target && !!item && useBagMedicine(this.playerIndex, target, item, moveIndex);
    globalScene.phaseManager.queueMessage(
      i18next.t(used ? "battle:medicineUsed" : "battle:medicineFailed", {
        ...getPlayerMessageOptions(this.playerIndex),
        itemName: type?.name ?? typeId,
        pokemonName: target?.getNameToRender() ?? "",
      }),
    );
    this.end();
  }
}
