export enum ContestType {
  COOL = "cool",
  BEAUTY = "beauty",
  CUTE = "cute",
  SMART = "smart",
  TOUGH = "tough",
}

export interface ContestTypeData {
  id: number;
  name: string;
  color: string;
  berryFlavor: string;
}

export const contestTypeData = {
  [ContestType.COOL]: {
    id: 1,
    name: "Cool",
    color: "Red",
    berryFlavor: "spicy",
  },
  [ContestType.BEAUTY]: {
    id: 2,
    name: "Beauty",
    color: "Blue",
    berryFlavor: "dry",
  },
  [ContestType.CUTE]: {
    id: 3,
    name: "Cute",
    color: "Pink",
    berryFlavor: "sweet",
  },
  [ContestType.SMART]: {
    id: 4,
    name: "Smart",
    color: "Green",
    berryFlavor: "bitter",
  },
  [ContestType.TOUGH]: {
    id: 5,
    name: "Tough",
    color: "Yellow",
    berryFlavor: "sour",
  },
} as const satisfies Record<ContestType, ContestTypeData>;

const secondaryContestTypes: Record<ContestType, readonly ContestType[]> = {
  [ContestType.COOL]: [ContestType.BEAUTY, ContestType.TOUGH],
  [ContestType.BEAUTY]: [ContestType.COOL, ContestType.CUTE],
  [ContestType.CUTE]: [ContestType.BEAUTY, ContestType.SMART],
  [ContestType.SMART]: [ContestType.CUTE, ContestType.TOUGH],
  [ContestType.TOUGH]: [ContestType.COOL, ContestType.SMART],
};

export function isSecondaryContestType(contestType: ContestType, moveType: ContestType): boolean {
  return secondaryContestTypes[contestType].includes(moveType);
}
