import type { PlayerIndex } from "#app/battle-scene";
import { RELEARN_MOVE } from "#app/constants";
import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { LearnableMoveSource } from "#enums/learnable-move-source";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type PlayerPokemon, Pokemon } from "#field/pokemon";
import { modifierPool } from "#modifiers/modifier-pools";
import { AttackTypeBoosterModifierType, type ModifierTypeGenerator, TmModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Upstream item generation and relearning", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
  });

  afterEach(() => {
    game.scene.movesetGenInProgress = false;
    game.scene.configureTwoPlayerMode(false);
  });

  function addPokemon(species: SpeciesId, owner: PlayerIndex = 0): PlayerPokemon {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species), 5);
    game.scene.getPlayerParty(owner).push(pokemon);
    pokemon.moveset = [new PokemonMove(MoveId.TACKLE)];
    return pokemon;
  }

  it("excludes forgotten TMs only for the Pokemon that already learned them", () => {
    game.scene.configureTwoPlayerMode(true);
    const first = addPokemon(SpeciesId.BULBASAUR);
    const second = addPokemon(SpeciesId.BULBASAUR, 1);
    const [tm] = first.getCompatibleTms(true, true);
    expect(tm).toBeDefined();
    first.usedTMs = [tm];

    expect(first.getCompatibleTms(true, true, true)).not.toContain(tm);
    expect(first.getCompatibleTms(true, true)).toContain(tm);
    expect(first.getLearnableLevelMoves().map(([, move]) => move)).toContain(tm);
    expect(second.getCompatibleTms(true, true, true)).toContain(tm);
  });

  it("does not generate a TM when every compatible party member has already used it", () => {
    const pokemon = addPokemon(SpeciesId.MEW);
    const partner = addPokemon(SpeciesId.MEW);
    pokemon.usedTMs = pokemon.getCompatibleTms();
    const factories = [modifierTypes.TM_COMMON, modifierTypes.TM_GREAT, modifierTypes.TM_ULTRA];
    for (const factory of factories) {
      const generator = getModifierType(factory) as ModifierTypeGenerator;
      expect(generator.generateType([pokemon])).toBeNull();
      expect(generator.generateType([pokemon, partner])).not.toBeNull();
    }
  });

  it.each([
    [SpeciesId.MACHAMP, MoveId.DUAL_CHOP, "TM_GREAT"],
    [SpeciesId.PERSIAN, MoveId.NIGHT_SLASH, "TM_GREAT"],
    [SpeciesId.FLYGON, MoveId.FIRST_IMPRESSION, "TM_ULTRA"],
  ] as const)("generates newly added TM rewards for species %i: move %i (%s)", (species, move, reward) => {
    const pokemon = addPokemon(species);
    expect(pokemon.getCompatibleTms(true, true, true)).toContain(move);
    pokemon.usedTMs = pokemon.getCompatibleTms().filter(tm => tm !== move);
    const generator = getModifierType(modifierTypes[reward]) as ModifierTypeGenerator;
    const item = generator.generateType([pokemon]) as TmModifierType;
    expect(item).toBeInstanceOf(TmModifierType);
    expect(item.moveId).toBe(move);

    pokemon.usedTMs.push(move);
    expect(generator.generateType([pokemon])).toBeNull();
    expect(pokemon.getLearnableLevelMoves().map(([, id]) => id)).toContain(move);
  });

  it.each([false, true])("retains reminder-only moves below a duplicate level-up entry (fusion=%s)", fusion => {
    const pokemon = addPokemon(SpeciesId.MEW);
    const source = fusion ? getPokemonSpecies(SpeciesId.CELEBI) : pokemon.species;
    if (fusion) {
      pokemon.fusionSpecies = source;
      pokemon.fusionFormIndex = 0;
    }
    vi.spyOn(source, "getLevelMoves").mockReturnValue([
      [1, MoveId.TACKLE],
      [RELEARN_MOVE, MoveId.PSYCHIC],
      [30, MoveId.PSYCHIC],
    ]);

    const entries = pokemon.getLearnableLevelMoves().filter(([, move]) => move === MoveId.PSYCHIC);
    expect(entries).toEqual([
      [RELEARN_MOVE, MoveId.PSYCHIC, fusion ? LearnableMoveSource.FUSION_RELEARN : LearnableMoveSource.RELEARN],
    ]);

    pokemon.level = 30;
    expect(pokemon.getLevelMoves(1, true, false, true).filter(([, move]) => move === MoveId.PSYCHIC)).toEqual([
      [30, MoveId.PSYCHIC, fusion ? LearnableMoveSource.FUSION_LEVEL : LearnableMoveSource.LEVEL],
    ]);
  });

  it("does not expose ordinary future level-up moves through the reminder", () => {
    const pokemon = addPokemon(SpeciesId.MEW);
    vi.spyOn(pokemon.species, "getLevelMoves").mockReturnValue([[30, MoveId.PSYCHIC]]);
    expect(pokemon.getLearnableLevelMoves().map(([, move]) => move)).not.toContain(MoveId.PSYCHIC);
  });

  it.each([
    [AbilityId.PIXILATE, PokemonType.FAIRY],
    [AbilityId.AERILATE, PokemonType.FLYING],
    [AbilityId.REFRIGERATE, PokemonType.ICE],
    [AbilityId.GALVANIZE, PokemonType.ELECTRIC],
  ])("generates type boosters for ability %i's converted attacks", (ability, type) => {
    const pokemon = addPokemon(SpeciesId.EEVEE);
    vi.spyOn(pokemon, "getAbility").mockReturnValue(allAbilities[ability]);
    pokemon.summonData.abilitySuppressed = true;
    const generator = getModifierType(modifierTypes.ATTACK_TYPE_BOOSTER) as ModifierTypeGenerator;
    const item = generator.generateType([pokemon]) as AttackTypeBoosterModifierType;

    expect(item).toBeInstanceOf(AttackTypeBoosterModifierType);
    expect(item.moveType).toBe(type);
    expect(game.scene.movesetGenInProgress).toBe(false);
    expect(game.scene.phaseManager.hasPhaseOfType("ShowAbilityPhase")).toBe(false);
  });

  it("also considers passive type-changing abilities", () => {
    const pokemon = addPokemon(SpeciesId.EEVEE);
    vi.spyOn(pokemon, "hasPassive").mockReturnValue(true);
    vi.spyOn(pokemon, "getPassiveAbility").mockReturnValue(allAbilities[AbilityId.PIXILATE]);
    expect(pokemon.getMoveTypeForItemSpawn(allMoves[MoveId.TACKLE])).toEqual([PokemonType.FAIRY]);
  });

  it.each([false, true])("restores the previous generation flag, including on failure (%s)", previous => {
    const pokemon = addPokemon(SpeciesId.EEVEE);
    game.scene.movesetGenInProgress = previous;
    pokemon.getMoveTypeForItemSpawn(allMoves[MoveId.TACKLE]);
    expect(game.scene.movesetGenInProgress).toBe(previous);
    vi.spyOn(pokemon, "getAbility").mockImplementation(() => {
      throw new Error("test failure");
    });
    expect(() => pokemon.getMoveTypeForItemSpawn(allMoves[MoveId.TACKLE])).toThrow("test failure");
    expect(game.scene.movesetGenInProgress).toBe(previous);
  });

  it("preserves the special item-spawn types for variable-type moves", () => {
    const pokemon = addPokemon(SpeciesId.EEVEE);
    pokemon.moveset = [new PokemonMove(MoveId.WEATHER_BALL)];
    vi.spyOn(pokemon, "getAbility").mockReturnValue(allAbilities[AbilityId.PIXILATE]);
    const variableTypes = allMoves[MoveId.WEATHER_BALL]
      .getAttrs("VariableMoveTypeAttr")[0]
      .getTypesForItemSpawn(pokemon, allMoves[MoveId.WEATHER_BALL]);
    const getOrdinaryType = vi.spyOn(pokemon, "getMoveTypeForItemSpawn");
    const generator = getModifierType(modifierTypes.ATTACK_TYPE_BOOSTER) as ModifierTypeGenerator;
    const item = generator.generateType([pokemon]) as AttackTypeBoosterModifierType;
    expect(variableTypes).toContain(item.moveType);
    expect(getOrdinaryType).not.toHaveBeenCalled();
  });

  it.each([
    [1, 1],
    [29, 1],
    [30, 2],
    [59, 2],
    [60, 3],
    [89, 3],
    [90, 4],
    [500, 4],
  ])("weights Memory Mushrooms by adjusted wave %i, not party level", (wave, expectedWeight) => {
    const pokemon = addPokemon(SpeciesId.MEW);
    pokemon.level = 500;
    vi.spyOn(pokemon, "getLearnableLevelMoves").mockReturnValue([]);
    const adjust = vi.spyOn(game.scene.gameMode, "getWaveForDifficulty").mockReturnValue(wave);
    const entry = modifierPool[ModifierTier.GREAT].find(m => m.modifierType.id === "MEMORY_MUSHROOM")!;
    expect(typeof entry.weight).toBe("function");
    if (typeof entry.weight !== "function") {
      throw new Error("Expected dynamic mushroom weight");
    }
    expect(entry.weight([pokemon], 0)).toBe(expectedWeight);
    expect(adjust).toHaveBeenCalledWith(game.scene.currentBattle.waveIndex, true);
  });
});
