import { GameMode, getGameMode } from "#app/game-mode";
import { Phase } from "#app/phase";
import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { GameOverPhase } from "#phases/game-over-phase";
import { SelectChallengePhase } from "#phases/select-challenge-phase";
import { TitlePhase } from "#phases/title-phase";
import { ChallengeData } from "#system/challenge-data";
import { GameManager } from "#test/framework/game-manager";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { ChallengeSelectConfig, GameChallengesUiHandler } from "#ui/challenges-select-ui-handler";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Title game modes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let title: TitlePhase;
  let menu: ReturnType<typeof vi.fn<(text: string, options: OptionSelectItem[]) => void>>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    title = new TitlePhase();
    menu = vi.fn();
    title["showOptionSelectWithText"] = menu;
    vi.spyOn(game.scene.getLocalPlayerGameData(), "isUnlocked").mockImplementation(
      key => game.scene.getLocalPlayerGameData().unlocks[key],
    );
  });

  function options(): OptionSelectItem[] {
    return menu.mock.calls.at(-1)![1];
  }

  function select(label: string): void {
    const item = options().find(option => option.label === label);
    expect(item).toBeDefined();
    item!.handler();
  }

  it.each([
    [false, false, []],
    [true, false, [GameModes.CHALLENGE, GameModes.ENDLESS]],
    [true, true, [GameModes.CHALLENGE, GameModes.ENDLESS, GameModes.SPLICED_ENDLESS]],
  ] as const)("restores the original unlock gates (%s, %s)", (endless, spliced, modes) => {
    const data = game.scene.getLocalPlayerGameData();
    data.unlocks[Unlockables.ENDLESS_MODE] = endless;
    data.unlocks[Unlockables.SPLICED_ENDLESS_MODE] = spliced;
    title["showNewGameModeSelect"]();
    expect(options().map(option => option.label)).toEqual([
      GameMode.getModeName(GameModes.CLASSIC),
      i18next.t("menu:dailyRun"),
      ...modes.map(mode => GameMode.getModeName(mode)),
      i18next.t("menu:cancel"),
    ]);
  });

  it("selects rules before player count and preserves them when going back", async () => {
    game.scene.getLocalPlayerGameData().unlocks[Unlockables.ENDLESS_MODE] = true;
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    title["showNewGameModeSelect"]();
    select(GameMode.getModeName(GameModes.CHALLENGE));
    expect(mode.mock.calls.at(-1)?.[0]).toBe(UiMode.CHALLENGE_SELECT);
    expect(menu).toHaveBeenCalledTimes(1);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 3);
    const config = mode.mock.calls.at(-1)![1] as ChallengeSelectConfig;
    config.onConfirm();
    await Promise.resolve();
    expect(menu.mock.calls.at(-1)?.[0]).toBe(i18next.t("menu:selectPlayerCount"));
    select(i18next.t("menu:cancel"));
    expect(mode.mock.calls.at(-1)?.[0]).toBe(UiMode.CHALLENGE_SELECT);
    expect(game.scene.gameMode.challenges.find(c => c.id === Challenges.SINGLE_GENERATION)?.value).toBe(3);
    (mode.mock.calls.at(-1)![1] as ChallengeSelectConfig).onCancel();
    await Promise.resolve();
    expect(menu.mock.calls.at(-1)?.[0]).toBe(i18next.t("menu:selectGameMode"));
    expect(title["selectedChallenges"]).toEqual([]);
    expect(game.scene.gameMode.isChallenge).not.toBe(true);
  });

  it.each([GameModes.ENDLESS, GameModes.SPLICED_ENDLESS])("routes mode %i directly to player count", modeId => {
    const data = game.scene.getLocalPlayerGameData();
    data.unlocks[Unlockables.ENDLESS_MODE] = true;
    data.unlocks[Unlockables.SPLICED_ENDLESS_MODE] = true;
    const start = vi.spyOn(title, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    title["showNewGameModeSelect"]();
    select(GameMode.getModeName(modeId));
    expect(menu.mock.calls.at(-1)?.[0]).toBe(i18next.t("menu:selectPlayerCount"));
    select(i18next.t("menu:onePlayer"));
    expect(start).toHaveBeenCalledOnce();
    expect(title.gameMode).toBe(modeId);
  });

  it("keeps selected rules when constructing the run and does not show a second settings screen", () => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 3);
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    title.gameMode = GameModes.CHALLENGE;
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    title.end();
    expect(game.scene.gameMode.challenges.find(c => c.id === Challenges.SINGLE_GENERATION)?.value).toBe(3);
    expect(queue.mock.calls.some(call => call[0] === "SelectStarterPhase")).toBe(true);
    expect(queue.mock.calls.some(call => call[0] === "SelectChallengePhase")).toBe(false);
  });

  it.each([2, 3] as const)("sends the host's rules to guests in a %ip run", count => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 4);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P2, PokemonType.WATER + 1);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P3, PokemonType.GRASS + 1);
    title["selectedChallenges"] = game.scene.gameMode.challenges.map(c => new ChallengeData(c));
    title["announceTwoPlayerProfileForStartup"] = () => {};
    title["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
    vi.spyOn(title, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(false);
    title["startMultiplayerRun"](GameModes.CHALLENGE, count, 6);
    const payload: TwoPlayerTitleStart = JSON.parse(JSON.stringify(broadcast.mock.calls[0][0]));
    expect(payload.challenges?.find(c => c.id === Challenges.SINGLE_GENERATION)?.value).toBe(4);

    const guest = new TitlePhase();
    guest["announceTwoPlayerProfileForStartup"] = () => {};
    guest["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    expect(guest["applyRemoteTwoPlayerTitleStart"](payload)).toBe(true);
    expect(game.scene.gameMode.modeId).toBe(GameModes.CHALLENGE);
    expect(game.scene.gameMode.challenges.find(c => c.id === Challenges.SINGLE_GENERATION)?.value).toBe(4);
    expect(game.scene.gameMode.challenges.find(c => c.id === Challenges.SINGLE_TYPE_P1)?.value).toBe(PokemonType.FIRE + 1);
    expect(game.scene.gameMode.challenges.find(c => c.id === Challenges.SINGLE_TYPE_P2)?.value).toBe(PokemonType.WATER + 1);
    expect(game.scene.gameMode.challenges.find(c => c.id === Challenges.SINGLE_TYPE_P3)?.value)
      .toBe(count === 3 ? PokemonType.GRASS + 1 : 0);
    expect(guest["applyRemoteTwoPlayerTitleStart"](payload)).toBe(true);
  });

  it.each([2, 3] as const)("still queues the Endless unlock for all %i Classic players", count => {
    game.scene.configureTwoPlayerMode(true, 6, false, count);
    game.scene.newBattle();
    for (const player of game.scene.getActivePlayerIndexes()) {
      game.scene.getPlayerGameData(player).unlocks[Unlockables.ENDLESS_MODE] = false;
    }
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    new GameOverPhase(true).handleUnlocks();
    expect(queue).toHaveBeenCalledWith("UnlockPhase", Unlockables.ENDLESS_MODE, count === 2 ? [0, 1] : [0, 1, 2]);
  });

  it("uses the existing challenge UI with confirm/cancel callbacks without advancing the Title phase", () => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 1);
    const handler = game.scene.ui.handlers[UiMode.CHALLENGE_SELECT] as GameChallengesUiHandler;
    // The headless container mock omits GameObject's no-op update method.
    handler["challengesContainer"].update = () => {};
    const config = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    handler.show([config]);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
    expect(config.onConfirm).toHaveBeenCalledOnce();
    expect(queue.mock.calls.some(call => call[0] === "SelectStarterPhase")).toBe(false);
    handler.show([config]);
    handler.processInput(Button.CANCEL);
    expect(config.onCancel).toHaveBeenCalledOnce();
    handler.clear();
  });

  it("preserves the legacy challenge-phase continuation when no callbacks are supplied", () => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 1);
    const handler = game.scene.ui.handlers[UiMode.CHALLENGE_SELECT] as GameChallengesUiHandler;
    handler["challengesContainer"].update = () => {};
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(new SelectChallengePhase());
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    handler.show([]);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
    expect(queue).toHaveBeenCalledWith("SelectStarterPhase");
    handler.clear();
  });
});
