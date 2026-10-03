import { Battle } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterUtils from "#mystery-encounters/encounter-phase-utils";
import { FieryFalloutEncounter } from "#mystery-encounters/fiery-fallout-encounter";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBattlePhase } from "#phases/mystery-encounter-phases";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Fiery Fallout battle field sizes", () => {
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
    vi.spyOn(Dialogue, "showEncounterText").mockResolvedValue();
    vi.spyOn(EncounterUtils, "transitionMysteryEncounterIntroVisuals").mockResolvedValue(true);
    vi.spyOn(EncounterUtils, "loadCustomMovesForEncounter").mockResolvedValue();
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function setup(count: 1 | 2 | 3) {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    game.scene.currentBattle = new Battle(game.scene.gameMode, {
      waveIndex: 105,
      battleType: BattleType.MYSTERY_ENCOUNTER,
      double: true,
      wildBattlerCount: 3,
    });
    for (const playerIndex of game.scene.getActivePlayerIndexes()) {
      const party = game.scene.getPlayerParty(playerIndex);
      party.splice(0);
      for (let i = 0; i < 6; i++) {
        const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.ARCANINE), 80);
        party.push(pokemon);
        vi.spyOn(pokemon, "isOnField").mockReturnValue(false);
      }
    }
    const encounter = new MysteryEncounter(FieryFalloutEncounter);
    game.scene.currentBattle.mysteryEncounter = encounter;
    encounter.onInit!();
    return encounter;
  }

  function verifyBattle(enemyCount: number, playerSlots: number) {
    const scene = game.scene;
    const encounter = scene.currentBattle.mysteryEncounter!;
    expect(scene.currentBattle.getBattlerCount()).toBe(enemyCount);
    expect(scene.getEnemyParty()).toHaveLength(enemyCount);
    expect(scene.getEnemyField()).toHaveLength(enemyCount);
    expect(encounter.startOfBattleEffects).toHaveLength(enemyCount);
    for (const effect of encounter.startOfBattleEffects) {
      expect(scene.getField()[effect.sourceBattlerIndex!]?.species.speciesId).toBe(SpeciesId.VOLCARONA);
      expect(effect.move.moveId).toBe(MoveId.FIRE_SPIN);
      for (const target of effect.targets) expect(scene.getField()[target]).toBeTruthy();
    }
    const push = vi.spyOn(scene.phaseManager, "pushNew");
    const phase = new MysteryEncounterBattlePhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase["endBattleSetup"]();
    const summons = push.mock.calls.filter(call => call[0] === "SummonPhase");
    expect(summons.map(call => call[1])).toEqual(Array.from({ length: playerSlots }, (_, i) => i));
    push.mockClear();
    expect(() => EncounterUtils.handleMysteryEncounterBattleStartEffects()).not.toThrow();
    expect(push.mock.calls.filter(call => call[0] === "MovePhase")).toHaveLength(enemyCount);
    EncounterUtils.handleMysteryEncounterBattleStartEffects();
    expect(push.mock.calls.filter(call => call[0] === "MovePhase")).toHaveLength(enemyCount);
  }

  it("keeps solo at two Volcarona and only summons two of a full party", async () => {
    const encounter = setup(1);
    expect(encounter.spriteConfigs).toHaveLength(2);
    await encounter.options[0].onOptionPhase!();
    verifyBattle(2, 2);
  });

  const choices = [1, 2, 3];
  const scenarios = [2, 3].flatMap(count =>
    Array.from({ length: 3 ** count }, (_, index) =>
      Array.from({ length: count }, (_, player) => choices[Math.floor(index / 3 ** player) % 3]),
    ).filter(options => options.includes(1)),
  );

  it.each(scenarios.map(options => [options.join(","), options] as const))(
    "only summons participating players and gives existing enemies opening moves: %s",
    async (_label, options) => {
      const count = options.length as 2 | 3;
      const encounter = setup(count);
      expect(encounter.spriteConfigs).toHaveLength(count);
      encounter.misc = {
        choices: options.map((optionIndex, playerIndex) => ({
          playerIndex,
          optionIndex,
          ...(optionIndex === 3 ? { helperPokemon: game.scene.getPlayerParty(playerIndex as PlayerIndex)[0] } : {}),
        })),
      };
      await encounter.options[0].onOptionPhase!();
      const fighters = options.flatMap((option, player) => option === 1 ? [player] : []);
      expect(game.scene.getPlayerFieldOwners()).toEqual(fighters);
      const enemies = count - options.filter(option => option === 3).length;
      verifyBattle(enemies, fighters.length);
    },
  );
});
