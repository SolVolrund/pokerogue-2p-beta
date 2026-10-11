import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { audioManager } from "#app/global-audio-manager";
import { timedEventManager } from "#app/global-event-manager";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { ModifierTier } from "#enums/modifier-tier";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import type { PersistentModifier } from "#modifiers/modifier";
import type { ModifierTypeKeys } from "#modifiers/modifier-type";
import { ModifierRewardPhase } from "#phases/modifier-reward-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Timed event wave rewards", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.newBattle();
    game.scene.currentBattle.battleType = BattleType.WILD;
    game.scene.currentBattle.waveIndex = 115;
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(game.scene, "applyPartyExp").mockImplementation(() => {});
    vi.spyOn(audioManager, "playSound").mockReturnValue(null);
    vi.spyOn(game.scene.ui, "showText").mockImplementation((_text, _delay, callback) => callback?.());
    vi.spyOn(timedEventManager, "getFixedBattleEventRewards").mockReturnValue(["MEGA_BRACELET", "DYNAMAX_BAND"]);
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function win() {
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 5, TrainerSlot.NONE);
    enemy.hp = 0;
    game.scene.currentBattle.enemyParty = [enemy];
    const phase = new VictoryPhase(BattlerIndex.ENEMY);
    vi.spyOn(phase, "getPokemon").mockReturnValue(enemy);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    phase.start();
    return push.mock.calls;
  }

  function give(player: PlayerIndex, type: ModifierTypeFunc, count?: number) {
    const item = getModifierType(type).newModifier() as PersistentModifier;
    item.stackCount = count ?? item.getMaxStackCount();
    game.scene.getPlayerModifiers(player).push(item);
    return item;
  }

  it.each([8, 25, 55, 95, 115, 123, 145, 195])("checks scheduled rewards on floor %i", wave => {
    game.scene.currentBattle.waveIndex = wave;
    const calls = win();
    expect(timedEventManager.getFixedBattleEventRewards).toHaveBeenCalledExactlyOnceWith(wave);
    expect(calls.filter(call => call[0] === "ModifierRewardPhase")).toEqual([
      ["ModifierRewardPhase", modifierTypes.MEGA_BRACELET, undefined, true],
      ["ModifierRewardPhase", modifierTypes.DYNAMAX_BAND, undefined, true],
    ]);
    expect(calls.findIndex(call => call[0] === "ModifierRewardPhase")).toBeLessThan(
      calls.findIndex(call => call[0] === "SelectModifierPhase"),
    );
  });

  it("keeps the floor-165 Lock Capsule before event rewards and the shop", () => {
    game.scene.currentBattle.waveIndex = 165;
    const calls = win();
    expect(calls.filter(call => call[0] === "ModifierRewardPhase")).toEqual([
      ["ModifierRewardPhase", modifierTypes.LOCK_CAPSULE, undefined, false],
      ["ModifierRewardPhase", modifierTypes.MEGA_BRACELET, undefined, true],
      ["ModifierRewardPhase", modifierTypes.DYNAMAX_BAND, undefined, true],
    ]);
    expect(calls.findIndex(call => call[0] === "SelectModifierPhase")).toBeGreaterThan(
      calls.findLastIndex(call => call[0] === "ModifierRewardPhase"),
    );
  });

  it.each([GameModes.ENDLESS, GameModes.DAILY])("does not apply Classic event rewards in mode %i", mode => {
    game.scene.gameMode = getGameMode(mode);
    win();
    expect(timedEventManager.getFixedBattleEventRewards).not.toHaveBeenCalled();
  });

  it("does not grant calendar rewards when none are scheduled", () => {
    vi.mocked(timedEventManager.getFixedBattleEventRewards).mockReturnValue([]);
    expect(win().some(call => call[0] === "ModifierRewardPhase")).toBe(false);
  });

  it("does not repeat main-route event rewards on Pokemon Tower floors", () => {
    game.scene.seasonalEncounters.enterTower(115);
    const calls = win();
    expect(timedEventManager.getFixedBattleEventRewards).not.toHaveBeenCalled();
    expect(calls.some(call => call[0] === "ModifierRewardPhase")).toBe(false);
    expect(calls.some(call => call[0] === "SelectModifierPhase")).toBe(true);
  });

  it.each([2, 3] as const)("queues each event reward once per seat for %i players", count => {
    game.scene.configureTwoPlayerMode(true, 6, false, count);
    game.scene.twoPlayerEnemyPlayerMode = true;
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockReturnValue(true);
    expect(win().filter(call => call[0] === "ModifierRewardPhase")).toEqual(
      [modifierTypes.MEGA_BRACELET, modifierTypes.DYNAMAX_BAND].flatMap(type =>
        game.scene.getActivePlayerIndexes().map(player => ["ModifierRewardPhase", type, player, true]),
      ),
    );
  });

  it("uses each recipient's inventory, independently of the active player", async () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.setActivePlayerIndex(1);
    give(0, modifierTypes.MEGA_BRACELET);
    give(2, modifierTypes.DYNAMAX_BAND);
    const add = vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    for (const type of [modifierTypes.MEGA_BRACELET, modifierTypes.DYNAMAX_BAND]) {
      for (const player of game.scene.getActivePlayerIndexes()) {
        await new ModifierRewardPhase(type, player, true).doReward();
      }
    }
    expect(add.mock.calls.map(call => [call[0]?.type.id, call[6]])).toEqual([
      ["ROGUE_BALL", 0],
      ["MEGA_BRACELET", 1],
      ["MEGA_BRACELET", 2],
      ["DYNAMAX_BAND", 0],
      ["DYNAMAX_BAND", 1],
      ["ROGUE_BALL", 2],
    ]);
    expect(game.scene.activePlayerIndex).toBe(1);
  });

  it.each([
    [ModifierTier.COMMON, "POKEBALL"],
    [ModifierTier.GREAT, "GREAT_BALL"],
    [ModifierTier.ULTRA, "ULTRA_BALL"],
    [ModifierTier.ROGUE, "ROGUE_BALL"],
    [ModifierTier.MASTER, "MASTER_BALL"],
  ] as const)("replaces a full tier-%i reward with %s", async (tier, replacement) => {
    const item = give(0, modifierTypes.MEGA_BRACELET);
    vi.spyOn(item.type, "getOrInferTier").mockReturnValue(tier);
    const add = vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    await new ModifierRewardPhase(modifierTypes.MEGA_BRACELET, 0, true).doReward();
    expect(add.mock.calls[0][0]?.type.id).toBe(replacement);
    expect(vi.mocked(game.scene.ui.showText).mock.calls[0][0]).toContain(
      getModifierType(modifierTypes[replacement]).name,
    );
  });

  it("checks stacks at payout time, including earlier rewards in the same batch", async () => {
    const item = give(0, modifierTypes.SHINY_CHARM, 3);
    const rewards = [
      new ModifierRewardPhase(modifierTypes.SHINY_CHARM, 0, true),
      new ModifierRewardPhase(modifierTypes.SHINY_CHARM, 0, true),
    ];
    const add = vi.spyOn(game.scene, "addModifier");
    vi.spyOn(game.scene, "updateModifiers").mockImplementation(() => {});
    for (const reward of rewards) {
      await reward.doReward();
    }
    expect(item.stackCount).toBe(4);
    expect(add.mock.calls.map(call => call[0]?.type.id)).toEqual(["SHINY_CHARM", "MASTER_BALL"]);
  });

  it("keeps ordinary rewards on the existing reward path", async () => {
    give(0, modifierTypes.MEGA_BRACELET);
    const add = vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    await new ModifierRewardPhase(modifierTypes.MEGA_BRACELET, 0).doReward();
    expect(add.mock.calls[0][0]?.type.id).toBe("MEGA_BRACELET");
  });

  it.each([
    null,
    ModifierTier.LUXURY,
  ])("skips unsupported full stacks without losing later rewards (tier %s)", async tier => {
    const item = give(0, modifierTypes.MEGA_BRACELET);
    vi.spyOn(item.type, "getOrInferTier").mockReturnValue(tier);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const add = vi.spyOn(game.scene, "addModifier").mockReturnValue(true);
    const rewards: ModifierTypeKeys[] = ["MEGA_BRACELET", "DYNAMAX_BAND"];
    for (const reward of rewards) {
      await new ModifierRewardPhase(modifierTypes[reward], 0, true).doReward();
    }
    expect(warning).toHaveBeenCalledOnce();
    expect(add.mock.calls.map(call => call[0]?.type.id)).toEqual(["DYNAMAX_BAND"]);
  });
});
