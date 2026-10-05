import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { Terrain, TerrainType } from "#data/terrain";
import { Weather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { getVeeveeAnteOutcomes } from "#moves/veevee-ante";

/** Synchronous forecast only: no real form changes, events, moveset edits, or ability activation. */
export function withBioInstabilityForecast<T>(user: Pokemon, move: Move, evaluate: () => T): T {
  const form = user.getBioInstabilityFormChange(move.type);
  if (!form) {
    return evaluate();
  }
  const { arena } = globalScene;
  const { formIndex, stats, hp } = user;
  const { weather, terrain } = arena;
  const hpRatio = hp / user.getMaxHp();
  try {
    user.formIndex = user.species.forms.findIndex(candidate => candidate.formKey === form.key);
    user.stats = [...stats];
    user.calculateStats();
    user.hp = hpRatio > 0 ? Math.max(1, Math.floor(user.getMaxHp() * hpRatio)) : 0;

    if (user.hasPassive() && user.canApplyAbility(true)) {
      const passive = user.getPassiveAbility();
      const weatherType = passive.getAttrs("PostSummonWeatherChangeAbAttr")[0]?.weatherType;
      if (weatherType !== undefined && !weather?.isImmutable() && arena.canSetWeather(weatherType)) {
        arena.weather = weatherType === WeatherType.NONE ? null : new Weather(weatherType, 5);
      }
      const terrainType = {
        [AbilityId.ELECTRIC_SURGE]: TerrainType.ELECTRIC,
        [AbilityId.PSYCHIC_SURGE]: TerrainType.PSYCHIC,
        [AbilityId.GRASSY_SURGE]: TerrainType.GRASSY,
        [AbilityId.MISTY_SURGE]: TerrainType.MISTY,
      }[passive.id];
      if (terrainType !== undefined && arena.canSetTerrain(terrainType)) {
        arena.terrain = new Terrain(terrainType, 5);
      }
    }
    return evaluate();
  } finally {
    user.formIndex = formIndex;
    user.stats = stats;
    user.hp = hp;
    arena.weather = weather;
    arena.terrain = terrain;
  }
}

/** Legacy SMART AI uses benefit scores, on a different scale from the planner. */
export function getVeeveeAnteLegacyScore(user: Pokemon, target: Pokemon): number {
  return getVeeveeAnteOutcomes(target.getTypes({ returnOriginalTypesIfStellar: true, useIllusion: true })).reduce(
    (total, outcome) => {
      const move = allMoves[outcome.move];
      return (
        total
        + outcome.probability
          * withBioInstabilityForecast(user, move, () => {
            if (
              !move.applyConditions(user, target, -1)
              || globalScene.arena.isMoveWeatherCancelled(user, move)
              || globalScene.arena.isMoveTerrainCancelled(user, [target.getBattlerIndex()], move)
            ) {
              return -20;
            }
            const effectiveness = target.getMoveEffectiveness(
              user,
              move,
              !target.waveData.abilityRevealed,
              undefined,
              undefined,
              true,
            );
            const benefit =
              move.getUserBenefitScore(user, target, move) - move.getTargetBenefitScore(user, target, move);
            return effectiveness === 0 ? -20 : benefit * effectiveness * (user.isOfType(move.type) ? 1.5 : 1);
          })
      );
    },
    0,
  );
}
