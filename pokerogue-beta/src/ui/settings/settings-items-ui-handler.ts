import { UiMode } from "#enums/ui-mode";
import type { Setting } from "#system/settings";
import { SettingType } from "#system/settings";
import { AbstractSettingsUiHandler } from "#ui/abstract-settings-ui-handler";
import i18next from "i18next";

const ITEM_SETTING_OPTIONS = [
  { value: "Off", label: i18next.t("settings:off") },
  { value: "On", label: i18next.t("settings:on") },
];

const DUMMY_ITEM_SETTINGS: Setting[] = [
  {
    key: "ITEM_SET_BOSS_ITEMS",
    label: "New Boss Items",
    options: ITEM_SETTING_OPTIONS,
    default: 1,
    type: SettingType.ITEMS,
  },
  {
    key: "ITEM_SET_TYPE_GEMS",
    label: "Type Gems",
    options: ITEM_SETTING_OPTIONS,
    default: 1,
    type: SettingType.ITEMS,
  },
  {
    key: "ITEM_SET_RESIST_BERRIES",
    label: "Resist Berries",
    options: ITEM_SETTING_OPTIONS,
    default: 1,
    type: SettingType.ITEMS,
  },
  {
    key: "ITEM_SET_Z_RING",
    label: "Z Ring",
    options: ITEM_SETTING_OPTIONS,
    default: 1,
    type: SettingType.ITEMS,
  },
];

export class SettingsItemsUiHandler extends AbstractSettingsUiHandler {
  constructor(mode: UiMode | null = null) {
    super(SettingType.ITEMS, mode ?? UiMode.SETTINGS_ITEMS);
    this.title = "Items";
    this.localStorageKey = "settings";
    this.settings = DUMMY_ITEM_SETTINGS;
  }
}
