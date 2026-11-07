import type { MedicineCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { getModifierTypeFuncById } from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import { spendTrainerMedicine } from "#utils/enemy-trainer-medicine";
import i18next from "i18next";

export class EnemyMedicinePhase extends BattlePhase {
  public readonly phaseName = "EnemyMedicinePhase";

  constructor(private readonly actorId: number, private readonly medicine: MedicineCommand) {
    super();
  }

  start(): void {
    super.start();
    const trainer = globalScene.currentBattle.trainer;
    const actor = globalScene.getEnemyField(true).find(p => p.id === this.actorId);
    const target = globalScene.getEnemyParty().find(p => p.id === this.medicine.targetId);
    if (trainer && actor && target && spendTrainerMedicine(actor, target, this.medicine.typeId)) {
      globalScene.phaseManager.queueMessage(i18next.t("battle:medicineUsed", {
        context: "named",
        playerName: trainer.getName(trainer.getMedicineOwner(actor)),
        itemName: getModifierTypeFuncById(this.medicine.typeId)().name,
        pokemonName: target.getNameToRender(),
      }));
      if (target.isOnField()) {
        void target.updateInfo().then(() => this.end());
        return;
      }
    }
    this.end();
  }
}
