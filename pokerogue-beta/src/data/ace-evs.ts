import { Stat, type PermanentStat } from "#enums/stat";
import type { SpeciesId } from "#enums/species-id";
import { speciesDataRegistry } from "#app/global-species-data-registry";

export type AceEvSpread = [number, number, number, number, number, number];

export const ACE_EV_PURCHASE_AMOUNT = 4;
export const ACE_EV_STAT_CAP = 252;
export const ACE_EV_TOTAL_CAP = 508;
export const ACE_EV_CANDY_COST_STEP_SIZE = 20;
export const ACE_EV_CANDY_COST_STEP = 4;
export const ACE_EV_LEVEL_CAP = 200;

const EMPTY_ACE_EV_SPREAD: AceEvSpread = [0, 0, 0, 0, 0, 0];

export function createEmptyAceEvSpread(): AceEvSpread {
  return [...EMPTY_ACE_EV_SPREAD];
}

export function normalizeAceEvValue(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const rounded = Math.floor(numeric / ACE_EV_PURCHASE_AMOUNT) * ACE_EV_PURCHASE_AMOUNT;
  return Math.min(Math.max(rounded, 0), ACE_EV_STAT_CAP);
}

export function normalizeAceEvTotal(value: unknown): number {
  const numeric = typeof value === "number" && Number.isFinite(value) ? value : 0;
  const rounded = Math.floor(numeric / ACE_EV_PURCHASE_AMOUNT) * ACE_EV_PURCHASE_AMOUNT;
  return Math.min(Math.max(rounded, 0), ACE_EV_TOTAL_CAP);
}

export function normalizeAceEvSpread(spread?: readonly number[]): AceEvSpread {
  return PERMANENT_STAT_ORDER.map(stat => normalizeAceEvValue(spread?.[stat])) as AceEvSpread;
}

export function getAceEvAssignedTotal(spread?: readonly number[]): number {
  return normalizeAceEvSpread(spread).reduce((total, value) => total + value, 0);
}

export function normalizeAceEvState(
  total?: number,
  spread?: readonly number[],
): { total: number; spread: AceEvSpread } {
  const normalizedSpread = normalizeAceEvSpread(spread);
  let normalizedTotal = normalizeAceEvTotal(total);
  const assignedTotal = normalizedSpread.reduce((sum, value) => sum + value, 0);

  if (total === undefined) {
    normalizedTotal = Math.min(assignedTotal, ACE_EV_TOTAL_CAP);
  }

  if (assignedTotal <= normalizedTotal) {
    return { total: normalizedTotal, spread: normalizedSpread };
  }

  let remaining = normalizedTotal;
  const trimmed = createEmptyAceEvSpread();
  for (const stat of PERMANENT_STAT_ORDER) {
    const value = Math.min(normalizedSpread[stat], remaining);
    trimmed[stat] = normalizeAceEvValue(value);
    remaining -= trimmed[stat];
  }

  return { total: normalizedTotal, spread: trimmed };
}

export function getAceEvUnassignedTotal(total?: number, spread?: readonly number[]): number {
  const state = normalizeAceEvState(total, spread);
  return Math.max(state.total - getAceEvAssignedTotal(state.spread), 0);
}

export function getAceEvCandyCost(total?: number): number {
  const normalizedTotal = normalizeAceEvTotal(total);
  return (Math.floor(normalizedTotal / ACE_EV_CANDY_COST_STEP_SIZE) + 1) * ACE_EV_CANDY_COST_STEP;
}

export function getAceEvDivisorForStarterCost(starterCost: number): 4 | 8 | 16 {
  if (starterCost <= 3) {
    return 4;
  }
  if (starterCost <= 6) {
    return 8;
  }
  return 16;
}

export function getAceEvDivisorForSpecies(speciesId: SpeciesId): 4 | 8 | 16 {
  const starterSpeciesId = speciesDataRegistry.getStarter(speciesId);
  const starterCost = speciesDataRegistry.getStarterCost(starterSpeciesId);
  return getAceEvDivisorForStarterCost(starterCost);
}

export function getAceEvStatBonus(ev: number, level: number, divisor: number): number {
  return Math.floor((normalizeAceEvValue(ev) * level) / (divisor * ACE_EV_LEVEL_CAP));
}

export function getAceEvStatPriority(stats: readonly number[]): PermanentStat[] {
  const coreStats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF] as const satisfies readonly PermanentStat[];
  const coreWinner = coreStats.reduce((best, stat) => stats[stat] > stats[best] ? stat : best, Stat.ATK);
  const hpOverSpeed = stats[Stat.HP] >= stats[Stat.SPD];

  switch (coreWinner) {
    case Stat.ATK:
      return hpOverSpeed ? [Stat.ATK, Stat.HP, Stat.SPD] : [Stat.ATK, Stat.SPD, Stat.HP];
    case Stat.SPATK:
      return hpOverSpeed ? [Stat.SPATK, Stat.HP, Stat.SPD] : [Stat.SPATK, Stat.SPD, Stat.HP];
    case Stat.DEF:
      return hpOverSpeed ? [Stat.DEF, Stat.HP, Stat.SPDEF] : [Stat.DEF, Stat.SPD, Stat.HP];
    case Stat.SPDEF:
      return hpOverSpeed ? [Stat.SPDEF, Stat.HP, Stat.DEF] : [Stat.SPDEF, Stat.SPD, Stat.HP];
  }
}

export function assignAceEvSpread(total: number | undefined, stats: readonly number[]): AceEvSpread {
  let remaining = normalizeAceEvTotal(total);
  const spread = createEmptyAceEvSpread();

  for (const stat of getAceEvStatPriority(stats)) {
    if (remaining <= 0) {
      break;
    }
    spread[stat] = Math.min(ACE_EV_STAT_CAP, remaining);
    remaining -= spread[stat];
  }

  return spread;
}

export const PERMANENT_STAT_ORDER = [
  Stat.HP,
  Stat.ATK,
  Stat.DEF,
  Stat.SPATK,
  Stat.SPDEF,
  Stat.SPD,
] as const satisfies readonly PermanentStat[];
