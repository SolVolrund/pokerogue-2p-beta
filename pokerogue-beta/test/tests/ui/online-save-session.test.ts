import { Battle } from "#app/battle";
import { BattleType } from "#enums/battle-type";
import { SpeciesId } from "#enums/species-id";
import { Button } from "#enums/buttons";
import { Pokemon } from "#field/pokemon";
import { TitlePhase } from "#phases/title-phase";
import { GameManager } from "#test/framework/game-manager";
import type { SessionSaveData } from "#types/save-data";
import type { OnlineMembership } from "#utils/online-lobby-client";
import {
  hashOnlineSave,
  onlineLoadedState,
  onlineSaveSession,
  validateOnlineSessionSave,
} from "#utils/online-save-session";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Online saved-run handoff", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let title: TitlePhase;
  let member: OnlineMembership;
  const initialUrl = window.location.href;
  const send = vi.fn(() => true);
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    title = new TitlePhase();
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    game.scene.setSeed("online-resume-test");
    // The headless sprite mock has no current animation frame.
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 23,
      battleType: BattleType.WILD,
      double: true,
    });
    for (const player of [0, 1] as const) {
      game.scene
        .getPlayerParty(player)
        .push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 20 + player));
      game.scene.getPlayerState(player).money = 1000 + player;
    }
    member = {
      lobby: {
        id: "resume-test",
        hostDisplayName: "Host",
        setup: { playerCount: 2, enemyPlayer: false, label: "2P" },
        partySize: 6,
        seats: { p1: { displayName: "Host" }, p2: { displayName: "Guest" } },
        status: "waiting",
        hostAtMainMenu: true,
      },
      seat: "p2",
      token: "local-test-token",
      expiresAt: Date.now() + 120000,
    };
    window.history.replaceState({}, "", "?onlineLobby=1&twoPlayerSession=resume-test");
    saveMembership();
    onlineSaveSession.send = send;
    onlineSaveSession.loading = false;
    onlineSaveSession.localMenu = false;
    send.mockClear();
    vi.spyOn(game.scene, "waitForTwoPlayerProfileExchange").mockResolvedValue(true);
  });
  afterEach(() => {
    title["onOnlineSaveControl"]({ type: "load-abort" });
    onlineSaveSession.loading = false;
    onlineSaveSession.localMenu = false;
    onlineSaveSession.send = undefined;
    onlineSaveSession.receive = undefined;
    window.history.replaceState({}, "", initialUrl);
    sessionStorage.removeItem("pokerogue-online-membership-v1");
  });
  function saveMembership() {
    sessionStorage.setItem("pokerogue-online-membership-v1", JSON.stringify(member));
  }
  function snapshot(): string {
    return JSON.stringify(game.scene.gameData.getSessionSaveData(), (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
  }
  async function prepare(data = snapshot()) {
    const hash = await hashOnlineSave(data);
    title["onlineLoadId"] = "load-test";
    onlineSaveSession.loading = true;
    await title["prepareOnlineSave"]("load-test", data, hash);
    return hash;
  }

  it("restores the host snapshot into a free guest slot and waits for matching commit", async () => {
    const data = snapshot();
    const unrelated = game.scene.gameData.getSessionSaveData();
    const read = vi
      .spyOn(game.scene.gameData, "getSession")
      .mockImplementation(async slot => (slot < 2 ? unrelated : undefined));
    const localProfile = game.scene.gameData.starterData;
    game.scene.getPlayerParty(0)[0].hp = 1;
    game.scene.getPlayerState(1).money = 7;
    const ended = vi.spyOn(title, "end").mockImplementation(() => {});
    const hash = await prepare(data);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "load-ready", loadId: "load-test", snapshotHash: hash }),
    );
    expect(game.scene.sessionSlotId).toBe(2);
    expect(read.mock.calls.map(([slot]) => slot)).toEqual([0, 1, 2]);
    expect(game.scene.getPlayerMoney(1)).toBe(1001);
    expect(game.scene.getPlayerParty(0)[0].hp).toBe(JSON.parse(data).players[0].party[0].hp);
    expect(game.scene.currentBattle.waveIndex).toBe(23);
    expect(game.scene.gameData.starterData).toBe(localProfile);
    expect(ended).not.toHaveBeenCalled();
    title["onOnlineSaveControl"]({ type: "load-commit", loadId: "stale" });
    expect(ended).not.toHaveBeenCalled();
    title["onOnlineSaveControl"]({ type: "load-commit", loadId: "load-test" });
    expect(ended).toHaveBeenCalledOnce();
    expect(title["loaded"]).toBe(true);
    expect(onlineSaveSession.loading).toBe(false);
  });

  it("the host keeps the chosen slot and restores the same bytes as guests", async () => {
    member.seat = "p1";
    saveMembership();
    title["onlineHostLoadSlot"] = 4;
    const read = vi.spyOn(game.scene.gameData, "getSession");
    await prepare();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "load-ready" }));
    expect(game.scene.sessionSlotId).toBe(4);
    expect(read).not.toHaveBeenCalled();
  });

  it("full guest slots fail without restoring or overwriting any save", async () => {
    const saved = game.scene.gameData.getSessionSaveData();
    vi.spyOn(game.scene.gameData, "getSession").mockResolvedValue(saved);
    const restore = vi.spyOn(game.scene.gameData, "loadSessionSnapshot");
    await prepare();
    expect(restore).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "load-failed", message: expect.stringContaining("empty save slot") }),
    );
  });

  it("corrupt bytes and profile timeouts fail; an abort prevents a late commit", async () => {
    const restore = vi.spyOn(game.scene.gameData, "loadSessionSnapshot");
    title["onlineLoadId"] = "load-test";
    await title["prepareOnlineSave"]("load-test", snapshot(), "wrong-hash");
    expect(restore).not.toHaveBeenCalled();
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "load-failed" }));
    vi.spyOn(game.scene.gameData, "getSession").mockResolvedValue(undefined);
    vi.mocked(game.scene.waitForTwoPlayerProfileExchange).mockResolvedValue(false);
    await prepare();
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "load-failed", message: "Player profile exchange timed out." }),
    );
    title["onlineLoadPrepared"] = true;
    title["onOnlineSaveControl"]({ type: "load-abort" });
    const ended = vi.spyOn(title, "end");
    title["onOnlineSaveControl"]({ type: "load-commit", loadId: "load-test" });
    expect(ended).not.toHaveBeenCalled();
    expect(onlineSaveSession.loading).toBe(true);
  });

  it("only the host browses slots, and cancellation resets both title menus", async () => {
    const overlay = vi.spyOn(game.scene.ui, "setOverlayMode").mockResolvedValue(undefined);
    title["openOnlineSaveMenu"]();
    expect(overlay).not.toHaveBeenCalled();
    member.seat = "p1";
    saveMembership();
    title["openOnlineSaveMenu"]();
    expect(onlineSaveSession.localMenu).toBe(true);
    const choose = overlay.mock.calls.at(-1)![2] as (slot: number) => void;
    choose(-1);
    expect(send).toHaveBeenLastCalledWith({ type: "title-reset" });
    const show = vi.spyOn(title as any, "showOptions").mockResolvedValue(undefined);
    title["onOnlineSaveControl"]({ type: "title-reset" });
    expect(show).toHaveBeenCalled();
    expect(onlineSaveSession.localMenu).toBe(false);
  });

  it("keeps the opening press, slot navigation, and cancellation out of the input relay", () => {
    const inputs = game.scene.uiInputs;
    const relay = {
      getInputReadinessBlockReason: () => undefined,
      shouldRequestHostAuthority: () => false,
      send: vi.fn(),
    };
    inputs["twoPlayerInputTransport"] = relay as any;
    const process = vi.spyOn(inputs as any, "processButtonInput").mockImplementation(() => {
      onlineSaveSession.localMenu = true;
      return true;
    });
    inputs["processLocalButtonInput"](Button.ACTION, true);
    expect(relay.send).not.toHaveBeenCalled();
    process.mockImplementation(() => true);
    inputs["processLocalButtonInput"](Button.DOWN, true);
    expect(relay.send).not.toHaveBeenCalled();
    process.mockImplementation(() => {
      onlineSaveSession.localMenu = false;
      return true;
    });
    inputs["processLocalButtonInput"](Button.CANCEL, true);
    expect(relay.send).not.toHaveBeenCalled();
    inputs["processLocalButtonInput"](Button.DOWN, true);
    expect(relay.send).toHaveBeenCalledOnce();
    inputs["twoPlayerInputTransport"] = undefined;
  });

  it.each([
    [2, false],
    [3, false],
    [1, true],
    [2, true],
    [3, true],
  ] as const)("accepts matching %i-player EP=%s saves", (count, ep) => {
    const saved = game.scene.gameData.getSessionSaveData();
    saved.multiplayerPlayerCount = count;
    saved.twoPlayerEnemyPlayerMode = ep;
    saved.players = Array.from({ length: count }, () => saved.players![0]);
    member.lobby.setup = { playerCount: count, enemyPlayer: ep, label: "Test lobby" };
    expect(() => validateOnlineSessionSave(saved, member)).not.toThrow();
  });

  it.each([
    [2, false, false],
    [3, false, false],
    [1, true, false],
    [2, true, false],
    [3, true, false],
    [2, false, true],
    [3, false, true],
  ] as const)("restores %i-player EP=%s Vs=%s runs consistently across seats", async (count, ep, vs) => {
    game.scene.configureTwoPlayerMode(true, 6, false, count, [], vs, ep);
    if (count === 3)
      game.scene.getPlayerParty(2).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 22));
    member.lobby.setup = { playerCount: count, enemyPlayer: ep, label: "Test lobby" };
    if (vs) game.scene.setVsEnemyTokenPurchaseState(1, { lowerTierPurchasesSinceHighest: 2 });
    const data = snapshot();
    member.seat = "p1";
    title["onlineHostLoadSlot"] = 0;
    saveMembership();
    await prepare(data);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "load-ready" }));
    const firstState = onlineLoadedState(game.scene.getTwoPlayerDebugStateCheckpoint()!.summary);
    title["onOnlineSaveControl"]({ type: "load-abort" });
    member.seat = ep ? "ep" : "p2";
    saveMembership();
    vi.spyOn(game.scene.gameData, "getSession").mockResolvedValue(undefined);
    game.scene.setSeed("different-local-seed");
    await prepare(data);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "load-ready" }));
    expect(game.scene.multiplayerPlayerCount).toBe(count);
    expect(game.scene.twoPlayerEnemyPlayerMode).toBe(ep);
    expect(game.scene.twoPlayerVsMode).toBe(vs);
    if (vs) expect(game.scene.getVsEnemyTokenPurchaseState(1).lowerTierPurchasesSinceHighest).toBe(2);
    expect(onlineLoadedState(game.scene.getTwoPlayerDebugStateCheckpoint()!.summary)).toBe(firstState);
  });

  it("rejects mismatched settings and legacy CPU metadata", () => {
    const saved = game.scene.gameData.getSessionSaveData();
    for (const mismatch of [
      { multiplayerPlayerCount: 3 },
      { twoPlayerPartySize: 3 },
      { twoPlayerEnemyPlayerMode: true },
      { twoPlayerComputerPartner: true },
      { computerPartnerKeys: { 1: "alex" } },
      { computerPartnerPlayerIndexes: [1] },
      { players: [{ party: [{}] }, { party: [{ computerPartnerAce: true }] }] },
    ]) {
      expect(() => validateOnlineSessionSave({ ...saved, ...mismatch } as SessionSaveData, member)).toThrow(
        "does not match",
      );
    }
  });

  it("rejects Vs saves in EP lobbies while accepting either human-only run mode", () => {
    const save = game.scene.gameData.getSessionSaveData();
    save.twoPlayerVsMode = true;
    expect(() => validateOnlineSessionSave(save, member)).not.toThrow();
    member.lobby.setup.enemyPlayer = true;
    save.twoPlayerEnemyPlayerMode = true;
    expect(() => validateOnlineSessionSave(save, member)).toThrow("does not match");
  });

  it("compares restored gameplay independently of each client's menu and input ownership", () => {
    const state = game.scene.getTwoPlayerDebugStateCheckpoint()!.summary;
    expect(onlineLoadedState(state)).toBe(
      onlineLoadedState({ ...state, uiMode: 999, inputOwner: "ep", activePlayerIndex: 2 }),
    );
    expect(onlineLoadedState(state)).not.toBe(onlineLoadedState({ ...state, seed: "different" }));
    expect(onlineLoadedState(state)).not.toBe(onlineLoadedState({ ...state, twoPlayerVsMode: true }));
    expect(onlineLoadedState(state)).not.toBe(
      onlineLoadedState({ ...state, vsEnemyTokenPurchaseStateByPlayer: [{ lowerTierPurchasesSinceHighest: 1 }] }),
    );
  });
});
