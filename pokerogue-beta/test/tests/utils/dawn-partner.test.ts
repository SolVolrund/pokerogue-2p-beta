import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  PlayerTrainerSprite,
} from "#enums/player-trainer-sprite";
import { SpeciesId } from "#enums/species-id";
import { GameData } from "#system/game-data";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  getComputerPartnerReplacementScores,
  isComputerPartnerCandidateAllowed,
  isComputerPartnerStarterAce,
} from "#utils/computer-partner-profile";
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Gen 4 Dawn CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("dawn");
  const pool = [SpeciesId.TURTWIG, SpeciesId.CHIMCHAR, SpeciesId.PIPLUP];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "dawn");
    game.scene.setComputerPartnerKey(2, "dawn_zorua");
  });

  it("requires the Gen 4 achievement and saves progress separately from Dawn?", () => {
    game.scene.gameData.achvUnlocks.MONO_GEN_THREE_VICTORY = 1;
    game.scene.gameData.computerPartnerUnlocks.dawn_zorua = 1;
    game.scene.gameData.unlockComputerPartner("dawn");
    expect(game.scene.gameData.isComputerPartnerUnlocked("dawn")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_FOUR_VICTORY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("dawn", SpeciesId.PIPLUP, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("dawn")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("dawn", SpeciesId.PIPLUP).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("dawn_zorua", SpeciesId.PIPLUP).candyCount).toBe(0);
  });

  it("starts with all three Sinnoh starters and one seeded random Ace", () => {
    const aces = new Set<SpeciesId>();
    for (let roll = 0; roll < 24; roll++) {
      const seed = `dawn-ace-${roll}`;
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

  it("joins with one protected Ace and retains that choice through saves", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    game.scene.getPlayerParty(0).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5));
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await inviteComputerPartnerToRun("dawn");
    const party = game.scene.getPlayerParty(1);
    expect(new Set(party.map(p => p.species.speciesId))).toEqual(new Set(pool));
    expect(party.map(p => p.computerPartnerAce)).toEqual([true, false, false]);
    const restored = party.map(p => new PokemonData(JSON.parse(JSON.stringify(new PokemonData(p)))).toPokemon());
    expect(restored.map(p => p.isPlayer() && p.computerPartnerAce)).toEqual([true, false, false]);
    const scores = getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.GARCHOMP), 3);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every(s => s.replacedPokemonIndex !== 0)).toBe(true);
  });

  it("limits recruits and battle eligibility to Gen 4 without restricting Dawn?", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.LUCARIO), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.ZORUA), 1)).toBe(false);
    const piplup = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIPLUP), 20);
    game.scene.getPlayerParty(1).push(piplup);
    const zorua = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.ZORUA), 20);
    game.scene.getPlayerParty(2).push(zorua);
    expect(piplup.isAllowedInBattle()).toBe(true);
    expect(zorua.isAllowedInBattle()).toBe(true);
    piplup.fusionSpecies = getPokemonSpecies(SpeciesId.ZORUA);
    expect(piplup.isAllowedInBattle()).toBe(false);
    expect(isComputerPartnerCandidateAllowed(profile, piplup, 1)).toBe(false);
  });

  it.each([0, 1, 2] as const)("uses Diamond/Pearl Dawn in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "dawn");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.DAWN_DP);
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.DAWN_DP)).toBe("dawn_dp");
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.DAWN_DP, true)).toBe("dawn_dp_back_pb");
    expect(getComputerPartnerProfile("dawn_zorua").trainerSprite).toBe(PlayerTrainerSprite.DAWN_ZORUA);
  });
});
