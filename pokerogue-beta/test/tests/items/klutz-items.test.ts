import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
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

  it("grounds Flying-type holders with Iron Ball", async () => {
    game.override.startingHeldItems([{ name: "IRON_BALL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.PIDGEOT);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.isGrounded()).toBe(true);
    expect(player.getAttackTypeEffectiveness(PokemonType.GROUND, { source: enemy })).toBe(1);
  });

  it("removes Levitate Ground immunity with Iron Ball", async () => {
    game.override.ability(AbilityId.LEVITATE).startingHeldItems([{ name: "IRON_BALL", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    expect(player.isGrounded()).toBe(true);
    expect(player.getMoveEffectiveness(enemy, allMoves[MoveId.EARTHQUAKE])).toBe(1);
  });
});
