import type { MedicineCommand } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonHpRestoreModifierType } from "#modifiers/modifier-type";
import type { TurnMove } from "#types/turn-move";
import { forecastMedicineTurn } from "#utils/battle-planner-ai";
import { getAvailableBattleMedicineCount } from "#utils/battle-medicine";
import { getAvailableTrainerMedicine, getEnemyRecoveryItem } from "#utils/enemy-trainer-medicine";
import { canUseBagMedicine, getBagMedicineType } from "#utils/item-bag";

export function chooseTrainerMedicine(actor: EnemyPokemon, planned: TurnMove): MedicineCommand | undefined {
  const battle = globalScene.currentBattle;
  const trainer = battle.trainer;
  if (!trainer || !actor.hp) {
    return;
  }
  const owner = trainer.getMedicineOwner(actor);
  const bag = getAvailableTrainerMedicine(actor);
  if (!bag.length) {
    return;
  }
  const party = battle.enemyParty.filter(p => trainer.getMedicineOwner(p) === owner);
  return chooseHealingAction(actor, planned, party, bag, globalScene.getEnemyField(true), getEnemyRecoveryItem);
}

export function choosePartnerMedicine(actor: PlayerPokemon, planned: TurnMove, owner: PlayerIndex): MedicineCommand | undefined {
  const bag = globalScene.getPlayerBagMedicines(owner);
  const party = globalScene.getPlayerParty(owner);
  if (!bag.length || !party.includes(actor)) {
    return;
  }
  const available = bag.filter(stack => getAvailableBattleMedicineCount(owner, stack.typeId, actor.getBattlerIndex()) > 0);
  return chooseHealingAction(actor, planned, party, available.map(stack => stack.typeId), globalScene.getPlayerField(true),
    (id, target) => {
      const stack = available.find(item => item.typeId === id);
      const type = stack && getBagMedicineType(stack);
      return type instanceof PokemonHpRestoreModifierType && stack && canUseBagMedicine(owner, target, stack) ? type : undefined;
    });
}

function chooseHealingAction<T extends Pokemon>(
  actor: T, planned: TurnMove, party: T[], bag: string[], field: T[],
  getRecoveryItem: (id: string, target: T) => PokemonHpRestoreModifierType | undefined,
): MedicineCommand | undefined {
  if (!bag.length || party.every(p => p.isFullHp())) {
    return;
  }
  const turn = forecastMedicineTurn(actor, actor, actor.hp, planned)!;
  const lastStand = turn.incoming >= actor.hp && !party.some(p => p !== actor && p.isAllowedInBattle());
  let best = 0.2 + turn.action;
  let choice: MedicineCommand | undefined;
  for (const target of party) {
    if (target.isFullHp()) {
      continue;
    }
    const max = target.getMaxHp();
    const active = field.includes(target);
    const options = [...new Set(bag)].flatMap(typeId => {
      const type = getRecoveryItem(typeId, target);
      return type ? [{ typeId, type }] : [];
    });
    if (!options.length) {
      continue;
    }
    const before = target.hp ? forecastMedicineTurn(actor, target, target.hp) : undefined;
    for (const { typeId, type } of options) {
      const healed = type.getBaseRecovery(max, target.hp);
      const hp = target.hp + healed;
      const after = forecastMedicineTurn(actor, target, hp);
      if (!after || (active && hp <= after.incoming)) {
        continue;
      }
      let score: number;
      if (!target.hp) {
        score = 0.2 + after.action + 0.35 * Number(hp > after.incoming) + (lastStand ? 2 : 0);
      } else {
        // Count survivable hits, not just raw HP. Don't repeatedly heal away a losing turn.
        const hits = (h: number) => Math.min(3, Math.ceil(h / Math.max(1, after.incoming)) - 1);
        const extraTurns = hits(hp) - hits(target.hp) - Number(target === actor);
        score = (healed / max) * ((active ? 0.65 : 0.75) + 0.2 * after.action) + extraTurns * 0.38
          + Math.max(0, after.action - (before?.action ?? 0));
        if (target === actor && healed <= after.incoming && field.length === 1) {
          continue;
        }
      }
      // Favor a cheaper heal when it reaches the same HP; ace status only breaks close calls.
      score += (target.ace ? 0.005 : 0) - ["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION", "FULL_RESTORE"].indexOf(typeId) * 0.002;
      if (score > best) {
        best = score;
        choice = { targetId: target.id, typeId };
      }
    }
  }
  return choice;
}
