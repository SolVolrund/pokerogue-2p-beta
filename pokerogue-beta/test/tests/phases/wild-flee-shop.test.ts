import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Shop after wild enemies flee", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .moveset([MoveId.SPLASH, MoveId.ROAR])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.TELEPORT])
      .startingLevel(100)
      .enemyLevel(5);
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  it("opens a shop with no free rewards or bonus items after Teleport", async () => {
    game.override.startingHeldItems([{ name: "UNOWN_BOX" }]).startingModifier([{ name: "POKEBLOCK_KIT", count: 10 }]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");

    const ui = game.scene.ui.getHandler() as ModifierSelectUiHandler;
    expect(game.scene.ui.getMode()).toBe(UiMode.MODIFIER_SELECT);
    expect(ui.options).toHaveLength(0);
    expect(ui.alphTileOptions).toHaveLength(0);
    expect(ui.shopOptionsRows.flat().length).toBeGreaterThan(0);
    const phase = game.scene.phaseManager.getCurrentPhase();
    expect(phase.is("SelectModifierPhase") && phase.getRerollCost(false)).toBe(-1);
  });

  it("also opens the shop when the player forces the wild enemy out", async () => {
    game.override.enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    game.move.select(MoveId.ROAR);
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect((game.scene.ui.getHandler() as ModifierSelectUiHandler).options).toHaveLength(0);
  });

  it("opens the empty shop after Emergency Exit", async () => {
    game.override.enemyAbility(AbilityId.EMERGENCY_EXIT).enemyMoveset([MoveId.SPLASH]).moveset([MoveId.FALSE_SWIPE]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    game.move.select(MoveId.FALSE_SWIPE);
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(game.scene.currentBattle.enemyFaints).toBe(0);
    expect((game.scene.ui.getHandler() as ModifierSelectUiHandler).options).toHaveLength(0);
  });

  it("keeps free rewards when one enemy is defeated and the other uses Emergency Exit", async () => {
    game.override
      .battleStyle("double")
      .enemyAbility(AbilityId.EMERGENCY_EXIT)
      .enemyMoveset([MoveId.SPLASH])
      .moveset([MoveId.THUNDERBOLT, MoveId.FALSE_SWIPE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.BULBASAUR);
    game.move.select(MoveId.THUNDERBOLT, 0, 2);
    game.move.select(MoveId.SPLASH, 1);
    await game.toNextTurn();
    game.move.select(MoveId.FALSE_SWIPE, 0, 3);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("SelectModifierPhase");
    expect(game.scene.currentBattle.enemyFaints).toBe(1);
    expect((game.scene.ui.getHandler() as ModifierSelectUiHandler).options).toHaveLength(3);
  });

  it("the Run command bypasses the shop and resets its flag for the next battle", async () => {
    game.override.enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    vi.spyOn(activeOverrides, "RUN_SUCCESS_OVERRIDE", "get").mockReturnValue(true);
    const battle = game.scene.currentBattle;
    const phase = game.scene.phaseManager.getCurrentPhase();
    if (!phase.is("CommandPhase")) {
      throw new Error("Expected player command phase");
    }
    phase.handleCommand(Command.RUN, 0);
    await game.phaseInterceptor.to("NewBattlePhase");
    expect(battle.successfulRun).toBe(true);
    expect(game.scene.currentBattle.waveIndex).toBe(2);
    expect(game.scene.currentBattle.successfulRun).toBe(false);
  });

  it("clears the selected item's name when closing the reward menu", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    game.scene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
      guaranteedModifierTypeFuncs: [modifierTypes.POTION],
    });
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("SelectModifierPhase");
    const hideName = vi.spyOn(game.scene.ui.getMessageHandler(), "hideNameText");
    game.scene.ui.getHandler().clear();
    expect(hideName).toHaveBeenCalledOnce();
  });

  describe("reward routing", () => {
    beforeEach(async () => {
      await game.runToTitle();
      game.scene.configureTwoPlayerMode(false);
      game.scene.newBattle();
      game.scene.currentBattle.battleType = BattleType.WILD;
      vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    });

    function endBattle(victory = false) {
      const enqueue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
      new BattleEndPhase(victory).start();
      return enqueue.mock.calls.filter(call => call[0] === "SelectModifierPhase");
    }

    it.each([2, 3] as const)("queues one shop per player in a %i-player run", count => {
      game.scene.configureTwoPlayerMode(true, 6, false, count);
      expect(endBattle()).toEqual(
        Array.from({ length: count }, (_, player) => [
          "SelectModifierPhase",
          0,
          undefined,
          { fillRemaining: false, rerollMultiplier: -1, allowBonusRewards: false },
          false,
          player,
        ]),
      );
    });

    it("includes a slot-zero CPU in enemy-player mode", () => {
      game.scene.configureTwoPlayerMode(true, 6, true, 1, [0], false, true);
      expect(game.scene.isComputerPartnerPlayer(0)).toBe(true);
      expect(endBattle()).toEqual([
        [
          "SelectModifierPhase",
          0,
          undefined,
          { fillRemaining: false, rerollMultiplier: -1, allowBonusRewards: false },
          false,
          0,
        ],
      ]);
    });

    it("retains normal rewards if an enemy fainted before the other fled", () => {
      game.scene.currentBattle.enemyFaints = 1;
      expect(endBattle()).toEqual([["SelectModifierPhase", 0, undefined, undefined, false, 0]]);
    });

    it.each([0, 1])("does not open a shop after the player runs, even with %i earlier KOs", faints => {
      game.scene.currentBattle.successfulRun = true;
      game.scene.currentBattle.enemyFaints = faints;
      expect(endBattle()).toEqual([]);
    });

    it.each([
      2, 3,
    ] as const)("gives no player a reward after running from a partially defeated %i-player battle", count => {
      game.scene.configureTwoPlayerMode(true, 6, false, count);
      game.scene.currentBattle.successfulRun = true;
      game.scene.currentBattle.enemyFaints = 1;
      expect(endBattle()).toEqual([]);
    });

    it("does not duplicate already queued rewards", () => {
      game.scene.phaseManager.pushNew("SelectModifierPhase");
      expect(endBattle()).toEqual([]);
    });

    it("does not add rewards on top of the victory flow", () => {
      expect(endBattle(true)).toEqual([]);
    });

    it.each([BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER])("leaves battle type %i reward routing alone", type => {
      game.scene.currentBattle.battleType = type;
      expect(endBattle()).toEqual([]);
    });

    it("does not open a shop when the run is ending", () => {
      game.scene.phaseManager.pushNew("GameOverPhase", false);
      expect(endBattle()).toEqual([]);
    });
  });
});
