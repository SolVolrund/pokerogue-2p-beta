import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { FieldPosition } from "#enums/field-position";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import { AttemptCapturePhase } from "#phases/attempt-capture-phase";
import { SummonMissingPhase } from "#phases/summon-missing-phase";
import { GameManager } from "#test/framework/game-manager";
import * as profiles from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("CPU capture replacements", () => {
  let phaser: Phaser.Game;
  let game: GameManager;
  beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaser);
    await game.runToTitle();
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    vi.spyOn(Pokemon.prototype, "hideInfo").mockResolvedValue();
    game.scene.configureTwoPlayerMode(true, 3, true, 3, [1, 2]);
    game.scene.newBattle();
    game.scene.newArena(BiomeId.FOREST, 0, true);
  });

  it.each([
    { released: 0, foes: 2, summon: true, benchCatch: false },
    { released: 0, foes: 2, summon: true, benchCatch: true },
    { released: 1, foes: 2, summon: false, benchCatch: false },
    { released: 0, foes: 1, summon: false, benchCatch: false },
  ])("releasing slot $released with $foes foes, bench catch = $benchCatch", async ({ released, foes, summon, benchCatch }) => {
    const scene = game.scene;
    const battle = scene.currentBattle;
    battle.battleType = BattleType.WILD;
    battle.double = true;
    for (const owner of [0, 1, 2] as const) {
      const party = scene.getPlayerParty(owner);
      for (let i = 0; i < scene.getPlayerPartyLimit(owner); i++) {
        party.push(scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 10));
      }
      scene.field.add(party[0]);
    }
    const party = scene.getPlayerParty(2);
    party[0].fieldPosition = FieldPosition.RIGHT;
    const outgoing = party[released];
    const reserve = party[1];
    const human = scene.getPlayerParty(0)[0];
    const ally = scene.getPlayerParty(1)[0];
    const partyLength = party.length;
    for (let i = 0; i < foes; i++) {
      const enemy = scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.GYARADOS), 25, TrainerSlot.NONE);
      battle.enemyParty.push(enemy);
      scene.field.add(enemy);
    }
    if (benchCatch) {
      const caught = battle.enemyParty[0];
      const add = caught.addToParty.bind(caught);
      vi.spyOn(caught, "addToParty").mockImplementation((...args) => {
        const recruit = add(...args)!;
        vi.spyOn(recruit, "isAllowedInBattle").mockReturnValue(false);
        return recruit;
      });
    }
    vi.spyOn(profiles, "getBestComputerPartnerReplacementSlot").mockReturnValue({
      slotIndex: released, replacedPokemon: outgoing, replacedPokemonIndex: released,
      role: "balanced", currentScore: 0, candidateScore: 1, improvementRatio: 2, canReplace: true,
      currentTeamScore: 1, candidateTeamScore: 2,
    });
    vi.spyOn(scene.ui, "showText").mockImplementation((_text, _delay, cb) => cb?.());
    vi.spyOn(scene.pokemonInfoContainer, "show").mockResolvedValue();
    vi.spyOn(scene.pokemonInfoContainer, "hide").mockResolvedValue();
    vi.spyOn(scene, "savePlayerSystemSaveLocal").mockImplementation(() => {});
    const queue = vi.spyOn(scene.phaseManager, "unshiftNew");
    const phase = new AttemptCapturePhase(0, PokeballType.POKEBALL, 2);
    vi.spyOn(phase, "removePb").mockImplementation(() => {});
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase.catch();
    await vi.waitFor(() => expect(phase.end).toHaveBeenCalledOnce());
    expect(party).toHaveLength(partyLength);
    expect(party.includes(outgoing)).toBe(false);
    expect(party[benchCatch ? 1 : released].species.speciesId).toBe(SpeciesId.GYARADOS);
    expect(human.isOnField() && ally.isOnField()).toBe(true);
    expect(queue.mock.calls.filter(([name]) => name === "SummonMissingPhase")).toEqual(
      summon ? [["SummonMissingPhase", 2, FieldPosition.RIGHT]] : [],
    );
    if (summon) {
      const sendOut = new SummonMissingPhase(2, FieldPosition.RIGHT);
      expect(sendOut.getPokemon()).toBe(benchCatch ? reserve : party[0]);
      expect(queue).toHaveBeenCalledWith("PostSummonPhase", scene.getPlayerBattlerIndex(2));
      vi.spyOn(sendOut, "end").mockImplementation(() => sendOut.onEnd());
      sendOut.start();
      await vi.waitFor(() => expect(sendOut.end).toHaveBeenCalledOnce(), { timeout: 5000 });
      expect(party[0].isActive(true)).toBe(true);
      expect(party[0].fieldPosition).toBe(FieldPosition.RIGHT);
    }
  });
});
