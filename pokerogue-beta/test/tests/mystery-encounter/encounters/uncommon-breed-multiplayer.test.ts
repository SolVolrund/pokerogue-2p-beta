import { Battle } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import type { BerryModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import * as EncounterUtils from "#mystery-encounters/encounter-phase-utils";
import * as PokemonUtils from "#mystery-encounters/encounter-pokemon-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { getMysteryEncounterCompatibilityAllowlist } from "#mystery-encounters/mystery-encounter-compatibility";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { UncommonBreedEncounter } from "#mystery-encounters/uncommon-breed-encounter";
import { isVsLaneTargetLegal } from "#moves/move-utils";
import { MysteryEncounterBattlePhase } from "#phases/mystery-encounter-phases";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Uncommon Breed multiplayer choices and fields", () => {
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
    vi.spyOn(EncounterUtils, "leaveEncounterWithoutBattle").mockImplementation(() => {});
    vi.spyOn(PokemonUtils, "catchPokemon").mockResolvedValue();
    vi.spyOn(EncounterUtils, "setEncounterRewards");
    vi.spyOn(EncounterUtils, "setEncounterExp");
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function setup(count: 1 | 2 | 3, vs = false) {
    const scene = game.scene;
    scene.configureTwoPlayerMode(count > 1, 6, false, count, undefined, vs);
    scene.currentBattle = new Battle(scene.gameMode, {
      waveIndex: 105,
      battleType: BattleType.MYSTERY_ENCOUNTER,
      double: true,
      wildBattlerCount: 3,
    });
    scene.currentBattle.incrementTurn();
    for (const playerIndex of scene.getActivePlayerIndexes()) {
      const party = scene.getPlayerParty(playerIndex);
      party.splice(0);
      const pokemon = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.ARCANINE), 60 + playerIndex * 10);
      pokemon.moveset = [new PokemonMove(MoveId.ATTRACT)];
      party.push(pokemon);
      vi.spyOn(pokemon, "isOnField").mockReturnValue(false);
      scene.getPlayerTrainerBackSprite(playerIndex).setVisible(false);
      const berry = EncounterUtils.generateModifierType(modifierTypes.BERRY, [BerryType.SITRUS])!
        .newModifier(pokemon) as BerryModifier;
      berry.stackCount = 6;
      scene.getPlayerModifiers(playerIndex).push(berry);
    }
    const encounter = new MysteryEncounter(UncommonBreedEncounter);
    scene.currentBattle.mysteryEncounter = encounter;
    encounter.onInit!();
    return encounter;
  }

  function verifyBattle(owners: PlayerIndex[], vs: boolean) {
    const scene = game.scene;
    const encounter = scene.currentBattle.mysteryEncounter!;
    expect(scene.currentBattle.getBattlerCount()).toBe(owners.length);
    expect(scene.getPlayerFieldOwners()).toEqual(owners);
    expect(scene.getEnemyParty()).toHaveLength(owners.length);
    expect(scene.getPlayerField()).toHaveLength(owners.length);
    expect(encounter.startOfBattleEffects).toHaveLength(owners.length);
    for (const [fieldIndex, owner] of owners.entries()) {
      const enemy = scene.getEnemyField()[fieldIndex];
      const player = scene.getPlayerPokemonForFieldSlot(fieldIndex)!;
      expect(enemy.species.speciesId).toBe(encounter.misc.pokemonDataByPlayer[owner].species);
      expect(scene.getPlayerIndexForPokemon(player)).toBe(owner);
      const effect = encounter.startOfBattleEffects[fieldIndex];
      expect(effect.sourceBattlerIndex).toBe(scene.getEnemyBattlerIndex(fieldIndex));
      expect(effect.targets).toEqual([
        owner === 1 ? scene.getEnemyBattlerIndex(fieldIndex) : scene.getPlayerBattlerIndex(fieldIndex),
      ]);
      if (vs) {
        expect(scene["getVsEnemyModifierLaneForPokemon"](enemy)).toBe(owner);
        for (const [otherIndex, other] of scene.getPlayerField().entries()) {
          expect(isVsLaneTargetLegal(enemy, other)).toBe(otherIndex === fieldIndex);
        }
      }
    }
    const push = vi.spyOn(scene.phaseManager, "pushNew");
    const phase = new MysteryEncounterBattlePhase(true);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    phase["endBattleSetup"]();
    expect(push.mock.calls.filter(call => call[0] === "SummonPhase").map(call => call[1]))
      .toEqual(owners.map((_, index) => index));
    expect(() => EncounterUtils.handleMysteryEncounterBattleStartEffects()).not.toThrow();
    expect(push.mock.calls.filter(call => call[0] === "MovePhase")).toHaveLength(owners.length);
    EncounterUtils.handleMysteryEncounterBattleStartEffects();
    expect(push.mock.calls.filter(call => call[0] === "MovePhase")).toHaveLength(owners.length);
  }

  const scenarios = ([false, true] as const).flatMap(vs => ([2, 3] as const).flatMap(count =>
    Array.from({ length: 3 ** count }, (_, index) => ({
      vs,
      count,
      options: Array.from({ length: count }, (_, player) => 1 + Math.floor(index / 3 ** player) % 3),
    })),
  ));

  it.each(scenarios)("keeps every choice owned correctly: $count players, vs=$vs, $options", async ({ count, vs, options }) => {
    const encounter = setup(count, vs);
    const scene = game.scene;
    expect(encounter.spriteConfigs).toHaveLength(count);
    expect(new Set(encounter.spriteConfigs.map(sprite => sprite.x)).size).toBe(count);
    expect(Object.keys(encounter.misc.pokemonDataByPlayer)).toHaveLength(count);
    for (const owner of scene.getActivePlayerIndexes()) {
      expect(encounter.misc.pokemonDataByPlayer[owner].level).toBe(58 + owner * 10);
    }
    encounter.misc.eggMoveByPlayer = { 0: MoveId.TACKLE, 1: MoveId.SWORDS_DANCE, 2: MoveId.TACKLE };
    encounter.misc.choices = options.map((optionIndex, playerIndex) => ({
      playerIndex,
      optionIndex,
      helperPokemon: scene.getPlayerParty(playerIndex as PlayerIndex)[0],
    }));
    await encounter.options[0].onOptionPhase!();
    const fighters = options.flatMap((option, player) => option === 1 ? [player as PlayerIndex] : []);
    const recruited = options.flatMap((option, player) => option !== 1 ? [player] : []);
    expect(vi.mocked(PokemonUtils.catchPokemon).mock.calls.map(call => call[5])).toEqual(recruited);
    for (const call of vi.mocked(PokemonUtils.catchPokemon).mock.calls) {
      expect(call[0].id).toBe(encounter.misc.pokemonDataByPlayer[call[5]!].id);
    }
    for (const owner of scene.getActivePlayerIndexes()) {
      const berry = scene.getPlayerModifiers(owner).find(mod => mod.type.id === "BERRY");
      expect(berry?.stackCount).toBe(options[owner] === 2 ? 2 : 6);
    }
    expect(vi.mocked(EncounterUtils.setEncounterRewards).mock.calls.map(call => call[3]).sort())
      .toEqual(scene.getActivePlayerIndexes());
    expect(vi.mocked(EncounterUtils.setEncounterExp).mock.calls.map(call => call[3]))
      .toEqual(options.flatMap((option, player) => option === 3 ? [player] : []));
    if (fighters.length) {
      expect(EncounterUtils.leaveEncounterWithoutBattle).not.toHaveBeenCalled();
      verifyBattle(fighters, vs);
    } else {
      expect(EncounterUtils.leaveEncounterWithoutBattle).toHaveBeenCalledOnce();
    }
  });

  it("keeps solo to a single enemy despite an inherited triple field", async () => {
    const encounter = setup(1);
    encounter.misc.eggMoveByPlayer[0] = MoveId.TACKLE;
    expect(encounter.spriteConfigs).toHaveLength(1);
    await encounter.options[0].onOptionPhase!();
    verifyBattle([0], false);
  });

  it("prompts P2 then P3 with the correct input owner before resolving choices", async () => {
    const encounter = setup(3);
    const mode = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    const input = vi.spyOn(game.scene, "waitForPlayerSideProgressionInput");
    expect(await encounter.options[0].onPreOptionPhase!()).toBe(false);
    expect(input).toHaveBeenLastCalledWith(1);
    const p2Options = mode.mock.calls.findLast(call => call[0] === UiMode.MYSTERY_ENCOUNTER)![1]
      .overrideOptions as MysteryEncounterOption[];
    expect(await p2Options[1].onPreOptionPhase!()).toBe(false);
    expect(input).toHaveBeenLastCalledWith(2);
    const p3Options = mode.mock.calls.findLast(call => call[0] === UiMode.MYSTERY_ENCOUNTER)![1]
      .overrideOptions as MysteryEncounterOption[];
    expect(await p3Options[2].onPreOptionPhase!()).toBe(true);
    expect(encounter.misc.choices.map(choice => [choice.playerIndex, choice.optionIndex]))
      .toEqual([[0, 1], [1, 2], [2, 3]]);
    expect(encounter.misc.skipSelectedDialogueOnce).toBe(true);
  });

  it.each([1, 2, 3])("automates both CPU choices with available option %i", async option => {
    const encounter = setup(3);
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(owner => owner !== 0);
    for (const owner of [1, 2] as const) {
      if (option !== 3) game.scene.getPlayerParty(owner)[0].moveset = [new PokemonMove(MoveId.TACKLE)];
      if (option === 1) game.scene.getPlayerModifiers(owner).splice(0);
    }
    expect(await encounter.options[0].onPreOptionPhase!()).toBe(true);
    expect(encounter.misc.choices.map(choice => [choice.playerIndex, choice.optionIndex]))
      .toEqual([[0, 1], [1, option], [2, option]]);
  });

  it.each([3, 6])("allows three-player co-op with party size %i", size => {
    setup(3);
    game.scene.twoPlayerPartySize = size as 3 | 6;
    expect(getMysteryEncounterCompatibilityAllowlist(game.scene.getMysteryEncounterCompatibilityContext()))
      .toContain(MysteryEncounterType.UNCOMMON_BREED);
  });
});
