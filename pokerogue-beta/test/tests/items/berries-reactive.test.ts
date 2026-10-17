import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { BerryModifier, PreserveBerryModifier } from "#modifiers/modifier";
import { BerryModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { consumeBerryModifier } from "#utils/berry-use-utils";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Items - Reactive berries", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .criticalHits(false)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("can eat a Sitrus Berry between hits of a multi-hit move", async () => {
    game.override
      .enemyAbility(AbilityId.SKILL_LINK)
      .enemyMoveset(MoveId.BULLET_SEED)
      .startingHeldItems([{ name: "BERRY", type: BerryType.SITRUS, count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.SHUCKLE);

    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2) - 1;

    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(MoveId.BULLET_SEED, BattlerIndex.PLAYER);
    game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);

    await game.phaseInterceptor.to("TurnEndPhase", false);

    const log = game.phaseInterceptor.log;
    const firstMoveEffect = log.indexOf("MoveEffectPhase");
    const heal = log.indexOf("PokemonHealPhase");
    const secondMoveEffect = log.indexOf("MoveEffectPhase", firstMoveEffect + 1);
    const berryPhase = log.indexOf("BerryPhase");

    expect(firstMoveEffect).toBeGreaterThanOrEqual(0);
    expect(heal).toBeGreaterThan(firstMoveEffect);
    expect(secondMoveEffect).toBeGreaterThan(heal);
    expect(berryPhase).toBeGreaterThan(heal);
    expect(player.getHeldItems().some(item => item instanceof BerryModifier && item.berryType === BerryType.SITRUS)).toBe(
      false,
    );
  });

  it("can eat a Lum Berry immediately after status is applied", async () => {
    game.override
      .enemyMoveset(MoveId.NUZZLE)
      .startingHeldItems([{ name: "BERRY", type: BerryType.LUM, count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(MoveId.NUZZLE, BattlerIndex.PLAYER);
    game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);

    await game.phaseInterceptor.to("TurnEndPhase", false);

    const log = game.phaseInterceptor.log;
    const statusPhase = log.indexOf("ObtainStatusEffectPhase");
    const berryAnim = log.indexOf("CommonAnimPhase", statusPhase + 1);
    const berryPhase = log.indexOf("BerryPhase");

    expect(statusPhase).toBeGreaterThanOrEqual(0);
    expect(berryAnim).toBeGreaterThan(statusPhase);
    expect(berryPhase).toBeGreaterThan(berryAnim);
    expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
    expect(player.getHeldItems().some(item => item instanceof BerryModifier && item.berryType === BerryType.LUM)).toBe(
      false,
    );
  });

  it("halves matching incoming move damage with a resistance Berry", async () => {
    game.override
      .enemyMoveset(MoveId.TACKLE)
      .startingHeldItems([{ name: "BERRY", type: BerryType.CHILAN, count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const chilanBerry = player
      .getHeldItems()
      .find(item => item instanceof BerryModifier && item.berryType === BerryType.CHILAN) as BerryModifier;

    chilanBerry.consumed = true;
    const unreducedDamage = player.getAttackDamage({ source: enemy, move: allMoves[MoveId.TACKLE] }).damage;
    chilanBerry.consumed = false;
    const reducedDamage = player.getAttackDamage({ source: enemy, move: allMoves[MoveId.TACKLE] }).damage;
    expect(reducedDamage).toBe(toDmgValue(unreducedDamage / 2));

    const initialHp = player.hp;
    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
    game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);

    await game.phaseInterceptor.to("TurnEndPhase", false);

    expect(initialHp - player.hp).toBe(reducedDamage);
    expect(
      player.getHeldItems().some(item => item instanceof BerryModifier && item.berryType === BerryType.CHILAN),
    ).toBe(false);
  });

  it("does not consume a resistance Berry for a non-matching move type", async () => {
    game.override
      .enemyMoveset(MoveId.EMBER)
      .startingHeldItems([{ name: "BERRY", type: BerryType.CHILAN, count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const expectedDamage = player.getAttackDamage({ source: enemy, move: allMoves[MoveId.EMBER] }).damage;

    const initialHp = player.hp;
    game.move.select(MoveId.SPLASH);
    await game.move.selectEnemyMove(MoveId.EMBER, BattlerIndex.PLAYER);
    game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);

    await game.phaseInterceptor.to("TurnEndPhase", false);

    expect(initialHp - player.hp).toBe(expectedDamage);
    expect(
      player.getHeldItems().some(item => item instanceof BerryModifier && item.berryType === BerryType.CHILAN),
    ).toBe(true);
  });

  describe("Cheek Pouch", () => {
    beforeEach(() => {
      game.override
        .ability(AbilityId.CHEEK_POUCH)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(10)
        .enemyMoveset(MoveId.TACKLE);
    });

    it.each(["none", "bench"])("does not trigger with berry owner %s", async owner => {
      await game.classicMode.startBattle(SpeciesId.SKWOVET, SpeciesId.RATTATA);

      const player = game.field.getPlayerPokemon();
      const enemy = game.field.getEnemyPokemon();
      const bench = game.scene.getPlayerParty()[1];
      const expectedDamage = player.getAttackDamage({ source: enemy, move: allMoves[MoveId.TACKLE] }).damage;
      const berry = new BerryModifier(new BerryModifierType(BerryType.CHILAN), bench.id, BerryType.CHILAN, 1);
      if (owner === "bench") {
        await game.scene.addModifier(berry);
      }

      expect(player.getHeldItems()).toHaveLength(0);
      expect(player.getAttackDamage({ source: enemy, move: allMoves[MoveId.TACKLE] }).damage).toBe(expectedDamage);

      const initialHp = player.hp;
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("TurnEndPhase", false);

      expect(initialHp - player.hp).toBe(expectedDamage);
      expect(player.battleData.hasEatenBerry).toBe(false);
      expect(game.phaseInterceptor.log).not.toContain("PokemonHealPhase");
      if (owner === "bench") {
        expect(bench.getHeldItems()).toContain(berry);
        expect(berry.stackCount).toBe(1);
      }
    });

    it.each([false, true])("heals after damage is displayed, including preserved berries: %s", async preserved => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.CHILAN, count: 1 }]);
      if (preserved) {
        game.override.startingModifier([{ name: "BERRY_POUCH", count: 1 }]);
        vi.spyOn(PreserveBerryModifier.prototype, "apply").mockImplementation((_pokemon, preserve) => {
          preserve.value = true;
          return true;
        });
      }
      await game.classicMode.startBattle(SpeciesId.SKWOVET);

      const player = game.field.getPlayerPokemon();
      const berry = player.getHeldItems().find(item => item instanceof BerryModifier) as BerryModifier;
      const initialHp = player.hp;
      const displayedHp: number[] = [];
      const updateInfo = player.updateInfo.bind(player);
      vi.spyOn(player, "updateInfo").mockImplementation((...args) => {
        displayedHp.push(player.hp);
        return updateInfo(...args);
      });

      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("TurnEndPhase", false);

      const log = game.phaseInterceptor.log;
      expect(player.turnData.damageTaken).toBeGreaterThan(0);
      expect(log.indexOf("DamageAnimPhase")).toBeGreaterThanOrEqual(0);
      expect(log.indexOf("PokemonHealPhase")).toBeGreaterThan(log.indexOf("DamageAnimPhase"));
      expect(log.filter(phase => phase === "PokemonHealPhase")).toHaveLength(1);
      expect(displayedHp).toContain(initialHp - player.turnData.damageTaken);
      expect(player.hp).toBe(initialHp);
      expect(berry.stackCount).toBe(preserved ? 1 : 0);
      expect(player.getHeldItems().includes(berry)).toBe(preserved);
      expect(player.battleData.berriesEaten).toEqual(preserved ? [] : [BerryType.CHILAN]);
    });

    it("heals from a resistance berry between hits, not before the first damage display", async () => {
      game.override
        .enemyAbility(AbilityId.SKILL_LINK)
        .enemyMoveset(MoveId.BULLET_SEED)
        .startingHeldItems([{ name: "BERRY", type: BerryType.RINDO, count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.SKWOVET);

      const player = game.field.getPlayerPokemon();
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.BULLET_SEED, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("TurnEndPhase", false);

      const log = game.phaseInterceptor.log;
      const firstHit = log.indexOf("MoveEffectPhase");
      const secondHit = log.indexOf("MoveEffectPhase", firstHit + 1);
      const heal = log.indexOf("PokemonHealPhase");
      expect(log.indexOf("DamageAnimPhase")).toBeGreaterThan(firstHit);
      expect(heal).toBeGreaterThan(log.indexOf("DamageAnimPhase"));
      expect(secondHit).toBeGreaterThan(heal);
      expect(log.filter(phase => phase === "PokemonHealPhase")).toHaveLength(1);
      expect(player.getHeldItems().some(item => item instanceof BerryModifier)).toBe(false);
    });

    it("does not heal a Pokemon knocked out by a resisted hit", async () => {
      game.override.startingHeldItems([{ name: "BERRY", type: BerryType.CHILAN, count: 1 }]);
      await game.classicMode.startBattle(SpeciesId.SKWOVET, SpeciesId.RATTATA);

      const player = game.field.getPlayerPokemon();
      player.hp = 1;
      game.move.select(MoveId.SPLASH);
      await game.move.selectEnemyMove(MoveId.TACKLE, BattlerIndex.PLAYER);
      game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
      await game.phaseInterceptor.to("FaintPhase", false);

      expect(player.hp).toBe(0);
      expect(player.getHeldItems().some(item => item instanceof BerryModifier)).toBe(false);
      expect(game.phaseInterceptor.log).not.toContain("PokemonHealPhase");
    });

    it.each(["foreign", "empty", "detached", "failed removal"])("rejects invalid berry use: %s", async reason => {
      await game.classicMode.startBattle(SpeciesId.SKWOVET, SpeciesId.RATTATA);

      const player = game.field.getPlayerPokemon();
      const owner = reason === "foreign" ? game.scene.getPlayerParty()[1] : player;
      const berry = new BerryModifier(new BerryModifierType(BerryType.CHILAN), owner.id, BerryType.CHILAN, 1);
      if (reason !== "detached") {
        await game.scene.addModifier(berry);
      }
      if (reason === "empty") {
        berry.stackCount = 0;
      }
      if (reason === "failed removal") {
        vi.spyOn(player, "loseHeldItem").mockReturnValue(false);
      }
      const queuePhase = vi.spyOn(game.scene.phaseManager, "unshiftNew");
      const dispatchEvent = vi.spyOn(game.scene.eventTarget, "dispatchEvent");

      expect(consumeBerryModifier(player, berry, { trigger: "damage" })).toBe(false);
      expect(queuePhase).not.toHaveBeenCalled();
      expect(dispatchEvent).not.toHaveBeenCalled();
      expect(player.battleData.hasEatenBerry).toBe(false);
      expect(player.turnData.berriesEaten).toHaveLength(0);
      expect(player.turnData.reactiveBerriesEaten).toHaveLength(0);
      expect(berry.stackCount).toBe(reason === "empty" ? 0 : 1);
    });
  });
});
