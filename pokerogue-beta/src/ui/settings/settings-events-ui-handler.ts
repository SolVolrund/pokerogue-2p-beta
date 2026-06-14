import type { UiMode } from "#enums/ui-mode";
import { getMysteryEncounterEventSettings } from "#system/settings-events";
import { SettingType } from "#system/settings";
import { AbstractSettingsUiHandler } from "#ui/abstract-settings-ui-handler";

export class SettingsEventsUiHandler extends AbstractSettingsUiHandler {
  constructor(mode: UiMode | null = null) {
    super(SettingType.EVENTS, mode);
    this.title = "Events";
    this.localStorageKey = "settings";
    this.settings = getMysteryEncounterEventSettings();
  }
}
