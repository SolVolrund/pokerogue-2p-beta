import { Button } from "#enums/buttons";
import { PlayerGender } from "#enums/player-gender";
import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  getPlayerTrainerSpriteOption,
  PlayerTrainerSprite,
  PLAYER_TRAINER_SPRITE_OPTIONS,
} from "#enums/player-trainer-sprite";
import { UiMode } from "#enums/ui-mode";
import { TitlePhase } from "#phases/title-phase";
import { GameData } from "#system/game-data";
import { SettingKeys } from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import type { PlayerCharacterSelectConfig, PlayerCharacterUiHandler } from "#ui/player-character-ui-handler";
import {
  consumePlayerCardHandoff,
  getLegacyPlayerCharacterId,
  validateRunPlayerAppearances,
  withPlayerCardForLobby,
} from "#utils/player-card";
import Phaser from "phaser";
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Player Cards", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const originalUrl = window.location.href;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
  });
  afterEach(() => {
    window.history.replaceState({}, "", originalUrl);
    game.scene.ui.handlers[UiMode.PLAYER_CHARACTER].clear();
  });

  it("migrates legacy gender-specific selections and tolerates corrupt cursor values", () => {
    expect(getLegacyPlayerCharacterId({ PLAYER_GENDER: 1, PLAYER_GIRL_TRAINER_SPRITE: 12 }, 0)).toBe("sabrina_back");
    expect(getLegacyPlayerCharacterId({ GUEST_GENDER: 0, GUEST_BOY_TRAINER_SPRITE: 4 }, 1)).toBe("riley_back");
    expect(getLegacyPlayerCharacterId({ PLAYER_GIRL_TRAINER_SPRITE: -20 }, 0, PlayerGender.FEMALE)).toBe(
      "trainer_f_back",
    );
  });

  it("carries only name and sprite across LAN origins and consumes them once", () => {
    const identity = { name: "Tester", characterId: "sabrina_back" };
    const target = new URL(
      withPlayerCardForLobby("http://192.168.0.133:8000/?twoPlayer=1", window.location.origin, identity),
    );
    const encoded = new URLSearchParams(target.hash.slice(1)).get("playerCard")!;
    expect(JSON.parse(encoded)).toEqual(identity);
    window.history.replaceState({}, "", `?twoPlayer=1${target.hash}`);
    expect(consumePlayerCardHandoff()).toEqual(identity);
    expect(window.location.hash).toBe("");
    expect(consumePlayerCardHandoff()).toBeUndefined();
    expect(
      new URL(withPlayerCardForLobby(`${window.location.origin}/?twoPlayer=1`, window.location.origin, identity)).hash,
    ).toBe("");
  });

  it("ignores invalid cosmetic handoffs and does not treat them as profile imports", () => {
    for (const value of [
      "broken-json",
      JSON.stringify({ characterId: "not-a-character", dexData: {} }),
      "x".repeat(513),
    ]) {
      const fragment = new URLSearchParams({ playerCard: value }).toString();
      window.history.replaceState({}, "", `?twoPlayer=1#${fragment}`);
      expect(consumePlayerCardHandoff()).toBeUndefined();
      expect(window.location.hash).toBe("");
    }
  });

  it("serializes cards and never re-migrates an existing selection", () => {
    const profile = game.scene.getLocalPlayerCardProfile();
    profile.playerCharacterId = "whitney_back";
    profile.localGuestCharacterIds = ["riley_back", "sabrina_back"];
    profile.initializePlayerCard({ PLAYER_GENDER: 0 });
    expect(profile.gender).toBe(PlayerGender.FEMALE);
    const copy = GameData.fromRawSystem(profile.getSystemSaveDataString(), false);
    expect(copy.playerCharacterId).toBe("whitney_back");
    expect(copy.localGuestCharacterIds).toEqual(["riley_back", "sabrina_back"]);
  });

  it("rejects unknown run characters instead of silently substituting a client-dependent sprite", () => {
    expect(() => validateRunPlayerAppearances({ 1: "future-character" })).toThrow("same game build");
    expect(validateRunPlayerAppearances({ 0: "sabrina_back" })).toEqual({ 0: "sabrina_back" });
  });

  it.each([
    { sprite: PlayerTrainerSprite.BASE_BOY, characterId: "trainer_m_back", front: "player_m", name: "Kyle" },
    { sprite: PlayerTrainerSprite.BASE_GIRL, characterId: "trainer_f_back", front: "player_f", name: "Amber" },
  ])("previews the real default trainer front for $characterId", ({ sprite, characterId, front, name }) => {
    expect(getPlayerTrainerSpriteFrontTextureKey(sprite)).toBe(front);
    const handler = game.scene.ui.handlers[UiMode.PLAYER_CHARACTER] as PlayerCharacterUiHandler;
    const preview = vi.spyOn(handler as any, "preview").mockImplementation(() => {});
    handler.show([{ characterId, onConfirm: vi.fn(), onCancel: vi.fn() }]);
    expect(handler["nameText"].text).toBe(name);
    expect(handler["rows"][handler.getCursor()].text).toBe(name);
    expect(preview).toHaveBeenCalledWith(handler["front"], front, false);
    expect(preview).toHaveBeenCalledWith(handler["back"], `${characterId}_pb`, true);
  });

  it.each([
    { sprite: PlayerTrainerSprite.BIANCA, characterId: "bianca_back", front: "bianca", name: "Bianca" },
    { sprite: PlayerTrainerSprite.DUPLICA, characterId: "duplica_back_mid117", front: "duplica", name: "Duplica" },
    { sprite: PlayerTrainerSprite.AMBER_TWO, characterId: "amber_two_back", front: "amber_two", name: "AmberTwo" },
  ])("selects and saves $name with a distinct character ID", ({ sprite, characterId, front, name }) => {
    const handler = game.scene.ui.handlers[UiMode.PLAYER_CHARACTER] as PlayerCharacterUiHandler;
    const preview = vi.spyOn(handler as any, "preview").mockImplementation(() => {});
    const onConfirm = vi.fn();
    handler.show([{ characterId, onConfirm, onCancel: vi.fn() }]);
    expect(handler["nameText"].text).toBe(name);
    expect(getPlayerTrainerSpriteFrontTextureKey(sprite)).toBe(front);
    expect(preview).toHaveBeenCalledWith(handler["front"], front, false);
    expect(preview).toHaveBeenCalledWith(handler["back"], `${characterId}_pb`, true);
    handler.processInput(Button.ACTION);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith(characterId);
    const profile = game.scene.getLocalPlayerCardProfile();
    profile.playerCharacterId = characterId;
    profile.initializePlayerCard();
    const copy = GameData.fromRawSystem(profile.getSystemSaveDataString(), false);
    expect(copy.playerCharacterId).toBe(characterId);
    game.scene.restoreRunPlayerAppearances({ 0: characterId });
    expect(game.scene.getTrainerSprite(0)).toBe(sprite);
  });

  it("keeps existing variant IDs and labels separate from the new regular characters", () => {
    expect(PlayerTrainerSprite.SABRINA).toBe(19);
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.BIANCA_LATIAS)).toMatchObject({
      label: "Bianca?", atlasKey: "bianca_latias_back",
    });
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.DUPLICA_DITTO)).toMatchObject({
      label: "Duplica?", atlasKey: "duplica_ditto_back_mid117",
    });
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.BIANCA)).toMatchObject({
      backAtlasFile: "bianca_pb", pokeballAtlasFile: "bianca_pb",
    });
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.AMBER_TWO)).toMatchObject({
      atlasKey: "amber_two_back", backAtlasFile: "amber_two_back_pb",
    });
  });

  it("displays the supplied artist credit for every character", () => {
    const credits = {
      Kyle: "PKRogue", Amber: "PKRogue", Buck: "Ken Sugimori", Cheryl: "Ken Sugimori",
      "Dawn (DP)": "Ken Sugimori", "Dawn (Pt)": "Ken Sugimori", "Dawn?": "Bio(E)",
      Ethan: "Ken Sugimori", "Lucas (DP)": "Ken Sugimori", "Lucas (Pt)": "Ken Sugimori",
      Lyra: "Takao Unno", Marley: "Ken Sugimori", Mira: "Ken Sugimori", Riley: "Ken Sugimori",
      Silver: "Ken Sugimori", "Bianca?": "Ejay", "Duplica?": "Bio(E)", Molly: "Gopokenohito/Bio",
      Whitney: "mid117", Sabrina: "Mid117", Bianca: "Ejay", Duplica: "Bio(E)", AmberTwo: "Bio",
    };
    const handler = game.scene.ui.handlers[UiMode.PLAYER_CHARACTER] as PlayerCharacterUiHandler;
    vi.spyOn(handler as any, "preview").mockImplementation(() => {});
    expect(PLAYER_TRAINER_SPRITE_OPTIONS).toHaveLength(Object.keys(credits).length);
    for (const option of PLAYER_TRAINER_SPRITE_OPTIONS) {
      handler.show([{ characterId: option.atlasKey, onConfirm: vi.fn(), onCancel: vi.fn() }]);
      expect(option.artist).toBe(credits[option.label]);
      expect(handler["sourceText"].text).toBe(credits[option.label]);
    }
  });

  it("previews every character, wraps and scrolls, and cancels without committing", () => {
    const handler = game.scene.ui.handlers[UiMode.PLAYER_CHARACTER] as PlayerCharacterUiHandler;
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    handler.show([{ characterId: "trainer_m_back", onConfirm, onCancel }]);
    handler.processInput(Button.UP);
    expect(handler.getCursor()).toBe(PLAYER_TRAINER_SPRITE_OPTIONS.length - 1);
    expect(handler["scrollOffset"]).toBeGreaterThan(0);
    expect(handler["nameText"].text).toBe(PLAYER_TRAINER_SPRITE_OPTIONS.at(-1)!.label);
    for (let i = 0; i < PLAYER_TRAINER_SPRITE_OPTIONS.length; i++) {
      handler.processInput(Button.DOWN);
    }
    expect(onConfirm).not.toHaveBeenCalled();
    handler.processInput(Button.CANCEL);
    expect(onCancel).toHaveBeenCalledOnce();
    expect(handler.active).toBe(false);
    expect(handler.processInput(Button.ACTION)).toBe(false);
    handler.show([{ characterId: "whitney_back", onConfirm, onCancel }]);
    handler.processInput(Button.ACTION);
    expect(onConfirm).toHaveBeenCalledExactlyOnceWith("whitney_back");
  });

  it.each(PLAYER_TRAINER_SPRITE_OPTIONS)("fits $label's front and back at whole canvas-pixel scales", option => {
    const handler = game.scene.ui.handlers[UiMode.PLAYER_CHARACTER] as PlayerCharacterUiHandler;
    vi.spyOn(game.scene.textures, "exists").mockReturnValue(true);
    vi.spyOn(game.scene.anims, "exists").mockReturnValue(true);
    for (const throwing of [false, true]) {
      const key = throwing
        ? getPlayerTrainerSpriteBackTextureKey(option.sprite, true)
        : getPlayerTrainerSpriteFrontTextureKey(option.sprite);
      const file = throwing ? (option.pokeballAtlasFile ?? `${option.atlasKey}_pb`) : key;
      const atlas = JSON.parse(readFileSync(`assets/images/trainer/${file}.json`, "utf8"));
      const frames = (atlas.frames ?? atlas.textures.flatMap(texture => texture.frames))
        .filter(frame => (throwing ? /^\d+$/.test(frame.filename) : /^\d+\.png$/.test(frame.filename)));
      expect(frames.length).toBeGreaterThan(0);
      const maxWidth = Math.max(...frames.map(frame => frame.sourceSize.w));
      const maxHeight = Math.max(...frames.map(frame => frame.sourceSize.h));
      vi.spyOn(game.scene.textures, "get").mockReturnValue({
        getFrameNames: () => frames.map(frame => frame.filename),
        get: name => {
          const frame = frames.find(frame => frame.filename === name);
          return { realWidth: frame.sourceSize.w, realHeight: frame.sourceSize.h };
        },
      } as Phaser.Textures.Texture);
      const sprite = {
        width: frames[0].sourceSize.w,
        height: frames[0].sourceSize.h,
        stop: vi.fn(),
        setVisible: vi.fn().mockReturnThis(),
        setTexture: vi.fn().mockReturnThis(),
        setScale: vi.fn(),
        play: vi.fn(),
      };
      handler["preview"](sprite as unknown as Phaser.GameObjects.Sprite, key, throwing);
      const scale = sprite.setScale.mock.calls[0][0];
      const pixelsPerTexel = scale * 6;
      expect(Number.isInteger(pixelsPerTexel)).toBe(true);
      expect(pixelsPerTexel).toBeGreaterThan(0);
      expect(maxWidth * scale).toBeLessThanOrEqual(handler["rightWidth"] - 16);
      expect(maxHeight * scale).toBeLessThanOrEqual((game.scene.scaledCanvas.height - 84) / 2 - 4);
      expect(scale).toBeLessThanOrEqual(1);
      if (option.sprite === PlayerTrainerSprite.AMBER_TWO) {
        expect(pixelsPerTexel).toBe(throwing ? 3 : 4);
      }
    }
  });

  it("saves the chosen personal or local guest sprite, and rolls back on storage failure", () => {
    const title = new TitlePhase();
    const profile = game.scene.getLocalPlayerCardProfile();
    profile.initializePlayerCard();
    const save = vi.spyOn(profile, "saveSystemLocal").mockImplementation(() => {});
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    vi.spyOn(title as any, "showPlayerCard").mockImplementation(() => {});
    title["showPlayerCharacterSelect"](-1, 0);
    (mode.mock.calls.at(-1)![1] as PlayerCharacterSelectConfig).onConfirm("sabrina_back");
    expect(profile.playerCharacterId).toBe("sabrina_back");
    expect(save).toHaveBeenCalledOnce();
    title["showPlayerCharacterSelect"](-1, 1);
    (mode.mock.calls.at(-1)![1] as PlayerCharacterSelectConfig).onConfirm("whitney_back");
    expect(profile.playerCharacterId).toBe("sabrina_back");
    expect(profile.localGuestCharacterIds![0]).toBe("whitney_back");
    save.mockImplementation(() => {
      throw new Error("Storage full");
    });
    title["showPlayerCharacterSelect"](-1, 0);
    (mode.mock.calls.at(-1)![1] as PlayerCharacterSelectConfig).onConfirm("buck_back");
    expect(profile.playerCharacterId).toBe("sabrina_back");
    expect(profile.gender).toBe(PlayerGender.FEMALE);
  });

  it("freezes local-seat appearances for the run, including after profile edits and restore", () => {
    const profile = game.scene.getLocalPlayerCardProfile();
    profile.playerCharacterId = "sabrina_back";
    profile.localGuestCharacterIds = ["riley_back", "whitney_back"];
    game.scene.twoPlayerLocalInputSeat = "both";
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.startRunPlayerAppearances();
    const saved = game.scene.getRunPlayerAppearances();
    expect(saved).toEqual({ 0: "sabrina_back", 1: "riley_back", 2: "whitney_back" });
    profile.playerCharacterId = "buck_back";
    profile.localGuestCharacterIds[0] = "trainer_m_back";
    game.scene.restoreRunPlayerAppearances(saved);
    expect(game.scene.getTrainerSprite(0)).toBe(PlayerTrainerSprite.SABRINA);
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.RILEY);
    game.scene.startRunPlayerAppearances();
    expect(game.scene.getTrainerSprite(0)).toBe(PlayerTrainerSprite.BUCK);
  });

  it("excludes appearance from host settings sync and displays CPU identities independently", () => {
    game.scene.twoPlayerLocalInputSeat = 0;
    game.scene.configureTwoPlayerMode(true, 6, true, 2, [1]);
    game.scene.setComputerPartnerKey(1, "whitney");
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.WHITNEY);
    const snapshot = game.scene.getTwoPlayerSettingsSnapshot()!;
    expect(snapshot.settings).toHaveProperty(SettingKeys.Game_Speed);
    expect(snapshot.settings).not.toHaveProperty(SettingKeys.Guest_Gender);
    expect(snapshot.settings).not.toHaveProperty(SettingKeys.Player_Boy_Trainer_Sprite);
    game.scene.twoPlayerLocalInputSeat = 1;
    expect(game.scene.applyTwoPlayerSettingsSnapshot({ settings: { PLAYER_GENDER: 0, GUEST_GENDER: 1 } })).toBe(false);
  });

  it("derives Alex's default from the shared lead instead of local guest settings", () => {
    game.scene.getLocalPlayerCardProfile().playerCharacterId = "sabrina_back";
    game.scene.twoPlayerLocalInputSeat = 0;
    game.scene.configureTwoPlayerMode(true, 6, true, 2, [1]);
    game.scene.setComputerPartnerKey(1, "alex");
    game.scene.twoPlayerGuestTrainerSprite = PlayerTrainerSprite.CHERYL;
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.BASE_BOY);
    game.scene.startRunPlayerAppearances();
    game.scene.getLocalPlayerCardProfile().playerCharacterId = "buck_back";
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.BASE_BOY);
  });

  it("uses the remote seat's card rather than the host's local guest preference", () => {
    game.scene.twoPlayerLocalInputSeat = 0;
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    const guest = new GameData(true);
    guest.playerCharacterId = "sabrina_back";
    guest.initializePlayerCard();
    expect(
      game.scene.applyTwoPlayerProfileSnapshot({
        playerIndex: 1,
        playerCardVersion: 1,
        systemSave: guest.getSystemSaveDataString(),
      }),
    ).toBe(true);
    expect(game.scene.getTrainerSprite(1)).toBe(PlayerTrainerSprite.SABRINA);
    expect(
      game.scene.applyTwoPlayerProfileSnapshot({ playerIndex: 1, systemSave: guest.getSystemSaveDataString() }),
    ).toBe(false);
    expect(game.scene.playerCardCompatibilityError).toContain("same game build");
  });

  it("does not freeze cached guest cards while a legacy save is waiting for fresh profiles", () => {
    game.scene.twoPlayerLocalInputSeat = 0;
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    game.scene.restoreRunPlayerAppearances();
    const guest = new GameData(true);
    guest.playerCharacterId = "sabrina_back";
    guest.initializePlayerCard();
    game.scene.applyTwoPlayerProfileSnapshot({
      playerIndex: 1,
      playerCardVersion: 1,
      systemSave: guest.getSystemSaveDataString(),
    });
    expect(game.scene.getRunPlayerAppearances()[1]).toBe("sabrina_back");
  });

  it("exchanges only EP identity without importing a Dex, and waits for that identity", () => {
    game.scene.twoPlayerLocalInputSeat = 0;
    game.scene.configureTwoPlayerMode(true, 6, false, 1, [], false, true);
    game.scene.markLocalPlayerSystemSaveLoaded();
    game.scene.resetTwoPlayerProfileExchangeForRun();
    expect(game.scene.isTwoPlayerProfileExchangeComplete()).toBe(false);
    const profile = game.scene.getPlayerGameData(0);
    const dex = profile.dexData;
    expect(
      game.scene.applyTwoPlayerProfileSnapshot({
        playerIndex: "ep",
        identity: { name: "Opponent", characterId: "sabrina_back" },
      }),
    ).toBe(true);
    expect(game.scene.getPlayerGameData(0).dexData).toBe(dex);
    expect(game.scene.isTwoPlayerProfileExchangeComplete()).toBe(true);
    game.scene.twoPlayerLocalInputSeat = "ep";
    const snapshot = game.scene.getLocalTwoPlayerProfileSnapshot()!;
    expect(snapshot.playerIndex).toBe("ep");
    expect(snapshot).not.toHaveProperty("systemSave");
    expect(snapshot).not.toHaveProperty("starterPreferences");
  });
});
