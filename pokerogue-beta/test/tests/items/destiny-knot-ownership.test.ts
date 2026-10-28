import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { DestinyKnotModifier } from "#modifiers/modifier";
import { type DestinyKnotModifierType, type ModifierTypeGenerator, ModifierTypeOption } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import { PartyOption, PartyUiHandler } from "#ui/party-ui-handler";
import { removeHeldItemForBattle, restoreBattleRemovedHeldItems } from "#utils/battle-held-items";
import { createCloneBallCopy, getCloneBallHeldItems, keepCloneBallCopy } from "#utils/clone-ball";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import * as soulBond from "#utils/soul-bond";
import { canReceiveThread, getAvailableThreadColors, THREAD_COLORS, type ThreadColor } from "#utils/soul-bond";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Items - Destiny Knot ownership", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.newBattle();
    for (const owner of [0, 1, 2] as const) {
      for (let index = 0; index < 2; index++) {
        const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50);
        game.scene.getPlayerParty(owner).push(pokemon);
      }
    }
    game.scene.setActivePlayerIndex(0);
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  const holder = (owner: PlayerIndex, index = 0) => game.scene.getPlayerParty(owner)[index];
  const ownedThreads = () =>
    game.scene
      .getActivePlayerIndexes()
      .flatMap(owner => game.scene.getPlayerModifiers(owner))
      .filter(soulBond.isDestinyKnot);

  function thread(pokemon: Pokemon, color: ThreadColor = "red") {
    const generator = modifierTypes.DESTINY_KNOT().withIdFromFunc(modifierTypes.DESTINY_KNOT) as ModifierTypeGenerator;
    const type = generator.generateType(game.scene.getPlayerParty(), [color]) as DestinyKnotModifierType;
    return type.newModifier(pokemon) as DestinyKnotModifier;
  }

  function addThread(pokemon: Pokemon, color: ThreadColor = "red") {
    const item = thread(pokemon, color);
    expect(
      game.scene.addModifier(item, true, false, false, true, undefined, game.scene.getPlayerIndexForPokemon(pokemon)),
    ).toBe(true);
    return item;
  }

  it("allows one thread, not one of each color, without substituting a failed grant", () => {
    const pokemon = holder(0);
    const original = addThread(pokemon);
    const messages = vi.spyOn(game.scene.phaseManager, "queueMessage");
    const achievements = vi.spyOn(game.scene, "validateAchvsForPlayer");
    for (const color of THREAD_COLORS) {
      const extra = thread(pokemon, color);
      expect(canReceiveThread(pokemon, color)).toBe(false);
      expect(extra.add(game.scene.getPlayerModifiers(0), false)).toBe(false);
      expect(game.scene.addModifier(extra, true, false, false, true, undefined, 0)).toBe(false);
    }
    expect(game.scene.getPlayerModifiers(0)).toEqual([original]);
    expect(messages).not.toHaveBeenCalled();
    expect(achievements).not.toHaveBeenCalled();
  });

  it("counts benched and fainted holders across all three allied parties", () => {
    addThread(holder(0, 1));
    addThread(holder(1));
    holder(1).hp = 0;
    expect(canReceiveThread(holder(2), "red")).toBe(false);
    expect(getAvailableThreadColors(game.scene.getPlayerParty(2))).not.toContain("red");
    expect(game.scene.addModifier(thread(holder(2)), true, false, false, true, undefined, 2)).toBe(false);
    addThread(holder(2), "blue");
    expect(ownedThreads().map(item => item.color)).toEqual(["red", "red", "blue"]);
  });

  it.each([0, 2])("rejects an incoming stack of %i without a substitute item", stackCount => {
    const item = thread(holder(0));
    item.stackCount = stackCount;
    expect(game.scene.addModifier(item, true)).toBe(false);
    expect(game.scene.getPlayerModifiers(0)).toHaveLength(0);
  });

  it("rejects a thread addressed to the wrong player's inventory", () => {
    expect(game.scene.addModifier(thread(holder(2)), true, false, false, true, undefined, 0)).toBe(false);
    expect(ownedThreads()).toHaveLength(0);
  });

  it("rejects enemy acquisition and both directions of an enemy transfer", async () => {
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
    game.scene.getEnemyParty().push(enemy);
    const enemyThread = thread(enemy, "blue");
    await game.scene.addEnemyModifier(enemyThread, true);
    expect(game.scene.addModifier(enemyThread, true)).toBe(false);
    expect(enemy.getHeldItems()).toHaveLength(0);
    const item = addThread(holder(0));
    expect(game.scene.canTransferHeldItemModifier(item, enemy)).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(item, enemy, false)).toBe(false);
    expect(holder(0).getHeldItems()).toEqual([item]);
    // Legacy/debug enemy inventories must not turn a forbidden transfer into a grant.
    game.scene["enemyModifiers"].push(enemyThread);
    expect(game.scene.canTransferHeldItemModifier(enemyThread, holder(1))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(enemyThread, holder(1), false)).toBe(false);
    expect(enemy.getHeldItems()).toEqual([enemyThread]);
    expect(holder(1).getHeldItems()).toHaveLength(0);
  });

  it("moves a thread between players at the color cap without counting the source twice", () => {
    const item = addThread(holder(0));
    addThread(holder(1));
    expect(canReceiveThread(holder(2), "red")).toBe(false);
    expect(game.scene.canTransferHeldItemModifier(item, holder(2))).toBe(true);
    expect(PartyUiHandler.FilterItemMaxStacks(holder(2), item)).toBeNull();
    expect(game.scene.tryTransferHeldItemModifier(item, holder(2), false)).toBe(true);
    expect(holder(0).getHeldItems()).toHaveLength(0);
    expect(holder(2).getHeldItems()).toMatchObject([{ color: "red", stackCount: 1 }]);
    expect(ownedThreads()).toHaveLength(2);
  });

  it.each(["red", "blue"] as const)("rejects transfers onto a %s holder before mutating either item", color => {
    const source = addThread(holder(0));
    const target = addThread(holder(1), color);
    expect(game.scene.canTransferHeldItemModifier(source, holder(1))).toBe(false);
    expect(PartyUiHandler.FilterItemMaxStacks(holder(1), source)).not.toBeNull();
    expect(game.scene.tryTransferHeldItemModifier(source, holder(1), false)).toBe(false);
    expect(holder(0).getHeldItems()).toEqual([source]);
    expect(holder(1).getHeldItems()).toEqual([target]);
    expect(source.stackCount).toBe(1);
    expect(target.stackCount).toBe(1);
  });

  it("does not permit a transfer back onto the same holder", () => {
    const item = addThread(holder(0));
    expect(game.scene.canTransferHeldItemModifier(item, holder(0))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(item, holder(0), false)).toBe(false);
    expect(holder(0).getHeldItems()).toEqual([item]);
  });

  it.each([
    true,
    false,
  ])("counts removed threads with reserveCapacity=%s and restores exactly once", reserveCapacity => {
    const original = addThread(holder(0));
    const other = addThread(holder(1));
    expect(removeHeldItemForBattle(holder(0), original)).toBe(true);
    holder(0).battleData.removedHeldItems[0].reserveCapacity = reserveCapacity;
    expect(canReceiveThread(holder(0), "blue")).toBe(false);
    expect(canReceiveThread(holder(2), "red")).toBe(false);
    expect(game.scene.addModifier(thread(holder(2)), true, false, false, true, undefined, 2)).toBe(false);
    expect(game.scene.canTransferHeldItemModifier(other, holder(0))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(other, holder(0), false)).toBe(false);
    expect(PartyUiHandler.FilterItemMaxStacks(holder(0), other)).not.toBeNull();
    restoreBattleRemovedHeldItems(holder(0));
    restoreBattleRemovedHeldItems(holder(0));
    expect(holder(0).battleData.removedHeldItems).toHaveLength(0);
    expect(holder(0).getHeldItems()).toMatchObject([{ color: "red", stackCount: 1 }]);
    expect(ownedThreads()).toHaveLength(2);
  });

  it("also validates recovered items through the modifier's add guard", () => {
    addThread(holder(0));
    addThread(holder(1));
    expect(game.scene.addRecoveredHeldItem(thread(holder(0), "blue"), holder(0))).toBe(false);
    expect(game.scene.addRecoveredHeldItem(thread(holder(2)), holder(2))).toBe(false);
    expect(ownedThreads()).toHaveLength(2);
  });

  it.each([1, 2])("keeps a Clone Ball copy without exceeding %i existing threads of its color", count => {
    addThread(holder(0));
    if (count === 2) {
      addThread(holder(1));
    }
    const copy = createCloneBallCopy(holder(0));
    const items = getCloneBallHeldItems(holder(0));
    vi.spyOn(game.scene.getPlayerGameData(2), "setPokemonCaught").mockResolvedValue(true);
    vi.spyOn(game.scene, "savePlayerSystemSave").mockResolvedValue(true);
    return keepCloneBallCopy(copy, items, 2).then(() => {
      expect(game.scene.getPlayerParty(2)).toContain(copy);
      expect(copy.getHeldItems()).toHaveLength(count === 1 ? 1 : 0);
      expect(ownedThreads()).toHaveLength(2);
      expect(holder(0).getHeldItems()).toMatchObject([{ color: "red", stackCount: 1 }]);
      expect(game.scene.getPlayerModifiers(2)).toHaveLength(count === 1 ? 1 : 0);
    });
  });

  it.each(THREAD_COLORS)("reconstructs the saved %s variant even when no new copy is available", color => {
    const item = addThread(holder(0), color);
    addThread(holder(1), color);
    const data = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(item, true))), true);
    const restored = data.toModifier(DestinyKnotModifier) as DestinyKnotModifier;
    expect(restored).toBeInstanceOf(DestinyKnotModifier);
    expect(restored.color).toBe(color);
    expect(restored.stackCount).toBe(1);
    expect((restored.type as DestinyKnotModifierType).getPregenArgs()).toEqual([color]);
    expect(game.scene.addModifier(restored, true)).toBe(false);
    expect(game.scene.removeModifier(item, false, 0)).toBe(true);
    expect(game.scene.addModifier(restored, true)).toBe(true);
    expect(ownedThreads()).toHaveLength(2);
  });

  it("preserves three-player ownership and removed-item claims through a session reload", async () => {
    addThread(holder(0));
    addThread(holder(2));
    const removed = addThread(holder(1), "sky");
    expect(removeHeldItemForBattle(holder(1), removed)).toBe(true);
    holder(1).battleData = new PokemonBattleData(JSON.parse(JSON.stringify(holder(1).battleData)));
    const save = game.scene.gameData.getSessionSaveData();
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    expect(ownedThreads().map(item => item.color)).toEqual(["red", "red"]);
    expect(holder(1).battleData.removedHeldItems).toHaveLength(1);
    expect(game.scene.addModifier(thread(holder(1, 1)), true, false, false, true, undefined, 1)).toBe(false);
    expect(game.scene.addModifier(thread(holder(1), "blue"), true, false, false, true, undefined, 1)).toBe(false);
    restoreBattleRemovedHeldItems(holder(1));
    expect(holder(1).getHeldItems()).toMatchObject([{ color: "sky", stackCount: 1 }]);
    expect(ownedThreads()).toHaveLength(3);
  });

  it("refreshes every party after modifier updates and direct thread removal", () => {
    const item = addThread(holder(0));
    addThread(holder(2));
    const refresh = vi.spyOn(soulBond, "refreshSoulBondHpForParties");
    game.scene.updateModifiers(true, true, 0);
    expect(refresh).toHaveBeenCalled();
    refresh.mockClear();
    expect(game.scene.removeModifier(item, false, 0)).toBe(true);
    expect(refresh).toHaveBeenCalledOnce();
    refresh.mockClear();
    expect(game.scene.removeModifier(item, false, 0)).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each([-1, 100])("returns a stale thread choice to the same reward menu at cost %i", async cost => {
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    const item = thread(holder(2));
    const options = [new ModifierTypeOption(item.type, 0)];
    phase["typeOptions"] = options;
    const callback = vi.fn(() => true);
    const modes = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    const partyMenu = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    vi.spyOn(game.scene, "waitForPlayerInput").mockImplementation(() => {});
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    const error = vi.spyOn(game.scene.ui, "playError").mockImplementation(() => {});
    phase["openModifierMenu"](item.type as DestinyKnotModifierType, cost, callback);
    const chooseRecipient = partyMenu.mock.calls[0][3] as (slot: number, option: PartyOption) => void;
    addThread(holder(0));
    addThread(holder(1));
    const money = game.scene.getPlayerMoney(2);
    chooseRecipient(0, PartyOption.APPLY);
    await vi.waitFor(() =>
      expect(modes.mock.calls.some(args => args[2] === options && args[3] === callback)).toBe(true),
    );
    expect(modes.mock.calls.at(-1)?.[0]).toBe(UiMode.MODIFIER_SELECT);
    expect(error).toHaveBeenCalledOnce();
    expect(shift).not.toHaveBeenCalled();
    expect(game.scene.getPlayerMoney(2)).toBe(money);
    expect(game.scene.getPlayerModifiers(2)).toHaveLength(0);
  });
});
