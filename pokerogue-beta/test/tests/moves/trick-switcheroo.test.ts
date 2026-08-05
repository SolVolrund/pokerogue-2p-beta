import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Moves - Trick/Switcheroo", () => {
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
      .moveset([MoveId.TRICK, MoveId.SWITCHEROO, MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.SHUCKLE);
  });

  it("can give an item away when the target has nothing to take", async () => {
    game.override.startingHeldItems([{ name: "STICKY_BARBS", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon()!;

    game.move.select(MoveId.TRICK, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("MoveEndPhase", false);

    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
    const enemyStickyBarb = enemy.getHeldItems().find(item => item.type.id === "STICKY_BARBS");
    expect(enemyStickyBarb).toBeDefined();
    expect(enemyStickyBarb?.recoverableBattleTransfer).toEqual({ pokemonId: player.id, playerIndex: 0 });
  });

  it("swaps junk onto the target and takes a non-junk item back", async () => {
    game.override
      .startingHeldItems([{ name: "STICKY_BARBS", count: 1 }])
      .enemyHeldItems([{ name: "QUICK_CLAW", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon()!;

    game.move.select(MoveId.SWITCHEROO, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("MoveEndPhase", false);

    expect(player.getHeldItems().some(item => item.type.id === "QUICK_CLAW")).toBe(true);
    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
    expect(enemy.getHeldItems().some(item => item.type.id === "QUICK_CLAW")).toBe(false);
    expect(enemy.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
  });

  it("does not take recoverable junk back from an enemy", async () => {
    game.override
      .startingHeldItems([{ name: "STICKY_BARBS", count: 1 }])
      .enemyHeldItems([{ name: "FLAME_ORB", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon()!;

    game.move.select(MoveId.TRICK, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("MoveEndPhase", false);

    expect(player.getHeldItems().some(item => item.type.id === "FLAME_ORB")).toBe(false);
    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
    expect(enemy.getHeldItems().some(item => item.type.id === "FLAME_ORB")).toBe(true);
    expect(enemy.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
  });
});
