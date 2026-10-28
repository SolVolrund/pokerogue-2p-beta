import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { Pokemon } from "#field/pokemon";
import type { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { withHeldItemSuppressionForecast } from "#utils/held-item-suppression";
import { evaluateItemSuppression } from "#utils/held-item-suppression-ai";
import { areHeldItemEffectsSuppressed } from "#utils/held-item-suppression-state";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { refreshSoulBondHpForParties } from "#utils/soul-bond";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Destiny Knot suppression forecasts", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  function equip(pokemon: Pokemon) {
    const type = (getModifierType(modifierTypes.DESTINY_KNOT) as ModifierTypeGenerator).generateType(
      [pokemon],
      ["red"],
    )!;
    expect(
      game.scene.addModifier(
        type.newModifier(pokemon),
        false,
        false,
        false,
        true,
        undefined,
        game.scene.getPlayerIndexForPokemon(pokemon),
      ),
    ).toBe(true);
  }

  async function createPair(coop = false) {
    await game.runToTitle();
    game.scene.newBattle();
    if (coop) {
      game.scene.configureTwoPlayerMode(true, 6, false, 3);
    }
    const pair = [0, coop ? 2 : 0].map(owner => {
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MEW), 100, 0, 0);
      game.scene.getPlayerParty(owner as 0 | 2).push(pokemon);
      pokemon.calculateStats();
      equip(pokemon);
      return pokemon;
    });
    for (const pokemon of pair) {
      pokemon.hp = pokemon.getMaxHp();
    }
    return pair;
  }

  function snapshot(party: Pokemon[]) {
    return party.map(pokemon => ({
      pokemon,
      stats: pokemon.stats,
      values: [...pokemon.stats],
      hp: pokemon.hp,
      bonus: pokemon.soulBondHpBonus,
      maxHp: pokemon.getMaxHp(),
    }));
  }

  function expectRestored(saved: ReturnType<typeof snapshot>) {
    for (const { pokemon, stats, values, hp, bonus, maxHp } of saved) {
      expect(pokemon.stats).toBe(stats);
      expect(pokemon.stats).toEqual(values);
      expect(pokemon.hp).toBe(hp);
      expect(pokemon.soulBondHpBonus).toBe(bonus);
      expect(pokemon.getMaxHp()).toBe(maxHp);
    }
  }

  it.each([false, true])("rescales both holders when only one endpoint is suppressed (co-op: %s)", async coop => {
    const pair = await createPair(coop);
    const [a, b] = pair;
    a.hp = Math.floor(a.getMaxHp() / 2);
    b.hp = 1;
    const saved = snapshot(pair);
    const calculateA = vi.spyOn(a, "calculateStats");
    const calculateB = vi.spyOn(b, "calculateStats");

    const result = withHeldItemSuppressionForecast(new Map([[a, true]]), () => {
      for (const { pokemon, stats, hp, maxHp } of saved) {
        expect(pokemon.stats).toBe(stats);
        expect(pokemon.getMaxHp()).toBe(stats[Stat.HP]);
        expect(pokemon.hp).toBe(Math.max(1, Math.floor((hp * stats[Stat.HP]) / maxHp)));
        expect(pokemon.soulBondHpBonus).toBe(0);
      }
      return "forecast";
    });

    expect(result).toBe("forecast");
    expect(calculateA).not.toHaveBeenCalled();
    expect(calculateB).not.toHaveBeenCalled();
    expectRestored(saved);
  });

  it("finds both holders when restoring an already suppressed bond", async () => {
    const pair = await createPair(true);
    const [a] = pair;
    a.addTag(BattlerTagType.EMBARGO, 5);
    const saved = snapshot(pair);
    expect(saved.every(pokemon => pokemon.bonus === 0)).toBe(true);

    withHeldItemSuppressionForecast(new Map([[a, false]]), () => {
      for (const pokemon of pair) {
        expect(pokemon.soulBondHpBonus).toBeGreaterThan(0);
        expect(pokemon.hp).toBe(pokemon.getMaxHp());
      }
      expect(areHeldItemEffectsSuppressed(a)).toBe(false);
    });

    expect(areHeldItemEffectsSuppressed(a)).toBe(true);
    expectRestored(saved);
  });

  it("restores raw stats, HP and bonuses after nested forecasts throw", async () => {
    const pair = await createPair();
    const [a] = pair;
    a.setNature(Nature.MODEST);
    game.scene.addModifier(getModifierType(modifierTypes.SOUL_DEW).newModifier(a));
    const saved = snapshot(pair);

    expect(() =>
      withHeldItemSuppressionForecast(new Map([[a, true]]), () => {
        expect(a.stats).not.toBe(saved[0].stats);
        expect(a.stats).not.toEqual(saved[0].values);
        const outer = snapshot(pair);
        expect(() =>
          withHeldItemSuppressionForecast(new Map([[a, false]]), () => {
            expect(a.stats).toEqual(saved[0].values);
            expect(a.soulBondHpBonus).toBeGreaterThan(0);
            throw new Error("nested forecast");
          }),
        ).toThrow("nested forecast");
        expectRestored(outer);
        expect(areHeldItemEffectsSuppressed(a)).toBe(true);
        throw new Error("outer forecast");
      }),
    ).toThrow("outer forecast");

    expect(areHeldItemEffectsSuppressed(a)).toBe(false);
    expectRestored(saved);
  });

  it("restores snapshots even when raw-stat recalculation fails", async () => {
    const pair = await createPair();
    const [a] = pair;
    game.scene.addModifier(getModifierType(modifierTypes.SOUL_DEW).newModifier(a));
    const saved = snapshot(pair);
    vi.spyOn(a, "calculateStats").mockImplementation(() => {
      a.stats[Stat.ATK] = -1;
      a.hp = 1;
      a.soulBondHpBonus = 999;
      throw new Error("stat failure");
    });

    expect(() => withHeldItemSuppressionForecast(new Map([[a, true]]), () => {})).toThrow("stat failure");
    expect(areHeldItemEffectsSuppressed(a)).toBe(false);
    expectRestored(saved);
  });

  it("never revives a fainted holder while forecasting restoration", async () => {
    const pair = await createPair();
    const [a, b] = pair;
    a.addTag(BattlerTagType.EMBARGO, 5);
    a.hp = 1;
    b.hp = 0;
    refreshSoulBondHpForParties();
    const saved = snapshot(pair);

    withHeldItemSuppressionForecast(new Map([[a, false]]), () => {
      expect([a.hp, b.hp]).toEqual([1, 0]);
      expect([a.soulBondHpBonus, b.soulBondHpBonus]).toEqual([0, 0]);
    });
    expectRestored(saved);
  });

  it("does not copy raw stats or recalculate Pokemon without Threads or Soul Dew", async () => {
    await game.runToTitle();
    game.scene.newBattle();
    const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.MEW), 100, 0, 0);
    game.scene.getPlayerParty().push(pokemon);
    const saved = snapshot([pokemon]);
    const calculate = vi.spyOn(pokemon, "calculateStats");

    withHeldItemSuppressionForecast(new Map([[pokemon, true]]), () => {
      expect(areHeldItemEffectsSuppressed(pokemon)).toBe(true);
      expectRestored(saved);
    });
    expect(calculate).not.toHaveBeenCalled();
    expectRestored(saved);
  });

  it("scores a KO against the forecast HP rather than restored live HP", async () => {
    game.override
      .battleStyle("double")
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MEW)
      .enemyMoveset([MoveId.EMBARGO, MoveId.TACKLE])
      .moveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.MEW);
    const pair = game.scene.getPlayerParty();
    const [target, partner] = pair;
    const user = game.field.getEnemyPokemon();
    equip(target);
    equip(partner);
    for (const pokemon of pair) {
      pokemon.setStat(Stat.HP, 200);
      pokemon.soulBondHpBonus = 30;
      pokemon.hp = 230;
    }
    user.setStat(Stat.SPD, 1000);
    target.setStat(Stat.SPD, 1);
    const targetDamage = target.getAttackDamage.bind(target);
    vi.spyOn(target, "getAttackDamage").mockImplementation(args => ({ ...targetDamage(args), damage: 215 }));
    for (const pokemon of game.scene.getField(true).filter(pokemon => pokemon !== target)) {
      const damage = pokemon.getAttackDamage.bind(pokemon);
      vi.spyOn(pokemon, "getAttackDamage").mockImplementation(args => ({ ...damage(args), damage: 0 }));
    }
    const saved = snapshot([...pair, user]);

    expect(evaluateItemSuppression(user, target, allMoves[MoveId.EMBARGO]).survivalScore).toBe(100);
    expectRestored(saved);
  });
});
