import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { allMoves, modifierTypes } from "#data/data-lists";
import { GameModes } from "#enums/game-modes";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TimeOfDay } from "#enums/time-of-day";
import { Pokemon } from "#field/pokemon";
import { EvolutionItemModifierType, type ModifierTypeGenerator } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { GameData } from "#system/game-data";
import { PokemonData } from "#system/pokemon-data";
import { SettingKeys } from "#system/settings";
import { GameManager } from "#test/framework/game-manager";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  isComputerPartnerCandidateAllowed,
  isComputerPartnerStarterAce,
} from "#utils/computer-partner-profile";
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Valerie CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let originalSettings: string | null;
  const profile = getComputerPartnerProfile("valerie");
  const pool = [
    SpeciesId.EEVEE,
    SpeciesId.MAWILE,
    SpeciesId.MIME_JR,
    SpeciesId.TOGEPI,
    SpeciesId.MILCERY,
    SpeciesId.FLABEBE,
    SpeciesId.CLEFFA,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    originalSettings = localStorage.getItem("settings");
    game = new GameManager(phaserGame);
    await game.runToTitle();
    localStorage.setItem("settings", JSON.stringify({ [SettingKeys.Ace_Mechanics]: 0 }));
    Object.defineProperty(localStorage, "settings", { value: true, configurable: true });
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "valerie");
    game.scene.setComputerPartnerKey(2, "whitney");
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue(undefined);
  });

  afterEach(() => {
    Reflect.deleteProperty(localStorage, "settings");
    if (originalSettings === null) {
      localStorage.removeItem("settings");
    } else {
      localStorage.setItem("settings", originalSettings);
    }
  });

  function addPokemon(speciesId = SpeciesId.EEVEE, owner: PlayerIndex = 1, isAce = true) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), 20, 0, 0);
    pokemon.computerPartnerAce = isAce;
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  function getEeveeEvolution(target: SpeciesId) {
    return speciesDataRegistry.getEvolutions(SpeciesId.EEVEE).find(e => e.speciesId === target && e.preFormKey === "")!;
  }

  it("unlocks only after a Fairy clear, including past clears", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("valerie")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_NORMAL = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("valerie")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("valerie")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_FAIRY = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("valerie")).toBe(true);
  });

  it("uses the standard roles and a budgeted pool with Eevee, Milcery and Cleffa", () => {
    expect(profile.roles).toEqual(["ace", "special", "physical", "bulk", "speed", "balanced"]);
    expect(profile.starterSpeciesId).toBe(SpeciesId.EEVEE);
    expect(profile.starterNature).toBe(Nature.MODEST);
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.EEVEE);
      expect(starters[0].moveset).not.toContain(MoveId.BABY_DOLL_EYES);
      expect(starters.length).toBeGreaterThan(1);
      expect(starters.length).toBeLessThanOrEqual(6);
      expect(starters.every(starter => pool.includes(starter.speciesId))).toBe(true);
      expect(starters.map((starter, index) => isComputerPartnerStarterAce(profile, starter, index))).toEqual(
        starters.map((_, index) => index === 0),
      );
      expect(
        starters.reduce(
          (cost, starter) =>
            cost + speciesDataRegistry.getStarterCost(getPokemonSpecies(starter.speciesId).getRootSpeciesId(true)),
          0,
        ),
      ).toBeLessThanOrEqual(10);
    }
    expect(getPokemonSpecies(SpeciesId.EEVEE).getLevelMoves()).toContainEqual([9, MoveId.BABY_DOLL_EYES]);
  });

  it("allows Fairy recruits and eligible pre-evolutions without permitting unrelated captures", () => {
    for (const speciesId of [...pool, SpeciesId.SYLVEON, SpeciesId.RALTS]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(true);
    }
    for (const speciesId of [SpeciesId.MAGIKARP, SpeciesId.CHARMANDER]) {
      expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(speciesId), 1)).toBe(false);
    }
    expect(addPokemon().isAllowedInBattle()).toBe(true);
    expect(addPokemon(SpeciesId.EEVEE, 1, false).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.MAGIKARP, 0, false).isAllowedInBattle()).toBe(true);
  });

  it.each([0, 1, 2] as const)("uses Fairy Ace typing and Valerie's sprite in CPU slot %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "valerie");
    const eevee = addPokemon(SpeciesId.EEVEE, owner);
    expect(eevee.getTypes()).toEqual([PokemonType.NORMAL, PokemonType.FAIRY]);
    expect(eevee.isAllowedInBattle()).toBe(true);
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.VALERIE);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(owner), "setScale");
    game.scene.getPlayerTrainerBackSprite(owner);
    expect(setScale).toHaveBeenCalledWith(0.5);
    expect(getEeveeEvolution(SpeciesId.VAPOREON).validate(eevee, false, EvolutionItem.WATER_STONE)).toBe(false);
  });

  it.each([
    TimeOfDay.DAWN,
    TimeOfDay.DAY,
    TimeOfDay.DUSK,
    TimeOfDay.NIGHT,
  ])("waits for a Fairy move and friendship instead of choosing Espeon/Umbreon at time %i", time => {
    vi.spyOn(game.scene.arena, "getTimeOfDay").mockReturnValue(time);
    const eevee = addPokemon();
    eevee.friendship = 255;
    eevee.moveset = [new PokemonMove(MoveId.TACKLE)];
    expect(eevee.getEvolution()).toBeNull();
    eevee.setMove(1, MoveId.BABY_DOLL_EYES);
    eevee.friendship = 119;
    expect(eevee.getEvolution()).toBeNull();
    eevee.friendship = 120;
    expect(eevee.getEvolution()?.speciesId).toBe(SpeciesId.SYLVEON);
  });

  it.each([
    [SpeciesId.VAPOREON, EvolutionItem.WATER_STONE],
    [SpeciesId.JOLTEON, EvolutionItem.THUNDER_STONE],
    [SpeciesId.FLAREON, EvolutionItem.FIRE_STONE],
    [SpeciesId.LEAFEON, EvolutionItem.LEAF_STONE],
    [SpeciesId.GLACEON, EvolutionItem.ICE_STONE],
  ])("rejects evolution %i through item %i, including reward eligibility and direct item use", (target, item) => {
    const eevee = addPokemon();
    const evolution = getEeveeEvolution(target);
    expect(evolution.validate(eevee, false, item)).toBe(false);
    expect(evolution.isValidItemEvolution(eevee)).toBe(false);
    const stone = new EvolutionItemModifierType(item);
    expect(stone.selectFilter!(eevee)).not.toBeNull();
    expect(stone.newModifier(eevee)!.apply(eevee)).toBe(false);
    const generator = modifierTypes.EVOLUTION_ITEM() as ModifierTypeGenerator;
    expect(generator.generateType([eevee])).toBeNull();
  });

  it("does not restrict human Eevee, other partners, or Valerie's non-Ace Eevee", () => {
    vi.spyOn(game.scene.arena, "getTimeOfDay").mockReturnValue(TimeOfDay.DAY);
    for (const pokemon of [
      addPokemon(SpeciesId.EEVEE, 0),
      addPokemon(SpeciesId.EEVEE, 2),
      addPokemon(SpeciesId.EEVEE, 1, false),
    ]) {
      pokemon.friendship = 255;
      pokemon.moveset = [new PokemonMove(MoveId.TACKLE)];
      expect(pokemon.getEvolution()?.speciesId).toBe(SpeciesId.ESPEON);
      expect(getEeveeEvolution(SpeciesId.VAPOREON).validate(pokemon, false, EvolutionItem.WATER_STONE)).toBe(true);
    }
  });

  it("also restricts Partner Eevee to Sylveon", () => {
    const eevee = addPokemon();
    eevee.formIndex = 1;
    eevee.friendship = 255;
    eevee.moveset = [new PokemonMove(MoveId.TACKLE)];
    expect(eevee.getFormKey()).toBe("partner");
    expect(eevee.getEvolution()).toBeNull();
    eevee.setMove(1, MoveId.BABY_DOLL_EYES);
    expect(eevee.getEvolution()?.speciesId).toBe(SpeciesId.SYLVEON);
    const vaporeon = speciesDataRegistry
      .getEvolutions(SpeciesId.EEVEE)
      .find(e => e.speciesId === SpeciesId.VAPOREON && e.preFormKey === "partner")!;
    expect(vaporeon.validate(eevee, false, EvolutionItem.WATER_STONE)).toBe(false);
  });

  it("applies the Eevee rule to a fusion component without blocking the other species", () => {
    const pikachu = addPokemon(SpeciesId.PIKACHU);
    pikachu.fusionSpecies = getPokemonSpecies(SpeciesId.EEVEE);
    pikachu.fusionFormIndex = 0;
    pikachu.friendship = 120;
    pikachu.moveset = [new PokemonMove(MoveId.BABY_DOLL_EYES)];
    expect(getEeveeEvolution(SpeciesId.SYLVEON).validate(pikachu, true)).toBe(true);
    expect(getEeveeEvolution(SpeciesId.VAPOREON).validate(pikachu, true, EvolutionItem.WATER_STONE)).toBe(false);
    expect(getEeveeEvolution(SpeciesId.VAPOREON).isValidItemEvolution(pikachu, true)).toBe(false);
    const raichu = speciesDataRegistry.getEvolutions(SpeciesId.PIKACHU).find(e => e.speciesId === SpeciesId.RAICHU)!;
    expect(raichu.validate(pikachu, false, EvolutionItem.THUNDER_STONE)).toBe(true);
  });

  it.each([
    LearnMoveType.LEARN_MOVE,
    LearnMoveType.TM,
    LearnMoveType.MEMORY,
  ])("learns and protects Baby-Doll Eyes from source %i, then releases it after evolution", async source => {
    const eevee = addPokemon();
    const current = [MoveId.BOOMBURST, MoveId.MOONBLAST, MoveId.QUIVER_DANCE, MoveId.EARTH_POWER];
    const decision = chooseComputerPartnerMoveLearningDecision(
      eevee,
      current,
      allMoves[MoveId.BABY_DOLL_EYES],
      source,
      { profile },
    );
    expect(decision.shouldLearn).toBe(true);
    current[decision.replaceIndex] = MoveId.BABY_DOLL_EYES;
    const keep = chooseComputerPartnerMoveLearningDecision(eevee, current, allMoves[MoveId.CHARM], source, { profile });
    expect(keep.replaceIndex).not.toBe(decision.replaceIndex);
    expect(
      chooseComputerPartnerMoveLearningDecision(eevee, current, allMoves[MoveId.BABY_DOLL_EYES], source, { profile })
        .shouldLearn,
    ).toBe(false);
    await eevee.evolve(getEeveeEvolution(SpeciesId.SYLVEON), eevee.getSpeciesForm());
    expect(eevee.getAceType()).toBe(PokemonType.FAIRY);
    expect(eevee.getTypes()).toEqual([PokemonType.FAIRY]);
    expect(
      chooseComputerPartnerMoveLearningDecision(eevee, current, allMoves[MoveId.CHARM], source, { profile }),
    ).toEqual(
      chooseComputerPartnerMoveLearningDecision(eevee, current, allMoves[MoveId.CHARM], source, {
        profile: { ...profile, aceSignatureMoves: {} },
      }),
    );
  });

  it("does not force Baby-Doll Eyes onto non-Ace Eevee or other partners", () => {
    const moves = [MoveId.BOOMBURST, MoveId.MOONBLAST, MoveId.QUIVER_DANCE, MoveId.EARTH_POWER];
    const ordinary = addPokemon(SpeciesId.EEVEE, 1, false);
    const other = addPokemon(SpeciesId.EEVEE, 2);
    for (const [pokemon, partner] of [
      [ordinary, profile],
      [other, getComputerPartnerProfile("whitney")],
    ] as const) {
      expect(
        chooseComputerPartnerMoveLearningDecision(
          pokemon,
          moves,
          allMoves[MoveId.BABY_DOLL_EYES],
          LearnMoveType.LEARN_MOVE,
          { profile: partner },
        ).shouldLearn,
      ).toBe(false);
    }
  });

  it("retains the Fairy move when recruited above its learning level", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    addPokemon(SpeciesId.EEVEE, 0, false).level = 80;
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await inviteComputerPartnerToRun("valerie");
    const eevee = game.scene.getPlayerParty(1)[0];
    expect(eevee.computerPartnerAce).toBe(true);
    expect(eevee.species.speciesId).toBe(SpeciesId.EEVEE);
    expect(eevee.moveset.map(move => move.moveId)).toContain(MoveId.BABY_DOLL_EYES);
  });

  it("restores the evolution restriction and stores Valerie's progress separately", () => {
    const eevee = addPokemon();
    const restored = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(eevee)))).toPokemon();
    if (!restored.isPlayer()) {
      throw new Error("Expected a restored player Pokemon");
    }
    game.scene.getPlayerParty(1).splice(0, 1, restored);
    expect(getEeveeEvolution(SpeciesId.VAPOREON).validate(restored, false, EvolutionItem.WATER_STONE)).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_FAIRY = 1;
    game.scene.gameData.addComputerPartnerStarterCandy("valerie", SpeciesId.EEVEE, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("valerie")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("valerie", SpeciesId.EEVEE).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("whitney", SpeciesId.EEVEE).candyCount).toBe(0);
  });
});
