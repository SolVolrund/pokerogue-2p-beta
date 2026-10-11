import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Ability - Liquid Ooze", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    // Accessory sprites need real animation frames, which the headless renderer does not provide.
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .ability(AbilityId.BALL_FETCH)
      .battleStyle("single")
      .enemyLevel(20)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.LIQUID_OOZE)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("should reverse the effect of HP-draining moves", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();

    const karp = game.field.getEnemyPokemon();
    expect(karp).toHaveAbilityApplied(AbilityId.LIQUID_OOZE);
    expect(karp).not.toHaveFullHp();
    const feebas = game.field.getPlayerPokemon();
    expect(feebas).toHaveTakenDamage(karp.getInverseHp() / 2);
  });

  it("should not drain the attacker's HP if it ignores indirect damage", async () => {
    game.override.ability(AbilityId.MAGIC_GUARD);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveFullHp();
  });

  // Regression test
  it("should not apply if suppressed", async () => {
    game.override.ability(AbilityId.NEUTRALIZING_GAS);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();

    expect(game.field.getPlayerPokemon()).toHaveFullHp();
  });

  it("reverses a drain that knocks out the holder", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const target = game.field.getEnemyPokemon();
    target.hp = 1;
    game.move.use(MoveId.GIGA_DRAIN);
    await game.toEndOfTurn();
    expect(target).toHaveFainted();
    expect(game.field.getPlayerPokemon()).not.toHaveFullHp();
  });

  it.todo("should reverse drains from Leech Seed");
});
