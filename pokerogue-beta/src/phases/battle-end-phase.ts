import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { LapsingPersistentModifier, LapsingPokemonHeldItemModifier } from "#modifiers/modifier";
import { BattlePhase } from "#phases/battle-phase";

export class BattleEndPhase extends BattlePhase {
  public readonly phaseName = "BattleEndPhase";
  /** If true, will increment battles won */
  isVictory: boolean;

  constructor(isVictory: boolean) {
    super();

    this.isVictory = isVictory;
  }

  start() {
    super.start();

    // cull any extra `BattleEnd` phases from the queue.
    this.isVictory ||= globalScene.phaseManager.hasPhaseOfType(
      "BattleEndPhase",
      (phase: BattleEndPhase) => phase.isVictory,
    );
    globalScene.phaseManager.removeAllPhasesOfType("BattleEndPhase");

    globalScene.gameData.gameStats.battles++;
    if (
      globalScene.gameMode.isEndless
      && globalScene.currentBattle.waveIndex + 1 > globalScene.gameData.gameStats.highestEndlessWave
    ) {
      globalScene.gameData.gameStats.highestEndlessWave = globalScene.currentBattle.waveIndex + 1;
    }

    if (this.isVictory) {
      globalScene.currentBattle.addBattleScore();

      if (globalScene.currentBattle.trainer) {
        globalScene.gameData.gameStats.trainersDefeated++;
      }
    }

    // Endless graceful end
    if (globalScene.gameMode.isEndless && globalScene.currentBattle.waveIndex >= 5850) {
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.phaseManager.unshiftNew("GameOverPhase", true);
    }

    const playerIndexes = globalScene.twoPlayerMode
      ? globalScene.getActivePlayerIndexes()
      : [globalScene.activePlayerIndex];
    for (const playerIndex of playerIndexes) {
      for (const pokemon of globalScene.getPokemonAllowedInBattle(playerIndex)) {
        applyAbAttrs("PostBattleAbAttr", { pokemon, victory: this.isVictory });
      }
    }

    if (globalScene.currentBattle.moneyScattered) {
      globalScene.currentBattle.pickUpScatteredMoney();
    }

    globalScene.clearEnemyHeldItemModifiers();
    for (const p of globalScene.getEnemyParty()) {
      try {
        p.destroy();
      } catch {
        console.warn("Unable to destroy stale pokemon object in BattleEndPhase:", p);
      }
    }

    for (const playerIndex of playerIndexes) {
      const lapsingModifiers = globalScene.findModifiersForPlayer(
        m => m instanceof LapsingPersistentModifier || m instanceof LapsingPokemonHeldItemModifier,
        playerIndex,
      ) as (LapsingPersistentModifier | LapsingPokemonHeldItemModifier)[];
      for (const m of lapsingModifiers) {
        const args: unknown[] = [];
        if (m instanceof LapsingPokemonHeldItemModifier) {
          args.push(globalScene.getPokemonById(m.pokemonId));
        }
        if (!m.lapse(...args)) {
          globalScene.removeModifier(m, false, playerIndex);
        }
      }

      globalScene.updateModifiers(true, undefined, playerIndex);
    }
    this.end();
  }
}
