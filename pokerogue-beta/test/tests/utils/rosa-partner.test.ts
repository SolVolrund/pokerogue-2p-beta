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
  isComputerPartnerStarterAce,
} from "#utils/computer-partner-profile";
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Rosa CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("rosa");
  const pool = [SpeciesId.SNIVY, SpeciesId.TEPIG, SpeciesId.OSHAWOTT];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "rosa");
    game.scene.setComputerPartnerKey(2, "dawn");
  });

  it("requires the Gen 5 achievement and saves her progression separately", () => {
    game.scene.gameData.achvUnlocks.MONO_GEN_FOUR_VICTORY = 1;
    game.scene.gameData.unlockComputerPartner("rosa");
    expect(game.scene.gameData.isComputerPartnerUnlocked("rosa")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_FIVE_VICTORY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("rosa", SpeciesId.OSHAWOTT, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("rosa")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("rosa", SpeciesId.OSHAWOTT).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("dawn", SpeciesId.OSHAWOTT).candyCount).toBe(0);
  });

  it("starts with all three Unova starters and one seeded random Ace", () => {
    const aces = new Set<SpeciesId>();
    for (let roll = 0; roll < 24; roll++) {
      const seed = `rosa-ace-${roll}`;
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
    await inviteComputerPartnerToRun("rosa");
    const party = game.scene.getPlayerParty(1);
    expect(new Set(party.map(p => p.species.speciesId))).toEqual(new Set(pool));
    expect(party.map(p => p.computerPartnerAce)).toEqual([true, false, false]);
    const restored = party.map(p => new PokemonData(JSON.parse(JSON.stringify(new PokemonData(p)))).toPokemon());
    expect(restored.map(p => p.isPlayer() && p.computerPartnerAce)).toEqual([true, false, false]);
    const scores = getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.HAXORUS), 3);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every(s => s.replacedPokemonIndex !== 0)).toBe(true);
  });

  it("keeps recruits, battle eligibility, and evolutions in Gen 5", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.DEWOTT), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.PIPLUP), 1)).toBe(false);
    const dewott = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.DEWOTT), 50);
    game.scene.getPlayerParty(1).push(dewott);
    game.scene.setActivePlayerIndex(2);
    expect(dewott.isAllowedInBattle()).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(dewott, SpeciesId.SAMUROTT)).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(dewott, SpeciesId.HISUI_SAMUROTT)).toBe(false);
    dewott.fusionSpecies = getPokemonSpecies(SpeciesId.TEPIG);
    expect(isComputerPartnerCandidateAllowed(profile, dewott, 1)).toBe(true);
    dewott.fusionSpecies = getPokemonSpecies(SpeciesId.PIPLUP);
    expect(isComputerPartnerCandidateAllowed(profile, dewott, 1)).toBe(false);
    expect(dewott.isAllowedInBattle()).toBe(false);
    expect(getChallengesForPlayer(1).filter(c => c.value)).toHaveLength(0);
  });

  it.each([0, 1, 2] as const)("uses Rosa's existing front and supplied back in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "rosa");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.ROSA);
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.ROSA)).toBe("rosa");
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.ROSA, true)).toBe("rosa_back_pb");
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.ROSA).artist).toBe("Ken Sugimori");
  });
});
