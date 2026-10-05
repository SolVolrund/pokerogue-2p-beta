import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import {
  HealingBoosterModifier,
  HitHealModifier,
  PokemonFormChangeItemModifier,
  TurnHealModifier,
} from "#modifiers/modifier";
import type { Move, MoveAttr } from "#moves/move";
import { getAiMoveTargetData } from "#utils/ai-targeting";
import { NumberHolder, toDmgValue } from "#utils/common";
import { withHeldItemSuppressionForecast } from "#utils/held-item-suppression";
import { areHeldItemEffectsSuppressed } from "#utils/held-item-suppression-state";

const TURN_WEIGHTS = [1, 0.65, 0.35] as const;

interface ForecastAttack {
  move?: Move;
  damage: Map<Pokemon, number>;
}

interface ForecastTurn {
  attacks: Map<Pokemon, ForecastAttack>;
  incoming: Map<Pokemon, number>;
  recovery: Map<Pokemon, number>;
}

export interface ItemSuppressionEvaluation {
  score: number;
  damageScore: number;
  healingScore: number;
  survivalScore: number;
}

export function isItemSuppressionMove(move: Move): boolean {
  return move.id === MoveId.EMBARGO || move.id === MoveId.MAGIC_ROOM;
}

/** Compare equipment-dependent HP swings, without using moves or consuming items. */
export function evaluateItemSuppression(user: Pokemon, target: Pokemon, move: Move): ItemSuppressionEvaluation {
  const result: ItemSuppressionEvaluation = { score: 0, damageScore: 0, healingScore: 0, survivalScore: 0 };
  if (!isItemSuppressionMove(move) || (move.id === MoveId.EMBARGO && areHeldItemEffectsSuppressed(target))) {
    return result;
  }
  const field = globalScene.getField(true).filter(pokemon => pokemon.isAllowedInBattle() && !pokemon.isFainted());
  // Legend Plate's existing preview rolls and caches its type even in simulated calls.
  // Stay neutral in that matchup until it has a side-effect-free type forecast.
  if (
    field.some(
      pokemon =>
        pokemon.getMoveset().some(knownMove => knownMove.moveId === MoveId.JUDGMENT)
        && pokemon
          .getHeldItems()
          .some(
            item =>
              item instanceof PokemonFormChangeItemModifier
              && item.formChangeItem === FormChangeItem.LEGEND_PLATE
              && item.active,
          ),
    )
  ) {
    return result;
  }
  const room = globalScene.arena.getTag(ArenaTagType.MAGIC_ROOM);
  const roomTurns = room?.turnCount ?? 0;
  const accuracy =
    move.accuracy < 0 ? 1 : Math.max(0, Math.min(1, move.calculateBattleAccuracy(user, target, true) / 100));
  let firstBefore: ForecastTurn | undefined;
  let firstAfter: ForecastTurn | undefined;

  for (const [turn, weight] of TURN_WEIGHTS.entries()) {
    const beforeStates = new Map(field.map(pokemon => [pokemon, isSuppressedAt(pokemon, turn, roomTurns)]));
    const afterStates = new Map(
      field.map(pokemon => [
        pokemon,
        move.id === MoveId.EMBARGO
          ? pokemon === target || beforeStates.get(pokemon)!
          : isSuppressedAt(pokemon, turn, room ? 0 : 5),
      ]),
    );
    if (
      field.every(
        pokemon =>
          beforeStates.get(pokemon) === afterStates.get(pokemon)
          || !pokemon.getHeldItems().some(item => !item.ignoresItemSuppression),
      )
    ) {
      continue;
    }

    const before = withHeldItemSuppressionForecast(beforeStates, () => forecastTurn(field, user, turn));
    // Current-turn ordering belongs to the original state, before disabling speed/priority items.
    const earlier = new Set(
      field.filter(pokemon => {
        const attack = before.attacks.get(pokemon)?.move;
        return turn === 0 && attack && !actsBefore(user, pokemon, move, attack);
      }),
    );
    if (turn === 0) {
      const damageBeforeAction = [...earlier].reduce(
        (sum, pokemon) => sum + (before.attacks.get(pokemon)?.damage.get(user) ?? 0),
        0,
      );
      if (damageBeforeAction >= user.hp) {
        return { ...result, score: -100, survivalScore: -100 };
      }
    }
    const after = withHeldItemSuppressionForecast(afterStates, () =>
      forecastTurn(field, user, turn, before, earlier, beforeStates),
    );
    if (turn === 0) {
      firstBefore = before;
      firstAfter = after;
    }

    for (const pokemon of field) {
      const sign = user.isOpponent(pokemon) ? -1 : 1;
      const maxHp = Math.max(1, pokemon.getMaxHp());
      // Future equipment value is uncertain, especially when the holder is close to fainting.
      const firstIncoming = Math.max(firstBefore?.incoming.get(pokemon) ?? 0, firstAfter?.incoming.get(pokemon) ?? 0);
      const longevity = turn === 0 ? 1 : Math.min(1, pokemon.hp / Math.max(1, firstIncoming * (turn + 1)));
      const scale = (sign * weight * longevity * accuracy * 130) / maxHp;
      const beforeDamage = Math.min(pokemon.hp, before.incoming.get(pokemon) ?? 0);
      const afterDamage = Math.min(pokemon.hp, after.incoming.get(pokemon) ?? 0);
      result.damageScore += (beforeDamage - afterDamage) * scale;
      result.healingScore += ((after.recovery.get(pokemon) ?? 0) - (before.recovery.get(pokemon) ?? 0)) * scale;
      if (turn === 0) {
        const beforeFaints = (before.incoming.get(pokemon) ?? 0) >= pokemon.hp + (before.recovery.get(pokemon) ?? 0);
        const afterFaints = (after.incoming.get(pokemon) ?? 0) >= pokemon.hp + (after.recovery.get(pokemon) ?? 0);
        result.survivalScore += (Number(beforeFaints) - Number(afterFaints)) * sign * accuracy * 100;
      }
    }
  }
  result.score = Math.max(-240, Math.min(240, result.damageScore + result.healingScore + result.survivalScore));
  return result;
}

/** SMART AI uses a smaller scale than the planner; both use the same forecast. */
export function getItemSuppressionLegacyScore(user: Pokemon, target: Pokemon, move: Move): number {
  return Math.max(-12, Math.min(12, evaluateItemSuppression(user, target, move).score / 12));
}

function isSuppressedAt(pokemon: Pokemon, turn: number, roomTurns: number): boolean {
  return (pokemon.getTag(BattlerTagType.EMBARGO)?.turnCount ?? 0) > turn || roomTurns > turn;
}

function actsBefore(user: Pokemon, attacker: Pokemon, move: Move, attack: Move): boolean {
  const priority = move.getPriority(user) - attack.getPriority(attacker);
  if (priority !== 0) {
    return priority > 0;
  }
  const speed =
    user.getEffectiveStat(Stat.SPD, { opponent: attacker }) - attacker.getEffectiveStat(Stat.SPD, { opponent: user });
  // Treat a speed tie conservatively, without rolling the battle RNG.
  return globalScene.arena.getTag(ArenaTagType.TRICK_ROOM) ? speed < 0 : speed > 0;
}

function forecastTurn(
  field: Pokemon[],
  user: Pokemon,
  turn: number,
  before?: ForecastTurn,
  earlier = new Set<Pokemon>(),
  beforeStates?: ReadonlyMap<Pokemon, boolean>,
): ForecastTurn {
  const attacks = new Map(
    field.map(attacker => [
      attacker,
      earlier.has(attacker)
        ? before!.attacks.get(attacker)!
        : turn === 0 && attacker === user
          ? { damage: new Map<Pokemon, number>() }
          : predictAttack(attacker, user),
    ]),
  );
  const incoming = new Map(
    field.map(pokemon => [
      pokemon,
      [...attacks.values()].reduce((sum, attack) => sum + (attack.damage.get(pokemon) ?? 0), 0),
    ]),
  );
  const recovery = new Map(
    field.map(pokemon => {
      const attack = attacks.get(pokemon)!;
      const outgoing = [...attack.damage.values()].reduce((sum, amount) => sum + amount, 0);
      const shellBeforeSuppression = earlier.has(pokemon) && beforeStates;
      const shell = shellBeforeSuppression
        ? withHeldItemSuppressionForecast(beforeStates, () => expectedShellHealing(pokemon, outgoing))
        : expectedShellHealing(pokemon, outgoing);
      const damage = incoming.get(pokemon) ?? 0;
      const missingHp = Math.max(0, pokemon.getMaxHp() - pokemon.hp);
      const opposingAttacks = [...attacks].filter(([, a]) => (a.damage.get(pokemon) ?? 0) > 0);
      const beforeShell = attack.move
        ? opposingAttacks.reduce(
            (sum, [attacker, a]) =>
              sum + (a.move && !actsBefore(pokemon, attacker, attack.move!, a.move) ? a.damage.get(pokemon)! : 0),
            0,
          )
        : 0;
      const actualShell = beforeShell >= pokemon.hp ? 0 : Math.min(missingHp + beforeShell, shell);
      const hpAfterHits = pokemon.hp + actualShell - damage;
      const leftovers =
        hpAfterHits > 0 ? Math.min(pokemon.getMaxHp() - hpAfterHits, expectedLeftoversHealing(pokemon)) : 0;
      return [pokemon, actualShell + Math.max(0, leftovers)];
    }),
  );
  return { attacks, incoming, recovery };
}

function predictAttack(attacker: Pokemon, viewer: Pokemon): ForecastAttack {
  const illusionMoves = viewer.isOpponent(attacker) ? attacker.summonData.illusion?.moveset : undefined;
  const moves =
    illusionMoves && illusionMoves.length > 0
      ? illusionMoves.map(id => allMoves[id])
      : attacker
          .getMoveset()
          .filter(move => move.isUsable(attacker, false, true)[0])
          .map(move => move.getMove());
  let best: ForecastAttack = { damage: new Map() };
  let bestValue = 0;
  for (const original of moves) {
    if (
      !original
      || original.category === MoveCategory.STATUS
      || globalScene.arena.isMoveWeatherCancelled(attacker, original)
    ) {
      continue;
    }
    const move = getForecastMove(original, attacker);
    const data = getAiMoveTargetData(attacker, move.id);
    const options = data.targetSet.multiple ? [data.allTargets] : data.selectableTargets.map(target => [target]);
    for (const targets of options) {
      const damage = new Map<Pokemon, number>();
      for (const defender of targets) {
        if (globalScene.arena.isMoveTerrainCancelled(attacker, [defender.getBattlerIndex()], move)) {
          continue;
        }
        const useIllusion = viewer.isOpponent(defender) && !!defender.summonData.illusion;
        const effectiveness = useIllusion
          ? defender.getAttackTypeEffectiveness(attacker.getMoveType(move, true, defender), {
              source: attacker,
              simulated: true,
              move,
              useIllusion: true,
            })
          : undefined;
        const hit = defender.getAttackDamage({
          source: attacker,
          move,
          simulated: true,
          ignoreAbility: attacker.isOpponent(defender) && !defender.waveData.abilityRevealed,
          ignoreSourceAbility: false,
          ignoreAllyAbility: !defender.getAllies().some(ally => ally.waveData.abilityRevealed),
          ignoreSourceAllyAbility: false,
          isCritical: move.hasAttr("CritOnlyAttr") || !!attacker.getTag(BattlerTagType.ALWAYS_CRIT),
          ...(effectiveness === undefined ? {} : { effectiveness }),
        }).damage;
        const accuracy =
          move.accuracy < 0
            ? 1
            : Math.max(0, Math.min(1, move.calculateBattleAccuracy(attacker, defender, true) / 100));
        damage.set(defender, Math.min(defender.hp, Math.max(0, hit)) * accuracy);
      }
      const value = [...damage].reduce(
        (sum, [defender, amount]) => sum + amount * (attacker.isOpponent(defender) ? 1 : -1),
        0,
      );
      if (value > bestValue) {
        bestValue = value;
        best = { move, damage };
      }
    }
  }
  return best;
}

/** Use averages on a private move copy; these legacy attributes do not honor simulated mode. */
function getForecastMove(move: Move, attacker: Pokemon): Move {
  if (
    !move.hasAttr("PresentPowerAttr")
    && !move.hasAttr("MagnitudePowerAttr")
    && !move.hasAttr("RandomLevelDamageAttr")
  ) {
    return move;
  }
  const variablePowerAttrs = new Set<MoveAttr>([
    ...move.getAttrs("PresentPowerAttr"),
    ...move.getAttrs("MagnitudePowerAttr"),
  ]);
  const randomDamageAttrs = new Set<MoveAttr>(move.getAttrs("RandomLevelDamageAttr"));
  return Object.assign(Object.create(Object.getPrototypeOf(move)), move, {
    power: move.hasAttr("PresentPowerAttr") ? 52 : move.hasAttr("MagnitudePowerAttr") ? 71 : move.power,
    attrs: move.attrs
      .filter(attr => !variablePowerAttrs.has(attr))
      .map(attr =>
        randomDamageAttrs.has(attr)
          ? Object.assign(Object.create(Object.getPrototypeOf(attr)), attr, { getDamage: () => attacker.level })
          : attr,
      ),
  });
}

function healingMultiplier(pokemon: Pokemon): number {
  const multiplier = new NumberHolder(1);
  globalScene.applyModifiersForPokemon(HealingBoosterModifier, pokemon, multiplier);
  return multiplier.value;
}

function expectedShellHealing(pokemon: Pokemon, damage: number): number {
  if (damage <= 0 || pokemon.getTag(BattlerTagType.HEAL_BLOCK)) {
    return 0;
  }
  return pokemon
    .getActiveHeldItems()
    .filter(item => item instanceof HitHealModifier)
    .reduce(
      (sum, item) =>
        sum + Math.max(1, Math.floor(toDmgValue((damage * item.stackCount) / 8) * healingMultiplier(pokemon))),
      0,
    );
}

function expectedLeftoversHealing(pokemon: Pokemon): number {
  if (pokemon.getTag(BattlerTagType.HEAL_BLOCK)) {
    return 0;
  }
  return pokemon
    .getActiveHeldItems()
    .filter(item => item instanceof TurnHealModifier)
    .reduce(
      (sum, item) =>
        sum
        + Math.max(1, Math.floor(toDmgValue(pokemon.getMaxHp() / 16) * item.stackCount * healingMultiplier(pokemon))),
      0,
    );
}
