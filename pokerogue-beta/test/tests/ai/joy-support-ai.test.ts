import { allAbilities, allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import { getAiMoveTargetData } from "#utils/ai-targeting";
import { choosePlannerMove } from "#utils/battle-planner-ai";
import { getJoyBattleSupportBonus } from "#utils/computer-partner-support";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Joy support battle AI", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .startingLevel(50)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.FLORAL_HEALING, MoveId.MOONBLAST]);
    await game.classicMode.startBattle(SpeciesId.COMFEY, SpeciesId.BLISSEY);
    const user = game.field.getPlayerPokemon();
    vi.spyOn(game.scene, "getPlayerIndexForPokemon").mockImplementation(pokemon => (pokemon === user ? 1 : 0));
    vi.spyOn(game.scene, "isComputerPartnerPlayer").mockImplementation(owner => owner === 1);
    vi.spyOn(game.scene, "getComputerPartnerKey").mockReturnValue("joy");
    vi.spyOn(game.scene, "randBattleSeedInt").mockReturnValue(0);
    game.move.changeMoveset(game.scene.getPlayerParty()[1], MoveId.SPLASH);
  });

  function bonus(move = MoveId.FLORAL_HEALING, value = 100, urgent = false) {
    return getJoyBattleSupportBonus(
      game.field.getPlayerPokemon(),
      game.scene.getPlayerParty()[1],
      allMoves[move],
      value,
      urgent,
    );
  }

  it("adds 15% to useful support without stacking or reducing negative scores", () => {
    const ally = game.scene.getPlayerParty()[1];
    ally.hp = Math.floor(ally.getMaxHp() / 2);
    expect(bonus()).toBe(15);
    expect(bonus(MoveId.HELPING_HAND)).toBe(15);
    expect(bonus(MoveId.FLORAL_HEALING, 0)).toBe(0);
    expect(bonus(MoveId.FLORAL_HEALING, -50)).toBe(0);
  });

  it("does not favor wasted healing or chip damage unless the heal prevents a KO", () => {
    const ally = game.scene.getPlayerParty()[1];
    ally.hp = ally.getMaxHp();
    expect(bonus()).toBe(0);
    ally.hp -= 1;
    expect(bonus()).toBe(0);
    expect(bonus(MoveId.FLORAL_HEALING, 100, true)).toBe(15);
    ally.hp = Math.floor(ally.getMaxHp() / 2);
    ally.addTag(BattlerTagType.HEAL_BLOCK, 5);
    expect(bonus()).toBe(0);
    expect(bonus(MoveId.FLORAL_HEALING, 100, true)).toBe(0);
    ally.hp = 0;
    expect(bonus()).toBe(0);
  });

  it("does not boost damaging moves, self-only setup or healing enemies", () => {
    const user = game.field.getPlayerPokemon();
    expect(bonus(MoveId.MOONBLAST)).toBe(0);
    expect(bonus(MoveId.DRAINING_KISS)).toBe(0);
    expect(getJoyBattleSupportBonus(user, user, allMoves[MoveId.CALM_MIND], 100)).toBe(0);
    expect(getJoyBattleSupportBonus(user, game.field.getEnemyPokemon(), allMoves[MoveId.FLORAL_HEALING], 100)).toBe(0);
  });

  it("does not apply Joy's battle personality to other partners or human players", () => {
    const ally = game.scene.getPlayerParty()[1];
    ally.hp = Math.floor(ally.getMaxHp() / 2);
    vi.mocked(game.scene.getComputerPartnerKey).mockReturnValue("cheryl");
    expect(bonus()).toBe(0);
    vi.mocked(game.scene.getComputerPartnerKey).mockReturnValue("joy");
    vi.mocked(game.scene.isComputerPartnerPlayer).mockReturnValue(false);
    expect(bonus()).toBe(0);
  });

  it("keeps allies available for healing without letting regular attacks target them", () => {
    const user = game.field.getPlayerPokemon();
    const ally = game.scene.getPlayerParty()[1];
    for (const id of [MoveId.FLORAL_HEALING, MoveId.HEAL_PULSE, MoveId.POLLEN_PUFF]) {
      expect(getAiMoveTargetData(user, id).selectableTargets).toContain(ally);
    }
    for (const id of [MoveId.MOONBLAST, MoveId.DRAINING_KISS, MoveId.GIGA_DRAIN]) {
      expect(getAiMoveTargetData(user, id).selectableTargets).not.toContain(ally);
    }
    expect(getAiMoveTargetData(user, MoveId.POLLEN_PUFF).selectableTargets).toContain(game.field.getEnemyPokemon());
  });

  it.each([AiType.PLANNER, AiType.SMART])("still takes a clear KO over healing chip damage (AI %i)", ai => {
    const user = game.field.getPlayerPokemon();
    user.aiType = ai;
    game.scene.plannerAiEnabled = true;
    game.scene.getPlayerParty()[1].hp -= 1;
    game.field.getEnemyPokemon().hp = 1;
    expect(user.getNextMove().move).toBe(MoveId.MOONBLAST);
  });

  it("uses Triage to heal an endangered ally before a faster attacker", () => {
    const user = game.field.getPlayerPokemon();
    const ally = game.scene.getPlayerParty()[1];
    const enemy = game.field.getEnemyPokemon();
    vi.spyOn(user, "getAbility").mockReturnValue(allAbilities[AbilityId.TRIAGE]);
    user.setStat(Stat.SPD, 1);
    enemy.setStat(Stat.SPD, 500);
    vi.spyOn(ally, "getMaxHp").mockReturnValue(100);
    ally.hp = 20;
    game.move.changeMoveset(enemy, MoveId.TACKLE);
    const incoming = ally.getAttackDamage.bind(ally);
    vi.spyOn(ally, "getAttackDamage").mockImplementation(args => ({ ...incoming(args), damage: 60 }));
    for (const opponent of game.scene.getEnemyParty()) {
      const outgoing = opponent.getAttackDamage.bind(opponent);
      vi.spyOn(opponent, "getAttackDamage").mockImplementation(args => ({ ...outgoing(args), damage: 1 }));
    }
    expect(allMoves[MoveId.FLORAL_HEALING].getPriority(user)).toBe(3);
    const decision = choosePlannerMove(user, user.getMoveset());
    expect(decision.move).toBe(MoveId.FLORAL_HEALING);
    expect(decision.targets).toEqual([ally.getBattlerIndex()]);
  });

  it("recognizes ally Pollen Puff as healing rather than friendly-fire damage", () => {
    const user = game.field.getPlayerPokemon();
    const ally = game.scene.getPlayerParty()[1];
    game.move.changeMoveset(user, [MoveId.POLLEN_PUFF, MoveId.SPLASH]);
    ally.hp = 1;
    for (const enemy of game.scene.getEnemyParty()) {
      const original = enemy.getAttackDamage.bind(enemy);
      vi.spyOn(enemy, "getAttackDamage").mockImplementation(args => ({ ...original(args), damage: 1 }));
    }
    expect(bonus(MoveId.POLLEN_PUFF)).toBe(15);
    const decision = choosePlannerMove(user, user.getMoveset());
    expect(decision.move).toBe(MoveId.POLLEN_PUFF);
    expect(decision.targets).toEqual([ally.getBattlerIndex()]);
  });
});
