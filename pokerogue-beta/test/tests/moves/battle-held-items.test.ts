import { PostTurnRestoreBerryAbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import { PokemonBattleData } from "#data/pokemon/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier, type PokemonHeldItemModifier, TypeGemModifier } from "#modifiers/modifier";
import { AttemptCapturePhase } from "#phases/attempt-capture-phase";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import {
  getConsumedHeldItems,
  getRecycleItemIndex,
  recordConsumedHeldItem,
  removeHeldItemForBattle,
  restoreBattleRemovedHeldItems,
  restoreConsumedHeldItem,
} from "#utils/battle-held-items";
import { consumeBerryModifier } from "#utils/berry-use-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Moves - Recycle and battle-only item removal", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const count = (pokemon: Pokemon, id: string) =>
    pokemon
      .getHeldItems()
      .filter(item => item.type.id === id)
      .reduce((sum, item) => sum + item.stackCount, 0);

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .criticalHits(false)
      .moveset([MoveId.RECYCLE, MoveId.CORROSIVE_GAS, MoveId.EMBER, MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    game.scene.twoPlayerMode = false;
    vi.restoreAllMocks();
  });

  it("enemy Knock Off removes one player item unit and returns it after victory", async () => {
    game.override.startingHeldItems([{ name: "LEFTOVERS", count: 2 }]).enemyMoveset(MoveId.KNOCK_OFF);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(count(player, "LEFTOVERS")).toBe(1);
    expect(player.battleData.removedHeldItems).toHaveLength(1);
    expect(getRecycleItemIndex(player)).toBe(-1);
    vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    new BattleEndPhase(true).start();
    expect(count(player, "LEFTOVERS")).toBe(2);
    expect(player.battleData.removedHeldItems).toEqual([]);
  });

  it("Gas affects adjacent allies and enemies, not the user, and deals no damage", async () => {
    game.override
      .battleStyle("double")
      .startingHeldItems([{ name: "LEFTOVERS", count: 2 }])
      .enemyHeldItems([{ name: "LEFTOVERS", count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.FEEBAS);
    const user = game.field.getPlayerPokemon();
    const others = game.scene.getField(true).filter(pokemon => pokemon !== user);
    const allyItem = user.getHeldItems()[0].clone() as PokemonHeldItemModifier;
    allyItem.pokemonId = others[0].id;
    game.scene.addModifier(allyItem, true);
    const hp = others.map(pokemon => pokemon.hp);
    game.move.select(MoveId.CORROSIVE_GAS, BattlerIndex.PLAYER);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toNextTurn();
    expect(count(user, "LEFTOVERS")).toBe(2);
    expect(others.map(pokemon => count(pokemon, "LEFTOVERS"))).toEqual([1, 1, 1]);
    expect(others.map(pokemon => pokemon.hp)).toEqual(hp);
  });

  for (const move of [MoveId.KNOCK_OFF, MoveId.CORROSIVE_GAS]) {
    it(`${MoveId[move]} respects Sticky Hold`, async () => {
      game.override
        .ability(AbilityId.STICKY_HOLD)
        .enemyMoveset(move)
        .startingHeldItems([{ name: "LEFTOVERS" }]);
      await game.classicMode.startBattle(SpeciesId.CHARMANDER);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(count(game.field.getPlayerPokemon(), "LEFTOVERS")).toBe(1);
      expect(game.field.getPlayerPokemon().battleData.removedHeldItems).toEqual([]);
    });
  }

  it("Gas respects Protect and leaves nontransferable investments alone", async () => {
    game.override
      .moveset([MoveId.PROTECT])
      .enemyMoveset(MoveId.CORROSIVE_GAS)
      .startingHeldItems([{ name: "LEFTOVERS" }, { name: "BASE_STAT_BOOSTER", type: Stat.ATK }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    game.move.select(MoveId.PROTECT);
    await game.toNextTurn();
    expect(player.getHeldItems()).toHaveLength(2);
    const leftovers = player.getHeldItems().find(item => item.type.id === "LEFTOVERS")!;
    removeHeldItemForBattle(player, leftovers);
    expect(allMoves[MoveId.CORROSIVE_GAS].applyConditions(game.field.getEnemyPokemon(), player, -1)).toBe(false);
  });

  it("temporarily removed items stay absent through switching and restore after escape", async () => {
    game.override.startingHeldItems([{ name: "IRON_BALL" }]);
    await game.classicMode.startBattle(SpeciesId.PIDGEOT);
    const player = game.field.getPlayerPokemon();
    expect(player.isGrounded()).toBe(true);
    removeHeldItemForBattle(player, player.getHeldItems()[0]);
    player.resetSummonData();
    expect(player.isGrounded()).toBe(false);
    expect(player.battleData.removedHeldItems).toHaveLength(1);
    vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    new BattleEndPhase(false).start();
    expect(count(player, "IRON_BALL")).toBe(1);
    expect(player.isGrounded()).toBe(true);
  });

  it("restores only removed units, not genuinely consumed berries", async () => {
    game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const berry = player.getHeldItems()[0] as BerryModifier;
    removeHeldItemForBattle(player, berry);
    consumeBerryModifier(player, berry, { trigger: "turn-end" }, { animate: false });
    expect(count(player, "BERRY")).toBe(0);
    restoreBattleRemovedHeldItems(player);
    expect(count(player, "BERRY")).toBe(1);
    expect(getConsumedHeldItems(player)).toHaveLength(1);
  });

  it("reserves stack capacity and restores repeated removals exactly once", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE, count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.FEEBAS);
    const [player, donor] = game.scene.getPlayerParty();
    const gem = player.getHeldItems()[0];
    const donorGem = gem.clone() as PokemonHeldItemModifier;
    donorGem.pokemonId = donor.id;
    game.scene.addModifier(donorGem, true);
    for (let i = 0; i < 3; i++) {
      expect(removeHeldItemForBattle(player, gem)).toBe(true);
    }
    expect(removeHeldItemForBattle(player, gem)).toBe(false);
    expect(game.scene.canTransferHeldItemModifier(donorGem, player)).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(donorGem, player, false)).toBe(false);
    expect(count(donor, "TYPE_GEM")).toBe(3);
    restoreBattleRemovedHeldItems(player);
    restoreBattleRemovedHeldItems(player);
    expect(count(player, "TYPE_GEM")).toBe(3);
  });

  it("counts saved reservations by item variant without changing state or RNG", async () => {
    game.override.startingHeldItems([
      { name: "TYPE_GEM", type: PokemonType.FIRE, count: 3 },
      { name: "TYPE_GEM", type: PokemonType.WATER, count: 3 },
    ]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const fireGem = player
      .getHeldItems()
      .find(item => item instanceof TypeGemModifier && item.moveType === PokemonType.FIRE)!;
    const waterGem = player
      .getHeldItems()
      .find(item => item instanceof TypeGemModifier && item.moveType === PokemonType.WATER)!;
    expect(removeHeldItemForBattle(player, fireGem)).toBe(true);
    player.battleData = new PokemonBattleData(JSON.parse(JSON.stringify(player.battleData)));
    const before = JSON.stringify(player.battleData);
    const seed = Phaser.Math.RND.state();
    const battleSeed = game.scene.currentBattle["battleSeedState"];

    for (let i = 0; i < 2; i++) {
      expect(player.getReservedHeldItemCount(fireGem)).toBe(1);
      expect(player.getReservedHeldItemCount(waterGem)).toBe(0);
      expect(fireGem.getMaxStackCount()).toBe(2);
      expect(waterGem.getMaxStackCount()).toBe(3);
    }
    expect(JSON.stringify(player.battleData)).toBe(before);
    expect(Phaser.Math.RND.state()).toBe(seed);
    expect(game.scene.currentBattle["battleSeedState"]).toBe(battleSeed);
  });

  it("restores a transferred Klutz item to its original owner", async () => {
    game.override.startingHeldItems([{ name: "STICKY_BARBS" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    expect(game.scene.tryTransferHeldItemModifier(player.getHeldItems()[0], enemy, false)).toBe(true);
    removeHeldItemForBattle(enemy, enemy.getHeldItems()[0]);
    expect(player.battleData.removedHeldItems).toHaveLength(1);
    expect(enemy.battleData.removedHeldItems).toEqual([]);
    restoreBattleRemovedHeldItems(player);
    expect(count(player, "STICKY_BARBS")).toBe(1);
    expect(count(enemy, "STICKY_BARBS")).toBe(0);
  });

  it("preserves Fling recovery using the same serializable records", async () => {
    game.override.startingHeldItems([{ name: "IRON_BALL" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    expect(game.scene.tryFlingHeldItemModifier(player.getHeldItems()[0], player, true)).toBe(true);
    player.battleData = new PokemonBattleData(JSON.parse(JSON.stringify(player.battleData)));
    restoreBattleRemovedHeldItems(player);
    expect(count(player, "IRON_BALL")).toBe(1);
  });

  it("uses the owning player's inventory even when another player is active", async () => {
    game.override.startingHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.FEEBAS);
    const party = game.scene.getPlayerParty();
    const second = party[1];
    const item = party[0].getHeldItems()[0].clone() as PokemonHeldItemModifier;
    item.pokemonId = second.id;
    game.scene.addModifier(item, true);
    const modifiers = game.scene.getPlayerModifiers();
    modifiers.splice(modifiers.indexOf(item), 1);
    party.pop();
    game.scene.twoPlayerMode = true;
    game.scene.multiplayerPlayerCount = 2;
    game.scene.players[1].party = [second];
    game.scene.players[1].modifiers = [item];
    expect(game.scene.activePlayerIndex).toBe(0);
    expect(removeHeldItemForBattle(second, item)).toBe(true);
    expect(game.scene.getPlayerModifiers(1)).toEqual([]);
    expect(count(party[0], "LEFTOVERS")).toBe(1);
    restoreBattleRemovedHeldItems(second);
    expect(count(second, "LEFTOVERS")).toBe(1);
    expect(count(party[0], "LEFTOVERS")).toBe(1);
  });

  it("Gas still hits opponents when its first adjacent ally has no item", async () => {
    game.override.battleStyle("double").enemyHeldItems([{ name: "LEFTOVERS", count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.FEEBAS);
    game.move.select(MoveId.CORROSIVE_GAS, BattlerIndex.PLAYER);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toNextTurn();
    expect(game.scene.getEnemyField().map(pokemon => count(pokemon, "LEFTOVERS"))).toEqual([1, 1]);
  });

  it("session snapshots retain both missing equipment and consumed-item history", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE, count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const gem = player.getHeldItems()[0];
    player.loseHeldItem(gem);
    recordConsumedHeldItem(player, gem);
    removeHeldItemForBattle(player, gem);
    const snapshot = JSON.stringify(game.scene.gameData.getSessionSaveData());
    await game.scene.gameData.loadSessionSnapshot(snapshot);
    const restoredPlayer = game.scene.getPlayerParty()[0];
    expect(count(restoredPlayer, "TYPE_GEM")).toBe(0);
    expect(restoredPlayer.battleData.removedHeldItems).toHaveLength(1);
    expect(getRecycleItemIndex(restoredPlayer)).toBe(0);
    restoreBattleRemovedHeldItems(restoredPlayer);
    restoreConsumedHeldItem(restoredPlayer, getRecycleItemIndex(restoredPlayer));
    expect(count(restoredPlayer, "TYPE_GEM")).toBe(2);
  });

  it("Recycle restores a used gem without consuming other held items", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE }, { name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    game.move.select(MoveId.EMBER);
    await game.toNextTurn();
    expect(count(player, "TYPE_GEM")).toBe(0);
    expect(getConsumedHeldItems(player)).toHaveLength(1);
    game.move.select(MoveId.RECYCLE);
    await game.toNextTurn();
    expect(count(player, "TYPE_GEM")).toBe(1);
    expect(count(player, "LEFTOVERS")).toBe(1);
    expect(getRecycleItemIndex(player)).toBe(-1);
  });

  it("Recycle fails without consumed items and ignores Reviver Seeds", async () => {
    game.override.startingHeldItems([{ name: "REVIVER_SEED" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const seed = player.getHeldItems()[0];
    player.loseHeldItem(seed);
    recordConsumedHeldItem(player, seed);
    expect(getConsumedHeldItems(player)).toEqual([]);
    expect(allMoves[MoveId.RECYCLE].applyConditions(player, player, -1)).toBe(false);
  });

  it("Recycle selects the newest eligible consumption and respects reservations", async () => {
    game.override.startingHeldItems([
      { name: "BERRY", type: BerryType.SITRUS, count: 2 },
      { name: "TYPE_GEM", type: PokemonType.FIRE, count: 3 },
    ]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const berry = player.getHeldItems().find(item => item instanceof BerryModifier) as BerryModifier;
    consumeBerryModifier(player, berry, { trigger: "turn-end" }, { animate: false });
    const gem = player.getHeldItems().find(item => item.type.id === "TYPE_GEM")!;
    player.loseHeldItem(gem);
    recordConsumedHeldItem(player, gem);
    const restored = restoreConsumedHeldItem(player, getRecycleItemIndex(player));
    expect(restored?.type.id).toBe("TYPE_GEM");
    removeHeldItemForBattle(player, gem);
    expect(restoreConsumedHeldItem(player, getRecycleItemIndex(player))?.type.id).toBe("BERRY");
    expect(getRecycleItemIndex(player)).toBe(-1);
    restoreBattleRemovedHeldItems(player);
    expect(count(player, "TYPE_GEM")).toBe(3);
  });

  it("Harvest and Recycle cannot restore the same consumed berry twice", async () => {
    game.override.startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    consumeBerryModifier(
      player,
      player.getHeldItems()[0] as BerryModifier,
      { trigger: "turn-end" },
      { animate: false },
    );
    restoreConsumedHeldItem(player, getRecycleItemIndex(player));
    const harvest = new PostTurnRestoreBerryAbAttr(() => 1);
    expect(harvest.canApply({ pokemon: player })).toBe(false);
    expect(player.battleData.berriesEaten).toEqual([]);
    expect(count(player, "BERRY")).toBe(1);
  });

  it("Harvest removes the correct history entry when an earlier berry is capped", async () => {
    game.override.startingHeldItems([{ name: "BERRY", type: BerryType.LUM, count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    player.battleData.berriesEaten = [BerryType.LUM, BerryType.STARF];
    const harvest = new PostTurnRestoreBerryAbAttr(() => 1);
    expect(harvest.canApply({ pokemon: player })).toBe(true);
    harvest.apply({ pokemon: player, simulated: false });
    expect(player.battleData.berriesEaten).toEqual([BerryType.LUM]);
    expect(getConsumedHeldItems(player)).toHaveLength(1);
    expect(harvest.canApply({ pokemon: player })).toBe(false);
  });

  it("White Herb consumption is recoverable", async () => {
    game.override.moveset([MoveId.SHELL_SMASH, MoveId.RECYCLE]).startingHeldItems([{ name: "WHITE_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    game.move.select(MoveId.SHELL_SMASH);
    await game.toNextTurn();
    expect(count(player, "WHITE_HERB")).toBe(0);
    expect(getRecycleItemIndex(player)).toBeGreaterThanOrEqual(0);
    game.move.select(MoveId.RECYCLE);
    await game.toNextTurn();
    expect(count(player, "WHITE_HERB")).toBe(1);
  });

  it("Mirror Herb consumption is recoverable", async () => {
    game.override.enemyMoveset(MoveId.HOWL).startingHeldItems([{ name: "MIRROR_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(count(player, "MIRROR_HERB")).toBe(0);
    expect(restoreConsumedHeldItem(player, getRecycleItemIndex(player))?.type.id).toBe("MIRROR_HERB");
  });

  it("embargoed items can be recovered but their effects remain suppressed", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const gem = player.getHeldItems()[0];
    player.loseHeldItem(gem);
    recordConsumedHeldItem(player, gem);
    player.addTag(BattlerTagType.EMBARGO, 5, MoveId.EMBARGO, player.id);
    expect(restoreConsumedHeldItem(player, getRecycleItemIndex(player))).toBeDefined();
    expect(count(player, "TYPE_GEM")).toBe(1);
    expect(player.getActiveHeldItems()).toEqual([]);
  });

  it("serializes independent histories and includes both in multiplayer fingerprints", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE, count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const gem = player.getHeldItems()[0];
    player.loseHeldItem(gem);
    recordConsumedHeldItem(player, gem);
    removeHeldItemForBattle(player, gem);
    const saved = new PokemonData(player);
    const loaded = new PokemonBattleData(JSON.parse(JSON.stringify(saved.battleData)));
    expect(loaded).toEqual(player.battleData);
    expect(loaded.removedHeldItems).not.toBe(player.battleData.removedHeldItems);
    player.battleData = loaded;
    game.scene.twoPlayerMode = true;
    const checkpoint = () => game.scene.getTwoPlayerDebugStateCheckpoint()!.fingerprint;
    const before = checkpoint();
    loaded.removedHeldItems[0].waveIndex++;
    expect(checkpoint()).not.toBe(before);
    const after = checkpoint();
    loaded.consumedHeldItems![0].waveIndex++;
    expect(checkpoint()).not.toBe(after);
    loaded.consumedHeldItems![0].waveIndex--;
    restoreBattleRemovedHeldItems(player);
    restoreConsumedHeldItem(player, getRecycleItemIndex(player));
    expect(count(player, "TYPE_GEM")).toBe(2);
  });

  it("Recycle only uses consumption from this wave and evaluation does not mutate RNG or history", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const gem = player.getHeldItems()[0];
    player.loseHeldItem(gem);
    recordConsumedHeldItem(player, gem);
    const rng = Phaser.Math.RND.state();
    const state = JSON.stringify(player.battleData);
    expect(allMoves[MoveId.RECYCLE].getUserBenefitScore(player, player, allMoves[MoveId.RECYCLE])).toBeGreaterThan(0);
    expect(Phaser.Math.RND.state()).toBe(rng);
    expect(JSON.stringify(player.battleData)).toBe(state);
    player.battleData.consumedHeldItems![0].waveIndex--;
    expect(getRecycleItemIndex(player)).toBe(-1);
  });

  it("captured Pokemon retain their own missing-item records", async () => {
    game.override.enemyHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const enemy = game.field.getEnemyPokemon();
    removeHeldItemForBattle(enemy, enemy.getHeldItems()[0]);
    const caught = enemy.addToParty(PokeballType.POKEBALL)!;
    expect(caught.battleData.removedHeldItems).toHaveLength(1);
    expect(caught.battleData.removedHeldItems).not.toBe(enemy.battleData.removedHeldItems);
    enemy.leaveField(true, true, true);
    expect(enemy.battleData.removedHeldItems).toEqual([]);
    restoreBattleRemovedHeldItems(caught);
    expect(count(caught, "LEFTOVERS")).toBe(1);
    expect(game.scene.getPlayerModifiers().filter(item => item.type.id === "LEFTOVERS")).toHaveLength(1);
  });

  it("Clone Balls cannot duplicate claims on removed or consumed items", async () => {
    game.override.enemyHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE, count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const enemy = game.field.getEnemyPokemon();
    const item = enemy.getHeldItems()[0];
    enemy.loseHeldItem(item);
    recordConsumedHeldItem(enemy, item);
    removeHeldItemForBattle(enemy, item);
    const capture = new AttemptCapturePhase(0, PokeballType.CLONE_BALL);
    await capture["addCloneToParty"](enemy);
    const clone = game.scene.getPlayerParty()[1];
    expect(clone.battleData.removedHeldItems).toEqual([]);
    expect(clone.battleData.consumedHeldItems).toEqual([]);
    expect(enemy.battleData.removedHeldItems).toHaveLength(1);
    expect(enemy.battleData.consumedHeldItems).toHaveLength(1);
  });

  it("transferred-item ownership survives saving before Knock Off", async () => {
    game.override.startingHeldItems([{ name: "STICKY_BARBS" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    let player = game.field.getPlayerPokemon();
    let enemy = game.field.getEnemyPokemon();
    game.scene.tryTransferHeldItemModifier(player.getHeldItems()[0], enemy, false);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(game.scene.gameData.getSessionSaveData()));
    player = game.scene.getPlayerParty()[0];
    enemy = game.scene.getEnemyParty()[0];
    expect(enemy.getHeldItems()[0].recoverableBattleTransfer).toEqual({ pokemonId: player.id, playerIndex: 0 });
    removeHeldItemForBattle(enemy, enemy.getHeldItems()[0]);
    restoreBattleRemovedHeldItems(player);
    expect(count(player, "STICKY_BARBS")).toBe(1);
    expect(player.getHeldItems()[0].recoverableBattleTransfer).toBeUndefined();
  });

  it("Berry Pouch preservation creates no Recycle claim", async () => {
    game.override
      .startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS }])
      .startingModifier([{ name: "BERRY_POUCH", count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    vi.spyOn(player, "randBattleSeedInt").mockReturnValue(0);
    consumeBerryModifier(
      player,
      player.getHeldItems()[0] as BerryModifier,
      { trigger: "turn-end" },
      { animate: false },
    );
    expect(count(player, "BERRY")).toBe(1);
    expect(getRecycleItemIndex(player)).toBe(-1);
  });
});
