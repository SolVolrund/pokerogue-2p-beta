import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";

export type FieldBlessing =
  | "sun"
  | "rain"
  | "trick_room"
  | "gravity"
  | "misty_terrain"
  | "shadowy_aura"
  | "light_screen"
  | "reflect"
  | "electric_terrain"
  | "grassy_terrain"
  | "fog"
  | "psychic_terrain"
  | "strong_winds"
  | "sandstorm"
  | "snow";

export const FIELD_BLESSING_DAMAGE_RATIO = 16;

export function getFieldBlessingName(blessing: FieldBlessing): string {
  switch (blessing) {
    case "sun":
      return "sunlight";
    case "rain":
      return "rain";
    case "trick_room":
      return "Trick Room";
    case "gravity":
      return "Gravity";
    case "misty_terrain":
      return "Misty Terrain";
    case "shadowy_aura":
      return "Shadowy Aura";
    case "light_screen":
      return "Light Screen";
    case "reflect":
      return "Reflect";
    case "electric_terrain":
      return "Electric Terrain";
    case "grassy_terrain":
      return "Grassy Terrain";
    case "fog":
      return "fog";
    case "psychic_terrain":
      return "Psychic Terrain";
    case "strong_winds":
      return "strong winds";
    case "sandstorm":
      return "sandstorm";
    case "snow":
      return "snow";
  }
}

export function setPersistentFieldBlessing(blessing: FieldBlessing): void {
  globalScene.mysteryEncounterSaveData.fieldBlessing = blessing;
  applyPersistentFieldBlessing(true);
}

export function getPersistentFieldBlessing(): FieldBlessing | undefined {
  return globalScene.mysteryEncounterSaveData.fieldBlessing;
}

export function applyPersistentFieldBlessing(showMessage = false): void {
  const blessing = getPersistentFieldBlessing();
  if (!blessing) {
    return;
  }

  applyFieldBlessing(blessing);
  if (showMessage) {
    globalScene.phaseManager.queueMessage(`The ${getFieldBlessingName(blessing)} blessing settled over the field.`);
  }
}

export function isShadowyAuraDamageImmune(pokemon: Pokemon): boolean {
  const types = pokemon.getTypes({ returnOriginalTypesIfStellar: true });
  return types.includes(PokemonType.DARK) || types.includes(PokemonType.GHOST);
}

function applyFieldBlessing(blessing: FieldBlessing): void {
  switch (blessing) {
    case "sun":
      globalScene.arena.trySetWeather(WeatherType.SUNNY);
      return;
    case "rain":
      globalScene.arena.trySetWeather(WeatherType.RAIN);
      return;
    case "fog":
      globalScene.arena.trySetWeather(WeatherType.FOG);
      return;
    case "strong_winds":
      globalScene.arena.trySetWeather(WeatherType.STRONG_WINDS);
      return;
    case "sandstorm":
      globalScene.arena.trySetWeather(WeatherType.SANDSTORM);
      return;
    case "snow":
      globalScene.arena.trySetWeather(WeatherType.SNOW);
      return;
    case "misty_terrain":
      globalScene.arena.trySetTerrain(TerrainType.MISTY);
      return;
    case "electric_terrain":
      globalScene.arena.trySetTerrain(TerrainType.ELECTRIC);
      return;
    case "grassy_terrain":
      globalScene.arena.trySetTerrain(TerrainType.GRASSY);
      return;
    case "psychic_terrain":
      globalScene.arena.trySetTerrain(TerrainType.PSYCHIC);
      return;
    case "trick_room":
      globalScene.arena.addTag(ArenaTagType.TRICK_ROOM, 0, undefined, 0, ArenaTagSide.BOTH);
      return;
    case "gravity":
      globalScene.arena.addTag(ArenaTagType.GRAVITY, 0, undefined, 0, ArenaTagSide.BOTH);
      return;
    case "light_screen":
      globalScene.arena.addTag(ArenaTagType.LIGHT_SCREEN, 0, undefined, 0, ArenaTagSide.PLAYER);
      return;
    case "reflect":
      globalScene.arena.addTag(ArenaTagType.REFLECT, 0, undefined, 0, ArenaTagSide.PLAYER);
      return;
    case "shadowy_aura":
      return;
  }
}
