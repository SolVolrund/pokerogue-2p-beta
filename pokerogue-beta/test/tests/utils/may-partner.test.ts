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

describe("May CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("may");
  const pool = [SpeciesId.TREECKO, SpeciesId.TORCHIC, SpeciesId.MUDKIP];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "may");
    game.scene.setComputerPartnerKey(2, "kris");
  });

  it("requires the Gen 3 achievement and saves her progression separately", () => {
    game.scene.gameData.achvUnlocks.MONO_GEN_TWO_VICTORY = 1;
    game.scene.gameData.unlockComputerPartner("may");
    expect(game.scene.gameData.isComputerPartnerUnlocked("may")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_GEN_THREE_VICTORY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("may", SpeciesId.MUDKIP, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("may")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("may", SpeciesId.MUDKIP).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("kris", SpeciesId.MUDKIP).candyCount).toBe(0);
  });

  it("starts with all three Hoenn starters and one seeded random Ace", () => {
    const aces = new Set<SpeciesId>();
    for (let roll = 0; roll < 24; roll++) {
      const seed = `may-ace-${roll}`;
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

  it("joins with one protected Ace and preserves that choice through saves", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    game.scene.getPlayerParty(0).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 5));
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await inviteComputerPartnerToRun("may");
    const party = game.scene.getPlayerParty(1);
    expect(new Set(party.map(p => p.species.speciesId))).toEqual(new Set(pool));
    expect(party.map(p => p.computerPartnerAce)).toEqual([true, false, false]);
    const restored = party.map(p => new PokemonData(JSON.parse(JSON.stringify(new PokemonData(p)))).toPokemon());
    expect(restored.map(p => p.isPlayer() && p.computerPartnerAce)).toEqual([true, false, false]);
    const scores = getComputerPartnerReplacementScores(profile, party, getPokemonSpecies(SpeciesId.RAYQUAZA), 3);
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.every(s => s.replacedPokemonIndex !== 0)).toBe(true);
  });

  it("keeps recruitment, battle legality, and evolutions within Gen 3", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.RALTS), 1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.GALLADE), 1)).toBe(false);
    const kirlia = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.KIRLIA), 50);
    game.scene.getPlayerParty(1).push(kirlia);
    game.scene.setActivePlayerIndex(2);
    expect(kirlia.isAllowedInBattle()).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(kirlia, SpeciesId.GARDEVOIR)).toBe(true);
    expect(game.scene.isComputerPartnerEvolutionAllowed(kirlia, SpeciesId.GALLADE)).toBe(false);
    kirlia.fusionSpecies = getPokemonSpecies(SpeciesId.RALTS);
    expect(isComputerPartnerCandidateAllowed(profile, kirlia, 1)).toBe(true);
    kirlia.fusionSpecies = getPokemonSpecies(SpeciesId.CHARMANDER);
    expect(isComputerPartnerCandidateAllowed(profile, kirlia, 1)).toBe(false);
    expect(kirlia.isAllowedInBattle()).toBe(false);
    expect(getChallengesForPlayer(1).filter(c => c.value)).toHaveLength(0);
  });

  it.each([0, 1, 2] as const)("uses the supplied sprites and Bio/Kyledove credit in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "may");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.MAY);
    expect(getPlayerTrainerSpriteFrontTextureKey(PlayerTrainerSprite.MAY)).toBe("may");
    expect(getPlayerTrainerSpriteBackTextureKey(PlayerTrainerSprite.MAY, true)).toBe("may_back_pb");
    expect(getPlayerTrainerSpriteOption(PlayerTrainerSprite.MAY).artist).toBe("Bio/Kyledove");
  });

  it("fits the converted front sprite into a centered, bottom-aligned 80x80 frame", () => {
    const atlas = JSON.parse(readFileSync("assets/images/trainer/may.json", "utf8"));
    const png = readFileSync("assets/images/trainer/may.png");
    expect(atlas.textures[0].size).toEqual({ w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
    const frame = atlas.textures[0].frames[0];
    expect(frame.sourceSize).toEqual({ w: 80, h: 80 });
    expect(frame.spriteSourceSize).toEqual({ x: 25, y: 14, w: 29, h: 66 });
    expect(frame.spriteSourceSize.y + frame.spriteSourceSize.h).toBe(frame.sourceSize.h);
  });
});
