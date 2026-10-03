import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Trainer } from "#field/trainer";
import { TrainerVictoryPhase } from "#phases/trainer-victory-phase";
import { GameManager } from "#test/framework/game-manager";
import { trainerConfigs } from "#trainers/trainer-config";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("CPU unlocks from defeated trainer teams", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    game.scene.gameData.computerPartnerUnlocks = {};
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    vi.spyOn(game.scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
  });

  function win(primary: TrainerType, second?: TrainerType, third?: TrainerType): void {
    const trainer = new Trainer(
      primary,
      TrainerVariant.DEFAULT,
      undefined,
      undefined,
      undefined,
      trainerConfigs[primary],
      second,
      undefined,
      undefined,
      third,
    );
    game.scene.currentBattle.trainer = trainer;
    const phase = new TrainerVictoryPhase();
    vi.spyOn(phase, "showEnemyTrainer").mockImplementation(() => {});
    phase.start();
  }

  it.each([
    [TrainerType.BIANCA_LATIAS, undefined, undefined],
    [TrainerType.BIANCA, TrainerType.BIANCA_LATIAS, undefined],
    [TrainerType.BIANCA, TrainerType.ACE_TRAINER, TrainerType.BIANCA_LATIAS],
  ])("unlocks Bianca from the team %j / %j / %j", (primary, second, third) => {
    win(primary!, second, third);
    expect(game.scene.gameData.isComputerPartnerUnlocked("bianca_latias")).toBe(true);
    expect(game.scene.savePlayerSystemSaveLocal).toHaveBeenCalledWith(0);
  });

  it("unlocks each distinct special trainer on the defeated team", () => {
    win(TrainerType.DAWN_ZORUA, TrainerType.BIANCA_LATIAS, TrainerType.DUPLICA_DITTO);
    expect([...Object.keys(game.scene.gameData.computerPartnerUnlocks)].sort()).toEqual([
      "bianca_latias", "dawn_zorua", "duplica_ditto",
    ]);
  });

  it("processes a repeated trainer unlock only once", () => {
    const unlock = vi.spyOn(game.scene.gameData, "unlockComputerPartner");
    win(TrainerType.BIANCA_LATIAS, TrainerType.BIANCA_LATIAS, TrainerType.BIANCA_LATIAS);
    expect(unlock).toHaveBeenCalledExactlyOnceWith("bianca_latias");
    expect(game.scene.savePlayerSystemSaveLocal).toHaveBeenCalledTimes(1);
  });

  it("does not grant Bianca's special unlock for ordinary Bianca alone", () => {
    win(TrainerType.BIANCA);
    expect(game.scene.gameData.isComputerPartnerUnlocked("bianca_latias")).toBe(false);
    expect(game.scene.savePlayerSystemSaveLocal).not.toHaveBeenCalled();
  });

  it.each([false, true])("awards every human profile while skipping CPUs (CPU present: %s)", withCpu => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(index => withCpu && index === 2);
    for (const index of game.scene.getActivePlayerIndexes()) {
      game.scene.getPlayerGameData(index).computerPartnerUnlocks = {};
    }
    win(TrainerType.BIANCA, TrainerType.BIANCA_LATIAS);
    for (const index of game.scene.getActivePlayerIndexes()) {
      expect(game.scene.getPlayerGameData(index).isComputerPartnerUnlocked("bianca_latias"))
        .toBe(!withCpu || index !== 2);
    }
    expect(game.scene.savePlayerSystemSaveLocal).toHaveBeenCalledTimes(withCpu ? 2 : 3);
  });

  it("preserves an existing unlock without saving it again", () => {
    game.scene.gameData.computerPartnerUnlocks.bianca_latias = 123;
    win(TrainerType.BIANCA, TrainerType.BIANCA_LATIAS);
    expect(game.scene.gameData.computerPartnerUnlocks.bianca_latias).toBe(123);
    expect(game.scene.savePlayerSystemSaveLocal).not.toHaveBeenCalled();
  });
});
