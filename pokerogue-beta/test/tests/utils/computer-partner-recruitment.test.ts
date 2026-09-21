import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import * as MoveAi from "#utils/computer-partner-move-ai";
import * as Profiles from "#utils/computer-partner-profile";
import { inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Mid-run CPU recruitment", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 113;
    game.scene.getPlayerParty(0).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 80));
    vi.spyOn(game.scene.gameData, "saveSystemLocal").mockImplementation(() => {});
  });

  function starter(
    speciesId: SpeciesId,
    moveset: Profiles.ComputerPartnerStarter["moveset"],
    evolveAtJoin = false,
  ): Profiles.ComputerPartnerStarter {
    return {
      speciesId,
      moveset,
      evolveAtJoin,
      shiny: false,
      variant: 0,
      formIndex: 0,
      abilityIndex: 0,
      passive: false,
      nature: Nature.MODEST,
      pokerus: false,
      ivs: [20, 20, 20, 20, 20, 20],
    };
  }

  it("uses level-appropriate moves for both the ace and evolved recruits without learning prompts", async () => {
    const starters = [
      starter(SpeciesId.LATIOS, [MoveId.STORED_POWER, MoveId.CONFUSION, MoveId.HELPING_HAND]),
      starter(SpeciesId.CATERPIE, [MoveId.TACKLE, MoveId.STRING_SHOT], true),
    ];
    vi.spyOn(Profiles, "createComputerPartnerStarter").mockReturnValue(starters);
    const learn = vi.spyOn(MoveAi, "chooseComputerPartnerMoveLearningDecision");
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await inviteComputerPartnerToRun("bianca_latias");
    const party = game.scene.getPlayerParty(1);
    expect(party.map(pokemon => pokemon.species.speciesId)).toEqual([SpeciesId.LATIOS, SpeciesId.BUTTERFREE]);
    expect(party.map(pokemon => pokemon.level)).toEqual([80, 80]);
    expect(party[0].computerPartnerAce).toBe(true);
    for (const [index, pokemon] of party.entries()) {
      const moves = pokemon.moveset.map(move => move.moveId);
      expect(moves).toHaveLength(4);
      expect(new Set(moves).size).toBe(4);
      expect(moves.some(move => !starters[index].moveset!.includes(move))).toBe(true);
      const legalMoves = [...starters[index].moveset!, ...pokemon.getLevelMoves(1, true, true).map(([, move]) => move)];
      expect(moves.every(move => legalMoves.includes(move))).toBe(true);
      expect(pokemon.moveset.every(move => move.ppUsed === 0)).toBe(true);
    }
    expect(learn.mock.calls.some(call => call[1].includes(MoveId.STORED_POWER))).toBe(true);
    expect(learn.mock.calls.every(call => call[4]?.profile?.key === "bianca_latias")).toBe(true);
    expect(queue.mock.calls.some(call => call[0] === "LearnMovePhase")).toBe(false);
    expect(game.scene.activePlayerIndex).toBe(0);
  });

  it("keeps recruitment owner-scoped when adding a second CPU", async () => {
    vi.spyOn(Profiles, "createComputerPartnerStarter").mockReturnValue([
      starter(SpeciesId.LATIOS, [MoveId.CONFUSION, MoveId.HELPING_HAND]),
    ]);
    const hostParty = game.scene.getPlayerParty(0).slice();
    await inviteComputerPartnerToRun("bianca_latias");
    const firstCpu = game.scene.getPlayerParty(1).slice();
    await inviteComputerPartnerToRun("bianca_latias");
    expect(game.scene.getPlayerParty(0)).toEqual(hostParty);
    expect(game.scene.getPlayerParty(1)).toEqual(firstCpu);
    expect(game.scene.getPlayerParty(2)).toHaveLength(1);
    expect(game.scene.getPlayerParty(2)[0]).not.toBe(firstCpu[0]);
    expect(game.scene.getPlayerParty(2)[0].moveset.map(move => move.moveId)).toEqual(
      firstCpu[0].moveset.map(move => move.moveId),
    );
  });
});
