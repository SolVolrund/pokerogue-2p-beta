import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { FormChangePhase } from "#phases/form-change-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Upstream battle correctness", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .enemyLevel(100);
  });

  it("Smelling Salts heals the target's paralysis without curing the user", async () => {
    game.override
      .statusEffect(StatusEffect.PARALYSIS)
      .enemyStatusEffect(StatusEffect.PARALYSIS)
      .statusActivation(false);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const target = game.field.getEnemyPokemon();
    game.move.use(MoveId.SMELLING_SALTS);
    await game.toEndOfTurn();
    expect(target).toHaveStatusEffect(StatusEffect.NONE);
    expect(game.field.getPlayerPokemon()).toHaveStatusEffect(StatusEffect.PARALYSIS);
  });

  it("uses form-specific weight, including weight-modifying abilities", async () => {
    game.override.starterForms({ [SpeciesId.VENUSAUR]: 1 });
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const pokemon = game.field.getPlayerPokemon();
    expect(pokemon.getSpeciesForm().weight).not.toBe(pokemon.species.weight);
    expect(pokemon.getWeight()).toBe(pokemon.getSpeciesForm().weight);
    game.field.mockAbility(pokemon, AbilityId.HEAVY_METAL);
    expect(pokemon.getWeight()).toBe(pokemon.getSpeciesForm().weight * 2);
  });

  it("Psychic Terrain blocks priority spread attacks", async () => {
    game.override.battleStyle("double").ability(AbilityId.GALE_WINGS).startingTerrain(TerrainType.PSYCHIC);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MILOTIC);
    game.move.use(MoveId.AIR_CUTTER);
    game.move.use(MoveId.SPLASH, 1);
    await game.toEndOfTurn();
    for (const enemy of game.scene.getEnemyField()) {
      expect(enemy).toHaveFullHp();
    }
  });

  it("a cancelled move lapses AFTER_MOVE tags only once", async () => {
    game.override.statusEffect(StatusEffect.PARALYSIS).statusActivation(true);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const lapse = vi.spyOn(game.field.getPlayerPokemon(), "lapseTags");
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(lapse.mock.calls.filter(([type]) => type === BattlerTagLapseType.AFTER_MOVE)).toHaveLength(1);
  });

  it.each([
    [SpeciesId.VENUSAUR, SpeciesFormKey.MEGA],
    [SpeciesId.GROUDON, SpeciesFormKey.PRIMAL],
    [SpeciesId.CHARIZARD, SpeciesFormKey.GIGANTAMAX],
  ] as const)("ends Tera when %i transforms into %s", async (speciesId, formKey) => {
    await game.classicMode.startBattle(speciesId);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.isTerastallized = true;
    pokemon.stellarTypesBoosted = [PokemonType.NORMAL];
    const change = new SpeciesFormChange({
      speciesId,
      preFormKey: pokemon.getFormKey(),
      evoFormKey: formKey,
      trigger: new SpeciesFormChangeManualTrigger(),
    });
    await pokemon.changeForm(change);
    expect(pokemon.getFormKey()).toBe(formKey);
    expect(pokemon.isTerastallized).toBe(false);
    expect(pokemon.stellarTypesBoosted).toEqual([]);
  });

  it("clears Tera before configuring the form-change animation", async () => {
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.isTerastallized = true;
    const change = new SpeciesFormChange({
      speciesId: SpeciesId.VENUSAUR,
      preFormKey: "",
      evoFormKey: SpeciesFormKey.MEGA,
      trigger: new SpeciesFormChangeManualTrigger(),
    });
    new FormChangePhase(pokemon, change, false)["onBeforeSpriteSetup"]();
    expect(pokemon.isTerastallized).toBe(false);
  });

  it("also clears Tera when a fusion's donor becomes Mega", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.fusionSpecies = getPokemonSpecies(SpeciesId.VENUSAUR);
    pokemon.fusionFormIndex = 0;
    pokemon.fusionAbilityIndex = 0;
    pokemon.isTerastallized = true;
    const change = new SpeciesFormChange({
      speciesId: SpeciesId.VENUSAUR,
      preFormKey: "",
      evoFormKey: SpeciesFormKey.MEGA,
      trigger: new SpeciesFormChangeManualTrigger(),
    });
    await pokemon.changeForm(change);
    expect(pokemon.getFusionFormKey()).toBe(SpeciesFormKey.MEGA);
    expect(pokemon.isTerastallized).toBe(false);
  });

  it("keeps Tera for ordinary form changes", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.isTerastallized = true;
    pokemon.resetTeraOnMajorFormChange("hangry");
    expect(pokemon.isTerastallized).toBe(true);
  });
});
