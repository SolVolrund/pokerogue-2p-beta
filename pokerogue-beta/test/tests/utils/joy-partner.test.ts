import type { PlayerIndex } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves } from "#data/data-lists";
import { AbilityAttr } from "#enums/ability-attr";
import { AbilityId } from "#enums/ability-id";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { Passive } from "#enums/passive";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { SpeciesId } from "#enums/species-id";
import { PokemonMove } from "#moves/pokemon-move";
import { GameData } from "#system/game-data";
import { GameManager } from "#test/framework/game-manager";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  getComputerPartnerReplacementScores,
  isComputerPartnerCandidateAllowed,
  isComputerPartnerKey,
  isComputerPartnerStarterAce,
  scorePokemonForPartnerRole,
  scorePokemonForPartnerSlot,
} from "#utils/computer-partner-profile";
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { hasSpeciesSupportPotential, isTeamSupportMove } from "#utils/computer-partner-support";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Joy CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("joy");
  const neutral = { ...profile, key: "alex" as const };
  const pool = [SpeciesId.COMFEY, SpeciesId.FLABEBE, SpeciesId.CUTIEFLY, SpeciesId.HAPPINY, SpeciesId.POLTCHAGEIST];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.setComputerPartnerKey(1, "joy");
    game.scene.setComputerPartnerKey(2, "cheryl");
  });

  function addPokemon(id: SpeciesId, owner: PlayerIndex = 1) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(id), 50);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("is immediately available, with the agreed roles and normal captures", () => {
    expect(isComputerPartnerKey("joy")).toBe(true);
    expect(game.scene.gameData.isComputerPartnerUnlocked("joy")).toBe(true);
    expect(profile.roles).toEqual(["ace", "hpBulk", "specialDefense", "speed", "special", "balanced"]);
    expect(profile.monotype).toBeUndefined();
    expect(profile.recruitment).toBeUndefined();
    expect(game.scene.canPlayerUsePokeballs(1)).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.CHARMANDER), 1)).toBe(true);
  });

  it("buys a subset of the five starters within 10 points, always keeping Comfey as Ace", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual(pool);
    for (let roll = 0; roll < 12; roll++) {
      const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
      expect(starters[0].speciesId).toBe(SpeciesId.COMFEY);
      expect(starters.length).toBeGreaterThan(1);
      expect(starters.length).toBeLessThan(pool.length);
      expect(starters.every(starter => pool.includes(starter.speciesId))).toBe(true);
      expect(starters.every(starter => !starter.passive && starter.abilityIndex === 0)).toBe(true);
      expect(
        starters.reduce((sum, starter) => sum + speciesDataRegistry.getStarterCost(starter.speciesId), 0),
      ).toBeLessThanOrEqual(10);
      expect(starters.map((starter, index) => isComputerPartnerStarterAce(profile, starter, index))).toEqual(
        starters.map((_, index) => index === 0),
      );
    }
  });

  it("can afford the whole pool after cost reductions without granting abilities or passives", () => {
    for (const id of pool) {
      game.scene.gameData.getComputerPartnerStarterProgressEntry("joy", id).valueReduction = 2;
    }
    const progress = game.scene.gameData.getComputerPartnerProgress("joy");
    const starters = createComputerPartnerStarter(profile, progress, 6, 1);
    expect(new Set(starters.map(starter => starter.speciesId))).toEqual(new Set(pool));
    expect(starters.every(starter => !starter.passive && starter.abilityIndex === 0)).toBe(true);
    expect(createComputerPartnerStarter(profile, progress, 2, 1)).toHaveLength(2);
  });

  it.each([
    [SpeciesId.COMFEY, AbilityId.TRIAGE, 1],
    [SpeciesId.FLABEBE, AbilityId.SYMBIOSIS, 2],
    [SpeciesId.CUTIEFLY, AbilityId.HONEY_GATHER, 0],
    [SpeciesId.HAPPINY, AbilityId.FRIEND_GUARD, 2],
    [SpeciesId.POLTCHAGEIST, AbilityId.HOSPITALITY, 0],
  ])("prefers the unlocked supportive ability for species %i", (id, ability, expectedIndex) => {
    game.scene.gameData.getComputerPartnerStarterProgressEntry("joy", id);
    const progress = game.scene.gameData.getComputerPartnerProgress("joy");
    const entry = progress.starterData[id]!;
    const single = { ...profile, startingStarters: [{ speciesId: id }] };
    entry.abilityAttr = AbilityAttr.ABILITY_1;
    expect(createComputerPartnerStarter(single, progress, 1, 1)[0].abilityIndex).toBe(0);
    entry.abilityAttr = AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
    entry.passiveAttr = Passive.UNLOCKED | Passive.ENABLED;
    const starter = createComputerPartnerStarter(single, progress, 1, 1)[0];
    expect(starter.abilityIndex).toBe(expectedIndex);
    expect(profile.preferredStarterAbilities?.[id]).toContain(ability);
    expect(starter.passive).toBe(true);
  });

  it("does not alter other partners' ability choices", () => {
    const entry = game.scene.gameData.getComputerPartnerStarterProgressEntry("joy", SpeciesId.COMFEY);
    entry.abilityAttr = AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_2 | AbilityAttr.ABILITY_HIDDEN;
    const starter = createComputerPartnerStarter(
      { ...neutral, preferredStarterAbilities: {}, startingStarters: [{ speciesId: SpeciesId.COMFEY }] },
      game.scene.gameData.getComputerPartnerProgress("joy"),
      1,
      1,
    )[0];
    expect(starter.abilityIndex).toBe(2);
  });

  it.each(pool)("recognizes support potential before species %i unlocks its full kit", id => {
    expect(hasSpeciesSupportPotential(getPokemonSpecies(id))).toBe(true);
  });

  it("gives one 20% role-value bonus even when several support tools qualify", () => {
    const ribombee = getPokemonSpecies(SpeciesId.RIBOMBEE);
    const difference =
      scorePokemonForPartnerSlot(profile, "speed", ribombee, [])
      - scorePokemonForPartnerSlot(neutral, "speed", ribombee, []);
    expect(difference).toBeCloseTo(scorePokemonForPartnerRole(ribombee, "speed") * 0.2);
  });

  it("values an actually learned support move without making generic TM access sufficient", () => {
    const magikarp = addPokemon(SpeciesId.MAGIKARP);
    vi.spyOn(magikarp.species, "getPassiveAbility").mockReturnValue(AbilityId.NONE);
    magikarp.moveset = [new PokemonMove(MoveId.SPLASH)];
    expect(hasSpeciesSupportPotential(magikarp.species)).toBe(false);
    const before = scorePokemonForPartnerSlot(profile, "balanced", magikarp, []);
    magikarp.moveset = [new PokemonMove(MoveId.HELPING_HAND)];
    expect(scorePokemonForPartnerSlot(profile, "balanced", magikarp, [])).toBeGreaterThan(before);
    expect(isTeamSupportMove(allMoves[MoveId.SWORDS_DANCE])).toBe(false);
  });

  it("protects the Ace and fills empty slots before replacing existing supporters", () => {
    const comfey = addPokemon(SpeciesId.COMFEY);
    comfey.computerPartnerAce = true;
    const cutiefly = addPokemon(SpeciesId.CUTIEFLY);
    const candidate = getPokemonSpecies(SpeciesId.MEWTWO);
    expect(
      getComputerPartnerReplacementScores(profile, [comfey, cutiefly], candidate, 6).every(
        score => score.replacedPokemonIndex === undefined,
      ),
    ).toBe(true);
    const scores = getComputerPartnerReplacementScores(profile, [comfey, cutiefly], candidate, 2);
    expect(scores.every(score => score.replacedPokemonIndex === 1)).toBe(true);
    expect(scores[0].currentScore).toBeGreaterThan(
      getComputerPartnerReplacementScores(neutral, [comfey, cutiefly], candidate, 2)[0].currentScore!,
    );
  });

  it.each([
    MoveId.FLORAL_HEALING,
    MoveId.HELPING_HAND,
    MoveId.AROMATHERAPY,
    MoveId.LIGHT_SCREEN,
  ])("learns useful support %i without dropping its only damaging move", id => {
    const comfey = addPokemon(SpeciesId.COMFEY);
    const current = [MoveId.MOONBLAST, MoveId.SPLASH, MoveId.CELEBRATE, MoveId.HOLD_HANDS];
    const decision = chooseComputerPartnerMoveLearningDecision(
      comfey,
      current,
      allMoves[id],
      LearnMoveType.LEARN_MOVE,
      { profile },
    );
    expect(decision.shouldLearn).toBe(true);
    expect(decision.replaceIndex).not.toBe(0);
  });

  it.each([0, 1, 2] as const)("uses her existing sprite in CPU seat %i", owner => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(owner, "joy");
    expect(game.scene.getTrainerSprite(owner)).toBe(PlayerTrainerSprite.JOY);
  });

  it("can join a running solo game using the existing recruitment flow", async () => {
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    addPokemon(SpeciesId.BULBASAUR, 0);
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
    await inviteComputerPartnerToRun("joy");
    expect(game.scene.getComputerPartnerKey(1)).toBe("joy");
    const ace = game.scene.getPlayerParty(1)[0];
    expect(ace.species.speciesId).toBe(SpeciesId.COMFEY);
    expect(ace.computerPartnerAce).toBe(true);
  });

  it("round-trips Joy's progression separately from Cheryl's", () => {
    game.scene.gameData.addComputerPartnerStarterCandy("joy", SpeciesId.HAPPINY, 5);
    const copy = GameData.fromRawSystem(game.scene.gameData.getSystemSaveDataString(), false);
    expect(copy.isComputerPartnerUnlocked("joy")).toBe(true);
    expect(copy.getComputerPartnerStarterProgressEntry("joy", SpeciesId.HAPPINY).candyCount).toBe(5);
    expect(copy.getComputerPartnerStarterProgressEntry("cheryl", SpeciesId.HAPPINY).candyCount).toBe(0);
  });
});
