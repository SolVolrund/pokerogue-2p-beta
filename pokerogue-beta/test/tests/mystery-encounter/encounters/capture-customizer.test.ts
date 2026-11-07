import { Battle } from "#app/battle";
import { KURT_OFFER_POOL, designBagFrame, designBattleFrame } from "#data/ball-design";
import { getPokeballAtlasKey, getPokeballCatchMultiplier, getPokeballDescription } from "#data/pokeball";
import { BattleType } from "#enums/battle-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import { CaptureCustomizerEncounter } from "#mystery-encounters/capture-customizer-encounter";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as Phases from "#mystery-encounters/encounter-phase-utils";
import * as Menus from "#mystery-encounters/encounter-player-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { readFileSync } from "node:fs";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const base = PokeballType.POKEBALL;
describe("Capture Customizer", () => {
  let phaser: Phaser.Game;
  let game: GameManager;
  let encounter: MysteryEncounter;
  beforeAll(() => {
    phaser = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaser);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 23,
      battleType: BattleType.WILD,
      double: true,
    });
    for (const owner of game.scene.getActivePlayerIndexes()) {
      game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20));
    }
    encounter = game.scene.currentBattle.mysteryEncounter = new MysteryEncounter(CaptureCustomizerEncounter);
    encounter.onInit!();
    vi.spyOn(Dialogue, "showEncounterText").mockResolvedValue();
    vi.spyOn(Dialogue, "showEncounterDialogue").mockResolvedValue();
    vi.spyOn(Phases, "leaveEncounterWithoutBattle").mockImplementation(() => {});
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  it("offers three different designs once per run and has art and descriptions for every candidate", () => {
    expect(encounter.maxAllowedEncounters).toBe(1);
    expect(new Set(encounter.misc.offers).size).toBe(3);
    expect(encounter.options).toHaveLength(4);
    const frames = (path: string): Set<string> =>
      new Set(
        JSON.parse(readFileSync(path, "utf8")).textures.flatMap((p: { frames: { filename: string }[] }) =>
          p.frames.map(f => f.filename),
        ),
      );
    const throws = frames("assets/images/pb.json");
    const icons = frames("assets/images/items/kurt/kurt_ball_icons.json");
    for (const [index, design] of encounter.misc.offers.entries()) {
      expect(encounter.options[index].dialogue?.buttonIcon?.()).toEqual({ texture: "pb", frame: designBattleFrame(design) });
    }
    expect(encounter.options[3].dialogue?.buttonIcon).toBeUndefined();
    for (const design of KURT_OFFER_POOL) {
      expect(icons.has(designBagFrame(design))).toBe(true);
      for (const suffix of ["", "_opening", "_open"]) expect(throws.has(designBattleFrame(design) + suffix)).toBe(true);
      expect(getPokeballDescription(base, design)).toContain("Catch Rate: 1x");
    }
  });

  it("keeps a solo player's design on newly caught Pokémon without painting older catches", async () => {
    game.scene.twoPlayerMode = false;
    const counts = game.scene.getPlayerPokeballCounts();
    counts[base] = 4;
    expect(await encounter.options[1].onPreOptionPhase!()).toBe(true);
    await encounter.options[1].onOptionPhase();
    expect(counts[base]).toBe(14);
    const design = encounter.misc.offers[1];
    const caught = game.scene
      .addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE)
      .addToParty(base)!;
    expect(caught.pokeball).toBe(base);
    expect(caught.ballDesign).toBe(design);
    const saved = game.scene.gameData.getSessionSaveData();
    expect(saved.ballDesign).toBe(design);
    const snapshot = JSON.stringify(saved, (_k, v) => (typeof v === "bigint" ? String(v) : v));
    await game.scene.gameData.loadSessionSnapshot(snapshot);
    expect(game.scene.getPlayerState().ballDesign).toBe(design);
    expect(game.scene.getPlayerParty().find(p => p.id === caught.id)?.ballDesign).toBe(design);
    delete saved.ballDesign;
    await game.scene.gameData.loadSessionSnapshot(
      JSON.stringify(saved, (_k, v) => (typeof v === "bigint" ? String(v) : v)),
    );
    expect(game.scene.getPlayerState().ballDesign).toBeUndefined();
  });

  it("automates CPU choices without granting regular balls to a restricted partner", async () => {
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(p => p === 1 || p === 2);
    vi.spyOn(game.scene, "canPlayerReceivePokeballRewards").mockImplementation(p => p !== 2);
    const before = game.scene.getPlayerPokeballCounts(1)[base];
    const restricted = game.scene.getPlayerPokeballCounts(2)[base];
    expect(await encounter.options[3].onPreOptionPhase!()).toBe(true);
    await encounter.options[3].onOptionPhase();
    expect(game.scene.getPlayerState(0).ballDesign).toBeUndefined();
    expect(game.scene.getPlayerState(1).ballDesign).toBe(encounter.misc.offers[1]);
    expect(game.scene.getPlayerPokeballCounts(1)[base]).toBe(before + 10);
    expect(game.scene.getPlayerPokeballCounts(2)[base]).toBe(restricted);
    expect(game.scene.getPlayerState(2).ballDesign).toBeUndefined();
  });

  it("resolves three choices individually, caps the gift, and restores each owner's skin and stock", async () => {
    const menu = vi.spyOn(Menus, "showMysteryEncounterPlayerMenu").mockResolvedValue(undefined);
    game.scene.getPlayerPokeballCounts(0)[base] = 0;
    game.scene.getPlayerPokeballCounts(1)[base] = 96;
    game.scene.getPlayerPokeballCounts(2)[base] = 12;
    const ultra = game.scene.getPlayerPokeballCounts(0)[PokeballType.ULTRA_BALL];
    expect(await encounter.options[0].onPreOptionPhase!()).toBe(false);
    expect(await menu.mock.calls[0][0].overrideOptions![2].onPreOptionPhase!()).toBe(false);
    expect(await menu.mock.calls[1][0].overrideOptions![3].onPreOptionPhase!()).toBe(true);
    await encounter.options[3].onOptionPhase();
    await encounter.options[3].onOptionPhase();
    const owners = game.scene.getActivePlayerIndexes();
    const expected = [encounter.misc.offers[0], encounter.misc.offers[2], undefined];
    expect(owners.map(p => game.scene.getPlayerState(p).ballDesign)).toEqual(expected);
    expect(owners.map(p => game.scene.getPlayerPokeballCounts(p)[base])).toEqual([10, 99, 12]);
    expect(game.scene.getPlayerPokeballCounts(0)[PokeballType.ULTRA_BALL]).toBe(ultra);
    expect(getPokeballAtlasKey(PokeballType.ULTRA_BALL, expected[0])).toBe("ub");
    expect(getPokeballCatchMultiplier(base)).toBe(1);
    const saved = JSON.stringify(game.scene.gameData.getSessionSaveData(), (_k, v) =>
      typeof v === "bigint" ? String(v) : v,
    );
    owners.forEach(p => {
      game.scene.getPlayerState(p).ballDesign = "beast";
    });
    await game.scene.gameData.loadSessionSnapshot(saved);
    expect(owners.map(p => game.scene.getPlayerState(p).ballDesign)).toEqual(expected);
    expect(owners.map(p => game.scene.getPlayerPokeballCounts(p)[base])).toEqual([10, 99, 12]);
  });
});
