import { allMoves } from "#data/data-lists";
import { FusionOptions } from "#data/fusion-options";
import { Status } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { MultiHitType } from "#enums/multi-hit-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { ShowTrainerPhase } from "#phases/show-trainer-phase";
import { GameManager } from "#test/framework/game-manager";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Abilities - Battle Bond", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  describe("Greninja", () => {
    const baseForm = 0;
    const ashForm = 1;

    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .battleStyle("single")
        .startingWave(4) // Leads to arena reset on Wave 5 trainer battle
        .ability(AbilityId.BATTLE_BOND)
        .starterForms({ [SpeciesId.BATTLE_BOND_GRENINJA]: ashForm })
        .enemySpecies(SpeciesId.BULBASAUR)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(100) // Avoid levelling up
        .enemyLevel(1000); // Avoid opponent dying before `doKillOpponents()`
    });

    it("check if fainted pokemon switches to base form on arena reset", async () => {
      await game.classicMode.startBattle(SpeciesId.MAGIKARP, SpeciesId.BATTLE_BOND_GRENINJA);

      const greninja = game.scene.getPlayerParty()[1];
      expect(greninja.formIndex).toBe(ashForm);

      greninja.hp = 0;
      greninja.status = new Status(StatusEffect.FAINT);
      expect(greninja.isFainted()).toBe(true);

      game.move.use(MoveId.SPLASH);
      await game.doKillOpponents();
      await game.phaseInterceptor.to("TurnEndPhase");
      game.doSelectModifier();
      await game.phaseInterceptor.to("QuietFormChangePhase");

      expect(greninja.formIndex).toBe(baseForm);
    });

    it("still changes an unfused Greninja into Ash form instead of boosting stat stages", async () => {
      game.override.starterForms({ [SpeciesId.BATTLE_BOND_GRENINJA]: baseForm }).enemyLevel(1);
      await game.classicMode.startBattle(SpeciesId.BATTLE_BOND_GRENINJA);
      const greninja = game.field.getPlayerPokemon();
      expect(greninja.formIndex).toBe(baseForm);

      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      expect(greninja.formIndex).toBe(ashForm);
      expect(greninja).toHaveStatStage(Stat.ATK, 0);
      expect(greninja).toHaveStatStage(Stat.SPATK, 0);
      expect(greninja).toHaveStatStage(Stat.SPD, 0);
    });

    it("should not keep buffing Water Shuriken after Greninja switches to base form", async () => {
      // The synchronous tween mock otherwise completes this visual phase twice, skipping the encounter.
      vi.spyOn(ShowTrainerPhase.prototype, "start").mockImplementation(function (this: ShowTrainerPhase) {
        this.end();
      });
      await game.classicMode.startBattle(SpeciesId.BATTLE_BOND_GRENINJA);
      game.field.getEnemyPokemon().hp = 1;

      const waterShuriken = allMoves[MoveId.WATER_SHURIKEN];
      vi.spyOn(waterShuriken, "calculateBattlePower");

      let actualMultiHitType: MultiHitType | null = null;
      const multiHitAttr = waterShuriken.getAttrs("MultiHitAttr")[0];
      vi.spyOn(multiHitAttr, "getHitCount").mockImplementation(() => {
        actualMultiHitType = multiHitAttr.getMultiHitType();
        return 3;
      });

      // Wave 4: Use Water Shuriken in Ash form
      let expectedBattlePower = 20;
      let expectedMultiHitType = MultiHitType.THREE;

      game.move.use(MoveId.WATER_SHURIKEN);
      await game.toEndOfTurn();
      expect(waterShuriken.calculateBattlePower).toHaveLastReturnedWith(expectedBattlePower);
      expect(actualMultiHitType).toBe(expectedMultiHitType);

      await game.toNextWave();

      // Wave 5: Use Water Shuriken in base form
      expect(game.field.getPlayerPokemon().formIndex).toBe(baseForm);
      vi.mocked(waterShuriken.calculateBattlePower).mockClear();
      expectedBattlePower = 15;
      expectedMultiHitType = MultiHitType.TWO_TO_FIVE;

      game.move.use(MoveId.WATER_SHURIKEN);
      await game.phaseInterceptor.to("BerryPhase", false);
      expect(waterShuriken.calculateBattlePower).toHaveBeenCalled();
      expect(waterShuriken.calculateBattlePower).toHaveLastReturnedWith(expectedBattlePower);
      expect(actualMultiHitType).toBe(expectedMultiHitType);
    });
  });

  describe("Non-Greninja", () => {
    beforeEach(() => {
      game = new GameManager(phaserGame);
      game.override
        .ability(AbilityId.BATTLE_BOND)
        .battleStyle("single")
        .criticalHits(false)
        .startingLevel(100)
        .enemyLevel(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyAbility(AbilityId.BALL_FETCH)
        .enemyMoveset(MoveId.SPLASH);
    });

    it("should increase Attack, Special Attack, and Speed stages by 1 on KO once per switch-in", async () => {
      await game.classicMode.startBattle(SpeciesId.MILOTIC, SpeciesId.FEEBAS);

      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      const player = game.field.getPlayerPokemon();
      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);

      await game.toNextWave();
      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);

      await game.toNextWave();
      game.doSwitchPokemon(1);
      await game.toNextTurn();
      game.doSwitchPokemon(1);
      await game.toNextTurn();

      expect(player).toHaveStatStage(Stat.ATK, 0);
      expect(player).toHaveStatStage(Stat.SPATK, 0);
      expect(player).toHaveStatStage(Stat.SPD, 0);

      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);
    });

    it("should increase Attack, Special Attack, and Speed stages by 1 for fusions without Greninja", async () => {
      game.override.starterFusionSpecies(SpeciesId.ALAKAZAM).enableStarterFusion();
      await game.classicMode.startBattle(SpeciesId.MILOTIC);

      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      const player = game.field.getPlayerPokemon();
      expect(player.isFusion()).toBe(true);
      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);
    });

    it.each([
      { baseSpecies: SpeciesId.BATTLE_BOND_GRENINJA, fusionSpecies: SpeciesId.MILOTIC, slot: "Base" },
      { baseSpecies: SpeciesId.MILOTIC, fusionSpecies: SpeciesId.BATTLE_BOND_GRENINJA, slot: "Extra" },
    ])("boosts stats without changing form when Greninja is the $slot species", async ({
      baseSpecies,
      fusionSpecies,
    }) => {
      game.override.starterFusionSpecies(fusionSpecies).enableStarterFusion();
      await game.classicMode.startBattle(baseSpecies);
      const player = game.field.getPlayerPokemon();
      game.override.ability(AbilityId.NONE);
      player.fusionOptions = new FusionOptions({
        abilitySource: baseSpecies === SpeciesId.BATTLE_BOND_GRENINJA ? "body" : "donor",
      });
      expect(player.species.speciesId).toBe(baseSpecies);
      expect(player.fusionSpecies?.speciesId).toBe(fusionSpecies);
      expect(player.getAbility().id).toBe(AbilityId.BATTLE_BOND);
      const forms = [player.formIndex, player.fusionFormIndex];

      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      expect(player.isFusion()).toBe(true);
      expect([player.formIndex, player.fusionFormIndex]).toEqual(forms);
      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);

      await game.toNextWave();
      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();
      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);
    });

    it.each(["body", "donor"] as const)("works with the %s's selected secondary passive", async passiveSource => {
      const baseSpecies = passiveSource === "body" ? SpeciesId.PIKACHU : SpeciesId.BATTLE_BOND_GRENINJA;
      const donorSpecies = passiveSource === "donor" ? SpeciesId.PIKACHU : SpeciesId.BATTLE_BOND_GRENINJA;
      game.override.ability(AbilityId.BALL_FETCH).starterFusionSpecies(donorSpecies).enableStarterFusion();
      await game.classicMode.startBattle(baseSpecies);
      const player = game.field.getPlayerPokemon();
      // Rock Star Pikachu has Battle Bond in the custom secondary slot.
      player.formIndex = passiveSource === "body" ? 1 : 0;
      player.fusionFormIndex = passiveSource === "donor" ? 1 : 0;
      player.passive = true;
      player.passiveIndex = 1;
      player.fusionOptions = new FusionOptions({ passiveSource, donorPassive: true, donorPassiveIndex: 1 });
      const options = { ...player.fusionOptions };
      expect(player.getPassiveAbility().id).toBe(AbilityId.BATTLE_BOND);
      expect(player.canApplyAbility(true)).toBe(true);

      game.move.use(MoveId.THUNDERBOLT);
      await game.toEndOfTurn();

      expect(player).toHaveStatStage(Stat.ATK, 1);
      expect(player).toHaveStatStage(Stat.SPATK, 1);
      expect(player).toHaveStatStage(Stat.SPD, 1);
      expect(player.getAbility().id).toBe(AbilityId.BALL_FETCH);
      expect(player.passiveIndex).toBe(1);
      expect(player.fusionOptions).toEqual(options);
    });
  });
});
