import { getTypeDamageMultiplierColor } from "#data/type";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TypeHints } from "#enums/type-hints";
import { WeatherType } from "#enums/weather-type";
import { MessagePhase } from "#phases/message-phase";
import { Setting, SettingKeys, setSetting } from "#system/settings/settings";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Upstream accessibility and weather UI", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.EEVEE);
  });

  afterEach(() => {
    game.scene.manualMessageClear = false;
    game.scene.typeHints = TypeHints.OFF;
    game.scene.twoPlayerMode = false;
    game.scene.inputOwner = "none";
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  it.each([TypeHints.OFF, TypeHints.ON, TypeHints.HIGH_CONTRAST])("loads type hint setting %i", mode => {
    expect(setSetting(SettingKeys.Type_Hints, mode)).toBe(true);
    expect(game.scene.typeHints).toBe(mode);
  });

  it.each([
    [2, "#4AA500", "#2DB4FF"],
    [4, "#4BB400", "#00A4FF"],
    [8, "#52C200", "#0093FF"],
  ] as const)("uses alternate colors for %ix damage without changing regular hints", (multiplier, normal, contrast) => {
    expect(getTypeDamageMultiplierColor(multiplier, "offense")).toBe(normal);
    expect(getTypeDamageMultiplierColor(multiplier, "offense", true)).toBe(contrast);
  });

  it.each([0, 0.125, 0.25, 0.5, 1] as const)("keeps the existing color for %ix damage", multiplier => {
    expect(getTypeDamageMultiplierColor(multiplier, "offense", true)).toBe(
      getTypeDamageMultiplierColor(multiplier, "offense"),
    );
  });

  it("defaults manual message prompts to off", () => {
    expect(Setting.find(setting => setting.key === SettingKeys.Manual_Message_Clear)?.default).toBe(0);
    expect(game.scene.manualMessageClear).toBe(false);
  });

  it.each([
    [false, false, false],
    [false, true, true],
    [true, false, true],
    [true, true, true],
  ])("honors manual prompts %s and explicit prompts %s", (manual, explicit, expected) => {
    game.scene.manualMessageClear = manual;
    const showText = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    new MessagePhase("Test message", 0, explicit).start();
    expect(showText).toHaveBeenCalledWith(
      "Test message",
      null,
      expect.any(Function),
      expected ? 0 : 1500,
      expected,
      undefined,
    );
  });

  it("uses shared input for added prompts in multiplayer, including an EP seat", () => {
    game.scene.manualMessageClear = true;
    game.scene.twoPlayerMode = true;
    game.scene.twoPlayerLocalInputSeat = "ep";
    const wait = vi.spyOn(game.scene, "waitForSharedInput");
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    new MessagePhase("Test message").start();
    expect(wait).toHaveBeenCalledOnce();
    expect(game.scene.inputOwner).toBe("both");
  });

  it("synchronizes both new settings through the existing multiplayer snapshot", () => {
    game.scene.twoPlayerMode = true;
    game.scene.twoPlayerLocalInputSeat = 0;
    localStorage.setItem(
      "settings",
      JSON.stringify({
        [SettingKeys.Manual_Message_Clear]: 1,
        [SettingKeys.Type_Hints]: TypeHints.HIGH_CONTRAST,
      }),
    );
    const snapshot = game.scene.getTwoPlayerSettingsSnapshot()!;
    expect(snapshot.settings[SettingKeys.Manual_Message_Clear]).toBe(1);
    expect(snapshot.settings[SettingKeys.Type_Hints]).toBe(TypeHints.HIGH_CONTRAST);
    game.scene.twoPlayerLocalInputSeat = 1;
    expect(game.scene.applyTwoPlayerSettingsSnapshot(snapshot)).toBe(true);
    expect(game.scene.manualMessageClear).toBe(true);
    expect(game.scene.typeHints).toBe(TypeHints.HIGH_CONTRAST);
  });

  it.each([
    WeatherType.HARSH_SUN,
    WeatherType.HEAVY_RAIN,
    WeatherType.STRONG_WINDS,
  ])("does not show a countdown for permanent weather %i", weather => {
    expect(game.scene.arena.trySetWeather(weather, game.field.getPlayerPokemon())).toBe(true);
    const flyout = game.scene.arenaFlyout;
    expect(flyout["weatherInfo"]).toMatchObject({ weatherType: weather, duration: 0, maxDuration: 0 });
    expect(flyout["flyoutTextField"].text).not.toMatch(/\(\d+\/\d+\)/);
  });

  it("retains the countdown for ordinary weather", () => {
    expect(game.scene.arena.trySetWeather(WeatherType.RAIN, game.field.getPlayerPokemon())).toBe(true);
    expect(game.scene.arenaFlyout["weatherInfo"]).toMatchObject({ duration: 5, maxDuration: 5 });
  });
});
