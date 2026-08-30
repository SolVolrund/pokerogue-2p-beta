import { UiMode } from "#enums/ui-mode";
import { SettingType } from "#system/settings";
import { AbstractSettingsUiHandler } from "#ui/abstract-settings-ui-handler";

export class SettingsItemsUiHandler extends AbstractSettingsUiHandler {
  constructor(mode: UiMode | null = null) {
    super(SettingType.ITEMS, mode ?? UiMode.SETTINGS_ITEMS);
    this.title = "Items";
    this.localStorageKey = "settings";
  }
}
