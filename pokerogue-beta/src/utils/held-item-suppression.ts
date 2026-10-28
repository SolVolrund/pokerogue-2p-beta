import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { BoosterEnergyModifier, PokemonNatureWeightModifier } from "#modifiers/modifier";
import { areHeldItemEffectsSuppressed, withHeldItemSuppressionState } from "#utils/held-item-suppression-state";
import { getSoulBondStatBonus, isDestinyKnot, refreshSoulBondHpForParties } from "#utils/soul-bond";

/** Soul Dew is cached in the holder's stats, unlike most combat item effects. */
export function refreshSuppressedHeldItemStats(pokemon: Pokemon): void {
  if (pokemon.getHeldItems().some(item => item instanceof PokemonNatureWeightModifier)) {
    pokemon.calculateStats();
  }
  refreshSoulBondHpForParties();
}

/** Synchronous damage previews only: never add tags or activate/deactivate real item effects. */
export function withHeldItemSuppressionForecast<T>(states: ReadonlyMap<Pokemon, boolean>, evaluate: () => T): T {
  // Include benched partners even when the real suppression state currently hides their bond.
  const candidates = new Set([
    ...states.keys(),
    ...globalScene.getActivePlayerIndexes().flatMap(owner => globalScene.getPlayerParty(owner)),
  ]);
  const cachedStats = [...candidates].flatMap(pokemon => {
    const items = pokemon.getHeldItems();
    const recalculate =
      states.has(pokemon)
      && states.get(pokemon) !== areHeldItemEffectsSuppressed(pokemon)
      && items.some(item => item instanceof PokemonNatureWeightModifier);
    if (!recalculate && !pokemon.soulBondHpBonus && !items.some(isDestinyKnot)) {
      return [];
    }
    return [
      {
        pokemon,
        stats: pokemon.stats,
        hp: pokemon.hp,
        soulBondHpBonus: pokemon.soulBondHpBonus,
        maxHp: pokemon.stats[Stat.HP] + pokemon.soulBondHpBonus,
        recalculate,
      },
    ];
  });
  try {
    return withHeldItemSuppressionState(states, () => {
      for (const { pokemon, stats, recalculate } of cachedStats) {
        if (recalculate) {
          pokemon.stats = [...stats];
          pokemon.calculateStats();
        }
      }
      // Real HP refresh is disabled in forecasts. Rescale once, after all raw stats are ready.
      for (const { pokemon, hp, maxHp } of cachedStats) {
        pokemon.soulBondHpBonus = getSoulBondStatBonus(pokemon, Stat.HP);
        const forecastMaxHp = pokemon.stats[Stat.HP] + pokemon.soulBondHpBonus;
        pokemon.hp = hp <= 0 ? 0 : Math.max(1, Math.min(forecastMaxHp, Math.floor((hp * forecastMaxHp) / maxHp)));
      }
      return evaluate();
    });
  } finally {
    for (const { pokemon, stats, hp, soulBondHpBonus } of cachedStats) {
      pokemon.stats = stats;
      pokemon.hp = hp;
      pokemon.soulBondHpBonus = soulBondHpBonus;
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
