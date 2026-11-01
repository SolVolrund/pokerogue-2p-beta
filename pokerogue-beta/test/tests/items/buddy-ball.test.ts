import { allAbilities, allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { BuddyBallModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import { getModifierPoolForType } from "#utils/modifier-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Items - Buddy Ball", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override.battleStyle("double").ability(AbilityId.BALL_FETCH).enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE).enemyMoveset(MoveId.SPLASH).moveset([MoveId.EARTHQUAKE, MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SANDSHREW, SpeciesId.PSYDUCK);
    game.override.moveset([]);
  });

  function equip() {
    const [ally, holder] = game.scene.getPlayerParty();
    const type = modifierTypes.BUDDY_BALL().withIdFromFunc(modifierTypes.BUDDY_BALL);
    const ball = new BuddyBallModifier(type, holder.id);
    game.scene.getPlayerModifiers().push(ball);
    return { ally, holder, ball };
  }

  function rewardWeight() {
    const entry = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ROGUE]
      .find(entry => entry.modifierType.id === "BUDDY_BALL")!;
    expect(entry.maxWeight).toBe(3);
    return typeof entry.weight === "function" ? entry.weight(game.scene.getPlayerParty(), 0) : entry.weight;
  }

  it.each([MoveId.EARTHQUAKE, MoveId.SURF, MoveId.DISCHARGE, MoveId.BOOMBURST, MoveId.EXPLOSION])(
    "enables rewards when a party member knows ally-hitting spread move %i",
    moveId => {
      const party = game.scene.getPlayerParty();
      party.forEach(pokemon => { pokemon.moveset = [new PokemonMove(MoveId.SPLASH)]; });
      expect(rewardWeight()).toBe(0);
      party[1].moveset = [new PokemonMove(moveId)];
      expect(rewardWeight()).toBe(3);
      party[1].moveset = [new PokemonMove(MoveId.TACKLE)];
      expect(rewardWeight()).toBe(0);
    },
  );

  it.each([MoveId.ROCK_SLIDE, MoveId.HEAT_WAVE, MoveId.SWIFT, MoveId.TACKLE, MoveId.POLLEN_PUFF, MoveId.PERISH_SONG])(
    "does not enable rewards for enemy-only spread, single-target or status move %i",
    moveId => {
      game.scene.getPlayerParty().forEach(pokemon => { pokemon.moveset = [new PokemonMove(moveId)]; });
      game.field.getEnemyPokemon().moveset = [new PokemonMove(MoveId.EARTHQUAKE)];
      expect(rewardWeight()).toBe(0);
    },
  );

  it("counts benched party members even with no PP or HP remaining", () => {
    game.scene.getPlayerParty().forEach(pokemon => { pokemon.moveset = [new PokemonMove(MoveId.SPLASH)]; });
    const reserve = game.scene.addPlayerPokemon(game.scene.getPlayerParty()[0].species, 5);
    reserve.moveset = [new PokemonMove(MoveId.EARTHQUAKE)];
    reserve.moveset[0].ppUsed = reserve.moveset[0].getMovePp();
    reserve.hp = 0;
    game.scene.getPlayerParty().push(reserve);
    expect(reserve.isOnField()).toBe(false);
    expect(rewardWeight()).toBe(3);
  });

  it.each([1, 2] as const)("checks player %i's whole party when generating another player's rewards", owner => {
    const party = [...game.scene.getPlayerParty()];
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    try {
      game.scene.getActivePlayerIndexes().forEach(index => { game.scene.getPlayerParty(index).length = 0; });
      party.forEach(pokemon => { pokemon.moveset = [new PokemonMove(MoveId.SPLASH)]; });
      game.scene.getPlayerParty(0).push(party[0]);
      game.scene.getPlayerParty(owner).push(party[1]);
      expect(rewardWeight()).toBe(0);
      party[1].moveset = [new PokemonMove(MoveId.EARTHQUAKE)];
      expect(rewardWeight()).toBe(3);
      game.scene.getPlayerParty(owner).length = 0;
      expect(rewardWeight()).toBe(0);
    } finally {
      game.scene.configureTwoPlayerMode(false);
    }
  });

  it("protects only the holder from a teammate's Earthquake in battle", async () => {
    const { ally, holder } = equip();
    const enemy = game.field.getEnemyPokemon();
    expect(ally.hasAbility(AbilityId.TELEPATHY)).toBe(false);
    expect(holder.getAbility().id).toBe(AbilityId.BALL_FETCH);
    expect(holder.hasAbility(AbilityId.TELEPATHY)).toBe(true);
    expect(holder.getMoveEffectiveness(enemy, allMoves[MoveId.EARTHQUAKE])).toBe(1);
    expect(holder.getMoveEffectiveness(ally, allMoves[MoveId.EARTHQUAKE])).toBe(0);
    expect(holder.getMoveEffectiveness(ally, allMoves[MoveId.HEAL_PULSE])).toBe(1);
    const hp = holder.hp, enemyHp = enemy.hp;
    game.move.select(MoveId.EARTHQUAKE);
    game.move.select(MoveId.SPLASH, 1);
    await game.phaseInterceptor.to("TurnEndPhase", false);
    expect(holder.hp).toBe(hp);
    expect(enemy.hp).toBeLessThan(enemyHp);
  });

  it("follows natural Telepathy including Pollen Puff, item loss and suppression", () => {
    const { ally, holder, ball } = equip();
    const moves = [MoveId.SURF, MoveId.TACKLE, MoveId.POLLEN_PUFF, MoveId.HEAL_PULSE];
    const forecast = () => moves.map(id => holder.getMoveEffectiveness(ally, allMoves[id]));
    const withItem = forecast();
    expect(holder.getMoveEffectiveness(ally, allMoves[MoveId.TACKLE], true)).toBe(1);
    holder.summonData.abilitySuppressed = true;
    expect(holder.hasAbility(AbilityId.TELEPATHY)).toBe(false);
    expect(forecast()[1]).toBe(1);
    holder.summonData.abilitySuppressed = false;
    holder.addTag(BattlerTagType.EMBARGO, 5, MoveId.EMBARGO, ally.id);
    expect(forecast()[1]).toBe(1);
    holder.removeTag(BattlerTagType.EMBARGO);
    expect(forecast()).toEqual(withItem);
    const items = game.scene.getPlayerModifiers();
    items.splice(items.indexOf(ball), 1);
    expect(holder.hasAbility(AbilityId.TELEPATHY)).toBe(false);
    expect(forecast()[1]).toBe(1);
    holder.setTempAbility(allAbilities[AbilityId.TELEPATHY]);
    expect(forecast()).toEqual(withItem);
    items.push(ball);
    expect(holder.getAbilityAttrs("MoveImmunityAbAttr")).toHaveLength(1);
  });

  it("is a one-per-holder Rogue reward and survives a save round trip", () => {
    const { holder, ball } = equip();
    const pool = getModifierPoolForType(ModifierPoolType.PLAYER)[ModifierTier.ROGUE];
    expect(pool.some(entry => entry.modifierType.id === "BUDDY_BALL")).toBe(true);
    expect(ball.getMaxStackCount()).toBe(1);
    const saved = new ModifierData(ball, true);
    const restored = new ModifierData(JSON.parse(JSON.stringify(saved)), true).toModifier(BuddyBallModifier);
    expect(restored).toBeInstanceOf(BuddyBallModifier);
    expect(restored).toMatchObject({ pokemonId: holder.id, stackCount: 1, type: { id: "BUDDY_BALL" } });
  });

  it("protects a co-op partner using their own inventory while player one is active", () => {
    const [ally, holder] = game.scene.getPlayerParty();
    game.scene.configureTwoPlayerMode(true);
    try {
      const hostParty = game.scene.getPlayerParty(0);
      if (!hostParty.includes(ally)) {
        hostParty.push(ally);
      }
      if (hostParty.includes(holder)) {
        hostParty.splice(hostParty.indexOf(holder), 1);
      }
      game.scene.getPlayerParty(1).push(holder);
      const type = modifierTypes.BUDDY_BALL().withIdFromFunc(modifierTypes.BUDDY_BALL);
      game.scene.getPlayerModifiers(1).push(new BuddyBallModifier(type, holder.id));
      expect(game.scene.getPlayerIndexForPokemon(holder)).toBe(1);
      expect(holder.getMoveEffectiveness(ally, allMoves[MoveId.EARTHQUAKE])).toBe(0);
      expect(ally.getMoveEffectiveness(holder, allMoves[MoveId.EARTHQUAKE])).not.toBe(0);
    } finally {
      game.scene.configureTwoPlayerMode(false);
    }
  });
});
