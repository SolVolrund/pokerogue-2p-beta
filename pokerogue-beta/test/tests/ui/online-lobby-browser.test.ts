import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { OnlineLobbyUiHandler } from "#ui/online-lobby-ui-handler";
import {
  createDemoOnlineLobby,
  getOnlineLobbyHostName,
  getOnlineLobbySeatCount,
  getOnlineLobbySeats,
} from "#utils/online-lobby";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Online lobby browser", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let handler: OnlineLobbyUiHandler;
  let cancel: ReturnType<typeof vi.fn>;

  afterEach(() => handler?.clear());

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    handler = game.scene.ui.handlers[UiMode.ONLINE_LOBBY] as OnlineLobbyUiHandler;
    cancel = vi.fn();
    handler.show([{ lobbies: [createDemoOnlineLobby()], demo: true, onCancel: cancel }]);
  });

  it("shows the selected Vs mode for a run already underway", () => {
    const lobby = createDemoOnlineLobby();
    lobby.setup = { label: "3P", playerCount: 3, enemyPlayer: false };
    lobby.runMode = "vs";
    lobby.status = "in-progress";
    lobby.hostAtMainMenu = false;
    handler.updateLobbies([lobby]);
    expect(handler["setupText"].text).toContain("P.Vs.P.Vs.P");
    expect(handler["availableSeats"]()).toEqual([]);
  });

  it("previews P2 and EP without starting a session, changing seats, or opening a socket", () => {
    const socket = vi.spyOn(window, "WebSocket");
    const multiplayer = vi.spyOn(game.scene, "configureTwoPlayerMode");
    expect(handler["headerStatus"].text).toBe("Offline demo");
    expect(handler["rows"][0].host.text).toBe("Daniel");
    expect(handler["rows"][0].count.text).toBe("2/3 + 0/1");
    expect(handler["roster"][2].name.text).toBe("Alex");
    expect(handler["roster"][2].status.text).toBe("[Occupied]");
    expect(handler.processInput(Button.ACTION)).toBe(true);
    expect(handler["seatCursor"]).toBe(1);
    handler.processInput(Button.RIGHT);
    expect(handler["seatCursor"]).toBe(3);
    handler.processInput(Button.RIGHT);
    expect(handler["seatCursor"]).toBe(1);
    handler.processInput(Button.LEFT);
    expect(handler["seatCursor"]).toBe(3);
    handler.processInput(Button.ACTION);
    expect(handler["feedbackText"].text).toContain("Demo: EP selected");
    expect(handler["lobbies"][0].seats.ep).toBeUndefined();
    expect(socket).not.toHaveBeenCalled();
    expect(multiplayer).not.toHaveBeenCalled();
    handler.processInput(Button.CANCEL);
    expect(handler["seatCursor"]).toBe(-1);
    expect(cancel).not.toHaveBeenCalled();
    handler.processInput(Button.CANCEL);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("joins the selected live seat once and rejects late directory results after closing", async () => {
    let finishJoin: () => void = () => {};
    const onJoin = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finishJoin = resolve;
        }),
    );
    handler.show([{ lobbies: [createDemoOnlineLobby()], onJoin, onCancel: cancel }]);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.ACTION);
    expect(onJoin).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: "demo-lobby" }), "p2");
    finishJoin();
    await Promise.resolve();
    let finishLoad: (lobbies: ReturnType<typeof createDemoOnlineLobby>[]) => void = () => {};
    handler.show([
      {
        lobbies: [],
        onCancel: cancel,
        loadLobbies: () =>
          new Promise(resolve => {
            finishLoad = resolve;
          }),
      },
    ]);
    handler.clear();
    finishLoad([createDemoOnlineLobby()]);
    await Promise.resolve();
    expect(handler["lobbies"]).toEqual([]);
  });

  it("clears stale lobby listings when the directory cannot be reached", async () => {
    handler.show([
      { lobbies: [createDemoOnlineLobby()], onCancel: cancel, loadLobbies: () => Promise.reject(new Error("offline")) },
    ]);
    await Promise.resolve();
    expect(handler["lobbies"]).toEqual([]);
    expect(handler["headerStatus"].text).toBe("Service unavailable");
  });

  it("scrolls and wraps a large list, keeping the selected lobby when directory order changes", () => {
    const lobbies = Array.from({ length: 12 }, (_, index) => ({ ...createDemoOnlineLobby(), id: `lobby-${index}` }));
    handler.updateLobbies(lobbies);
    for (let i = 0; i < 8; i++) {
      handler.processInput(Button.DOWN);
    }
    expect(handler.getCursor()).toBe(8);
    expect(handler["scrollOffset"]).toBe(2);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.CANCEL);
    expect(handler.getCursor()).toBe(8);
    expect(handler["scrollOffset"]).toBe(2);
    handler.updateLobbies([...lobbies].reverse());
    expect(handler["lobbies"][handler.getCursor()].id).toBe("lobby-8");
    handler.updateLobbies(lobbies);
    for (let i = 0; i < 4; i++) {
      handler.processInput(Button.DOWN);
    }
    expect(handler.getCursor()).toBe(0);
    expect(handler["scrollOffset"]).toBe(0);
    handler.processInput(Button.UP);
    expect(handler.getCursor()).toBe(11);
    expect(handler["scrollOffset"]).toBe(5);
  });

  it("keeps full and underway lobbies inspectable but blocks seat confirmation", () => {
    const lobby = createDemoOnlineLobby();
    handler.updateLobbies([{ ...lobby, status: "in-progress" }]);
    expect(handler["hostText"].text).toBe("Daniel");
    expect(handler["statusText"].text).toBe("In progress");
    expect(handler.processInput(Button.ACTION)).toBe(false);
    handler.updateLobbies([{ ...lobby, hostAtMainMenu: false }]);
    expect(handler.processInput(Button.ACTION)).toBe(false);
    handler.updateLobbies([{ ...lobby, status: "starting" }]);
    expect(handler.processInput(Button.ACTION)).toBe(false);
    handler.updateLobbies([
      {
        ...lobby,
        seats: { ...lobby.seats, p2: { displayName: "Sam" }, ep: { displayName: "Eve" } },
      },
    ]);
    expect(handler["statusText"].text).toBe("Full");
    expect(handler.processInput(Button.ACTION)).toBe(false);
  });

  it("returns to the list if a selected seat fills or the selected lobby disappears", () => {
    handler.processInput(Button.ACTION);
    const lobby = createDemoOnlineLobby();
    handler.updateLobbies([{ ...lobby, seats: { ...lobby.seats, p2: { displayName: "Sam" } } }]);
    expect(handler["seatCursor"]).toBe(-1);
    handler.processInput(Button.ACTION);
    expect(handler["seatCursor"]).toBe(3);
    const emptyVisibility = vi.spyOn(handler["emptyText"], "setVisible");
    handler.updateLobbies([]);
    expect(handler["seatCursor"]).toBe(-1);
    expect(emptyVisibility).toHaveBeenLastCalledWith(true);
    expect(handler["listCursor"].visible).toBe(false);
    expect(handler.processInput(Button.ACTION)).toBe(false);
    handler.processInput(Button.CANCEL);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("shows zero EP capacity for co-op and separates host identity from their seat", () => {
    const lobby = createDemoOnlineLobby();
    const coop = { ...lobby, setup: { ...lobby.setup, enemyPlayer: false } };
    expect(getOnlineLobbySeatCount(coop)).toBe("2/3 + 0/0");
    handler.updateLobbies([coop]);
    handler.processInput(Button.ACTION);
    handler.processInput(Button.RIGHT);
    expect(handler["seatCursor"]).toBe(1);
    const enemyHost = { ...lobby, hostSeat: "ep" as const, seats: { ep: { displayName: "Daniel" } } };
    expect(getOnlineLobbyHostName(enemyHost)).toBe("Daniel");
    expect(getOnlineLobbySeats(enemyHost)[3].status).toBe("Host");
    expect(getOnlineLobbySeats(enemyHost)[0].status).toBe("Open");
    expect(getOnlineLobbySeats(enemyHost)[0].available).toBe(false);
  });

  it("resets the roster and seat focus when reopened", () => {
    handler.updateLobbies([
      {
        ...createDemoOnlineLobby(),
        hostDisplayName: "WWWWWWWWWWWWWWWWWWWW",
        seats: { p1: { displayName: "WWWWWWWWWWWWWWWWWWWW" } },
      },
    ]);
    handler.processInput(Button.ACTION);
    handler.clear();
    expect(handler["container"].visible).toBe(false);
    expect(handler.processInput(Button.ACTION)).toBe(false);
    handler.show([{ lobbies: [createDemoOnlineLobby()], demo: true, onCancel: cancel }]);
    expect(handler["seatCursor"]).toBe(-1);
    expect(handler["feedbackText"].text).toBe("");
    expect(handler["hostText"].text).toBe("Daniel");
  });
});
