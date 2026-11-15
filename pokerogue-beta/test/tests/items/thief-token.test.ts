import { modifierTypes } from "#data/data-lists";
import { getEnemyPlayerTokenRewardOptions, getVsEnemyTokenModifierTypeOptionsForWave } from "#data/vs-enemy-tokens";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { EnemyThiefTokenModifier } from "#modifiers/modifier";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import * as Common from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Thief Token", () => {
  let phaser: Phaser.Game;
  let game: GameManager;
  beforeAll(() => { phaser = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(() => {
    game = new GameManager(phaser);
    game.override.battleStyle("single").startingLevel(100).enemyLevel(10)
      .ability(AbilityId.UNNERVE).enemyAbility(AbilityId.UNNERVE)
      .enemySpecies(SpeciesId.PIDGEY).moveset(MoveId.SPLASH).enemyMoveset(MoveId.SWIFT)
      .startingHeldItems([{ name: "LEFTOVERS", count: 2 }]);
  });

  function token(count = 1) {
    const type = modifierTypes.ENEMY_THIEF().withIdFromFunc(modifierTypes.ENEMY_THIEF);
    const result = type.newModifier() as EnemyThiefTokenModifier;
    result.stackCount = count;
    return result;
  }

  it.each([[1, 0, true], [1, 1, false], [5, 4, true], [5, 5, false]] as const)(
    "%i stack(s), roll %i: theft = %s", async (count, roll, success) => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const enemy = game.field.getEnemyPokemon();
      const player = game.field.getPlayerPokemon();
      vi.spyOn(enemy, "randBattleSeedInt").mockReturnValue(0).mockReturnValueOnce(roll);
      expect(token(count).apply(enemy, player)).toBe(success);
      game.scene.recoverBattleTransferredHeldItems([0]);
      expect(player.getHeldItems()[0].stackCount).toBe(success ? 1 : 2);
      expect(enemy.getHeldItems().some(item => item.type.id === "LEFTOVERS" && item.stackCount === 1)).toBe(success);
    },
  );

  it.each([[MoveId.SWIFT, 1], [MoveId.DOUBLE_KICK, 2], [MoveId.GROWL, 0]])(
    "rolls on each successful attack hit, not on status moves (%i)", async (move, hits) => {
      game.override.enemyMoveset(move);
      await game.classicMode.startBattle(SpeciesId.SNORLAX);
      const thief = token();
      const apply = vi.spyOn(thief, "apply").mockReturnValue(false);
      await game.scene.addEnemyModifier(thief, true);
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(apply).toHaveBeenCalledTimes(hits);
    },
  );

  it("respects Sticky Hold and ignores friendly targets, player attackers and fainted thieves", async () => {
    game.override.ability(AbilityId.STICKY_HOLD);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    const player = game.field.getPlayerPokemon();
    vi.spyOn(enemy, "randBattleSeedInt").mockReturnValue(0);
    const thief = token();
    expect(thief.apply(enemy, player)).toBe(false);
    expect(player.getHeldItems()[0].stackCount).toBe(2);
    expect(thief.shouldApply(enemy, enemy)).toBe(false);
    expect(thief.shouldApply(player, enemy)).toBe(false);
    enemy.hp = 0;
    expect(thief.shouldApply(enemy, player)).toBe(false);
  });

  it("offers Rogue theft in EP and VS, stops at five, and preserves stacks on reload", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const thief = token(5);
    expect(thief.incrementStack(1, false)).toBe(false);
    const data = new ModifierData(JSON.parse(JSON.stringify(new ModifierData(thief, false))), false);
    expect(data.toModifier(EnemyThiefTokenModifier)).toMatchObject({ stackCount: 5, type: { id: "ENEMY_THIEF" } });
    const contains = (options: { type: { id: string } }[]) => options.some(o => o.type.id === "ENEMY_THIEF");
    expect(contains(getVsEnemyTokenModifierTypeOptionsForWave(110, 10))).toBe(false);
    expect(contains(getVsEnemyTokenModifierTypeOptionsForWave(111, 10))).toBe(true);
    expect(contains(getVsEnemyTokenModifierTypeOptionsForWave(111, 10, [thief]))).toBe(false);
    vi.spyOn(Common, "randSeedInt").mockImplementation(range => range === 1024 ? 1 : range - 1);
    expect(contains(getEnemyPlayerTokenRewardOptions(1))).toBe(true);
    expect(contains(getEnemyPlayerTokenRewardOptions(3, [thief]))).toBe(false);
  });
});
