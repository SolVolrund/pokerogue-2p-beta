import { modifierTypes } from "#data/data-lists";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { DestinyKnotModifier } from "#modifiers/modifier";
import {
  getPlayerModifierTypeOptions,
  itemPoolChecks,
  type ModifierTypeGenerator,
  ModifierTypeOption,
  regenerateModifierPoolThresholds,
} from "#modifiers/modifier-type";
import { generateModifierType } from "#mystery-encounters/encounter-phase-utils";
import { ModifierData } from "#system/modifier-data";
import { isSettingEnabled, Setting, SettingKeys, SettingType } from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import type { SettingsItemsUiHandler } from "#ui/settings-items-ui-handler";
import { isModifierAllowedByItemSettings } from "#utils/item-settings-utils";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { getSoulBondPartner, THREAD_COLORS } from "#utils/soul-bond";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const settingKey = SettingKeys.Item_Set_Destiny_Knots;

describe("Destiny Knot item settings", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings") ?? null;
    localStorage.removeItem("settings");
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    localStorage.setItem("settings", "{}");
    // The storage mock lacks the named properties provided by browser Storage.
    Object.defineProperty(localStorage, "settings", { value: true, configurable: true });
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    for (let i = 0; i < 2; i++) {
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50);
      game.scene.getPlayerParty().push(pokemon);
    }
  });

  afterEach(() => {
    itemPoolChecks.delete("DESTINY_KNOT");
    game.scene.configureTwoPlayerMode(false);
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  const generator = () => getModifierType(modifierTypes.DESTINY_KNOT) as ModifierTypeGenerator;
  const party = () => game.scene.getPlayerParty();

  it("defaults to On for settings saved before the toggle existed", () => {
    expect(Setting.find(setting => setting.key === settingKey)).toMatchObject({
      label: "Destiny Knots",
      type: SettingType.ITEMS,
      default: 1,
      options: [{ value: "Off" }, { value: "On" }],
    });
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Item_Set_Z_Ring]: 0 }));
    expect(isSettingEnabled(settingKey)).toBe(true);
    expect(generator().generateType(party())).not.toBeNull();
  });

  it("shows an Items-menu toggle and persists it when the menu is reopened", () => {
    const handler = game.scene.ui.handlers[UiMode.SETTINGS_ITEMS] as SettingsItemsUiHandler;
    const index = handler["settings"].findIndex(setting => setting.key === settingKey);
    expect(index).toBeGreaterThanOrEqual(0);
    handler.show([]);
    expect(handler.setOptionCursor(index, 0, true)).toBe(true);
    expect(isSettingEnabled(settingKey)).toBe(false);
    handler.clear();
    handler.show([]);
    expect(handler["optionCursors"][index]).toBe(0);
    expect(handler.setOptionCursor(index, 1, true)).toBe(true);
    expect(isSettingEnabled(settingKey)).toBe(true);
    handler.clear();
  });

  it("removes new rolls and pool eligibility when Off, and restores them when On", () => {
    itemPoolChecks.set("DESTINY_KNOT", false);
    for (const enabled of [true, false, true]) {
      game.scene.gameData.saveSetting(settingKey, enabled ? 1 : 0);
      regenerateModifierPoolThresholds(party(), ModifierPoolType.PLAYER);
      expect(itemPoolChecks.get("DESTINY_KNOT")).toBe(enabled);
      expect(isModifierAllowedByItemSettings("DESTINY_KNOT")).toBe(enabled);
      expect(generator().generateType(party()) !== null).toBe(enabled);
    }
  });

  it("also filters guaranteed and mystery-encounter offers while Off", () => {
    const type = generator().generateType(party(), ["red"])!;
    game.scene.gameData.saveSetting(settingKey, 0);
    expect(
      getPlayerModifierTypeOptions(0, party(), undefined, {
        guaranteedModifierTypeOptions: [new ModifierTypeOption(type, 0)],
        guaranteedModifierTypeFuncs: [modifierTypes.DESTINY_KNOT],
      }),
    ).toEqual([]);
    expect(generateModifierType(modifierTypes.DESTINY_KNOT, ["red"])).toBeNull();
  });

  it.each(THREAD_COLORS)("preserves held %s Threads and their bond when Off, including item restoration", color => {
    const [a, b] = party();
    const type = generator().generateType(party(), [color])!;
    const first = type.newModifier(a) as DestinyKnotModifier;
    const second = type.newModifier(b) as DestinyKnotModifier;
    expect(game.scene.addModifier(first, true)).toBe(true);
    expect(game.scene.addModifier(second, true)).toBe(true);
    game.scene.gameData.saveSetting(settingKey, 0);
    expect(getSoulBondPartner(a)).toBe(b);
    const data = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(first, true))), true);
    const restored = data.toModifier(DestinyKnotModifier) as DestinyKnotModifier;
    expect(restored).toBeInstanceOf(DestinyKnotModifier);
    expect(restored.color).toBe(color);
    expect(restored.type).not.toBeNull();
    expect(game.scene.removeModifier(first, false, 0)).toBe(true);
    expect(game.scene.addModifier(restored, true)).toBe(true);
    expect(getSoulBondPartner(a)).toBe(b);
  });

  it.each([1, 2, "ep"] as const)("synchronizes the host's item toggles to seat %s", seat => {
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.twoPlayerLocalInputSeat = 0;
    const itemSettings = Setting.filter(setting => setting.type === SettingType.ITEMS);
    for (const setting of itemSettings) {
      game.scene.gameData.saveSetting(setting.key, 0);
    }
    const snapshot = game.scene.getTwoPlayerSettingsSnapshot()!;
    expect(snapshot.settings[settingKey]).toBe(0);
    for (const setting of itemSettings) {
      expect(snapshot.settings[setting.key]).toBe(0);
      game.scene.gameData.saveSetting(setting.key, 1);
    }
    game.scene.twoPlayerLocalInputSeat = seat;
    expect(game.scene.applyTwoPlayerSettingsSnapshot(snapshot)).toBe(true);
    for (const setting of itemSettings) {
      expect(isSettingEnabled(setting.key)).toBe(false);
    }
  });
});
