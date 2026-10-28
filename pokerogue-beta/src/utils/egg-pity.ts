import {
  BASE_SAME_SPECIES_SHINY_INCREASE_COUNT,
  MAX_SAME_SPECIES_SHINY_INCREASE_COUNT,
  MISSING_VARIANT_PITY_GUARANTEE,
  SAME_SPECIES_EGG_SHINY_RATE,
  SHINY_EPIC_CHANCE,
  SHINY_VARIANT_CHANCE,
} from "#balance/rates";
import { DexAttr } from "#enums/dex-attr";
import { VariantTier } from "#enums/variant-tier";
import { randSeedFloat, randSeedInt } from "#utils/common";

export type SameSpeciesEggPity = [number, number];

const legacyEggDiscountThresholds: readonly (readonly number[])[] = [
  [20, 40, 80],
  [20, 40, 80],
  [20, 40, 80],
  [15, 30, 60],
  [15, 30, 60],
  [15, 30, 60],
  [10, 20, 40],
  [10, 20, 40],
  [10, 20, 40],
  [8, 16, 32],
];

/** Initialize once, including upstream's compensation for retired hatch-count discounts. */
export function ensureSameSpeciesEggPity(
  entry: { pity?: SameSpeciesEggPity },
  starterCost: number,
  hatchedCount: number,
  caughtAttr: bigint,
  hasVariants: boolean,
): SameSpeciesEggPity {
  if (!entry.pity) {
    const thresholds = legacyEggDiscountThresholds[starterCost - 1] ?? [];
    const credit =
      getMissingEggVariants(caughtAttr, hasVariants).length > 0
        ? 3 * thresholds.filter(threshold => hatchedCount >= threshold).length
        : 0;
    entry.pity = [0, credit];
  }
  return entry.pity;
}

export function getMissingEggVariants(
  caughtAttr: bigint,
  hasVariants: boolean,
  pendingVariants: readonly VariantTier[] = [],
): VariantTier[] {
  if (!hasVariants) {
    return [];
  }
  return [VariantTier.RARE, VariantTier.EPIC].filter(tier => {
    const attr = tier === VariantTier.RARE ? DexAttr.VARIANT_2 : DexAttr.VARIANT_3;
    return !(caughtAttr & attr) && !pendingVariants.includes(tier);
  });
}

export function rollSameSpeciesEggShiny(pity: SameSpeciesEggPity): boolean {
  const count = ++pity[0];
  const baseRate = 1 / SAME_SPECIES_EGG_SHINY_RATE;
  const progress = Math.max(
    0,
    Math.min(
      1,
      (count - BASE_SAME_SPECIES_SHINY_INCREASE_COUNT)
        / (MAX_SAME_SPECIES_SHINY_INCREASE_COUNT - BASE_SAME_SPECIES_SHINY_INCREASE_COUNT),
    ),
  );
  const shiny = randSeedFloat() < baseRate + progress * (1 - baseRate);
  if (shiny) {
    pity[0] = 0;
  }
  return shiny;
}

export function rollEggShinyVariant(): VariantTier {
  const roll = randSeedInt(10);
  return roll >= SHINY_VARIANT_CHANCE
    ? VariantTier.STANDARD
    : roll >= SHINY_EPIC_CHANCE
      ? VariantTier.RARE
      : VariantTier.EPIC;
}

/** Called only for shiny eggs; already owned or pending variants do not count as missing. */
export function rollSameSpeciesEggVariant(
  pity: SameSpeciesEggPity,
  missingVariants: readonly VariantTier[],
): VariantTier {
  if (missingVariants.length > 0 && ++pity[1] >= MISSING_VARIANT_PITY_GUARANTEE) {
    pity[1] = 0;
    return missingVariants.length === 2 ? (randSeedInt(4) ? VariantTier.RARE : VariantTier.EPIC) : missingVariants[0];
  }
  const variant = rollEggShinyVariant();
  if (missingVariants.includes(variant)) {
    pity[1] = 0;
  }
  return variant;
}
