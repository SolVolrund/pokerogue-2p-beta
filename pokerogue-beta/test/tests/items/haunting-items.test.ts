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

  it.each([
    { greater: false, cap: 20 },
    { greater: true, cap: 5 },
  ])("caps greater=$greater at $cap independently for each player", ({ greater, cap }) => {
    const type = greater ? modifierTypes.GREATER_SPIRIT : modifierTypes.LESSER_SPIRIT;
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    for (const owner of [0, 1] as const) {
      addItem(modifierTypes.MALEFIC_SKULL, owner);
      addItem(type, owner, cap - owner);
    }
    if (greater) {
      game.scene.seasonalEncounters.enterTower(51);
      game.scene.seasonalEncounters.tower!.boss = true;
    }
    const add = vi.spyOn(game.scene, "addModifier");
    const queue = vi.spyOn(game.scene.phaseManager, "queueMessage");
    const messages = grantHauntingVictoryRewards();
    expect(getSpiritCount(0, greater)).toBe(cap);
    expect(getSpiritCount(1, greater)).toBe(cap);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add.mock.calls[0][6]).toBe(1);
    expect(queue).not.toHaveBeenCalled();
    expect(messages).toHaveLength(greater ? 2 : 1); // A tower boss also ends the hauntings.
    expect(grantHauntingVictoryRewards()).toEqual([]);
    for (const owner of [0, 1] as const) {
      const spirit = game.scene.findModifierForPlayer(
        m => m instanceof HauntingSpiritModifier && m.greater === greater,
        owner,
      ) as HauntingSpiritModifier;
      expect(spirit.getMaxStackCount()).toBe(cap);
      expect(spirit.incrementStack(1, false)).toBe(false);
    }
    if (greater) {
      expect(game.scene.seasonalEncounters.tower?.completed).toBe(true);
    }
  });

  it.each([0, 10])("skips capped ordinary-victory drops without substitution (kind roll: %i)", kind => {
    game.scene.currentBattle.trainer!.haunted = false;
    addItem(modifierTypes.MALEFIC_SKULL);
    addItem(modifierTypes.LESSER_SPIRIT, 0, 20);
    addItem(modifierTypes.GREATER_SPIRIT, 0, 5);
    vi.spyOn(Common, "randSeedInt").mockReturnValueOnce(0).mockReturnValueOnce(kind);
    const add = vi.spyOn(game.scene, "addModifier");
    expect(grantHauntingVictoryRewards()).toEqual([]);
    expect(add).not.toHaveBeenCalled();
    expect(getSpiritCount(0)).toBe(20);
    expect(getSpiritCount(0, true)).toBe(5);
    expect(getHauntingStatMultiplier(addPokemon())).toBeCloseTo(1.15);
  });

  it.each([
    { greater: false, cap: 20 },
    { greater: true, cap: 5 },
  ])("clamps old over-cap spirit saves to $cap when loading", ({ greater, cap }) => {
    const type = greater ? modifierTypes.GREATER_SPIRIT : modifierTypes.LESSER_SPIRIT;
    const original = getModifierType(type).newModifier() as HauntingSpiritModifier;
    original.stackCount = 100;
    const raw = JSON.parse(JSON.stringify(new ModifierData(original, true)));
    const restored = new ModifierData(raw, true).toModifier(HauntingSpiritModifier);
    expect(restored?.stackCount).toBe(cap);
    expect(restored?.getArgs()).toEqual(original.getArgs());
  });

  it("still upgrades a Portent Skull and completes the tower at the Greater Spirit cap", () => {
    addItem(modifierTypes.PORTENT_SKULL);
    addItem(modifierTypes.GREATER_SPIRIT, 0, 5);
    game.scene.seasonalEncounters.enterTower(51);
    game.scene.seasonalEncounters.tower!.boss = true;
    const add = vi.spyOn(game.scene, "addModifier");
    expect(grantHauntingVictoryRewards()).toHaveLength(2);
    expect(add).not.toHaveBeenCalled();
    expect(getSpiritCount(0, true)).toBe(5);
    expect(getHauntingSkull(0)?.stage).toBe("malefic");
    expect(game.scene.seasonalEncounters.tower?.completed).toBe(true);
    expect(game.scene.seasonalEncounters.hauntingsResolved).toBe(true);
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
        original.stackCount = Math.min(14, original.getMaxStackCount());
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
    expect(getHauntingStatMultiplier(owner)).toBeCloseTo(1.055);
    expect(owner.stats).toEqual(base.map(value => Math.floor(value * 1.055)));
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

  it.each([
    [1, 0, 1.005],
    [0, 1, 1.01],
    [20, 5, 1.15],
  ])("applies the reduced bonus for %i Lesser and %i Greater Spirits", (lesser, greater, multiplier) => {
    const pokemon = addPokemon(0);
    const base = [...pokemon.stats];
    if (lesser) addItem(modifierTypes.LESSER_SPIRIT, 0, lesser);
    if (greater) addItem(modifierTypes.GREATER_SPIRIT, 0, greater);
    expect(getHauntingStatMultiplier(pokemon)).toBe(1);
    addItem(modifierTypes.MALEFIC_SKULL);
    pokemon.calculateStats();
    expect(getHauntingStatMultiplier(pokemon)).toBeCloseTo(multiplier);
    expect(pokemon.stats).toEqual(base.map(value => Math.floor(value * multiplier)));
  });

  it("preserves naturally Haunted party members with or without a Malefic Skull", () => {
    game.scene.configureTwoPlayerMode(true, 6, false, 2);
    const pokemon = addPokemon(0);
    pokemon.setHaunted();
    addItem(modifierTypes.MALEFIC_SKULL);
    addItem(modifierTypes.LESSER_SPIRIT, 0, 9);
    pokemon.calculateStats();
    pokemon.resetSummonData();
    expect(getHauntingStatMultiplier(pokemon)).toBeCloseTo(1.045);
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
