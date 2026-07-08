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
  contestStats?: PartialContestStats;
  ribbons: RibbonData;
}
