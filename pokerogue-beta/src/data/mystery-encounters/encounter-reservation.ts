import { MysteryEncounterType } from "#enums/mystery-encounter-type";

export const FIRST_RESERVED_ENCOUNTER_WAVE = 22;

// These either have their own schedule, are a boss reward, or have no natural spawn.
const unavailable = new Set([
  MysteryEncounterType.CONTEST_HALL,
  MysteryEncounterType.DEJA_VU,
  MysteryEncounterType.GTS_MALFUNCTION,
  MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
  MysteryEncounterType.FIELD_TRIP,
]);

export function isReservableEncounter(value: unknown): value is MysteryEncounterType {
  return typeof value === "number" && Object.hasOwn(MysteryEncounterType, value) && !unavailable.has(value);
}

export function canReserveEncounter(
  type: MysteryEncounterType,
  unlocks: Partial<Record<"ash_ketchum" | "amber_two", number>> = {},
): boolean {
  if (type === MysteryEncounterType.PALLET_EXHIBITION) {
    return (unlocks.ash_ketchum ?? 0) > 0;
  }
  if (type === MysteryEncounterType.LIFE_IS_WONDERFUL) {
    return (unlocks.amber_two ?? 0) > 0;
  }
  return isReservableEncounter(type);
}
