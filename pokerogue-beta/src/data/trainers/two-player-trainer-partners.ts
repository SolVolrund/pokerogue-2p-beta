import { TrainerType } from "#enums/trainer-type";
import { randSeedItem } from "#utils/common";
import { randSeedUniqueItem } from "#utils/random";
import partnerLookupText from "./two-player-trainer-partners.md?raw";

const TRAINER_ID_PATTERN = /^[A-Z][A-Z0-9_]+$/;
const PARTNER_ID_PATTERN = /^\*\s+([A-Z][A-Z0-9_]+)$/;
const SKIPPED_IDS = new Set(["CMD", "IE", "SINNOH_PARTNER"]);

function trainerTypeFromId(id: string): TrainerType | undefined {
  const value = (TrainerType as unknown as Record<string, TrainerType>)[id];
  return typeof value === "number" ? value : undefined;
}

function addPartner(
  map: Map<TrainerType, TrainerType[]>,
  trainerId: string,
  partnerId: string,
): void {
  const trainerType = trainerTypeFromId(trainerId);
  const partnerType = trainerTypeFromId(partnerId);

  if (trainerType == null || partnerType == null) {
    console.warn(`Skipping unknown two-player trainer partner entry: ${trainerId} -> ${partnerId}`);
    return;
  }

  const partners = map.get(trainerType) ?? [];
  if (!partners.includes(partnerType)) {
    partners.push(partnerType);
  }
  map.set(trainerType, partners);
}

function buildPartnerPools(markdown: string): ReadonlyMap<TrainerType, readonly TrainerType[]> {
  const map = new Map<TrainerType, TrainerType[]>();
  let currentTrainerIds: string[] = [];
  let collectingPartners = false;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line === "---") {
      currentTrainerIds = [];
      collectingPartners = false;
      continue;
    }

    if (line === "Partners:") {
      collectingPartners = true;
      continue;
    }

    const partnerMatch = line.match(PARTNER_ID_PATTERN);
    if (partnerMatch) {
      for (const trainerId of currentTrainerIds) {
        addPartner(map, trainerId, partnerMatch[1]);
      }
      collectingPartners = true;
      continue;
    }

    if (line === "* Pair with each other") {
      for (const trainerId of currentTrainerIds) {
        for (const partnerId of currentTrainerIds) {
          if (partnerId !== trainerId) {
            addPartner(map, trainerId, partnerId);
          }
        }
      }
      collectingPartners = true;
      continue;
    }

    if (TRAINER_ID_PATTERN.test(line) && !SKIPPED_IDS.has(line)) {
      if (collectingPartners) {
        currentTrainerIds = [];
        collectingPartners = false;
      }
      currentTrainerIds.push(line);
    }
  }

  return map;
}

export const twoPlayerTrainerPartnerPools = buildPartnerPools(partnerLookupText);

export function getTwoPlayerTrainerPartners(trainerType: TrainerType): readonly TrainerType[] {
  return twoPlayerTrainerPartnerPools.get(trainerType) ?? [];
}

export function getRandomTwoPlayerTrainerPartner(trainerType: TrainerType): TrainerType | undefined {
  const partners = getTwoPlayerTrainerPartners(trainerType);
  return partners.length > 0 ? randSeedItem(partners) : undefined;
}

export function getRandomTwoPlayerTrainerPartners(trainerType: TrainerType, count: number): TrainerType[] {
  const partners = getTwoPlayerTrainerPartners(trainerType);

  if (partners.length === 0 || count <= 0) {
    return [];
  }

  return Array.from({ length: count }, (_, i) => randSeedUniqueItem(partners, i));
}
