import { PokemonType } from "#enums/pokemon-type";
import type {
  CooldownHeldItemModifier,
  MirrorHerbModifier,
  Modifier,
  ResetNegativeStatStageModifier,
  TypeGemModifier,
} from "#modifiers/modifier";
import type { ModifierData } from "#system/modifier-data";

export const COOLDOWN_HELD_ITEM_IDS = [
  "WHITE_HERB",
  "POWER_HERB",
  "BLUNDER_POLICY",
  "WEAKNESS_POLICY",
  "AIR_BALLOON",
  "MIRROR_HERB",
] as const;

export type DirectCooldownHeldItemId = (typeof COOLDOWN_HELD_ITEM_IDS)[number];
export type CooldownHeldItemId = DirectCooldownHeldItemId | `TYPE_GEM_${PokemonType}`;
export function getTypeGemCooldownId(type: PokemonType): CooldownHeldItemId {
  return `TYPE_GEM_${type}`;
}
export const ALL_COOLDOWN_HELD_ITEM_IDS: readonly CooldownHeldItemId[] = [
  ...COOLDOWN_HELD_ITEM_IDS,
  ...Array.from({ length: PokemonType.FAIRY + 1 }, (_, type) => getTypeGemCooldownId(type)),
];
export type HeldItemReadyWaves = Partial<Record<CooldownHeldItemId, number[]>>;
export type CooldownItem =
  | ResetNegativeStatStageModifier
  | CooldownHeldItemModifier
  | MirrorHerbModifier
  | TypeGemModifier;

/** These two items could have multiple copies before becoming cooldown equipment. */
export function isLegacyCooldownHeldItem(item: Modifier): item is MirrorHerbModifier | TypeGemModifier {
  return item.is("MirrorHerbModifier") || item.is("TypeGemModifier");
}

export function isCooldownHeldItem(item: Modifier): item is CooldownItem {
  return (
    item.is("ResetNegativeStatStageModifier") || item.is("CooldownHeldItemModifier") || isLegacyCooldownHeldItem(item)
  );
}

export function getCooldownHeldItemId(item: CooldownItem): CooldownHeldItemId {
  if (item.is("ResetNegativeStatStageModifier")) return "WHITE_HERB";
  if (item.is("MirrorHerbModifier")) return "MIRROR_HERB";
  if (item.is("TypeGemModifier")) return getTypeGemCooldownId(item.moveType);
  return item.cooldownItemId;
}

export function getSavedCooldownHeldItemId(
  item: Pick<ModifierData, "typeId" | "className" | "args">,
): CooldownHeldItemId | undefined {
  if (item.className === "TypeGemModifier") return getTypeGemCooldownId(item.args[1]);
  if (item.className === "MirrorHerbModifier") return "MIRROR_HERB";
  return COOLDOWN_HELD_ITEM_IDS.find(id => id === item.typeId);
}

export function copyHeldItemReadyWaves(source?: HeldItemReadyWaves): HeldItemReadyWaves {
  const result: HeldItemReadyWaves = {};
  for (const itemId of ALL_COOLDOWN_HELD_ITEM_IDS) {
    if (source?.[itemId]) {
      result[itemId] = [0, 1, 2].map(player => {
        const wave = source[itemId]?.[player];
        return typeof wave === "number" && Number.isFinite(wave) ? Math.max(0, Math.floor(wave)) : 0;
      });
    }
  }
  return result;
}
