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
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Calem CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("calem");
  const pool = [SpeciesId.CHESPIN, SpeciesId.FENNEKIN, SpeciesId.FROAKIE];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "calem");
    game.scene.setComputerPartnerKey(2, "rosa");
  });

  it("requires the Gen 6 achievement and saves his progression separately", () => {
    game.scene.gameData.achvUnlocks.MONO_GEN_FIVE_VICTORY = 1;
    game.scene.gameData.unlockComputerPartner("calem");
    expect(game.scene.gameData.isComputerPartnerUnlocked("calem")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_SIX_VICTORY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("calem", SpeciesId.FROAKIE, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("calem")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("calem", SpeciesId.FROAKIE).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("rosa", SpeciesId.FROAKIE).candyCount).toBe(0);
  });

  it("starts with all three Kalos starters and one seeded random Ace", () => {
    const aces = new Set<SpeciesId>();
    for (let roll = 0; roll < 24; roll++) {
      const seed = `calem-ace-${roll}`;
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
    await inviteComputerPartnerToRun("calem");
    const party = game.scene.getPlayerParty(1);
    expect(new Set(party.map(p => p.species.speciesId))).toEqual(new Set(pool));
    expect(party.map(p => p.computerPartnerAce)).toEqual([true, false, false]);
    const restored = party.map(p => new PokemonData(JSON.parse(JSON.stringify(new PokemonData(p)))).toPokemon());
    expect(restored.map(p => p.isPlayer() && p.computerPartnerAce)).toEqual([true, false, false]);
    const scores = getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.GOODRA), 3);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every(s => s.replacedPokemonIndex !== 0)).toBe(true);
  });

  it("keeps recruits, battle eligibility, and evolutions within Gen 6", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.SLIGGOO), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.DEWOTT), 1)).toBe(false);
    const sliggoo = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.SLIGGOO), 50);
    game.scene.getPlayerParty(1).push(sliggoo);
    game.scene.setActivePlayerIndex(2);
    expect(sliggoo.isAllowedInBattle()).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(sliggoo, SpeciesId.GOODRA)).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(sliggoo, SpeciesId.HISUI_GOODRA)).toBe(false);
    sliggoo.fusionSpecies = getPokemonSpecies(SpeciesId.FROAKIE);
    expect(isComputerPartnerCandidateAllowed(profile, sliggoo, 1)).toBe(true);
    sliggoo.fusionSpecies = getPokemonSpecies(SpeciesId.OSHAWOTT);
    expect(isComputerPartnerCandidateAllowed(profile, sliggoo, 1)).toBe(false);
    expect(sliggoo.isAllowedInBattle()).toBe(false);
    expect(getChallengesForPlayer(1).filter(c => c.value)).toHaveLength(0);
  });

  it.each([0, 1, 2] as const)("uses Calem's supplied sprites and credits in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "calem");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.CALEM);
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.CALEM)).toBe("calem");
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.CALEM, true)).toBe("calem_back_pb");
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.CALEM).artist).toBe("Ken Sugimori/Kyledove");
  });

  it("centers and bottom-aligns the converted front sprite within an 80x80 frame", () => {
    const atlas = JSON.parse(readFileSync("assets/images/trainer/calem.json", "utf8"));
    const png = readFileSync("assets/images/trainer/calem.png");
    expect(atlas.textures[0].size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
    const frame = atlas.textures[0].frames[0];
    expect(frame.sourceSize).toEqual({ w: 80, h: 80 });
    expect(frame.spriteSourceSize).toEqual({ x: 24, y: 10, w: 31, h: 70 });
    expect(frame.spriteSourceSize.y + frame.spriteSourceSize.h).toBe(frame.sourceSize.h);
  });
});
