import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Klutz items", () => {
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
      .ability(AbilityId.UNNERVE)
      .enemyAbility(AbilityId.UNNERVE)
      .moveset([MoveId.SPLASH, MoveId.QUICK_ATTACK])
      .enemyMoveset(MoveId.SPLASH);
  });

  it("lowers all holder move priority by 1 with Lagging Tail", async () => {
    game.override.startingHeldItems([{ name: "LAGGING_TAIL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();

    expect(allMoves[MoveId.SPLASH].getPriority(player)).toBe(-1);
    expect(allMoves[MoveId.QUICK_ATTACK].getPriority(player)).toBe(0);
  });

  it("ignores Lagging Tail priority loss with Klutz", async () => {
    game.override.ability(AbilityId.KLUTZ).startingHeldItems([{ name: "LAGGING_TAIL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();

    expect(allMoves[MoveId.SPLASH].getPriority(player)).toBe(0);
    expect(allMoves[MoveId.QUICK_ATTACK].getPriority(player)).toBe(1);
  });

  it("grounds Flying-type holders with Iron Ball", async () => {
    game.override.startingHeldItems([{ name: "IRON_BALL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.PIDGEOT);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.isGrounded()).toBe(true);
    expect(player.getAttackTypeEffectiveness(PokemonType.GROUND, { source: enemy })).toBe(1);
  });

  it("ignores Iron Ball grounding with Klutz", async () => {
    game.override.ability(AbilityId.KLUTZ).startingHeldItems([{ name: "IRON_BALL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.PIDGEOT);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.isGrounded()).toBe(false);
    expect(player.getAttackTypeEffectiveness(PokemonType.GROUND, { source: enemy })).toBe(0);
  });

  it("removes Levitate Ground immunity with Iron Ball", async () => {
    game.override.ability(AbilityId.LEVITATE).startingHeldItems([{ name: "IRON_BALL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.isGrounded()).toBe(true);
    expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.EARTHQUAKE])).toBe(1);
  });

  it.each([
    { itemName: "TOXIC_ORB", status: StatusEffect.TOXIC },
    { itemName: "FLAME_ORB", status: StatusEffect.BURN },
  ] as const)("ignores $itemName status with Klutz", async ({ itemName, status }) => {
    game.override.ability(AbilityId.KLUTZ).startingHeldItems([{ name: itemName }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(player.status?.effect).not.toBe(status);
    expect(player.status?.effect ?? StatusEffect.NONE).toBe(StatusEffect.NONE);
  });

  it("ignores Sticky Barb end-of-turn damage with Klutz", async () => {
    game.override.ability(AbilityId.KLUTZ).startingHeldItems([{ name: "STICKY_BARBS", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const hpBeforeTurnEnd = player.hp;

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(player.hp).toBe(hpBeforeTurnEnd);
    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
  });

  it("ignores Sticky Barb contact damage but still transfers with Klutz", async () => {
    game.override
      .enemyAbility(AbilityId.KLUTZ)
      .enemyHeldItems([{ name: "STICKY_BARBS", count: 1 }])
      .moveset([MoveId.TACKLE]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon()!;
    const playerHpBeforeContact = player.hp;

    game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("TurnEndPhase", false);

    expect(player.hp).toBe(playerHpBeforeContact);
    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
    expect(enemy.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
  });
});
