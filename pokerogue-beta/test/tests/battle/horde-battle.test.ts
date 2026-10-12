import { Battle } from "#app/battle";
import { getGameMode } from "#app/game-mode";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import { allMoves } from "#data/data-lists";
import {
  areHordePositionsAdjacent,
  createHordeBattleState,
  getHordeChanceDenominator,
  HORDE_ENEMY_POSITIONS,
  scaleHordeLevel,
} from "#data/horde-battle";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { FieldPosition as Position } from "#enums/field-position";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { ForceSwitchOutAttr } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import { PokemonMove } from "#moves/pokemon-move";
import { AttemptCapturePhase } from "#phases/attempt-capture-phase";
import { EncounterPhase } from "#phases/encounter-phase";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { TitlePhase } from "#phases/title-phase";
import { VictoryPhase } from "#phases/victory-phase";
import { GameManager } from "#test/framework/game-manager";
import type { NewBattleInitialProps } from "#types/new-battle-props";
import type { TargetSelectUiHandler } from "#ui/target-select-ui-handler";
import { getAiEmergencyRepositionTarget, getAiRelevantOpponents } from "#utils/ai-targeting";
import * as Common from "#utils/common";
import { getRepositionPositions, reformHordePlayers } from "#utils/horde-battle";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Horde rules", () => {
  it.each([
    [1, 0, 64],
    [1, 1, 32],
    [1, 2, 16],
    [1, 3, 8],
    [2, 0, 32],
    [3, 0, 16],
  ])("uses the horde odds for %i teams and %i lure types", (teams, lures, denominator) => {
    expect(getHordeChanceDenominator(teams, lures)).toBe(denominator);
  });
  it("scales each rolled level, with a minimum of one", () => {
    expect([1, 2, 3].map(teams => scaleHordeLevel(40, teams))).toEqual([20, 30, 40]);
    expect(scaleHordeLevel(1, 1)).toBe(1);
  });
  it.each([
    [1, Position.CENTER, [0, 1, 2, 3, 4]],
    [2, Position.LEFT, [0, 2, 3]],
    [2, Position.RIGHT, [1, 2, 4]],
    [3, Position.LEFT, [0, 2, 3]],
    [3, Position.CENTER, [0, 1, 2]],
    [3, Position.RIGHT, [1, 2, 4]],
  ])("has symmetric adjacency for %i teams at position %i", (teams, position, indexes) => {
    const reachable = HORDE_ENEMY_POSITIONS.flatMap((enemy, index) =>
      areHordePositionsAdjacent(position, enemy, true, false, teams) ? [index] : [],
    );
    const reverse = HORDE_ENEMY_POSITIONS.flatMap((enemy, index) =>
      areHordePositionsAdjacent(enemy, position, false, true, teams) ? [index] : [],
    );
    expect(reachable).toEqual(indexes);
    expect(reverse).toEqual(indexes);
  });
});

describe("Horde battle integration", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.configureTwoPlayerMode(false);
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);
    activeOverrides.BATTLE_STYLE_OVERRIDE = null;
    game.scene.modifiers = [];
  });
  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
    activeOverrides.HORDE_ENCOUNTER_CHANCE_OVERRIDE = null;
  });

  function setup(teams: 1 | 2 | 3 = 1, ep = false) {
    game.scene.configureTwoPlayerMode(teams > 1 || ep, 6, false, teams);
    game.scene.twoPlayerEnemyPlayerMode = ep;
    const battle = new Battle(game.scene.gameMode, {
      waveIndex: 21,
      battleType: BattleType.WILD,
      double: true,
      horde: createHordeBattleState(Array.from({ length: teams }, (_, i) => i)),
    });
    game.scene.currentBattle = battle;
    battle.incrementTurn();
    for (let i = 0; i < teams; i++) {
      const owner = i as 0 | 1 | 2;
      const party = game.scene.getPlayerParty(owner);
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 20);
      party.push(pokemon);
      game.scene.field.add(pokemon);
      pokemon.fieldPosition = battle.horde!.playerPositions[i];
      pokemon.moveset = [new PokemonMove(MoveId.TACKLE)];
    }
    battle.enemyParty = HORDE_ENEMY_POSITIONS.map(position => {
      const pokemon = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.MAGIKARP), 20, TrainerSlot.NONE);
      pokemon.fieldPosition = position;
      game.scene.field.add(pokemon);
      return pokemon;
    });
    return battle;
  }

  it.each([1, 2, 3] as const)("preserves battler IDs with %i player teams and five enemy slots", teams => {
    setup(teams);
    expect(game.scene.getBattleFieldSlotCount()).toBe(teams);
    expect(game.scene.getPlayerField()).toHaveLength(teams);
    expect(game.scene.getEnemyField().map(p => p.getBattlerIndex())).toEqual([2, 3, 5, 6, 7]);
    expect(game.scene.getField()[BattlerIndex.ENEMY_5]).toBe(game.scene.getEnemyField()[4]);
    expect(new EnemyCommandPhase(4).getPokemon()).toBe(game.scene.getEnemyField()[4]);
  });

  it("does not send a second Pokemon for a single team with an EP", () => {
    setup(1, true);
    game.scene.getPlayerParty(0).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 20));
    expect(game.scene.getPlayerFieldOwners()).toEqual([0]);
    expect(game.scene.getPlayerField()).toHaveLength(1);
  });

  it("draws the compact enemy formation back to front without changing field identities", () => {
    setup(3);
    const enemies = game.scene.getEnemyField();
    expect(enemies.map(p => p.getFieldPositionOffset())).toEqual([
      [-8, -20],
      [28, -20],
      [8, 0],
      [-40, -8],
      [56, -8],
    ]);
    const draw = vi.spyOn(game.scene.field, "bringToTop");
    game.scene.updateFieldDepthOrder();
    const drawnOrder = draw.mock.calls.map(([object]) => object).filter(object => enemies.some(p => p === object));
    expect(drawnOrder).toEqual([enemies[0], enemies[1], enemies[3], enemies[4], enemies[2]]);
    expect(enemies.map(p => p.fieldPosition)).toEqual(HORDE_ENEMY_POSITIONS);
  });

  it("keeps near moves bounded while whole-field and long-range moves can reach all five", () => {
    setup(3);
    const player = game.scene.getPlayerField()[0];
    expect(getMoveTargets(player, MoveId.TACKLE, MoveTarget.NEAR_ENEMY).targets).toEqual([2, 5, 6]);
    expect(getMoveTargets(player, MoveId.SURF).targets).toEqual(expect.arrayContaining([2, 5, 6, 4]));
    expect(getMoveTargets(player, MoveId.TACKLE, MoveTarget.ALL_ENEMIES).targets).toEqual([2, 3, 5, 6, 7]);
    expect(getAiRelevantOpponents(player).map(p => p.getBattlerIndex())).toEqual([2, 5, 6]);
  });

  it("reforms eliminated teams while retaining enemy positions and original levels", async () => {
    const battle = setup(3);
    const players = game.scene.getPlayerField();
    const levels = [...battle.enemyLevels!];
    players.forEach(p =>
      vi.spyOn(p, "setFieldPosition").mockImplementation(async position => {
        p.fieldPosition = position;
      }),
    );
    players[1].hp = 0;
    await reformHordePlayers();
    expect(battle.horde!.playerCount).toBe(2);
    expect([players[0].fieldPosition, players[2].fieldPosition]).toEqual([Position.LEFT, Position.RIGHT]);
    players[0].hp = 0;
    await reformHordePlayers();
    expect(battle.horde!.playerCount).toBe(1);
    expect(players[2].fieldPosition).toBe(Position.CENTER);
    expect(getMoveTargets(players[2], MoveId.TACKLE, MoveTarget.NEAR_ENEMY).targets).toHaveLength(5);
    expect(game.scene.getEnemyField().map(p => p.fieldPosition)).toEqual(HORDE_ENEMY_POSITIONS);
    expect(battle.enemyLevels).toEqual(levels);
    expect(battle.horde!.initialPlayerCount).toBe(3);
  });

  it("keeps a team in formation while it has a legal reserve", async () => {
    const battle = setup(2);
    game.scene.getPlayerParty(1).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20));
    game.scene.getPlayerParty(1)[0].hp = 0;
    await reformHordePlayers();
    expect(battle.horde!.playerCount).toBe(2);
  });

  it("lets an isolated central CPU move to a flank, and preserves the EP reposition command", () => {
    setup(3, true);
    const player = game.scene.getPlayerField()[2];
    game.scene
      .getEnemyField()
      .slice(0, 3)
      .forEach(p => {
        p.hp = 0;
      });
    expect(getAiEmergencyRepositionTarget(player)).toBe(Position.LEFT);
    const phase = new EnemyCommandPhase(4);
    vi.spyOn(phase, "end").mockImplementation(() => {});
    expect(phase.canUseCommand(Command.POKEMON)).toBe(true);
    expect(phase.handleCommand(Command.REPOSITION, Position.CENTER)).toBe(true);
    expect(game.scene.currentBattle.turnCommands[BattlerIndex.ENEMY_5]?.cursor).toBe(Position.CENTER);
    expect(getRepositionPositions(player)).not.toContain(Position.FAR_LEFT);
  });

  it("restores horde state and only one player summon, without rerolling the encounter", () => {
    const battle = setup();
    game.scene.getPlayerParty().push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20));
    battle.horde!.enemyPositions[0] = Position.FAR_RIGHT;
    const saved = game.scene.gameData.getSessionSaveData();
    const roll = vi.spyOn(game.scene, "tryRollHorde" as never);
    const restored = game.scene.newBattle(saved);
    expect(restored.horde).toEqual(saved.horde);
    expect(restored.horde).not.toBe(saved.horde);
    expect(restored.enemyLevels).toHaveLength(5);
    expect(roll).not.toHaveBeenCalled();
    const title = new TitlePhase();
    title["loaded"] = true;
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    title.end();
    expect(queue.mock.calls.filter(call => call[0] === "SummonPhase").map(call => call[1])).toEqual([0]);
  });

  it("rolls only on eligible wild waves, excluding competitive modes and scripted encounters", () => {
    setup();
    const rng = vi.spyOn(Common, "randSeedInt").mockReturnValue(0);
    for (const waveIndex of [1, 20, 30, 200]) {
      const props: NewBattleInitialProps = { waveIndex, battleType: BattleType.WILD };
      game.scene["tryRollHorde"](props);
      expect(props.horde).toBeUndefined();
    }
    for (const battleType of [BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER] as const) {
      const props: NewBattleInitialProps = { waveIndex: 21, battleType };
      game.scene["tryRollHorde"](props);
      expect(props.horde).toBeUndefined();
    }
    const vs: NewBattleInitialProps = { waveIndex: 21, battleType: BattleType.WILD };
    game.scene.twoPlayerVsMode = true;
    game.scene["tryRollHorde"](vs);
    expect(vs.horde).toBeUndefined();
    expect(rng).not.toHaveBeenCalled();
    game.scene.twoPlayerVsMode = false;
    const eligible: NewBattleInitialProps = { waveIndex: 21, battleType: BattleType.WILD };
    game.scene["tryRollHorde"](eligible);
    expect(eligible.horde?.initialPlayerCount).toBe(1);
    expect(rng).toHaveBeenCalledWith(64);
  });

  it.each([
    [100, 99, true],
    [0, 0, false],
  ] as const)("overrides the eligible horde chance to %i percent", (chance, roll, expected) => {
    setup();
    activeOverrides.HORDE_ENCOUNTER_CHANCE_OVERRIDE = chance;
    vi.spyOn(Common, "randSeedInt").mockReturnValue(roll);
    const props: NewBattleInitialProps = { waveIndex: 21, battleType: BattleType.WILD };
    game.scene["tryRollHorde"](props);
    expect(!!props.horde).toBe(expected);
  });

  it("retains horde exclusions when the chance is overridden", () => {
    setup();
    activeOverrides.HORDE_ENCOUNTER_CHANCE_OVERRIDE = 100;
    const rng = vi.spyOn(Common, "randSeedInt").mockReturnValue(0);
    for (const waveIndex of [1, 20, 30, 200]) {
      const props: NewBattleInitialProps = { waveIndex, battleType: BattleType.WILD };
      game.scene["tryRollHorde"](props);
      expect(props.horde).toBeUndefined();
    }
    expect(rng).not.toHaveBeenCalled();
  });

  it("initializes the target cursor for the fourth and fifth EP battlers", () => {
    setup(3, true);
    const handler = game.scene.ui.handlers[UiMode.TARGET_SELECT] as TargetSelectUiHandler;
    for (const slot of [3, 4]) {
      const enemy = game.scene.getEnemyField()[slot];
      const callback = vi.fn();
      expect(handler.show([slot, MoveId.TACKLE, callback, [], [], enemy])).toBe(true);
      expect([0, 1, 4]).toContain(handler.getCursor());
      handler.processInput(Button.ACTION);
      expect(callback).toHaveBeenCalled();
      handler.clear();
    }
  });

  it("addresses captures by either outer slot and only rewards the completed horde", () => {
    setup();
    const enemies = game.scene.getEnemyField();
    expect(new AttemptCapturePhase(3, PokeballType.MASTER_BALL).getPokemon()).toBe(enemies[3]);
    expect(new AttemptCapturePhase(4, PokeballType.MASTER_BALL).getPokemon()).toBe(enemies[4]);
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    vi.spyOn(game.scene, "applyPartyExp").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    enemies[4].hp = 0;
    enemies[4].leaveField();
    new VictoryPhase(BattlerIndex.ENEMY_5).start();
    expect(queue.mock.calls.some(call => call[0] === "BattleEndPhase")).toBe(false);
    enemies.slice(0, 4).forEach(p => {
      p.hp = 0;
      p.leaveField();
    });
    new VictoryPhase(BattlerIndex.ENEMY_4).start();
    expect(queue.mock.calls.filter(call => call[0] === "SelectModifierPhase")).toHaveLength(1);
  });

  it("does not end the horde when a wild Pokemon flees but an outer enemy remains", () => {
    setup();
    const enemies = game.scene.getEnemyField();
    enemies.slice(1, 4).forEach(p => {
      p.hp = 0;
      p.leaveField();
    });
    const attr = new ForceSwitchOutAttr();
    vi.spyOn(attr, "getSwitchOutCondition").mockReturnValue(() => true);
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    attr.apply(game.scene.getPlayerField()[0], enemies[0], allMoves[MoveId.ROAR], []);
    expect(enemies[0].isOnField()).toBe(false);
    expect(enemies[4].isOnField()).toBe(true);
    expect(queue.mock.calls.some(call => call[0] === "BattleEndPhase")).toBe(false);
  });

  it("preserves the normal RNG stream while making reproducible horde rolls", () => {
    setup();
    const rng = vi.spyOn(Common, "randSeedInt").mockImplementation(range => {
      Phaser.Math.RND.integerInRange(0, range - 1);
      return 0;
    });
    const state = Phaser.Math.RND.state();
    const first: NewBattleInitialProps = { waveIndex: 21, battleType: BattleType.WILD };
    const second: NewBattleInitialProps = { waveIndex: 21, battleType: BattleType.WILD };
    game.scene["tryRollHorde"](first);
    expect(Phaser.Math.RND.state()).toBe(state);
    game.scene["tryRollHorde"](second);
    expect(first.horde).toEqual(second.horde);
    expect(rng).toHaveBeenCalledTimes(2);
  });

  it("recalls extra solo Pokemon on entering a horde without resetting arena effects", () => {
    setup();
    const party = game.scene.getPlayerParty();
    for (let i = 1; i < 3; i++) {
      const p = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20);
      party.push(p);
      game.scene.field.add(p);
    }
    const previous = new Battle(game.scene.gameMode, {
      waveIndex: 22,
      battleType: BattleType.WILD,
      double: true,
      wildBattlerCount: 3,
    });
    game.scene.currentBattle.waveIndex = 23;
    const reset = vi.spyOn(game.scene.arena, "resetArenaEffects");
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    game.scene["doPostBattleCleanup"](previous, game.scene.getMaxExpLevel());
    expect(reset).not.toHaveBeenCalled();
    expect(queue).toHaveBeenCalledWith("ReturnPhase", 1);
    expect(queue).toHaveBeenCalledWith("ReturnPhase", 2);
    expect(queue).toHaveBeenCalledWith("ToggleDoublePositionPhase", false, 3);
  });

  it("summons the second player slot when leaving a 1P+EP horde for ordinary doubles", () => {
    setup(1, true);
    const party = game.scene.getPlayerParty(0);
    party.push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 20));
    game.scene.currentBattle.horde = undefined;
    game.scene.currentBattle.enemyParty = game.scene.currentBattle.enemyParty.slice(0, 2);
    vi.spyOn(Phase.prototype, "end").mockImplementation(() => {});
    const queue = vi.spyOn(game.scene.phaseManager, "pushNew");
    new EncounterPhase().end();
    expect(queue.mock.calls.filter(call => call[0] === "SummonPhase").map(call => call[1])).toEqual([1]);
  });
});

describe("Horde turn flow", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  it("generates five same-species enemies and executes all five commands", async () => {
    const game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(game.scene, "tryRollHorde" as never).mockImplementation((props: NewBattleInitialProps) => {
      props.horde = createHordeBattleState([0]);
    });
    game.override.startingWave(21).moveset(MoveId.SPLASH).enemyMoveset(MoveId.SPLASH).enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    const scene = game.scene;
    expect(scene.getEnemyField()).toHaveLength(5);
    expect(scene.getPlayerField(true)).toHaveLength(1);
    expect(scene.getPlayerField()[0].fieldPosition).toBe(Position.CENTER);
    expect(new Set(scene.getEnemyField().map(p => p.species.speciesId)).size).toBe(1);
    expect(scene.getEnemyField().map(p => p.fieldPosition)).toEqual(HORDE_ENEMY_POSITIONS);
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnStartPhase", false);
    expect([2, 3, 5, 6, 7].every(i => scene.currentBattle.turnCommands[i]?.move?.move === MoveId.SPLASH)).toBe(true);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(scene.getEnemyField().every(p => p.moveset[0].ppUsed === 1)).toBe(true);
  });

  it.each([
    BattlerIndex.ENEMY_4,
    BattlerIndex.ENEMY_5,
  ])("damages and faints outer battler %i without ending the battle", async target => {
    const game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(game.scene, "tryRollHorde" as never).mockImplementation((props: NewBattleInitialProps) => {
      props.horde = createHordeBattleState([0]);
    });
    game.override
      .startingWave(21)
      .startingLevel(50)
      .moveset(MoveId.TACKLE)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP);
    await game.classicMode.startBattle(SpeciesId.BULBASAUR);
    const enemies = game.scene.getEnemyField();
    game.scene.getField()[target].hp = 1;
    game.move.select(MoveId.TACKLE, BattlerIndex.PLAYER, target);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(game.scene.getField()[target].isFainted()).toBe(true);
    expect(game.scene.getEnemyField(true)).toHaveLength(4);
    expect(game.scene.getEnemyField()).toEqual(enemies);
    expect(enemies.map(p => p.fieldPosition)).toEqual(HORDE_ENEMY_POSITIONS);
  });
});
