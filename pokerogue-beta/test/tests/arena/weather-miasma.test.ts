import { allMoves } from "#data/data-lists";
import { TerrainType } from "#data/terrain";
import { Weather, getWeatherAnimation } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { CommonAnim } from "#enums/move-anims-common";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Weather - Miasma and Haunted Pokemon", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => undefined);
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => undefined);
    game = new GameManager(phaserGame);
    game.override
      .weather(WeatherType.MIASMA)
      .battleStyle("single")
      .moveset([MoveId.SPLASH, MoveId.DEFOG, MoveId.RAIN_DANCE])
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("uses Fog's animation without shifting the existing weather IDs", () => {
    expect(WeatherType.STRONG_WINDS).toBe(9);
    expect(getWeatherAnimation(WeatherType.NONE)).toBeNull();
    expect(getWeatherAnimation(WeatherType.MIASMA)).toBe(CommonAnim.WIND);
    expect(getWeatherAnimation(WeatherType.FOG)).toBe(CommonAnim.WIND);
    expect(getWeatherAnimation(WeatherType.STRONG_WINDS)).toBe(CommonAnim.STRONG_WINDS);
  });

  it("damages both sides for 1/4 max HP once per round", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    for (const pokemon of game.scene.getField(true)) {
      expect(pokemon.hp).toBe(pokemon.getMaxHp() - Math.max(Math.floor(pokemon.getMaxHp() / 4), 1));
    }
  });

  it.each([SpeciesId.GASTLY, SpeciesId.UMBREON])("does not damage immune species %i", async species => {
    await game.classicMode.startBattle(species);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(game.field.getPlayerPokemon().isFullHp()).toBe(true);
    expect(game.field.getEnemyPokemon().isFullHp()).toBe(false);
  });

  it.each([AbilityId.MAGIC_GUARD, AbilityId.OVERCOAT])("respects damage protection ability %i", async ability => {
    game.override.ability(ability);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(game.field.getPlayerPokemon().isFullHp()).toBe(true);
    expect(game.field.getEnemyPokemon().isFullHp()).toBe(false);
  });

  it.each([
    AbilityId.CLOUD_NINE,
    AbilityId.AIR_LOCK,
  ])("suppresses both damage and accuracy with ability %i", async ability => {
    game.override.ability(ability);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    expect(
      allMoves[MoveId.TACKLE].calculateBattleAccuracy(game.field.getPlayerPokemon(), game.field.getEnemyPokemon()),
    ).toBe(100);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(game.scene.getField(true).every(pokemon => pokemon.isFullHp())).toBe(true);
  });

  it("reduces move accuracy by 10%", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    expect(
      allMoves[MoveId.TACKLE].calculateBattleAccuracy(game.field.getPlayerPokemon(), game.field.getEnemyPokemon()),
    ).toBe(90);
  });

  it.each([MoveId.DEFOG, MoveId.RAIN_DANCE])("can be cleared or replaced by move %i", async move => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.override.weather(WeatherType.NONE);
    game.move.select(move);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(game.scene.arena.weatherType).toBe(move === MoveId.DEFOG ? WeatherType.NONE : WeatherType.RAIN);
    expect(game.scene.getField(true).every(pokemon => pokemon.isFullHp())).toBe(true);
  });

  it("supports battle-long and ordinary finite weather durations", () => {
    const permanent = new Weather(WeatherType.MIASMA);
    expect(permanent.isImmutable()).toBe(false);
    for (let turn = 0; turn < 10; turn++) expect(permanent.lapse()).toBe(true);
    const finite = new Weather(WeatherType.MIASMA, 5);
    for (let turn = 0; turn < 4; turn++) expect(finite.lapse()).toBe(true);
    expect(finite.lapse()).toBe(false);
    expect(new Weather(WeatherType.HAIL).getDamageFraction()).toBe(1 / 16);
  });

  it("counts down Grave Wind in both the battle and field display, then clears it after five turns", async () => {
    game.override.weather(WeatherType.NONE).ability(AbilityId.GRAVE_WIND).enemySpecies(SpeciesId.GASTLY);
    await game.classicMode.startBattle(SpeciesId.MAROWAK);
    game.field.getPlayerPokemon().setHaunted();
    const flyout = game.scene.arenaFlyout;
    expect(game.scene.arena.weather?.turnsLeft).toBe(5);
    expect(flyout["flyoutTextField"].text).toContain("(5/5)");
    for (let remaining = 4; remaining >= 0; remaining--) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      if (remaining > 0) {
        expect(game.scene.arena.weather?.turnsLeft).toBe(remaining);
        expect(flyout["flyoutTextField"].text).toContain(`(${remaining}/5)`);
      } else {
        expect(game.scene.arena.weatherType).toBe(WeatherType.NONE);
        expect(flyout["weatherInfo"]).toBeUndefined();
        expect(flyout["flyoutTextField"].text).toBe("");
      }
    }
  });

  it("counts down finite terrain without giving battle-long Miasma a timer", async () => {
    game.override.weather(WeatherType.NONE).enemySpecies(SpeciesId.GASTLY);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    game.scene.arena.trySetWeather(WeatherType.MIASMA);
    game.scene.arena.trySetTerrain(TerrainType.ELECTRIC, false, game.field.getPlayerPokemon());
    const flyout = game.scene.arenaFlyout;
    for (let remaining = 4; remaining >= 0; remaining--) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(game.scene.arena.weather?.turnsLeft).toBe(0);
      expect(flyout["weatherInfo"]?.duration).toBe(0);
      if (remaining > 0) {
        expect(game.scene.arena.terrain?.turnsLeft).toBe(remaining);
        expect(flyout["flyoutTextField"].text).toContain(`(${remaining}/5)`);
      } else {
        expect(flyout["terrainInfo"]).toBeUndefined();
        expect(flyout["flyoutTextField"].text).not.toContain("/5");
      }
    }
  });

  it("adds Ghost to a Haunted Pokemon and restores it after a temporary override and switching", async () => {
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.setHaunted();
    expect(pokemon.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON, PokemonType.GHOST]);
    pokemon.summonData.addedType = PokemonType.WATER;
    expect(pokemon.getTypes()).not.toContain(PokemonType.GHOST);
    pokemon.resetSummonData();
    expect(pokemon.haunted).toBe(true);
    expect(pokemon.getTypes()).toContain(PokemonType.GHOST);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(pokemon.isFullHp()).toBe(true);
  });

  it("saves Haunted identity without requiring any crystal effect", async () => {
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.setHaunted();
    const saved = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(pokemon))));
    expect(saved.haunted).toBe(true);
    const restored = saved.toPokemon();
    restored.resetSummonData();
    expect(restored.haunted).toBe(true);
    expect(restored.getTypes().filter(type => type === PokemonType.GHOST)).toHaveLength(1);
    restored.setHaunted(false);
    expect(restored.haunted).toBe(false);
    expect(restored.getTypes()).toContain(PokemonType.GHOST);
  });
});
