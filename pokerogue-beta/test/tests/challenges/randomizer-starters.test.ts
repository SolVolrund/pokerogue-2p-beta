import { getGameMode } from "#app/game-mode";
import { AbilityId } from "#enums/ability-id";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import { generateStarters } from "#test/utils/game-manager-utils";
import { applyChallenges } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Challenges - Multiplayer randomized starters", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.MOVESET_RANDOMIZER, 1);
    game.override.moveset([]).ability(AbilityId.BALL_FETCH);
  });
  afterEach(() => {
    game.scene.activePlayerIndex = 0;
    game.scene.inputOwner = "none";
    game.scene.configureTwoPlayerMode(false);
  });

  it("creates the same real starter moves for P1 and P2 while hiding preview moves", async () => {
    const starters = generateStarters(game.scene, [SpeciesId.EEVEE]);
    const expectedPokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 5);
    applyChallenges(ChallengeType.STARTER_MODIFY, expectedPokemon);
    const expected = expectedPokemon.moveset.map(move => move.moveId);
    expect(expected.length).toBeGreaterThan(1);
    vi.spyOn(game.scene.ui, "getMode").mockReturnValue(UiMode.STARTER_SELECT);
    const phase = new SelectStarterPhase();
    await phase.initPlayerStarters(starters, 0);
    await phase.initPlayerStarters(starters, 1);
    for (const player of [0, 1] as const) {
      expect(game.scene.getPlayerParty(player)[0].moveset.map(move => move.moveId)).toEqual(expected);
    }
    expect(getPokemonSpecies(SpeciesId.EEVEE).getLevelMoves()).toEqual([]);
  });

  it("gives an automatically selected CPU party usable randomized moves while keeping its ace", async () => {
    game.scene.setComputerPartnerKey(1, "whitney");
    vi.spyOn(game.scene.ui, "getMode").mockReturnValue(UiMode.STARTER_SELECT);
    await new SelectStarterPhase()["initComputerPartnerStarters"](1);
    const party = game.scene.getPlayerParty(1);
    expect(party[0].species.speciesId).toBe(SpeciesId.MILTANK);
    expect(party[0].computerPartnerAce).toBe(true);
    expect(party.length).toBeGreaterThan(1);
    for (const pokemon of party) {
      expect(pokemon.moveset.length).toBeGreaterThan(0);
      expect(pokemon.moveset.length).toBeLessThanOrEqual(4);
      expect(pokemon.moveset.some(move => move.getMove().is("AttackMove"))).toBe(true);
      expect(pokemon.moveset.some(move => move.moveId === MoveId.NONE)).toBe(false);
    }
  });
});
