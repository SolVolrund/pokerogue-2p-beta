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

describe("Blaine CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("blaine");
  const pool = [
    SpeciesId.GROWLITHE,
    SpeciesId.PONYTA,
    SpeciesId.VULPIX,
    SpeciesId.SLUGMA,
    SpeciesId.MAGBY,
    SpeciesId.NUMEL,
    SpeciesId.HOUNDOUR,
    SpeciesId.CHARMANDER,
    SpeciesId.MOLTRES,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "blaine");
    game.scene.setComputerPartnerKey(2, "gardenia");
  });

  function addPokemon(speciesId: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 100);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires a Fire clear, including past clears, rather than merely defeating Blaine", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("blaine")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GRASS = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("blaine")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("blaine")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_FIRE = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("blaine")).toBe(true);
  });

  it("uses the six team-building targets and an Adamant Growlithe Ace", () => {
    expect(profile.roles).toEqual(["ace", "special", "physical", "bulk", "speed", "balanced"]);
    expect(profile.starterSpeciesId).toBe(SpeciesId.GROWLITHE);
    expect(profile.starterNature).toBe(Nature.ADAMANT);
    expect(profile.monotype).toBe(PokemonType.FIRE);
    expect(profile.signatureMoves).toBeUndefined();
  });

  it("keeps the nine-species pool within the usual budget, always starting with Growlithe", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.GROWLITHE);
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

  it("allows Moltres when affordable without promoting it over Growlithe", () => {
    for (const speciesId of [SpeciesId.GROWLITHE, SpeciesId.MOLTRES]) {
      game.scene.gameData.getComputerPartnerStarterProgressEntry("blaine", speciesId).valueReduction = 2;
    }
    const progress = game.scene.gameData.getComputerPartnerProgress("blaine");
    const starters = createComputerPartnerStarter(
      {
        ...profile,
        startingStarters: profile.startingStarters!.filter(starter =>
          [SpeciesId.GROWLITHE, SpeciesId.MOLTRES].includes(starter.speciesId),
        ),
      },
      progress,
      6,
      1,
    );
    expect(starters.map(starter => starter.speciesId)).toEqual([SpeciesId.GROWLITHE, SpeciesId.MOLTRES]);
    expect(isComputerPartnerStarterAce(profile, starters[0], 0)).toBe(true);
    expect(isComputerPartnerStarterAce(profile, starters[1], 1)).toBe(false);
  });

  it("accepts Fire recruits and eligible pre-evolutions, but rejects unrelated Pokemon", () => {
    for (const speciesId of [...pool, SpeciesId.EEVEE]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(true);
    }
    for (const speciesId of [SpeciesId.BUDEW, SpeciesId.ABRA, SpeciesId.MAGIKARP]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(false);
    }
    const growlithe = addPokemon(SpeciesId.GROWLITHE);
    expect(getComputerPartnerReplacementScores(profile, [growlithe], getPokemonSpecies(SpeciesId.BUDEW))).toEqual([]);
  });

  it("keeps Blaine, Gardenia, and the human's restrictions independent and requires a usable Fire Pokemon", () => {
    expect(addPokemon(SpeciesId.SQUIRTLE, 0).isAllowedInBattle()).toBe(true);
    const growlithe = addPokemon(SpeciesId.GROWLITHE);
    expect(growlithe.isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.EEVEE).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.BUDEW, 2).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.GROWLITHE, 2).isAllowedInBattle()).toBe(false);
    growlithe.hp = 0;
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
    expect(getChallengesForPlayer(1)).toEqual([]);
    expect(getChallengesForPlayer(1, true)).toHaveLength(1);
  });

  it.each([0, 1, 2] as const)("uses Blaine's sprite and type rules in CPU slot %i", playerIndex => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(playerIndex, "blaine");
    expect(game.scene.getTrainerSprite(playerIndex)).toBe(PlayerTrainerSprite.BLAINE);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(playerIndex), "setScale");
    game.scene.getPlayerTrainerBackSprite(playerIndex);
    expect(setScale).toHaveBeenCalledWith(0.5);
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.BLAINE, true)).toBe("blaine_back_pb");
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.BLAINE)).toBe("blaine");
    expect(addPokemon(SpeciesId.GROWLITHE, playerIndex).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.BUDEW, playerIndex).isAllowedInBattle()).toBe(false);
  });

  it("saves Blaine's unlock and candy progress separately from other trainers", () => {
    expect(isComputerPartnerKey("blaine")).toBe(true);
    game.scene.gameData.achvUnlocks.MONO_FIRE = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("blaine", SpeciesId.GROWLITHE, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("blaine")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("blaine", SpeciesId.GROWLITHE).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("cheryl", SpeciesId.GROWLITHE).candyCount).toBe(0);
  });
});
