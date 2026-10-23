import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  PlayerTrainerSprite,
} from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameData } from "#system/game-data";
import { PokemonData } from "#system/pokemon-data";
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
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Kris CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("kris");
  const pool = [SpeciesId.CHIKORITA, SpeciesId.CYNDAQUIL, SpeciesId.TOTODILE];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "kris");
    game.scene.setComputerPartnerKey(2, "cheryl");
  });

  function addPokemon(id: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(id), 50);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires the Gen 2 achievement, not a trainer-battle unlock or another generation", () => {
    expect(isComputerPartnerKey("kris")).toBe(true);
    expect(game.scene.gameData.isComputerPartnerUnlocked("kris")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_ONE_VICTORY = 1;
    game.scene.gameData.unlockComputerPartner("kris");
    expect(game.scene.gameData.isComputerPartnerUnlocked("kris")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_TWO_VICTORY = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("kris")).toBe(true);
  });

  it("selects one seeded random Ace while keeping all three Johto starters", () => {
    const aces = new Set<SpeciesId>();
    for (let roll = 0; roll < 24; roll++) {
      const seed = `kris-ace-${roll}`;
      Phaser.Math.RND.sow([seed]);
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters).toHaveLength(3);
      expect(new Set(starters.map(s => s.speciesId))).toEqual(new Set(pool));
      expect(starters.map((s, i) => isComputerPartnerStarterAce(profile, s, i))).toEqual([true, false, false]);
      aces.add(starters[0].speciesId);
      Phaser.Math.RND.sow([seed]);
      expect(createComputerPartnerStarter(profile, undefined, 6, 1)).toEqual(starters);
    }
    expect(aces).toEqual(new Set(pool));
  });

  it("keeps only the chosen Ace protected, including after saving and restoring", () => {
    const party = pool.map(id => addPokemon(id));
    party[1].computerPartnerAce = true;
    const restored = party.map(p => new PokemonData(JSON.parse(JSON.stringify(new PokemonData(p)))).toPokemon());
    expect(restored.map(p => p.isPlayer() && p.computerPartnerAce)).toEqual([false, true, false]);
    const scores = getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.LUGIA), 3);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every(s => s.replacedPokemonIndex !== 1)).toBe(true);
    expect(scores.some(s => s.replacedPokemonIndex === 0 || s.replacedPokemonIndex === 2)).toBe(true);
  });

  it("accepts only Gen 2 recruits and rejects cross-generation fusions", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.UMBREON), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.CHARIZARD), 1)).toBe(false);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.LUCARIO))).toBe(false);
    const candidate = addPokemon(SpeciesId.TOTODILE);
    candidate.fusionSpecies = getPokemonSpecies(SpeciesId.CYNDAQUIL);
    expect(isComputerPartnerCandidateAllowed(profile, candidate, 1)).toBe(true);
    candidate.fusionSpecies = getPokemonSpecies(SpeciesId.CHARMANDER);
    expect(isComputerPartnerCandidateAllowed(profile, candidate, 1)).toBe(false);
  });

  it("applies Gen 2 battle legality only to Kris without adding a run challenge", () => {
    const gen2 = addPokemon(SpeciesId.CYNDAQUIL);
    const wrongGen = addPokemon(SpeciesId.CHARMANDER);
    const human = addPokemon(SpeciesId.CHARMANDER, 0);
    const otherCpu = addPokemon(SpeciesId.CHARMANDER, 2);
    game.scene.setActivePlayerIndex(2);
    expect([gen2, wrongGen, human, otherCpu].map(p => p.isAllowedInBattle())).toEqual([true, false, true, true]);
    expect(getChallengesForPlayer(1).filter(c => c.value)).toHaveLength(0);
    expect(
      getChallengesForPlayer(1, true)
        .filter(c => c.value)
        .map(c => c.value),
    ).toEqual([2]);
    gen2.fusionSpecies = getPokemonSpecies(SpeciesId.CHARMANDER);
    expect(gen2.isAllowedInBattle()).toBe(false);
  });

  it("combines her generation with player-specific challenge restrictions", () => {
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION_P1, 1);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_TYPE_P2, PokemonType.FIRE + 1);
    expect(createComputerPartnerStarter(profile, undefined, 6, 1).map(s => s.speciesId)).toEqual([SpeciesId.CYNDAQUIL]);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.TOTODILE), 1)).toBe(false);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.CYNDAQUIL), 1)).toBe(true);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION_P2, 1);
    expect(createComputerPartnerStarter(profile, undefined, 6, 1)).toEqual([]);
  });

  it.each([true, false])("blocks out-of-generation evolutions with Ace=%s", isAce => {
    const pokemon = addPokemon(SpeciesId.QUILAVA);
    pokemon.computerPartnerAce = isAce;
    expect(game.scene.isComputerPartnerEvolutionAllowed(pokemon, SpeciesId.TYPHLOSION)).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(pokemon, SpeciesId.HISUI_TYPHLOSION)).toBe(false);
    const human = addPokemon(SpeciesId.QUILAVA, 0);
    expect(game.scene.isComputerPartnerEvolutionAllowed(human, SpeciesId.HISUI_TYPHLOSION)).toBe(true);
  });

  it.each([0, 1, 2] as const)("uses her supplied sprite in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "kris");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.KRIS);
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.KRIS)).toBe("kris");
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.KRIS, true)).toBe("kris_back_pb");
  });

  it("joins through the normal invitation flow with exactly one Ace", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    addPokemon(SpeciesId.BULBASAUR, 0);
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await inviteComputerPartnerToRun("kris");
    const party = game.scene.getPlayerParty(1);
    expect(new Set(party.map(p => p.species.speciesId))).toEqual(new Set(pool));
    expect(party.map(p => p.computerPartnerAce)).toEqual([true, false, false]);
  });

  it("round-trips her achievement unlock and separate CPU progress", () => {
    game.scene.gameData.achvUnlocks.MONO_GEN_TWO_VICTORY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("kris", SpeciesId.TOTODILE, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("kris")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("kris", SpeciesId.TOTODILE).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("cheryl", SpeciesId.TOTODILE).candyCount).toBe(0);
  });
});
