import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { PokemonSummonData } from "#data/pokemon/pokemon-data";
import { NumberHolder } from "#utils/common";
import { resolveAbsentMoveTarget } from "#moves/move-utils";
import * as AiTargeting from "#utils/ai-targeting";
import { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Moves - Rollout", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => undefined);
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => undefined);
    game = new GameManager(phaserGame);
    game.override
      .criticalHits(false)
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.BIDOOF)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(100)
      .enemyLevel(100)
      .enemyMoveset(MoveId.SPLASH);
  });

  it.each([
    MoveId.ROLLOUT,
    MoveId.ICE_BALL,
  ])("locks move %i for five attacks, then starts a new scaling cycle", async moveId => {
    game.override.moveset([moveId, MoveId.SPLASH]);
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);

    const variance = 5;
    const turns = 7;
    const dmgHistory: number[] = [];

    await game.classicMode.startBattle(SpeciesId.RATTATA);

    const playerPkm = game.field.getPlayerPokemon();
    vi.spyOn(playerPkm, "stats", "get").mockReturnValue([500000, 1, 1, 1, 1, 1]); // HP, ATK, DEF, SPATK, SPDEF, SPD

    const enemyPkm = game.field.getEnemyPokemon();
    vi.spyOn(enemyPkm, "stats", "get").mockReturnValue([500000, 1, 1, 1, 1, 1]); // HP, ATK, DEF, SPATK, SPDEF, SPD
    vi.spyOn(enemyPkm, "getHeldItems").mockReturnValue([]); //no berries

    enemyPkm.hp = enemyPkm.getMaxHp();
    let previousHp = enemyPkm.hp;

    for (let i = 0; i < turns; i++) {
      if (i === 0 || i === 5) {
        game.move.select(moveId);
      }
      await game.toNextTurn();
      dmgHistory.push(previousHp - enemyPkm.hp);
      previousHp = enemyPkm.hp;
      expect(playerPkm.getMoveset()[0].ppUsed).toBe(i < 5 ? 1 : 2);
      expect(playerPkm.summonData.rollingMove?.count).toBe(i === 4 ? undefined : (i % 5) + 1);
      expect(playerPkm.getMoveQueue()).toHaveLength(i === 4 ? 0 : 1);
    }

    const [turn1Dmg, turn2Dmg, turn3Dmg, turn4Dmg, turn5Dmg, turn6Dmg] = dmgHistory;

    expect(turn2Dmg).toBeGreaterThanOrEqual(turn1Dmg * 2 - variance);
    expect(turn2Dmg).toBeLessThanOrEqual(turn1Dmg * 2 + variance);
    expect(turn3Dmg).toBeGreaterThanOrEqual(turn2Dmg * 2 - variance);
    expect(turn3Dmg).toBeLessThanOrEqual(turn2Dmg * 2 + variance);
    expect(turn4Dmg).toBeGreaterThanOrEqual(turn3Dmg * 2 - variance);
    expect(turn4Dmg).toBeLessThanOrEqual(turn3Dmg * 2 + variance);
    expect(turn5Dmg).toBeGreaterThanOrEqual(turn4Dmg * 2 - variance);
    expect(turn5Dmg).toBeLessThanOrEqual(turn4Dmg * 2 + variance);
    // reset
    expect(turn6Dmg).toBeGreaterThanOrEqual(turn1Dmg - variance);
    expect(turn6Dmg).toBeLessThanOrEqual(turn1Dmg + variance);
    expect(dmgHistory[6]).toBeGreaterThanOrEqual(turn2Dmg - variance);
    expect(dmgHistory[6]).toBeLessThanOrEqual(turn2Dmg + variance);
  });

  async function startRollingBattle(moveId: MoveId) {
    game.override.moveset([moveId, MoveId.DEFENSE_CURL, MoveId.SPLASH]);
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const user = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    vi.spyOn(target, "getMaxHp").mockReturnValue(100000);
    target.hp = 100000;
    return { user, target };
  }

  it.each([MoveId.ROLLOUT, MoveId.ICE_BALL])("ends %i after a miss and restarts at base power", async moveId => {
    const { user } = await startRollingBattle(moveId);
    game.move.select(moveId);
    await game.toNextTurn();
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(0);
    await game.toNextTurn();
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.getMoveQueue()).toEqual([]);
    expect(user.getMoveset()[0].ppUsed).toBe(1);
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
    game.move.select(moveId);
    await game.toNextTurn();
    expect(user.summonData.rollingMove?.count).toBe(1);
    expect(user.getMoveset()[0].ppUsed).toBe(2);
  });

  it.each([MoveId.ROLLOUT, MoveId.ICE_BALL])("ends %i when the target protects", async moveId => {
    const { user, target } = await startRollingBattle(moveId);
    game.move.select(moveId);
    await game.toNextTurn();
    target.addTag(BattlerTagType.PROTECTED, 1, MoveId.PROTECT, target.id);
    await game.toNextTurn();
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.getMoveQueue()).toEqual([]);
  });

  it.each([StatusEffect.SLEEP, StatusEffect.FREEZE])("ends the lock when status %i prevents acting", async status => {
    const { user } = await startRollingBattle(MoveId.ROLLOUT);
    game.move.select(MoveId.ROLLOUT);
    await game.toNextTurn();
    user.doSetStatus(status);
    if (status === StatusEffect.SLEEP) {
      user.status!.sleepTurnsRemaining = 10;
    } else {
      vi.spyOn(user, "randBattleSeedInt").mockReturnValue(99);
    }
    await game.toNextTurn();
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.getMoveQueue()).toEqual([]);
    expect(user.getMoveset()[0].ppUsed).toBe(1);
  });

  it.each([MoveId.ROLLOUT, MoveId.ICE_BALL])("ends %i when the target becomes immune", async moveId => {
    const { user, target } = await startRollingBattle(moveId);
    game.move.select(moveId);
    await game.toNextTurn();
    vi.spyOn(target, "getAbility").mockReturnValue(allAbilities[AbilityId.WONDER_GUARD]);
    await game.toNextTurn();
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.getMoveQueue()).toEqual([]);
  });

  it.each([
    MoveId.ROLLOUT,
    MoveId.ICE_BALL,
  ])("retargets %i after a faster ally's knockout, then returns to its original slot", async moveId => {
    game.override.battleStyle("double").moveset([moveId, MoveId.DRAGON_RAGE, MoveId.SPLASH]);
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
    await game.classicMode.startBattle(SpeciesId.RATTATA, SpeciesId.MAGIKARP);
    const user = game.field.getPlayerPokemon();
    const [first, second] = game.scene.getEnemyField();
    for (const target of [first, second]) {
      vi.spyOn(target, "getMaxHp").mockReturnValue(100000);
      target.hp = 100000;
    }
    first.hp = 1;
    game.move.select(moveId, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.DRAGON_RAGE, BattlerIndex.PLAYER_2, BattlerIndex.ENEMY);
    await game.setTurnOrder([BattlerIndex.PLAYER_2, BattlerIndex.PLAYER, BattlerIndex.ENEMY, BattlerIndex.ENEMY_2]);
    await game.toNextTurn();
    expect(first.isFainted()).toBe(true);
    expect(second.hp).toBeLessThan(100000);
    expect(user.summonData.rollingMove?.target).toBe(BattlerIndex.ENEMY);
    expect(user.getMoveQueue()[0].targets).toEqual([BattlerIndex.ENEMY]);
    const fallbackHp = second.hp;
    // Simulate a replacement occupying the original position before the next action.
    first.hp = 100000;
    first.resetStatus();
    first.switchOutStatus = false;
    game.scene.field.add(first);
    expect(first.isActive(true)).toBe(true);
    expect(game.scene.getField()[BattlerIndex.ENEMY].id).toBe(first.id);
    expect(resolveAbsentMoveTarget(user, allMoves[moveId], BattlerIndex.ENEMY)).toBe(BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toNextTurn();
    expect(user.getLastXMoves(1)[0].targets).toEqual([BattlerIndex.ENEMY]);
    expect(first.hp).toBeLessThan(100000);
    expect(second.hp).toBe(fallbackHp);
    expect(user.summonData.rollingMove?.count).toBe(2);
  });

  it.each([
    MoveId.ROLLOUT,
    MoveId.ICE_BALL,
  ])("locks an enemy using %i without spending continuation PP", async moveId => {
    game.override.enemyMoveset(moveId).moveset([MoveId.SPLASH]);
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
    await game.classicMode.startBattle(SpeciesId.RATTATA);
    const user = game.field.getEnemyPokemon();
    game.move.changeMoveset(user, moveId);
    const player = game.field.getPlayerPokemon();
    vi.spyOn(player, "getMaxHp").mockReturnValue(100000);
    player.hp = 100000;
    for (let count = 1; count <= 3; count++) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
      expect(user.summonData.rollingMove?.count).toBe(count);
      expect(user.getMoveset()[0].ppUsed).toBe(1);
      if (count === 1) {
        vi.spyOn(AiTargeting, "shouldAiRepositionToCenter").mockReturnValue(true);
      }
    }
  });

  it.each([MoveId.ROLLOUT, MoveId.ICE_BALL])("ends %i when only an out-of-range opponent remains", async moveId => {
    game.override.battleStyle("double").moveset([moveId, MoveId.SPLASH]);
    vi.spyOn(allMoves[moveId], "accuracy", "get").mockReturnValue(100);
    await game.classicMode.startBattle(SpeciesId.RATTATA, SpeciesId.MAGIKARP);
    const user = game.field.getPlayerPokemon();
    const [first, far] = game.scene.getEnemyField();
    first.hp = 100000;
    vi.spyOn(first, "getMaxHp").mockReturnValue(100000);
    game.move.select(moveId, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toNextTurn();
    // A triple field with the center empty and only the opposite edge still alive.
    vi.spyOn(game.scene.currentBattle, "getBattlerCount").mockReturnValue(3);
    user.fieldPosition = FieldPosition.LEFT;
    far.fieldPosition = FieldPosition.RIGHT;
    first.hp = 0;
    const farHp = far.hp;
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toNextTurn();
    expect(far.hp).toBe(farHp);
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.getMoveQueue()).toEqual([]);
    expect(user.getMoveset()[0].ppUsed).toBe(1);
  });

  it("clears the sequence when the battle ends", async () => {
    const { user, target } = await startRollingBattle(MoveId.ROLLOUT);
    target.hp = 1;
    game.move.select(MoveId.ROLLOUT);
    await game.toNextWave();
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.getMoveQueue()).toEqual([]);
  });

  it("continues after spending the final PP on the first attack", async () => {
    const { user } = await startRollingBattle(MoveId.ROLLOUT);
    game.move.changeMoveset(user, MoveId.ROLLOUT);
    const move = user.getMoveset()[0];
    move.ppUsed = move.getMovePp() - 1;
    game.move.select(MoveId.ROLLOUT);
    await game.toNextTurn();
    await game.toNextTurn();
    expect(user.summonData.rollingMove?.count).toBe(2);
    expect(move.ppUsed).toBe(move.getMovePp());
  });

  it("keeps a single Defense Curl multiplier through other moves and failed chains, but not switching", async () => {
    const { user, target } = await startRollingBattle(MoveId.ROLLOUT);
    user.setStatStage(Stat.DEF, 6);
    for (const moveId of [MoveId.DEFENSE_CURL, MoveId.DEFENSE_CURL, MoveId.SPLASH]) {
      game.move.select(moveId);
      await game.toNextTurn();
    }
    expect(user.summonData.defenseCurled).toBe(true);
    for (const moveId of [MoveId.ROLLOUT, MoveId.ICE_BALL]) {
      const move = allMoves[moveId];
      const power = new NumberHolder(30);
      move.getAttrs("RollingMovePowerAttr")[0].apply(user, target, move, [power]);
      expect(power.value).toBe(60);
    }
    game.move.select(MoveId.ROLLOUT);
    await game.toNextTurn();
    vi.spyOn(allMoves[MoveId.ROLLOUT], "accuracy", "get").mockReturnValue(0);
    await game.toNextTurn();
    expect(user.summonData.rollingMove).toBeUndefined();
    expect(user.summonData.defenseCurled).toBe(true);
    user.resetSummonData();
    expect(user.summonData.defenseCurled).toBe(false);
    expect(user.summonData.rollingMove).toBeUndefined();
  });

  it.each([MoveId.ROLLOUT, MoveId.ICE_BALL])("advances %i once per attack with Multi-Lens", async moveId => {
    game.override.startingHeldItems([{ name: "MULTI_LENS", count: 1 }]);
    const { user } = await startRollingBattle(moveId);
    const attr = allMoves[moveId].getAttrs("RollingMovePowerAttr")[0];
    const apply = vi.spyOn(attr, "apply");
    game.move.select(moveId);
    await game.toNextTurn();
    expect(user.getLastXMoves(2).every(entry => entry.move === moveId)).toBe(true);
    expect(user.summonData.rollingMove?.count).toBe(1);
    expect(user.getMoveQueue()).toHaveLength(1);
    expect(apply).toHaveBeenCalled();
    await game.toNextTurn();
    expect(user.summonData.rollingMove?.count).toBe(2);
    expect(user.getMoveset()[0].ppUsed).toBe(1);
  });

  it("round-trips independent per-Pokemon state through summon data serialization", () => {
    const first = new PokemonSummonData();
    first.defenseCurled = true;
    first.rollingMove = { move: MoveId.ROLLOUT, count: 2, target: BattlerIndex.ENEMY };
    const restored = new PokemonSummonData(JSON.parse(JSON.stringify(first)));
    const copied = new PokemonSummonData(first);
    const other = new PokemonSummonData();
    expect(restored.rollingMove).toEqual(first.rollingMove);
    expect(restored.defenseCurled).toBe(true);
    copied.rollingMove!.count++;
    expect(first.rollingMove.count).toBe(2);
    expect(other.rollingMove).toBeUndefined();
    expect(other.defenseCurled).toBe(false);
  });
});
