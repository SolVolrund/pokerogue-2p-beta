import { ModifierTier } from "#enums/modifier-tier";
import { randSeedInt } from "#utils/common";

/** Ordinary item odds, including chained luck upgrades. Callers cap to their available tiers. */
export function rollRewardTier(
  luck: number | undefined,
  upgradeCount = 0,
  draw: (range: number) => number = randSeedInt,
): { tier: ModifierTier; upgradeCount: number } {
  const roll = draw(1024);
  if (roll && luck !== undefined) {
    const upgradeOdds = Math.floor(128 / ((luck + 4) / 4));
    while (draw(upgradeOdds) < 4) {
      upgradeCount++;
    }
  }
  const baseTier =
    roll > 255
      ? ModifierTier.COMMON
      : roll > 60
        ? ModifierTier.GREAT
        : roll > 12
          ? ModifierTier.ULTRA
          : roll
            ? ModifierTier.ROGUE
            : ModifierTier.MASTER;
  return { tier: baseTier + upgradeCount, upgradeCount };
}
