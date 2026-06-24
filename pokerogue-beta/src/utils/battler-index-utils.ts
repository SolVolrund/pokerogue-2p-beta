import { BattlerIndex } from "#enums/battler-index";

export const PLAYER_BATTLER_INDEXES: readonly BattlerIndex[] = [
  BattlerIndex.PLAYER,
  BattlerIndex.PLAYER_2,
  BattlerIndex.PLAYER_3,
] as const;

export const ENEMY_BATTLER_INDEXES: readonly BattlerIndex[] = [
  BattlerIndex.ENEMY,
  BattlerIndex.ENEMY_2,
  BattlerIndex.ENEMY_3,
] as const;

export function getPlayerBattlerIndex(fieldIndex: number): BattlerIndex {
  return PLAYER_BATTLER_INDEXES[fieldIndex] ?? BattlerIndex.PLAYER;
}

export function getEnemyBattlerIndex(fieldIndex: number): BattlerIndex {
  return ENEMY_BATTLER_INDEXES[fieldIndex] ?? BattlerIndex.ENEMY;
}

export function isPlayerBattlerIndex(battlerIndex: BattlerIndex | number): boolean {
  return PLAYER_BATTLER_INDEXES.includes(battlerIndex as BattlerIndex);
}

export function isEnemyBattlerIndex(battlerIndex: BattlerIndex | number): boolean {
  return ENEMY_BATTLER_INDEXES.includes(battlerIndex as BattlerIndex);
}

export function getFieldIndexFromBattlerIndex(battlerIndex: BattlerIndex | number): number {
  const playerFieldIndex = PLAYER_BATTLER_INDEXES.indexOf(battlerIndex as BattlerIndex);
  if (playerFieldIndex >= 0) {
    return playerFieldIndex;
  }

  const enemyFieldIndex = ENEMY_BATTLER_INDEXES.indexOf(battlerIndex as BattlerIndex);
  if (enemyFieldIndex >= 0) {
    return enemyFieldIndex;
  }

  return 0;
}

export function areBattlerIndexesAllies(a: BattlerIndex, b: BattlerIndex): boolean {
  if (a === BattlerIndex.ATTACKER || b === BattlerIndex.ATTACKER) {
    return false;
  }

  return isPlayerBattlerIndex(a) === isPlayerBattlerIndex(b);
}
