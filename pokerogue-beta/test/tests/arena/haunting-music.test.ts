import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { audioManager } from "#app/global-audio-manager";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Arena } from "#field/arena";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { MusicPreference } from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { readdirSync, readFileSync, statSync } from "node:fs";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Haunting battle music", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 52,
      battleType: BattleType.WILD,
      double: false,
    });
    game.scene.arena = new Arena(BiomeId.TOWN);
  });

  function enemy(speciesId = SpeciesId.GASTLY) {
    const pokemon = game.scene.addEnemyPokemon(getPokemonSpecies(speciesId), 50, TrainerSlot.NONE);
    game.scene.currentBattle.enemyParty.push(pokemon);
    return pokemon;
  }

  it.each([BattleType.WILD, BattleType.TRAINER])("overrides battle type %i throughout Pokemon Tower", battleType => {
    game.scene.arena = new Arena(BiomeId.POKEMON_TOWER);
    game.scene.currentBattle.battleType = battleType;
    if (battleType === BattleType.TRAINER) {
      game.scene.currentBattle.trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    }
    enemy(SpeciesId.GIRATINA);
    expect(game.scene.arena.bgm).toBe("Haunting");
    expect(game.scene.arena.bgmLoopPoint).toBe(0);
    expect(game.scene.currentBattle.getBgmOverride()).toBe("Haunting");
  });

  it.each([
    MusicPreference.GENFIVE,
    MusicPreference.ALLGENS,
  ])("overrides haunted trainers' intro and battle music with preference %i", preference => {
    game.scene.musicPreference = preference;
    const trainer = new Trainer(TrainerType.YOUNGSTER, TrainerVariant.DEFAULT);
    trainer.haunted = true;
    vi.spyOn(trainer, "getEncounterMessages").mockReturnValue(["A haunted encounter!"]);
    game.scene.currentBattle.battleType = BattleType.TRAINER;
    game.scene.currentBattle.trainer = trainer;
    expect(game.scene.currentBattle.getBgmOverride()).toBe("Haunting");
    game.scene.currentBattle.started = true;
    expect(game.scene.currentBattle.getBgmOverride()).toBe("Haunting");
    trainer.haunted = false;
    expect(game.scene.currentBattle.getBgmOverride()).toBe(
      preference === MusicPreference.GENFIVE ? trainer.getBattleBgm() : trainer.getMixedBattleBgm(),
    );
  });

  it.each([
    SpeciesId.GASTLY,
    SpeciesId.GIRATINA,
  ])("uses Haunting for haunted wild species %i outside the tower", speciesId => {
    enemy(speciesId).haunted = true;
    expect(game.scene.currentBattle.getBgmOverride()).toBe("Haunting");
  });

  it("does not replace ordinary Ghost encounters or react to the player's own haunted Pokemon", () => {
    enemy();
    const player = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50);
    player.haunted = true;
    game.scene.getPlayerParty().push(player);
    expect(game.scene.currentBattle.getBgmOverride()).toBeNull();
  });

  it("returns to the next biome's usual music after leaving the tower", () => {
    game.scene.arena = new Arena(BiomeId.POKEMON_TOWER);
    expect(game.scene.currentBattle.getBgmOverride()).toBe("Haunting");
    game.scene.arena = new Arena(BiomeId.RUINS);
    expect(game.scene.currentBattle.getBgmOverride()).toBeNull();
    expect(game.scene.arena.bgm).not.toBe("Haunting");
  });

  it("leaves scripted mystery-encounter music in control outside battles", () => {
    enemy().haunted = true;
    game.scene.currentBattle.battleType = BattleType.MYSTERY_ENCOUNTER;
    game.scene.currentBattle.mysteryEncounter = { encounterMode: MysteryEncounterMode.DEFAULT } as never;
    expect(game.scene.currentBattle.getBgmOverride()).toBeNull();
  });

  it("uses the supplied file's exact case, credits Sam, and loops from the beginning", () => {
    expect(readdirSync("assets/audio/bgm")).toContain("Haunting.mp3");
    expect(statSync("assets/audio/bgm/Haunting.mp3").size).toBeGreaterThan(0);
    expect(game.scene.ui.bgmBar.getRealBgmName("Haunting")).toBe("Sam - Haunting");
    const loopPoints = JSON.parse(readFileSync("assets/biome-bgm-loop-points.json", "utf8"));
    expect(loopPoints.Haunting).toBe(0);
    expect(audioManager["getBgmLoopPoint"]("Haunting")).toBe(0);
  });
});
