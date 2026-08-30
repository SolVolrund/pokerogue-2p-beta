import { isDamageReductionBerryType } from "#data/berry";
import { BerryType } from "#enums/berry-type";
import { SettingKeys, isSettingEnabled } from "#system/settings";

const NEW_BOSS_ITEM_IDS = new Set([
  "EVIOLITE",
  "GAMMA_RAY_BURST",
  "OLD_SEA_MAP",
  "UNOWN_BOX",
  "GRAND_LAUREL",
]);

const Z_ITEM_IDS = new Set(["Z_RING", "Z_CRYSTAL"]);

function isBerryType(value: unknown): value is BerryType {
  return typeof value === "number" && value in BerryType;
}

export function areTypeGemsEnabled(): boolean {
  return isSettingEnabled(SettingKeys.Item_Set_Type_Gems);
}

export function areResistBerriesEnabled(): boolean {
  return isSettingEnabled(SettingKeys.Item_Set_Resist_Berries);
}

export function isBerryAllowedByItemSettings(berryType: BerryType): boolean {
  return areResistBerriesEnabled() || !isDamageReductionBerryType(berryType);
}

export function getBerryTypesAllowedByItemSettings<T extends BerryType>(berryTypes: readonly T[]): T[] {
  return berryTypes.filter(isBerryAllowedByItemSettings);
}

export function isModifierAllowedByItemSettings(modifierId: string | undefined, pregenArgs?: readonly unknown[]): boolean {
  if (!modifierId) {
    return true;
  }

  if (modifierId === "TYPE_GEM") {
    return areTypeGemsEnabled();
  }

  if (Z_ITEM_IDS.has(modifierId)) {
    return isSettingEnabled(SettingKeys.Item_Set_Z_Ring);
  }

  if (NEW_BOSS_ITEM_IDS.has(modifierId)) {
    return isSettingEnabled(SettingKeys.Item_Set_Boss_Items);
  }

  if (modifierId === "BERRY" && pregenArgs?.length === 1 && isBerryType(pregenArgs[0])) {
    return isBerryAllowedByItemSettings(pregenArgs[0]);
  }

  return true;
}
