import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { BerryModifier } from "#modifiers/modifier";
import { GameManager } from "#test/framework/game-manager";
import { toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

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
});
