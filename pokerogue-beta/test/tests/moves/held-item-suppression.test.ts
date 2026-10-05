import { loadArenaTag } from "#data/arena-tag";
import { loadBattlerTag } from "#data/battler-tags";
import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { FormChangeItem } from "#enums/form-change-item";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { WeatherType } from "#enums/weather-type";
import { ZCrystal } from "#enums/z-crystal";
import type { Pokemon } from "#field/pokemon";
import { PokemonInstantReviveModifier, PokemonNatureWeightModifier } from "#modifiers/modifier";
import type { ModifierOverride } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import { canUseBerry, tryEatBerries } from "#utils/berry-use-utils";
import { areHeldItemEffectsSuppressed } from "#utils/held-item-suppression-state";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Moves - Embargo and Magic Room", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .moveset([MoveId.SPLASH, MoveId.EMBARGO, MoveId.MAGIC_ROOM, MoveId.FLING])
      .enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    game.scene.twoPlayerMode = false;
  });

  for (const move of [MoveId.EMBARGO, MoveId.MAGIC_ROOM]) {
    describe(MoveId[move], () => {
      function suppress(pokemon: Pokemon): void {
        if (move === MoveId.EMBARGO) {
          pokemon.addTag(BattlerTagType.EMBARGO, 5, move, pokemon.id);
        } else {
          game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, move, pokemon.id);
        }
      }

      function restore(pokemon: Pokemon): void {
        if (move === MoveId.EMBARGO) {
          pokemon.removeTag(BattlerTagType.EMBARGO);
        } else {
          game.scene.arena.removeTag(ArenaTagType.MAGIC_ROOM);
        }
      }

      it("suppresses healing for five full turns without removing the item", async () => {
        game.override.enemyHeldItems([{ name: "LEFTOVERS" }]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
        const enemy = game.field.getEnemyPokemon();
        const items = enemy.getHeldItems();
        enemy.hp = Math.floor(enemy.getMaxHp() / 2);
        const hp = enemy.hp;

        game.move.select(move);
        await game.toNextTurn();
        expect(areHeldItemEffectsSuppressed(enemy)).toBe(true);
        expect(enemy.hp).toBe(hp);
        for (let turn = 1; turn < 5; turn++) {
          game.move.select(MoveId.SPLASH);
          await game.toNextTurn();
          expect(enemy.hp).toBe(hp);
        }
        expect(areHeldItemEffectsSuppressed(enemy)).toBe(false);
        expect(enemy.getHeldItems()).toEqual(items);
        game.move.select(MoveId.SPLASH);
        await game.toNextTurn();
        expect(enemy.hp).toBeGreaterThan(hp);
      });

      it("blocks automatic berries, but keeps inventory and item-loss abilities unchanged", async () => {
        game.override.ability(AbilityId.UNBURDEN).startingHeldItems([
          { name: "BERRY", type: BerryType.SITRUS },
          { name: "BERRY", type: BerryType.OCCA },
        ]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
        const player = game.field.getPlayerPokemon();
        player.hp = 1;
        const items = player.getHeldItems();
        const speed = player.getEffectiveStat(Stat.SPD);
        suppress(player);

        expect(canUseBerry(player)).toBe(false);
        expect(tryEatBerries(player)).toBe(false);
        expect(player.getHeldItems()).toEqual(items);
        expect(player.getEffectiveStat(Stat.SPD)).toBe(speed);
        restore(player);
        expect(canUseBerry(player)).toBe(true);
        expect(tryEatBerries(player)).toBe(true);
      });

      it("disables direct Iron Ball, Lagging Tail and Loaded Dice effects", async () => {
        game.override.startingHeldItems([{ name: "IRON_BALL" }, { name: "LAGGING_TAIL" }, { name: "LOADED_DICE" }]);
        await game.classicMode.startBattle(SpeciesId.PIDGEOT);
        const player = game.field.getPlayerPokemon();
        expect(player.isGrounded()).toBe(true);
        expect(allMoves[MoveId.SPLASH].getPriority(player)).toBe(-1);
        suppress(player);
        expect(player.isGrounded()).toBe(false);
        expect(allMoves[MoveId.SPLASH].getPriority(player)).toBe(0);
        expect(player.getActiveHeldItems()).toHaveLength(0);
        expect(player.getHeldItems()).toHaveLength(3);
        restore(player);
        expect(player.isGrounded()).toBe(true);
        expect(allMoves[MoveId.SPLASH].getPriority(player)).toBe(-1);
      });

      it("refreshes cached Soul Dew stats without changing vitamins or HP", async () => {
        game.override.startingHeldItems([
          { name: "SOUL_DEW", count: 2 },
          { name: "BASE_STAT_BOOSTER", type: Stat.HP },
          { name: "BASE_STAT_BOOSTER", type: Stat.ATK },
        ]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
        const player = game.field.getPlayerPokemon();
        player.setNature(Nature.ADAMANT);
        const stats = [...player.stats];
        const baseStats = player.calculateBaseStats();
        const hp = player.hp;
        suppress(player);
        expect(player.getStat(Stat.ATK)).toBeLessThan(stats[Stat.ATK]);
        expect(player.getStat(Stat.SPATK)).toBeGreaterThan(stats[Stat.SPATK]);
        expect(player.calculateBaseStats()).toEqual(baseStats);
        expect(player.hp).toBe(hp);
        expect(player.getMaxHp()).toBe(stats[Stat.HP]);
        restore(player);
        expect(player.stats).toEqual(stats);
      });

      it("leaves experience, friendship, money and Z-Crystals active", async () => {
        const exemptions: ModifierOverride[] = [
          { name: "LUCKY_EGG" },
          { name: "SOOTHE_BELL" },
          { name: "GOLDEN_PUNCH" },
          { name: "Z_CRYSTAL", type: ZCrystal.NORMALIUM_Z },
        ];
        game.override.startingHeldItems(exemptions);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
        const player = game.field.getPlayerPokemon();
        expect(player.getHeldItems()).toHaveLength(exemptions.length);
        suppress(player);
        expect(player.getActiveHeldItems()).toEqual(player.getHeldItems());
      });

      it("keeps Mega Evolution items active", async () => {
        game.override.startingHeldItems([{ name: "FORM_CHANGE_ITEM", type: FormChangeItem.CHARIZARDITE_X }]);
        await game.classicMode.startBattle(SpeciesId.CHARIZARD);
        const player = game.field.getPlayerPokemon();
        const stone = player.getHeldItems()[0];
        expect(stone).toBeDefined();
        suppress(player);
        expect(stone.shouldApply(player)).toBe(true);
        expect(player.getActiveHeldItems()).toContain(stone);
      });

      it("stops type boosters and damage-reduction berries in damage previews", async () => {
        game.override
          .startingHeldItems([{ name: "BERRY", type: BerryType.OCCA }])
          .enemyHeldItems([{ name: "ATTACK_TYPE_BOOSTER", type: PokemonType.FIRE, count: 3 }]);
        await game.classicMode.startBattle(SpeciesId.BULBASAUR);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        const damage = () => player.getAttackDamage({ source: enemy, move: allMoves[MoveId.EMBER] }).damage;
        const original = damage();
        suppress(player);
        const suppressedDamage = damage();
        expect(suppressedDamage).toBeGreaterThan(original);
        expect(player.getHeldItems()).toHaveLength(1);
        expect(enemy.getActiveHeldItems()).toHaveLength(move === MoveId.MAGIC_ROOM ? 0 : 1);
        restore(player);
        expect(damage()).toBe(original);
      });

      it("allows ordinary item transfers while the effects remain suppressed", async () => {
        game.override.startingHeldItems([{ name: "LEFTOVERS" }]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.PIDGEOT);
        const [player, recipient] = game.scene.getPlayerParty();
        const item = player.getHeldItems()[0];
        suppress(player);
        expect(await game.scene.tryTransferHeldItemModifier(item, recipient, false)).toBe(true);
        expect(player.getHeldItems()).toHaveLength(0);
        expect(recipient.getHeldItems().some(held => held.type.id === "LEFTOVERS")).toBe(true);
      });

      it("makes Fling fail without consuming or transferring its item", async () => {
        game.override.startingHeldItems([{ name: "IRON_BALL" }]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
        const player = game.field.getPlayerPokemon();
        const enemy = game.field.getEnemyPokemon();
        suppress(player);
        const hp = enemy.hp;
        game.move.select(MoveId.FLING);
        await game.toNextTurn();
        expect(enemy.hp).toBe(hp);
        expect(player.getHeldItems()).toHaveLength(1);
      });

      it("does not allow a Reviver Seed through the faint-time tag reset", async () => {
        game.override.startingHeldItems([{ name: "REVIVER_SEED" }]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.MAGIKARP);
        const player = game.field.getPlayerPokemon();
        const seed = player.getHeldItems().find(item => item instanceof PokemonInstantReviveModifier)!;
        const apply = vi.spyOn(seed, "apply");
        suppress(player);
        player.hp = 1;
        game.move.select(MoveId.SPLASH);
        await game.move.forceEnemyMove(MoveId.TACKLE);
        await game.phaseInterceptor.to("FaintPhase");
        expect(apply).not.toHaveBeenCalled();
        expect(player.isFainted()).toBe(true);
        expect(player.getHeldItems()).toContain(seed);
      });

      it("suppresses reusable Booster Energy but not its ability's weather trigger", async () => {
        game.override.ability(AbilityId.PROTOSYNTHESIS).startingHeldItems([{ name: "BOOSTER_ENERGY" }]);
        await game.classicMode.startBattle(SpeciesId.FEEBAS);
        const player = game.field.getPlayerPokemon();
        const tag = player.getTag(BattlerTagType.PROTOSYNTHESIS)!;
        expect(tag).toBeDefined();
        const boostedStat = player.getEffectiveStat(tag.stat);
        suppress(player);
        expect(player.getEffectiveStat(tag.stat)).toBeLessThan(boostedStat);
        restore(player);
        expect(player.getEffectiveStat(tag.stat)).toBe(boostedStat);
        suppress(player);
        game.scene.arena.trySetWeather(WeatherType.SUNNY);
        expect(player.getEffectiveStat(tag.stat)).toBe(boostedStat);
      });
    });
  }

  it("Magic Room applies to both sides and new switch-ins, and a second use ends it", async () => {
    game.override.startingHeldItems([{ name: "SOUL_DEW" }]).enemyHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.PIDGEOT);
    const [first, second] = game.scene.getPlayerParty();
    const secondDew = first
      .getHeldItems()
      .find(item => item instanceof PokemonNatureWeightModifier)!
      .clone();
    (secondDew as PokemonNatureWeightModifier).pokemonId = second.id;
    game.scene.addModifier(secondDew);
    second.setNature(Nature.ADAMANT);
    const originalAttack = second.getStat(Stat.ATK);
    game.move.select(MoveId.MAGIC_ROOM);
    await game.toNextTurn();
    expect(areHeldItemEffectsSuppressed(first)).toBe(true);
    expect(areHeldItemEffectsSuppressed(game.field.getEnemyPokemon())).toBe(true);
    expect(areHeldItemEffectsSuppressed(second)).toBe(false);

    game.doSwitchPokemon(1);
    await game.toNextTurn();
    expect(areHeldItemEffectsSuppressed(second)).toBe(true);
    expect(second.getStat(Stat.ATK)).toBeLessThan(originalAttack);
    game.move.use(MoveId.MAGIC_ROOM);
    await game.toNextTurn();
    expect(areHeldItemEffectsSuppressed(second)).toBe(false);
    expect(second.getStat(Stat.ATK)).toBe(originalAttack);
  });

  it("Embargo targets only one battler in a double battle and fails on overlap", async () => {
    game.override.battleStyle("double");
    await game.classicMode.startBattle(SpeciesId.FEEBAS, SpeciesId.PIDGEOT);
    game.move.select(MoveId.EMBARGO, BattlerIndex.PLAYER, BattlerIndex.ENEMY);
    game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
    await game.toNextTurn();
    const enemy = game.field.getEnemyPokemon();
    expect(game.scene.getField(true).filter(areHeldItemEffectsSuppressed)).toEqual([enemy]);
    expect(enemy.getTag(BattlerTagType.EMBARGO)?.turnCount).toBe(4);
    expect(allMoves[MoveId.EMBARGO].applyConditions(game.field.getPlayerPokemon(), enemy, -1)).toBe(false);
  });

  it("includes suppression timers in multiplayer checkpoints", async () => {
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    game.scene.twoPlayerMode = true;
    const player = game.field.getPlayerPokemon();
    const checkpoint = () => game.scene.getTwoPlayerDebugStateCheckpoint()!.fingerprint;
    const original = checkpoint();
    player.addTag(BattlerTagType.EMBARGO, 5, MoveId.EMBARGO, player.id);
    const embargo = checkpoint();
    expect(embargo).not.toBe(original);
    player.getTag(BattlerTagType.EMBARGO)!.turnCount--;
    expect(checkpoint()).not.toBe(embargo);
    player.removeTag(BattlerTagType.EMBARGO);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, player.id);
    const room = checkpoint();
    expect(room).not.toBe(original);
    game.scene.arena.getTag(ArenaTagType.MAGIC_ROOM)!.turnCount--;
    expect(checkpoint()).not.toBe(room);
  });

  it("switching clears Embargo and restores cached stats", async () => {
    game.override.startingHeldItems([{ name: "SOUL_DEW" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    player.setNature(Nature.ADAMANT);
    const stats = [...player.stats];
    player.addTag(BattlerTagType.EMBARGO, 5, MoveId.EMBARGO, player.id);
    player.leaveField();
    expect(player.getTag(BattlerTagType.EMBARGO)).toBeUndefined();
    expect(player.stats).toEqual(stats);
  });

  it("restores Booster Energy if the holder entered during Magic Room", async () => {
    game.override.ability(AbilityId.PROTOSYNTHESIS).startingHeldItems([{ name: "BOOSTER_ENERGY" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, player.id);
    player.removeTag(BattlerTagType.PROTOSYNTHESIS);
    expect(player.getTag(BattlerTagType.PROTOSYNTHESIS)).toBeUndefined();
    game.scene.arena.removeTag(ArenaTagType.MAGIC_ROOM);
    expect(player.getTag(BattlerTagType.PROTOSYNTHESIS)).toBeDefined();
  });

  it("does not suppress Berry Pot's between-battle progression", async () => {
    game.override.ability(AbilityId.SYMBIOSIS).startingHeldItems([{ name: "BERRY_POT" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    player.addTag(BattlerTagType.EMBARGO, 5, MoveId.EMBARGO, player.id);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, player.id);
    expect(player.getActiveHeldItems()).toHaveLength(1);
  });

  it("gives the AI an equipment-based benefit score without valuing already-suppressed items", async () => {
    game.override.enemyHeldItems([{ name: "LEFTOVERS" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    enemy.hp = Math.floor(enemy.getMaxHp() / 2);
    const room = allMoves[MoveId.MAGIC_ROOM];
    const embargo = allMoves[MoveId.EMBARGO];
    expect(room.getUserBenefitScore(player, enemy, room)).toBeGreaterThan(0);
    expect(embargo.getTargetBenefitScore(player, enemy, embargo)).toBeLessThan(0);
    enemy.addTag(BattlerTagType.EMBARGO, 5, MoveId.EMBARGO, player.id);
    expect(room.getUserBenefitScore(player, enemy, room)).toBe(0);
    expect(embargo.getTargetBenefitScore(player, enemy, embargo)).toBe(0);
    enemy.removeTag(BattlerTagType.EMBARGO);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, MoveId.MAGIC_ROOM, player.id);
    expect(room.getUserBenefitScore(player, enemy, room)).toBeLessThan(0);
  });

  it("restoring one effect does not override the other, and tags survive serialization", async () => {
    game.override.startingHeldItems([{ name: "SOUL_DEW" }]);
    await game.classicMode.startBattle(SpeciesId.FEEBAS);
    const player = game.field.getPlayerPokemon();
    player.addTag(BattlerTagType.EMBARGO, 3, MoveId.EMBARGO, player.id);
    game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 4, MoveId.MAGIC_ROOM, player.id);
    player.summonData.tags = [loadBattlerTag(JSON.parse(JSON.stringify(player.getTag(BattlerTagType.EMBARGO))))];
    game.scene.arena.tags = [
      loadArenaTag(JSON.parse(JSON.stringify(game.scene.arena.getTag(ArenaTagType.MAGIC_ROOM)))),
    ];
    expect(player.getTag(BattlerTagType.EMBARGO)?.turnCount).toBe(3);
    expect(game.scene.arena.getTag(ArenaTagType.MAGIC_ROOM)?.turnCount).toBe(4);
    player.removeTag(BattlerTagType.EMBARGO);
    const dew = player.getHeldItems().find(item => item instanceof PokemonNatureWeightModifier)!;
    expect(dew.isEffectActive(player)).toBe(false);
    game.scene.arena.removeTag(ArenaTagType.MAGIC_ROOM);
    expect(dew.isEffectActive(player)).toBe(true);
  });
});
