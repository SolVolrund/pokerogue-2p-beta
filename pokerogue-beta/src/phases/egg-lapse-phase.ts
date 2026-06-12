import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import type { PlayerIndex } from "#app/battle-scene";
import type { Egg } from "#data/egg";
import { EGG_SEED } from "#data/egg";
import { EggHatchData } from "#data/egg-hatch-data";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { achvs } from "#system/achv";
import i18next from "i18next";

interface OwnedEgg {
  egg: Egg;
  playerIndex: PlayerIndex;
}

/**
 * Phase that handles updating eggs, and hatching any ready eggs
 * Also handles prompts for skipping animation, and calling the egg summary phase
 */
export class EggLapsePhase extends Phase {
  public readonly phaseName = "EggLapsePhase";
  private eggHatchData: EggHatchData[] = [];
  private readonly minEggsToSkip: number = 2;
  private restorePlayerIndex: PlayerIndex = 0;

  start() {
    super.start();
    this.restorePlayerIndex = globalScene.activePlayerIndex;
    const eggsToHatch = this.getEggsToHatch();
    const eggsToHatchCount: number = eggsToHatch.length;
    this.eggHatchData = [];

    if (eggsToHatchCount > 0) {
      if (eggsToHatchCount >= this.minEggsToSkip && globalScene.eggSkipPreference === 1) {
        globalScene.ui.showText(
          i18next.t("battle:eggHatching"),
          0,
          () => {
            // show prompt for skip, blocking inputs for 1 second
            globalScene.ui.showText(
              i18next.t("battle:eggSkipPrompt", {
                eggsToHatch: eggsToHatchCount,
              }),
              0,
            );
            globalScene.ui.setModeWithoutClear(
              UiMode.CONFIRM,
              () => {
                this.hatchEggsSkipped(eggsToHatch);
                this.showSummary();
              },
              () => {
                this.hatchEggsRegular(eggsToHatch);
                this.end();
              },
              null,
              null,
              null,
              1000,
              true,
            );
          },
          100,
          true,
        );
      } else if (eggsToHatchCount >= this.minEggsToSkip && globalScene.eggSkipPreference === 2) {
        globalScene.phaseManager.queueMessage(i18next.t("battle:eggHatching"));
        this.hatchEggsSkipped(eggsToHatch);
        this.showSummary();
      } else {
        // regular hatches, no summary
        globalScene.phaseManager.queueMessage(i18next.t("battle:eggHatching"));
        this.hatchEggsRegular(eggsToHatch);
        this.end();
      }
    } else {
      this.end();
    }
  }

  private getEggsToHatch(): OwnedEgg[] {
    const playerIndexes: PlayerIndex[] = globalScene.twoPlayerMode ? [0, 1] : [globalScene.activePlayerIndex];
    const eggsToHatch: OwnedEgg[] = [];

    for (const playerIndex of playerIndexes) {
      const gameData = globalScene.getPlayerGameData(playerIndex);
      for (const egg of gameData.eggs) {
        if (activeOverrides.EGG_IMMEDIATE_HATCH_OVERRIDE || --egg.hatchWaves < 1) {
          eggsToHatch.push({ egg, playerIndex });
        }
      }
    }

    return eggsToHatch;
  }

  restoreActivePlayer(): void {
    if (globalScene.twoPlayerMode) {
      globalScene.setActivePlayerIndex(this.restorePlayerIndex);
    }
  }

  override end(): void {
    this.restoreActivePlayer();
    super.end();
  }

  /**
   * Hatches eggs normally one by one, showing animations
   * @param eggsToHatch list of eggs to hatch
   */
  hatchEggsRegular(eggsToHatch: OwnedEgg[]) {
    let eggsToHatchCount: number = eggsToHatch.length;
    for (const ownedEgg of eggsToHatch) {
      globalScene.phaseManager.unshiftNew("EggHatchPhase", this, ownedEgg.egg, eggsToHatchCount, ownedEgg.playerIndex);
      eggsToHatchCount--;
    }
  }

  /**
   * Hatches eggs with no animations
   * @param eggsToHatch list of eggs to hatch
   */
  hatchEggsSkipped(eggsToHatch: OwnedEgg[]) {
    for (const ownedEgg of eggsToHatch) {
      this.hatchEggSilently(ownedEgg.egg, ownedEgg.playerIndex);
    }
  }

  showSummary() {
    globalScene.phaseManager.unshiftNew("EggSummaryPhase", this.eggHatchData);
    this.end();
  }

  /**
   * Hatches an egg and stores it in the local EggHatchData array without animations
   * Also validates the achievements for the hatched pokemon and removes the egg
   * @param egg egg to hatch
   */
  hatchEggSilently(egg: Egg, playerIndex: PlayerIndex) {
    if (globalScene.twoPlayerMode) {
      globalScene.setActivePlayerIndex(playerIndex);
    }

    const gameData = globalScene.getPlayerGameData(playerIndex);
    const eggIndex = gameData.eggs.findIndex(e => e.id === egg.id);
    if (eggIndex === -1) {
      return this.end();
    }
    gameData.eggs.splice(eggIndex, 1);

    const data = this.generatePokemon(egg);
    const pokemon = data.pokemon;
    if (pokemon.fusionSpecies) {
      pokemon.clearFusionSpecies();
    }

    if (pokemon.species.subLegendary) {
      globalScene.validateAchv(achvs.HATCH_SUB_LEGENDARY);
    }
    if (pokemon.species.legendary) {
      globalScene.validateAchv(achvs.HATCH_LEGENDARY);
    }
    if (pokemon.species.mythical) {
      globalScene.validateAchv(achvs.HATCH_MYTHICAL);
    }
    if (pokemon.isShiny()) {
      globalScene.validateAchv(achvs.HATCH_SHINY);
    }
    globalScene.savePlayerSystemSaveLocal(playerIndex);
  }

  /**
   * Generates a Pokemon and creates a new EggHatchData instance for the given egg
   * @param egg the egg to hatch
   * @returns the hatched PlayerPokemon
   */
  generatePokemon(egg: Egg): EggHatchData {
    let ret: PlayerPokemon;
    let newHatchData: EggHatchData;
    globalScene.executeWithSeedOffset(
      () => {
        ret = egg.generatePlayerPokemon();
        newHatchData = new EggHatchData(ret, egg.eggMoveIndex);
        newHatchData.setDex();
        this.eggHatchData.push(newHatchData);
      },
      egg.id,
      EGG_SEED.toString(),
    );
    return newHatchData!;
  }
}
