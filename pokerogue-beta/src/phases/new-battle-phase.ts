import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { isCrystalRecruitmentDue } from "#utils/crystal-recruitment";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    const recruits = globalScene.getActivePlayerIndexes().filter(isCrystalRecruitmentDue);
    if (recruits.length > 0) {
      for (const playerIndex of recruits) {
        globalScene.phaseManager.unshiftNew("CrystalRecruitmentPhase", playerIndex);
      }
      globalScene.phaseManager.unshiftNew("NewBattlePhase");
      this.end();
      return;
    }

    globalScene.newBattle();

    this.end();
  }
}
