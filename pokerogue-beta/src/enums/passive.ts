/**
 * enum for passive
 */
export enum Passive {
  UNLOCKED = 1,
  ENABLED = 2,
}

export function getPassiveUnlockAttr(passiveIndex: number): number {
  return Passive.UNLOCKED << (passiveIndex * 2);
}

export function getPassiveEnabledAttr(passiveIndex: number): number {
  return Passive.ENABLED << (passiveIndex * 2);
}

export function isPassiveUnlocked(passiveAttr: number, passiveIndex: number): boolean {
  return !!(passiveAttr & getPassiveUnlockAttr(passiveIndex));
}

export function isPassiveEnabled(passiveAttr: number, passiveIndex: number): boolean {
  return !!(passiveAttr & getPassiveEnabledAttr(passiveIndex));
}

export function getPassiveAttrs(passiveIndex: number): number {
  return getPassiveUnlockAttr(passiveIndex) | getPassiveEnabledAttr(passiveIndex);
}

export function hasAnyPassiveUnlocked(passiveAttr: number, passiveCount: number): boolean {
  for (let p = 0; p < passiveCount; p++) {
    if (isPassiveUnlocked(passiveAttr, p)) {
      return true;
    }
  }
  return false;
}

export function hasAnyPassiveLocked(passiveAttr: number, passiveCount: number): boolean {
  for (let p = 0; p < passiveCount; p++) {
    if (!isPassiveUnlocked(passiveAttr, p)) {
      return true;
    }
  }
  return false;
}
