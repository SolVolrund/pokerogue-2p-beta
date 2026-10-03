import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves } from "#data/data-lists";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { checkStarterValidForChallenge, getChallengesForPlayer } from "#utils/challenge-utils";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  getComputerPartnerReplacementScores,
  isComputerPartnerCandidateAllowed,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Whitney CPU partner", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const profile = getComputerPartnerProfile("whitney");
  const signature = [MoveId.MILK_DRINK, MoveId.ROLLOUT, MoveId.DEFENSE_CURL];
  const props = { shiny: false, female: false, variant: 0 as const, formIndex: 0 };

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.setComputerPartnerKey(1, "whitney");
  });

  function addPokemon(speciesId: SpeciesId, owner: PlayerIndex = 1, level = 100) {
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(speciesId), level);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  it("requires the Normal challenge clear, including achievements in existing saves", () => {
    expect(game.scene.gameData.isComputerPartnerUnlocked("whitney")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_FIRE = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("whitney")).toBe(false);
    expect(game.scene.gameData.unlockComputerPartner("whitney")).toBe(false);
    game.scene.gameData.achvUnlocks.MONO_NORMAL = 1;
    expect(game.scene.gameData.isComputerPartnerUnlocked("whitney")).toBe(true);
  });

  it("keeps all 18 requested species and guarantees Miltank within the normal budget", () => {
    expect(profile.startingStarters?.map(starter => starter.speciesId)).toEqual([
      SpeciesId.MILTANK, SpeciesId.LICKITUNG, SpeciesId.GIRAFARIG, SpeciesId.BIDOOF,
      SpeciesId.SKITTY, SpeciesId.IGGLYBUFF, SpeciesId.AIPOM, SpeciesId.TEDDIURSA,
      SpeciesId.TAUROS, SpeciesId.BUNEARY, SpeciesId.HAPPINY, SpeciesId.CINCCINO,
      SpeciesId.WATCHOG, SpeciesId.DODRIO, SpeciesId.STANTLER, SpeciesId.MEOWTH,
      SpeciesId.DEERLING, SpeciesId.DITTO,
    ]);
    const starters = createComputerPartnerStarter(profile, undefined, 6, 1);
    expect(starters[0].speciesId).toBe(SpeciesId.MILTANK);
    expect(starters.length).toBeGreaterThan(1);
    expect(starters.length).toBeLessThanOrEqual(6);
    const cost = starters.reduce((sum, starter) => sum + speciesDataRegistry.getStarterCost(
      getPokemonSpecies(starter.speciesId).getRootSpeciesId(true),
    ), 0);
    expect(cost).toBeLessThanOrEqual(10);
    const startingMoves = getPokemonSpecies(SpeciesId.MILTANK).getLevelMoves()
      .filter(([level]) => level > 0 && level <= 5).map(([, move]) => move);
    expect(starters[0].moveset?.every(move => startingMoves.includes(move))).toBe(true);
  });

  it("allows matching recruits and future Normal types, but not unrelated Pokemon", () => {
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.EEVEE))).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.SWABLU))).toBe(true);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.ALTARIA))).toBe(false);
    expect(isComputerPartnerCandidateAllowed(profile, getPokemonSpecies(SpeciesId.CHARMANDER), 1)).toBe(false);
    const miltank = addPokemon(SpeciesId.MILTANK);
    expect(getComputerPartnerReplacementScores(profile, [miltank], getPokemonSpecies(SpeciesId.CHARMANDER))).toEqual([]);
    const fireProfile = { ...profile, monotype: PokemonType.FIRE };
    expect(isComputerPartnerCandidateAllowed(fireProfile, getPokemonSpecies(SpeciesId.FLETCHLING))).toBe(true);
    expect(isComputerPartnerCandidateAllowed(fireProfile, getPokemonSpecies(SpeciesId.SQUIRTLE))).toBe(false);
  });

  it("restricts Whitney's battle eligibility without restricting humans or creating a run challenge", () => {
    const human = addPokemon(SpeciesId.CHARMANDER, 0);
    const normal = addPokemon(SpeciesId.MILTANK);
    const wrongType = addPokemon(SpeciesId.CHARMANDER);
    game.scene.setActivePlayerIndex(0);
    expect(human.isAllowedInBattle()).toBe(true);
    expect(normal.isAllowedInBattle()).toBe(true);
    expect(wrongType.isAllowedInBattle()).toBe(false);
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([normal]);
    normal.hp = 0;
    expect(game.scene.getPokemonAllowedInBattle(1)).toEqual([]);
    expect(game.scene.gameMode.hasChallenge(Challenges.SINGLE_TYPE)).toBe(false);
    expect(getChallengesForPlayer(1)).toEqual([]);
    expect(getChallengesForPlayer(1, true)).toHaveLength(1);
    expect(checkStarterValidForChallenge(getPokemonSpecies(SpeciesId.CHARMANDER), props, false, 0)).toBe(true);
    expect(checkStarterValidForChallenge(getPokemonSpecies(SpeciesId.CHARMANDER), props, false, 1)).toBe(false);
  });

  it("applies the same rules and sprite when Whitney owns CPU slot zero", () => {
    game.scene.computerPartnerPlayerIndexes = [0, 1, 2];
    game.scene.setComputerPartnerKey(0, "whitney");
    expect(game.scene.getTrainerSprite(0)).toBe(PlayerTrainerSprite.WHITNEY);
    const setScale = vi.spyOn(game.scene.getPlayerTrainerBackSprite(0), "setScale");
    game.scene.getPlayerTrainerBackSprite(0);
    expect(setScale).toHaveBeenCalledWith(0.5);
    expect(addPokemon(SpeciesId.CHARMANDER, 0).isAllowedInBattle()).toBe(false);
    expect(addPokemon(SpeciesId.MILTANK, 0).isAllowedInBattle()).toBe(true);
  });

  it.each([LearnMoveType.LEARN_MOVE, LearnMoveType.TM, LearnMoveType.MEMORY])(
    "learns each signature move when offered through source %s without dropping another",
    source => {
      const pokemon = addPokemon(SpeciesId.MILTANK);
      const moves = [MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.IRON_DEFENSE, MoveId.ROCK_SLIDE];
      for (const moveId of signature) {
        const decision = chooseComputerPartnerMoveLearningDecision(pokemon, moves, allMoves[moveId], source, { profile });
        expect(decision.shouldLearn).toBe(true);
        expect(signature).not.toContain(moves[decision.replaceIndex]);
        moves[decision.replaceIndex] = moveId;
      }
      expect(moves).toEqual(expect.arrayContaining(signature));
    },
  );

  it.each([MoveId.BODY_SLAM, MoveId.ROCK_SLIDE, MoveId.IRON_DEFENSE, MoveId.EARTHQUAKE])(
    "never replaces a signature move with %s, including superseded-move shortcuts",
    moveId => {
      const pokemon = addPokemon(SpeciesId.MILTANK);
      const decision = chooseComputerPartnerMoveLearningDecision(
        pokemon, [...signature, MoveId.TACKLE], allMoves[moveId], LearnMoveType.LEARN_MOVE, { profile },
      );
      expect(decision.replaceIndex).toBe(decision.shouldLearn ? 3 : -1);
    },
  );

  it("still improves the fourth move and does not duplicate a signature move", () => {
    const pokemon = addPokemon(SpeciesId.MILTANK);
    const current = [...signature, MoveId.TACKLE];
    expect(chooseComputerPartnerMoveLearningDecision(
      pokemon, current, allMoves[MoveId.BODY_SLAM], LearnMoveType.LEARN_MOVE, { profile },
    )).toMatchObject({ shouldLearn: true, replaceIndex: 3 });
    expect(chooseComputerPartnerMoveLearningDecision(
      pokemon, current, allMoves[MoveId.MILK_DRINK], LearnMoveType.LEARN_MOVE, { profile },
    ).shouldLearn).toBe(false);
  });

  it("does not grant the Defense Curl exception to other trainers or Whitney's other Pokemon", () => {
    const move = allMoves[MoveId.DEFENSE_CURL];
    const miltank = addPokemon(SpeciesId.MILTANK);
    const other = addPokemon(SpeciesId.BIDOOF);
    expect(chooseComputerPartnerMoveLearningDecision(
      miltank, [], move, LearnMoveType.LEARN_MOVE, { profile: getComputerPartnerProfile("alex") },
    ).shouldLearn).toBe(false);
    expect(chooseComputerPartnerMoveLearningDecision(
      other, [], move, LearnMoveType.LEARN_MOVE, { profile },
    ).shouldLearn).toBe(false);
  });
});
