import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import { allMoves } from "#data/data-lists";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { PokemonData } from "#system/pokemon-data";
import { SettingKeys } from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import { createCloneBallCopy } from "#utils/clone-ball";
import * as MoveAi from "#utils/computer-partner-move-ai";
import * as Profiles from "#utils/computer-partner-profile";
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Monotype CPU Ace types", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;
  let profiles: Partial<Record<Profiles.ComputerPartnerKey, Profiles.ComputerPartnerProfile>>;
  const getProfile = Profiles.getComputerPartnerProfile;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    await game.runToTitle();
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 0 }));
    Object.defineProperty(localStorage, "settings", { value: true, configurable: true });
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue(undefined);
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    profiles = {};
    vi.spyOn(Profiles, "getComputerPartnerProfile").mockImplementation(key => profiles[key] ?? getProfile(key));
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "gardenia");
    game.scene.setComputerPartnerKey(2, "blaine");
  });

  afterEach(() => {
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  // Use an isolated Onix-only pool to exercise generic Ace type behavior.
  function onixProfile(type: PokemonType) {
    const profile: Profiles.ComputerPartnerProfile = {
      ...getProfile("gardenia"),
      monotype: type,
      starterSpeciesId: SpeciesId.ONIX,
      startingStarters: [{ speciesId: SpeciesId.ONIX }],
    };
    profiles.gardenia = profile;
    return profile;
  }

  function addPokemon(speciesId = SpeciesId.ONIX, owner: PlayerIndex = 1, isAce = true) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 80);
    pokemon.computerPartnerAce = isAce;
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it.each([
    "whitney",
    "sabrina",
    "gardenia",
    "blaine",
    "jasmine",
    "brock",
    "acerola",
    "valerie",
  ] as const)("gives only %s's Ace the trainer type in every CPU seat without a human unlock", async key => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.gameData.achvUnlocks = {};
    const profile = getProfile(key);
    for (const owner of [0, 1, 2] as const) {
      game.scene.setComputerPartnerKey(owner, key);
      const starters = Profiles.createComputerPartnerStarter(profile, undefined, 6, owner);
      await new SelectStarterPhase().initPlayerStarters(starters, owner);
      const party = game.scene.getPlayerParty(owner);
      expect(party[0].getAceType()).toBe(profile.monotype);
      expect(party[0].getTypes().filter(type => type === profile.monotype)).toHaveLength(1);
      expect(party[0].isAllowedInBattle()).toBe(true);
      expect(party.slice(1).every(pokemon => pokemon.getAceType() === undefined)).toBe(true);
    }
  });

  it.each([
    PokemonType.STEEL,
    PokemonType.ROCK,
  ])("keeps Onix and its evolved Steelix usable for monotype %i with Ace mechanics off", async type => {
    onixProfile(type);
    const pokemon = addPokemon();
    expect(pokemon.getTypes()).toEqual([...new Set([PokemonType.ROCK, PokemonType.GROUND, type])]);
    expect(pokemon.isAllowedInBattle()).toBe(true);
    const evolution = new SpeciesFormEvolution({
      speciesId: SpeciesId.STEELIX,
      preFormKey: null,
      evoFormKey: null,
      level: 1,
    });
    await pokemon.evolve(evolution, pokemon.getSpeciesForm());
    expect(pokemon.species.speciesId).toBe(SpeciesId.STEELIX);
    expect(pokemon.getTypes()).toEqual([...new Set([PokemonType.STEEL, PokemonType.GROUND, type])]);
    expect(pokemon.isAllowedInBattle()).toBe(true);
    expect(pokemon.getTypes({ ignoreAceType: true })).toEqual([PokemonType.STEEL, PokemonType.GROUND]);
  });

  it("keeps an off-type designated Ace in the starter pool, without exempting other recruits", () => {
    const profile = onixProfile(PokemonType.STEEL);
    profile.starterSpeciesId = SpeciesId.MAGIKARP;
    profile.startingStarters = [
      { speciesId: SpeciesId.MAGIKARP },
      { speciesId: SpeciesId.MAGNEMITE },
      { speciesId: SpeciesId.ABRA },
    ];
    const filtered = Profiles.getComputerPartnerChallengeProfile(profile, 1);
    expect(filtered.startingStarters?.map(starter => starter.speciesId)).toEqual([
      SpeciesId.MAGIKARP,
      SpeciesId.MAGNEMITE,
    ]);
    const starters = Profiles.createComputerPartnerStarter(profile, undefined, 6, 1);
    expect(starters[0].speciesId).toBe(SpeciesId.MAGIKARP);
    expect(Profiles.isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.MAGIKARP), 1)).toBe(false);
    expect(Profiles.isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.MAGNEMITE), 1)).toBe(true);
  });

  it("does not bypass an additional player-specific monotype challenge", () => {
    const profile = onixProfile(PokemonType.STEEL);
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P2, PokemonType.FIRE + 1);
    expect(Profiles.createComputerPartnerStarter(profile, undefined, 6, 1)).toEqual([]);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P2, PokemonType.ROCK + 1);
    expect(Profiles.createComputerPartnerStarter(profile, undefined, 6, 1)[0].speciesId).toBe(SpeciesId.ONIX);
  });

  it("does not give the type to ordinary teammates, non-monotype partners, or human-owned Pokemon", () => {
    onixProfile(PokemonType.STEEL);
    const ordinary = addPokemon(SpeciesId.ONIX, 1, false);
    expect(ordinary.getAceType()).toBeUndefined();
    expect(ordinary.isAllowedInBattle()).toBe(false);
    game.scene.setComputerPartnerKey(2, "cheryl");
    expect(addPokemon(SpeciesId.ONIX, 2).getAceType()).toBeUndefined();
    const human = addPokemon(SpeciesId.ONIX, 0);
    human.ace = true;
    human.aceType = PokemonType.FIRE;
    expect(human.getAceType()).toBeUndefined();
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 1 }));
    expect(human.getAceType()).toBe(PokemonType.FIRE);
  });

  it("does not enable EV bonuses while optional Ace mechanics are off", () => {
    onixProfile(PokemonType.STEEL);
    const pokemon = addPokemon();
    pokemon.calculateStats();
    const before = [...pokemon.stats];
    pokemon.aceEvs = [252, 252, 0, 0, 0, 4];
    pokemon.calculateStats();
    expect(pokemon.stats).toEqual(before);
    expect(pokemon.getAceType()).toBe(PokemonType.STEEL);
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 1 }));
    pokemon.calculateStats();
    expect(pokemon.stats[0]).toBeGreaterThan(before[0]);
    expect(pokemon.getAceType()).toBe(PokemonType.STEEL);
  });

  it("provides real STAB and defensive typing without duplicating a natural type", () => {
    onixProfile(PokemonType.STEEL);
    const pokemon = addPokemon();
    expect(pokemon.calculateStabMultiplier(pokemon, allMoves[MoveId.IRON_TAIL], true, true)).toBe(1.5);
    expect(pokemon.getAttackTypeEffectiveness(PokemonType.FIRE)).toBe(1);
    expect(pokemon.calculateStabMultiplier(pokemon, allMoves[MoveId.ROCK_THROW], true, true)).toBe(1.5);
    pokemon.computerPartnerAce = false;
    expect(pokemon.calculateStabMultiplier(pokemon, allMoves[MoveId.IRON_TAIL], true, true)).toBe(1);
    expect(pokemon.getAttackTypeEffectiveness(PokemonType.FIRE)).toBe(0.5);
  });

  it("restores the type from existing save flags, including Normal, without requiring a saved Ace type", () => {
    onixProfile(PokemonType.NORMAL);
    const pokemon = addPokemon();
    const saved = JSON.parse(JSON.stringify(new PokemonData(pokemon)));
    expect(saved.aceType).toBeUndefined();
    const restored = new PokemonData(saved).toPokemon();
    if (!restored.isPlayer()) {
      throw new Error("Expected a restored player Pokemon");
    }
    game.scene.getPlayerParty(1).splice(0, 1, restored);
    expect(restored.getAceType()).toBe(PokemonType.NORMAL);
    expect(restored.isAllowedInBattle()).toBe(true);
    game.scene.getPlayerParty(1).splice(0, 1);
    game.scene.getPlayerParty(0).push(restored);
    expect(restored.getAceType()).toBeUndefined();
  });

  it("respects temporary typing and Tera while keeping permanent monotype eligibility", () => {
    onixProfile(PokemonType.STEEL);
    const pokemon = addPokemon();
    pokemon.summonData.types = [PokemonType.WATER];
    expect(pokemon.getTypes()).toEqual([PokemonType.WATER, PokemonType.STEEL]);
    pokemon.summonData.addedType = PokemonType.GHOST;
    expect(pokemon.getTypes()).toEqual([PokemonType.WATER, PokemonType.GHOST]);
    expect(pokemon.isAllowedInBattle()).toBe(true);
    pokemon.resetSummonData();
    pokemon.summonData.aceTypeSuppressed = true;
    expect(pokemon.getTypes()).not.toContain(PokemonType.STEEL);
    expect(pokemon.isAllowedInBattle()).toBe(true);
    pokemon.resetSummonData();
    pokemon.isTerastallized = true;
    vi.spyOn(pokemon, "getTeraType").mockReturnValue(PokemonType.ICE);
    expect(pokemon.getTypes()).toEqual([PokemonType.ICE]);
    expect(pokemon.isAllowedInBattle()).toBe(true);
  });

  it("preserves a CPU Ace's perceived type through Illusion without exposing the user's real bonus", () => {
    onixProfile(PokemonType.STEEL);
    const pokemon = addPokemon();
    const disguise = addPokemon(SpeciesId.BULBASAUR, 0, false);
    pokemon.setIllusion(disguise);
    expect(pokemon.getTypes({ useIllusion: true })).toEqual([PokemonType.GRASS, PokemonType.POISON]);
    expect(pokemon.getTypes()).toContain(PokemonType.STEEL);
    pokemon.breakIllusion();
    disguise.setIllusion(pokemon);
    expect(disguise.getTypes({ useIllusion: true })).toEqual([PokemonType.ROCK, PokemonType.GROUND, PokemonType.STEEL]);
    expect(disguise.getTypes()).toEqual([PokemonType.GRASS, PokemonType.POISON]);
  });

  it("does not copy the trainer type with a Clone Ball", () => {
    onixProfile(PokemonType.STEEL);
    game.scene.newBattle();
    const pokemon = addPokemon();
    const copy = createCloneBallCopy(pokemon);
    game.scene.getPlayerParty(1).push(copy);
    expect(copy.computerPartnerAce).toBe(false);
    expect(copy.getAceType()).toBeUndefined();
    expect(copy.getTypes()).toEqual([PokemonType.ROCK, PokemonType.GROUND]);
  });

  it("retains a type-losing evolved Ace when recruited mid-run and uses its type during move learning", async () => {
    const profile = onixProfile(PokemonType.ROCK);
    profile.startingStarters = [{ speciesId: SpeciesId.ONIX, evolveAtJoin: true }];
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    addPokemon(SpeciesId.EEVEE, 0, false);
    vi.spyOn(getPokemonSpecies(SpeciesId.ONIX), "getTrainerSpeciesForLevel").mockReturnValue(SpeciesId.STEELIX);
    const learn = MoveAi.chooseComputerPartnerMoveLearningDecision;
    const learnSpy = vi
      .spyOn(MoveAi, "chooseComputerPartnerMoveLearningDecision")
      .mockImplementation((...args: Parameters<typeof learn>) => {
        expect(args[0].getAceType()).toBe(PokemonType.ROCK);
        return learn(...args);
      });
    await inviteComputerPartnerToRun("gardenia");
    const party = game.scene.getPlayerParty(1);
    expect(party).toHaveLength(1);
    expect(party[0].species.speciesId).toBe(SpeciesId.STEELIX);
    expect(party[0].getAceType()).toBe(PokemonType.ROCK);
    expect(party[0].isAllowedInBattle()).toBe(true);
    expect(learnSpy).toHaveBeenCalled();
  });
});
