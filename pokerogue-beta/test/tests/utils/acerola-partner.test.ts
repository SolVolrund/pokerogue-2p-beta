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

describe("Acerola CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("acerola");
  const pool = [
    SpeciesId.MIMIKYU,
    SpeciesId.SABLEYE,
    SpeciesId.DRIFLOON,
    SpeciesId.DHELMISE,
    SpeciesId.SANDYGAST,
    SpeciesId.SHUPPET,
    SpeciesId.FRILLISH,
    SpeciesId.GASTLY,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "acerola");
    game.scene.setComputerPartnerKey(2, "gardenia");
  });

  function addPokemon(speciesId: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 100);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires a Ghost clear, including past clears, rather than merely defeating Acerola", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("acerola")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GRASS = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("acerola")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("acerola")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GHOST = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("acerola")).toBe(true);
  });

  it("uses the six standard team-building targets and a Jolly Mimikyu Ace", () => {
    expect(profile.roles).toEqual(["ace", "special", "physical", "bulk", "speed", "balanced"]);
    expect(profile.starterSpeciesId).toBe(SpeciesId.MIMIKYU);
    expect(profile.starterNature).toBe(Nature.JOLLY);
    expect(profile.monotype).toBe(PokemonType.GHOST);
    expect(profile.signatureMoves).toBeUndefined();
  });

  it("keeps the eight-species pool within the usual budget, always starting with Mimikyu", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.MIMIKYU);
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

  it.each([
    SpeciesId.SANDYGAST,
    SpeciesId.FRILLISH,
  ])("starts with pre-evolution %i without forcing an evolution", speciesId => {
    const starters = createComputerPartnerStarter(
      {
        ...profile,
        startingStarters: profile.startingStarters!.filter(starter =>
          [SpeciesId.MIMIKYU, speciesId].includes(starter.speciesId),
        ),
      },
      undefined,
      6,
      1,
    );
    expect(starters.map(starter => starter.speciesId)).toEqual([SpeciesId.MIMIKYU, speciesId]);
    expect(starters[1].evolveAtJoin).not.toBe(true);
    expect(isComputerPartnerStarterAce(profile, starters[1], 1)).toBe(false);
  });

  it("accepts Ghost recruits and eligible pre-evolutions, but rejects unrelated Pokemon", () => {
    for (const speciesId of [...pool, SpeciesId.SNORUNT]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(true);
    }
    for (const speciesId of [SpeciesId.ABRA, SpeciesId.MAGIKARP]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(false);
    }
    const mimikyu = addPokemon(SpeciesId.MIMIKYU);
    expect(getComputerPartnerReplacementScores(profile, [mimikyu], getPokemonSpecies(SpeciesId.ABRA))).toEqual([]);
  });

  it("keeps each trainer's restrictions independent and requires a usable Ghost Pokemon", () => {
    expect(addPokemon(SpeciesId.ABRA, 0).isAllowedInBattle()).toBe(true);
    const mimikyu = addPokemon(SpeciesId.MIMIKYU);
    expect(mimikyu.isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.SNORUNT).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.BUDEW, 2).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.MIMIKYU, 2).isAllowedInBattle()).toBe(false);
    mimikyu.hp = 0;
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
    expect(getChallengesForPlayer(1)).toEqual([]);
    expect(getChallengesForPlayer(1, true)).toHaveLength(1);
  });

  it.each([0, 1, 2] as const)("uses Acerola's native-size sprite and type rules in CPU slot %i", playerIndex => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(playerIndex, "acerola");
    expect(game.scene.getTrainerSprite(playerIndex)).toBe(PlayerTrainerSprite.ACEROLA);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(playerIndex), "setScale");
    game.scene.getPlayerTrainerBackSprite(playerIndex);
    expect(setScale).toHaveBeenCalledWith(1);
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.ACEROLA, true)).toBe("acerola_back_pb");
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.ACEROLA)).toBe("acerola");
    expect(addPokemon(SpeciesId.MIMIKYU, playerIndex).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.ABRA, playerIndex).isAllowedInBattle()).toBe(false);
  });

  it("saves Acerola's unlock and candy progress separately from other trainers", () => {
    expect(isComputerPartnerKey("acerola")).toBe(true);
    game.scene.gameData.achvUnlocks.MONO_GHOST = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("acerola", SpeciesId.MIMIKYU, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("acerola")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("acerola", SpeciesId.MIMIKYU).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("gardenia", SpeciesId.MIMIKYU).candyCount).toBe(0);
  });
});
