import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { GameCornerRewardUiHandler } from "#ui/game-corner-reward-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("UI - Game Corner layer restoration", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
  });

  function expectMenuLayersAboveMessage(): void {
    const ui = game.scene.ui;
    const message = ui.getMessageHandler();
    const encounter = ui.handlers[UiMode.MYSTERY_ENCOUNTER] as MysteryEncounterUiHandler;
    const messageLayers = [message.bg, message.commandWindow, message.movesWindowContainer, message["messageContainer"]];
    const menuLayers = [
      encounter["cursorContainer"],
      encounter["optionsContainer"],
      encounter["descriptionContainer"],
      encounter["dexProgressContainer"],
      encounter["tooltipContainer"],
    ];
    for (let index = 1; index < messageLayers.length; index++) {
      expect(ui.getIndex(messageLayers[index])).toBeGreaterThan(ui.getIndex(messageLayers[index - 1]));
    }
    for (const layer of menuLayers) {
      expect(ui.getIndex(layer)).toBeGreaterThan(ui.getIndex(message["messageContainer"]));
    }
  }

  it("puts event options back above the message window when leaving the reward counter", () => {
    const ui = game.scene.ui;
    const message = ui.getMessageHandler();
    const rewards = ui.handlers[UiMode.GAME_CORNER_REWARD] as GameCornerRewardUiHandler;
    const encounter = ui.handlers[UiMode.MYSTERY_ENCOUNTER] as MysteryEncounterUiHandler;

    message.setMessageWindowVisible(false);
    rewards["showMessageWindow"]();
    expect(ui.getIndex(message.bg)).toBeGreaterThan(ui.getIndex(encounter["optionsContainer"]));

    rewards.clear();
    expectMenuLayersAboveMessage();
  });

  it("keeps event options above the shared windows after repeated battle menu restores", () => {
    const ui = game.scene.ui;
    const message = ui.getMessageHandler();
    const rewards = ui.handlers[UiMode.GAME_CORNER_REWARD] as GameCornerRewardUiHandler;

    for (let visit = 0; visit < 3; visit++) {
      rewards["showMessageWindow"]();
      rewards.clear();
      // Both the command and fight handlers restore these windows when shown.
      message.restoreBattleUiLayering();
      message.restoreBattleUiLayering();
      expectMenuLayersAboveMessage();
    }
  });
});
