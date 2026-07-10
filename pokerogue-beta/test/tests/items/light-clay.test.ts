import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Light Clay", () => {
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
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .moveset([MoveId.LIGHT_SCREEN, MoveId.REFLECT])
      .startingHeldItems([{ name: "LIGHT_CLAY", count: 2 }])
      .battleStyle("single");
  });

  it("should increase Light Screen duration by +2 turns per stack", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);

    game.move.select(MoveId.LIGHT_SCREEN);

    await game.phaseInterceptor.to("MoveEndPhase");

    const lightScreen = globalScene.arena.getTagOnSide(ArenaTagType.LIGHT_SCREEN, ArenaTagSide.PLAYER);

    expect(lightScreen).toBeDefined();
    expect(lightScreen!.turnCount).toBe(9);
  });

  it("should increase Reflect duration by +2 turns per stack", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);

    game.move.select(MoveId.REFLECT);

    await game.phaseInterceptor.to("MoveEndPhase");

    const reflect = globalScene.arena.getTagOnSide(ArenaTagType.REFLECT, ArenaTagSide.PLAYER);

    expect(reflect).toBeDefined();
    expect(reflect!.turnCount).toBe(9);
  });
});
