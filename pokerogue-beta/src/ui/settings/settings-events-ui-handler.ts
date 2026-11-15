import { globalScene } from "#app/global-scene";
import type { UiMode } from "#enums/ui-mode";
import { canReserveEncounter } from "#mystery-encounters/encounter-reservation";
import { getEventTypeForSetting, getMysteryEncounterEventSettings, SCHEDULED_OPTION } from "#system/settings-events";
import { SettingType } from "#system/settings";
import { AbstractSettingsUiHandler } from "#ui/abstract-settings-ui-handler";

export class SettingsEventsUiHandler extends AbstractSettingsUiHandler {
  private unlocks: Parameters<typeof canReserveEncounter>[1];

  constructor(mode: UiMode | null = null) {
    super(SettingType.EVENTS, mode);
    this.title = "Events";
    this.localStorageKey = "settings";
    this.settings = getMysteryEncounterEventSettings();
  }

  override show(args: any[]): boolean {
    this.unlocks = globalScene.getPlayerGameData(0).computerPartnerUnlocks;
    const shown = super.show(args);
    this.updateSettingsScroll();
    return shown;
  }

  protected override getOptionCount(index: number): number {
    const type = getEventTypeForSetting(this.settings[index].key);
    return type != null && !canReserveEncounter(type, this.unlocks) ? 2 : super.getOptionCount(index);
  }

  override setOptionCursor(index: number, cursor: number, save?: boolean): boolean {
    const changed = super.setOptionCursor(index, cursor, save);
    if (changed && save && cursor === SCHEDULED_OPTION && getEventTypeForSetting(this.settings[index]?.key) != null) {
      // saveSetting demoted any previous selection in the same write. Refresh its highlight too.
      const settings = JSON.parse(localStorage.getItem(this.localStorageKey) ?? "{}");
      this.settings.forEach((row, i) => super.setOptionCursor(i, settings[row.key] ?? row.default));
    }
    return changed;
  }
}
