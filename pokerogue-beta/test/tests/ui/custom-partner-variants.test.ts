import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { PlayerGender } from "#enums/player-gender";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { UiMode } from "#enums/ui-mode";
import { TitlePhase } from "#phases/title-phase";
import { GameManager } from "#test/framework/game-manager";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { BaseOptionSelectUiHandler } from "#ui/base-option-select-ui-handler";
import {
  getComputerPartnerProfile,
  getComputerPartnerProfileWithRolePreferences,
} from "#utils/computer-partner-profile";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Custom CPU partner variants", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let title: TitlePhase;
  let menu: ReturnType<
    typeof vi.fn<(text: string, options: OptionSelectItem[], config?: Partial<OptionSelectConfig>) => void>
  >;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    title = new TitlePhase();
    menu = vi.fn();
    title["showOptionSelectWithText"] = menu;
  });

  function options() {
    return menu.mock.calls.at(-1)![1];
  }

  function choose(label: string) {
    const option = options().find(o => o.label === label)!;
    expect(option).toBeDefined();
    expect(option.disabled).not.toBe(true);
    expect(option.handler()).toBe(true);
  }

  it.each([
    [PlayerGender.MALE, "Amber", "Kyle"],
    [PlayerGender.FEMALE, "Kyle", "Amber"],
  ] as const)("defaults opposite the lead sprite's gender (%s) and remembers cycling on reopening", (gender, initial, alternate) => {
    vi.spyOn(game.scene, "getTrainerGender").mockReturnValue(gender);
    title["showComputerPartnerSelect"](GameModes.CLASSIC, 2);
    expect(options()[0].label).toBe(initial);
    expect(options()[0].onCycle?.()).toBe(true);
    expect(options()[0].label).toBe(alternate);
    expect(
      options()
        .slice(1)
        .every(o => !o.onCycle),
    ).toBe(true);
    title["showComputerPartnerSelect"](GameModes.CLASSIC, 2);
    expect(options()[0].label).toBe(alternate);
    options()[0].onCycle?.();
    expect(options()[0].label).toBe(initial);
  });

  it("routes C/Stats to the highlighted option only, once per press", async () => {
    vi.spyOn(game.scene, "getTrainerGender").mockReturnValue(PlayerGender.FEMALE);
    title["showComputerPartnerSelect"](GameModes.CLASSIC, 2);
    const entries = options();
    await game.scene.ui.setMode(UiMode.OPTION_SELECT, { ...menu.mock.calls.at(-1)![2], options: entries });
    const handler = game.scene.ui.getHandler() as BaseOptionSelectUiHandler;
    game.scene.uiInputs.buttonGoToFilter(Button.STATS);
    expect(entries[0].label).toBe("Amber");
    game.scene.uiInputs.buttonStats(false);
    expect(entries[0].label).toBe("Amber");
    expect(handler.getCursor()).toBe(0);
    handler.processInput(Button.DOWN);
    game.scene.uiInputs.buttonGoToFilter(Button.STATS);
    expect(entries[0].label).toBe("Amber");
    handler.processInput(Button.UP);
    game.scene.uiInputs.buttonGoToFilter(Button.STATS);
    expect(entries[0].label).toBe("Kyle");
  });

  it("lets a disabled duplicate retain focus so C can switch to the available variant", async () => {
    vi.spyOn(game.scene, "getTrainerGender").mockReturnValue(PlayerGender.FEMALE);
    title["showComputerPartnerSelect"](GameModes.CLASSIC, 3, "kyle", ["physical"]);
    const entries = options();
    expect(entries[0].label).toBe("Kyle");
    expect(entries[0].disabled).toBe(true);
    await game.scene.ui.setMode(UiMode.OPTION_SELECT, { ...menu.mock.calls.at(-1)![2], options: entries });
    const handler = game.scene.ui.getHandler() as BaseOptionSelectUiHandler;
    expect(handler.getCursor()).toBe(0);
    const calls = menu.mock.calls.length;
    handler.processInput(Button.ACTION);
    expect(menu).toHaveBeenCalledTimes(calls);
    handler.processInput(Button.STATS);
    expect(entries[0].label).toBe("Amber");
    expect(entries[0].disabled).toBe(false);
    handler.processInput(Button.STATS);
    expect(entries[0].disabled).toBe(true);
    handler.processInput(Button.CANCEL);
    expect(options()[0].disabled).not.toBe(true);
  });

  it("selects Kyle and Amber together with independent role preferences and correct preference titles", () => {
    vi.spyOn(game.scene, "getTrainerGender").mockReturnValue(PlayerGender.FEMALE);
    const next = vi.spyOn(title as any, "showTwoPlayerModeSelect").mockImplementation(() => {});
    title["showComputerPartnerSelect"](GameModes.CLASSIC, 3);
    choose("Kyle");
    expect(menu.mock.calls.at(-1)![0]).toBe("Choose Kyle's Slot 2 Preference");
    for (let slot = 2; slot <= 6; slot++) {
      choose("Attack");
    }
    expect(options()[0].disabled).toBe(true);
    options()[0].onCycle?.();
    choose("Amber");
    expect(menu.mock.calls.at(-1)![0]).toBe("Choose Amber's Slot 2 Preference");
    for (let slot = 2; slot <= 6; slot++) {
      choose("Speed");
    }
    expect(next).toHaveBeenCalledWith(GameModes.CLASSIC, 3, [1, 2]);
    expect(game.scene.getComputerPartnerKey(1)).toBe("kyle");
    expect(game.scene.getComputerPartnerKey(2)).toBe("amber");
    expect(game.scene.getComputerPartnerRolePreferences(1)).toEqual(new Array(5).fill("physical"));
    expect(game.scene.getComputerPartnerRolePreferences(2)).toEqual(new Array(5).fill("speed"));
    expect(getComputerPartnerProfileWithRolePreferences("kyle", ["physical"]).roles[1]).toBe("physical");
    expect(getComputerPartnerProfileWithRolePreferences("amber", ["speed"]).roles[1]).toBe("speed");
  });

  it("preserves the chosen variant when cancelling out of its preference screen", () => {
    vi.spyOn(game.scene, "getTrainerGender").mockReturnValue(PlayerGender.MALE);
    title["showComputerPartnerSelect"](GameModes.CLASSIC, 2);
    options()[0].onCycle?.();
    choose("Kyle");
    choose(i18next.t("menu:cancel"));
    expect(options()[0].label).toBe("Kyle");
  });

  function assignPartners() {
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [1, 2]);
    title["setComputerPartner"](1, "kyle", ["physical"]);
    title["setComputerPartner"](2, "amber", ["special"]);
  }

  function expectPartners() {
    expect(game.scene.getPlayerDisplayName(1)).toBe("Kyle");
    expect(game.scene.getPlayerDisplayName(2)).toBe("Amber");
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.BASE_BOY);
    expect(game.scene.getTrainerSprite(2)).toBe(PlayerTrainerSprite.BASE_GIRL);
    expect(game.scene.getTrainerGender(1)).toBe(PlayerGender.MALE);
    expect(game.scene.getTrainerGender(2)).toBe(PlayerGender.FEMALE);
    expect(game.scene.getComputerPartnerRolePreferences(1)).toEqual(["physical"]);
    expect(game.scene.getComputerPartnerRolePreferences(2)).toEqual(["special"]);
  }

  it("restores names, fixed sprites and preferences from saved run data", () => {
    assignPartners();
    game.scene.newBattle();
    const saved = game.scene.gameData.getSessionSaveData();
    expect(saved.computerPartnerKeys).toEqual({ 1: "kyle", 2: "amber" });
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameData["configureSessionPlayerMode"](saved);
    expectPartners();
  });

  it("sends the actual variants and preferences to guests at run startup", () => {
    assignPartners();
    vi.spyOn(title as any, "announceTwoPlayerProfileForStartup").mockImplementation(() => {});
    vi.spyOn(title as any, "waitForTwoPlayerProfilesBeforeRun").mockImplementation(() => {});
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(true);
    title["startMultiplayerRun"](GameModes.CLASSIC, 3, 6, [1, 2]);
    const payload: TwoPlayerTitleStart = JSON.parse(JSON.stringify(broadcast.mock.calls[0][0]));
    expect(payload.computerPartnerKeys).toEqual({ 1: "kyle", 2: "amber" });
    game.scene.configureTwoPlayerMode(false);
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    expect(title["applyRemoteTwoPlayerTitleStart"](payload)).toBe(true);
    expectPartners();
  });

  it("retains the legacy Alex profile and its customizable behavior", () => {
    expect(getComputerPartnerProfile("alex").name).toBe("Alex");
    expect(getComputerPartnerProfile("alex").trainerSprite).toBeUndefined();
    expect(getComputerPartnerProfileWithRolePreferences("alex", ["speed"]).roles[1]).toBe("speed");
    game.scene.configureTwoPlayerMode(true, 6, true, 2, [1]);
    title["setComputerPartner"](1, "alex", ["bulk"]);
    game.scene.newBattle();
    const saved = game.scene.gameData.getSessionSaveData();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameData["configureSessionPlayerMode"](saved);
    expect(game.scene.getComputerPartnerKey(1)).toBe("alex");
    expect(game.scene.getComputerPartnerRolePreferences(1)).toEqual(["bulk"]);
  });
});
