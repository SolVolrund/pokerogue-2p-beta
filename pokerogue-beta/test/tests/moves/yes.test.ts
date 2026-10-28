import { tmPoolTiers } from "#balance/tm-pool-tiers";
import { allMoves, modifierTypes } from "#data/data-lists";
import { Status } from "#data/status-effect";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { PositionalTagType } from "#enums/positional-tag-type";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { Pokemon } from "#field/pokemon";
import type { TmModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { CharSprite } from "#ui/char-sprite";
import { finishYes, getYesRevivalCandidates, prepareYesField, reviveForYes } from "#utils/yes-move";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Moves - Yes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => game.scene.configureTwoPlayerMode(false));
  beforeEach(() => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(CharSprite.prototype, "showCharacter").mockResolvedValue(undefined);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH)
      .criticalHits(false);
  });

  it("offers a Master-tier TM only to Mew, excluding known or used copies", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.DITTO);
    const [mew, ditto] = game.scene.getPlayerParty();
    const generator = modifierTypes.TM_MASTER();
    generator.setTier(ModifierTier.MASTER);
    expect(tmPoolTiers[MoveId.YES]).toBe(ModifierTier.MASTER);
    expect(mew.isTmCompatible(MoveId.YES)).toBe(true);
    expect(ditto.isTmCompatible(MoveId.YES)).toBe(false);
    const tm = generator.generateType([mew, ditto]) as TmModifierType;
    expect(tm.moveId).toBe(MoveId.YES);
    expect(tm.tier).toBe(ModifierTier.MASTER);
    expect(tm.iconImage).toBe("tm_normal");
    expect(generator.generateType([ditto])).toBeNull();
    mew.usedTMs = [MoveId.YES];
    expect(generator.generateType([mew])).toBeNull();
  });

  it("sets boosts, independent field effects and actual Wish/Future Sight, with one hazard layer", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mew = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    vi.spyOn(mew, "randBattleSeedInt").mockReturnValue(0);
    prepareYesField(mew, target);
    expect(mew.hp).toBe(mew.getMaxHp() - Math.floor(mew.getMaxHp() / 2));
    for (const stat of BATTLE_STATS) {
      expect(mew.getStatStage(stat)).toBe(6);
    }
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.ELECTRIC);
    for (const tag of [
      ArenaTagType.SPIKES,
      ArenaTagType.TOXIC_SPIKES,
      ArenaTagType.STEALTH_ROCK,
      ArenaTagType.STICKY_WEB,
    ]) {
      expect(game.scene.arena.getTagOnSide(tag, ArenaTagSide.ENEMY)).toMatchObject({ layers: 1 });
    }
    for (const tag of [
      ArenaTagType.REFLECT,
      ArenaTagType.LIGHT_SCREEN,
      ArenaTagType.SAFEGUARD,
      ArenaTagType.MIST,
      ArenaTagType.TAILWIND,
      ArenaTagType.NO_CRIT,
    ]) {
      expect(game.scene.arena.getTagOnSide(tag, ArenaTagSide.PLAYER)).toBeDefined();
    }
    expect(game.scene.arena.getTag(ArenaTagType.TRICK_ROOM)).toBeDefined();
    expect(game.scene.arena.getTag(ArenaTagType.MAGIC_ROOM)).toBeDefined();
    expect(game.scene.arena.positionalTagManager.tags).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tagType: PositionalTagType.WISH, turnCount: 2 }),
        expect.objectContaining({
          tagType: PositionalTagType.DELAYED_ATTACK,
          sourceMove: MoveId.FUTURE_SIGHT,
          turnCount: 3,
        }),
      ]),
    );
    prepareYesField(mew, target);
    expect(game.scene.arena.getTag(ArenaTagType.TRICK_ROOM)).toBeUndefined();
    expect(game.scene.arena.getTag(ArenaTagType.MAGIC_ROOM)).toBeUndefined();
    expect(game.scene.arena.positionalTagManager.tags).toHaveLength(2);
  });

  it("revives a pre-existing fainted ally and never the user", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER);
    const [mew, ally] = game.scene.getPlayerParty();
    expect(getYesRevivalCandidates(mew)).toEqual([]);
    ally.hp = 0;
    ally.status = new Status(StatusEffect.FAINT);
    expect(getYesRevivalCandidates(mew)).toEqual([ally]);
    const messages = vi.spyOn(game.scene.phaseManager, "queueMessage");
    reviveForYes(mew, ally);
    expect(ally.hp).toBe(Math.floor(ally.getMaxHp() / 2));
    expect(ally.status).toBeFalsy();
    expect(messages).not.toHaveBeenCalled();
    finishYes(mew);
    expect(mew.hp).toBe(0);
    expect(getYesRevivalCandidates(mew)).not.toContain(mew);
    expect(game.scene.arena.getTag(ArenaTagType.PENDING_HEAL)).toBeDefined();
  });

  it("silences setup and overlapping effects without suppressing their mechanics or later messages", async () => {
    game.override.enemySpecies(SpeciesId.CHARIZARD);
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mew = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    const arena = game.scene.arena;
    const messages = vi.spyOn(game.scene.phaseManager, "queueMessage");
    const events = vi.spyOn(arena.eventTarget, "dispatchEvent");
    const roll = vi.spyOn(mew, "randBattleSeedInt").mockReturnValue(0);

    expect(target.getAttackTypeEffectiveness(PokemonType.GROUND)).toBe(0);
    prepareYesField(mew, target);
    expect(messages).not.toHaveBeenCalled();
    expect(events).toHaveBeenCalled();
    expect(arena.weatherType).toBe(WeatherType.SUNNY);
    expect(arena.terrainType).toBe(TerrainType.ELECTRIC);
    expect(target.getAttackTypeEffectiveness(PokemonType.GROUND)).toBe(2);
    expect(game.scene.phaseManager.hasPhaseOfType("DamageAnimPhase")).toBe(true);

    // A repeated cast clears terrain and rooms, but still adds another hazard layer.
    roll.mockImplementation(max => (max === 7 ? 4 : 0));
    prepareYesField(mew, target);
    expect(messages).not.toHaveBeenCalled();
    expect(arena.terrainType).toBe(TerrainType.NONE);
    expect(arena.getTag(ArenaTagType.TRICK_ROOM)).toBeUndefined();
    expect(arena.getTag(ArenaTagType.MAGIC_ROOM)).toBeUndefined();
    expect(arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.ENEMY)).toMatchObject({ layers: 2 });
    expect(arena.getTagOnSide(ArenaTagType.TOXIC_SPIKES, ArenaTagSide.ENEMY)).toMatchObject({ layers: 2 });

    arena.removeTagOnSide(ArenaTagType.GRAVITY, ArenaTagSide.BOTH);
    expect(messages).toHaveBeenCalled();
    expect(target.getAttackTypeEffectiveness(PokemonType.GROUND)).toBe(0);
  });

  it("keeps ordinary weather, terrain, hazard and room announcements enabled", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mew = game.field.getPlayerPokemon();
    const arena = game.scene.arena;
    const messages = vi.spyOn(game.scene.phaseManager, "queueMessage");

    arena.trySetWeather(WeatherType.RAIN, mew);
    expect(messages).toHaveBeenCalled();
    messages.mockClear();
    arena.trySetTerrain(TerrainType.MISTY, true, mew);
    expect(messages).toHaveBeenCalled();
    messages.mockClear();
    arena.trySetWeather(WeatherType.NONE);
    arena.trySetTerrain(TerrainType.NONE);
    expect(messages).toHaveBeenCalledTimes(2);

    arena.addTag(ArenaTagType.SPIKES, 0, MoveId.SPIKES, mew.id, ArenaTagSide.ENEMY);
    messages.mockClear();
    arena.addTag(ArenaTagType.SPIKES, 0, MoveId.SPIKES, mew.id, ArenaTagSide.ENEMY);
    expect(messages).toHaveBeenCalled();

    arena.addTag(ArenaTagType.TRICK_ROOM, 5, MoveId.TRICK_ROOM, mew.id);
    messages.mockClear();
    arena.addTag(ArenaTagType.TRICK_ROOM, 5, MoveId.TRICK_ROOM, mew.id);
    expect(messages).toHaveBeenCalled();
    expect(arena.getTag(ArenaTagType.TRICK_ROOM)).toBeUndefined();
  });

  it("hits through Protect, Substitute and Wonder Guard, then sacrifices the user", async () => {
    game.override.enemyAbility(AbilityId.WONDER_GUARD).startingHeldItems([{ name: "MULTI_LENS", count: 3 }]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER);
    const mew = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    target.addTag(BattlerTagType.PROTECTED, 1, MoveId.PROTECT, target.id);
    target.addTag(BattlerTagType.SUBSTITUTE, 0, MoveId.SUBSTITUTE, target.id);
    game.move.use(MoveId.YES);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("DamageAnimPhase", false);
    // The first damage animation belongs to the Belly Drum cost.
    await game.phaseInterceptor.to("MoveEffectPhase");
    expect(target.hp).toBe(0);
    expect(mew.hp).toBe(0);
    expect(mew.turnData.hitCount).toBe(1);
    expect(allMoves[MoveId.YES].canBeMultiStrikeEnhanced(mew)).toBe(false);
  });

  it("sacrifices even on a miss with no replacement available", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mew = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    vi.spyOn(allMoves[MoveId.YES], "calculateBattleAccuracy").mockReturnValue(0);
    game.move.use(MoveId.YES);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("DamageAnimPhase", false);
    await game.phaseInterceptor.to("MoveEffectPhase");
    expect(target.hp).toBe(target.getMaxHp());
    expect(mew.hp).toBe(0);
  });

  it("completes Lunar Dance and restores the replacement's HP, status and PP", async () => {
    game.override
      .startingLevel(30)
      .enemyLevel(30)
      .startingHeldItems([{ name: "REVIVER_SEED" }, { name: "SHELL_BELL" }, { name: "SHINY_BADGE" }]);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER);
    const [mew, ally] = game.scene.getPlayerParty();
    ally.hp = 1;
    ally.status = new Status(StatusEffect.PARALYSIS);
    ally.moveset[0].ppUsed = 3;
    vi.spyOn(mew, "randBattleSeedInt").mockImplementation(max => (max === 7 ? 4 : 0));
    vi.spyOn(allMoves[MoveId.YES], "calculateBattleAccuracy").mockReturnValue(0);
    game.move.use(MoveId.YES);
    game.doSelectPartyPokemon(1, "SwitchPhase");
    await game.toNextTurn();
    expect(mew.isFainted()).toBe(true);
    expect(game.field.getPlayerPokemon()).toBe(ally);
    expect(ally.isFullHp()).toBe(true);
    expect(ally.status).toBeFalsy();
    expect(ally.moveset[0].ppUsed).toBe(0);
  });

  it("pauses for an eligible revival selection before sacrificing Mew", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
    const [mew, ally] = game.scene.getPlayerParty();
    ally.hp = 0;
    ally.status = new Status(StatusEffect.FAINT);
    game.move.use(MoveId.YES);
    game.doSelectPartyPokemon(1, "YesMoveSetupPhase");
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("DamageAnimPhase", false);
    expect(ally.hp).toBe(Math.floor(ally.getMaxHp() / 2));
    expect(mew.hp).toBeGreaterThan(0);
    await game.phaseInterceptor.to("MoveEffectPhase");
    expect(mew.hp).toBe(0);
  });

  it("rolls a major status for a survivor and lets Misty Terrain block it", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER);
    const mew = game.field.getPlayerPokemon();
    const target = game.field.getEnemyPokemon();
    vi.spyOn(mew, "randBattleSeedInt").mockImplementation(max => (max === 7 ? 2 : 1));
    target.addTag(BattlerTagType.ENDURING, 1, MoveId.ENDURE, target.id);
    const statusAttempt = vi.spyOn(target, "trySetStatus");
    game.move.use(MoveId.YES);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("DamageAnimPhase", false);
    await game.phaseInterceptor.to("MoveEffectPhase");
    expect(target.hp).toBe(1);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.MISTY);
    expect(statusAttempt).toHaveBeenCalled();
    expect(target.status).toBeFalsy();
    expect(mew.hp).toBe(0);
  });

  it("resolves a simultaneous last-Pokemon knockout without skipping the sacrifice", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW);
    const mew = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    game.move.use(MoveId.YES);
    await game.setTurnOrder([BattlerIndex.PLAYER, BattlerIndex.ENEMY]);
    await game.phaseInterceptor.to("GameOverPhase", false);
    expect(mew.isFainted(true)).toBe(true);
    expect(enemy.isFainted(true)).toBe(true);
  });

  it("keeps Future Sight as a separate attack after Mew has fainted", async () => {
    game.override.startingLevel(30).enemyLevel(100).enemyMoveset(MoveId.GROWL).moveset(MoveId.GROWL);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER);
    const [mew] = game.scene.getPlayerParty();
    const enemy = game.field.getEnemyPokemon();
    vi.spyOn(mew, "randBattleSeedInt").mockImplementation(max => (max === 7 ? 4 : 0));
    vi.spyOn(allMoves[MoveId.YES], "calculateBattleAccuracy").mockReturnValue(0);
    game.move.use(MoveId.YES);
    game.doSelectPartyPokemon(1, "SwitchPhase");
    await game.toNextTurn();
    game.move.use(MoveId.GROWL);
    await game.toNextTurn();
    expect(enemy.isFullHp()).toBe(true);
    const delayedDamage = vi.spyOn(enemy, "getAttackDamage");
    game.move.use(MoveId.GROWL);
    await game.toNextTurn();
    expect(enemy.hp).toBeLessThan(enemy.getMaxHp());
    expect(delayedDamage).toHaveBeenCalledWith(expect.objectContaining({ move: allMoves[MoveId.FUTURE_SIGHT] }));
    expect(mew.isFainted()).toBe(true);
    expect(game.phaseInterceptor.log.filter(p => p === "YesMoveSetupPhase")).toHaveLength(1);
  });

  it("uses the enemy side for an enemy cast and revives its trainer's fainted reserve", async () => {
    game.override.startingWave(8).enemyMoveset(MoveId.YES);
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER);
    const enemy = game.field.getEnemyPokemon();
    const reserve = game.scene.getEnemyParty().find(p => p !== enemy)!;
    expect(reserve).toBeDefined();
    reserve.hp = 0;
    reserve.status = new Status(StatusEffect.FAINT);
    game.move.use(MoveId.SPLASH);
    await game.setTurnOrder([BattlerIndex.ENEMY, BattlerIndex.PLAYER]);
    await game.phaseInterceptor.to("DamageAnimPhase", false);
    await game.phaseInterceptor.to("MoveEffectPhase");
    expect(reserve.hp).toBe(Math.floor(reserve.getMaxHp() / 2));
    expect(enemy.hp).toBe(0);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.REFLECT, ArenaTagSide.ENEMY)).toBeDefined();
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SPIKES, ArenaTagSide.PLAYER)).toBeDefined();
  });

  it("limits revival eligibility to Mew's owner in multiplayer", async () => {
    await game.classicMode.startBattle(SpeciesId.MEW, SpeciesId.CHARMANDER, SpeciesId.SQUIRTLE);
    const [mew, ownAlly, otherAlly] = game.scene.getPlayerParty();
    game.scene.configureTwoPlayerMode(true);
    game.scene.getPlayerParty(0).splice(2, 1);
    game.scene.getPlayerParty(1).push(otherAlly);
    ownAlly.hp = 0;
    otherAlly.hp = 0;
    expect(getYesRevivalCandidates(mew)).toEqual([ownAlly]);
  });
});
