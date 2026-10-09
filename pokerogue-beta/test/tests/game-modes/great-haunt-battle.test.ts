import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import { allMoves } from "#data/data-lists";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Great Haunt combat phases", () => {
  let phaser: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaser = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaser);
    game.scene.configureTwoPlayerMode(false);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(1)
      .ability(AbilityId.NO_GUARD)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAROWAK)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.DRAGON_RAGE, MoveId.SPLASH])
      .weather(WeatherType.NONE);
  });

  it("plays the disguise knockout, forced faint, clone fight and Marowak reveal without a reward break", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE, SpeciesId.SQUIRTLE);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    const battle = game.scene.currentBattle;
    const ghost = game.field.getEnemyPokemon();
    const victim = game.field.getPlayerPokemon();
    battle.greatHauntState = { stage: "ghost", ghostId: ghost.id, level: ghost.level, fallen: [], forcedFaintIds: [] };
    const rewards = vi.spyOn(game.scene.phaseManager, "pushNew");
    game.move.select(MoveId.DRAGON_RAGE);
    game.doSelectPartyPokemon(1);
    await game.toNextTurn();
    expect(victim.isFainted()).toBe(true);
    expect(battle.greatHauntState.stage).toBe("clones");
    const clone = game.field.getEnemyPokemon();
    expect(clone.species.speciesId).toBe(SpeciesId.EEVEE);
    expect(clone.isOnField()).toBe(true);
    expect(clone.isBoss()).toBe(false);
    expect(
      allMoves[MoveId.ROAR].getAttrs("ForceSwitchOutAttr")[0].getSwitchOutCondition()(
        victim,
        clone,
        allMoves[MoveId.ROAR],
      ),
    ).toBe(false);
    expect(game.field.getPlayerPokemon().species.speciesId).toBe(SpeciesId.SQUIRTLE);
    clone.hp = 1;
    game.move.select(MoveId.DRAGON_RAGE);
    await game.toNextTurn();
    expect(battle.greatHauntState.stage).toBe("marowak");
    const marowak = game.field.getEnemyPokemon();
    expect(marowak.id).toBe(battle.greatHauntState.marowakId);
    expect(marowak.isOnField()).toBe(true);
    expect(marowak.bossSegments).toBe(6);
    expect(marowak.level).toBe(ghost.level);
    expect(rewards.mock.calls.some(c => c[0] === "SelectModifierPhase" || c[0] === "BattleEndPhase")).toBe(false);
    marowak.hp = 1;
    marowak.bossSegmentIndex = 0;
    game.move.select(MoveId.DRAGON_RAGE);
    await game.phaseInterceptor.to("BattleEndPhase");
    expect(marowak.isFainted()).toBe(true);
  });

  it.each([1, 2, 3] as const)("keeps one turn sequence after each boss transition in %iP", async count => {
    await game.classicMode.runToSummon(SpeciesId.EEVEE, SpeciesId.SQUIRTLE);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue(undefined);
    game.scene.configureTwoPlayerMode(count > 1, 6, false, count);
    const battle = game.scene.currentBattle;
    battle.double = count > 1;
    for (const owner of game.scene.getActivePlayerIndexes().filter(p => p !== 0)) {
      for (const species of [SpeciesId.EEVEE, SpeciesId.SQUIRTLE]) {
        const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(species), 100);
        game.scene.getPlayerParty(owner).push(pokemon);
      }
      game.scene.phaseManager.unshiftNew("SummonPhase", owner, true);
    }
    const ghost = game.scene.getEnemyParty()[0];
    battle.greatHauntState = { stage: "ghost", ghostId: ghost.id, level: ghost.level, fallen: [], forcedFaintIds: [] };
    await game.phaseInterceptor.to("CommandPhase");
    const playerSlots = [BattlerIndex.PLAYER, BattlerIndex.PLAYER_2, BattlerIndex.PLAYER_3] as const;
    const enemySlots = [BattlerIndex.ENEMY, BattlerIndex.ENEMY_2, BattlerIndex.ENEMY_3] as const;
    const initialTurn = battle.turn;
    game.move.select(MoveId.DRAGON_RAGE);
    for (let i = 1; i < count; i++) game.move.select(MoveId.SPLASH, playerSlots[i]);
    for (let i = 0; i < count; i++) game.doSelectPartyPokemon(1);
    await game.toNextTurn();
    expect(battle.greatHauntState.stage).toBe("clones");
    expect(battle.enemyParty).toHaveLength(count);
    expect(battle.turn).toBe(initialTurn + 1);
    expect(game.scene.getEnemyField(true)).toHaveLength(count);

    async function playQuietTurn(enemyCount: number) {
      const turn = battle.turn;
      game.phaseInterceptor.clearLogs();
      for (let i = 0; i < count; i++) game.move.select(MoveId.SPLASH, playerSlots[i]);
      await game.toNextTurn();
      const log = game.phaseInterceptor.log;
      for (const phase of ["TurnStartPhase", "WeatherEffectPhase", "TurnEndPhase", "TurnInitPhase"] as const) {
        expect(
          log.filter(p => p === phase),
          phase,
        ).toHaveLength(1);
      }
      expect(log.filter(p => p === "CommandPhase")).toHaveLength(count);
      expect(log.filter(p => p === "EnemyCommandPhase")).toHaveLength(enemyCount);
      expect(log.filter(p => p === "MovePhase")).toHaveLength(count + enemyCount);
      expect(battle.turn).toBe(turn + 1);
    }

    await playQuietTurn(count);
    await playQuietTurn(count);
    // Old saves can contain a clone with the disguise's ID. Fainting it must not restart either stage.
    battle.greatHauntState.ghostId = battle.enemyParty[0].id;
    if (count > 1) {
      const clones = [...battle.enemyParty];
      clones[0].hp = 1;
      game.move.select(MoveId.DRAGON_RAGE, playerSlots[0], enemySlots[0]);
      for (let i = 1; i < count; i++) game.move.select(MoveId.SPLASH, playerSlots[i]);
      await game.toNextTurn();
      expect(battle.greatHauntState.stage).toBe("clones");
      expect(battle.enemyParty).toHaveLength(count);
      clones.forEach((clone, i) => expect(battle.enemyParty[i]).toBe(clone));
      expect(clones[0].isFainted()).toBe(true);
      expect(game.scene.getEnemyField(true)).toHaveLength(count - 1);
      await playQuietTurn(count - 1);
    }
    battle.enemyParty.forEach(p => {
      if (!p.isFainted()) p.hp = 1;
    });
    for (let i = 0; i < count; i++) {
      if (battle.enemyParty[i].isFainted()) {
        game.move.select(MoveId.SPLASH, playerSlots[i]);
      } else {
        game.move.select(MoveId.DRAGON_RAGE, playerSlots[i], enemySlots[i]);
      }
    }
    await game.toNextTurn();
    expect(battle.greatHauntState.stage).toBe("marowak");
    expect(game.scene.getEnemyField(true)).toHaveLength(1);
    await playQuietTurn(1);
    await playQuietTurn(1);
  });

  it("Grave Wind sets five-turn Miasma", async () => {
    game.override.ability(AbilityId.GRAVE_WIND);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    expect(game.scene.arena.weatherType).toBe(WeatherType.MIASMA);
    expect(game.scene.arena.weather?.turnsLeft).toBe(5);
  });

  it("Grave Wind preserves battle-long Miasma", async () => {
    game.override.ability(AbilityId.GRAVE_WIND).weather(WeatherType.MIASMA);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    expect(game.scene.arena.weather?.turnsLeft).toBe(0);
  });

  it("Restless Spirit heals one eighth during Miasma", async () => {
    game.override.ability(AbilityId.RESTLESS_SPIRIT).weather(WeatherType.MIASMA);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.hp = 1;
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(pokemon.hp).toBe(1 + Math.max(1, Math.floor(pokemon.getMaxHp() / 8)));
  });

  it("weather suppression prevents Restless Spirit healing", async () => {
    game.override.ability(AbilityId.RESTLESS_SPIRIT).enemyAbility(AbilityId.CLOUD_NINE).weather(WeatherType.MIASMA);
    await game.classicMode.startBattle(SpeciesId.GASTLY);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.hp = 1;
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");
    expect(pokemon.hp).toBe(1);
  });
});
