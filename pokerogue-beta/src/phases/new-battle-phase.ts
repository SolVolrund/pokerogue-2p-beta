import { globalScene } from "#app/global-scene";
import { BattlePhase } from "#phases/battle-phase";
import { BiomeId } from "#enums/biome-id";
import { ROCKET_HQ_FLOORS } from "#mystery-encounters/mystery-encounter-save-data";
import { isCrystalRecruitmentDue } from "#utils/crystal-recruitment";

export class NewBattlePhase extends BattlePhase {
  public readonly phaseName = "NewBattlePhase";
  start() {
    super.start();

    globalScene.phaseManager.removeAllPhasesOfType("NewBattlePhase");

    const hq = globalScene.mysteryEncounterSaveData.rocketHq;
    if (hq?.floor === ROCKET_HQ_FLOORS) {
      globalScene.mysteryEncounterSaveData.rocketHq = undefined;
      globalScene.phaseManager.unshiftNew("SwitchBiomePhase", hq.returnBiome);
      globalScene.phaseManager.unshiftNew("NewBattlePhase");
      this.end();
      return;
    }

    const tower = globalScene.seasonalEncounters.tower;
    if (tower?.completed) {
      globalScene.currentBattle.waveIndex = tower.returnWave - 1;
      globalScene.seasonalEncounters.tower = undefined;
      globalScene.phaseManager.unshiftNew("SwitchBiomePhase", BiomeId.RUINS);
      globalScene.phaseManager.unshiftNew("NewBattlePhase");
      this.end();
      return;
    }

    const recruits = tower || hq ? [] : globalScene.getActivePlayerIndexes().filter(isCrystalRecruitmentDue);
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
