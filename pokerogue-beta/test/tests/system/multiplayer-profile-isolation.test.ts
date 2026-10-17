import { pokerogueApi } from "#api/api";
import { GUEST_SAVE_SLOT, getSessionDataLocalStorageKey, loggedInUser, updateUserInfo } from "#app/account";
import { Battle } from "#app/battle";
import * as appConstants from "#constants/app-constants";
import { BattleType } from "#enums/battle-type";
import { DexAttr } from "#enums/dex-attr";
import { SpeciesId } from "#enums/species-id";
import { Unlockables } from "#enums/unlockables";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import { decrypt } from "#utils/data";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Multiplayer permanent profile isolation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let own: GameData;
  const originalUrl = window.location.href;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    own = new GameData(true);
    game.scene.gameData = own;
    vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(true);
    await updateUserInfo();
    vi.spyOn(GameData.prototype, "verify").mockResolvedValue(true);
    own.trainerId = 123;
    own.secretId = 456;
    own.playerDisplayName = "Former EP";
    own.playerCharacterId = "sabrina_back";
    own.unlocks[Unlockables.ENDLESS_MODE] = false;
    own.achvUnlocks = { MONO_WATER: 100 };
    own.dexData[SpeciesId.MEWTWO].caughtAttr = 0n;
    own.starterData[SpeciesId.BULBASAUR].candyCount = 17;
    own.starterData[SpeciesId.BULBASAUR].passiveAttr = 0;
    game.scene.markLocalPlayerSystemSaveLoaded();
    own.saveSystemLocal();
    window.history.replaceState({}, "", "?onlineLobby=1&twoPlayerSession=profile-isolation");
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
    window.history.replaceState({}, "", originalUrl);
    localStorage.removeItem(`data_${loggedInUser?.username}`);
    localStorage.removeItem(getSessionDataLocalStorageKey(GUEST_SAVE_SLOT));
  });

  function joinRun(seat: 0 | 1 | 2 | "ep") {
    game.scene.twoPlayerLocalInputSeat = seat;
    game.scene.configureTwoPlayerMode(true, 6, false, 3, [], false, true);
    game.scene.setSeed("profile-isolation");
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 200,
      battleType: BattleType.WILD,
      double: true,
    });
    game.scene.sessionSlotId = GUEST_SAVE_SLOT;
    for (const playerIndex of [0, 1, 2] as const) {
      if (playerIndex === seat) {
        continue;
      }
      const remote = GameData.fromRawSystem(own.getSystemSaveDataString(), false, playerIndex);
      remote.trainerId = 900 + playerIndex;
      remote.playerDisplayName = `Remote ${playerIndex + 1}`;
      remote.playerCharacterId = "riley_back";
      remote.unlocks[Unlockables.ENDLESS_MODE] = true;
      remote.achvUnlocks = { MONO_FAIRY: 200 };
      remote.dexData[SpeciesId.MEWTWO].caughtAttr = DexAttr.NON_SHINY | DexAttr.DEFAULT_FORM;
      remote.starterData[SpeciesId.BULBASAUR].candyCount = 999;
      remote.starterData[SpeciesId.BULBASAUR].passiveAttr = 3;
      expect(
        game.scene.applyTwoPlayerProfileSnapshot({
          playerIndex,
          playerCardVersion: 1,
          systemSave: remote.getSystemSaveDataString(),
        }),
      ).toBe(true);
    }
    game.scene.setActivePlayerIndex(0);
  }

  function readSavedProfile(): GameData {
    const raw = decrypt(localStorage.getItem(`data_${loggedInUser?.username}`)!, appConstants.bypassLogin);
    return GameData.fromRawSystem(raw, false);
  }

  function expectOwnProfile(profile: GameData) {
    expect(profile.trainerId).toBe(123);
    expect(profile.secretId).toBe(456);
    expect(profile.playerDisplayName).toBe("Former EP");
    expect(profile.playerCharacterId).toBe("sabrina_back");
    expect(profile.unlocks[Unlockables.ENDLESS_MODE]).toBe(false);
    expect(profile.achvUnlocks).toEqual({ MONO_WATER: 100 });
    expect(profile.dexData[SpeciesId.MEWTWO].caughtAttr).toBe(0n);
    expect(profile.starterData[SpeciesId.BULBASAUR].candyCount).toBe(17);
    expect(profile.starterData[SpeciesId.BULBASAUR].passiveAttr).toBe(0);
  }

  it.each([0, 1, 2, "ep"] as const)("seat %s autosaves only its own permanent progress", async seat => {
    joinRun(seat);
    expect(await game.scene.gameData.saveAll(true)).toBe(true);
    expectOwnProfile(readSavedProfile());
    expect((await game.scene.gameData.getSession(GUEST_SAVE_SLOT))?.waveIndex).toBe(200);
    for (const playerIndex of [0, 1, 2] as const) {
      if (playerIndex !== seat) {
        expect(game.scene.getPlayerGameData(playerIndex).achvUnlocks).toEqual({ MONO_FAIRY: 200 });
      }
    }
  });

  it.each([false, true])("EP's end-of-run save preserves its profile (cached system=%s)", async cachedSystem => {
    joinRun("ep");
    // Write the run once, then use the same cached-session path as PostGameOverPhase.
    expect(await game.scene.gameData.saveAll(true)).toBe(true);
    expect(await game.scene.gameData.saveAll(true, true, true, cachedSystem)).toBe(true);
    expectOwnProfile(readSavedProfile());
    await game.scene.gameData.tryClearSession(GUEST_SAVE_SLOT);
    expectOwnProfile(readSavedProfile());
  });

  it("keeps EP's real profile when leaving and loading it as the next host", async () => {
    joinRun("ep");
    expect(await game.scene.gameData.saveAll(true)).toBe(true);
    game.scene.configureTwoPlayerMode(false);
    expect(game.scene.gameData).toBe(own);
    expectOwnProfile(own);
    // A newly launched lobby reloads the permanent profile from disk.
    const reloaded = new GameData(true);
    expect(await reloaded.loadSystem()).toBe(true);
    game.scene.gameData = reloaded;
    game.scene.markLocalPlayerSystemSaveLoaded();
    game.scene.twoPlayerLocalInputSeat = 0;
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    const snapshot = game.scene.getLocalTwoPlayerProfileSnapshot();
    expect(snapshot?.playerIndex).toBe(0);
    if (!snapshot || snapshot.playerIndex === "ep") {
      throw new Error("Expected a host profile snapshot");
    }
    expectOwnProfile(GameData.fromRawSystem(snapshot.systemSave, false));
    expect(game.scene.getPlayerGameData(0)).toBe(reloaded);
  });

  it("sends EP's own system profile to the account backend, never the host's", async () => {
    joinRun("ep");
    vi.spyOn(appConstants, "bypassLogin", "get").mockReturnValue(false);
    localStorage.removeItem(`data_${loggedInUser?.username}`);
    const saveSystem = vi.spyOn(pokerogueApi.savedata.system, "update").mockResolvedValue("");
    const saveAll = vi.spyOn(pokerogueApi.savedata, "updateAll").mockResolvedValue("");
    expect(await game.scene.gameData.saveAll(true, true)).toBe(true);
    expect(saveAll).not.toHaveBeenCalled();
    expect(saveSystem).toHaveBeenCalledOnce();
    expectOwnProfile(GameData.fromRawSystem(saveSystem.mock.calls[0][1], false));
    expectOwnProfile(readSavedProfile());
  });
});
