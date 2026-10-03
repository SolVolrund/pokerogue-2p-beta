import {
  AVERAGE_ENCOUNTERS_PER_RUN_TARGET,
  BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT,
  WEIGHT_INCREMENT_ON_SPAWN_MISS,
} from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import type { GameModes } from "#enums/game-modes";
import type { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import type { MysteryEncounterType } from "#enums/mystery-encounter-type";
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
  encounteredEvents: SeenEncounterData[] = [];
  encounterSpawnChance: number = BASE_MYSTERY_ENCOUNTER_SPAWN_WEIGHT;
  queuedEncounters: QueuedEncounter[] = [];
  fieldBlessing?: FieldBlessing;
  contestHallProgress: ContestHallProgress = {};
  rocketHqVisited = false;
  lostAtSeaFirstSeaStartWave?: number;
  lostAtSeaFirstSeaForcedDone = false;
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
    this.encounteredEvents = this.encounteredEvents ?? [];
    this.queuedEncounters = this.queuedEncounters ?? [];
    this.contestHallProgress = this.contestHallProgress ?? {};
    this.rocketHqVisited = !!this.rocketHqVisited;
    this.lostAtSeaFirstSeaForcedDone = !!this.lostAtSeaFirstSeaForcedDone;
    this.dejaVuScheduleInitialized = !!this.dejaVuScheduleInitialized;
    this.dejaVuScheduledEncounters = this.dejaVuScheduledEncounters ?? [];
  }
}
