import { getGameMode } from "#app/game-mode";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { arePokemonMoveTargetsAdjacent } from "#moves/move-utils";
import { SeasonalEncounterState } from "#data/seasonal-encounters";
import { AbilityId } from "#enums/ability-id";
import { BattleType } from "#enums/battle-type";
import { BiomeId } from "#enums/biome-id";
import { FieldPosition } from "#enums/field-position";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { SwitchType } from "#enums/switch-type";
import { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { BaseStatModifier, type PersistentModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import { GreatHauntPhase } from "#phases/great-haunt-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { AttemptCapturePhase } from "#phases/attempt-capture-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getCloneBallBattleBlockMessage } from "#utils/clone-ball";
import {
  cancelGreatHauntTurn,
  createGreatHauntBoss,
  createGreatHauntClone,
  ensureGreatHauntBossBulk,
  recordGreatHauntFaint,
  getGreatHauntCaptureBlock,
} from "#utils/great-haunt-utils";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Great Haunt", () => {
  let phaser: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaser = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaser);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    game.scene.seasonalEncounters = new SeasonalEncounterState({ active: true });
    game.scene.newBattle();
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
  });

  function setup(count: 1 | 2 | 3) {
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    for (const owner of game.scene.getActivePlayerIndexes()) {
      for (let i = 0; i < 2; i++) {
        const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50);
        game.scene.getPlayerParty(owner).push(pokemon);
      }
      const skull = getModifierType(modifierTypes.PORTENT_SKULL).newModifier() as PersistentModifier;
      game.scene.getPlayerModifiers(owner).push(skull);
    }
    game.scene.seasonalEncounters.enterTower(51);
    game.scene.newArena(BiomeId.POKEMON_TOWER);
    const battle = game.scene.newBattle();
    battle.enemyParty = [createGreatHauntBoss(true)];
    return battle;
  }

  it.each([1, 2, 3] as const)("cancels the complete old turn while preserving %iP transition phases", count => {
    const battle = setup(count);
    const manager = game.scene.phaseManager;
    manager.clearAllPhases();
    for (const owner of game.scene.getActivePlayerIndexes()) {
      manager.pushNew(
        "MovePhase",
        game.scene.getPlayerParty(owner)[0],
        [],
        new PokemonMove(MoveId.SPLASH),
        MoveUseMode.NORMAL,
      );
    }
    manager.pushNew("MovePhase", battle.enemyParty[0], [], new PokemonMove(MoveId.SPLASH), MoveUseMode.NORMAL);
    manager.pushNew("CheckInterludePhase");
    manager.queueTurnEndPhases();
    manager.pushNew("TurnInitPhase");
    manager.pushNew("TurnStartPhase");
    const message = manager.create("MessagePhase", "Transition");
    const faint = manager.create("FaintPhase", battle.enemyParty[0].getBattlerIndex());
    const reserve = manager.create("SwitchSummonPhase", SwitchType.SWITCH, 0, 1, false, true);
    const summon = manager.create("SummonPhase", 0, false);
    manager.pushPhase(message, faint, reserve, summon);

    cancelGreatHauntTurn();

    expect(manager.hasPhaseOfType("MovePhase")).toBe(false);
    expect(manager.hasPhaseOfType("DynamicPhaseMarker", p => p.phaseType === "MovePhase")).toBe(false);
    for (const expected of [message, faint, reserve, summon]) {
      manager.shiftPhase();
      expect(manager.getCurrentPhase()).toBe(expected);
    }
    manager.shiftPhase();
    expect(manager.getCurrentPhase().phaseName).toBe("TurnInitPhase");
  });

  it.each([1, 2, 3] as const)("creates one shared three-bar boss with %i-player bulk", count => {
    const battle = setup(count);
    const ghost = battle.enemyParty[0];
    expect(battle.battleType).toBe(BattleType.WILD);
    expect(battle.enemyLevels).toHaveLength(1);
    expect(battle.getBattlerCount()).toBe(count);
    expect(ghost.bossSegments).toBe(3);
    expect(ghost.getAbility().id).toBe(AbilityId.GRAVE_WIND);
    expect(ghost.getPassiveAbility().id).toBe(AbilityId.RESTLESS_SPIRIT);
    expect(ghost.hasPassive()).toBe(true);
    expect(ghost.isHaunted()).toBe(true);
    expect(ghost.getNameToRender()).toBe("Great Haunt");
    expect(ghost.getMoveset().map(m => m.moveId)).toEqual([
      MoveId.BLIZZARD,
      MoveId.DOUBLE_TEAM,
      MoveId.SHADOW_BONE,
      MoveId.BONEMERANG,
    ]);
    expect(
      ghost
        .getHeldItems()
        .filter(m => m instanceof BaseStatModifier)
        .map(m => m.stackCount),
    ).toEqual([5 * count, 5 * count, 5 * count]);
    expect(
      ghost
        .getHeldItems()
        .filter(m => m instanceof BaseStatModifier)
        .map(m => m.getArgs().at(-1)),
    ).toEqual([Stat.HP, Stat.DEF, Stat.SPDEF]);
    ghost.setFieldPosition(FieldPosition.CENTER);
    for (const owner of game.scene.getActivePlayerIndexes()) {
      const pokemon = game.scene.getPlayerParty(owner)[0];
      pokemon.setFieldPosition(owner === 1 ? FieldPosition.RIGHT : FieldPosition.LEFT);
      expect(arePokemonMoveTargetsAdjacent(pokemon, ghost)).toBe(true);
    }
  });

  it("deduplicates first-stage faints and produces independent, healed, itemless clones", () => {
    const battle = setup(1);
    const source = game.scene.getPlayerParty()[0];
    source.hp = 0;
    source.summonData.statStages[0] = 6;
    recordGreatHauntFaint(source);
    recordGreatHauntFaint(source);
    expect(battle.greatHauntState!.fallen).toHaveLength(1);
    const clone = createGreatHauntClone(battle.greatHauntState!.fallen[0]);
    expect(clone.id).not.toBe(source.id);
    expect(clone.isFullHp()).toBe(true);
    expect(clone.status).toBeNull();
    expect(clone.getStatStages()).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(clone.getHeldItems()).toHaveLength(0);
    expect(clone.isBoss()).toBe(false);
    expect(clone.isHaunted()).toBe(true);
    clone.ivs[Stat.ATK] = -1;
    expect(source.ivs[Stat.ATK]).not.toBe(-1);
    battle.greatHauntState!.stage = "clones";
    recordGreatHauntFaint(game.scene.getPlayerParty()[1]);
    expect(battle.greatHauntState!.fallen).toHaveLength(1);
  });

  it("reserves retired boss IDs when assigning clone IDs", () => {
    const battle = setup(2);
    const state = battle.greatHauntState!;
    recordGreatHauntFaint(game.scene.getPlayerParty()[0]);
    state.marowakId = (state.ghostId! + 1) >>> 0;
    battle.enemyParty = [];
    for (let i = 0; i < 2; i++) {
      vi.spyOn(Phaser.Math.RND, "integerInRange").mockReturnValueOnce(state.ghostId!);
      const clone = createGreatHauntClone(state.fallen[0]);
      expect(clone.id).not.toBe(state.ghostId);
      expect(clone.id).not.toBe(state.marowakId);
      expect(battle.enemyParty.some(p => p.id === clone.id)).toBe(false);
      battle.enemyParty.push(clone);
    }
  });

  it.each([
    true,
    undefined,
  ])("does not rebuild clones after an ID collision and later player faint (saved flag: %s)", async flag => {
    const battle = setup(2);
    const state = battle.greatHauntState!;
    for (const owner of game.scene.getActivePlayerIndexes()) {
      recordGreatHauntFaint(game.scene.getPlayerParty(owner)[0]);
    }
    state.stage = "clones";
    if (flag !== undefined) state.clonesSpawned = flag;
    battle.enemyParty = [];
    for (const snapshot of state.fallen) battle.enemyParty.push(createGreatHauntClone(snapshot));
    const originalClones = [...battle.enemyParty];
    // Reproduce an old clone sharing the retired ghost's ID, even after a save round trip.
    state.ghostId = originalClones[1].id;
    battle.greatHauntState = JSON.parse(JSON.stringify(state));
    originalClones[0].hp = 0;
    const laterVictim = game.scene.getPlayerParty(1)[1];
    laterVictim.hp = 0;
    recordGreatHauntFaint(laterVictim);
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const message = vi.spyOn(game.scene.phaseManager, "queueMessage");

    await new GreatHauntPhase()["advance"]();

    expect(battle.enemyParty[0]).toBe(originalClones[0]);
    expect(battle.enemyParty[1]).toBe(originalClones[1]);
    expect(originalClones[0].hp).toBe(0);
    expect(battle.greatHauntState!.fallen).toHaveLength(2);
    expect(battle.greatHauntState!.clonesSpawned).toBe(true);
    expect(message).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalledWith("SummonPhase", 0, false);
    originalClones[1].hp = 0;
    await new GreatHauntPhase()["advance"]();
    expect(battle.greatHauntState!.stage).toBe("marowak");
    const marowak = battle.enemyParty[0];
    await new GreatHauntPhase()["advance"]();
    expect(battle.enemyParty[0]).toBe(marowak);
  });

  it.each([
    1, 2, 3,
  ] as const)("forces every active Pokemon down, then reveals Marowak only after clones in %iP", async count => {
    const battle = setup(count);
    const state = battle.greatHauntState!;
    const victims = game.scene.getActivePlayerIndexes().map(p => game.scene.getPlayerParty(p)[0]);
    victims.forEach(p => vi.spyOn(p, "isOnField").mockReturnValue(true));
    battle.enemyParty[0].hp = 0;
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    const unshift = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await new GreatHauntPhase()["advance"]();
    expect(state.stage).toBe("clones");
    expect(state.forcedFaintIds).toEqual(victims.map(p => p.id));
    expect(victims.every(p => p.hp === 0)).toBe(true);
    expect(unshift.mock.calls.filter(c => c[0] === "FaintPhase")).toHaveLength(count);
    await new GreatHauntPhase()["advance"]();
    expect(battle.enemyParty).toHaveLength(count);
    expect(battle.enemyParty.every(p => !p.isBoss() && p.haunted)).toBe(true);
    expect(push.mock.calls.filter(c => c[0] === "SummonPhase")).toHaveLength(count);
    await new GreatHauntPhase()["advance"]();
    expect(state.stage).toBe("clones");
    battle.enemyParty.forEach(p => {
      p.hp = 0;
    });
    await new GreatHauntPhase()["advance"]();
    expect(state.stage).toBe("marowak");
    expect(battle.enemyParty).toHaveLength(1);
    expect(battle.enemyParty[0].bossSegments).toBe(6);
    expect(battle.enemyParty[0].id).toBe(state.marowakId);
    expect(
      battle.enemyParty[0]
        .getHeldItems()
        .filter(m => m instanceof BaseStatModifier)
        .map(m => [m.getArgs().at(-1), m.stackCount]),
    ).toEqual([
      [Stat.HP, 5 * count],
      [Stat.DEF, 5 * count],
      [Stat.SPDEF, 5 * count],
    ]);
  });

  it("ends the run when Destiny Bond leaves nobody with a reserve", async () => {
    const battle = setup(2);
    for (const owner of game.scene.getActivePlayerIndexes()) {
      game.scene.getPlayerParty(owner).forEach(p => {
        p.hp = 0;
      });
    }
    battle.greatHauntState!.stage = "clones";
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    await new GreatHauntPhase()["advance"]();
    expect(queue).toHaveBeenCalledWith("GameOverPhase");
  });

  it("returns stolen player items before discarding a finished stage", async () => {
    const battle = setup(1);
    const source = game.scene.getPlayerParty()[0];
    const ghost = battle.enemyParty[0];
    recordGreatHauntFaint(source);
    const item = getModifierType(modifierTypes.LEFTOVERS).newModifier(ghost) as PokemonHeldItemModifier;
    item.recoverableBattleTransfer = { pokemonId: source.id, playerIndex: 0 };
    await game.scene.addEnemyModifier(item, true, true);
    ghost.hp = 0;
    battle.addPostBattleLoot(ghost);
    battle.greatHauntState!.stage = "clones";
    await new GreatHauntPhase()["advance"]();
    expect(source.getHeldItems().some(m => m.type.id === "LEFTOVERS")).toBe(true);
  });

  it.each([
    true,
    false,
  ])("backfills an older saved boss's missing Zinc without duplicating vitamins (disguised: %s)", async disguised => {
    const battle = setup(2);
    const boss = disguised ? battle.enemyParty[0] : createGreatHauntBoss(false);
    battle.enemyParty = [boss];
    battle.greatHauntState!.stage = disguised ? "ghost" : "marowak";
    const zinc = boss.getHeldItems().find(m => m instanceof BaseStatModifier && m.getArgs().at(-1) === Stat.SPDEF)!;
    game.scene.removeModifier(zinc, true);
    boss.calculateStats();
    boss.hp = 1;
    const oldSpDef = boss.stats[Stat.SPDEF];
    vi.spyOn(game.scene.gameData, "saveAll").mockResolvedValue(true);
    vi.spyOn(game.scene.gameData, "setPokemonSeen").mockResolvedValue(undefined);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const encounter = new EncounterPhase(true);
    const run = vi.spyOn(encounter as any, "doEncounter").mockImplementation(() => {});

    encounter.start();
    await vi.waitFor(() => expect(run).toHaveBeenCalled());

    expect(
      boss
        .getHeldItems()
        .filter(m => m instanceof BaseStatModifier)
        .map(m => m.stackCount),
    ).toEqual([10, 10, 10]);
    expect(boss.stats[Stat.SPDEF]).toBeGreaterThan(oldSpDef);
    expect(boss.hp).toBe(1);
    expect(ensureGreatHauntBossBulk(boss)).toBe(false);
    expect(
      boss
        .getHeldItems()
        .filter(m => m instanceof BaseStatModifier)
        .map(m => m.stackCount),
    ).toEqual([10, 10, 10]);
  });

  it("fills two empty lanes from distinct clone reserves without revealing Marowak early", async () => {
    const battle = setup(2);
    const state = battle.greatHauntState!;
    state.stage = "clones";
    const source = new PokemonData(game.scene.getPlayerParty()[0]);
    battle.enemyParty = [];
    for (let i = 0; i < 4; i++) battle.enemyParty.push(createGreatHauntClone(source));
    battle.enemyParty[0].hp = 0;
    battle.enemyParty[1].hp = 0;
    const push = vi.spyOn(game.scene.phaseManager, "pushNew");
    await new GreatHauntPhase()["advance"]();
    expect(push).toHaveBeenCalledWith("SwitchSummonPhase", SwitchType.SWITCH, 0, 2, false, false);
    expect(push).toHaveBeenCalledWith("SwitchSummonPhase", SwitchType.SWITCH, 1, 3, false, false);
    expect(state.stage).toBe("clones");
  });

  it("blocks all disguise/clone captures and Master Ball bypasses, including direct attempts", () => {
    const battle = setup(1);
    const ghost = battle.enemyParty[0];
    const balls = game.scene.getPlayerPokeballCounts(0);
    balls[PokeballType.MASTER_BALL] = 1;
    vi.spyOn(ghost, "isActive").mockReturnValue(true);
    expect(getCloneBallBattleBlockMessage()).toBeDefined();
    new AttemptCapturePhase(0, PokeballType.MASTER_BALL).start();
    expect(balls[PokeballType.MASTER_BALL]).toBe(1);
    battle.greatHauntState!.stage = "marowak";
    const boss = createGreatHauntBoss(false);
    expect(getGreatHauntCaptureBlock(boss, PokeballType.MASTER_BALL)).toBeDefined();
    boss.bossSegmentIndex = 0;
    expect(getGreatHauntCaptureBlock(boss, PokeballType.POKEBALL)).toBeUndefined();
    expect(getGreatHauntCaptureBlock(boss, PokeballType.MASTER_BALL)).toBeUndefined();
    expect(getGreatHauntCaptureBlock(boss, PokeballType.CLONE_BALL)).toBeDefined();
    const data = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(boss))));
    data.player = true;
    const captured = data.toPokemon();
    expect(captured.getAbility().id).toBe(AbilityId.GRAVE_WIND);
    expect(captured.getPassiveAbility().id).toBe(AbilityId.RESTLESS_SPIRIT);
    expect(captured.passive).toBe(true);
  });

  it("does not complete the battle on disguise or clone victory", () => {
    const battle = setup(1);
    const ghost = battle.enemyParty[0];
    ghost.hp = 0;
    const phase = new VictoryPhase(ghost.getBattlerIndex());
    vi.spyOn(phase, "getPokemon").mockReturnValue(ghost);
    vi.spyOn(game.scene, "applyPartyExp").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    phase.start();
    expect(queue).not.toHaveBeenCalledWith("BattleEndPhase", true);
  });

  it.each([
    1, 2, 3,
  ] as const)("restores a %iP Great Haunt without generating extra enemies or losing state", async count => {
    const battle = setup(count);
    recordGreatHauntFaint(game.scene.getPlayerParty()[0]);
    const ghost = battle.enemyParty[0];
    vi.spyOn(game.scene.gameData, "saveAll").mockResolvedValue(true);
    vi.spyOn(game.scene.gameData, "setPokemonSeen").mockResolvedValue(undefined);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue(undefined);
    const encounter = new EncounterPhase(false);
    const run = vi.spyOn(encounter as any, "doEncounter").mockImplementation(() => {});
    encounter.start();
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(ghost.fieldPosition).toBe(FieldPosition.CENTER);
    const snapshot = JSON.stringify(game.scene.gameData.getSessionSaveData(), (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    await game.scene.gameData.loadSessionSnapshot(snapshot);
    expect(game.scene.currentBattle.greatHauntState).toEqual(JSON.parse(JSON.stringify(battle.greatHauntState)));
    expect(game.scene.currentBattle.getBattlerCount()).toBe(count);
    expect(game.scene.getEnemyParty()).toHaveLength(1);
    expect(
      game.scene
        .getEnemyParty()[0]
        .getHeldItems()
        .map(m => m.stackCount),
    ).toEqual([5 * count, 5 * count, 5 * count]);
  });
});
