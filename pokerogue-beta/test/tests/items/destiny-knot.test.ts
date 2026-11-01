import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { SpeciesId } from "#enums/species-id";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { Pokemon } from "#field/pokemon";
import type { DestinyKnotModifier } from "#modifiers/modifier";
import { modifierPool } from "#modifiers/modifier-pools";
import {
  itemPoolChecks,
  type ModifierTypeGenerator,
  regenerateModifierPoolThresholds,
  type WeightedModifierType,
} from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { withHeldItemSuppressionForecast } from "#utils/held-item-suppression";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import {
  getSoulBondPartner,
  isDestinyKnot,
  redistributeSoulBondHp,
  refreshSoulBondHpForParties,
  splitSoulBondHp,
  THREAD_COLORS,
  type ThreadColor,
  withSoulBondStatRefresh,
} from "#utils/soul-bond";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Destiny Knot soul bonds", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.newBattle();
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function addPokemon(species = SpeciesId.SNORLAX, owner: 0 | 1 | 2 = 0) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species), 40, 0, 0);
    game.scene.getPlayerParty(owner).push(pokemon);
    pokemon.calculateStats();
    pokemon.hp = pokemon.getMaxHp();
    return pokemon;
  }

  function equip(pokemon: Pokemon, color: ThreadColor = "red") {
    const type = (getModifierType(modifierTypes.DESTINY_KNOT) as ModifierTypeGenerator).generateType(
      [pokemon],
      [color],
    )!;
    const item = type.newModifier(pokemon) as DestinyKnotModifier;
    expect(
      game.scene.addModifier(item, false, false, false, true, undefined, game.scene.getPlayerIndexForPokemon(pokemon)),
    ).toBe(true);
    return item;
  }

  it("offers eligible Threads in ordinary Great-tier rewards", () => {
    const pokemon = addPokemon();
    const entry = (modifierPool[ModifierTier.GREAT] as WeightedModifierType[]).find(
      candidate => candidate.modifierType.id === "DESTINY_KNOT",
    );
    expect(entry?.maxWeight).toBe(2);
    itemPoolChecks.set("DESTINY_KNOT", false);
    regenerateModifierPoolThresholds([pokemon], ModifierPoolType.PLAYER);
    expect(itemPoolChecks.get("DESTINY_KNOT")).toBe(true);
    expect(equip(pokemon).type.getOrInferTier()).toBe(ModifierTier.GREAT);
    regenerateModifierPoolThresholds([pokemon], ModifierPoolType.PLAYER);
    expect(itemPoolChecks.get("DESTINY_KNOT")).toBe(false);
    itemPoolChecks.delete("DESTINY_KNOT");
  });

  it.each([
    [600, 600, 100, 100, 600, 100],
    [50, 600, 100, 100, 75, 75],
    [500, 600, 20, 100, 420, 100],
    [100, 600, 1, 1, 100, 1],
    [10, 100, 11, 100, 10, 11],
    [11, 100, 10, 100, 11, 10],
  ])("redistributes %i/%i and %i/%i without losing HP", (a, maxA, b, maxB, expectedA, expectedB) => {
    expect(splitSoulBondHp(a, maxA, b, maxB)).toEqual([expectedA, expectedB]);
  });

  it("leaves an unmatched holder unchanged, then shares only unbonded permanent stats", () => {
    const a = addPokemon();
    const b = addPokemon(SpeciesId.PIKACHU);
    const originalA = [...a.stats];
    const originalB = [...b.stats];
    equip(a);
    expect(a.getStats()).toEqual(originalA);
    equip(b);
    for (const stat of PERMANENT_STATS) {
      expect(a.getStat(stat)).toBe(originalA[stat] + Math.floor(originalB[stat] * 0.15));
      expect(b.getStat(stat)).toBe(originalB[stat] + Math.floor(originalA[stat] * 0.15));
    }
    a.setStatStage(Stat.ATK, 6);
    expect(b.getStat(Stat.ATK)).toBe(originalB[Stat.ATK] + Math.floor(originalA[Stat.ATK] * 0.15));
    a.hp = Math.floor(a.getMaxHp() / 2);
    const hp = a.hp;
    const stats = a.getStats();
    for (let i = 0; i < 8; i++) {
      a.calculateStats();
      b.calculateStats();
    }
    expect(a.hp).toBe(hp);
    expect(a.getStats()).toEqual(stats);
    expect(a.stats).toEqual(originalA);
  });

  it("links P1 to P3 on the bench and conserves their combined HP", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const a = addPokemon();
    addPokemon(SpeciesId.BULBASAUR, 2);
    const b = addPokemon(SpeciesId.PIKACHU, 2);
    equip(a);
    equip(b);
    expect(getSoulBondPartner(a)).toBe(b);
    a.hp = 30;
    b.hp = 70;
    redistributeSoulBondHp();
    expect([a.hp, b.hp]).toEqual([50, 50]);
    redistributeSoulBondHp();
    expect([a.hp, b.hp]).toEqual([50, 50]);
  });

  it("preserves Shedinja's one HP and cannot turn it into a source of healing", () => {
    const a = addPokemon();
    const b = addPokemon(SpeciesId.SHEDINJA);
    b.customPokemonData.ability = AbilityId.WONDER_GUARD;
    b.calculateStats();
    equip(a);
    equip(b);
    expect(b.getMaxHp()).toBe(1);
    a.hp = 20;
    b.hp = 1;
    redistributeSoulBondHp();
    expect([a.hp, b.hp]).toEqual([20, 1]);
  });

  it("suppresses both bonuses under Embargo, restores them, and never revives a fainted partner", () => {
    const a = addPokemon();
    const b = addPokemon();
    equip(a);
    equip(b);
    a.hp = 20;
    a.addTag(BattlerTagType.EMBARGO, 5);
    expect(getSoulBondPartner(b)).toBeUndefined();
    expect(a.getStats()).toEqual(a.stats);
    expect(b.getStats()).toEqual(b.stats);
    a.removeTag(BattlerTagType.EMBARGO);
    refreshSoulBondHpForParties();
    expect(a.hp).toBeLessThanOrEqual(20);
    expect(getSoulBondPartner(a)).toBe(b);
    b.hp = 0;
    redistributeSoulBondHp();
    expect(b.hp).toBe(0);
    expect(getSoulBondPartner(a)).toBeUndefined();
  });

  it("forecasts suppression without modifying either partner's HP", () => {
    const a = addPokemon();
    const b = addPokemon();
    equip(a);
    equip(b);
    const hp = [a.hp, b.hp];
    const bonuses = [a.soulBondHpBonus, b.soulBondHpBonus];
    withHeldItemSuppressionForecast(new Map([[a, true]]), () => {
      expect(b.getStat(Stat.ATK)).toBe(b.stats[Stat.ATK]);
    });
    expect([a.hp, b.hp]).toEqual(hp);
    expect([a.soulBondHpBonus, b.soulBondHpBonus]).toEqual(bonuses);
  });

  it("Magic Room breaks the whole bond when either holder is on the field", () => {
    const a = addPokemon();
    const b = addPokemon();
    equip(a);
    equip(b);
    game.scene.field.add(a);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, undefined, a.id);
    expect(getSoulBondPartner(b)).toBeUndefined();
    expect(b.getStat(Stat.ATK)).toBe(b.stats[Stat.ATK]);
    game.scene.arena.removeTag(ArenaTagType.MAGIC_ROOM);
    expect(getSoulBondPartner(b)).toBe(a);
  });

  it("always preserves total HP and respects both caps over varied pairs", () => {
    for (let maxA = 1; maxA < 200; maxA += 13) {
      for (let maxB = 1; maxB < 200; maxB += 17) {
        for (const [hpA, hpB] of [
          [maxA, maxB],
          [1, maxB],
          [maxA, 1],
          [1, 1],
        ]) {
          const [a, b] = splitSoulBondHp(hpA, maxA, hpB, maxB);
          expect(a + b).toBe(hpA + hpB);
          expect(a).toBeGreaterThanOrEqual(1);
          expect(b).toBeGreaterThanOrEqual(1);
          expect(a).toBeLessThanOrEqual(maxA);
          expect(b).toBeLessThanOrEqual(maxB);
        }
      }
    }
  });

  it("rescales a pair only once when both raw HP stats change together", () => {
    const a = addPokemon();
    const b = addPokemon();
    equip(a);
    equip(b);
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      for (const pokemon of [a, b]) {
        pokemon.stats[Stat.HP] = 200;
        pokemon.soulBondHpBonus = 30;
        pokemon.hp = 115;
      }
      withSoulBondStatRefresh(() => {
        for (const pokemon of order) {
          pokemon.stats[Stat.HP] = 220;
          refreshSoulBondHpForParties();
        }
      });
      expect([a.hp, b.hp]).toEqual([126, 126]);
      expect([a.getMaxHp(), b.getMaxHp()]).toEqual([253, 253]);
    }
  });

  it("avoids held-item lookups for bond stats when no Threads exist", () => {
    const a = addPokemon();
    const heldItems = vi.spyOn(a, "getHeldItems");
    for (let i = 0; i < 20; i++) {
      expect(a.getStats()).toEqual(a.stats);
    }
    expect(heldItems).not.toHaveBeenCalled();
  });

  it("preserves cross-player bonded HP, stats and colors through a complete session reload", async () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    const a = addPokemon();
    const b = addPokemon(SpeciesId.PIKACHU, 2);
    equip(a, "sky");
    equip(b, "sky");
    a.hp = a.getMaxHp() - 3;
    b.hp = b.getMaxHp() - 7;
    const expected = [a, b].map(pokemon => ({ hp: pokemon.hp, stats: pokemon.getStats(), id: pokemon.id }));
    const save = JSON.stringify(game.scene.gameData.getSessionSaveData());
    await game.scene.gameData.loadSessionSnapshot(save);
    const restored = [game.scene.getPlayerParty(0)[0], game.scene.getPlayerParty(2)[0]];
    expect(restored.map(pokemon => ({ hp: pokemon.hp, stats: pokemon.getStats(), id: pokemon.id }))).toEqual(expected);
    expect(getSoulBondPartner(restored[0])).toBe(restored[1]);
    for (const pokemon of restored) {
      expect(pokemon.getHeldItems().find(isDestinyKnot)?.color).toBe("sky");
    }
    restored.forEach(pokemon => pokemon.calculateStats());
    expect(restored.map(pokemon => pokemon.hp)).toEqual(expected.map(pokemon => pokemon.hp));
  });

  it("keeps the primary Thread and discards the donor Thread during fusion", () => {
    const a = addPokemon();
    const b = addPokemon(SpeciesId.PIKACHU);
    const c = addPokemon();
    equip(a, "red");
    equip(b, "blue");
    equip(c, "blue");
    vi.spyOn(a, "updateFusionPalette").mockImplementation(() => {});
    a.fuse(b);
    expect(game.scene.getPlayerParty()).not.toContain(b);
    expect(
      a
        .getHeldItems()
        .filter(isDestinyKnot)
        .map(item => item.color),
    ).toEqual(["red"]);
    expect(getSoulBondPartner(c)).toBeUndefined();
    expect(c.getStats()).toEqual(c.stats);
  });

  it("transfers the donor's Thread when the fusion primary has none", () => {
    const a = addPokemon();
    const b = addPokemon(SpeciesId.PIKACHU);
    const c = addPokemon();
    equip(b, "blue");
    equip(c, "blue");
    vi.spyOn(a, "updateFusionPalette").mockImplementation(() => {});
    a.fuse(b);
    expect(
      a
        .getHeldItems()
        .filter(isDestinyKnot)
        .map(item => item.color),
    ).toEqual(["blue"]);
    expect(getSoulBondPartner(c)).toBe(a);
  });

  it("does not bond opposing competitive players", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    game.scene.twoPlayerVsMode = true;
    const a = addPokemon();
    const b = addPokemon(SpeciesId.PIKACHU, 1);
    equip(a);
    equip(b);
    expect(getSoulBondPartner(a)).toBeUndefined();
    expect(a.getStats()).toEqual(a.stats);
  });

  it("supplies all nine standalone sprites", () => {
    for (const color of THREAD_COLORS) {
      const png = readFileSync(resolve(`assets/images/items/destiny_knot_${color}.png`));
      expect(png.readUInt32BE(16)).toBe(32);
      expect(png.readUInt32BE(20)).toBe(32);
    }
  });
});
