import type { CooldownHeldItemModifier, Modifier, ResetNegativeStatStageModifier } from "#modifiers/modifier";

export const COOLDOWN_HELD_ITEM_IDS = [
  "WHITE_HERB",
  "POWER_HERB",
  "BLUNDER_POLICY",
  "WEAKNESS_POLICY",
  "AIR_BALLOON",
] as const;

export type CooldownHeldItemId = (typeof COOLDOWN_HELD_ITEM_IDS)[number];
export type HeldItemReadyWaves = Partial<Record<CooldownHeldItemId, number[]>>;
export type CooldownItem = ResetNegativeStatStageModifier | CooldownHeldItemModifier;

export function isCooldownHeldItem(item: Modifier): item is CooldownItem {
  return item.is("ResetNegativeStatStageModifier") || item.is("CooldownHeldItemModifier");
}

export function getCooldownHeldItemId(item: CooldownItem): CooldownHeldItemId {
  return item.is("ResetNegativeStatStageModifier") ? "WHITE_HERB" : item.cooldownItemId;
}

export function copyHeldItemReadyWaves(source?: HeldItemReadyWaves): HeldItemReadyWaves {
  const result: HeldItemReadyWaves = {};
  for (const itemId of COOLDOWN_HELD_ITEM_IDS) {
    if (source?.[itemId]) {
      result[itemId] = [0, 1, 2].map(player => {
        const wave = source[itemId]?.[player];
        return typeof wave === "number" && Number.isFinite(wave) ? Math.max(0, Math.floor(wave)) : 0;
      });
    }
  }
  return result;
}
