import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { FusionOptions } from "#data/fusion-options";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Abilities - Trace", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .moveset([MoveId.SPLASH])
      .ability(AbilityId.TRACE)
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("should copy the opponent's ability", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("BerryPhase");

    expect(game.field.getPlayerPokemon().getAbility().id).toBe(AbilityId.BALL_FETCH);
  });

  it("should activate a copied post-summon ability", async () => {
    game.override.enemyAbility(AbilityId.INTIMIDATE);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);

    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("BerryPhase");

    expect(game.field.getEnemyPokemon().getStatStage(Stat.ATK)).toBe(-1);
  });

  describe("as a passive", () => {
    beforeEach(() => {
      game.override.ability(AbilityId.BALL_FETCH).passiveAbility(AbilityId.TRACE);
    });

    it("copies an enabled passive without replacing the regular ability", async () => {
      game.override.enemyPassiveAbility(AbilityId.INSOMNIA);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const pokemon = game.field.getPlayerPokemon();
      expect(pokemon.getPassiveAbility().id).toBe(AbilityId.INSOMNIA);
      expect(pokemon.getAbility().id).toBe(AbilityId.BALL_FETCH);
    });

    it("falls back to the regular ability when the target has no passive", async () => {
      game.override.enemyAbility(AbilityId.INSOMNIA).enemyHasPassiveAbility(false);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.field.getPlayerPokemon().getPassiveAbility().id).toBe(AbilityId.INSOMNIA);
    });

    it("activates the copied passive's entry effect", async () => {
      game.override.enemyPassiveAbility(AbilityId.INTIMIDATE);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.field.getEnemyPokemon().getStatStage(Stat.ATK)).toBe(-1);
      expect(game.field.getPlayerPokemon().getAbility().id).toBe(AbilityId.BALL_FETCH);
    });

    it("does not copy an uncopiable passive even if the regular ability is copiable", async () => {
      game.override.enemyPassiveAbility(AbilityId.MULTITYPE);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.field.getPlayerPokemon().getPassiveAbility().id).toBe(AbilityId.TRACE);
    });

    it("can copy a passive even if the regular ability is uncopiable", async () => {
      game.override.enemyAbility(AbilityId.MULTITYPE).enemyPassiveAbility(AbilityId.INSOMNIA);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.field.getPlayerPokemon().getPassiveAbility().id).toBe(AbilityId.INSOMNIA);
    });

    it("retains Trace's special permission to copy Wonder Guard", async () => {
      game.override.enemyPassiveAbility(AbilityId.WONDER_GUARD);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      expect(game.field.getPlayerPokemon().getPassiveAbility().id).toBe(AbilityId.WONDER_GUARD);
    });

    it("does not change the passive or RNG during simulation", async () => {
      game.override.enemyPassiveAbility(AbilityId.MULTITYPE).battleStyle("double");
      await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
      const pokemon = game.field.getPlayerPokemon();
      game.override.enemyPassiveAbility(AbilityId.INSOMNIA);
      const rngState = Phaser.Math.RND.state();
      applyAbAttrs("PostSummonAbAttr", { pokemon, passive: true, simulated: true });
      expect(pokemon.getPassiveAbility().id).toBe(AbilityId.TRACE);
      expect(Phaser.Math.RND.state()).toBe(rngState);
    });

    it("uses the selected secondary passive and restores it after switching out", async () => {
      game.override.passiveAbility(AbilityId.BALL_FETCH).enemyPassiveAbility(AbilityId.INSOMNIA);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const pokemon = game.field.getPlayerPokemon();
      game.override.passiveAbility(AbilityId.NONE).hasPassiveAbility(true);
      pokemon.passiveIndex = 1;
      vi.spyOn(pokemon.species, "getPassiveAbility").mockImplementation((_form, index) =>
        index === 1 ? AbilityId.TRACE : AbilityId.BALL_FETCH,
      );
      applyAbAttrs("PostSummonAbAttr", { pokemon, passive: true });
      expect(pokemon.getPassiveAbility().id).toBe(AbilityId.INSOMNIA);
      expect(pokemon.passiveIndex).toBe(1);
      pokemon.resetSummonData();
      expect(pokemon.getPassiveAbility().id).toBe(AbilityId.TRACE);
    });

    it("supports a fusion donor's selected passive without changing the fusion configuration", async () => {
      game.override.passiveAbility(AbilityId.BALL_FETCH).enemyPassiveAbility(AbilityId.INSOMNIA);
      await game.classicMode.startBattle(SpeciesId.FEEBAS);
      const pokemon = game.field.getPlayerPokemon();
      game.override.passiveAbility(AbilityId.NONE).hasPassiveAbility(true);
      pokemon.fusionSpecies = getPokemonSpecies(SpeciesId.ABRA);
      pokemon.fusionOptions = new FusionOptions({ passiveSource: "donor", donorPassive: true, donorPassiveIndex: 1 });
      vi.spyOn(pokemon.fusionSpecies, "getPassiveAbility").mockImplementation((_form, index) =>
        index === 1 ? AbilityId.TRACE : AbilityId.BALL_FETCH,
      );
      applyAbAttrs("PostSummonAbAttr", { pokemon, passive: true });
      expect(pokemon.getPassiveAbility().id).toBe(AbilityId.INSOMNIA);
      expect(pokemon.getAbility().id).toBe(AbilityId.BALL_FETCH);
      expect(pokemon.fusionOptions.passiveSource).toBe("donor");
      expect(pokemon.fusionOptions.donorPassiveIndex).toBe(1);
      pokemon.resetSummonData();
      expect(pokemon.getPassiveAbility().id).toBe(AbilityId.TRACE);
    });
  });
});
