import { Battle } from "#app/battle";
import { modifierTypes } from "#data/data-lists";
import { Stat } from "#enums/stat";
import { BaseStatModifier } from "#modifiers/modifier";
import { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { SettingKeys } from "#system/settings";
import { getModifierType } from "#utils/modifier-utils";
import { getSessionDataLocalStorageKey, GUEST_SAVE_SLOT, loggedInUser, updateUserInfo } from "#app/account";
import { BattleType } from "#enums/battle-type";
import { SpeciesId } from "#enums/species-id";
import { Button } from "#enums/buttons";
import { Pokemon } from "#field/pokemon";
import { TitlePhase } from "#phases/title-phase";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { UiMode } from "#enums/ui-mode";
import { SaveSlotUiMode, type SaveSlotSelectUiHandler } from "#ui/save-slot-select-ui-handler";
import { decrypt } from "#utils/data";
import { bypassLogin } from "#constants/app-constants";
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

  it("restores the host snapshot into the reserved guest slot and waits for matching commit", async () => {
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
    expect(game.scene.sessionSlotId).toBe(GUEST_SAVE_SLOT);
    expect(read).not.toHaveBeenCalled();
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

  it("restores saved Player Card appearances even when current profiles have changed", async () => {
    game.scene.restoreRunPlayerAppearances({ 0: "sabrina_back", 1: "riley_back" });
    const saved = snapshot();
    game.scene.getLocalPlayerCardProfile().playerCharacterId = "whitney_back";
    game.scene.restoreRunPlayerAppearances({ 0: "buck_back", 1: "cheryl_back" });
    await prepare(saved);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "load-ready" }));
    expect(game.scene.getRunPlayerAppearances()).toEqual({ 0: "sabrina_back", 1: "riley_back" });
    expect(game.scene.getTrainerBackTextureKey(0)).toBe("sabrina_back");
    expect(game.scene.getTrainerBackTextureKey(1)).toBe("riley_back");
  });

  it("fails saved-run preparation clearly for an unknown Player Card character", async () => {
    const saved = JSON.parse(snapshot());
    saved.playerAppearances = { 0: "future-character" };
    await prepare(JSON.stringify(saved));
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ type: "load-failed", message: expect.stringContaining("same game build") }));
  });

  it.each(["none", "settings", "intermediate-recalculation"])("preserves all three parties' vitamin stats and HP during %s", async interruption => {
    const originalSeat = game.scene.twoPlayerLocalInputSeat;
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.twoPlayerLocalInputSeat = 1;
    const species = [SpeciesId.MAGEARNA, SpeciesId.ORICORIO, SpeciesId.BLISSEY];
    for (const playerIndex of [0, 1, 2] as const) {
      const party = game.scene.getPlayerParty(playerIndex);
      party.splice(0);
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species[playerIndex]), 56);
      pokemon.ivs.fill(31);
      party.push(pokemon);
      game.scene.setActivePlayerIndex(playerIndex);
      const generator = getModifierType(modifierTypes.BASE_STAT_BOOSTER) as ModifierTypeGenerator;
      const vitamin = generator.generateType(party, [Stat.HP])!.newModifier(pokemon) as BaseStatModifier;
      await game.scene.addModifier(vitamin, true);
      pokemon.calculateStats();
      pokemon.hp = pokemon.getMaxHp() - 6;
      const fainted = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 56);
      fainted.hp = 0;
      party.push(fainted);
    }
    game.scene.setActivePlayerIndex(0);
    const data = snapshot();
    const expected = game.scene.getActivePlayerIndexes().map(playerIndex =>
      game.scene.getPlayerParty(playerIndex).map(p => ({ hp: p.hp, stats: [...p.stats] })),
    );
    const loadBiomeAssets = game.scene.loadBiomeAssets.bind(game.scene);
    vi.spyOn(game.scene, "loadBiomeAssets").mockImplementation(async biome => {
      if (interruption === "settings") {
        expect(game.scene.applyTwoPlayerSettingsSnapshot({ settings: { [SettingKeys.Ace_Mechanics]: 0 } })).toBe(true);
        expect(game.scene.getActivePlayerIndexes().map(playerIndex =>
          game.scene.getPlayerParty(playerIndex).map(p => ({ hp: p.hp, stats: [...p.stats] })),
        )).toEqual(expected);
      } else if (interruption === "intermediate-recalculation") {
        for (const playerIndex of game.scene.getActivePlayerIndexes()) {
          for (const pokemon of game.scene.getPlayerParty(playerIndex)) pokemon.calculateStats();
        }
      }
      await loadBiomeAssets(biome);
    });

    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        await game.scene.gameData.loadSessionSnapshot(data);
        expect(game.scene.getActivePlayerIndexes().map(playerIndex =>
          game.scene.getPlayerParty(playerIndex).map(p => ({ hp: p.hp, stats: [...p.stats] })),
        )).toEqual(expected);
      }
      expect(game.scene.isRestoringSession).toBe(false);
    } finally {
      game.scene.twoPlayerLocalInputSeat = originalSeat;
      game.scene.configureTwoPlayerMode(true, 6, false, 2);
    }
  });

  it("clears the restore guard after an asset failure and allows retrying the same save", async () => {
    const data = snapshot();
    vi.spyOn(game.scene, "loadBiomeAssets").mockRejectedValueOnce(new Error("asset failure"));
    await expect(game.scene.gameData.loadSessionSnapshot(data)).rejects.toThrow("asset failure");
    expect(game.scene.isRestoringSession).toBe(false);
    await game.scene.gameData.loadSessionSnapshot(data);
    expect(game.scene.isRestoringSession).toBe(false);
  });

  it.each(["p2", "p3", "ep"] as const)("%s can resume with full personal slots without overwriting existing saves", async seat => {
    member.seat = seat;
    saveMembership();
    const keys = Array.from({ length: 6 }, (_, slot) => getSessionDataLocalStorageKey(slot));
    keys.forEach(key => localStorage.setItem(key, `previous-${key}`));
    const saved = game.scene.gameData.getSessionSaveData();
    vi.spyOn(game.scene.gameData, "getSession").mockResolvedValue(saved);
    const restore = vi.spyOn(game.scene.gameData, "loadSessionSnapshot");
    await prepare();
    expect(restore).toHaveBeenCalled();
    expect(game.scene.sessionSlotId).toBe(GUEST_SAVE_SLOT);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: "load-ready" }),
    );
    keys.forEach(key => expect(localStorage.getItem(key)).toBe(`previous-${key}`));
    title["onOnlineSaveControl"]({ type: "load-abort" });
    keys.forEach(key => expect(localStorage.getItem(key)).toBe(`previous-${key}`));
    keys.forEach(key => localStorage.removeItem(key));
  });

  it.each(["p2", "p3", "ep"] as const)("%s starts in the guest slot without opening save menus or starting early", async seat => {
    member.seat = seat;
    saveMembership();
    const phase = new SelectStarterPhase();
    const start = vi.fn();
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    phase["selectSaveSlot"](start);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "start-wait" })));
    onlineSaveSession.receive?.({ type: "start-prepare", startId: "start-1" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "start-ready", startId: "start-1" }));
    expect(mode.mock.calls.some(([value]) => value === UiMode.SAVE_SLOT)).toBe(false);
    expect(game.scene.sessionSlotId).toBe(GUEST_SAVE_SLOT);
    expect(start).not.toHaveBeenCalled();
    onlineSaveSession.receive?.({ type: "start-commit", startId: "stale" });
    expect(start).not.toHaveBeenCalled();
    onlineSaveSession.receive?.({ type: "start-commit", startId: "start-1" });
    onlineSaveSession.receive?.({ type: "start-commit", startId: "start-1" });
    expect(start).toHaveBeenCalledOnce();
    expect(onlineSaveSession.loading).toBe(false);
  });

  it("the host privately chooses a personal slot and waits for the all-seat commit", async () => {
    member.seat = "p1";
    saveMembership();
    const phase = new SelectStarterPhase();
    const start = vi.fn();
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    phase["selectSaveSlot"](start);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "start-wait" })));
    onlineSaveSession.receive?.({ type: "start-prepare", startId: "start-1" });
    expect(onlineSaveSession.localMenu).toBe(true);
    const call = mode.mock.calls.find(([value]) => value === UiMode.SAVE_SLOT)!;
    expect(call[3]).toBe(true); // Defer overwriting until the run actually autosaves.
    (call[2] as (slot: number) => void)(4);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "start-ready", startId: "start-1" }));
    expect(onlineSaveSession.localMenu).toBe(false);
    expect(game.scene.sessionSlotId).toBe(4);
    expect(start).not.toHaveBeenCalled();
    onlineSaveSession.receive?.({ type: "start-commit", startId: "start-1" });
    expect(start).toHaveBeenCalledOnce();
  });

  it("host cancellation returns every client to the title and ignores late startup callbacks", async () => {
    member.seat = "p1";
    saveMembership();
    const phase = new SelectStarterPhase();
    const start = vi.fn();
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const toTitle = vi.spyOn(game.scene.phaseManager, "toTitleScreen").mockImplementation(() => {});
    vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    phase["selectSaveSlot"](start);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "start-wait" })));
    onlineSaveSession.receive?.({ type: "start-prepare", startId: "start-1" });
    const choose = mode.mock.calls.find(([value]) => value === UiMode.SAVE_SLOT)![2] as (slot: number) => void;
    choose(-1);
    expect(send).toHaveBeenLastCalledWith({ type: "start-cancel", startId: "start-1" });
    expect(toTitle).not.toHaveBeenCalled();
    onlineSaveSession.receive?.({ type: "start-cancel", startId: "start-1", seed: game.scene.seed });
    expect(toTitle).toHaveBeenCalledOnce();
    choose(0);
    expect(start).not.toHaveBeenCalled();
    expect(onlineSaveSession.receive).toBeUndefined();
    expect(onlineSaveSession.loading).toBe(false);
  });

  it("disconnecting before commit prevents a guest from starting", async () => {
    const phase = new SelectStarterPhase();
    const start = vi.fn();
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    phase["selectSaveSlot"](start);
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "start-wait" })));
    onlineSaveSession.receive?.({ type: "start-prepare", startId: "start-1" });
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith({ type: "start-ready", startId: "start-1" }));
    onlineSaveSession.receive?.({ type: "load-abort" });
    onlineSaveSession.receive?.({ type: "start-commit", startId: "start-1" });
    expect(start).not.toHaveBeenCalled();
    expect(onlineSaveSession.loading).toBe(true);
  });

  it("guest autosaving and cleanup preserve personal slots and permanent profile progress", async () => {
    // GameManager's reload helper normally intercepts saves into an in-memory snapshot.
    vi.mocked(game.scene.gameData.saveAll).mockRestore();
    await updateUserInfo();
    const keys = Array.from({ length: 5 }, (_, slot) => getSessionDataLocalStorageKey(slot));
    keys.forEach(key => localStorage.setItem(key, `personal-${key}`));
    const guestKey = getSessionDataLocalStorageKey(GUEST_SAVE_SLOT);
    game.scene.twoPlayerLocalInputSeat = 1;
    game.scene.markLocalPlayerSystemSaveLoaded();
    const profile = game.scene.getLocalPlayerGameData();
    profile.starterData[SpeciesId.BULBASAUR].candyCount = 123;
    vi.spyOn(game.scene, "isLocalPlayerSystemSaveLoaded").mockReturnValue(true);
    vi.spyOn(profile, "verify").mockResolvedValue(true);
    game.scene.sessionSlotId = GUEST_SAVE_SLOT;
    expect(await game.scene.gameData.saveAll(true)).toBe(true);
    expect((await game.scene.gameData.getSession(GUEST_SAVE_SLOT))?.waveIndex).toBe(23);
    const profileKey = `data_${loggedInUser?.username}`;
    const savedProfile = localStorage.getItem(profileKey)!;
    expect(JSON.parse(decrypt(savedProfile, bypassLogin)).starterData[SpeciesId.BULBASAUR].candyCount).toBe(123);
    await updateUserInfo();
    expect(loggedInUser?.lastSessionSlot).toBeLessThan(GUEST_SAVE_SLOT);
    await game.scene.gameData.tryClearSession(GUEST_SAVE_SLOT);
    expect(localStorage.getItem(guestKey)).toBeFalsy();
    expect(localStorage.getItem(profileKey)).toBe(savedProfile);
    keys.forEach(key => expect(localStorage.getItem(key)).toBe(`personal-${key}`));
    keys.forEach(key => localStorage.removeItem(key));
  });

  it.each([true, false])("Online slot selection preserves the previous save (occupied=%s)", async occupied => {
    const handler = game.scene.ui.handlers[UiMode.SAVE_SLOT] as SaveSlotSelectUiHandler;
    const selected = vi.fn();
    handler["uiMode"] = SaveSlotUiMode.SAVE;
    handler["deferOverwrite"] = true;
    handler["saveSlotSelectCallback"] = selected;
    handler["sessionSlots"] = [{ hasData: occupied }] as any;
    handler["cursor"] = 0;
    handler["scrollCursor"] = 0;
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    vi.spyOn(game.scene.ui, "revertMode").mockResolvedValue(true);
    const text = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const overlay = vi.spyOn(game.scene.ui, "setOverlayMode").mockResolvedValue(undefined);
    const remove = vi.spyOn(game.scene.gameData, "deleteSession");
    handler.processInput(Button.ACTION);
    if (occupied) {
      expect(selected).not.toHaveBeenCalled();
      (text.mock.calls.at(-1)![2] as () => void)();
      expect(overlay.mock.calls.at(-1)![0]).toBe(UiMode.CONFIRM);
      (overlay.mock.calls.at(-1)![1] as () => void)();
    }
    expect(selected).toHaveBeenCalledWith(0);
    expect(remove).not.toHaveBeenCalled();
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
