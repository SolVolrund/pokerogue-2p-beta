export const DOWSING_GROUPS = [
  "EVOLUTION_ITEM",
  "RARE_EVOLUTION_ITEM",
  "RARE_FORM_CHANGE_ITEM",
  "FORM_CHANGE_ITEM",
  "Z_CRYSTAL",
] as const;

export type DowsingGroup = (typeof DOWSING_GROUPS)[number];
export type DowsingPreferences = Partial<Record<DowsingGroup, number | string>>;
