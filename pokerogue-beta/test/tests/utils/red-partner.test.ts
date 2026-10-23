import type { PlayerIndex } from "#app/battle-scene";
import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  getPlayerTrainerSpriteOption,
  PlayerTrainerSprite,
} from "#enums/player-trainer-sprite";
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

describe("Red CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("red");
  const pool = [SpeciesId.BULBASAUR, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "red");
    game.scene.setComputerPartnerKey(2, "kris");
  });

  function addPokemon(id: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(id), 50);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires the Gen 1 achievement and preserves his own saved progression", () => {
    expect(isComputerPartnerKey("red")).toBe(true);
    game.scene.gameData.achvUnlocks.MONO_GEN_TWO_VICTORY = 1;
    game.scene.gameData.unlockComputerPartner("red");
    expect(game.scene.gameData.isComputerPartnerUnlocked("red")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_ONE_VICTORY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("red", SpeciesId.SQUIRTLE, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("red")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("red", SpeciesId.SQUIRTLE).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("kris", SpeciesId.SQUIRTLE).candyCount).toBe(0);
  });

  it("starts with all three Kanto starters and exactly one deterministic random Ace", () => {
    const aces = new Set<SpeciesId>();
    for (let roll = 0; roll < 24; roll++) {
      const seed = `red-ace-${roll}`;
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

  it("protects only the chosen Ace and saves that choice without rerolling it", () => {
    const party = pool.map(id => addPokemon(id));
    party[2].computerPartnerAce = true;
    const restored = party.map(p => new PokemonData(JSON.parse(JSON.stringify(new PokemonData(p)))).toPokemon());
    expect(restored.map(p => p.isPlayer() && p.computerPartnerAce)).toEqual([false, false, true]);
    const scores = getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.MEWTWO), 3);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every(s => s.replacedPokemonIndex !== 2)).toBe(true);
  });

  it("restricts recruitment and evolution to Gen 1", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.EEVEE), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.UMBREON), 1)).toBe(false);
    const eevee = addPokemon(SpeciesId.EEVEE);
    expect(game.scene.isComputerPartnerEvolutionAllowed(eevee, SpeciesId.VAPOREON)).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(eevee, SpeciesId.UMBREON)).toBe(false);
    eevee.fusionSpecies = getPokemonSpecies(SpeciesId.TOTODILE);
    expect(isComputerPartnerCandidateAllowed(profile, eevee, 1)).toBe(false);
  });

  it("keeps Red and Kris's generation restrictions independent without changing the human's rules", () => {
    const redValid = addPokemon(SpeciesId.CHARMANDER);
    const redInvalid = addPokemon(SpeciesId.CYNDAQUIL);
    const krisValid = addPokemon(SpeciesId.CYNDAQUIL, 2);
    const krisInvalid = addPokemon(SpeciesId.CHARMANDER, 2);
    const human = addPokemon(SpeciesId.TREECKO, 0);
    game.scene.setActivePlayerIndex(2);
    expect([redValid, redInvalid, krisValid, krisInvalid, human].map(p => p.isAllowedInBattle())).toEqual([
      true,
      false,
      true,
      false,
      true,
    ]);
    expect(getChallengesForPlayer(1).filter(c => c.value)).toHaveLength(0);
  });

  it.each([0, 1, 2] as const)("uses the existing Red front and credited new back in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "red");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.RED);
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.RED)).toBe("red");
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.RED, true)).toBe("red_back_pb");
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.RED).artist).toContain("mid117");
  });

  it("joins a running game with all three starters and one protected Ace", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    addPokemon(SpeciesId.PIKACHU, 0);
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await inviteComputerPartnerToRun("red");
    const party = game.scene.getPlayerParty(1);
    expect(new Set(party.map(p => p.species.speciesId))).toEqual(new Set(pool));
    expect(party.map(p => p.computerPartnerAce)).toEqual([true, false, false]);
  });
});
