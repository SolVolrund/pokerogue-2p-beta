import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Sticky Barb", () => {
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
      .moveset([MoveId.SPLASH, MoveId.TACKLE])
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.SHUCKLE);
  });

  it("damages the holder at the end of the turn", async () => {
    game.override.startingHeldItems([{ name: "STICKY_BARBS", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const hpBeforeTurnEnd = player.hp;

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    expect(player.hp).toBe(hpBeforeTurnEnd - Math.floor(player.getMaxHp() / 8));
    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
  });

  it("damages contact attackers and transfers to them", async () => {
    game.override.enemyHeldItems([{ name: "STICKY_BARBS", count: 1 }]);

    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    const player = game.field.getPlayerPokemon();
    const enemy = game.scene.getEnemyPokemon()!;
    const playerHpBeforeContact = player.hp;

    game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("TurnEndPhase", false);

    expect(player.hp).toBe(playerHpBeforeContact - Math.floor(player.getMaxHp() / 8));
    expect(player.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(true);
    expect(enemy.getHeldItems().some(item => item.type.id === "STICKY_BARBS")).toBe(false);
  });
});
