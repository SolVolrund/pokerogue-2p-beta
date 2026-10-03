import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { MysteryEncounterSaveData, SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { EncounterPhase } from "#phases/encounter-phase";
import { TitlePhase } from "#phases/title-phase";
import {
  getMysteryEncounterEventSettings,
  getMysteryEncounterFrequencySetting,
  MYSTERY_ENCOUNTER_FREQUENCY_SETTING,
} from "#system/settings-events";
import { GameManager } from "#test/framework/game-manager";
import * as Common from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Mystery encounter frequency", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    // Keep random-roll tests separate from the independently scheduled Contest Hall.
    game.scene.mysteryEncounterSaveData.contestHallProgress.declined = true;
    vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_RATE_OVERRIDE", "get").mockReturnValue(null);
    vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_OVERRIDE", "get").mockReturnValue(null);
  });

  afterEach(() => {
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  function preference(frequency: unknown) {
    localStorage.setItem("settings", JSON.stringify({ [MYSTERY_ENCOUNTER_FREQUENCY_SETTING]: frequency }));
  }

  function roll(wave = 52) {
    return game.scene["isWaveMysteryEncounter"](BattleType.WILD, wave);
  }

  it("offers seven frequency values before the event toggles, defaulting to three", () => {
    const setting = getMysteryEncounterEventSettings()[0];
    expect(setting.key).toBe(MYSTERY_ENCOUNTER_FREQUENCY_SETTING);
    expect(setting.default).toBe(3);
    expect(setting.options.map(option => option.value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
  });

  it.each([0, 1, 2, 3, 4, 5, 6])("persists frequency %i and scales its target", frequency => {
    preference(frequency);
    expect(getMysteryEncounterFrequencySetting()).toBe(frequency);
    const data = new MysteryEncounterSaveData();
    data.frequency = frequency;
    data.encounterSpawnChance = 27;
    const restored = new MysteryEncounterSaveData(JSON.parse(JSON.stringify(data)));
    expect(restored.frequency).toBe(frequency);
    expect(restored.encounterTarget).toBe(frequency * 4);
    expect(restored.encounterSpawnChance).toBe(27);
  });

  it.each([undefined, null, -1, 7, 1.5, "6"])("uses normal frequency for missing/invalid values: %s", value => {
    preference(value);
    expect(getMysteryEncounterFrequencySetting()).toBe(3);
    const restored = new MysteryEncounterSaveData(JSON.parse(JSON.stringify({ frequency: value })));
    expect(restored.frequency).toBe(3);
  });

  it("loads old saves at normal frequency even when the local preference is six", () => {
    preference(6);
    const restored = new MysteryEncounterSaveData(JSON.parse('{"encounterSpawnChance":42}'));
    expect(restored.frequency).toBe(3);
    expect(restored.encounterSpawnChance).toBe(42);
  });

  it.each([0, 3, 6])("adds %i pity on eligible misses, including cooldown waves", frequency => {
    const scene = game.scene;
    scene.mysteryEncounterSaveData.frequency = frequency;
    scene.mysteryEncounterSaveData.encounteredEvents = [
      new SeenEncounterData(MysteryEncounterType.GAME_CORNER, MysteryEncounterTier.COMMON, 52),
    ];
    scene.currentBattle = new Battle(scene.gameMode, { waveIndex: 53, battleType: BattleType.WILD, double: false });
    new EncounterPhase()["incrementMysteryEncounterChance"]();
    expect(scene.mysteryEncounterSaveData.encounterSpawnChance).toBe(3 + frequency);
    scene.currentBattle.battleType = BattleType.TRAINER;
    new EncounterPhase()["incrementMysteryEncounterChance"]();
    expect(scene.mysteryEncounterSaveData.encounterSpawnChance).toBe(3 + frequency);
  });

  it("disables random events at zero even with maximum accumulated pity", () => {
    game.scene.mysteryEncounterSaveData.frequency = 0;
    game.scene.mysteryEncounterSaveData.encounterSpawnChance = 256;
    const rng = vi.spyOn(Common, "randSeedInt").mockReturnValue(0);
    expect(roll()).toBe(false);
    expect(rng).not.toHaveBeenCalled();
  });

  it("preserves explicit rate overrides at zero", () => {
    game.scene.mysteryEncounterSaveData.frequency = 0;
    vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_RATE_OVERRIDE", "get").mockReturnValue(256);
    vi.spyOn(Common, "randSeedInt").mockReturnValue(255);
    expect(roll()).toBe(true);
  });

  it.each([9, 51, 60, 181])("still excludes ineligible wave %i at maximum frequency", wave => {
    game.scene.mysteryEncounterSaveData.frequency = 6;
    game.scene.mysteryEncounterSaveData.encounterSpawnChance = 256;
    expect(roll(wave)).toBe(false);
  });

  it.each([
    "isScheduledContestHallMysteryEncounterWave",
    "isScheduledGtsMalfunctionMysteryEncounterWave",
    "isScheduledDejaVuMysteryEncounterWave",
    "isScheduledLostAtSeaMysteryEncounterWave",
  ] as const)("preserves scheduled events at zero: %s", method => {
    game.scene.mysteryEncounterSaveData.frequency = 0;
    vi.spyOn(game.scene as unknown as Record<typeof method, () => boolean>, method).mockReturnValue(true);
    expect(roll()).toBe(true);
  });

  it("scales pacing along with pity and preserves the three-wave cooldown", () => {
    const data = game.scene.mysteryEncounterSaveData;
    vi.spyOn(Common, "randSeedInt").mockReturnValue(60);
    data.frequency = 3;
    expect(roll()).toBe(false);
    data.frequency = 6;
    expect(roll()).toBe(true);
    data.encounterSpawnChance = 256;
    data.encounteredEvents = [
      new SeenEncounterData(MysteryEncounterType.GAME_CORNER, MysteryEncounterTier.COMMON, 52),
    ];
    for (const wave of [53, 54, 55]) {
      expect(roll(wave)).toBe(false);
    }
    expect(roll(56)).toBe(true);
  });

  it("takes the solo preference at new-run startup", () => {
    preference(6);
    const title = new TitlePhase();
    title.gameMode = GameModes.CLASSIC;
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    title.end();
    expect(game.scene.mysteryEncounterSaveData.frequency).toBe(6);
    preference(1);
    expect(game.scene.mysteryEncounterSaveData.frequency).toBe(6);
  });

  it.each([2, 3] as const)("uses the host's choice instead of the guest's preference in %ip", count => {
    preference(6);
    const host = new TitlePhase();
    host["announceTwoPlayerProfileForStartup"] = () => {};
    host["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
    vi.spyOn(host, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(false);
    host["startMultiplayerRun"](GameModes.CLASSIC, count, 6);
    const payload: TwoPlayerTitleStart = JSON.parse(JSON.stringify(broadcast.mock.calls[0][0]));
    expect(payload.mysteryEncounterFrequency).toBe(6);
    preference(0);
    const guest = new TitlePhase();
    guest["announceTwoPlayerProfileForStartup"] = () => {};
    guest["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    expect(guest["applyRemoteTwoPlayerTitleStart"](payload)).toBe(true);
    expect(game.scene.mysteryEncounterSaveData.frequency).toBe(6);
  });
});
