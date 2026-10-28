import { PostBattleLootAbAttr } from "#abilities/ab-attrs";
import { Battle } from "#app/battle";
import { allMoves, modifierTypes } from "#data/data-lists";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import {
  type ContactHeldItemTransferChanceModifier,
  LaggingTailModifier,
  type PokemonHeldItemModifier,
  StickyBarbModifier,
} from "#modifiers/modifier";
import { SwitchHeldItemAttr } from "#moves/move";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import { restoreBattleRemovedHeldItems } from "#utils/battle-held-items";
import { createCloneBallCopy } from "#utils/clone-ball";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Battle-only held item recovery", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const junk = ["FLAME_ORB", "LAGGING_TAIL", "STICKY_BARBS"] as const;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 5,
      battleType: BattleType.WILD,
      double: true,
    });
    for (const owner of [0, 1] as const) {
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BUNEARY), 50);
      pokemon.abilityIndex = 1; // Klutz
      game.scene.getPlayerParty(owner).push(pokemon);
      game.scene.field.add(pokemon);
    }
    for (let i = 0; i < 2; i++) {
      const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
      game.scene.currentBattle.enemyParty.push(enemy);
      game.scene.field.add(enemy);
    }
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function addItem(pokemon: Pokemon, key: (typeof junk)[number] | "LEFTOVERS") {
    const type = modifierTypes[key]().withIdFromFunc(modifierTypes[key]);
    const item = type.newModifier(pokemon) as PokemonHeldItemModifier;
    if (pokemon.isPlayer()) {
      game.scene.addModifier(item, true, false, false, true, undefined, game.scene.getPlayerIndexForPokemon(pokemon));
    } else {
      void game.scene.addEnemyModifier(item, true, true);
    }
    return item;
  }

  function transferSequence(owner: 0 | 1 = 0) {
    const original = game.scene.getPlayerParty(owner)[0];
    const ally = game.scene.getPlayerParty(owner === 0 ? 1 : 0)[0];
    const enemy = game.scene.getEnemyParty()[0];
    junk.forEach(key => addItem(original, key));
    const switcheroo = new SwitchHeldItemAttr();
    expect(switcheroo.apply(original, enemy, allMoves[MoveId.SWITCHEROO], [])).toBe(true);
    expect(switcheroo.apply(original, enemy, allMoves[MoveId.SWITCHEROO], [])).toBe(true);
    const barb = original.getHeldItems().find(item => item instanceof StickyBarbModifier)! as StickyBarbModifier;
    expect(barb.apply(original, enemy, allMoves[MoveId.TACKLE])).toBe(true);

    const clawType = modifierTypes.GRIP_CLAW().withIdFromFunc(modifierTypes.GRIP_CLAW);
    const claw = clawType.newModifier(ally) as ContactHeldItemTransferChanceModifier;
    vi.spyOn(claw, "getTransferredItemCount").mockReturnValue(1);
    vi.spyOn(ally, "randBattleSeedInt").mockReturnValue(0);
    expect(claw.apply(ally, enemy)).toBe(true);
    const enemyBarb = enemy.getHeldItems().find(item => item instanceof StickyBarbModifier)! as StickyBarbModifier;
    expect(enemyBarb.apply(enemy, ally, allMoves[MoveId.TACKLE])).toBe(true);
    return { original, ally, enemy };
  }

  function finishBattle() {
    const phase = new BattleEndPhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.start();
  }

  function expectRecovered(original: Pokemon, ally: Pokemon) {
    expect(
      original
        .getHeldItems()
        .map(item => item.type.id)
        .sort(),
    ).toEqual([...junk]);
    expect(original.getHeldItems().every(item => item.stackCount === 1 && !item.recoverableBattleTransfer)).toBe(true);
    expect(ally.getHeldItems()).toHaveLength(0);
    expect(game.scene.findModifiers(() => true, false)).toHaveLength(0);
  }

  it.each([
    0, 1,
  ] as const)("returns Switcheroo, Grip Claw and contact transfers to player %i after enemy cleanup", owner => {
    const { original, ally, enemy } = transferSequence(owner);
    enemy.hp = 0;
    game.scene.currentBattle.addPostBattleLoot(enemy);
    game.scene.updateModifiers(false, true);
    expect(game.scene.currentBattle.postBattleLoot).toHaveLength(0);
    expect(enemy.getHeldItems().map(item => item.type.id)).toEqual(["LAGGING_TAIL"]);
    expect(game.scene.getEnemyParty()[1].isFainted()).toBe(false);
    finishBattle();
    expectRecovered(original, ally);
  });

  it("returns Sticky Barb even after it bounces back to the enemy before fainting", () => {
    const { original, ally, enemy } = transferSequence();
    const barb = ally.getHeldItems().find(item => item instanceof StickyBarbModifier)! as StickyBarbModifier;
    expect(barb.apply(ally, enemy, allMoves[MoveId.TACKLE])).toBe(true);
    enemy.hp = 0;
    game.scene.currentBattle.addPostBattleLoot(enemy);
    game.scene.updateModifiers(false, true);
    finishBattle();
    expectRecovered(original, ally);
  });

  it.each([false, true])("recovers legacy loot exactly once, with its inventory alias present=%s", keepAlias => {
    const { original, ally, enemy } = transferSequence();
    const tail = enemy.getHeldItems()[0];
    tail.pokemonId = -1;
    game.scene.currentBattle.postBattleLoot.push(tail, tail);
    if (!keepAlias) {
      game.scene.updateModifiers(false, true);
    }
    game.scene.recoverBattleTransferredHeldItems([0, 1]);
    game.scene.recoverBattleTransferredHeldItems([0, 1]);
    expect(game.scene.currentBattle.postBattleLoot).toHaveLength(0);
    expectRecovered(original, ally);
  });

  it("clears an already-returned loot alias without leaving later loot recoveries behind", () => {
    const { original, ally, enemy } = transferSequence();
    const orb = ally.getHeldItems().find(item => item.type.id === "FLAME_ORB")!;
    expect(game.scene.tryTransferHeldItemModifier(orb, original, false)).toBe(true);
    const returned = original.getHeldItems()[0];
    returned.recoverableBattleTransfer = { pokemonId: original.id, playerIndex: 0 };
    const tail = enemy.getHeldItems()[0];
    game.scene.currentBattle.postBattleLoot.push(returned, tail);
    game.scene.recoverBattleTransferredHeldItems([0, 1]);
    expect(game.scene.currentBattle.postBattleLoot).toHaveLength(0);
    expectRecovered(original, ally);
  });

  it("keeps ordinary enemy loot eligible for Pickup while excluding borrowed items", () => {
    const { original, ally, enemy } = transferSequence();
    const tail = enemy.getHeldItems()[0];
    const leftovers = addItem(enemy, "LEFTOVERS");
    game.scene.currentBattle.addPostBattleLoot(enemy);
    expect(game.scene.currentBattle.postBattleLoot).toEqual([leftovers]);
    game.scene.currentBattle.postBattleLoot.push(tail); // Legacy mixed loot pool.
    const pickup = new PostBattleLootAbAttr();
    expect(pickup.canApply({ pokemon: ally, victory: true })).toBe(true);
    pickup.apply({ pokemon: ally, victory: true });
    expect(ally.getHeldItems().some(item => item.type.id === "LEFTOVERS")).toBe(true);
    expect(pickup.canApply({ pokemon: ally, victory: true })).toBe(false);
    pickup.apply({ pokemon: ally, victory: true });
    game.scene.recoverBattleTransferredHeldItems([0, 1]);
    expect(
      original
        .getHeldItems()
        .map(item => item.type.id)
        .sort(),
    ).toEqual([...junk]);
    expect(game.scene.currentBattle.postBattleLoot).toHaveLength(0);
  });

  it("leaves ally-held loans alone during enemy-only recovery", () => {
    const { original, ally, enemy } = transferSequence();
    game.scene.currentBattle.addPostBattleLoot(enemy);
    game.scene.recoverBattleTransferredHeldItems([0, 1], true);
    expect(original.getHeldItems().map(item => item.type.id)).toEqual(["LAGGING_TAIL"]);
    expect(ally.getHeldItems()).toHaveLength(2);
    game.scene.recoverBattleTransferredHeldItems([0, 1]);
    expectRecovered(original, ally);
  });

  it.each([0, 1, 2] as const)("lets player %i pick up detached loot without taking another player's loan", owner => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const third = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BUNEARY), 50);
    game.scene.getPlayerParty(2).push(third);
    game.scene.field.add(third);
    for (const index of [0, 1, 2] as const) {
      game.field.mockAbility(game.scene.getPlayerParty(index)[0], AbilityId.BALL_FETCH);
    }
    const original = game.scene.getPlayerParty(0)[0];
    const collector = game.scene.getPlayerParty(owner)[0];
    game.field.mockAbility(collector, AbilityId.PICKUP);
    const enemy = game.scene.getEnemyParty()[0];
    const tail = addItem(original, "LAGGING_TAIL");
    expect(game.scene.tryTransferHeldItemModifier(tail, enemy, false)).toBe(true);
    const loan = enemy.getHeldItems()[0];
    const loot = addItem(enemy, "LEFTOVERS");
    game.scene.currentBattle.addPostBattleLoot(enemy);
    expect(game.scene.removeModifier(loot, true)).toBe(true);
    // Capturing the other enemy can leave a stale holder on an item no longer in its inventory.
    loot.pokemonId = enemy.id;
    game.scene.currentBattle.postBattleLoot.push(loan);
    expect(game.scene.canTransferHeldItemModifier(loot, collector)).toBe(false);

    finishBattle();

    expect(collector.getHeldItems().filter(item => item.type.id === "LEFTOVERS")).toHaveLength(1);
    const recovered = original.getHeldItems().filter(item => item.type.id === "LAGGING_TAIL");
    expect(recovered).toHaveLength(1);
    expect(recovered[0].recoverableBattleTransfer).toBeUndefined();
    expect(game.scene.currentBattle.postBattleLoot).toHaveLength(0);
    expect(game.scene.findModifiers(() => true, false)).toHaveLength(0);
    for (const index of [0, 1, 2] as const) {
      if (index !== owner) {
        expect(
          game.scene
            .getPlayerParty(index)[0]
            .getHeldItems()
            .some(item => item.type.id === "LEFTOVERS"),
        ).toBe(false);
      }
    }
  });

  it("preserves ownership when a recovery attempt fails, then restores without duplication", () => {
    const { original, ally } = transferSequence();
    const restore = vi.spyOn(game.scene, "addRecoveredHeldItem").mockReturnValue(false);
    const addReward = vi.spyOn(game.scene, "addModifier");
    game.scene.recoverBattleTransferredHeldItems([0, 1]);
    game.scene.clearEnemyHeldItemModifiers();
    expect(addReward).not.toHaveBeenCalled();
    expect(original.battleData.removedHeldItems).toHaveLength(3);
    expect(original.getHeldItems()).toHaveLength(0);
    expect(ally.getHeldItems()).toHaveLength(0);
    restore.mockRestore();
    restoreBattleRemovedHeldItems(original);
    restoreBattleRemovedHeldItems(original);
    expectRecovered(original, ally);
  });

  it("keeps a full-slot return across cleanup, save loading and arena resets without erasing the replacement", () => {
    const { original, ally } = transferSequence();
    const replacement = addItem(original, "LAGGING_TAIL");
    finishBattle();
    expectRecovered(original, ally);
    expect(original.battleData.removedHeldItems).toHaveLength(1);
    expect(replacement.getMaxStackCount()).toBe(1);
    const clone = createCloneBallCopy(original);
    expect(clone.battleData.removedHeldItems).toHaveLength(0);
    clone.destroy();
    const savedData = new PokemonBattleData(JSON.parse(JSON.stringify(original.battleData)));
    const savedItem = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(replacement, true))), true);
    expect(savedItem.toModifier(LaggingTailModifier)?.stackCount).toBe(1);
    original.battleData = savedData;
    original.resetBattleAndWaveData();
    expect(original.battleData.removedHeldItems).toHaveLength(1);
    expect(game.scene.removeModifier(replacement, false, 0)).toBe(true);
    restoreBattleRemovedHeldItems(original);
    expect(original.battleData.removedHeldItems).toHaveLength(0);
    expectRecovered(original, ally);
  });
});
