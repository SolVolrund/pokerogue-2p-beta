import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves } from "#data/data-lists";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  PlayerTrainerSprite,
} from "#enums/player-trainer-sprite";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getChallengesForPlayer } from "#utils/challenge-utils";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
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

describe("Sabrina CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("sabrina");
  const pool = [
    SpeciesId.ABRA,
    SpeciesId.MR_MIME,
    SpeciesId.WOBBUFFET,
    SpeciesId.JYNX,
    SpeciesId.RALTS,
    SpeciesId.DROWZEE,
    SpeciesId.SLOWBRO,
    SpeciesId.BELDUM,
    SpeciesId.SIGILYPH,
    SpeciesId.EXEGGUTOR,
    SpeciesId.MEWTWO,
    SpeciesId.WOOBAT,
    SpeciesId.SLOWPOKE,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "sabrina");
    game.scene.setComputerPartnerKey(2, "whitney");
  });

  function addPokemon(speciesId: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 100);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires a Psychic clear, including past clears, rather than merely defeating Sabrina", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("sabrina")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_NORMAL = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("sabrina")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("sabrina")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_PSYCHIC = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("sabrina")).toBe(true);
  });

  it("keeps the exact 13-species pool, evolved entries, and Abra as the guaranteed Ace", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    expect(profile.signatureMoves).toBeUndefined();
    expect(profile.startingStarters?.every(starter => starter.moveset === undefined)).toBe(true);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.ABRA);
      expect(starters.length).toBeGreaterThan(1);
      expect(starters.length).toBeLessThanOrEqual(6);
      expect(starters.every(starter => pool.includes(starter.speciesId))).toBe(true);
      expect(starters.map((starter, index) => isComputerPartnerStarterAce(profile, starter, index)))
        .toEqual(starters.map((_, index) => index === 0));
      const cost = starters.reduce((sum, starter) => sum + speciesDataRegistry.getStarterCost(
        getPokemonSpecies(starter.speciesId).getRootSpeciesId(true),
      ), 0);
      expect(cost).toBeLessThanOrEqual(10);
    }
  });

  it("can select Mewtwo within the point budget without promoting it over Abra", () => {
    for (const speciesId of [SpeciesId.ABRA, SpeciesId.MEWTWO]) {
      game.scene.gameData.getComputerPartnerStarterProgressEntry("sabrina", speciesId).valueReduction = 2;
    }
    const progress = game.scene.gameData.getComputerPartnerProgress("sabrina");
    const starters = createComputerPartnerStarter({
      ...profile,
      startingStarters: profile.startingStarters!.filter(starter => [SpeciesId.ABRA, SpeciesId.MEWTWO].includes(starter.speciesId)),
    }, progress, 6, 1);
    expect(starters.map(starter => starter.speciesId)).toEqual([SpeciesId.ABRA, SpeciesId.MEWTWO]);
    expect(isComputerPartnerStarterAce(profile, starters[0], 0)).toBe(true);
    expect(isComputerPartnerStarterAce(profile, starters[1], 1)).toBe(false);
  });

  it("accepts Psychic recruits and eligible pre-evolutions, but not unrelated Pokemon", () => {
    for (const speciesId of [...pool, SpeciesId.STARYU, SpeciesId.EEVEE]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(true);
    }
    for (const speciesId of [SpeciesId.PSYDUCK, SpeciesId.MILTANK, SpeciesId.CHARMANDER]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(false);
    }
    const abra = addPokemon(SpeciesId.ABRA);
    expect(getComputerPartnerReplacementScores(profile, [abra], getPokemonSpecies(SpeciesId.CHARMANDER))).toEqual([]);
  });

  it("keeps Sabrina, Whitney, and the human's battle restrictions independent", () => {
    expect(addPokemon(SpeciesId.CHARMANDER, 0).isAllowedInBattle()).toBe(true);
    const abra = addPokemon(SpeciesId.ABRA);
    expect(abra.isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.EEVEE).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.EEVEE, 2).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.ABRA, 2).isAllowedInBattle()).toBe(false);
    abra.hp = 0;
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
    expect(getChallengesForPlayer(1)).toEqual([]);
    expect(getChallengesForPlayer(1, true)).toHaveLength(1);
  });

  it.each([0, 1, 2] as const)("uses Sabrina's sprite and type rules in CPU slot %i", playerIndex => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(playerIndex, "sabrina");
    expect(game.scene.getTrainerSprite(playerIndex)).toBe(PlayerTrainerSprite.SABRINA);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(playerIndex), "setScale");
    game.scene.getPlayerTrainerBackSprite(playerIndex);
    expect(setScale).toHaveBeenCalledWith(0.5);
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.SABRINA, true)).toBe("sabrina_back_pb");
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.SABRINA)).toBe("sabrina");
    expect(addPokemon(SpeciesId.ABRA, playerIndex).isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.CHARMANDER, playerIndex).isAllowedInBattle()).toBe(false);
  });

  it("uses ordinary move-learning rules without Whitney's signature move exceptions", () => {
    const pokemon = addPokemon(SpeciesId.ABRA);
    expect(chooseComputerPartnerMoveLearningDecision(
      pokemon, [], allMoves[MoveId.DEFENSE_CURL], LearnMoveType.LEARN_MOVE, { profile },
    ).shouldLearn).toBe(false);
    expect(chooseComputerPartnerMoveLearningDecision(
      pokemon, [], allMoves[MoveId.PSYCHIC], LearnMoveType.LEARN_MOVE, { profile },
    ).shouldLearn).toBe(true);
  });

  it("registers a distinct partner key and keeps Sabrina's candy progress separate", () => {
    expect(isComputerPartnerKey("sabrina")).toBe(true);
    game.scene.gameData.addComputerPartnerStarterCandy("sabrina", SpeciesId.ABRA, 5);
    expect(game.scene.gameData.getComputerPartnerStarterProgressEntry("sabrina", SpeciesId.ABRA).candyCount).toBe(5);
    expect(game.scene.gameData.getComputerPartnerStarterProgressEntry("mira", SpeciesId.ABRA).candyCount).toBe(0);
  });
});
