import { globalScene } from "#app/global-scene";
import type { MagicRoomTag } from "#data/arena-tag";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { Pokemon } from "#field/pokemon";

let forecastSuppression: ReadonlyMap<Pokemon, boolean> | undefined;

/** State checks must not depend on the item classes whose effects they gate. */
export function areHeldItemEffectsSuppressed(pokemon: Pokemon): boolean {
  const forecast = forecastSuppression?.get(pokemon);
  if (forecast !== undefined) {
    return forecast;
  }
  const embargo = pokemon.getTag(BattlerTagType.EMBARGO);
  const room = globalScene.arena?.getTag(ArenaTagType.MAGIC_ROOM) as MagicRoomTag | undefined;
  return !!((embargo && !embargo.beingRemoved) || (room && !room.beingRemoved && pokemon.isOnField()));
}

/** Synchronous forecasts can nest and must restore their state even when evaluation throws. */
export function withHeldItemSuppressionState<T>(states: ReadonlyMap<Pokemon, boolean>, evaluate: () => T): T {
  const previous = forecastSuppression;
  try {
    forecastSuppression = states;
    return evaluate();
  } finally {
    forecastSuppression = previous;
  }
}
