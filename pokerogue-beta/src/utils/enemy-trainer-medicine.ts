import { globalScene } from "#app/global-scene";
import { ChallengeType } from "#enums/challenge-type";
import type { EnemyPokemon } from "#field/pokemon";
import { BattleType } from "#enums/battle-type";
import { TrainerType } from "#enums/trainer-type";
import { getModifierTypeFuncById, getPlayerShopModifierTypeOptionsForWave, PokemonHpRestoreModifierType,
  PokemonReviveModifierType } from "#modifiers/modifier-type";
import { PokemonHpRestoreModifier } from "#modifiers/modifier";
import { TrainerAceEvCategory, type TrainerConfig } from "#trainers/trainer-config";
import { BooleanHolder, randSeedInt } from "#utils/common";
import { applyChallenges } from "#utils/challenge-utils";

const POTIONS = ["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION"] as const;
const ENEMY_MEDICINE = new Set<string>([...POTIONS, "REVIVE", "MAX_REVIVE"]);
const WEIGHTS = [[100], [25, 75], [5, 25, 70], [2, 13, 55, 30]] as const;
// Guaranteed slots, chance of an additional slot, chance of one revive replacing a secondary potion.
const BUDGETS = [[0, 25, 0], [1, 0, 0], [1, 50, 10], [2, 0, 20], [2, 50, 30], [3, 0, 40]] as const;

function medicineRank(config: TrainerConfig): number {
  const rival = [TrainerType.RIVAL, TrainerType.RIVAL_2, TrainerType.RIVAL_3, TrainerType.RIVAL_4,
    TrainerType.RIVAL_5, TrainerType.RIVAL_6].indexOf(config.trainerType);
  if (rival >= 0) {
    return rival;
  }
  switch (config.aceEvCategory) {
    case TrainerAceEvCategory.EVIL_ADMIN: return 1;
    case TrainerAceEvCategory.GYM_LEADER: return 2;
    case TrainerAceEvCategory.EVIL_LEADER:
    case TrainerAceEvCategory.STAT_TRAINER: return 3;
    case TrainerAceEvCategory.ELITE_FOUR: return 4;
    case TrainerAceEvCategory.CHAMPION: return 5;
    default: return config.isBoss ? 2 : 0;
  }
}

export function rollTrainerMedicine(config: TrainerConfig, legal: Set<string>, hasReserve: boolean, roll = randSeedInt): string[] {
  const highest = POTIONS.reduce<number>((best, id, index) => legal.has(id) ? index : best, -1);
  if (highest < 0) {
    return [];
  }
  const weights = WEIGHTS[highest].map((weight, index) => legal.has(POTIONS[index]) ? weight : 0);
  const [base, extra, revive] = BUDGETS[medicineRank(config)];
  const count = base + Number(extra > 0 && roll(100) < extra);
  const bag = Array.from({ length: count }, () => {
    let draw = roll(weights.reduce((a, b) => a + b, 0));
    return POTIONS[weights.findIndex(weight => (draw -= weight) < 0)] as string;
  });
  if (hasReserve && count >= 2 && legal.has("REVIVE") && roll(100) < revive) {
    bag[count - 1] = legal.has("MAX_REVIVE") && roll(100) < 25 ? "MAX_REVIVE" : "REVIVE";
  }
  return bag;
}

export function initializeTrainerMedicine(): void {
  const battle = globalScene.currentBattle;
  const trainer = battle.trainer;
  if (!trainer || battle.battleType !== BattleType.TRAINER || globalScene.isVsLaneBattle()) {
    return;
  }
  let shopWave = battle.waveIndex - 1;
  if (shopWave % 10 === 0) {
    shopWave--;
  }
  const legal = new Set(shopWave > 0 && globalScene.gameMode.getShopStatus()
    ? getPlayerShopModifierTypeOptionsForWave(shopWave, 1).map(o => o.type.id) : []);
  const active = battle.enemyParty.slice(0, battle.getBattlerCount());
  for (const pokemon of battle.enemyParty) {
    const owner = trainer.getMedicineOwner(pokemon);
    if (trainer.medicineBags[owner] !== undefined) {
      continue;
    }
    const hasReserve = battle.enemyParty.some(p => trainer.getMedicineOwner(p) === owner && !active.includes(p));
    globalScene.executeWithSeedOffset(() => {
      trainer.medicineBags[owner] = rollTrainerMedicine(trainer.getConfigForTrainerSlot(owner), legal, hasReserve);
    }, 37641 + owner, globalScene.waveSeed);
  }
}

export function getEnemyRecoveryItem(id: string, target: EnemyPokemon): PokemonHpRestoreModifierType | undefined {
  if (!ENEMY_MEDICINE.has(id)) {
    return;
  }
  const type = getModifierTypeFuncById(id)?.();
  if (!(type instanceof PokemonHpRestoreModifierType) || target.isFullHp()
    || target.isFainted() !== (type instanceof PokemonReviveModifierType)) {
    return;
  }
  if (target.isFainted()) {
    const blocked = new BooleanHolder(false);
    applyChallenges(ChallengeType.PREVENT_REVIVE, blocked);
    if (blocked.value || globalScene.getEnemyField().includes(target)) {
      return;
    }
  }
  return type;
}

export function spendTrainerMedicine(actor: EnemyPokemon, target: EnemyPokemon, id: string): boolean {
  const trainer = globalScene.currentBattle.trainer;
  if (!trainer || !globalScene.getEnemyField(true).includes(actor) || !globalScene.getEnemyParty().includes(target)
    || trainer.getMedicineOwner(actor) !== trainer.getMedicineOwner(target)) {
    return false;
  }
  const bag = trainer.medicineBags[trainer.getMedicineOwner(actor)];
  const index = bag?.indexOf(id) ?? -1;
  if (!bag || index < 0) {
    return false;
  }
  const modifier = getEnemyRecoveryItem(id, target)?.newModifier(target);
  if (!(modifier instanceof PokemonHpRestoreModifier) || !modifier.apply(target, 1)) {
    return false;
  }
  bag.splice(index, 1);
  return true;
}
