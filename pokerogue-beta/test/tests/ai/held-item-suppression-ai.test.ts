import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import { choosePlannerMove } from "#utils/battle-planner-ai";
import { withHeldItemSuppressionForecast } from "#utils/held-item-suppression";
import * as suppressionAi from "#utils/held-item-suppression-ai";
import { areHeldItemEffectsSuppressed } from "#utils/held-item-suppression-state";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("AI - held item suppression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.EMBARGO, MoveId.MAGIC_ROOM, MoveId.SPLASH, MoveId.TACKLE]);
  });

  function evaluate(move = MoveId.EMBARGO) {
    return suppressionAi.evaluateItemSuppression(
      game.field.getPlayerPokemon(),
      game.field.getEnemyPokemon(),
      allMoves[move],
    );
  }

  it("values actual Charcoal stacks, but only when Fire attacks matter", async () => {
    game.override.enemyMoveset(MoveId.EMBER).enemyHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    const one = evaluate().damageScore;
    enemy.getHeldItems()[0].stackCount = 3;
    expect(evaluate().damageScore).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(0);
    game.move.changeMoveset(enemy, MoveId.TACKLE);
    expect(evaluate().score).toBe(0);
  });

  it("reconsiders an unboosted alternative attack instead of treating Charcoal as an Attack drop", async () => {
    game.override
      .enemyMoveset([MoveId.EMBER, MoveId.TACKLE])
      .enemyHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE, count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const player = game.field.getPlayerPokemon();
    const damage = player.getAttackDamage.bind(player);
    vi.spyOn(player, "getAttackDamage").mockImplementation(args => ({
      ...damage(args),
      damage: args.move.id === MoveId.TACKLE ? 100 : areHeldItemEffectsSuppressed(args.source) ? 30 : 80,
    }));
    expect(evaluate().damageScore).toBe(0);
  });

  it("does not count exhausted attacking moves", async () => {
    game.override
      .enemyMoveset(MoveId.EMBER)
      .enemyHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE, count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    game.move.changeMoveset(enemy, MoveId.EMBER);
    const ember = enemy.moveset[0];
    ember.ppUsed = ember.getMovePp();
    expect(evaluate().score).toBe(0);
  });

  it("values only Leftovers healing that could actually be received", async () => {
    game.override.enemyHeldItems([{ name: "LEFTOVERS", count: 3 }]).moveset([MoveId.EMBARGO, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    expect(evaluate().score).toBe(0);
    enemy.hp -= 1;
    const tiny = evaluate().healingScore;
    enemy.hp = Math.floor(enemy.getMaxHp() / 2);
    expect(evaluate().healingScore).toBeGreaterThan(tiny);
    expect(tiny).toBeGreaterThan(0);
    enemy.addTag(BattlerTagType.HEAL_BLOCK, 5);
    expect(evaluate().healingScore).toBe(0);
  });

  it("counts Shell Bell only when its holder can deal damage and heal", async () => {
    game.override.enemyHeldItems([{ name: "SHELL_BELL", count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = Math.floor(enemy.getMaxHp() / 2);
    expect(evaluate().healingScore).toBe(0);
    game.move.changeMoveset(enemy, MoveId.TACKLE);
    expect(evaluate().healingScore).toBeGreaterThan(0);
  });

  it("deducts the user's and allies' recovery when scoring Magic Room", async () => {
    game.override
      .battleStyle("double")
      .startingHeldItems([{ name: "LEFTOVERS", count: 4 }])
      .enemyHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.MEW);
    for (const pokemon of game.scene.getField(true)) {
      pokemon.hp = Math.floor(pokemon.getMaxHp() / 2);
      game.move.changeMoveset(pokemon, MoveId.SPLASH);
    }
    expect(evaluate(MoveId.MAGIC_ROOM).healingScore).toBeLessThan(0);
    expect(evaluate().healingScore).toBeGreaterThan(0);
    vi.spyOn(game.scene, "randBattleSeedInt").mockReturnValue(0);
    expect(
      choosePlannerMove(game.field.getPlayerPokemon(), [
        new PokemonMove(MoveId.MAGIC_ROOM),
        new PokemonMove(MoveId.SPLASH),
      ]).move,
    ).toBe(MoveId.SPLASH);
  });

  it("subtracts its own damage boosters when judging Magic Room", async () => {
    game.override
      .startingHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE, count: 3 }])
      .moveset([MoveId.MAGIC_ROOM, MoveId.EMBER]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    expect(evaluate(MoveId.MAGIC_ROOM).damageScore).toBeLessThan(0);
  });

  it("only counts current-turn prevention if it acts first, including Trick Room", async () => {
    game.override
      .enemyMoveset(MoveId.EMBER)
      .enemyHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE, count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    player.setStat(Stat.SPD, 200);
    enemy.setStat(Stat.SPD, 100);
    const fast = evaluate().damageScore;
    player.setStat(Stat.SPD, 50);
    const slow = evaluate().damageScore;
    expect(fast).toBeGreaterThan(slow);
    expect(slow).toBeGreaterThan(0);
    game.scene.arena.addTag(ArenaTagType.TRICK_ROOM, 5, MoveId.TRICK_ROOM, player.id);
    expect(evaluate().damageScore).toBeCloseTo(fast);
  });

  it("accounts for defensive berries without consuming them", async () => {
    game.override
      .enemyHeldItems([{ name: "BERRY", type: BerryType.OCCA }])
      .enemySpecies(SpeciesId.BULBASAUR)
      .moveset([MoveId.EMBARGO, MoveId.EMBER]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    expect(evaluate().damageScore).toBeGreaterThan(0);
    expect(game.field.getEnemyPokemon().getHeldItems()[0].stackCount).toBe(1);
  });

  it("can cancel an unfavorable room, with less credit when it is about to expire", async () => {
    game.override.startingHeldItems([{ name: "LEFTOVERS", count: 4 }]).moveset([MoveId.MAGIC_ROOM, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const player = game.field.getPlayerPokemon();
    player.hp = Math.floor(player.getMaxHp() / 2);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, player.id);
    const five = evaluate(MoveId.MAGIC_ROOM).score;
    game.scene.arena.getTag(ArenaTagType.MAGIC_ROOM)!.turnCount = 1;
    const one = evaluate(MoveId.MAGIC_ROOM).score;
    expect(five).toBeGreaterThan(one);
    expect(one).toBeGreaterThan(0);
    player.addTag(BattlerTagType.EMBARGO, 5);
    expect(evaluate(MoveId.MAGIC_ROOM).score).toBe(0);
  });

  it("gives no extra credit for Embargo on an already suppressed target or exempt items", async () => {
    game.override.enemyHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    enemy.hp /= 2;
    enemy.addTag(BattlerTagType.EMBARGO, 5);
    expect(evaluate().score).toBe(0);
    expect(evaluate(MoveId.MAGIC_ROOM).score).toBe(0);
  });

  it("does not value disabling vitamins or other exempt equipment", async () => {
    game.override
      .enemyHeldItems([{ name: "BASE_STAT_BOOSTER", type: Stat.ATK }, { name: "LUCKY_EGG" }])
      .enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.MEW);
    expect(evaluate().score).toBe(0);
    expect(evaluate(MoveId.MAGIC_ROOM).score).toBe(0);
  });

  it("does not claim to prevent a knockout that happens before suppression", async () => {
    game.override
      .enemyMoveset(MoveId.EXTREME_SPEED)
      .enemyHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.NORMAL, count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    game.field.getPlayerPokemon().hp = 1;
    expect(evaluate().score).toBeLessThan(0);
  });

  it("leaves RNG, tags, stats, HP, PP, berries and the phase queue unchanged across forecasts", async () => {
    game.override
      .enemyMoveset(MoveId.EMBER)
      .enemyHeldItems([
        { name: "SOUL_DEW", count: 2 },
        { name: "SHELL_BELL" },
        { name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE, count: 3 },
      ])
      .startingHeldItems([{ name: "BERRY", type: BerryType.OCCA }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    enemy.setNature(Nature.MODEST);
    const field = game.scene.getField(true);
    game.move.changeMoveset(enemy, MoveId.EMBER);
    game.move.changeMoveset(game.field.getPlayerPokemon(), [MoveId.EMBARGO, MoveId.MAGIC_ROOM, MoveId.TACKLE]);
    const stats = field.map(pokemon => pokemon.stats);
    const snapshot = () =>
      JSON.stringify(
        field.map(pokemon => ({
          hp: pokemon.hp,
          stats: pokemon.stats,
          summon: pokemon.summonData,
          items: pokemon.getHeldItems().map(item => ({ ...item })),
          moves: pokemon.moveset,
        })),
      );
    const initial = snapshot();
    const seed = Phaser.Math.RND.state();
    const battleSeed = game.scene.currentBattle["battleSeedState"];
    const rng = vi.spyOn(game.scene, "randBattleSeedInt");
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    const first = evaluate();
    expect(evaluate()).toEqual(first);
    evaluate(MoveId.MAGIC_ROOM);
    expect(snapshot()).toBe(initial);
    field.forEach((pokemon, index) => expect(pokemon.stats).toBe(stats[index]));
    expect(Phaser.Math.RND.state()).toBe(seed);
    expect(game.scene.currentBattle["battleSeedState"]).toBe(battleSeed);
    expect(rng).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
  });

  it("restores the outer forecast after a nested evaluation throws", async () => {
    game.override.startingHeldItems([{ name: "SOUL_DEW", count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const player = game.field.getPlayerPokemon();
    player.setNature(Nature.MODEST);
    const stats = player.stats;
    const hp = player.hp;

    withHeldItemSuppressionForecast(new Map([[player, true]]), () => {
      const outerStats = player.stats;
      expect(areHeldItemEffectsSuppressed(player)).toBe(true);
      expect(() =>
        withHeldItemSuppressionForecast(new Map([[player, false]]), () => {
          expect(areHeldItemEffectsSuppressed(player)).toBe(false);
          expect(player.stats).toEqual(stats);
          throw new Error("nested forecast");
        }),
      ).toThrow("nested forecast");
      expect(areHeldItemEffectsSuppressed(player)).toBe(true);
      expect(player.stats).toBe(outerStats);
      expect(player.hp).toBe(hp);
    });

    expect(areHeldItemEffectsSuppressed(player)).toBe(false);
    expect(player.stats).toBe(stats);
    expect(player.hp).toBe(hp);
  });

  it("restores forecast state and Soul Dew stats even if evaluation throws", async () => {
    game.override.startingHeldItems([{ name: "SOUL_DEW", count: 2 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const player = game.field.getPlayerPokemon();
    player.setNature(Nature.MODEST);
    const stats = player.stats;
    const hp = player.hp;
    expect(() =>
      withHeldItemSuppressionForecast(new Map([[player, true]]), () => {
        expect(areHeldItemEffectsSuppressed(player)).toBe(true);
        expect(player.stats).not.toEqual(stats);
        throw new Error("forecast failure");
      }),
    ).toThrow("forecast failure");
    expect(areHeldItemEffectsSuppressed(player)).toBe(false);
    expect(player.stats).toBe(stats);
    expect(player.hp).toBe(hp);
  });

  it.each([
    MoveId.PRESENT,
    MoveId.PSYWAVE,
    MoveId.MAGNITUDE,
  ])("does not roll or activate random damage attributes: %s", async moveId => {
    game.override.enemyMoveset(moveId).enemyHeldItems([{ name: "SHELL_BELL" }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const enemy = game.field.getEnemyPokemon();
    game.move.changeMoveset(enemy, moveId);
    enemy.hp = Math.floor(enemy.getMaxHp() / 2);
    const turnData = JSON.stringify(enemy.turnData);
    const seed = Phaser.Math.RND.state();
    const rng = vi.spyOn(game.scene, "randBattleSeedInt");
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    const original = allMoves[moveId];
    const attrs = [...original.attrs];
    const randomDamage = original.getAttrs("RandomLevelDamageAttr")[0];
    const originalGetDamage = randomDamage?.getDamage;
    expect(evaluate()).toEqual(evaluate());
    expect(JSON.stringify(enemy.turnData)).toBe(turnData);
    expect(Phaser.Math.RND.state()).toBe(seed);
    expect(rng).not.toHaveBeenCalled();
    expect(queue).not.toHaveBeenCalled();
    expect(original.attrs).toEqual(attrs);
    expect(randomDamage?.getDamage).toBe(originalGetDamage);
  });

  it("stays neutral rather than invoking Legend Plate's stateful preview", async () => {
    game.override
      .enemySpecies(SpeciesId.ARCEUS)
      .enemyMoveset(MoveId.JUDGMENT)
      .enemyHeldItems([{ name: "FORM_CHANGE_ITEM", type: FormChangeItem.LEGEND_PLATE }, { name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const rng = vi.spyOn(game.scene, "randBattleSeedInt");
    expect(evaluate().score).toBe(0);
    expect(rng).not.toHaveBeenCalled();
  });

  it("uses the shared forecast for legacy AI and lets the planner choose worthwhile Embargo", async () => {
    game.override.enemyHeldItems([{ name: "LEFTOVERS", count: 4 }]);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = Math.floor(enemy.getMaxHp() / 2);
    const move = allMoves[MoveId.EMBARGO];
    expect(move.getTargetBenefitScore(player, enemy, move)).toBeLessThan(0);
    vi.spyOn(game.scene, "randBattleSeedInt").mockReturnValue(0);
    expect(choosePlannerMove(player, [new PokemonMove(MoveId.EMBARGO), new PokemonMove(MoveId.SPLASH)]).move).toBe(
      MoveId.EMBARGO,
    );
    enemy.hp = 1;
    expect(choosePlannerMove(player, [new PokemonMove(MoveId.EMBARGO), new PokemonMove(MoveId.TACKLE)]).move).toBe(
      MoveId.TACKLE,
    );
  });

  it("evaluates Magic Room just once per planner choice in doubles", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.MEW);
    const forecast = vi.spyOn(suppressionAi, "evaluateItemSuppression");
    choosePlannerMove(game.field.getPlayerPokemon(), [new PokemonMove(MoveId.MAGIC_ROOM)]);
    expect(forecast).toHaveBeenCalledTimes(1);
  });
});
