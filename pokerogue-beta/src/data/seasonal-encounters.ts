/** Annual season uses UTC, matching the existing timed-event calendar. */
export function isHauntingSeason(date = new Date()): boolean {
  return date.getUTCMonth() === 9;
}

export const HAUNTING_BASE_CHANCE = 2;
export const HAUNTING_CHANCE_INCREMENT = 1;
export const HAUNTING_MAX_CHANCE = 25;
export const HAUNTING_BATTLE_GAP = 3;

export interface PokemonTowerVisit {
  /** Main-route wave to resume after leaving the Tower. */
  returnWave: number;
  floor: number;
  boss: boolean;
  completed: boolean;
}

/** Run-owned, host-selected state. Never consult the calendar when restoring a run. */
export class SeasonalEncounterState {
  active = false;
  hauntingsResolved = false;
  misses = 0;
  battlesUntilEligible = 0;
  lastProcessedWave = 0;
  lastHauntingWave = 0;
  towerVisits = 0;
  tower: PokemonTowerVisit | undefined;
  rewardKey = "";
  rewardedPlayers: number[] = [];

  constructor(data?: Partial<SeasonalEncounterState>) {
    this.active = data?.active === true;
    this.hauntingsResolved = data?.hauntingsResolved === true;
    for (const key of ["misses", "battlesUntilEligible", "lastProcessedWave", "lastHauntingWave"] as const) {
      const value = data?.[key];
      this[key] = typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : 0;
    }
    this.misses = Math.min(this.misses, HAUNTING_MAX_CHANCE - HAUNTING_BASE_CHANCE);
    this.battlesUntilEligible = Math.min(this.battlesUntilEligible, HAUNTING_BATTLE_GAP);
    this.towerVisits = Number.isSafeInteger(data?.towerVisits) ? Math.max(0, data!.towerVisits!) : 0;
    const tower = data?.tower;
    if (tower && Number.isSafeInteger(tower.returnWave) && tower.returnWave > 0) {
      this.tower = {
        returnWave: tower.returnWave,
        floor: Number.isSafeInteger(tower.floor) ? Math.max(0, Math.min(tower.floor, 11)) : 0,
        boss: tower.boss === true,
        completed: tower.completed === true,
      };
    }
    this.rewardKey = typeof data?.rewardKey === "string" ? data.rewardKey : "";
    this.rewardedPlayers = [...new Set(data?.rewardedPlayers ?? [])].filter(p => [0, 1, 2].includes(p));
  }

  enterTower(returnWave: number): void {
    this.towerVisits++;
    this.tower = { returnWave, floor: 0, boss: false, completed: false };
  }

  getTowerDifficultyWave(): number | undefined {
    if (!this.tower) {
      return undefined;
    }
    const bracketStart = Math.floor((this.tower.returnWave - 1) / 10) * 10;
    return bracketStart + (this.tower.boss ? 10 : Math.min(Math.max(this.tower.floor, 1), 9));
  }

  getBattleRewardKey(wave: number): string {
    return this.tower ? `tower:${this.towerVisits}:${this.tower.floor}` : `wave:${wave}`;
  }

  hasRewardedPlayer(key: string, player: number): boolean {
    return this.rewardKey === key && this.rewardedPlayers.includes(player);
  }

  markPlayerRewarded(key: string, player: number): void {
    if (this.rewardKey !== key) {
      this.rewardKey = key;
      this.rewardedPlayers = [];
    }
    if (!this.rewardedPlayers.includes(player)) {
      this.rewardedPlayers.push(player);
    }
  }

  getChance(): number {
    return Math.min(HAUNTING_BASE_CHANCE + this.misses * HAUNTING_CHANCE_INCREMENT, HAUNTING_MAX_CHANCE);
  }

  /** Called once per eligible ordinary battle, with a separate seeded RNG stream. */
  roll(wave: number, rollPercent: () => number): boolean {
    if (!this.active || this.hauntingsResolved || wave < this.lastProcessedWave) {
      return false;
    }
    if (wave === this.lastProcessedWave) {
      return wave > 0 && this.lastHauntingWave === wave;
    }
    this.lastProcessedWave = wave;
    if (this.battlesUntilEligible > 0) {
      this.battlesUntilEligible--;
      return false;
    }
    if (rollPercent() < this.getChance()) {
      this.misses = 0;
      this.battlesUntilEligible = HAUNTING_BATTLE_GAP;
      this.lastHauntingWave = wave;
      return true;
    }
    this.misses = Math.min(this.misses + 1, HAUNTING_MAX_CHANCE - HAUNTING_BASE_CHANCE);
    return false;
  }

  /** Future Pokemon Tower completion hook, shared by every player in the run. */
  resolveHauntings(): void {
    this.hauntingsResolved = true;
    this.misses = 0;
    this.battlesUntilEligible = 0;
  }
}
