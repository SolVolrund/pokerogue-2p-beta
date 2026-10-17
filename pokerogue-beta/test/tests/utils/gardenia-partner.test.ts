import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
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
import { GameData } from "#system/game-data";
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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Gardenia CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("gardenia");
  const pool = [
    SpeciesId.BUDEW,
    SpeciesId.CHERUBI,
    SpeciesId.TURTWIG,
    SpeciesId.ODDISH,
    SpeciesId.HOPPIP,
    SpeciesId.CARNIVINE,
    SpeciesId.TANGELA,
    SpeciesId.TROPIUS,
    SpeciesId.SHROOMISH,
    SpeciesId.SUNKERN,
    SpeciesId.CRADILY,
    SpeciesId.BULBASAUR,
    SpeciesId.SEEDOT,
    SpeciesId.DHELMISE,
    SpeciesId.BELLSPROUT,
    SpeciesId.CACNEA,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "gardenia");
    game.scene.setComputerPartnerKey(2, "sabrina");
  });

  function addPokemon(speciesId: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 100);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires a Grass clear, including past clears, rather than merely defeating Gardenia", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("gardenia")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_PSYCHIC = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("gardenia")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("gardenia")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GRASS = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("gardenia")).toBe(true);
  });

  it("uses the agreed team-building targets with a Modest Budew Ace", () => {
    expect(profile.roles).toEqual(["ace", "special", "physical", "bulk", "speed", "balanced"]);
    expect(profile.starterSpeciesId).toBe(SpeciesId.BUDEW);
    expect(profile.starterNature).toBe(Nature.MODEST);
    expect(profile.monotype).toBe(PokemonType.GRASS);
    expect(profile.signatureMoves).toBeUndefined();
  });

  it("keeps the 16-species pool, including Tropius and Cradily but not Rotom, within the starter budget", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    expect(pool).not.toContain(SpeciesId.ROTOM);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.BUDEW);
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

  it("accepts Grass recruits and eligible pre-evolutions, but rejects unrelated Pokemon", () => {
    for (const speciesId of [...pool, SpeciesId.EEVEE]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(true);
    }
    for (const speciesId of [SpeciesId.CHARMANDER, SpeciesId.ABRA, SpeciesId.MAGIKARP]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(false);
    }
    const budew = addPokemon(SpeciesId.BUDEW);
    expect(getComputerPartnerReplacementScores(profile, [budew], getPokemonSpecies(SpeciesId.CHARMANDER))).toEqual([]);
  });

  it("keeps Gardenia, Sabrina, and the human's restrictions independent and requires a usable Grass Pokemon", () => {
    expect(addPokemon(SpeciesId.CHARMANDER, 0).isAllowedInBattle()).toBe(true);
    const budew = addPokemon(SpeciesId.BUDEW);
    expect(budew.isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.EEVEE).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.ABRA, 2).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.BUDEW, 2).isAllowedInBattle()).toBe(false);
    budew.hp = 0;
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
    expect(getChallengesForPlayer(1)).toEqual([]);
    expect(getChallengesForPlayer(1, true)).toHaveLength(1);
  });

  it.each([0, 1, 2] as const)("uses Gardenia's sprite and type rules in CPU slot %i", playerIndex => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(playerIndex, "gardenia");
    expect(game.scene.getTrainerSprite(playerIndex)).toBe(PlayerTrainerSprite.GARDENIA);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(playerIndex), "setScale");
    game.scene.getPlayerTrainerBackSprite(playerIndex);
    expect(setScale).toHaveBeenCalledWith(1);
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.GARDENIA, true)).toBe("gardenia_back_pb");
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.GARDENIA)).toBe("gardenia");
    expect(addPokemon(SpeciesId.BUDEW, playerIndex).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.CHARMANDER, playerIndex).isAllowedInBattle()).toBe(false);
  });

  it("saves Gardenia's unlock and candy progress separately from other trainers", () => {
    expect(isComputerPartnerKey("gardenia")).toBe(true);
    game.scene.gameData.achvUnlocks.MONO_GRASS = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("gardenia", SpeciesId.BUDEW, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("gardenia")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("gardenia", SpeciesId.BUDEW).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("cheryl", SpeciesId.BUDEW).candyCount).toBe(0);
  });
});
