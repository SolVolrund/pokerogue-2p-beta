import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import type { Move, ShellSideArmCategoryAttr } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Moves - Shell Side Arm", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let shellSideArm: Move;
  let shellSideArmAttr: ShellSideArmCategoryAttr;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    shellSideArm = allMoves[MoveId.SHELL_SIDE_ARM];
    shellSideArmAttr = shellSideArm.getAttrs("ShellSideArmCategoryAttr")[0];
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .ability(AbilityId.BALL_FETCH)
      .criticalHits(false)
      .moveset([MoveId.SHELL_SIDE_ARM, MoveId.SPLASH])
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("becomes a physical attack if forecasted to deal more damage as physical", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX);

    await game.classicMode.startBattle(SpeciesId.RAMPARDOS);

    vi.spyOn(shellSideArmAttr, "apply");

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(shellSideArmAttr.apply).toHaveLastReturnedWith(true);
  });

  it("remains a special attack if forecasted to deal more damage as special", async () => {
    game.override.enemySpecies(SpeciesId.SLOWBRO);

    await game.classicMode.startBattle(SpeciesId.XURKITREE);

    vi.spyOn(shellSideArmAttr, "apply");

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(shellSideArmAttr.apply).toHaveLastReturnedWith(false);
  });

  it("respects stat stage changes when forecasting base damage", async () => {
    game.override.enemySpecies(SpeciesId.SNORLAX).enemyMoveset(MoveId.COTTON_GUARD);

    await game.classicMode.startBattle(SpeciesId.MANAPHY);

    vi.spyOn(shellSideArmAttr, "apply");

    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();

    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
    await game.phaseInterceptor.to("BerryPhase", false);

    expect(shellSideArmAttr.apply).toHaveLastReturnedWith(false);
  });

  async function startWithStats(attack = 150, specialAttack = 100, defense = 100, specialDefense = 100) {
    game.override.enemySpecies(SpeciesId.SNORLAX);
    await game.classicMode.startBattle(SpeciesId.SLOWBRO);
    const user = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    user.setStat(Stat.ATK, attack);
    user.setStat(Stat.SPATK, specialAttack);
    target.setStat(Stat.DEF, defense);
    target.setStat(Stat.SPDEF, specialDefense);
    return { user, target };
  }

  it.each([
    [150, 100, 100, 100, MoveCategory.PHYSICAL],
    [150, 100, 300, 100, MoveCategory.SPECIAL],
    [100, 150, 100, 300, MoveCategory.PHYSICAL],
    [100, 150, 100, 100, MoveCategory.SPECIAL],
  ])("compares both offenses and defenses (%i/%i vs %i/%i)", async (atk, spa, def, spd, category) => {
    const { user, target } = await startWithStats(atk, spa, def, spd);
    expect(user.getMoveCategory(target, shellSideArm)).toBe(category);
    expect(shellSideArm.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target }))
      .toBe(category === MoveCategory.PHYSICAL);
  });

  it("respects transformed stats and stat stages", async () => {
    const { user, target } = await startWithStats();
    target.setStatStage(Stat.DEF, 2);
    expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.SPECIAL);
    user.setStatStage(Stat.ATK, 2);
    expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.PHYSICAL);
    user.setStat(Stat.SPATK, 500, false);
    expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.SPECIAL);
  });

  it.each([AbilityId.HUGE_POWER, AbilityId.TABLETS_OF_RUIN])("ignores offensive abilities (%i) in the forecast", async ability => {
    game.override.ability(ability);
    const { user, target } = await startWithStats(100, 150);
    expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.SPECIAL);
  });

  it.each([AbilityId.FUR_COAT, AbilityId.ICE_SCALES, AbilityId.VESSEL_OF_RUIN])(
    "ignores defensive abilities (%i) in the forecast", async ability => {
      game.override.enemyAbility(ability);
      const { user, target } = await startWithStats();
      expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.PHYSICAL);
    },
  );

  it("does not consult effective-stat or power modifiers when forecasting", async () => {
    const { user, target } = await startWithStats();
    const offense = vi.spyOn(user, "getEffectiveStat");
    const defense = vi.spyOn(target, "getEffectiveStat");
    const power = vi.spyOn(shellSideArm, "calculateBattlePower");
    expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.PHYSICAL);
    expect(offense).not.toHaveBeenCalled();
    expect(defense).not.toHaveBeenCalled();
    expect(power).not.toHaveBeenCalled();
  });

  it.each([WeatherType.SANDSTORM, WeatherType.SNOW])("ignores weather (%i) in the forecast", async weather => {
    const { user, target } = await startWithStats(100, 120);
    game.scene.arena.trySetWeather(weather);
    expect(user.getMoveCategory(target, shellSideArm)).toBe(MoveCategory.SPECIAL);
  });

  it.each([0, 1])("resolves rounded ties once with seeded roll %i without changing the shared move", async roll => {
    const { user, target } = await startWithStats(100, 101, 300, 300);
    const rng = vi.spyOn(user, "randBattleSeedInt").mockReturnValue(roll);
    // These previews must not consume RNG before the attack is actually executed.
    user.getMoveCategory(target, shellSideArm);
    shellSideArm.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target });
    expect(rng).not.toHaveBeenCalled();
    const resolved = shellSideArmAttr.resolveMove(user, target, shellSideArm);
    const expectedCategory = roll === 0 ? MoveCategory.PHYSICAL : MoveCategory.SPECIAL;
    expect(resolved.category).toBe(expectedCategory);
    expect(resolved.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(roll === 0);
    for (let i = 0; i < 4; i++) {
      expect(user.getMoveCategory(target, resolved)).toBe(expectedCategory);
      expect(resolved.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target })).toBe(roll === 0);
    }
    expect(rng).toHaveBeenCalledExactlyOnceWith(2);
    expect(shellSideArm.category).toBe(MoveCategory.SPECIAL);
    expect(shellSideArm.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
    expect(shellSideArm.hasAttr("ShellSideArmCategoryAttr")).toBe(true);
    expect(resolved.hasAttr("StatusEffectAttr")).toBe(true);
    expect(shellSideArm.name).not.toContain("(P)");
  });

  it("keeps separate users and targets independent", async () => {
    const { user, target } = await startWithStats();
    const first = shellSideArmAttr.resolveMove(user, target, shellSideArm);
    user.setStat(Stat.DEF, 300);
    user.setStat(Stat.SPDEF, 50);
    const second = shellSideArmAttr.resolveMove(target, user, shellSideArm);
    expect(first.category).toBe(MoveCategory.PHYSICAL);
    expect(second.category).toBe(MoveCategory.SPECIAL);
    expect(first.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(true);
    expect(second.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
  });

  it.each([true, false])("only triggers Rough Skin for the physical version (physical=%s)", async physical => {
    game.override.enemyAbility(AbilityId.ROUGH_SKIN);
    const { user } = await startWithStats(physical ? 150 : 50);
    const initialHp = user.hp;
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(user.hp < initialHp).toBe(physical);
  });

  it("allows Long Reach to suppress physical contact", async () => {
    game.override.ability(AbilityId.LONG_REACH).enemyAbility(AbilityId.ROUGH_SKIN);
    const { user } = await startWithStats();
    const initialHp = user.hp;
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(user.hp).toBe(initialHp);
  });

  it("does not trigger contact effects through a substitute", async () => {
    game.override.enemyAbility(AbilityId.ROUGH_SKIN);
    const { user, target } = await startWithStats();
    target.addTag(BattlerTagType.SUBSTITUTE, 0, MoveId.SUBSTITUTE, target.id);
    const initialHp = user.hp;
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(user.hp).toBe(initialHp);
  });

  it.each([true, false])("Unseen Fist bypasses Protect only when physical (physical=%s)", async physical => {
    game.override.ability(AbilityId.UNSEEN_FIST).enemyMoveset(MoveId.PROTECT);
    const { target } = await startWithStats(physical ? 150 : 50);
    const initialHp = target.hp;
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(target.hp < initialHp).toBe(physical);
  });

  it("retains the resolved category across Multi-Lens hits and resolves afresh next turn", async () => {
    game.override.startingHeldItems([{ name: "MULTI_LENS", count: 1 }]);
    const { target } = await startWithStats();
    target.setStat(Stat.HP, 10000);
    target.hp = 10000;
    const resolve = vi.spyOn(shellSideArmAttr, "resolveMove");
    const damage = vi.spyOn(target, "getAttackDamage");
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("MoveEndPhase", false);
    expect(resolve).toHaveBeenCalledOnce();
    const first = resolve.mock.results[0].value as Move;
    expect(first.category).toBe(MoveCategory.PHYSICAL);
    expect(damage.mock.calls).toHaveLength(2);
    expect(damage.mock.calls.every(([params]) => params.move === first)).toBe(true);
    await game.toNextTurn();
    target.setStat(Stat.DEF, 1000);
    resolve.mockClear();
    damage.mockClear();
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("MoveEndPhase", false);
    expect(resolve).toHaveBeenCalledOnce();
    const second = resolve.mock.results[0].value as Move;
    expect(second).not.toBe(first);
    expect(second.category).toBe(MoveCategory.SPECIAL);
    expect(second.hasFlag(MoveFlags.MAKES_CONTACT)).toBe(false);
    expect(damage.mock.calls).toHaveLength(2);
    expect(damage.mock.calls.every(([params]) => params.move === second)).toBe(true);
    expect(first.category).toBe(MoveCategory.PHYSICAL);
  });

  it.each([true, false])("retains the poison effect in both categories (physical=%s)", async physical => {
    const { target } = await startWithStats(physical ? 150 : 50);
    expect(shellSideArm.chance).toBe(20);
    vi.spyOn(shellSideArm, "chance", "get").mockReturnValue(100);
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(target.status?.effect).toBe(StatusEffect.POISON);
  });

  it.each([
    [true, MoveId.COUNTER, true],
    [false, MoveId.COUNTER, false],
    [true, MoveId.MIRROR_COAT, false],
    [false, MoveId.MIRROR_COAT, true],
  ])("records the actual category for retaliation (physical=%s, move=%i)", async (physical, retaliation, hits) => {
    game.override.enemyMoveset(retaliation as MoveId);
    const { user, target } = await startWithStats(physical ? 150 : 50);
    const initialHp = user.hp;
    game.move.select(MoveId.SHELL_SIDE_ARM);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(target.turnData.attacksReceived[0].category).toBe(physical ? MoveCategory.PHYSICAL : MoveCategory.SPECIAL);
    expect(user.hp < initialHp).toBe(hits);
  });
});
