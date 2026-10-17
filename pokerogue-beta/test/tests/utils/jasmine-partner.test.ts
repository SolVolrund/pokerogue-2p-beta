import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { Nature } from "#enums/nature";
import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  PlayerTrainerSprite,
} from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameData } from "#system/game-data";
import { SettingKeys } from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import { getChallengesForPlayer } from "#utils/challenge-utils";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  getComputerPartnerReplacementScores,
  isComputerPartnerCandidateAllowed,
  isComputerPartnerKey,
  isComputerPartnerStarterAce,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Jasmine CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;
  const profile = getComputerPartnerProfile("jasmine");
  const pool = [
    SpeciesId.ONIX,
    SpeciesId.MAGNEMITE,
    SpeciesId.BRONZOR,
    SpeciesId.BELDUM,
    SpeciesId.SKARMORY,
    SpeciesId.MAWILE,
    SpeciesId.FERROSEED,
    SpeciesId.KLINK,
    SpeciesId.CELESTEELA,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    await game.runToTitle();
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 0 }));
    Object.defineProperty(localStorage, "settings", { value: true, configurable: true });
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "jasmine");
    game.scene.setComputerPartnerKey(2, "gardenia");
  });

  afterEach(() => {
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  function addPokemon(speciesId: SpeciesId, owner: PlayerIndex = 1, isAce = false) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 100);
    pokemon.computerPartnerAce = isAce;
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires a Steel clear, including past clears, rather than merely defeating Jasmine", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("jasmine")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_ROCK = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("jasmine")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("jasmine")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_STEEL = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("jasmine")).toBe(true);
  });

  it("uses the six standard team-building targets and an Impish Onix Ace", () => {
    expect(profile.roles).toEqual(["ace", "special", "physical", "bulk", "speed", "balanced"]);
    expect(profile.starterSpeciesId).toBe(SpeciesId.ONIX);
    expect(profile.starterNature).toBe(Nature.IMPISH);
    expect(profile.monotype).toBe(PokemonType.STEEL);
    expect(profile.signatureMoves).toBeUndefined();
  });

  it("keeps the nine-species pool within the usual budget, always starting with Onix", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.ONIX);
      expect(starters.length).toBeGreaterThan(1);
      expect(starters.length).toBeLessThanOrEqual(6);
      expect(starters.every(starter => pool.includes(starter.speciesId))).toBe(true);
      expect(starters.map((starter, index) => isComputerPartnerStarterAce(profile, starter, index))).toEqual(
        starters.map((_, index) => index === 0),
      );
      const cost = starters.reduce(
        (sum, starter) =>
          sum + speciesDataRegistry.getStarterCost(getPokemonSpecies(starter.speciesId).getRootSpeciesId(true)),
        0,
      );
      expect(cost).toBeLessThanOrEqual(10);
    }
  });

  it("allows Celesteela when affordable without promoting it over Onix", () => {
    for (const speciesId of [SpeciesId.ONIX, SpeciesId.CELESTEELA]) {
      game.scene.gameData.getComputerPartnerStarterProgressEntry("jasmine", speciesId).valueReduction = 2;
    }
    const progress = game.scene.gameData.getComputerPartnerProgress("jasmine");
    const starters = createComputerPartnerStarter(
      {
        ...profile,
        startingStarters: profile.startingStarters!.filter(starter =>
          [SpeciesId.ONIX, SpeciesId.CELESTEELA].includes(starter.speciesId),
        ),
      },
      progress,
      6,
      1,
    );
    expect(starters.map(starter => starter.speciesId)).toEqual([SpeciesId.ONIX, SpeciesId.CELESTEELA]);
    expect(isComputerPartnerStarterAce(profile, starters[0], 0)).toBe(true);
    expect(isComputerPartnerStarterAce(profile, starters[1], 1)).toBe(false);
  });

  it("accepts Steel recruits and eligible pre-evolutions, but rejects unrelated Pokemon", () => {
    for (const speciesId of pool) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(true);
    }
    for (const speciesId of [SpeciesId.ABRA, SpeciesId.MAGIKARP]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(false);
    }
    const onix = addPokemon(SpeciesId.ONIX, 1, true);
    expect(getComputerPartnerReplacementScores(profile, [onix], getPokemonSpecies(SpeciesId.ABRA))).toEqual([]);
  });

  it("keeps each trainer's restrictions independent and grants Steel only to Jasmine's Ace", () => {
    expect(addPokemon(SpeciesId.ABRA, 0).isAllowedInBattle()).toBe(true);
    const onix = addPokemon(SpeciesId.ONIX, 1, true);
    expect(onix.isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.ONIX).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.BUDEW, 2).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.ONIX, 2).isAllowedInBattle()).toBe(false);
    onix.hp = 0;
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
    expect(getChallengesForPlayer(1)).toEqual([]);
    expect(getChallengesForPlayer(1, true)).toHaveLength(1);
  });

  it("keeps Onix usable through evolution without enabling optional Ace mechanics", async () => {
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue(undefined);
    const onix = addPokemon(SpeciesId.ONIX, 1, true);
    expect(onix.getTypes()).toEqual([PokemonType.ROCK, PokemonType.GROUND, PokemonType.STEEL]);
    expect(onix.isAllowedInBattle()).toBe(true);
    await onix.evolve(
      new SpeciesFormEvolution({ speciesId: SpeciesId.STEELIX, preFormKey: null, evoFormKey: null, level: 1 }),
      onix.getSpeciesForm(),
    );
    expect(onix.species.speciesId).toBe(SpeciesId.STEELIX);
    expect(onix.getTypes()).toEqual([PokemonType.STEEL, PokemonType.GROUND]);
    expect(onix.getAceType()).toBe(PokemonType.STEEL);
    expect(onix.isAllowedInBattle()).toBe(true);
  });

  it.each([0, 1, 2] as const)("uses Jasmine's sprite and type rules in CPU slot %i", playerIndex => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(playerIndex, "jasmine");
    expect(game.scene.getTrainerSprite(playerIndex)).toBe(PlayerTrainerSprite.JASMINE);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(playerIndex), "setScale");
    game.scene.getPlayerTrainerBackSprite(playerIndex);
    expect(setScale).toHaveBeenCalledWith(0.5);
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.JASMINE, true)).toBe("jasmine_back_pb");
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.JASMINE)).toBe("jasmine");
    expect(addPokemon(SpeciesId.ONIX, playerIndex, true).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.ABRA, playerIndex).isAllowedInBattle()).toBe(false);
  });

  it("saves Jasmine's unlock and candy progress separately from other trainers", () => {
    expect(isComputerPartnerKey("jasmine")).toBe(true);
    game.scene.gameData.achvUnlocks.MONO_STEEL = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("jasmine", SpeciesId.ONIX, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("jasmine")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("jasmine", SpeciesId.ONIX).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("cheryl", SpeciesId.ONIX).candyCount).toBe(0);
  });
});
