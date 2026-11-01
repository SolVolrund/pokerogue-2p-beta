import { Battle } from "#app/battle";
import { EvolutionItem } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { DOWSING_GROUPS } from "#enums/dowsing-group";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { ZCrystal } from "#enums/z-crystal";
import {
  DowsingMachineModifier,
  MegaEvolutionAccessModifier,
  PokemonFormChangeItemModifier,
  ZCrystalModifier,
  ZMoveAccessModifier,
} from "#modifiers/modifier";
import {
  applyDowsingPreference,
  type FormChangeItemModifierType,
  getDowsingItemOptions,
  getPlayerModifierTypeOptions,
  type ModifierTypeGenerator,
  regenerateModifierPoolThresholds,
  WeightedModifierType,
  type ZCrystalModifierType,
} from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import * as common from "#utils/common";
import { getModifierPoolForType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Items - Dowsing Machine", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let machine: DowsingMachineModifier;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50);
    game.scene.getPlayerParty().push(pokemon);
    const type = modifierTypes.DOWSING_MACHINE().withIdFromFunc(modifierTypes.DOWSING_MACHINE);
    machine = new DowsingMachineModifier(type);
    game.scene.getPlayerModifiers(0).push(machine);
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  const party = () => game.scene.getPlayerParty(0);
  const evolutionRoll = () =>
    getDowsingItemOptions(party(), "EVOLUTION_ITEM").find(option => option.item === EvolutionItem.FIRE_STONE)!.type;

  it("is a single-stack Ultra-tier utility item", () => {
    expect(machine.getMaxStackCount()).toBe(1);
    expect(
      getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ULTRA].some(
        entry => entry.modifierType.id === "DOWSING_MACHINE",
      ),
    ).toBe(true);
  });

  it("lists all ordinary evolution items but enables only eligible choices", () => {
    const options = getDowsingItemOptions(party(), "EVOLUTION_ITEM");
    expect(options.find(option => option.item === EvolutionItem.THUNDER_STONE)?.available).toBe(true);
    expect(options.find(option => option.item === EvolutionItem.LINKING_CORD)?.available).toBe(false);
    expect(options.some(option => option.item === EvolutionItem.METAL_ALLOY)).toBe(false);
    expect(options.some(option => option.item === EvolutionItem.NONE)).toBe(false);
  });

  it("keeps the five categories and their reward tiers separate", () => {
    const tiers = [ModifierTier.GREAT, ModifierTier.ULTRA, ModifierTier.ROGUE, ModifierTier.ULTRA, ModifierTier.GREAT];
    DOWSING_GROUPS.forEach((group, index) => {
      const options = getDowsingItemOptions(party(), group);
      expect(options.length).toBeGreaterThan(0);
      expect(options.every(option => option.type.id === group && option.type.tier === tiers[index])).toBe(true);
    });
  });

  it.each([0, 1])("uses the preference only on the successful coin flip (%i)", roll => {
    machine.preferences.EVOLUTION_ITEM = EvolutionItem.THUNDER_STONE;
    const original = evolutionRoll();
    const rng = vi.spyOn(common, "randSeedInt").mockReturnValue(roll);
    const result = applyDowsingPreference(party(), original);
    expect(result.name).toBe(
      roll === 0
        ? getDowsingItemOptions(party(), "EVOLUTION_ITEM").find(o => o.item === EvolutionItem.THUNDER_STONE)!.type.name
        : original.name,
    );
    expect(rng).toHaveBeenCalledExactlyOnceWith(2);
    expect(result.tier).toBe(original.tier);
  });

  it("does not consume RNG without a preference or with an unusable preference", () => {
    const original = evolutionRoll();
    const rng = vi.spyOn(common, "randSeedInt");
    expect(applyDowsingPreference(party(), original)).toBe(original);
    machine.preferences.EVOLUTION_ITEM = EvolutionItem.LINKING_CORD;
    expect(applyDowsingPreference(party(), original)).toBe(original);
    expect(rng).not.toHaveBeenCalled();
  });

  it("does not promote a reward into a different rarity or category", () => {
    machine.preferences.EVOLUTION_ITEM = EvolutionItem.METAL_ALLOY;
    machine.preferences.RARE_EVOLUTION_ITEM = EvolutionItem.METAL_ALLOY;
    const original = evolutionRoll();
    const rng = vi.spyOn(common, "randSeedInt");
    expect(applyDowsingPreference(party(), original)).toBe(original);
    expect(rng).not.toHaveBeenCalled();
  });

  it("keeps pool probes and explicit generated items unbiased", () => {
    machine.preferences.EVOLUTION_ITEM = EvolutionItem.THUNDER_STONE;
    const rng = vi.spyOn(common, "randSeedInt");
    const generator = modifierTypes.EVOLUTION_ITEM() as ModifierTypeGenerator;
    generator.generateType(party());
    expect(rng).toHaveBeenCalledTimes(1);
    rng.mockClear();
    generator.generateType(party(), [EvolutionItem.FIRE_STONE]);
    expect(rng).not.toHaveBeenCalled();
  });

  it("restores every preference through the existing save format and clones independently", () => {
    machine.preferences.EVOLUTION_ITEM = EvolutionItem.THUNDER_STONE;
    machine.preferences.RARE_EVOLUTION_ITEM = EvolutionItem.METAL_ALLOY;
    machine.preferences.RARE_FORM_CHANGE_ITEM = FormChangeItem.CHARIZARDITE_X;
    machine.preferences.FORM_CHANGE_ITEM = FormChangeItem.ROTOM_OVEN;
    machine.preferences.Z_CRYSTAL = ZCrystal.FLYINIUM_Z;
    const data = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(machine, true))), true);
    const restored = data.toModifier(DowsingMachineModifier) as DowsingMachineModifier;
    expect(restored.preferences).toEqual({ ...machine.preferences, FORM_CHANGE_ITEM: FormChangeItem.ROTOM_CATALOGUE });
    const cloned = machine.clone();
    expect(cloned.preferences).toEqual(restored.preferences);
    delete cloned.preferences.EVOLUTION_ITEM;
    expect(machine.preferences.EVOLUTION_ITEM).toBe(EvolutionItem.THUNDER_STONE);
    expect(restored.preferences.EVOLUTION_ITEM).toBe(EvolutionItem.THUNDER_STONE);
  });

  it("applies the preference through actual reward generation, without changing the rolled tier", () => {
    game.scene.currentBattle = new Battle(game.scene.gameMode, { waveIndex: 20, battleType: 0, double: false });
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER);
    const originalPool = pool[ModifierTier.GREAT];
    const entry = new WeightedModifierType(modifierTypes.EVOLUTION_ITEM, 1);
    entry.setTier(ModifierTier.GREAT);
    pool[ModifierTier.GREAT] = [entry];
    try {
      regenerateModifierPoolThresholds(party(), ModifierPoolType.PLAYER, 0, 0);
      machine.preferences.EVOLUTION_ITEM = EvolutionItem.THUNDER_STONE;
      const rng = vi.spyOn(common, "randSeedInt").mockReturnValue(0);
      const [reward] = getPlayerModifierTypeOptions(1, party(), undefined, {
        guaranteedModifierTiers: [ModifierTier.GREAT],
        allowLuckUpgrades: false,
      });
      expect(reward.type).toMatchObject({
        id: "EVOLUTION_ITEM",
        tier: ModifierTier.GREAT,
        evolutionItem: EvolutionItem.THUNDER_STONE,
      });
      expect(rng).toHaveBeenCalledWith(2);
      expect(reward.upgradeCount).toBe(0);
    } finally {
      pool[ModifierTier.GREAT] = originalPool;
    }
  });

  it("checks Mega access and existing stones on the correct multiplayer team", () => {
    game.scene.configureTwoPlayerMode(true);
    const ally = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARIZARD), 50, 0, 0);
    game.scene.getPlayerParty(1).push(ally);
    game.scene.getPlayerModifiers(0).push(new MegaEvolutionAccessModifier(modifierTypes.MEGA_BRACELET()));
    const stone = () =>
      getDowsingItemOptions([ally], "RARE_FORM_CHANGE_ITEM").find(
        option => option.item === FormChangeItem.CHARIZARDITE_X,
      )!;
    expect(stone().available).toBe(false);
    game.scene.getPlayerModifiers(1).push(new MegaEvolutionAccessModifier(modifierTypes.MEGA_BRACELET()));
    expect(stone().available).toBe(true);
    game.scene
      .getPlayerModifiers(1)
      .push(
        new PokemonFormChangeItemModifier(
          stone().type as FormChangeItemModifierType,
          ally.id,
          FormChangeItem.CHARIZARDITE_X,
          false,
        ),
      );
    expect(stone().available).toBe(false);
  });

  it("requires Mega access and keeps other form items out of the Mega list", () => {
    party().splice(0, party().length, game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARIZARD), 50, 0, 0));
    const findStone = () =>
      getDowsingItemOptions(party(), "RARE_FORM_CHANGE_ITEM").find(
        option => option.item === FormChangeItem.CHARIZARDITE_X,
      )!;
    expect(findStone().available).toBe(false);
    game.scene.getPlayerModifiers(0).push(new MegaEvolutionAccessModifier(modifierTypes.MEGA_BRACELET()));
    expect(findStone().available).toBe(true);
    expect(
      getDowsingItemOptions(party(), "RARE_FORM_CHANGE_ITEM").some(option => option.item === FormChangeItem.RED_ORB),
    ).toBe(false);
  });

  it("requires Z access and rejects crystals already owned by the only eligible recipient", () => {
    const pokemon = party()[0];
    pokemon.moveset = [new PokemonMove(MoveId.TACKLE)];
    const findCrystal = () =>
      getDowsingItemOptions(party(), "Z_CRYSTAL").find(option => option.item === ZCrystal.NORMALIUM_Z)!;
    expect(findCrystal().available).toBe(false);
    game.scene.getPlayerModifiers(0).push(new ZMoveAccessModifier(modifierTypes.Z_RING()));
    expect(findCrystal().available).toBe(true);
    game.scene
      .getPlayerModifiers(0)
      .push(new ZCrystalModifier(findCrystal().type as ZCrystalModifierType, pokemon.id, ZCrystal.NORMALIUM_Z));
    expect(findCrystal().available).toBe(false);
  });

  it("uses the recipient player's machine even when another player is active", () => {
    game.scene.configureTwoPlayerMode(true);
    const ally = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50);
    game.scene.getPlayerParty(1).push(ally);
    game.scene.getPlayerModifiers(0).splice(0);
    game.scene.getPlayerModifiers(1).push(machine);
    machine.preferences.EVOLUTION_ITEM = EvolutionItem.THUNDER_STONE;
    game.scene.setActivePlayerIndex(0);
    const original = evolutionRoll();
    const rng = vi.spyOn(common, "randSeedInt").mockReturnValue(0);
    expect(applyDowsingPreference(party(), original)).toBe(original);
    expect(rng).not.toHaveBeenCalled();
    expect(applyDowsingPreference([ally], original)).not.toBe(original);
    expect(rng).toHaveBeenCalledExactlyOnceWith(2);
  });
});
