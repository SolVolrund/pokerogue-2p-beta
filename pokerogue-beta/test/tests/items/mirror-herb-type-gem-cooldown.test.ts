import { ALL_COOLDOWN_HELD_ITEM_IDS, getSavedCooldownHeldItemId, getTypeGemCooldownId } from "#data/cooldown-held-items";
import { allMoves, modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { Pokemon } from "#field/pokemon";
import { MirrorHerbModifier, type PokemonHeldItemModifier, TypeGemModifier } from "#modifiers/modifier";
import { modifierPool } from "#modifiers/modifier-pools";
import { getAvailableTypeGemTypes, type TypeGemModifierType } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import { getConsumedHeldItems, removeHeldItemForBattle, restoreBattleRemovedHeldItems } from "#utils/battle-held-items";
import { NumberHolder } from "#utils/common";
import { activateCooldownHeldItem, applyTypeGemBoost, findReadyCooldownHeldItem } from "#utils/cooldown-held-items";
import { depositBagItem, restoreBagItems, storeRewardInBag, withdrawBagItem } from "#utils/item-bag";
import { ModifierData } from "#system/modifier-data";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

function gem(pokemon: Pokemon, type = PokemonType.FIRE): TypeGemModifier {
  const factory = modifierTypes.TYPE_GEM;
  const generator = factory();
  generator.withIdFromFunc(factory);
  const generated = generator.generateType([pokemon], [type]) as TypeGemModifierType;
  return generated.newModifier(pokemon) as TypeGemModifier;
}

function herb(pokemon: Pokemon): MirrorHerbModifier {
  const factory = modifierTypes.MIRROR_HERB;
  return factory().withIdFromFunc(factory).newModifier(pokemon) as MirrorHerbModifier;
}

describe("Mirror Herb and Gems - inventory compatibility", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    game.scene.configureTwoPlayerMode(true, 6, false, 3);
    game.scene.newBattle();
    game.scene.currentBattle.waveIndex = 40;
    for (const owner of [0, 1, 2] as const) {
      for (let i = 0; i < 3; i++) {
        game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50));
      }
    }
  });
  afterEach(() => game.scene.configureTwoPlayerMode(false));
  const holder = (owner: 0 | 1 | 2 = 0, slot = 0) => game.scene.getPlayerParty(owner)[slot];
  const add = (item: PokemonHeldItemModifier, owner: 0 | 1 | 2 = 0) =>
    game.scene.addModifier(item, true, false, false, true, undefined, owner);

  it("keeps all 18 Gem timers separate for each player through save/load and biome changes", async () => {
    for (const owner of [0, 1, 2] as const) {
      for (let type = PokemonType.NORMAL; type <= PokemonType.FAIRY; type++) {
        expect(add(gem(holder(owner), type), owner)).toBe(true);
        game.scene.arena.startPlayerHeldItemRecharge(getTypeGemCooldownId(type), owner, 40 + type + owner);
      }
    }
    game.scene.newArena(BiomeId.FOREST, 0, true);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(game.scene.gameData.getSessionSaveData()));
    for (const owner of [0, 1, 2] as const) {
      expect(holder(owner).getHeldItems()).toHaveLength(18);
      for (let type = PokemonType.NORMAL; type <= PokemonType.FAIRY; type++) {
        expect(game.scene.arena.getPlayerHeldItemReadyWave(getTypeGemCooldownId(type), owner)).toBe(45 + type + owner);
        expect(add(gem(holder(owner, 1), type), owner)).toBe(false);
      }
    }
    expect(ALL_COOLDOWN_HELD_ITEM_IDS).toHaveLength(24);
  });

  it.each([
    "Mirror Herb",
    "Gem",
  ])("preserves legacy %s stacks and copies without multiplying activations", async kind => {
    const make = kind === "Gem" ? gem : herb;
    const id = kind === "Gem" ? getTypeGemCooldownId(PokemonType.FIRE) : "MIRROR_HERB";
    const first = make(holder());
    first.stackCount = 3;
    game.scene.getPlayerModifiers(0).push(first, make(holder(0, 1)));
    const bagItem = make(holder());
    bagItem.pokemonId = -1;
    bagItem.stackCount = 2;
    game.scene.getPlayerBag(0).push(bagItem);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(game.scene.gameData.getSessionSaveData()));
    const copies = () =>
      [...game.scene.getPlayerModifiers(0), ...game.scene.getPlayerBag(0)]
        .filter(item => (kind === "Gem" ? item instanceof TypeGemModifier : item instanceof MirrorHerbModifier))
        .reduce((sum, item) => sum + item.stackCount, 0);
    expect(copies()).toBe(6);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 2, 1, 2)).toBe(true);
    expect(activateCooldownHeldItem(holder(), id)).toBe(true);
    expect(activateCooldownHeldItem(holder(0, 1), id)).toBe(false);
    expect(getConsumedHeldItems(holder())).toEqual([]);
    expect(add(make(holder(0, 2)))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(holder().getHeldItems()[0], holder(0, 2), false)).toBe(true);
    expect(depositBagItem(0, holder(0, 2), holder(0, 2).getHeldItems()[0], 1)).toBe(true);
    expect(withdrawBagItem(0, holder(0, 2), game.scene.getPlayerBag(0)[0], 1)).toBe(true);
    expect(findReadyCooldownHeldItem(holder(0, 2), id)).toBeUndefined();
    expect(copies()).toBe(6);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 2, 1, 2)).toBe(true);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](1, 2, 0, 2)).toBe(false);
  });

  it("migrates Mirror Herbs saved under the old berry generator without rolling a berry or clamping copies", async () => {
    add(herb(holder()));
    const save = JSON.parse(JSON.stringify(game.scene.gameData.getSessionSaveData()));
    const oldHerb = save.players[0].modifiers.find((item: ModifierData) => item.className === "MirrorHerbModifier");
    oldHerb.typeId = "BERRY";
    oldHerb.stackCount = 2;
    expect(getSavedCooldownHeldItemId(oldHerb)).toBe("MIRROR_HERB");
    const bag = restoreBagItems([oldHerb]);
    expect(bag[0]).toBeInstanceOf(MirrorHerbModifier);
    expect(bag[0].type.id).toBe("MIRROR_HERB");
    expect(bag[0].stackCount).toBe(2);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    expect(holder().getHeldItems()[0]).toBeInstanceOf(MirrorHerbModifier);
    expect(holder().getHeldItems()[0].type.id).toBe("MIRROR_HERB");
    expect(holder().getHeldItems()[0].stackCount).toBe(2);
  });

  it("blocks new Gem rewards, theft and trades of an owned type, including Bag and removed items", async () => {
    const fire = gem(holder());
    expect(add(fire)).toBe(true);
    expect(depositBagItem(0, holder(), fire, 1)).toBe(true);
    expect(storeRewardInBag(0, gem(holder()).type as TypeGemModifierType)).toBe(false);
    expect(add(gem(holder(), PokemonType.WATER))).toBe(true);
    const other = gem(holder(1));
    expect(add(other, 1)).toBe(true);
    expect(game.scene.tryTransferHeldItemModifier(other, holder(), false)).toBe(false);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 1, 1, 0)).toBe(false);
    expect(withdrawBagItem(0, holder(), game.scene.getPlayerBag(0)[0], 1)).toBe(true);
    const removed = holder()
      .getHeldItems()
      .find(item => item instanceof TypeGemModifier && item.moveType === PokemonType.FIRE)!;
    expect(removeHeldItemForBattle(holder(), removed)).toBe(true);
    expect(game.scene.canReceiveCooldownHeldItem(getTypeGemCooldownId(PokemonType.FIRE), 0)).toBe(false);
    expect(game.scene.canReceiveCooldownHeldItem(getTypeGemCooldownId(PokemonType.GRASS), 0)).toBe(true);
    restoreBattleRemovedHeldItems(holder());
    expect(holder().getHeldItems()).toHaveLength(2);
  });

  it("does not acquire duplicate cooldown equipment through captured recovery claims", async () => {
    add(gem(holder()));
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
    game.scene.getEnemyParty().push(enemy);
    const enemyGem = gem(enemy);
    await game.scene.addEnemyModifier(enemyGem, true);
    expect(removeHeldItemForBattle(enemy, enemyGem)).toBe(true);
    const captured = enemy.addToParty(PokeballType.POKEBALL, -1, 0)!;
    expect(captured.battleData.removedHeldItems).toEqual([]);
  });
});

describe("Mirror Herb and Gems - battle activation", () => {
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
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .criticalHits(false)
      .moveset([MoveId.EMBER, MoveId.DOUBLE_KICK, MoveId.SPLASH]);
  });

  it("Mirror Herb ignores Berry Pouches, does not waste a charge at the cap, and cannot fire twice", async () => {
    game.override.enemyMoveset(MoveId.HOWL).startingHeldItems([{ name: "MIRROR_HERB" }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const item = player.getHeldItems()[0] as MirrorHerbModifier;
    player.setStatStage(Stat.ATK, 6);
    expect(item.apply(player, [{ stat: Stat.ATK, stages: 1 }])).toBe(false);
    expect(game.scene.arena.isPlayerHeldItemReady("MIRROR_HERB")).toBe(true);
    player.setStatStage(Stat.ATK, 0);
    const pouch = modifierTypes.BERRY_POUCH().withIdFromFunc(modifierTypes.BERRY_POUCH).newModifier()!;
    game.scene.addModifier(pouch, true);
    const preservation = vi.spyOn(pouch, "apply");
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("MIRROR_HERB")).toBe(6);
    expect(preservation).not.toHaveBeenCalled();
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(player.getStatStage(Stat.ATK)).toBe(1);
    expect(getConsumedHeldItems(player)).toEqual([]);
  });

  it("keeps a single 30% boost for both hits, then stops boosting while on cooldown", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIGHTING }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const damage = vi.spyOn(game.field.getEnemyPokemon(), "damageAndUpdate");
    const move = allMoves[MoveId.DOUBLE_KICK];
    if (!move.is("AttackMove")) throw new Error("Expected a damaging move");
    const powerCheck = vi.spyOn(move, "calculateBattlePower");
    game.move.select(MoveId.DOUBLE_KICK);
    await game.toNextTurn();
    expect(damage.mock.calls).toHaveLength(2);
    const powers = powerCheck.mock.results
      .filter((_, index) => powerCheck.mock.calls[index][2] === false)
      .map(result => result.value);
    expect(powers).toEqual([39, 39]);
    expect(game.scene.arena.getPlayerHeldItemReadyWave(getTypeGemCooldownId(PokemonType.FIGHTING))).toBe(6);
    expect(player.getHeldItems()[0].stackCount).toBe(1);
    const power = new NumberHolder(100);
    applyTypeGemBoost(player, PokemonType.FIGHTING, power, MoveId.DOUBLE_KICK, true);
    expect(power.value).toBe(100);
    expect(getConsumedHeldItems(player)).toEqual([]);
  });

  it("boosts all spread targets once and does not boost the following attack", async () => {
    game.override
      .battleStyle("double")
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
      .startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.GROUND }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER, SpeciesId.FEEBAS);
    const move = allMoves[MoveId.EARTHQUAKE];
    if (!move.is("AttackMove")) throw new Error("Expected a damaging move");
    const powerCheck = vi.spyOn(move, "calculateBattlePower");
    const powers = () =>
      powerCheck.mock.results
        .filter((_, index) => powerCheck.mock.calls[index][2] === false)
        .map(result => result.value);
    for (const expected of [130, 100]) {
      powerCheck.mockClear();
      game.move.select(MoveId.EARTHQUAKE, BattlerIndex.PLAYER);
      game.move.select(MoveId.SPLASH, BattlerIndex.PLAYER_2);
      await game.toNextTurn();
      expect(powers()).toEqual([expected, expected, expected]);
    }
  });

  it("simulates without spending a charge and preserves one attack's boost after activation", async () => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    const duplicate = gem(player);
    game.scene.getPlayerModifiers().push(duplicate);
    const power = () => new NumberHolder(100);
    const simulated = power();
    applyTypeGemBoost(player, PokemonType.FIRE, simulated, MoveId.EMBER, true);
    expect(simulated.value).toBe(130);
    expect(player.turnData.typeGemMoveId).toBeUndefined();
    expect(game.scene.arena.isPlayerHeldItemReady(getTypeGemCooldownId(PokemonType.FIRE))).toBe(true);
    const first = power();
    applyTypeGemBoost(player, PokemonType.FIRE, first, MoveId.EMBER, false);
    expect(first.value).toBe(130);
    expect(activateCooldownHeldItem(player, getTypeGemCooldownId(PokemonType.FIRE))).toBe(true);
    player.turnData.typeGemActivated = true;
    const second = power();
    applyTypeGemBoost(player, PokemonType.FIRE, second, MoveId.EMBER, false);
    expect(second.value).toBe(130);
    const next = power();
    applyTypeGemBoost(player, PokemonType.FIRE, next, MoveId.EMBER, true);
    expect(next.value).toBe(100);
  });

  it.each(["miss", "protect", "immune"])("does not spend a Gem on %s", async condition => {
    game.override.startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.NORMAL }]).moveset([MoveId.TACKLE]);
    if (condition === "protect") game.override.enemyMoveset(MoveId.PROTECT);
    if (condition === "immune") game.override.enemySpecies(SpeciesId.GASTLY);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    if (condition === "miss") vi.spyOn(allMoves[MoveId.TACKLE], "calculateBattleAccuracy").mockReturnValue(0);
    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    expect(game.scene.arena.isPlayerHeldItemReady(getTypeGemCooldownId(PokemonType.NORMAL))).toBe(true);
    expect(getConsumedHeldItems(game.field.getPlayerPokemon())).toEqual([]);
  });

  it("filters owned Gem types from their single Great-tier generator and never generates Mirror Herb as a berry", async () => {
    game.override
      .moveset([MoveId.EMBER, MoveId.WATER_GUN])
      .startingHeldItems([{ name: "TYPE_GEM", type: PokemonType.FIRE }]);
    await game.classicMode.startBattle(SpeciesId.CHARMANDER);
    const player = game.field.getPlayerPokemon();
    expect(getAvailableTypeGemTypes(player)).toEqual([PokemonType.WATER]);
    const factory = modifierTypes.TYPE_GEM;
    for (let i = 0; i < 30; i++) {
      const generator = factory();
      generator.withIdFromFunc(factory);
      const type = generator.generateType([player]) as TypeGemModifierType;
      expect(type.moveType).toBe(PokemonType.WATER);
      expect(modifierTypes.BERRY().generateType([player])?.newModifier(player)).not.toBeInstanceOf(MirrorHerbModifier);
    }
    expect(game.scene.addModifier(gem(player, PokemonType.WATER), true)).toBe(true);
    expect(factory().generateType([player])).toBeNull();
    const entries = modifierPool[ModifierTier.GREAT].filter(entry => entry.modifierType.id === "TYPE_GEM");
    expect(entries).toHaveLength(1);
    expect(typeof entries[0].weight === "function" && entries[0].weight([player], 0)).toBe(0);
    expect(modifierPool[ModifierTier.COMMON].some(entry => entry.modifierType.id === "MIRROR_HERB")).toBe(false);
  });
});
