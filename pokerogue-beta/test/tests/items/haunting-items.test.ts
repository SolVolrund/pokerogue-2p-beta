import type { PlayerIndex } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import { SeasonalEncounterState } from "#data/seasonal-encounters";
import { GameModes } from "#enums/game-modes";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { TrainerVariant } from "#enums/trainer-variant";
import { Pokemon } from "#field/pokemon";
import { Trainer } from "#field/trainer";
import { HauntingSkullModifier, HauntingSpiritModifier } from "#modifiers/modifier";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import type { ModifierTypeFunc } from "#types/modifier-types";
import * as Common from "#utils/common";
import {
  getHauntingSkull,
  getHauntingStatMultiplier,
  getSpiritCount,
  grantHauntingVictoryRewards,
} from "#utils/haunting-utils";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Haunting skulls and spirits", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.seasonalEncounters = new SeasonalEncounterState({ active: true });
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 51;
    game.scene.currentBattle.trainer = new Trainer(TrainerType.HEX_MANIAC, TrainerVariant.DEFAULT);
    game.scene.currentBattle.trainer.haunted = true;
  });

  function addItem(type: ModifierTypeFunc, player: PlayerIndex = 0, count = 1) {
    const modifier = getModifierType(type).newModifier() as HauntingSkullModifier | HauntingSpiritModifier;
    modifier.stackCount = count;
    game.scene.getPlayerModifiers(player).push(modifier);
    return modifier;
  }

  function addPokemon(owner: PlayerIndex = 0) {
    const pokemon = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(SpeciesId.EEVEE), 50);
    game.scene.getPlayerParty(owner).push(pokemon);
    pokemon.calculateStats();
    pokemon.hp = pokemon.getMaxHp();
    return pokemon;
  }

  it.each([1, 2, 3] as const)("grants independent guaranteed progression to all %i players, including CPUs", count => {
    game.scene.configureTwoPlayerMode(count > 1, 6, count > 1, count);
    const owners = game.scene.getActivePlayerIndexes();
    const messages = grantHauntingVictoryRewards();
    expect(messages).toHaveLength(count);
    for (const owner of owners) {
      expect(getHauntingSkull(owner)?.stage).toBe("ominous");
      expect(getSpiritCount(owner)).toBe(0);
    }
    expect(grantHauntingVictoryRewards()).toEqual([]);
    for (let spirit = 1; spirit <= 9; spirit++) {
      game.scene.currentBattle.waveIndex++;
      grantHauntingVictoryRewards();
      for (const owner of owners) {
        expect(getSpiritCount(owner)).toBe(spirit);
        expect(getHauntingSkull(owner)?.stage).toBe(spirit === 9 ? "portent" : "ominous");
      }
    }
    game.scene.seasonalEncounters.enterTower(61);
    Object.assign(game.scene.seasonalEncounters.tower!, { floor: 1, boss: true });
    grantHauntingVictoryRewards();
    for (const owner of owners) {
      expect(getHauntingSkull(owner)?.stage).toBe("malefic");
      expect(getSpiritCount(owner)).toBe(9);
      expect(getSpiritCount(owner, true)).toBe(1);
      expect(game.scene.getPlayerModifiers(owner).filter(m => m instanceof HauntingSkullModifier)).toHaveLength(1);
    }
    expect(game.scene.seasonalEncounters.hauntingsResolved).toBe(true);
    expect(game.scene.seasonalEncounters.tower?.completed).toBe(true);
    expect(grantHauntingVictoryRewards()).toEqual([]);
  });

  it("does not turn outside haunts into bosses when everyone has Portent", () => {
    addItem(modifierTypes.PORTENT_SKULL);
    addItem(modifierTypes.LESSER_SPIRIT, 0, 9);
    grantHauntingVictoryRewards();
    expect(getSpiritCount(0)).toBe(10);
    expect(getSpiritCount(0, true)).toBe(0);
    expect(getHauntingSkull(0)?.stage).toBe("portent");
    expect(game.scene.seasonalEncounters.hauntingsResolved).toBe(false);
  });

  it.each([
    [14, 9, 0, 1],
    [14, 10, 1, 0],
    [15, 0, 0, 0],
    [99, 0, 0, 0],
  ])("uses the 15%% proc / 90:10 split (%i, %i)", (proc, kind, lesser, greater) => {
    game.scene.currentBattle.trainer!.haunted = false;
    addItem(modifierTypes.MALEFIC_SKULL);
    vi.spyOn(Common, "randSeedInt").mockReturnValueOnce(proc).mockReturnValueOnce(kind);
    grantHauntingVictoryRewards();
    expect(getSpiritCount(0)).toBe(lesser);
    expect(getSpiritCount(0, true)).toBe(greater);
  });

  it("grants one guaranteed spirit, not an additional Malefic roll, on haunts", () => {
    addItem(modifierTypes.MALEFIC_SKULL);
    const random = vi.spyOn(Common, "randSeedInt");
    grantHauntingVictoryRewards();
    expect(getSpiritCount(0)).toBe(1);
    expect(random).not.toHaveBeenCalled();
  });

  it("serializes every item and the per-player reward guard", () => {
    for (const type of [
      modifierTypes.OMINOUS_SKULL,
      modifierTypes.PORTENT_SKULL,
      modifierTypes.MALEFIC_SKULL,
      modifierTypes.LESSER_SPIRIT,
      modifierTypes.GREATER_SPIRIT,
    ]) {
      const original = getModifierType(type).newModifier() as HauntingSkullModifier | HauntingSpiritModifier;
      if (original instanceof HauntingSpiritModifier) {
        original.stackCount = 14;
      }
      const raw = JSON.parse(JSON.stringify(new ModifierData(original, true)));
      const restored = new ModifierData(raw, true).toModifier(original.constructor);
      expect(restored?.type.id).toBe(original.type.id);
      expect(restored?.getArgs()).toEqual(original.getArgs());
      expect(restored?.stackCount).toBe(original.stackCount);
    }
    grantHauntingVictoryRewards();
    game.scene.seasonalEncounters = new SeasonalEncounterState(
      JSON.parse(JSON.stringify(game.scene.seasonalEncounters)),
    );
    expect(grantHauntingVictoryRewards()).toEqual([]);
  });

  it("boosts all six stats only for the owning party, preserving HP without compounding", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    const owner = addPokemon(0);
    const other = addPokemon(1);
    const base = [...owner.stats];
    const otherBase = [...other.stats];
    owner.hp = Math.floor(owner.getMaxHp() / 2);
    const fraction = owner.hp / owner.getMaxHp();
    addItem(modifierTypes.MALEFIC_SKULL);
    addItem(modifierTypes.LESSER_SPIRIT, 0, 9);
    addItem(modifierTypes.GREATER_SPIRIT);
    owner.calculateStats();
    other.calculateStats();
    expect(getHauntingStatMultiplier(owner)).toBeCloseTo(1.11);
    expect(owner.stats).toEqual(base.map(value => Math.floor(value * 1.11)));
    expect(other.stats).toEqual(otherBase);
    expect(owner.hp).toBe(Math.floor(fraction * owner.getMaxHp()));
    const boostedHp = owner.hp;
    owner.calculateStats();
    expect(owner.hp).toBe(boostedHp);
    expect(owner.isHaunted()).toBe(false);
    expect(other.isHaunted()).toBe(false);
    expect(owner.getTypes()).not.toContain(PokemonType.GHOST);
    owner.resetSummonData();
    expect(owner.getTypes()).not.toContain(PokemonType.GHOST);
    expect(addPokemon(0).isHaunted()).toBe(false);
  });

  it("preserves naturally Haunted party members with or without a Malefic Skull", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    const pokemon = addPokemon(0);
    pokemon.setHaunted();
    addItem(modifierTypes.MALEFIC_SKULL);
    addItem(modifierTypes.LESSER_SPIRIT, 0, 9);
    pokemon.calculateStats();
    pokemon.resetSummonData();
    expect(getHauntingStatMultiplier(pokemon)).toBeCloseTo(1.09);
    expect(pokemon.isHaunted()).toBe(true);
    expect(pokemon.getTypes()).toContain(PokemonType.GHOST);
    game.scene.getPlayerParty(0).splice(0, 1);
    game.scene.getPlayerParty(1).push(pokemon);
    pokemon.calculateStats();
    pokemon.resetSummonData();
    expect(getHauntingStatMultiplier(pokemon)).toBe(1);
    expect(pokemon.isHaunted()).toBe(true);
    expect(pokemon.getTypes()).toContain(PokemonType.GHOST);
  });

  it("does not revive fainted Pokemon or permanently haunt a transferred party member", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    const pokemon = addPokemon(0);
    pokemon.hp = 0;
    addItem(modifierTypes.MALEFIC_SKULL);
    const spirits = addItem(modifierTypes.LESSER_SPIRIT, 0, 9);
    pokemon.calculateStats();
    expect(pokemon.hp).toBe(0);
    spirits.stackCount++;
    pokemon.calculateStats();
    expect(pokemon.hp).toBe(0);
    expect(pokemon.haunted).toBe(false);
    game.scene.getPlayerParty(0).splice(0, 1);
    game.scene.getPlayerParty(1).push(pokemon);
    pokemon.calculateStats();
    pokemon.resetSummonData();
    expect(pokemon.isHaunted()).toBe(false);
    expect(pokemon.getTypes()).not.toContain(PokemonType.GHOST);
  });
});
