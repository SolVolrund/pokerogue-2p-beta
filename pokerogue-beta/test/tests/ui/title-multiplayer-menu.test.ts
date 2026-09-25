import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { GameModes } from "#enums/game-modes";
import { UiMode } from "#enums/ui-mode";
import { CommandPhase } from "#phases/command-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { TitlePhase } from "#phases/title-phase";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";
import {
  getOnlineLobbyLabel,
  getOnlineLobbySeats,
  isOnlineLobbyJoinable,
  ONLINE_LOBBY_SETUPS,
  type OnlineLobbySummary,
} from "#utils/online-lobby";
import { normalizePlayerDisplayName } from "#utils/player-display-name";
import i18next from "i18next";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Multiplayer menu preparation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let title: TitlePhase;
  let menu: ReturnType<typeof vi.fn<(text: string, options: OptionSelectItem[]) => void>>;

  const initialUrl = window.location.href;
  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState({}, "", initialUrl);
    sessionStorage.removeItem("pokerogue-online-membership-v1");
  });

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

  function options(): OptionSelectItem[] {
    return menu.mock.calls.at(-1)![1];
  }

  function select(label: string): void {
    const option = options().find(item => item.label === label);
    expect(option).toBeDefined();
    expect(option!.disabled).not.toBe(true);
    expect(option!.handler()).toBe(true);
  }

  it.each([
    [2, false, ["2P", "P.Vs.P"]],
    [3, false, ["3P", "P.Vs.P.Vs.P"]],
    [1, true, ["P.Vs.EP"]],
    [2, true, ["2P.Vs.EP"]],
    [3, true, ["3P.Vs.EP"]],
  ] as const)("limits a %i-player EP=%s Online lobby to its compatible run modes", (count, ep, labels) => {
    window.history.replaceState({}, "", "?onlineLobby=1&twoPlayerSession=mode-test");
    sessionStorage.setItem(
      "pokerogue-online-membership-v1",
      JSON.stringify({
        lobby: { id: "mode-test", setup: { label: "Test", playerCount: count, enemyPlayer: ep }, partySize: 6 },
        seat: "p1",
      }),
    );
    const start = vi.spyOn(title as any, "startMultiplayerRun").mockImplementation(() => {});
    title["showPlayerCountSelect"](GameModes.CLASSIC);
    expect(options().map(option => option.label)).toEqual([...labels, i18next.t("menu:cancel")]);
    labels.forEach((label, index) => {
      select(label);
      expect(start).toHaveBeenLastCalledWith(GameModes.CLASSIC, count, 6, [], !ep && index === 1, ep);
    });
    title["showPlayerCountSelect"](GameModes.DAILY);
    for (const option of options().slice(0, -1)) {
      expect(option.disabled).toBe(true);
      expect(option.handler()).toBe(false);
    }
  });

  it.each([2, 3] as const)("sends the host's %i-player Vs choice to a guest without assigning CPUs", count => {
    vi.spyOn(title as any, "validateChallengePlayers").mockReturnValue(true);
    vi.spyOn(title as any, "announceTwoPlayerProfileForStartup").mockImplementation(() => {});
    vi.spyOn(title as any, "waitForTwoPlayerProfilesBeforeRun").mockImplementation(() => {});
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(true);
    title["startMultiplayerRun"](GameModes.CLASSIC, count, 6, [], true);
    const message = broadcast.mock.calls[0][0];
    expect(message).toMatchObject({
      playerCount: count,
      vsMode: true,
      enemyPlayerMode: false,
      computerPartnerPlayerIndexes: [],
    });
    game.scene.configureTwoPlayerMode(true, 6, false, count);
    game.scene.twoPlayerLocalInputSeat = 1;
    expect(title["applyRemoteTwoPlayerTitleStart"](JSON.parse(JSON.stringify(message)))).toBe(true);
    expect(game.scene.twoPlayerVsMode).toBe(true);
    expect(game.scene.multiplayerPlayerCount).toBe(count);
    expect(game.scene.twoPlayerComputerPartner).toBe(false);
  });

  it.each([
    [2, false],
    [3, false],
    [1, true],
    [2, true],
    [3, true],
  ] as const)("keeps human seats human when receiving a %i-player EP=%s run start without CPU metadata", (count, ep) => {
    game.scene.configureTwoPlayerMode(true, 6, false, count, [], false, ep);
    game.scene.twoPlayerLocalInputSeat = ep ? "ep" : 1;
    vi.spyOn(title as any, "announceTwoPlayerProfileForStartup").mockImplementation(() => {});
    vi.spyOn(title as any, "waitForTwoPlayerProfilesBeforeRun").mockImplementation(() => {});
    expect(
      title["applyRemoteTwoPlayerTitleStart"]({
        action: "new-run",
        gameMode: GameModes.CLASSIC,
        playerCount: count,
        partySize: 6,
        enemyPlayerMode: ep,
      }),
    ).toBe(true);
    expect(game.scene.twoPlayerComputerPartner).toBe(false);
    expect(game.scene.getComputerPartnerPlayerIndexes()).toEqual([]);
    for (const player of game.scene.getActivePlayerIndexes()) {
      expect(game.scene.isComputerPartnerPlayer(player)).toBe(false);
    }
  });

  it("broadcasts an explicit empty CPU-seat list and reproduces the host configuration on the guest", () => {
    vi.spyOn(title as any, "validateChallengePlayers").mockReturnValue(true);
    vi.spyOn(title as any, "announceTwoPlayerProfileForStartup").mockImplementation(() => {});
    vi.spyOn(title as any, "waitForTwoPlayerProfilesBeforeRun").mockImplementation(() => {});
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(true);
    title["startMultiplayerRun"](GameModes.CLASSIC, 2, 6);
    const message = broadcast.mock.calls[0][0];
    expect(message.computerPartnerPlayerIndexes).toEqual([]);
    const hostSeats = game.scene.getComputerPartnerPlayerIndexes();
    // A stale local CPU selection must also be cleared by the host's explicit configuration.
    game.scene.configureTwoPlayerMode(true, 6, true, 2, [1]);
    game.scene.twoPlayerLocalInputSeat = 1;
    title["applyRemoteTwoPlayerTitleStart"](JSON.parse(JSON.stringify(message)));
    expect(game.scene.getComputerPartnerPlayerIndexes()).toEqual(hostSeats);
    expect(game.scene.twoPlayerComputerPartner).toBe(false);
    expect(new EncounterPhase(false).getComputerPartnerCaptureAnnouncement()).toBeUndefined();
    const command = new CommandPhase(1);
    expect(command["isComputerPartnerCommand"]()).toBe(false);
    const wait = vi.spyOn(game.scene, "waitForPlayerInput");
    command["setActiveCommandPlayer"]();
    expect(wait).toHaveBeenCalledWith(1);
    expect(game.scene.inputOwner).toBe(1);
  });

  it("preserves explicit CPU seats and older keyed CPU starts without inventing extra partners", () => {
    const base: TwoPlayerTitleStart = { action: "new-run", gameMode: GameModes.CLASSIC, playerCount: 3 };
    const seats = (extra: Partial<TwoPlayerTitleStart>) =>
      title["getTitleStartComputerPartnerPlayerIndexes"]({ ...base, ...extra }, 3);
    expect(seats({ computerPartnerPlayerIndexes: [2], computerPartnerKeys: { 2: "alex" } })).toEqual([2]);
    expect(seats({ computerPartnerKeys: { 1: "cheryl" } })).toEqual([1]);
    expect(seats({ computerPartnerPlayerIndexes: [0] })).toEqual([]);
    expect(seats({ computerPartnerPlayerIndexes: [2, 2] })).toEqual([2]);
    expect(seats({ enemyPlayerMode: true, computerPartnerPlayerIndexes: [0, 2] })).toEqual([0, 2]);
    expect(seats({ computerPartnerPlayerIndexes: [], computerPartnerKeys: { 1: "alex" } })).toEqual([]);
  });

  it("preserves LAN host routes and returns to the right parent menus", () => {
    const host = vi.spyOn(title as any, "hostMultiplayerLobby").mockImplementation(() => {});
    title["showMultiplayerSelect"]();
    expect(options().map(option => option.label)).toEqual(["Online", "LAN", "Back"]);
    select("LAN");
    select("Host 2P");
    select(i18next.t("menu:cancel"));
    expect(menu.mock.calls.at(-1)![0]).toBe("LAN / Hamachi");
    select("Host 1P.Vs.EP");
    expect(host).toHaveBeenCalledWith(1, 6, [], true);
    title["showLanMultiplayerSelect"]();
    const cpu = options().find(option => option.label.includes("CPU"))!;
    expect(cpu.disabled).toBe(true);
    expect(cpu.handler()).toBe(false);
    select("Back");
    expect(options().map(option => option.label)).toEqual(["Online", "LAN", "Back"]);
  });

  it("lets users explore Online without opening sockets or navigating to LAN", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_ONLINE_SERVICE_URL", "");
    const socket = vi.spyOn(window, "WebSocket");
    const host = vi.spyOn(title as any, "hostMultiplayerLobby");
    title["showMultiplayerSelect"]();
    select("Online");
    select("Host Game");
    expect(options().map(option => option.label)).toContain("1P + EP");
    expect(options().find(option => option.label.includes("CPU"))?.disabled).toBe(true);
    select("1P + EP");
    expect(options().find(option => option.label === "EP - Open")).toBeDefined();
    expect(
      options()
        .find(option => option.label === "Create Lobby (Unavailable)")
        ?.handler(),
    ).toBe(false);
    select("Back");
    select("Back");
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    select("Join Game");
    expect(mode).toHaveBeenLastCalledWith(
      UiMode.ONLINE_LOBBY,
      expect.objectContaining({
        demo: true,
        lobbies: [expect.objectContaining({ id: "demo-lobby" })],
      }),
    );
    expect(socket).not.toHaveBeenCalled();
    expect(host).not.toHaveBeenCalled();
  });

  it("uses the live directory when a service is configured", () => {
    vi.stubEnv("VITE_ONLINE_SERVICE_URL", "http://127.0.0.1:8788");
    title["showOnlineMultiplayerSelect"]();
    select("Host Game");
    select("3P + EP");
    expect(options().find(option => option.label === "Create Lobby")?.disabled).not.toBe(true);
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    title["showOnlineLobbyBrowser"]();
    expect(mode).toHaveBeenLastCalledWith(
      UiMode.ONLINE_LOBBY,
      expect.objectContaining({
        demo: false,
        lobbies: [],
        loadLobbies: expect.any(Function),
        onJoin: expect.any(Function),
      }),
    );
  });

  it("disables underway listings and identifies occupied or unavailable seats", () => {
    const waiting: OnlineLobbySummary = {
      id: "waiting",
      setup: ONLINE_LOBBY_SETUPS.find(setup => setup.label === "3P + EP")!,
      hostAtMainMenu: true,
      status: "waiting",
      seats: { p1: { displayName: "Daniel" }, p3: { displayName: "Alex" } },
    };
    expect(
      getOnlineLobbySeats(waiting)
        .filter(seat => seat.available)
        .map(seat => seat.seat),
    ).toEqual(["p2", "ep"]);
    expect(getOnlineLobbyLabel(waiting)).toBe("Daniel | 2/3 + 0/1 EP | Waiting");
    const underway: OnlineLobbySummary = { ...waiting, id: "underway", status: "in-progress" };
    expect(isOnlineLobbyJoinable(underway)).toBe(false);
    expect(getOnlineLobbySeats(waiting).map(seat => seat.label)).toContain("P3 - Alex (Occupied)");
    expect(isOnlineLobbyJoinable({ ...waiting, hostAtMainMenu: false })).toBe(false);
    expect(isOnlineLobbyJoinable({ ...waiting, status: "starting" })).toBe(false);
    const full = { ...waiting, seats: { ...waiting.seats, p2: { displayName: "Sam" }, ep: { displayName: "Eve" } } };
    expect(isOnlineLobbyJoinable(full)).toBe(false);
    expect(getOnlineLobbyLabel(full)).toContain("Full");
  });

  it.each(ONLINE_LOBBY_SETUPS)("only offers valid seats for $label", setup => {
    const lobby: OnlineLobbySummary = {
      id: "test",
      setup,
      hostAtMainMenu: true,
      status: "waiting",
      seats: { p1: { displayName: "Host" } },
    };
    const seats = getOnlineLobbySeats(lobby);
    expect(seats.find(seat => seat.seat === "p1")!.available).toBe(false);
    expect(seats.find(seat => seat.seat === "p2")!.available).toBe(setup.playerCount >= 2 && !setup.computerPartner);
    expect(seats.find(seat => seat.seat === "p3")!.available).toBe(setup.playerCount >= 3 && !setup.computerPartner);
    expect(seats.find(seat => seat.seat === "ep")!.available).toBe(setup.enemyPlayer && !setup.computerPartner);
  });

  it("saves only the local display name and preserves it through profile serialization", () => {
    const profile = game.scene.getLocalPlayerGameData();
    const save = vi.spyOn(profile, "saveSystemLocal").mockImplementation(() => {});
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const back = vi.spyOn(title as any, "showOptions").mockResolvedValue(undefined);
    title["showPlayerNameForm"](-1);
    expect(mode.mock.calls.at(-1)![0]).toBe(UiMode.PLAYER_NAME_FORM);
    const config = mode.mock.calls.at(-1)![1] as ModalConfig;
    config.buttonActions[0]("  Zoë   李  ");
    expect(profile.playerDisplayName).toBe("Zoë 李");
    expect(save).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledWith(-1);
    const restored = GameData.fromRawSystem(profile.getSystemSaveDataString(), false);
    expect(restored.getPlayerDisplayName(2)).toBe("Zoë 李");
    const legacy = profile.getSystemSaveData();
    delete legacy.playerDisplayName;
    const legacyRestored = GameData.fromRawSystem(
      JSON.stringify(legacy, (_key, value) => (typeof value === "bigint" ? value.toString() : value)),
      false,
    );
    expect(legacyRestored.getPlayerDisplayName(2)).toBe("Player 3");
  });

  it("keeps the previous name when cancelling or local storage fails", () => {
    const profile = game.scene.getLocalPlayerGameData();
    profile.playerDisplayName = "Before";
    const save = vi.spyOn(profile, "saveSystemLocal").mockImplementation(() => {
      throw new Error("Storage full");
    });
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    vi.spyOn(title as any, "showOptions").mockResolvedValue(undefined);
    title["showPlayerNameForm"](-1);
    const config = mode.mock.calls.at(-1)![1] as ModalConfig;
    config.buttonActions[1]();
    expect(save).not.toHaveBeenCalled();
    config.buttonActions[0]("After");
    expect(profile.playerDisplayName).toBe("Before");
  });

  it("bounds names and removes markup before it reaches menus or dialogue", () => {
    expect(normalizePlayerDisplayName("[{}]$\\<>\n")).toBe("");
    expect(normalizePlayerDisplayName("A".repeat(40))).toHaveLength(20);
    expect(normalizePlayerDisplayName(null)).toBe("");
  });
});
