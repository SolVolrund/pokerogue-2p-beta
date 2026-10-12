import { FieldPosition } from "#enums/field-position";

export const HORDE_MIN_WAVE = 21;
export const HORDE_CHANCE_DENOMINATORS = [64, 32, 16, 8] as const;
export const HORDE_LEVEL_MULTIPLIERS = [0.5, 0.75, 1] as const;
export const HORDE_ENEMY_COUNT = 5;

// Field identities retain their existing order; visual columns are deliberately separate.
export const HORDE_ENEMY_POSITIONS = [
  FieldPosition.LEFT,
  FieldPosition.RIGHT,
  FieldPosition.CENTER,
  FieldPosition.FAR_LEFT,
  FieldPosition.FAR_RIGHT,
] as const;

export const HORDE_POSITION_COLUMNS: Record<FieldPosition, number> = {
  [FieldPosition.FAR_LEFT]: 0,
  [FieldPosition.LEFT]: 1,
  [FieldPosition.CENTER]: 2,
  [FieldPosition.RIGHT]: 3,
  [FieldPosition.FAR_RIGHT]: 4,
};

// Sprite-only offsets from the enemy anchor: two in back, three along the front of the platform.
export const HORDE_ENEMY_SPRITE_OFFSETS: Record<FieldPosition, readonly [number, number]> = {
  [FieldPosition.FAR_LEFT]: [-40, -8],
  [FieldPosition.LEFT]: [-8, -20],
  [FieldPosition.CENTER]: [8, 0],
  [FieldPosition.RIGHT]: [28, -20],
  [FieldPosition.FAR_RIGHT]: [56, -8],
};

export interface HordeBattleState {
  initialPlayerCount: number;
  playerCount: number;
  playerFieldSlots: number[];
  playerPositions: FieldPosition[];
  enemyPositions: FieldPosition[];
}

export function getHordePlayerPositions(count: number): FieldPosition[] {
  return count <= 1
    ? [FieldPosition.CENTER]
    : count === 2
      ? [FieldPosition.LEFT, FieldPosition.RIGHT]
      : [FieldPosition.LEFT, FieldPosition.RIGHT, FieldPosition.CENTER];
}

export function createHordeBattleState(playerFieldSlots: number[]): HordeBattleState {
  const slots = [...new Set(playerFieldSlots)].filter(slot => slot >= 0 && slot < 3).sort((a, b) => a - b);
  const count = Math.max(1, slots.length);
  const positions = [FieldPosition.CENTER, FieldPosition.CENTER, FieldPosition.CENTER];
  const formation = getHordePlayerPositions(count);
  slots.forEach((slot, index) => {
    positions[slot] = formation[index];
  });
  return {
    initialPlayerCount: count,
    playerCount: count,
    playerFieldSlots: slots,
    playerPositions: positions,
    enemyPositions: [...HORDE_ENEMY_POSITIONS],
  };
}

export function copyHordeBattleState(state: HordeBattleState): HordeBattleState {
  return {
    ...state,
    playerFieldSlots: [...state.playerFieldSlots],
    playerPositions: [...state.playerPositions],
    enemyPositions: [...state.enemyPositions],
  };
}

export function getHordeChanceDenominator(alliedTeams: number, lureTypes: number): number {
  const tier = alliedTeams > 1 ? alliedTeams - 1 : lureTypes;
  return HORDE_CHANCE_DENOMINATORS[Math.max(0, Math.min(3, tier))];
}

export function scaleHordeLevel(level: number, alliedTeams: number): number {
  return Math.max(1, Math.round(level * HORDE_LEVEL_MULTIPLIERS[Math.max(0, Math.min(2, alliedTeams - 1))]));
}

export function areHordePositionsAdjacent(
  userPosition: FieldPosition,
  targetPosition: FieldPosition,
  userIsPlayer: boolean,
  targetIsPlayer: boolean,
  alliedTeams: number,
): boolean {
  if (userIsPlayer !== targetIsPlayer && alliedTeams === 1) {
    return true;
  }
  if (userIsPlayer && targetIsPlayer && alliedTeams === 2) {
    return true;
  }
  return Math.abs(HORDE_POSITION_COLUMNS[userPosition] - HORDE_POSITION_COLUMNS[targetPosition]) <= 1;
}
