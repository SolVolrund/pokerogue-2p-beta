import { __INTERNAL_TEST_EXPORTS } from "#app/ai/ai-moveset-gen";
import { EVOLVE_MOVE, RELEARN_MOVE } from "#app/constants";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { FORBIDDEN_TM_MOVES, LEVEL_BASED_DENYLIST } from "#balance/moves/forbidden-moves";
import {
  EVOLUTION_MOVE_WEIGHT,
  LEVEL_BASED_DENYLIST_THRESHOLD,
  RELEARN_LEVEL_REQUIREMENT,
  RELEARN_MOVE_WEIGHT,
  STAB_BLACKLIST,
} from "#balance/moves/moveset-generation";
import { getSpeciesDeniedOffensiveStat } from "#balance/moves/off-stat-denylist";
import { SUPERCEDED_MOVES } from "#balance/moves/superceded-moves";
import { allMoves } from "#data/data-lists";
import { LearnMoveType } from "#enums/learn-move-type";
import { LearnableMoveSource } from "#enums/learnable-move-source";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { EnemyPokemon, Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import { chooseComputerPartnerMoveLearningDecision } from "#utils/computer-partner-move-ai";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Upstream moveset-selection data", () => {
  let game: GameManager;

  beforeAll(async () => {
    game = new GameManager(new Phaser.Game({ type: Phaser.HEADLESS }));
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.newBattle();
  });

  it.each([
    [MoveId.DARK_PULSE, MoveId.FIERY_WRATH],
    [MoveId.DRAGON_PULSE, MoveId.FICKLE_BEAM],
    [MoveId.PSYCHIC, MoveId.LUSTER_PURGE],
    [MoveId.PSYSHOCK, MoveId.PSYSTRIKE],
    [MoveId.SHADOW_BALL, MoveId.MOONGEIST_BEAM],
    [MoveId.SCALD, MoveId.STEAM_ERUPTION],
    [MoveId.SEED_BOMB, MoveId.LEAF_BLADE],
    [MoveId.THUNDER_PUNCH, MoveId.PLASMA_FISTS],
    [MoveId.TAKE_DOWN, MoveId.DOUBLE_EDGE],
    [MoveId.MIRROR_SHOT, MoveId.FLASH_CANNON],
    [MoveId.STRUGGLE_BUG, MoveId.BUG_BUZZ],
    [MoveId.REST, MoveId.RECOVER],
    [MoveId.FLAMETHROWER, MoveId.TORCH_SONG],
    [MoveId.AQUA_JET, MoveId.JET_PUNCH],
    [MoveId.GIGA_DRAIN, MoveId.MATCHA_GOTCHA],
    [MoveId.POISON_JAB, MoveId.DIRE_CLAW],
    [MoveId.LIQUIDATION, MoveId.SURGING_STRIKES],
    [MoveId.HEX, MoveId.INFERNAL_PARADE],
  ])("replaces move %i only when move %i is available", (oldMove, replacement) => {
    const pool = new Map([[oldMove, 100]]);
    __INTERNAL_TEST_EXPORTS.filterSupercededMoves(pool);
    expect(pool.has(oldMove)).toBe(true);
    __INTERNAL_TEST_EXPORTS.filterSupercededMoves(pool, new Map([[replacement, 1]]));
    expect(pool.has(oldMove)).toBe(false);
  });

  it("preserves Life Dew alongside self-healing alternatives", () => {
    expect(SUPERCEDED_MOVES[MoveId.LIFE_DEW]).toBeUndefined();
    const pool = new Map([
      [MoveId.LIFE_DEW, 10],
      [MoveId.RECOVER, 10],
      [MoveId.SOFT_BOILED, 10],
    ]);
    __INTERNAL_TEST_EXPORTS.filterSupercededMoves(pool);
    expect(pool.has(MoveId.LIFE_DEW)).toBe(true);
  });

  it("keeps Hex as a status-synergy alternative to Shadow Ball", () => {
    const pool = new Map([
      [MoveId.HEX, 10],
      [MoveId.SHADOW_BALL, 10],
    ]);
    __INTERNAL_TEST_EXPORTS.filterSupercededMoves(pool);
    expect(pool.has(MoveId.HEX)).toBe(true);
  });

  it.each([
    [SpeciesId.LANTURN, MoveCategory.PHYSICAL],
    [SpeciesId.CLAWITZER, MoveCategory.PHYSICAL],
    [SpeciesId.AERODACTYL, MoveCategory.SPECIAL],
    [SpeciesId.MILTANK, MoveCategory.SPECIAL],
    [SpeciesId.BARBARACLE, MoveCategory.SPECIAL],
  ])("filters species %i's weaker category %i", (species, category) => {
    expect(getSpeciesDeniedOffensiveStat(species, 0)).toBe(category);
  });

  it.each([
    [SpeciesId.CHARIZARD, "mega-x", MoveCategory.SPECIAL],
    [SpeciesId.CHARIZARD, "mega-y", MoveCategory.PHYSICAL],
    [SpeciesId.MEWTWO, "mega-x", MoveCategory.SPECIAL],
    [SpeciesId.MEWTWO, "mega-y", MoveCategory.PHYSICAL],
    [SpeciesId.CALYREX, "ice", MoveCategory.SPECIAL],
    [SpeciesId.CALYREX, "shadow", MoveCategory.PHYSICAL],
    [SpeciesId.NECROZMA, "dusk-mane", MoveCategory.SPECIAL],
    [SpeciesId.NECROZMA, "dawn-wings", MoveCategory.PHYSICAL],
    [SpeciesId.LUCARIO, "mega-z", MoveCategory.PHYSICAL],
    [SpeciesId.ABSOL, "mega-z", MoveCategory.SPECIAL],
  ] as const)("uses the correct local form index for species %i / %s", (species, formKey, category) => {
    const index = speciesDataRegistry.getSpecies(species).forms.findIndex(form => form.formKey === formKey);
    expect(index).toBeGreaterThanOrEqual(0);
    expect(getSpeciesDeniedOffensiveStat(species, index)).toBe(category);
  });

  it("does not apply form-only restrictions to unlisted forms or species", () => {
    expect(getSpeciesDeniedOffensiveStat(SpeciesId.CHARIZARD, 0)).toBeUndefined();
    expect(getSpeciesDeniedOffensiveStat(SpeciesId.CALYREX, 0)).toBeUndefined();
    expect(getSpeciesDeniedOffensiveStat(SpeciesId.CHARIZARD, 999)).toBeUndefined();
    expect(getSpeciesDeniedOffensiveStat(SpeciesId.EEVEE, 0)).toBeUndefined();
  });

  describe("Generation and CPU learning", () => {
    let pokemon: EnemyPokemon;

    beforeEach(() => {
      vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
      vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
      pokemon = new EnemyPokemon(speciesDataRegistry.getSpecies(SpeciesId.LANTURN), 80, TrainerSlot.TRAINER, false);
    });

    afterEach(() => {
      pokemon.destroy();
    });

    it("filters weak-stat attacks but preserves fixed-damage and utility moves", () => {
      const retained = [
        MoveId.SURF,
        MoveId.BODY_PRESS,
        MoveId.FAKE_OUT,
        MoveId.SUPER_FANG,
        MoveId.NATURES_MADNESS,
        MoveId.RUINATION,
      ];
      const pool = new Map([MoveId.BODY_SLAM, ...retained].map(move => [move, 10]));
      __INTERNAL_TEST_EXPORTS.filterMovePool(pool, false, true, pokemon);
      expect([...pool.keys()]).toEqual(retained);
    });

    it("actually applies different filters to Calyrex's rider forms", () => {
      pokemon.species = speciesDataRegistry.getSpecies(SpeciesId.CALYREX);
      for (const [form, remaining] of [
        [1, MoveId.ICE_PUNCH],
        [2, MoveId.PSYCHIC],
      ] as const) {
        pokemon.formIndex = form;
        const pool = new Map([
          [MoveId.ICE_PUNCH, 10],
          [MoveId.PSYCHIC, 10],
        ]);
        __INTERNAL_TEST_EXPORTS.filterMovePool(pool, false, true, pokemon);
        expect([...pool.keys()]).toEqual([remaining]);
      }
    });

    it("leaves ordinary wild pools and the empty-pool fallback available", () => {
      for (const [trainer, fallback] of [
        [false, false],
        [true, true],
      ]) {
        const pool = new Map([[MoveId.BODY_SLAM, 10]]);
        __INTERNAL_TEST_EXPORTS.filterMovePool(pool, false, trainer, pokemon, false, fallback);
        expect(pool.has(MoveId.BODY_SLAM)).toBe(true);
      }
    });

    it.each([
      MoveId.ARM_THRUST,
      MoveId.STEAMROLLER,
      MoveId.STRUGGLE_BUG,
      MoveId.WING_ATTACK,
      MoveId.VENOM_DRENCH,
    ])("filters move %i at the high-level threshold without banning it at low levels", move => {
      expect(LEVEL_BASED_DENYLIST.has(move)).toBe(true);
      pokemon.species = speciesDataRegistry.getSpecies(SpeciesId.EEVEE);
      for (const level of [LEVEL_BASED_DENYLIST_THRESHOLD - 1, LEVEL_BASED_DENYLIST_THRESHOLD]) {
        pokemon.level = level;
        const pool = new Map([[move, 10]]);
        __INTERNAL_TEST_EXPORTS.filterMovePool(pool, false, true, pokemon);
        expect(pool.has(move)).toBe(level < LEVEL_BASED_DENYLIST_THRESHOLD);
      }
    });

    it.each([
      MoveId.AQUA_JET,
      MoveId.FLIP_TURN,
      MoveId.BURN_UP,
      MoveId.DOUBLE_SHOCK,
      MoveId.TRAILBLAZE,
    ])("does not force situational move %i as the main STAB, but keeps it in the pool", move => {
      expect(STAB_BLACKLIST.has(move)).toBe(true);
      vi.spyOn(pokemon, "getTypes").mockReturnValue([allMoves[move].type]);
      pokemon.moveset = [];
      const pool = new Map([
        [move, 100000],
        [MoveId.SURF, 1],
      ]);
      __INTERNAL_TEST_EXPORTS.forceStabMove(
        pool,
        new Map(),
        new Map(),
        pokemon,
        new NumberHolder(0),
        new NumberHolder(0),
      );
      expect(pokemon.moveset.map(m => m.moveId)).not.toContain(move);
      expect(pool.has(move)).toBe(true);
    });

    it.each([
      RELEARN_LEVEL_REQUIREMENT - 1,
      RELEARN_LEVEL_REQUIREMENT,
    ])("gates trainer reminder moves at level %i", level => {
      pokemon.level = level;
      vi.spyOn(pokemon, "hasTrainer").mockReturnValue(true);
      vi.spyOn(pokemon, "getLevelMoves").mockReturnValue([
        [RELEARN_MOVE, MoveId.PSYCHIC, LearnableMoveSource.RELEARN],
        [EVOLVE_MOVE, MoveId.SPARK, LearnableMoveSource.LEVEL],
      ]);
      const pool = __INTERNAL_TEST_EXPORTS.getAndWeightLevelMoves(pokemon);
      expect(pool.get(MoveId.PSYCHIC)).toBe(level < RELEARN_LEVEL_REQUIREMENT ? 0 : RELEARN_MOVE_WEIGHT);
      expect(pool.get(MoveId.SPARK)).toBe(EVOLUTION_MOVE_WEIGHT);
    });

    it("does not grant reminder-only moves to wild Pokemon", () => {
      vi.spyOn(pokemon, "hasTrainer").mockReturnValue(false);
      vi.spyOn(pokemon, "getLevelMoves").mockReturnValue([[RELEARN_MOVE, MoveId.PSYCHIC, LearnableMoveSource.RELEARN]]);
      expect(__INTERNAL_TEST_EXPORTS.getAndWeightLevelMoves(pokemon).get(MoveId.PSYCHIC)).toBe(0);
    });

    it("lets CPU partners upgrade to signature attacks and refuse the reverse downgrade", () => {
      const upgrade = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        [MoveId.SCALD],
        allMoves[MoveId.STEAM_ERUPTION],
        LearnMoveType.LEARN_MOVE,
      );
      expect(upgrade.shouldLearn).toBe(true);
      expect(upgrade.replaceIndex).toBe(0);
      const downgrade = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        [MoveId.STEAM_ERUPTION],
        allMoves[MoveId.SCALD],
        LearnMoveType.LEARN_MOVE,
      );
      expect(downgrade.shouldLearn).toBe(false);
    });

    it.each([
      [MoveId.FLAMETHROWER, MoveId.TORCH_SONG],
      [MoveId.AQUA_JET, MoveId.JET_PUNCH],
      [MoveId.GIGA_DRAIN, MoveId.MATCHA_GOTCHA],
      [MoveId.POISON_JAB, MoveId.DIRE_CLAW],
    ])("uses the new CPU learning preference %i -> %i without a reverse downgrade", (oldMove, newMove) => {
      const decision = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        [oldMove],
        allMoves[newMove],
        LearnMoveType.LEARN_MOVE,
      );
      expect(decision.shouldLearn).toBe(true);
      expect(decision.replaceIndex).toBe(0);
      expect(
        chooseComputerPartnerMoveLearningDecision(pokemon, [newMove], allMoves[oldMove], LearnMoveType.LEARN_MOVE)
          .shouldLearn,
      ).toBe(false);
    });

    it("does not treat a CPU partner's Life Dew as an automatic self-healing replacement", () => {
      const decision = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        [MoveId.LIFE_DEW],
        allMoves[MoveId.RECOVER],
        LearnMoveType.LEARN_MOVE,
      );
      expect(decision.shouldLearn).toBe(true);
      expect(decision.replaceIndex).toBe(1);
    });

    it("keeps Whitney's three protected moves despite the shared replacement tables", () => {
      pokemon.species = speciesDataRegistry.getSpecies(SpeciesId.MILTANK);
      const context = { profile: getComputerPartnerProfile("whitney") };
      const current = [MoveId.MILK_DRINK, MoveId.ROLLOUT, MoveId.DEFENSE_CURL, MoveId.TACKLE];
      const decision = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        current,
        allMoves[MoveId.BODY_SLAM],
        LearnMoveType.LEARN_MOVE,
        context,
      );
      expect(decision.shouldLearn).toBe(true);
      expect(decision.replaceIndex).toBe(3);
      const rockSlide = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        current,
        allMoves[MoveId.ROCK_SLIDE],
        LearnMoveType.LEARN_MOVE,
        context,
      );
      expect(rockSlide.replaceIndex).not.toBe(1);
    });

    it("stops CPU partners spending a TM pick on Strength", () => {
      expect(FORBIDDEN_TM_MOVES.has(MoveId.STRENGTH)).toBe(true);
      const decision = chooseComputerPartnerMoveLearningDecision(
        pokemon,
        [MoveId.TACKLE],
        allMoves[MoveId.STRENGTH],
        LearnMoveType.TM,
      );
      expect(decision.shouldLearn).toBe(false);
    });
  });
});
