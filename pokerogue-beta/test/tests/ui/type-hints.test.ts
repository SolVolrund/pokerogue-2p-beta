import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TypeHints } from "#enums/type-hints";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { MockText } from "#test/mocks/mocks-container/mock-text";
import { FightUiHandler } from "#ui/fight-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Type Hints", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.settings.typeHints(TypeHints.ON);
    game.override.battleStyle("single").startingLevel(100).startingWave(1).enemyMoveset(MoveId.SPLASH);
  });

  it("check immunity color", async () => {
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .startingWave(1)
      .enemySpecies(SpeciesId.FLORGES)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.DRAGON_CLAW]);
    game.settings.typeHints(TypeHints.ON);

    await game.classicMode.startBattle(SpeciesId.RAYQUAZA);

    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const { ui } = game.scene;
      const handler = ui.getHandler<FightUiHandler>();
      handler.processInput(Button.ACTION); // select "Fight"
    });

    game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
      const { ui } = game.scene;
      const movesContainer = ui.getByName<Phaser.GameObjects.Container>(FightUiHandler.MOVES_CONTAINER_NAME);
      const dragonClawText = movesContainer
        .getAll<Phaser.GameObjects.Text>()
        .find(text => text.text === i18next.t("move:dragonClaw.name"))! as unknown as MockText;

      expect.soft(dragonClawText.color).toBe("#929292");
      ui.getHandler().processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("CommandPhase");
  });

  it.each([
    [TypeHints.ON, "#4AA500"],
    [TypeHints.HIGH_CONTRAST, "#2DB4FF"],
    [TypeHints.OFF, undefined],
  ])("renders super effective moves with hint mode %i", async (mode, color) => {
    game.override.enemySpecies(SpeciesId.GARCHOMP).moveset([MoveId.DRAGON_CLAW]);
    game.settings.typeHints(mode);
    await game.classicMode.startBattle(SpeciesId.RAYQUAZA);
    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      game.scene.ui.getHandler().processInput(Button.ACTION);
    });
    game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
      const { ui } = game.scene;
      const movesContainer = ui.getByName<Phaser.GameObjects.Container>(FightUiHandler.MOVES_CONTAINER_NAME);
      const text = movesContainer
        .getAll<Phaser.GameObjects.Text>()
        .find(row => row.text === i18next.t("move:dragonClaw.name"))! as unknown as MockText;
      expect(text.color).toBe(color);
      ui.getHandler().processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("TurnStartPhase");
  });

  it("check status move color", async () => {
    game.override.enemySpecies(SpeciesId.FLORGES).moveset([MoveId.GROWL]);

    await game.classicMode.startBattle(SpeciesId.RAYQUAZA);

    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const { ui } = game.scene;
      const handler = ui.getHandler<FightUiHandler>();
      handler.processInput(Button.ACTION); // select "Fight"
    });

    game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
      const { ui } = game.scene;
      const movesContainer = ui.getByName<Phaser.GameObjects.Container>(FightUiHandler.MOVES_CONTAINER_NAME);
      const growlText = movesContainer
        .getAll<Phaser.GameObjects.Text>()
        .find(text => text.text === i18next.t("move:growl.name"))! as unknown as MockText;

      expect.soft(growlText.color).toBe(undefined);
      ui.getHandler().processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("CommandPhase");
  });

  it("should show the proper hint for a move in doubles after one of the enemy pokemon faints", async () => {
    game.override
      .enemySpecies(SpeciesId.ABRA)
      .moveset([MoveId.SPLASH, MoveId.SHADOW_BALL, MoveId.SOAK])
      .enemyMoveset([MoveId.SPLASH, MoveId.MEMENTO])
      .battleStyle("double");

    await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.MAGIKARP);
    // Bind each action to a field slot, independently of enemy decision previews.
    game.scene.getEnemyField().forEach((enemy, index) => {
      vi.spyOn(enemy, "getNextMove").mockReturnValue({
        move: index === 0 ? MoveId.SPLASH : MoveId.MEMENTO,
        targets: [index === 0 ? BattlerIndex.ENEMY : BattlerIndex.PLAYER],
        useMode: MoveUseMode.NORMAL,
      });
    });
    game.move.select(MoveId.SPLASH);
    // Use soak to change type of remaining abra to water
    game.move.select(MoveId.SOAK, 1, BattlerIndex.ENEMY);

    await game.toNextTurn();
    const opponents = game.field.getPlayerPokemon().getOpponents();
    expect(opponents).toHaveLength(1);
    expect(opponents[0].getTypes()).toEqual([PokemonType.WATER]);

    game.onNextPrompt("CommandPhase", UiMode.COMMAND, () => {
      const { ui } = game.scene;
      const handler = ui.getHandler<FightUiHandler>();
      handler.processInput(Button.ACTION); // select "Fight"
    });

    game.onNextPrompt("CommandPhase", UiMode.FIGHT, () => {
      const { ui } = game.scene;
      const movesContainer = ui.getByName<Phaser.GameObjects.Container>(FightUiHandler.MOVES_CONTAINER_NAME);
      const shadowBallText = movesContainer
        .getAll<Phaser.GameObjects.Text>()
        .find(text => text.text === i18next.t("move:shadowBall.name"))! as unknown as MockText;
      expect.soft(shadowBallText).toBeDefined();

      expect.soft(shadowBallText.color).toBe(undefined);
      ui.getHandler().processInput(Button.ACTION);
    });
    await game.phaseInterceptor.to("CommandPhase");
  });
});
