import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Moves - Bestow", () => {
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
      .moveset([MoveId.BESTOW, MoveId.SPLASH])
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.SHUCKLE);
  });

  it("gives a held item to the target", async () => {
    game.override.startingHeldItems([{ name: "STICKY_BARBS", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon()!;

    game.move.select(MoveId.BESTOW, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("MoveEndPhase", false);

    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
    const enemyStickyBarb = enemy.getHeldItems().find(item => item.type.id === "STICKY_BARBS");
    expect(enemyStickyBarb).toBeDefined();
    expect(enemyStickyBarb?.recoverableBattleTransfer).toEqual({ pokemonId: player.id, playerIndex: 0 });
  });

  it("recovers transferred junk to the original holder at battle end", async () => {
    game.override.battleStyle("double").startingHeldItems([{ name: "STICKY_BARBS", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);

    const [originalHolder, ally] = game.scene.getPlayerField();
    const enemy = game.scene.getEnemyField()[0];
    const originalStickyBarb = originalHolder.getHeldItems().find(item => item.type.id === "STICKY_BARBS")!;

    expect(game.scene.tryTransferHeldItemModifier(originalStickyBarb, enemy, false)).toBe(true);
    const enemyStickyBarb = enemy.getHeldItems().find(item => item.type.id === "STICKY_BARBS")!;
    expect(game.scene.tryTransferHeldItemModifier(enemyStickyBarb, ally, false)).toBe(true);

    const allyStickyBarb = ally.getHeldItems().find(item => item.type.id === "STICKY_BARBS");
    expect(allyStickyBarb?.recoverableBattleTransfer).toEqual({ pokemonId: originalHolder.id, playerIndex: 0 });

    game.scene.recoverBattleTransferredHeldItems([0]);

    expect(originalHolder.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
    expect(ally.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
  });
});
