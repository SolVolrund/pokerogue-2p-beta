import {
  AVERAGE_ENCOUNTERS_PER_RUN_TARGET,
  BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT,
  WEIGHT_INCREMENT_ON_SPAWN_MISS,
} from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { BiomeId } from "#enums/biome-id";
import type { GameModes } from "#enums/game-modes";
import type { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { isReservableEncounter } from "#mystery-encounters/encounter-reservation";
import type { FieldBlessing } from "#utils/field-blessings";

export class SeenEncounterData {
  type: MysteryEncounterType;
  tier: MysteryEncounterTier;
  waveIndex: number;
  selectedOption: number;

  constructor(type: MysteryEncounterType, tier: MysteryEncounterTier, waveIndex: number, selectedOption?: number) {
    this.type = type;
    this.tier = tier;
    this.waveIndex = waveIndex;
    this.selectedOption = selectedOption ?? -1;
  }
}

export interface QueuedEncounter {
  type: MysteryEncounterType;
  spawnPercent: number; // Out of 100
}

export const ROCKET_HQ_FLOORS = 5;

export interface RocketHqVisit {
  entryWave: number;
  returnBiome: BiomeId;
  /** Zero while leaving the Game Corner; 1-5 during a fight. */
  floor: number;
}

export interface ContestHallProgress {
  declined?: boolean;
  wonNormal?: boolean;
  wonSuper?: boolean;
  wonHyper?: boolean;
  wonMaster?: boolean;
  wonGrand?: boolean;
  lastContestWave?: number;
  nextScheduledWave?: number;
  receivedPokeblockKit?: boolean;
}

export interface DejaVuScheduledEncounterData {
  scheduledWave: number;
  mode: GameModes;
  runKey?: string;
  ghostTimestampsByPlayer: Partial<Record<PlayerIndex, number>>;
  completed?: boolean;
}

export function normalizeMysteryEncounterFrequency(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 6
    ? value
    : WEIGHT_INCREMENT_ON_SPAWN_MISS;
}

export class MysteryEncounterSaveData {
  frequency = WEIGHT_INCREMENT_ON_SPAWN_MISS;
  scheduledEncounter: MysteryEncounterType | null = null;
  encounteredEvents: SeenEncounterData[] = [];
  encounterSpawnChance: number = BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT;
  queuedEncounters: QueuedEncounter[] = [];
  fieldBlessing?: FieldBlessing;
  contestHallProgress: ContestHallProgress = {};
  rocketHqVisited = false;
  rocketHq?: RocketHqVisit | undefined;
  dejaVuScheduleInitialized = false;
  dejaVuScheduleRunKey?: string;
  dejaVuScheduledEncounters: DejaVuScheduledEncounterData[] = [];

  get encounterTarget(): number {
    return AVERAGE_ENCOUNTERS_PER_RUN_TARGET * this.frequency / WEIGHT_INCREMENT_ON_SPAWN_MISS;
  }

  constructor(data?: MysteryEncounterSaveData) {
    if (data != null) {
      Object.assign(this, data);
    }

    // Older saves retain the original frequency, regardless of the current menu preference.
    this.frequency = normalizeMysteryEncounterFrequency(this.frequency);
    if (!isReservableEncounter(this.scheduledEncounter)) {
      this.scheduledEncounter = null;
    }
    this.encounteredEvents = this.encounteredEvents ?? [];
    this.queuedEncounters = this.queuedEncounters ?? [];
    this.contestHallProgress = this.contestHallProgress ?? {};
    this.rocketHqVisited = !!this.rocketHqVisited;
    const visit = this.rocketHq;
    if (visit && Number.isSafeInteger(visit.entryWave) && visit.entryWave > 0
      && Number.isInteger(visit.floor) && visit.floor >= 0 && visit.floor <= ROCKET_HQ_FLOORS
      && Object.values(BiomeId).includes(visit.returnBiome) && visit.returnBiome !== BiomeId.ROCKET_HQ) {
      this.rocketHq = { ...visit };
      this.rocketHqVisited = true;
    } else {
      this.rocketHq = undefined;
    }
    this.dejaVuScheduleInitialized = !!this.dejaVuScheduleInitialized;
    this.dejaVuScheduledEncounters = this.dejaVuScheduledEncounters ?? [];
  }
}
