import { __INTERNAL_TEST_EXPORTS } from "#app/ai/ai-moveset-gen";
import { allMoves } from "#data/data-lists";
import { FusionOptions } from "#data/fusion-options";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon, Pokemon } from "#field/pokemon";
import { RequireTypeCondition } from "#moves/move-condition";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { ValueHolder } from "#utils/value-holder";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Type-dependent moveset generation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
  });

  function makePokemon(species: SpeciesId) {
    const pokemon = new EnemyPokemon(getPokemonSpecies(species), 80, TrainerSlot.TRAINER, false);
    game.scene.currentBattle.enemyParty.push(pokemon);
    return pokemon;
  }

  function permits(pokemon: Pokemon, move: MoveId, willTera = false, fallback = false) {
    const pool = new Map([[move, 10]]);
    __INTERNAL_TEST_EXPORTS.filterMovePool(pool, false, true, pokemon, willTera, fallback);
    return pool.has(move);
  }

  it.each([
    [SpeciesId.CHARMANDER, MoveId.BURN_UP, PokemonType.FIRE, false, true],
    [SpeciesId.MAGIKARP, MoveId.BURN_UP, PokemonType.FIRE, false, false],
    [SpeciesId.MAGIKARP, MoveId.BURN_UP, PokemonType.FIRE, true, true],
    [SpeciesId.CHARMANDER, MoveId.BURN_UP, PokemonType.WATER, true, false],
    [SpeciesId.CHARMANDER, MoveId.BURN_UP, PokemonType.STELLAR, true, true],
    [SpeciesId.MAGIKARP, MoveId.BURN_UP, PokemonType.STELLAR, true, false],
    [SpeciesId.PIKACHU, MoveId.DOUBLE_SHOCK, PokemonType.WATER, false, true],
    [SpeciesId.PIKACHU, MoveId.DOUBLE_SHOCK, PokemonType.WATER, true, false],
    [SpeciesId.MAGIKARP, MoveId.DOUBLE_SHOCK, PokemonType.ELECTRIC, true, true],
  ] as const)("species %i / move %i / Tera %i (planned: %s) is allowed: %s", (species, move, tera, willTera, expected) => {
    const pokemon = makePokemon(species);
    pokemon.teraType = tera;
    expect(permits(pokemon, move, willTera)).toBe(expected);
    expect(pokemon.isTerastallized).toBe(false);
  });

  it("does not relax type requirements in the empty-pool fallback", () => {
    const pokemon = makePokemon(SpeciesId.MAGIKARP);
    expect(permits(pokemon, MoveId.BURN_UP, false, true)).toBe(false);
    expect(permits(pokemon, MoveId.DOUBLE_SHOCK, false, true)).toBe(false);
  });

  it("keeps ordinary wild generation unchanged while filtering bosses", () => {
    const pokemon = makePokemon(SpeciesId.MAGIKARP);
    for (const boss of [false, true]) {
      const pool = new Map([[MoveId.BURN_UP, 10]]);
      __INTERNAL_TEST_EXPORTS.filterMovePool(pool, boss, false, pokemon);
      expect(pool.has(MoveId.BURN_UP)).toBe(!boss);
    }
  });

  it("uses Ace typing without changing it, including Stellar and other Tera choices", () => {
    const pokemon = makePokemon(SpeciesId.MAGIKARP);
    vi.spyOn(pokemon, "getAceType").mockReturnValue(PokemonType.FIRE);
    pokemon.teraType = PokemonType.ELECTRIC;
    expect(permits(pokemon, MoveId.BURN_UP)).toBe(true);
    expect(permits(pokemon, MoveId.BURN_UP, true)).toBe(false);
    expect(permits(pokemon, MoveId.DOUBLE_SHOCK, true)).toBe(true);
    pokemon.teraType = PokemonType.STELLAR;
    expect(permits(pokemon, MoveId.BURN_UP, true)).toBe(true);
    expect(pokemon.getTypes()).toContain(PokemonType.FIRE);
  });

  it("uses the chosen fusion types and donor Tera source", () => {
    const pokemon = makePokemon(SpeciesId.CHARIZARD);
    pokemon.fusionSpecies = getPokemonSpecies(SpeciesId.JOLTEON);
    pokemon.fusionFormIndex = 0;
    pokemon.fusionTeraType = PokemonType.WATER;
    pokemon.fusionOptions = new FusionOptions({ bodyTypeSlot: 0, donorTypeSlot: 0, teraSource: "donor" });
    expect(permits(pokemon, MoveId.BURN_UP)).toBe(true);
    expect(permits(pokemon, MoveId.DOUBLE_SHOCK)).toBe(true);
    pokemon.fusionOptions.bodyTypeSlot = 1;
    expect(permits(pokemon, MoveId.BURN_UP)).toBe(false);
    expect(permits(pokemon, MoveId.DOUBLE_SHOCK, true)).toBe(false);
    expect(pokemon.getTypes()).toEqual([PokemonType.FLYING, PokemonType.ELECTRIC]);
    expect(pokemon.fusionOptions.teraSource).toBe("donor");
  });

  it.each([false, true])("forces STAB using the actual Tera plan (%s), not just the assigned Tera type", willTera => {
    const pokemon = makePokemon(SpeciesId.CHARMANDER);
    pokemon.teraType = PokemonType.ELECTRIC;
    pokemon.moveset = [];
    __INTERNAL_TEST_EXPORTS.forceStabMove(
      new Map([
        [MoveId.FLAMETHROWER, 10],
        [MoveId.THUNDERBOLT, 10],
      ]),
      new Map(),
      new Map(),
      pokemon,
      new ValueHolder(0),
      new ValueHolder(0),
      willTera,
    );
    expect(pokemon.moveset.map(move => move.moveId)).toEqual([willTera ? MoveId.THUNDERBOLT : MoveId.FLAMETHROWER]);
  });

  it.each([
    MoveId.FIRE_PLEDGE,
    MoveId.WATER_PLEDGE,
    MoveId.GRASS_PLEDGE,
  ])("only soft-blocks Pledge %i in singles", move => {
    const pokemon = makePokemon(SpeciesId.EEVEE);
    game.scene.currentBattle.double = false;
    expect(permits(pokemon, move)).toBe(false);
    expect(permits(pokemon, move, false, true)).toBe(true);
    game.scene.currentBattle.double = true;
    expect(permits(pokemon, move)).toBe(true);
  });

  it.each([
    [MoveId.BURN_UP, PokemonType.FIRE],
    [MoveId.DOUBLE_SHOCK, PokemonType.ELECTRIC],
  ])("exposes move %i's required type", (move, type) => {
    expect(
      allMoves[move].hasCondition(
        condition => condition instanceof RequireTypeCondition && condition.requiredType === type,
      ),
    ).toBe(true);
  });
});
