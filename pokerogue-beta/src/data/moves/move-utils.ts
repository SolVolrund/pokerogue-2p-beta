import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { allMoves } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FieldPosition } from "#enums/field-position";
import { MoveCategory, type MoveDamageCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { applyMoveAttrs } from "#moves/apply-attrs";
import type { Move, UserMoveConditionFunc } from "#moves/move";
import type { MoveTargetSet } from "#types/move-target-set";
import { areBattlerIndexesAllies } from "#utils/battler-index-utils";
import { areAllies } from "#utils/pokemon-utils";
import { ValueHolder } from "#utils/value-holder";

/**
 * Return whether the move targets the field
 *
 * Examples include
 * - Hazard moves like spikes
 * - Weather moves like rain dance
 * - User side moves like reflect and safeguard
 */
export function isFieldTargeted(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.BOTH_SIDES:
    case MoveTarget.USER_SIDE:
    case MoveTarget.ENEMY_SIDE:
      return true;
  }
  return false;
}

/**
 * Determine whether a move is a spread move.
 *
 * @param move - The {@linkcode Move} to check
 * @returns Whether {@linkcode move} is spread-targeted.
 * @remarks
 * Examples include:
 * - Moves targeting all adjacent Pokemon (like Surf)
 * - Moves targeting all adjacent enemies (like Air Cutter)
 */

export function isSpreadMove(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_OTHERS:
    case MoveTarget.ALL_NEAR_OTHERS:
      return true;
  }
  return false;
}

export function getMoveTargets(user: Pokemon, move: MoveId, replaceTarget?: MoveTarget): MoveTargetSet {
  const variableTarget = new ValueHolder(replaceTarget ?? allMoves[move].moveTarget);
  user.getOpponents(false).forEach(p => applyMoveAttrs("VariableTargetAttr", user, p, allMoves[move], variableTarget));

  const moveTarget: MoveTarget = variableTarget.value;
  const opponents = getOpponents(user);
  const allies = getAllies(user);

  let set: Pokemon[] = [];
  let multiple = false;
  const ally: Pokemon | undefined = allies[0];
  const forcedDuelTarget = getForcedDuelTarget(user, ally);
  const duelTargets = getShinyBadgeDuelTargets(user);
  switch (moveTarget) {
    case MoveTarget.USER:
    case MoveTarget.PARTY:
      set = [user];
      break;

    // biome-ignore lint/suspicious/noFallthroughSwitchClause: intentional
    case MoveTarget.CURSE:
      // Non ghost-type Curse targets exclusively the user; ghost-type Curse targets any enemy
      // TODO: check if the user is about to Terastallize to/from Ghost type
      if (!user.isOfType(PokemonType.GHOST, { returnOriginalTypesIfStellar: true })) {
        set = [user];
        break;
      }
    case MoveTarget.NEAR_OTHER:
    case MoveTarget.OTHER:
    case MoveTarget.ALL_NEAR_OTHERS:
    case MoveTarget.ALL_OTHERS:
      set = duelTargets ?? opponents.concat(allies);
      if (!duelTargets && (moveTarget === MoveTarget.NEAR_OTHER || moveTarget === MoveTarget.ALL_NEAR_OTHERS)) {
        set = getNearTargets(user, set);
      }
      multiple = moveTarget === MoveTarget.ALL_NEAR_OTHERS || moveTarget === MoveTarget.ALL_OTHERS;
      break;
    case MoveTarget.NEAR_ENEMY:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.ENEMY_SIDE:
      set = forcedDuelTarget ?? duelTargets ?? opponents;
      if (
        !duelTargets
        && (moveTarget === MoveTarget.NEAR_ENEMY
          || moveTarget === MoveTarget.ALL_NEAR_ENEMIES)
      ) {
        set = getNearTargets(user, set);
      }
      multiple = moveTarget !== MoveTarget.NEAR_ENEMY;
      break;
    case MoveTarget.RANDOM_NEAR_ENEMY:
      set =
        forcedDuelTarget
        ?? (duelTargets
          ? getRandomNearEnemyTarget(user, duelTargets, false)
          : getRandomNearEnemyTarget(user, opponents));
      break;
    case MoveTarget.ATTACKER:
      // TODO: Remove MoveTarget.ATTACKER and BattlerIndex.ATTACKER
      return { targets: [BattlerIndex.ATTACKER], multiple: false };
    case MoveTarget.NEAR_ALLY:
    case MoveTarget.ALLY:
      set = getNearTargets(user, allies);
      break;
    case MoveTarget.USER_OR_NEAR_ALLY:
    case MoveTarget.USER_AND_ALLIES:
    case MoveTarget.USER_SIDE:
      set = [user].concat(
        moveTarget === MoveTarget.USER_AND_ALLIES || moveTarget === MoveTarget.USER_SIDE
          ? allies
          : getNearTargets(user, allies),
      );
      multiple = moveTarget !== MoveTarget.USER_OR_NEAR_ALLY;
      break;
    case MoveTarget.ALL:
    case MoveTarget.BOTH_SIDES:
      set = [user].concat(allies, opponents);
      multiple = true;
      break;
  }

  return {
    targets: set
      .filter(p => p?.isActive(true))
      .map(p => p.getBattlerIndex())
      .filter(t => t !== undefined),
    multiple,
  };
}

function getOpponents(user: Pokemon): Pokemon[] {
  return (user.isPlayer() ? globalScene.getEnemyField() : globalScene.getPlayerField()).filter(p => p.isActive(false));
}

function getAllies(user: Pokemon): Pokemon[] {
  return (user.isPlayer() ? globalScene.getPlayerField() : globalScene.getEnemyField()).filter(
    p => p !== user && p.isActive(false),
  );
}

function getRandomNearEnemyTarget(user: Pokemon, opponents: Pokemon[], requireNear = true): Pokemon[] {
  const nearOpponents = requireNear ? getNearTargets(user, opponents) : opponents;

  if (nearOpponents.length === 0) {
    return [];
  }

  return [nearOpponents[user.randBattleSeedInt(nearOpponents.length)]];
}

function getNearTargets(user: Pokemon, targets: Pokemon[]): Pokemon[] {
  if (!usesTripleAdjacency()) {
    return targets;
  }

  return targets.filter(target => areTriplePokemonAdjacent(user, target));
}

function usesTripleAdjacency(): boolean {
  return (globalScene.currentBattle?.getBattlerCount() ?? 1) > 2;
}

function areTriplePokemonAdjacent(user: Pokemon, target: Pokemon): boolean {
  const userIndex = user.getBattlerIndex();
  const targetIndex = target.getBattlerIndex();

  if (userIndex === targetIndex || userIndex === BattlerIndex.ATTACKER || targetIndex === BattlerIndex.ATTACKER) {
    return false;
  }

  if (isForcedDuelOpponent(user, target)) {
    return true;
  }

  const userCenter = user.fieldPosition === FieldPosition.CENTER;
  const targetCenter = target.fieldPosition === FieldPosition.CENTER;

  if (areBattlerIndexesAllies(userIndex, targetIndex)) {
    return userCenter || targetCenter;
  }

  return userCenter || targetCenter || user.fieldPosition === target.fieldPosition;
}

function getShinyBadgeDuelTargets(user: Pokemon): Pokemon[] | undefined {
  const misc = globalScene.currentBattle?.mysteryEncounter?.misc;
  if (!user.isPlayer() || !misc?.shinyBadgeDuelActive || !Array.isArray(misc.shinyBadgeDuelPlayerIndexes)) {
    return;
  }

  const userPlayerIndex = globalScene.getPlayerIndexForPokemon(user);
  if (userPlayerIndex == null || !misc.shinyBadgeDuelPlayerIndexes.includes(userPlayerIndex)) {
    return;
  }

  return (misc.shinyBadgeDuelPlayerIndexes as PlayerIndex[])
    .filter(playerIndex => playerIndex !== userPlayerIndex)
    .map(playerIndex => getActiveShinyBadgeDuelPokemon(playerIndex))
    .filter((pokemon): pokemon is Pokemon => !!pokemon && pokemon.isActive(false));
}

function getActiveShinyBadgeDuelPokemon(playerIndex: PlayerIndex): Pokemon | undefined {
  return globalScene
    .getPlayerParty(playerIndex)
    .find(pokemon => pokemon.isOnField() && pokemon.isActive(false));
}

export function isForcedDuelOpponent(user: Pokemon, target: Pokemon): boolean {
  if (isShinyBadgeDuelOpponent(user, target)) {
    return true;
  }

  const duelPokemonIds = getForcedDuelPokemonIds();
  return !!duelPokemonIds && duelPokemonIds.includes(user.id) && duelPokemonIds.includes(target.id) && user !== target;
}

function isShinyBadgeDuelOpponent(user: Pokemon, target: Pokemon): boolean {
  const misc = globalScene.currentBattle?.mysteryEncounter?.misc;
  if (!misc?.shinyBadgeDuelActive || !Array.isArray(misc.shinyBadgeDuelPlayerIndexes) || user === target) {
    return false;
  }

  const userPlayerIndex = globalScene.getPlayerIndexForPokemon(user);
  const targetPlayerIndex = globalScene.getPlayerIndexForPokemon(target);

  return (
    userPlayerIndex != null
    && targetPlayerIndex != null
    && userPlayerIndex !== targetPlayerIndex
    && misc.shinyBadgeDuelPlayerIndexes.includes(userPlayerIndex)
    && misc.shinyBadgeDuelPlayerIndexes.includes(targetPlayerIndex)
  );
}

function getForcedDuelTarget(user: Pokemon, ally?: Pokemon): Pokemon[] | undefined {
  const duelPokemonIds = getForcedDuelPokemonIds();
  if (!duelPokemonIds || user.isPlayer() || !ally || !duelPokemonIds.includes(user.id) || !duelPokemonIds.includes(ally.id)) {
    return;
  }

  return [ally];
}

function getForcedDuelPokemonIds(): number[] | undefined {
  const battle = globalScene.currentBattle;
  if (
    !battle?.isBattleMysteryEncounter()
    || battle.mysteryEncounter?.encounterType !== MysteryEncounterType.LEGENDARY_CONFLICT
  ) {
    return;
  }

  const misc = battle.mysteryEncounter.misc;
  if (!misc?.legendaryConflictDuelActive || !Array.isArray(misc.legendaryConflictPokemonIds)) {
    return;
  }

  const activeEnemyIds = globalScene.getEnemyField().map(pokemon => pokemon.id);
  return misc.legendaryConflictPokemonIds.filter(id => activeEnemyIds.includes(id));
}

export const frenzyMissFunc: UserMoveConditionFunc = (user: Pokemon, move: Move) => {
  while (user.getMoveQueue().length > 0 && user.getMoveQueue()[0].move === move.id) {
    user.getMoveQueue().shift();
  }
  user.removeTag(BattlerTagType.FRENZY); // FRENZY tag should be disrupted on miss/no effect

  return true;
};

/**
 * Determine the target for the `user`'s counter-attack move
 * @param user - The pokemon using the counter-like move
 * @param damageCategory - The category of move to counter (physical or special), or `undefined` to counter both
 * @returns - The battler index of the most recent, non-ally attacker using a move that matches the specified category, or `null` if no such attacker exists
 */
export function getCounterAttackTarget(user: Pokemon, damageCategory?: MoveDamageCategory): BattlerIndex | null {
  for (const attackRecord of user.turnData.attacksReceived) {
    // check if the attacker was an ally
    const moveCategory = allMoves[attackRecord.move].category;
    const sourceBattlerIndex = attackRecord.sourceBattlerIndex;
    if (
      moveCategory !== MoveCategory.STATUS
      && !areAllies(sourceBattlerIndex, user.getBattlerIndex())
      && (damageCategory === undefined || moveCategory === damageCategory)
    ) {
      return sourceBattlerIndex;
    }
  }
  return null;
}

/**
 * Determine whether the move's {@linkcode Move#moveTarget | target} can target an opponent
 * @param move - The move to check
 * @returns Whether the move can target an opponent
 */
export function mayTargetOpponent(move: Move): boolean {
  switch (move.moveTarget) {
    case MoveTarget.NEAR_ENEMY:
    case MoveTarget.ALL_NEAR_ENEMIES:
    case MoveTarget.ALL_ENEMIES:
    case MoveTarget.ENEMY_SIDE:
    case MoveTarget.RANDOM_NEAR_ENEMY:
    case MoveTarget.ATTACKER:
      return true;
  }
  return false;
}

/**
 * @returns Whether the move is instantly charged by the given weather
 * @param move - The move to check
 * @param weather - The weather to check
 */
export function isWeatherInstantCharge(move: Move, weather: WeatherType): boolean {
  return !!move.findAttr(attr => attr.is("WeatherInstantChargeAttr") && attr.weatherTypes.includes(weather));
}
