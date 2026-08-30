import type { PartialContestStats } from "#data/contests/contest-stats";
import type { RibbonData } from "#system/ribbons/ribbon-data";

export interface DexData {
  [key: number]: DexEntry;
}

export interface DexEntry {
  seenAttr: bigint;
  caughtAttr: bigint;
  natureAttr: number;
  seenCount: number;
  caughtCount: number;
  hatchedCount: number;
  ivs: number[];
  /**
   * Spinda-only PID customization progress.
   *
   * Eight entries, one per hex digit position in the 32-bit PID. Each entry is a
   * 16-bit mask where bit N means hex digit N has been unlocked for that column.
   */
  spindaPidDigitMasks?: number[];
  contestStats?: PartialContestStats;
  ribbons: RibbonData;
}
