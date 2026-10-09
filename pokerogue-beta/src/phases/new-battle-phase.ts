import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { BiomeId } from "#enums/biome-id";
import { isCrystalRecruitmentDue } from "#utils/crystal-recruitment";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    const tower = globalScene.seasonalEncounters.tower;
    if (tower?.completed) {
      globalScene.currentBattle.waveIndex = tower.returnWave - 1;
      globalScene.seasonalEncounters.tower = undefined;
      globalScene.phaseManager.unshiftNew("SwitchBiomePhase", BiomeId.RUINS);
      globalScene.phaseManager.unshiftNew("NewBattlePhase");
      this.end();
      return;
    }

    const recruits = tower ? [] : globalScene.getActivePlayerIndexes().filter(isCrystalRecruitmentDue);
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
