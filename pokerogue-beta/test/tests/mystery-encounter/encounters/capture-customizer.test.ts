import { Battle } from "#app/battle";
import { KURT_OFFER_POOL, designBagFrame, designBattleFrame } from "#data/ball-design";
import { modifierTypes } from "#data/data-lists";
import { Gender } from "#data/gender";
import { Status } from "#data/status-effect";
import { getPokeballAtlasKey, getPokeballCatchMultiplier, getPokeballCatchRate, getPokeballDescription } from "#data/pokeball";
import { BattleType } from "#enums/battle-type";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { TimeOfDay } from "#enums/time-of-day";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { TrainerSlot } from "#enums/trainer-slot";
import { PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { PokemonData } from "#system/pokemon-data";
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
      expect(getPokeballDescription(base, design)).toContain("Catch Rate:");
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

  it("restores only a Heal Ball recruit's HP, status and spent PP, once at capture", () => {
    const scene = game.scene;
    scene.getPlayerState(1).ballDesign = "heal";
    function catchIn(ball: PokeballType, owner: 0 | 1) {
      const wild = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE);
      wild.hp = 1;
      wild.status = new Status(StatusEffect.POISON);
      wild.moveset = [new PokemonMove(MoveId.SPLASH, 4, 1), new PokemonMove(MoveId.TACKLE, 7)];
      return wild.addToParty(ball, -1, owner)!;
    }
    const healed = catchIn(base, 1);
    expect(healed.hp).toBe(healed.getMaxHp());
    expect(healed.status).toBeNull();
    expect(healed.getMoveset().map(m => [m.ppUsed, m.ppUp])).toEqual([[0, 1], [0, 0]]);
    for (const other of [catchIn(base, 0), catchIn(PokeballType.GREAT_BALL, 1)]) {
      expect(other.hp).toBe(1);
      expect(other.status?.effect).toBe(StatusEffect.POISON);
      expect(other.getMoveset()[1].ppUsed).toBe(7);
    }
    healed.hp = 1;
    healed.status = new Status(StatusEffect.BURN);
    healed.getMoveset()[0].ppUsed = 2;
    const restored = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(healed)))).toPokemon();
    expect(restored.ballDesign).toBe("heal");
    expect(restored.hp).toBe(1);
    expect(restored.status?.effect).toBe(StatusEffect.BURN);
    expect(restored.getMoveset()[0].ppUsed).toBe(2);
  });

  it("applies Luxury's +1 before Soothe Bell only on positive gains for that individual", () => {
    const scene = game.scene;
    scene.getPlayerState(1).ballDesign = "luxury";
    const caught = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE)
      .addToParty(base, -1, 1)!;
    const plain = scene.getPlayerParty(1)[0];
    plain.friendship = caught.friendship = 50;
    plain.addFriendship(3);
    scene.getPlayerState(1).ballDesign = "premier";
    caught.addFriendship(3);
    expect([plain.friendship, caught.friendship]).toEqual([53, 54]);
    const bell = modifierTypes.SOOTHE_BELL().newModifier(caught);
    expect(scene.addModifier(bell, true, false, false, true, undefined, 1)).toBe(true);
    caught.addFriendship(3);
    expect(caught.friendship).toBe(60);
    caught.addFriendship(0);
    caught.addFriendship(-5);
    expect(caught.friendship).toBe(55);
  });

  it("restores permanent moves for Heal, but sets starting friendship without a gain for Friend", () => {
    const scene = game.scene;
    const catchWith = (design: "heal" | "friend") => {
      scene.getPlayerState(2).ballDesign = design;
      const wild = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.DITTO), 20, TrainerSlot.NONE);
      wild.friendship = 57;
      wild.moveset = [new PokemonMove(MoveId.TRANSFORM, 4)];
      wild.summonData.moveset = [new PokemonMove(MoveId.TACKLE, 1)];
      return wild.addToParty(base, -1, 2)!;
    };
    expect(catchWith("heal").moveset[0].ppUsed).toBe(0);
    const gain = vi.spyOn(PlayerPokemon.prototype, "addFriendship");
    const friend = catchWith("friend");
    expect(friend.moveset[0].ppUsed).toBe(4);
    expect(friend.friendship).toBe(200);
    expect(gain).not.toHaveBeenCalled();
  });

  it("checks the arena and any player's active Lure, not the target's species or the active player's ball", () => {
    const scene = game.scene;
    const target = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20, TrainerSlot.NONE);
    const owner = scene.getPlayerState(1);
    const rate = () => getPokeballCatchMultiplier(base, target, 1);
    owner.ballDesign = "dusk";
    for (const biome of [BiomeId.ABYSS, BiomeId.CAVE, BiomeId.FAIRY_CAVE, BiomeId.ICE_CAVE, BiomeId.PLAINS]) {
      scene.newArena(biome);
      vi.spyOn(scene.arena, "getTimeOfDay").mockReturnValue(TimeOfDay.DAY);
      expect(rate()).toBe(biome === BiomeId.PLAINS ? 1 : 3);
    }
    vi.mocked(scene.arena.getTimeOfDay).mockReturnValue(TimeOfDay.NIGHT);
    expect(rate()).toBe(3);
    expect(getPokeballCatchMultiplier(base, target, 0)).toBe(1);
    expect(getPokeballCatchMultiplier(PokeballType.GREAT_BALL, target, 1)).toBe(1.5);
    owner.ballDesign = "dive";
    for (const biome of [BiomeId.LAKE, BiomeId.SEABED, BiomeId.SEA, BiomeId.BEACH]) {
      scene.newArena(biome);
      expect(rate()).toBe(biome === BiomeId.BEACH ? 1 : 3.5);
    }
    owner.ballDesign = "lure";
    expect(rate()).toBe(1);
    scene.addModifier(modifierTypes.SUPER_LURE().newModifier(), true, false, false, true, undefined, 2);
    expect(rate()).toBe(4);
  });

  it("applies species, type, sleep, and per-owner Pokédex bonuses only when eligible", () => {
    const scene = game.scene;
    const wild = (id: SpeciesId) => scene.addEnemyPokemon(getPokemonSpecies(id), 20, TrainerSlot.NONE);
    const target = wild(SpeciesId.MAGIKARP);
    const owner = scene.getPlayerState(1);
    const rate = (p = target) => getPokeballCatchMultiplier(base, p, 1);
    owner.ballDesign = "moon";
    expect(rate(wild(SpeciesId.CLEFFA))).toBe(4);
    expect(rate(wild(SpeciesId.CLEFABLE))).toBe(4);
    expect(rate()).toBe(1);
    owner.ballDesign = "beast";
    expect(rate(wild(SpeciesId.NIHILEGO))).toBe(5);
    expect(rate(wild(SpeciesId.NECROZMA))).toBe(0.1);
    owner.ballDesign = "net";
    expect(rate()).toBe(3.5);
    expect(rate(wild(SpeciesId.CATERPIE))).toBe(3.5);
    expect(rate(wild(SpeciesId.EEVEE))).toBe(1);
    owner.ballDesign = "dream";
    expect(rate()).toBe(1);
    target.status = new Status(StatusEffect.SLEEP);
    expect(rate()).toBe(4);
    target.status = null;
    vi.spyOn(target, "hasAbility").mockImplementation(id => id === AbilityId.COMATOSE);
    expect(rate()).toBe(4);
    owner.ballDesign = "repeat";
    scene.getPlayerGameData(0).dexData[SpeciesId.MAGIKARP].caughtAttr = 1n;
    scene.getPlayerGameData(1).dexData[SpeciesId.MAGIKARP].caughtAttr = 0n;
    expect(rate()).toBe(1);
    scene.getPlayerGameData(1).dexData[SpeciesId.MAGIKARP].caughtAttr = 1n;
    expect(rate()).toBe(3.5);
    vi.spyOn(scene, "isComputerPartnerPlayer").mockImplementation(p => p === 1);
    expect(rate()).toBe(1);
  });

  it("uses encounter turns for Quick and Timer and target level for Nest", () => {
    const scene = game.scene;
    const target = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.EEVEE), 1, TrainerSlot.NONE);
    const rate = () => getPokeballCatchRate(base, target, 2).pokeballMultiplier;
    for (const [turn, quick, timer] of [[1, 5, 1], [2, 1, 1.3], [10, 1, 3.7], [11, 1, 4], [20, 1, 4]]) {
      scene.currentBattle.turn = turn;
      scene.getPlayerState(2).ballDesign = "quick";
      expect(rate()).toBe(quick);
      scene.getPlayerState(2).ballDesign = "timer";
      expect(rate()).toBeCloseTo(timer);
    }
    scene.getPlayerState(2).ballDesign = "nest";
    for (const [level, expected] of [[1, 4], [20, 2.1], [29, 1.2], [30, 1], [100, 1]]) {
      target.level = level;
      expect(rate()).toBe(expected);
    }
  });

  it("compares the actual acting Pokémon, not another active or the owner's party lead", () => {
    const scene = game.scene;
    const target = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20, TrainerSlot.NONE);
    const lead = scene.getPlayerParty(1)[0];
    const actor = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 80);
    scene.getPlayerParty(1).push(actor);
    const rate = (thrower?: Pokemon) => getPokeballCatchRate(base, target, 1, thrower).pokeballMultiplier;
    scene.getPlayerState(1).ballDesign = "level";
    expect(rate()).toBe(1);
    expect(rate(lead)).toBe(1);
    for (const [level, mult] of [[21, 2], [39, 2], [40, 4], [79, 4], [80, 8]]) {
      actor.level = level;
      expect(rate(actor)).toBe(mult);
    }
    scene.getPlayerState(1).ballDesign = "love";
    lead.gender = target.gender = Gender.FEMALE;
    actor.gender = Gender.MALE;
    expect(rate()).toBe(1);
    expect(rate(actor)).toBe(8);
    expect(rate(lead)).toBe(1);
    const other = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.VAPOREON), 80);
    other.gender = Gender.MALE;
    expect(rate(other)).toBe(1);
    actor.gender = Gender.GENDERLESS;
    expect(rate(actor)).toBe(1);
  });

  it("uses base Speed for Fast and applies Heavy's flat adjustment before HP scaling", () => {
    const scene = game.scene;
    const wild = (id: SpeciesId) => scene.addEnemyPokemon(getPokemonSpecies(id), 20, TrainerSlot.NONE);
    scene.getPlayerState(1).ballDesign = "fast";
    expect(getPokeballCatchRate(base, wild(SpeciesId.CHARIZARD), 1).pokeballMultiplier).toBe(4);
    expect(getPokeballCatchRate(base, wild(SpeciesId.VENUSAUR), 1).pokeballMultiplier).toBe(1);
    scene.getPlayerState(1).ballDesign = "heavy";
    for (const [id, delta] of [[SpeciesId.CHARIZARD, -20], [SpeciesId.VENUSAUR, 0],
      [SpeciesId.REGISTEEL, 20], [SpeciesId.GOLEM, 30], [SpeciesId.MEW, -20]] as const) {
      const target = wild(id);
      const adjusted = Math.max(1, target.species.catchRate + delta);
      const rate = getPokeballCatchRate(base, target, 1);
      expect(rate.catchRate).toBe(adjusted);
      expect(rate.modifiedCatchRate).toBe(Math.max(1, Math.round(adjusted / 3)));
      expect(getPokeballCatchRate(PokeballType.GREAT_BALL, target, 1).catchRate).toBe(target.species.catchRate);
    }
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
