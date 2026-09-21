import type { PlayerIndex } from "#app/battle-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allMoves, modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { Pokemon, type PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier, SilphScopeModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType, ModifierTypeGenerator, ModifierTypeOption } from "#modifiers/modifier-type";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import { getModifierType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Rocket HQ exclusive items", () => {
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
    game.scene.newBattle();
  });

  function addPokemon(species: SpeciesId, owner: PlayerIndex = 0): PlayerPokemon {
    const pokemon = game.scene.addPlayerPokemon(speciesDataRegistry.getSpecies(species), 50);
    game.scene.getPlayerParty(owner).push(pokemon);
    return pokemon;
  }

  function equipScope(pokemon: PlayerPokemon, owner: PlayerIndex = 0): SilphScopeModifier {
    const item = getModifierType(modifierTypes.SILPH_SCOPE).newModifier(pokemon) as SilphScopeModifier;
    game.scene.getPlayerModifiers(owner).push(item);
    return item;
  }

  function equipHelm(pokemon: PlayerPokemon): PokemonFormChangeItemModifier {
    const item = getModifierType(modifierTypes.STRANGE_HELMET).newModifier(pokemon) as PokemonFormChangeItemModifier;
    game.scene.getPlayerModifiers(0).push(item);
    item.apply(pokemon, true);
    return item;
  }

  function nextForm(pokemon: Pokemon): string | undefined {
    return speciesDataRegistry
      .getFormChanges(SpeciesId.MEWTWO)
      .find(change => change.findTrigger(SpeciesFormChangeItemTrigger) && change.canChange(pokemon))?.formKey;
  }

  it.each([0, 1, 2])("changes Mewtwo form %i into armor without a Mega Bracelet", formIndex => {
    const pokemon = addPokemon(SpeciesId.MEWTWO);
    pokemon.formIndex = formIndex;
    let mega: PokemonFormChangeItemModifier | undefined;
    if (formIndex) {
      const itemId = formIndex === 1 ? FormChangeItem.MEWTWONITE_X : FormChangeItem.MEWTWONITE_Y;
      mega = new PokemonFormChangeItemModifier(new FormChangeItemModifierType(itemId), pokemon.id, itemId, true);
      game.scene.getPlayerModifiers(0).push(mega);
    }
    const helm = equipHelm(pokemon);
    expect(helm.type.tier).toBe(ModifierTier.ROGUE);
    expect(nextForm(pokemon)).toBe("armored");
    expect(mega?.active ?? false).toBe(false);
    expect(game.scene.getPlayerModifiers(0).some(m => m.type.id === "MEGA_BRACELET")).toBe(false);
    pokemon.formIndex = pokemon.species.forms.findIndex(f => f.formKey === "armored");
    pokemon.calculateStats();
    expect(pokemon.isBoss()).toBe(false);
    helm.active = false;
    expect(nextForm(pokemon)).toBe("");
  });

  it.each([
    FormChangeItem.MEWTWONITE_X,
    FormChangeItem.MEWTWONITE_Y,
  ])("deactivates the Helm when Mega stone %i is equipped", itemId => {
    const pokemon = addPokemon(SpeciesId.MEWTWO);
    const helm = equipHelm(pokemon);
    pokemon.formIndex = pokemon.species.forms.findIndex(f => f.formKey === "armored");
    const mega = new PokemonFormChangeItemModifier(new FormChangeItemModifierType(itemId), pokemon.id, itemId, true);
    game.scene.getPlayerModifiers(0).push(mega);
    mega.apply(pokemon, true);
    expect(helm.active).toBe(false);
    expect(nextForm(pokemon)).toBe(itemId === FormChangeItem.MEWTWONITE_X ? "mega-x" : "mega-y");
  });

  it("does not generate the Helm from ordinary form-item pools", () => {
    const pokemon = addPokemon(SpeciesId.MEWTWO);
    for (const factory of [modifierTypes.FORM_CHANGE_ITEM, modifierTypes.RARE_FORM_CHANGE_ITEM]) {
      const generator = getModifierType(factory) as ModifierTypeGenerator;
      for (let i = 0; i < 20; i++) {
        const type = generator.generateType([pokemon]) as FormChangeItemModifierType | null;
        expect(type?.formChangeItem).not.toBe(FormChangeItem.STRANGE_HELMET);
      }
    }
  });

  it("persists both items and the Helm's inactive state", () => {
    const pokemon = addPokemon(SpeciesId.MEWTWO);
    const helm = equipHelm(pokemon);
    helm.active = false;
    const scope = equipScope(pokemon);
    for (const item of [helm, scope]) {
      const data = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(item, true))), true);
      const restored = data.toModifier(item.constructor);
      expect(restored?.type.id).toBe(item.type.id);
      expect(restored?.type.tier).toBe(ModifierTier.ROGUE);
      expect(restored?.getArgs()).toEqual(item.getArgs());
    }
    expect(scope.isTransferable).toBe(true);
    expect(scope.getMaxHeldItemCount(pokemon)).toBe(1);
  });

  it.each([false, true])("lets Normal and Fighting moves hit Ghosts (simulated=%s)", simulated => {
    const source = addPokemon(SpeciesId.MEWTWO);
    const target = addPokemon(SpeciesId.GENGAR);
    expect(target.getAttackTypeEffectiveness(PokemonType.NORMAL, { source, simulated })).toBe(0);
    equipScope(source);
    expect(target.getAttackTypeEffectiveness(PokemonType.NORMAL, { source, simulated })).toBe(1);
    expect(target.getAttackTypeEffectiveness(PokemonType.FIGHTING, { source, simulated })).toBe(0.5);
    expect(target.getMoveEffectiveness(source, allMoves[MoveId.TACKLE], false, simulated)).toBe(1);
    expect(source.getAbility().id).toBe(AbilityId.PRESSURE);
  });

  it("does not remove other type immunities or grant evasion bypass", () => {
    const source = addPokemon(SpeciesId.MEWTWO);
    const target = addPokemon(SpeciesId.UMBREON);
    equipScope(source);
    expect(target.getAttackTypeEffectiveness(PokemonType.PSYCHIC, { source })).toBe(0);
    expect(source.hasAbility(AbilityId.MINDS_EYE)).toBe(false);
    expect(source.hasAbility(AbilityId.SCRAPPY)).toBe(false);
  });

  it("only applies the Scope to its holder, including on player two", () => {
    game.scene.configureTwoPlayerMode(true);
    const first = addPokemon(SpeciesId.MEWTWO, 0);
    const second = addPokemon(SpeciesId.MEWTWO, 1);
    const ghost = addPokemon(SpeciesId.GENGAR, 0);
    equipScope(second, 1);
    expect(ghost.getAttackTypeEffectiveness(PokemonType.NORMAL, { source: first })).toBe(0);
    expect(ghost.getAttackTypeEffectiveness(PokemonType.NORMAL, { source: second })).toBe(1);
  });

  it("lets the CPU select a compatible Mewtwo for the Helm", () => {
    const other = addPokemon(SpeciesId.MAGIKARP);
    const mewtwo = addPokemon(SpeciesId.MEWTWO);
    const options = [modifierTypes.SILPH_SCOPE, modifierTypes.STRANGE_HELMET].map(
      factory => new ModifierTypeOption(getModifierType(factory), 0),
    );
    const choice = chooseComputerPartnerRewardOption(options, [other, mewtwo]);
    expect(choice?.itemId).toBe("STRANGE_HELMET");
    expect(choice?.targetPokemonIndex).toBe(1);
  });
});

describe("Silph Scope in battle", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.scene.configureTwoPlayerMode(false);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.DUSKULL)
      .enemyLevel(50)
      .enemyAbility(AbilityId.INTIMIDATE)
      .moveset([MoveId.TACKLE])
      .enemyMoveset([MoveId.SPLASH])
      .startingHeldItems([{ name: "SILPH_SCOPE" }]);
  });

  it("does not stop Intimidate, but does let the holder damage a Ghost", async () => {
    await game.classicMode.startBattle(SpeciesId.MEWTWO);
    const source = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    expect(source.getStatStage(Stat.ATK)).toBe(-1);
    const hp = target.hp;
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(target.hp).toBeLessThan(hp);
  });
});
