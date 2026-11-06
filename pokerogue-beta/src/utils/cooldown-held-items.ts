import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import {
  type CooldownHeldItemId,
  type CooldownItem,
  getCooldownHeldItemId,
  isCooldownHeldItem,
} from "#data/cooldown-held-items";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { recordConsumedHeldItem } from "#utils/battle-held-items";
import i18next from "i18next";

export function findReadyCooldownHeldItem(pokemon: Pokemon, itemId: CooldownHeldItemId): CooldownItem | undefined {
  if (pokemon.isPlayer()) {
    const owner = globalScene.getPlayerIndexForPokemon(pokemon);
    if (owner === undefined || !globalScene.arena.isPlayerHeldItemReady(itemId, owner)) {
      return;
    }
  }
  return pokemon
    .getActiveHeldItems()
    .find(
      (item): item is CooldownItem =>
        isCooldownHeldItem(item) && getCooldownHeldItemId(item) === itemId && item.getStackCount() > 0,
    );
}

/** Call only during real execution, never while scoring or simulating a move. */
export function activateCooldownHeldItem(pokemon: Pokemon, itemId: CooldownHeldItemId): boolean {
  const item = findReadyCooldownHeldItem(pokemon, itemId);
  if (!item) {
    return false;
  }
  const owner = pokemon.isPlayer() ? globalScene.getPlayerIndexForPokemon(pokemon) : undefined;
  if (owner === undefined) {
    if (!pokemon.loseHeldItem(item)) {
      return false;
    }
    if (itemId !== "AIR_BALLOON") {
      recordConsumedHeldItem(pokemon, item);
    }
  } else {
    globalScene.arena.startPlayerHeldItemRecharge(itemId, owner);
  }
  if (itemId !== "WHITE_HERB") {
    globalScene.phaseManager.queueMessage(
      i18next.t(itemId === "AIR_BALLOON" ? "modifier:airBalloonPopped" : "modifier:cooldownHeldItemActivated", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        itemName: item.type.name,
      }),
    );
  }
  globalScene.updateModifiers(pokemon.isPlayer(), undefined, owner);
  return true;
}

export function activatePolicy(pokemon: Pokemon, itemId: "BLUNDER_POLICY" | "WEAKNESS_POLICY"): boolean {
  if (pokemon.isFainted() || !activateCooldownHeldItem(pokemon, itemId)) {
    return false;
  }
  const stats = itemId === "BLUNDER_POLICY" ? ([Stat.SPD] as const) : ([Stat.ATK, Stat.SPATK] as const);
  globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
    battlerIndex: pokemon.getBattlerIndex(),
    changes: stats.map(stat => ({ stat, stages: 2 })),
    sourcePokemon: pokemon,
  });
  return true;
}

export function isPowerHerbMove(move: Move): boolean {
  return move.isChargingMove() && move.id !== MoveId.SKY_DROP;
}

/** Spawn/reward eligibility, not a restriction on assigning items or subsequently learning new moves. */
export function isCooldownHeldItemUseful(pokemon: Pokemon, itemId: CooldownHeldItemId): boolean {
  const moves = pokemon.getMoveset().map(slot => slot.getMove());
  switch (itemId) {
    case "POWER_HERB":
      return moves.some(isPowerHerbMove);
    case "BLUNDER_POLICY":
      return (
        !pokemon.hasAbilityWithAttr("AlwaysHitAbAttr")
        && moves.some(
          move =>
            move.accuracy > 0
            && !move.hasAttr("OneHitKOAttr")
            && !(move.hasAttr("ToxicAccuracyAttr") && pokemon.isOfType(PokemonType.POISON)),
        )
      );
    case "WEAKNESS_POLICY":
      return (
        moves.some(move => move.category !== MoveCategory.STATUS && !move.hasAttr("FixedDamageAttr"))
        && Array.from({ length: PokemonType.FAIRY + 1 }, (_, type) => type as PokemonType).some(
          type => pokemon.getAttackTypeEffectiveness(type) > 1,
        )
      );
    case "AIR_BALLOON":
      return pokemon.isGrounded();
    default:
      return true;
  }
}
