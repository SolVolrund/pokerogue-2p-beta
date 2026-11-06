import type { PlayerIndex } from "#app/battle-scene";
import { COOLDOWN_HELD_ITEM_IDS, type CooldownHeldItemId } from "#data/cooldown-held-items";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import { modifierPool, trainerModifierPool, wildModifierPool } from "#modifiers/modifier-pools";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { ArenaData } from "#system/arena-data";
import { GameManager } from "#test/framework/game-manager";
import { getConsumedHeldItems, removeHeldItemForBattle, restoreBattleRemovedHeldItems } from "#utils/battle-held-items";
import {
  activateCooldownHeldItem,
  findReadyCooldownHeldItem,
  isCooldownHeldItemUseful,
} from "#utils/cooldown-held-items";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function makeItem(id: CooldownHeldItemId, pokemon: Pokemon): PokemonHeldItemModifier {
  const factory = modifierTypes[id];
  return factory().withIdFromFunc(factory).newModifier(pokemon) as PokemonHeldItemModifier;
}

describe("Cooldown held items - shared ownership and persistence", () => {
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
    game.scene.currentBattle.waveIndex = 40;
    for (const owner of [0, 1, 2] as const) {
      for (let index = 0; index < 2; index++) {
        game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50));
      }
    }
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });
  const holder = (owner: PlayerIndex, slot = 0) => game.scene.getPlayerParty(owner)[slot];
  function add(id: CooldownHeldItemId, owner: PlayerIndex, slot = 0) {
    const item = makeItem(id, holder(owner, slot));
    expect(game.scene.addModifier(item, true, false, false, true, undefined, owner)).toBe(true);
    return item;
  }

  it.each(COOLDOWN_HELD_ITEM_IDS)("enforces acquisition, transfer, theft and trade limits for %s", async id => {
    const first = add(id, 0, 1);
    const existing = add(id, 2);
    const type = first.type as PokemonHeldItemModifierType;
    expect(type.selectFilter?.(holder(2, 1))).not.toBeNull();
    expect(game.scene.addModifier(makeItem(id, holder(2, 1)), true, false, false, true, undefined, 2)).toBe(false);
    expect(game.scene.canTransferHeldItemModifier(first, holder(2, 1))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(first, holder(2, 1), false)).toBe(false);
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
    game.scene.getEnemyParty().push(enemy);
    const loot = makeItem(id, enemy);
    await game.scene.addEnemyModifier(loot, true);
    expect(game.scene.tryTransferHeldItemModifier(loot, holder(2, 1), false)).toBe(false);
    expect(enemy.getHeldItems()).toContain(loot);
    const outgoing = holder(0, 1);
    const phase = new SelectModifierPhase();
    expect(phase["tradePlayerPokemon"](0, 1, 2, 1)).toBe(false);
    expect(holder(0, 1)).toBe(outgoing);
    expect(game.scene.getPlayerModifiers(0)).toContain(first);
    expect(game.scene.getPlayerModifiers(2)).toContain(existing);
    expect(phase["tradePlayerPokemon"](0, 1, 2, 0)).toBe(true);
    expect(holder(2)).toBe(outgoing);
    expect(game.scene.getPlayerModifiers(2)).toContain(first);
  });

  it.each(COOLDOWN_HELD_ITEM_IDS)("counts temporarily removed %s against the cap", id => {
    const reserved = add(id, 2);
    expect(removeHeldItemForBattle(holder(2), reserved)).toBe(true);
    holder(2).battleData.removedHeldItems[0].reserveCapacity = false;
    const incoming = add(id, 0, 1);
    expect(game.scene.canReceiveCooldownHeldItem(id, 2)).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(incoming, holder(2, 1), false)).toBe(false);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 1, 2, 1)).toBe(false);
    restoreBattleRemovedHeldItems(holder(2));
    expect(holder(2).getHeldItems()).toHaveLength(1);
  });

  it.each(COOLDOWN_HELD_ITEM_IDS)("keeps %s's cooldown through holder changes and reacquisition", id => {
    const item = add(id, 2);
    expect(activateCooldownHeldItem(holder(2), id)).toBe(true);
    expect(game.scene.arena.getPlayerHeldItemReadyWave(id, 2)).toBe(45);
    expect(game.scene.arena.getPlayerHeldItemReadyWave(id, 0)).toBe(0);
    expect(getConsumedHeldItems(holder(2))).toHaveLength(0);
    expect(game.scene.tryTransferHeldItemModifier(item, holder(2, 1), false)).toBe(true);
    const moved = holder(2, 1).getHeldItems()[0];
    expect(activateCooldownHeldItem(holder(2, 1), id)).toBe(false);
    expect(game.scene.tryDiscardHeldItemModifier(moved)).toBe(true);
    add(id, 2);
    for (const wave of [40, 41, 42, 43, 44]) {
      game.scene.currentBattle.waveIndex = wave;
      expect(findReadyCooldownHeldItem(holder(2), id)).toBeUndefined();
    }
    game.scene.currentBattle.waveIndex = 45;
    expect(activateCooldownHeldItem(holder(2), id)).toBe(true);
    expect(game.scene.arena.getPlayerHeldItemReadyWave(id, 2)).toBe(50);
  });

  it("saves every item independently for all players and preserves old White Herb saves", async () => {
    for (const owner of [0, 1, 2] as const) {
      for (const [index, id] of COOLDOWN_HELD_ITEM_IDS.entries()) {
        add(id, owner);
        game.scene.arena.startPlayerHeldItemRecharge(id, owner, 38 + index + owner);
      }
    }
    game.scene.newArena(BiomeId.FOREST, 0, true);
    const save = JSON.stringify(game.scene.gameData.getSessionSaveData());
    await game.scene.gameData.loadSessionSnapshot(save);
    for (const owner of [0, 1, 2] as const) {
      expect(holder(owner).getHeldItems()).toHaveLength(5);
      for (const [index, id] of COOLDOWN_HELD_ITEM_IDS.entries()) {
        expect(game.scene.arena.getPlayerHeldItemReadyWave(id, owner)).toBe(43 + index + owner);
        expect(game.scene.canReceiveCooldownHeldItem(id, owner)).toBe(false);
      }
    }
    const legacy = new ArenaData({
      biome: BiomeId.TOWN,
      weather: null,
      terrain: null,
      positionalTags: [],
      playerWhiteHerbReadyWaveByPlayer: [45],
    });
    expect(legacy.playerHeldItemReadyWaves).toEqual({});
    expect(legacy.playerWhiteHerbReadyWaveByPlayer).toEqual([45, 0, 0]);
    game.scene.newArena(BiomeId.TOWN);
    for (const id of COOLDOWN_HELD_ITEM_IDS) {
      expect(game.scene.arena.isPlayerHeldItemReady(id, 2)).toBe(true);
    }
  });

  it.each(COOLDOWN_HELD_ITEM_IDS)("respects suppression and consumes enemy %s without player recharge", async id => {
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
    game.scene.getEnemyParty().push(enemy);
    await game.scene.addEnemyModifier(makeItem(id, enemy), true);
    vi.spyOn(enemy, "isOnField").mockReturnValue(true);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, enemy.id);
    expect(activateCooldownHeldItem(enemy, id)).toBe(false);
    game.scene.arena.removeTag(ArenaTagType.MAGIC_ROOM);
    expect(activateCooldownHeldItem(enemy, id)).toBe(true);
    expect(enemy.getHeldItems()).toHaveLength(0);
    expect(game.scene.arena.getPlayerHeldItemReadyWave(id, 0)).toBe(0);
  });
});

describe("Cooldown held items - battle effects", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SPLASH]);
  });

  it("Power Herb completes Geomancy immediately, uses PP once and does not recharge early", async () => {
    game.override.moveset([MoveId.GEOMANCY, MoveId.SPLASH]).startingHeldItems([{ name: "POWER_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.XERNEAS);
    const pokemon = game.field.getPlayerPokemon();
    game.move.select(MoveId.GEOMANCY);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.SPATK)).toBe(2);
    expect(pokemon.getStatStage(Stat.SPDEF)).toBe(2);
    expect(pokemon.getStatStage(Stat.SPD)).toBe(2);
    expect(pokemon.getMoveset()[0].ppUsed).toBe(1);
    expect(pokemon.getTag(BattlerTagType.CHARGING)).toBeUndefined();
    expect(game.scene.arena.getPlayerHeldItemReadyWave("POWER_HERB")).toBe(6);
    game.move.select(MoveId.GEOMANCY);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.SPATK)).toBe(2);
    expect(pokemon.getTag(BattlerTagType.CHARGING)).toBeDefined();
  });

  it("does not spend Power Herb on a naturally instant Solar Beam", async () => {
    game.override
      .moveset([MoveId.SOLAR_BEAM])
      .weather(WeatherType.SUNNY)
      .startingHeldItems([{ name: "POWER_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.SOLAR_BEAM);
    await game.toNextTurn();
    expect(game.field.getEnemyPokemon().hp).toBeLessThan(game.field.getEnemyPokemon().getMaxHp());
    expect(game.scene.arena.getPlayerHeldItemReadyWave("POWER_HERB")).toBe(0);
  });

  it("keeps charging effects when Power Herb skips Skull Bash's wait", async () => {
    game.override.moveset([MoveId.SKULL_BASH]).startingHeldItems([{ name: "POWER_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.SKULL_BASH);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon().getStatStage(Stat.DEF)).toBe(1);
    expect(game.field.getEnemyPokemon().hp).toBeLessThan(game.field.getEnemyPokemon().getMaxHp());
    expect(game.scene.arena.getPlayerHeldItemReadyWave("POWER_HERB")).toBe(6);
  });

  it("Blunder Policy boosts Speed after an accuracy miss only once per recharge", async () => {
    game.override.moveset([MoveId.TACKLE]).startingHeldItems([{ name: "BLUNDER_POLICY" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    vi.spyOn(allMoves[MoveId.TACKLE], "calculateBattleAccuracy").mockReturnValue(0);
    for (let turn = 0; turn < 2; turn++) {
      game.move.select(MoveId.TACKLE);
      await game.toNextTurn();
      expect(game.field.getPlayerPokemon().getStatStage(Stat.SPD)).toBe(2);
    }
    expect(game.scene.arena.getPlayerHeldItemReadyWave("BLUNDER_POLICY")).toBe(6);
  });

  it.each(["protect", "immune", "ohko", "invulnerable"])("does not trigger Blunder Policy for %s", async kind => {
    const move = kind === "ohko" ? MoveId.FISSURE : MoveId.TACKLE;
    game.override.moveset([move]).startingHeldItems([{ name: "BLUNDER_POLICY" }]);
    if (kind === "protect") {
      game.override.enemyMoveset(MoveId.PROTECT);
    }
    if (kind === "immune") {
      game.override.enemySpecies(SpeciesId.GASTLY);
    }
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    if (kind === "ohko") {
      vi.spyOn(allMoves[move], "calculateBattleAccuracy").mockReturnValue(0);
    }
    if (kind === "invulnerable") {
      game.field.getEnemyPokemon().addTag(BattlerTagType.FLYING, 1, MoveId.FLY);
    }
    game.move.select(move);
    await game.toNextTurn();
    expect(game.field.getPlayerPokemon().getStatStage(Stat.SPD)).toBe(0);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("BLUNDER_POLICY")).toBe(0);
  });

  it("Weakness Policy boosts both attacks after a super-effective hit", async () => {
    game.override.enemyMoveset(MoveId.WATER_GUN).startingHeldItems([{ name: "WEAKNESS_POLICY" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    const pokemon = game.field.getPlayerPokemon();
    expect(pokemon.hp).toBeGreaterThan(0);
    expect(pokemon.hp).toBeLessThan(pokemon.getMaxHp());
    expect(pokemon.getStatStage(Stat.ATK)).toBe(2);
    expect(pokemon.getStatStage(Stat.SPATK)).toBe(2);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("WEAKNESS_POLICY")).toBe(6);
  });

  it.each(["neutral", "fixed", "substitute", "faint"])("does not trigger Weakness Policy for %s", async kind => {
    game.override
      .enemyMoveset(kind === "fixed" ? MoveId.SEISMIC_TOSS : kind === "neutral" ? MoveId.TACKLE : MoveId.WATER_GUN)
      .startingHeldItems([{ name: "WEAKNESS_POLICY" }]);
    await game.classicMode.startBattle(kind === "fixed" ? SpeciesId.SNORLAX : SpeciesId.CHARMANDER);
    const pokemon = game.field.getPlayerPokemon();
    if (kind === "faint") {
      pokemon.hp = 1;
    }
    if (kind === "substitute") {
      game.override.moveset([MoveId.SUBSTITUTE]);
    }
    game.move.select(kind === "substitute" ? MoveId.SUBSTITUTE : MoveId.SPLASH);
    await game.phaseInterceptor.to(kind === "faint" ? "FaintPhase" : "TurnEndPhase");
    expect(game.scene.arena.getPlayerHeldItemReadyWave("WEAKNESS_POLICY")).toBe(0);
  });

  it("Air Balloon grants Ground immunity, pops on a hit and reinflates on wave six", async () => {
    game.override.enemyMoveset(MoveId.EARTHQUAKE).startingHeldItems([{ name: "AIR_BALLOON" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const pokemon = game.field.getPlayerPokemon();
    expect(pokemon.isGrounded()).toBe(false);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(pokemon.hp).toBe(pokemon.getMaxHp());
    expect(game.scene.arena.getPlayerHeldItemReadyWave("AIR_BALLOON")).toBe(0);
    game.override.enemyMoveset(MoveId.TACKLE);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(pokemon.isGrounded()).toBe(true);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("AIR_BALLOON")).toBe(6);
    expect(pokemon.getHeldItems()).toHaveLength(1);
    game.scene.currentBattle.waveIndex = 6;
    expect(pokemon.isGrounded()).toBe(false);
  });

  it.each(["gravity", "suppression", "thousand arrows"])("bypasses Air Balloon with %s", async kind => {
    game.override.startingHeldItems([{ name: "AIR_BALLOON" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const pokemon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    if (kind === "gravity") {
      game.scene.arena.addTag(ArenaTagType.GRAVITY, 5, MoveId.GRAVITY, enemy.id);
    }
    if (kind === "suppression") {
      game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, enemy.id);
    }
    const move = allMoves[kind === "thousand arrows" ? MoveId.THOUSAND_ARROWS : MoveId.EARTHQUAKE];
    expect(pokemon.getMoveEffectiveness(enemy, move)).toBeGreaterThan(0);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("AIR_BALLOON")).toBe(0);
  });

  it("Air Balloon pops through Substitute without triggering Weakness Policy", async () => {
    game.override
      .moveset([MoveId.SUBSTITUTE, MoveId.SPLASH])
      .startingHeldItems([{ name: "AIR_BALLOON" }, { name: "WEAKNESS_POLICY" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const pokemon = game.field.getPlayerPokemon();
    game.move.select(MoveId.SUBSTITUTE);
    await game.toNextTurn();
    const hp = pokemon.hp;
    game.override.enemyMoveset(MoveId.WATER_GUN);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(pokemon.hp).toBe(hp);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("AIR_BALLOON")).toBe(6);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("WEAKNESS_POLICY")).toBe(0);
  });

  it("does not pop Air Balloon from poison damage", async () => {
    game.override.enemyMoveset(MoveId.POISON_GAS).startingHeldItems([{ name: "AIR_BALLOON" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    vi.spyOn(allMoves[MoveId.POISON_GAS], "calculateBattleAccuracy").mockReturnValue(-1);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    const pokemon = game.field.getPlayerPokemon();
    expect(pokemon.hp).toBeLessThan(pokemon.getMaxHp());
    expect(pokemon.isGrounded()).toBe(false);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("AIR_BALLOON")).toBe(0);
  });

  it("does not offer Blunder Policy to a No Guard holder", async () => {
    game.override.moveset([MoveId.TACKLE]).ability(AbilityId.NO_GUARD);
    await game.classicMode.startBattle(SpeciesId.MACHOP);
    expect(isCooldownHeldItemUseful(game.field.getPlayerPokemon(), "BLUNDER_POLICY")).toBe(false);
  });

  it("filters Power Herb for charging moves and ignores Sky Drop", async () => {
    game.override.moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.XERNEAS);
    const pokemon = game.field.getPlayerPokemon();
    expect(isCooldownHeldItemUseful(pokemon, "POWER_HERB")).toBe(false);
    game.override.moveset([MoveId.GEOMANCY]);
    expect(isCooldownHeldItemUseful(pokemon, "POWER_HERB")).toBe(true);
    game.override.moveset([MoveId.SKY_DROP]);
    expect(isCooldownHeldItemUseful(pokemon, "POWER_HERB")).toBe(false);
    expect(pokemon.getAttackTypeEffectiveness(PokemonType.STEEL)).toBe(2);
  });

  it("enables Ultra-tier rewards, filters enemy eligibility and removes owned items from rewards", async () => {
    game.override.moveset([MoveId.GEOMANCY, MoveId.TACKLE]);
    await game.classicMode.startBattle(SpeciesId.XERNEAS);
    const pokemon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    for (const id of COOLDOWN_HELD_ITEM_IDS) {
      const entry = modifierPool[ModifierTier.ULTRA].find(candidate => candidate.modifierType.id === id)!;
      expect(entry).toBeDefined();
      expect(typeof entry.weight === "function" && entry.weight([pokemon], 0)).toBe(3);
      expect(game.scene.addModifier(makeItem(id, pokemon), true)).toBe(true);
      expect(typeof entry.weight === "function" && entry.weight([pokemon], 0)).toBe(0);
    }
    for (const pool of [wildModifierPool, trainerModifierPool]) {
      const entry = pool[ModifierTier.ULTRA].find(candidate => candidate.modifierType.id === "POWER_HERB")!;
      expect(typeof entry.weight === "function" && entry.weight([enemy], 0)).toBe(0);
      game.override.enemyMoveset(MoveId.GEOMANCY);
      expect(typeof entry.weight === "function" && entry.weight([enemy], 0)).toBe(1);
      game.override.enemyMoveset(MoveId.SPLASH);
    }
  });
});
