import { Battle } from "#app/battle";
import { timedEventManager } from "#app/global-event-manager";
import { getGameMode } from "#app/game-mode";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import type { TwoPlayerTitleStart } from "#app/two-player-input-transport";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import { canReserveEncounter } from "#mystery-encounters/encounter-reservation";
import { MysteryEncounterSaveData, SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounters";
import { EncounterPhase } from "#phases/encounter-phase";
import { TitlePhase } from "#phases/title-phase";
import * as eventSettings from "#system/settings-events";
import {
  getMysteryEncounterEventSettings,
  getMysteryEncounterFrequencySetting,
  getMysteryEncounterSettingKey,
  getScheduledEncounterSetting,
  MYSTERY_ENCOUNTER_FREQUENCY_SETTING,
} from "#system/settings-events";
import { GameManager } from "#test/framework/game-manager";
import type { SettingsEventsUiHandler } from "#ui/settings-events-ui-handler";
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
    game.scene.configureTwoPlayerMode(false);
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

  it("uses tier defaults unless the event explicitly sets its own cap", () => {
    expect(allMysteryEncounters[MysteryEncounterType.LIFE_IS_WONDERFUL].maxAllowedEncounters).toBe(1);
    expect(allMysteryEncounters[MysteryEncounterType.MINING].maxAllowedEncounters).toBe(2);
    expect(allMysteryEncounters[MysteryEncounterType.SHINY_BADGE].maxAllowedEncounters).toBe(1);
    expect(allMysteryEncounters[MysteryEncounterType.DELIBIRDY].maxAllowedEncounters).toBe(4);
  });

  it.each([
    [MysteryEncounterType.LIFE_IS_WONDERFUL, 1, false],
    [MysteryEncounterType.DELIBIRDY, 4, true],
  ] as const)("stops rolling event %i after %i recorded visits", (type, cap, multiplayer) => {
    const scene = game.scene;
    scene.configureTwoPlayerMode(multiplayer);
    scene.newArena(BiomeId.PLAINS);
    scene.getActivePlayerIndexes().forEach(p => scene.setPlayerMoney(1_000_000, p));
    vi.spyOn(eventSettings, "isMysteryEncounterEnabledBySettings").mockImplementation(t => t === type);
    const tier = allMysteryEncounters[type].encounterTier;
    vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_TIER_OVERRIDE", "get").mockReturnValue(tier);
    vi.spyOn(activeOverrides, "MYSTERY_ENCOUNTER_RATE_OVERRIDE", "get").mockReturnValue(256);
    vi.spyOn(activeOverrides, "BATTLE_TYPE_OVERRIDE", "get").mockReturnValue(null);
    vi.spyOn(scene.gameMode, "isWaveTrainer").mockReturnValue(false);
    vi.spyOn(activeOverrides, "STARTING_WAVE_OVERRIDE", "get").mockReturnValue(92);
    for (let i = 0; i < cap; i++) {
      const wave = 32 + i * 10;
      expect(scene["rollMysteryEncounterType"](wave)).toBe(type);
      const history = scene.mysteryEncounterSaveData.encounteredEvents;
      history.push(new SeenEncounterData(type, tier, wave));
      expect(scene["rollMysteryEncounterType"](wave + 4)).toBeUndefined(); // No consecutive repeats.
      history.push(new SeenEncounterData(MysteryEncounterType.MINING, MysteryEncounterTier.COMMON, wave + 5));
    }
    scene.mysteryEncounterSaveData.encounterSpawnChance = 73;
    scene.mysteryEncounterSaveData = new MysteryEncounterSaveData(JSON.parse(JSON.stringify(scene.mysteryEncounterSaveData)));
    const battle = scene.newBattle();
    expect(battle.battleType).toBe(BattleType.WILD);
    expect(battle.mysteryEncounterType).toBeUndefined();
    expect(battle.enemyLevels?.length).toBeGreaterThan(0);
    expect(scene.mysteryEncounterSaveData.encounterSpawnChance).toBe(73);
  });

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

  it("schedules at most one event without disabling the previous choice or changing frequency", () => {
    const { gameData } = game.scene;
    const first = getMysteryEncounterSettingKey(MysteryEncounterType.UNCOMMON_BREED);
    const second = getMysteryEncounterSettingKey(MysteryEncounterType.FUN_AND_GAMES);
    preference(2);
    gameData.saveSetting(first, 2);
    gameData.saveSetting(second, 2);
    expect(JSON.parse(localStorage.getItem("settings")!)).toMatchObject(
      { [first]: 1, [second]: 2, [MYSTERY_ENCOUNTER_FREQUENCY_SETTING]: 2 },
    );
    expect(getScheduledEncounterSetting({})).toBe(MysteryEncounterType.FUN_AND_GAMES);
    gameData.saveSetting(second, 0);
    expect(getScheduledEncounterSetting({})).toBeNull();
  });

  it("moves the Scheduled highlight, remembers it, and hides locked replay options", () => {
    const handler = game.scene.ui.handlers[UiMode.SETTINGS_EVENTS] as SettingsEventsUiHandler;
    const index = (type: MysteryEncounterType) => handler["settings"].findIndex(s => s.key === getMysteryEncounterSettingKey(type));
    const mining = index(MysteryEncounterType.MINING);
    const safari = index(MysteryEncounterType.SAFARI_ZONE);
    const ash = index(MysteryEncounterType.PALLET_EXHIBITION);
    handler.show([]);
    expect(handler["getOptionCount"](ash)).toBe(2);
    handler.setOptionCursor(mining, 2, true);
    handler.setOptionCursor(safari, 2, true);
    expect(handler["optionCursors"][mining]).toBe(1);
    handler.clear();
    game.scene.gameData.computerPartnerUnlocks.ash_ketchum = 123;
    handler.show([]);
    expect(handler["getOptionCount"](ash)).toBe(3);
    expect(handler["optionCursors"][safari]).toBe(2);
    handler.clear();
  });

  it("requires the earned Ash or AmberTwo unlock and excludes scripted, reward-only and disabled events", () => {
    for (const [type, key] of [
      [MysteryEncounterType.PALLET_EXHIBITION, "ash_ketchum"],
      [MysteryEncounterType.LIFE_IS_WONDERFUL, "amber_two"],
    ] as const) {
      localStorage.setItem("settings", JSON.stringify({ [getMysteryEncounterSettingKey(type)]: 2 }));
      expect(getScheduledEncounterSetting({})).toBeNull();
      expect(getScheduledEncounterSetting({ [key]: 123 })).toBe(type);
    }
    for (const type of [MysteryEncounterType.DEJA_VU, MysteryEncounterType.GTS_MALFUNCTION,
      MysteryEncounterType.CONTEST_HALL, MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
      MysteryEncounterType.FIELD_TRIP]) {
      expect(canReserveEncounter(type)).toBe(false);
      expect(getMysteryEncounterEventSettings().find(s => s.key === getMysteryEncounterSettingKey(type))?.options).toHaveLength(2);
    }
  });

  it("leaves Lost at Sea random when On and waits for a legal Sea wave when Scheduled", () => {
    const scene = game.scene;
    const type = MysteryEncounterType.LOST_AT_SEA;
    const key = getMysteryEncounterSettingKey(type);
    expect(getMysteryEncounterEventSettings().find(s => s.key === key)?.options.map(o => o.value))
      .toEqual(["Off", "On", "Scheduled"]);
    const forced = (wave: number) => scene["getForcedMysteryEncounterTypeForWave"](BattleType.WILD, wave);
    scene.newArena(BiomeId.SEA);
    scene.mysteryEncounterSaveData.frequency = 0;
    scene.gameData.saveSetting(key, 1);
    expect(scene["isMysteryEncounterEnabled"](type)).toBe(true);
    expect(forced(22)).toBeUndefined();
    expect(roll(22)).toBe(false);
    scene.gameData.saveSetting(key, 0);
    expect(scene["isMysteryEncounterEnabled"](type)).toBe(false);

    scene.gameData.saveSetting(key, 2);
    scene.mysteryEncounterSaveData.scheduledEncounter = getScheduledEncounterSetting({});
    expect(forced(19)).toBeUndefined();
    scene.newArena(BiomeId.LAKE);
    expect(forced(22)).toBeUndefined();
    scene.mysteryEncounterSaveData = new MysteryEncounterSaveData(JSON.parse(JSON.stringify(scene.mysteryEncounterSaveData)));
    scene.newArena(BiomeId.SEA);
    expect(forced(51)).toBeUndefined();
    expect(forced(56)).toBe(type);
    scene.mysteryEncounterSaveData.encounteredEvents.push(new SeenEncounterData(type, MysteryEncounterTier.COMMON, 56));
    expect(forced(57)).toBeUndefined();
  });

  it("keeps Mining pending across wrong biomes, occupied waves, wave 50, and a save/load", () => {
    const scene = game.scene;
    const type = MysteryEncounterType.MINING;
    localStorage.setItem("settings", JSON.stringify({ [getMysteryEncounterSettingKey(type)]: 2 }));
    const title = new TitlePhase();
    title.gameMode = GameModes.CLASSIC;
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    title.end();
    const forced = (wave: number, battleType = BattleType.WILD) => scene["getForcedMysteryEncounterTypeForWave"](battleType, wave);
    scene.newArena(BiomeId.PLAINS);
    expect(forced(22)).toBeUndefined();
    scene.mysteryEncounterSaveData = new MysteryEncounterSaveData(JSON.parse(JSON.stringify(scene.mysteryEncounterSaveData)));
    localStorage.setItem("settings", JSON.stringify({ [getMysteryEncounterSettingKey(type)]: 0 }));
    scene.newArena(BiomeId.CAVE);
    expect(forced(19)).toBeUndefined();
    expect(forced(22)).toBe(type);
    expect(forced(49, BattleType.TRAINER)).toBeUndefined();
    expect(forced(50)).toBeUndefined();
    expect(forced(51)).toBeUndefined();
    expect(forced(52)).toBe(type);
    expect(scene["isMysteryEncounterEnabled"](type)).toBe(true);
    const disabled = vi.spyOn(timedEventManager, "getEventMysteryEncountersDisabled").mockReturnValue([type]);
    expect(forced(52)).toBeUndefined();
    disabled.mockRestore();
    scene.mysteryEncounterSaveData.encounteredEvents.push(new SeenEncounterData(type, MysteryEncounterTier.COMMON, 24));
    expect(forced(52)).toBeUndefined();
    expect(new MysteryEncounterSaveData().scheduledEncounter).toBeNull();
  });

  it("leaves room for the built-in schedule and checks the upcoming wave's price", () => {
    const scene = game.scene;
    const type = MysteryEncounterType.FUN_AND_GAMES;
    scene.newArena(BiomeId.METROPOLIS);
    scene.currentBattle = new Battle(scene.gameMode, { waveIndex: 23, battleType: BattleType.WILD, double: false });
    scene.mysteryEncounterSaveData.scheduledEncounter = type;
    scene.money = scene.getWaveMoneyAmount(1.5, 24) - 1;
    const due = () => scene["getForcedMysteryEncounterTypeForWave"](BattleType.WILD, 24);
    expect(due()).toBeUndefined();
    scene.money++;
    expect(due()).toBe(type);
    vi.spyOn(scene as unknown as { isScheduledContestHallMysteryEncounterWave(): boolean },
      "isScheduledContestHallMysteryEncounterWave").mockReturnValue(true);
    expect(due()).toBeUndefined();
  });

  it("generates the reserved encounter even with the random event frequency at zero", () => {
    const scene = game.scene;
    const type = MysteryEncounterType.MINING;
    scene.newArena(BiomeId.CAVE);
    scene.mysteryEncounterSaveData.frequency = 0;
    scene.mysteryEncounterSaveData.scheduledEncounter = type;
    vi.spyOn(activeOverrides, "STARTING_WAVE_OVERRIDE", "get").mockReturnValue(22);
    vi.spyOn(activeOverrides, "BATTLE_TYPE_OVERRIDE", "get").mockReturnValue(null);
    vi.spyOn(scene.gameMode, "isWaveTrainer").mockReturnValue(false);
    const battle = scene.newBattle();
    expect(battle.waveIndex).toBe(22);
    expect(battle.battleType).toBe(BattleType.MYSTERY_ENCOUNTER);
    expect(battle.mysteryEncounterType).toBe(type);
  });

  it.each([2, 3] as const)("uses the host's choice instead of the guest's preference in %ip", count => {
    preference(6);
    game.scene.gameData.saveSetting(getMysteryEncounterSettingKey(MysteryEncounterType.MINING), 2);
    const host = new TitlePhase();
    host["announceTwoPlayerProfileForStartup"] = () => {};
    host["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
    vi.spyOn(host, "end").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const broadcast = vi.spyOn(game.scene.uiInputs, "broadcastTwoPlayerTitleStart").mockReturnValue(false);
    host["startMultiplayerRun"](GameModes.CLASSIC, count, 6);
    const payload: TwoPlayerTitleStart = JSON.parse(JSON.stringify(broadcast.mock.calls[0][0]));
    expect(payload.mysteryEncounterFrequency).toBe(6);
    expect(payload.scheduledEncounter).toBe(MysteryEncounterType.MINING);
    preference(0);
    game.scene.gameData.saveSetting(getMysteryEncounterSettingKey(MysteryEncounterType.UNCOMMON_BREED), 2);
    const guest = new TitlePhase();
    guest["announceTwoPlayerProfileForStartup"] = () => {};
    guest["waitForTwoPlayerProfilesBeforeRun"] = callback => callback();
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    expect(guest["applyRemoteTwoPlayerTitleStart"](payload)).toBe(true);
    expect(game.scene.mysteryEncounterSaveData.frequency).toBe(6);
    expect(game.scene.mysteryEncounterSaveData.scheduledEncounter).toBe(MysteryEncounterType.MINING);
  });
});
