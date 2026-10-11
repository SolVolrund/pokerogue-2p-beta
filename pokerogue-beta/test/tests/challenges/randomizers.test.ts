import { speciesDataRegistry } from "#app/global-species-data-registry";
import { AbilityRandomizerChallenge, copyChallenge, MovesetRandomizerChallenge } from "#data/challenge";
import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { LearnableMoveSource } from "#enums/learnable-move-source";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { GameManager } from "#test/framework/game-manager";
import { applyChallenges, getRibbonsToAward } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { ValueHolder } from "#utils/value-holder";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Challenges - Randomizers", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    game.override.moveset([]).enemyMoveset([]).ability(AbilityId.NONE).enemyAbility(AbilityId.NONE);
    game.scene.seed = "randomizer-regression";
  });

  afterEach(() => {
    game.scene.activePlayerIndex = 0;
    game.scene.gameMode.challenges = [];
  });

  function enable(id: Challenges, value = 1) {
    game.scene.gameMode.setChallengeValue(id, value);
  }

  it("preserves old monotype save IDs and reloads both new challenge values", () => {
    expect([Challenges.SINGLE_TYPE_P1, Challenges.SINGLE_TYPE_P2, Challenges.SINGLE_TYPE_P3]).toEqual([11, 12, 13]);
    for (const id of [Challenges.MOVESET_RANDOMIZER, Challenges.ABILITY_RANDOMIZER]) {
      const loaded = copyChallenge(JSON.parse(JSON.stringify({ id, value: 2, severity: 0 })));
      expect(loaded.id).toBe(id);
      expect(loaded.value).toBe(2);
      expect(loaded).toBeInstanceOf(
        id === Challenges.MOVESET_RANDOMIZER ? MovesetRandomizerChallenge : AbilityRandomizerChallenge,
      );
    }
  });

  it("randomizes level moves deterministically without changing the source data or RNG stream", () => {
    const species = getPokemonSpecies(SpeciesId.EEVEE);
    const original = species.getLevelMoves();
    enable(Challenges.MOVESET_RANDOMIZER);
    const rng = Phaser.Math.RND.state();
    const randomized = species.getLevelMoves();
    expect(randomized).not.toEqual(original);
    expect(randomized.map(([level]) => level)).toEqual(original.map(([level]) => level));
    expect(Phaser.Math.RND.state()).toBe(rng);
    game.scene.waveSeed = "a-different-floor";
    game.scene.activePlayerIndex = 1;
    expect(species.getLevelMoves()).toEqual(randomized);
    expect(randomized.every(([, move]) => !allMoves[move].name.endsWith(" (N)") && move !== MoveId.NONE)).toBe(true);
    game.scene.gameMode.challenges = [];
    expect(species.getLevelMoves()).toEqual(original);
    enable(Challenges.MOVESET_RANDOMIZER);
    game.scene.seed = "another-run";
    expect(species.getLevelMoves()).not.toEqual(randomized);
  });

  it("hides randomized learnsets in starter select and keeps the Pokedex's canonical data", () => {
    const species = getPokemonSpecies(SpeciesId.EEVEE);
    const original = species.getLevelMoves();
    enable(Challenges.MOVESET_RANDOMIZER);
    const mode = vi.spyOn(game.scene.ui, "getMode").mockReturnValue(UiMode.STARTER_SELECT);
    expect(species.getLevelMoves()).toEqual([]);
    mode.mockReturnValue(UiMode.POKEDEX);
    expect(species.getLevelMoves()).toEqual(original);
  });

  it("still modifies starter moves with Fresh Start enabled and guarantees a usable attack", () => {
    enable(Challenges.FRESH_START);
    enable(Challenges.MOVESET_RANDOMIZER);
    const pokemon = game.field.getPlayerPokemon();
    const challenge = game.scene.gameMode.challenges.find(c => c.id === Challenges.MOVESET_RANDOMIZER)!;
    const spy = vi.spyOn(challenge, "applyStarterModify");
    applyChallenges(ChallengeType.STARTER_MODIFY, pokemon);
    expect(spy).toHaveBeenCalledOnce();
    expect(pokemon.moveset.length).toBeGreaterThan(0);
    expect(pokemon.moveset.length).toBeLessThanOrEqual(4);
    expect(pokemon.moveset.some(pm => pm.getMove().is("AttackMove"))).toBe(true);
  });

  it("removes egg moves from enemy generation and the relearner", () => {
    enable(Challenges.MOVESET_RANDOMIZER);
    const pool = new Map([[MoveId.EXTREME_SPEED, 10]]);
    applyChallenges(ChallengeType.AI_MOVE_GENERATION_EGG_POOL, SpeciesId.EEVEE, pool);
    expect(pool.size).toBe(0);
    const pokemon = game.field.getPlayerPokemon();
    const available = new ValueHolder(true);
    applyChallenges(ChallengeType.EGG_MOVE_RELEARN_AVAILABILITY, pokemon, available);
    expect(available.value).toBe(false);
    expect(pokemon.getLearnableLevelMoves().every(([, , source]) => source !== LearnableMoveSource.EGG)).toBe(true);
  });

  it("uses the same randomized TMs for the same species on either side", () => {
    enable(Challenges.MOVESET_RANDOMIZER);
    const pokemon = game.field.getPlayerPokemon();
    const playerTms = new Set([MoveId.PROTECT, MoveId.TOXIC, MoveId.REST]);
    const enemyTms = [...playerTms];
    applyChallenges(ChallengeType.PLAYER_TM_COMPATIBILITY, pokemon, playerTms);
    applyChallenges(ChallengeType.ENEMY_TM_COMPATIBILITY, pokemon.species, enemyTms);
    expect([...playerTms]).toEqual(enemyTms);
    expect(playerTms.size).toBe(3);
  });

  it("generates usable enemy moves and replaces Eternatus's scripted final moveset", () => {
    enable(Challenges.MOVESET_RANDOMIZER);
    const enemy = game.field.getEnemyPokemon();
    enemy.generateAndPopulateMoveset();
    expect(enemy.moveset.length).toBeGreaterThan(0);
    expect(enemy.moveset.every(move => move.getMove() && move.moveId !== MoveId.NONE)).toBe(true);
    game.scene.currentBattle.waveIndex = 200;
    game.override.enemySpecies(SpeciesId.ETERNATUS);
    const boss = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.ETERNATUS), 200, TrainerSlot.NONE);
    expect(boss.moveset.map(move => move.moveId)).toEqual(new Array(4).fill(MoveId.METRONOME));
    expect(new Set(boss.moveset).size).toBe(4);
  });

  it("Lite removes move-based evolution requirements without modifying the registry", () => {
    enable(Challenges.MOVESET_RANDOMIZER, 2);
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.TANGELA), 100, 0, 0);
    const original = speciesDataRegistry.getEvolutions(SpeciesId.TANGELA);
    const conditions = original.map(e => e.condition?.data.map(c => ({ ...c })));
    pokemon.moveset = [];
    expect(pokemon.getEvolution()?.speciesId).toBe(SpeciesId.TANGROWTH);
    expect(original.map(e => e.condition?.data)).toEqual(conditions);
    enable(Challenges.MOVESET_RANDOMIZER, 1);
    expect(pokemon.getEvolution()).toBeNull();
  });

  it("randomizes regular abilities by species and run seed, preserving RNG and absent slots", () => {
    const species = getPokemonSpecies(SpeciesId.EEVEE);
    enable(Challenges.ABILITY_RANDOMIZER);
    const rng = Phaser.Math.RND.state();
    const ability = species.getAbility(0);
    expect(allAbilities[ability].unimplemented).toBe(false);
    expect(Phaser.Math.RND.state()).toBe(rng);
    game.scene.waveSeed = "different-floor";
    game.scene.activePlayerIndex = 1;
    expect(species.getAbility(0)).toBe(ability);
    const absentSlot = Object.assign(Object.create(species), { ability1: AbilityId.NONE });
    expect(absentSlot.getAbility(0)).toBe(AbilityId.NONE);
  });

  it("supports secondary passives and preserves a battle-copied Trace override", () => {
    const pokemon = game.field.getPlayerPokemon();
    pokemon.passiveIndex = 1;
    const original = pokemon.getPassiveAbility().id;
    enable(Challenges.ABILITY_RANDOMIZER, 1);
    expect(pokemon.getPassiveAbility().id).toBe(original);
    enable(Challenges.ABILITY_RANDOMIZER, 2);
    const expected = new ValueHolder(original);
    applyChallenges(ChallengeType.PASSIVE_ABILITY_MODIFY, pokemon.species.speciesId, expected);
    expect(pokemon.getPassiveAbility().id).toBe(expected.value);
    pokemon.summonData.passiveAbility = AbilityId.ROUGH_SKIN;
    expect(pokemon.getPassiveAbility().id).toBe(AbilityId.ROUGH_SKIN);
  });

  it("Lite keeps form-critical abilities while the All setting randomizes them", () => {
    const species = getPokemonSpecies(SpeciesId.MIMIKYU);
    enable(Challenges.ABILITY_RANDOMIZER, 3);
    expect(species.getAbility(0)).toBe(AbilityId.DISGUISE);
    enable(Challenges.ABILITY_RANDOMIZER, 2);
    expect(species.getAbility(0)).not.toBe(AbilityId.DISGUISE);
  });

  it("updates ribbon eligibility for each player's challenges and suppresses it under randomizers", () => {
    enable(Challenges.SINGLE_TYPE_P1, PokemonType.FIRE + 1);
    enable(Challenges.SINGLE_TYPE_P2, PokemonType.WATER + 1);
    expect(getRibbonsToAward(0)).not.toBe(getRibbonsToAward(1));
    expect(getRibbonsToAward(0) & RibbonData.CLASSIC).not.toBe(0n);
    enable(Challenges.MOVESET_RANDOMIZER);
    expect(getRibbonsToAward(0)).toBe(0n);
    expect(getRibbonsToAward(1)).toBe(0n);
    enable(Challenges.MOVESET_RANDOMIZER, 0);
    enable(Challenges.ABILITY_RANDOMIZER);
    expect(getRibbonsToAward(0)).toBe(0n);
  });
});
