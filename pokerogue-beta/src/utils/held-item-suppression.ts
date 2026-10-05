import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { BoosterEnergyModifier, PokemonNatureWeightModifier } from "#modifiers/modifier";
import { areHeldItemEffectsSuppressed, withHeldItemSuppressionState } from "#utils/held-item-suppression-state";

/** Soul Dew is cached in the holder's stats, unlike most combat item effects. */
export function refreshSuppressedHeldItemStats(pokemon: Pokemon): void {
  if (pokemon.getHeldItems().some(item => item instanceof PokemonNatureWeightModifier)) {
    pokemon.calculateStats();
  }
}

/** Synchronous damage previews only: never add tags or activate/deactivate real item effects. */
export function withHeldItemSuppressionForecast<T>(states: ReadonlyMap<Pokemon, boolean>, evaluate: () => T): T {
  const cachedStats = [...states]
    .filter(
      ([pokemon, suppressed]) =>
        suppressed !== areHeldItemEffectsSuppressed(pokemon)
        && pokemon.getHeldItems().some(item => item instanceof PokemonNatureWeightModifier),
    )
    .map(([pokemon]) => ({ pokemon, stats: pokemon.stats, hp: pokemon.hp }));
  try {
    return withHeldItemSuppressionState(states, () => {
      for (const { pokemon, stats } of cachedStats) {
        pokemon.stats = [...stats];
        pokemon.calculateStats();
      }
      return evaluate();
    });
  } finally {
    for (const { pokemon, stats, hp } of cachedStats) {
      pokemon.stats = stats;
      pokemon.hp = hp;
    }
  }
}

export function isHighestStatBoosterActive(pokemon: Pokemon, tagType: BattlerTagType): boolean {
  if (pokemon.getActiveHeldItems().some(item => item instanceof BoosterEnergyModifier)) {
    return true;
  }
  if (tagType === BattlerTagType.PROTOSYNTHESIS) {
    return (
      !globalScene.arena.weather?.isEffectSuppressed()
      && [WeatherType.SUNNY, WeatherType.HARSH_SUN].includes(globalScene.arena.weatherType)
    );
  }
  return globalScene.arena.terrainType === TerrainType.ELECTRIC;
}

/** This fork's Booster Energy is reusable; restore a tag that could not activate while suppressed. */
export function restoreBoosterEnergy(pokemon: Pokemon): void {
  if (!pokemon.isActive(true) || !pokemon.getActiveHeldItems().some(item => item instanceof BoosterEnergyModifier)) {
    return;
  }
  for (const [ability, tag] of [
    [AbilityId.PROTOSYNTHESIS, BattlerTagType.PROTOSYNTHESIS],
    [AbilityId.QUARK_DRIVE, BattlerTagType.QUARK_DRIVE],
  ] as const) {
    if (pokemon.hasAbility(ability) && !pokemon.getTag(tag)) {
      pokemon.addTag(tag);
    }
  }
}
