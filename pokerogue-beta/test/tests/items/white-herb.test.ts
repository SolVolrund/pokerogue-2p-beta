import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { ResetNegativeStatStageModifier } from "#modifiers/modifier";
import { ModifierTypeOption, type PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { StatStageChangePhase } from "#phases/stat-stage-change-phase";
import { ArenaData } from "#system/arena-data";
import { GameManager } from "#test/framework/game-manager";
import { PartyOption, PartyUiHandler } from "#ui/party-ui-handler";
import { getConsumedHeldItems, removeHeldItemForBattle, restoreBattleRemovedHeldItems } from "#utils/battle-held-items";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Items - rechargeable White Herb ownership and menus", () => {
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
      for (let index = 0; index < 2; index++) {
        game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50));
      }
    }
    game.scene.setActivePlayerIndex(0);
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  const holder = (owner: PlayerIndex, index = 0) => game.scene.getPlayerParty(owner)[index];
  const herbs = (owner: PlayerIndex) =>
    game.scene.getPlayerModifiers(owner).filter(item => item instanceof ResetNegativeStatStageModifier);

  function herb(pokemon: Pokemon) {
    return modifierTypes
      .WHITE_HERB()
      .withIdFromFunc(modifierTypes.WHITE_HERB)
      .newModifier(pokemon) as ResetNegativeStatStageModifier;
  }

  function addHerb(owner: PlayerIndex, index = 0) {
    const item = herb(holder(owner, index));
    expect(game.scene.addModifier(item, true, false, false, true, undefined, owner)).toBe(true);
    return item;
  }

  function checkHerb(pokemon: Pokemon) {
    const phase = new StatStageChangePhase({
      battlerIndex: pokemon.isPlayer() ? BattlerIndex.PLAYER : BattlerIndex.ENEMY,
      changes: [],
      sourcePokemon: undefined,
    });
    phase["checkWhiteHerb"](pokemon);
  }

  it.each([0, 1, 2] as const)("allows one herb for player %i, not one per Pokemon", owner => {
    const original = addHerb(owner, 1);
    holder(owner, 1).hp = 0;
    const achievements = vi.spyOn(game.scene, "validateAchvsForPlayer");
    expect(game.scene.addModifier(herb(holder(owner)), true, false, false, true, undefined, owner)).toBe(false);
    expect(game.scene.addModifier(herb(holder(owner, 1)), true, false, false, true, undefined, owner)).toBe(false);
    expect(herbs(owner)).toEqual([original]);
    expect(achievements).not.toHaveBeenCalled();
  });

  it("allows each of three players to own a separate herb", () => {
    for (const owner of [0, 1, 2] as const) {
      addHerb(owner);
      expect(herbs(owner)).toHaveLength(1);
    }
  });

  it.each([0, 2])("rejects an incoming stack of %i", count => {
    const item = herb(holder(0));
    item.stackCount = count;
    expect(game.scene.addModifier(item, true)).toBe(false);
    expect(game.scene.getPlayerModifiers(0)).toHaveLength(0);
  });

  it("rejects an item addressed to the wrong player's inventory", () => {
    expect(game.scene.addModifier(herb(holder(2)), true, false, false, true, undefined, 0)).toBe(false);
    expect(herbs(0)).toHaveLength(0);
    expect(herbs(2)).toHaveLength(0);
  });

  it("moves the existing herb within a party without resetting recharge", () => {
    const item = addHerb(2);
    game.scene.arena.startPlayerWhiteHerbRecharge(2);
    expect(game.scene.canTransferHeldItemModifier(item, holder(2, 1))).toBe(true);
    expect(PartyUiHandler.FilterItemMaxStacks(holder(2, 1), item)).toBeNull();
    expect(game.scene.tryTransferHeldItemModifier(item, holder(2, 1), false)).toBe(true);
    expect(holder(2).getHeldItems()).toHaveLength(0);
    expect(herbs(2)).toMatchObject([{ pokemonId: holder(2, 1).id, stackCount: 1 }]);
    holder(2, 1).setStatStage(Stat.ATK, -1);
    checkHerb(holder(2, 1));
    expect(holder(2, 1).getStatStage(Stat.ATK)).toBe(-1);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(2)).toBe(45);
  });

  it("blocks a cross-player transfer to a party with an herb on its bench", () => {
    const source = addHerb(0);
    const existing = addHerb(2, 1);
    expect(game.scene.canTransferHeldItemModifier(source, holder(2))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(source, holder(2), false)).toBe(false);
    expect(herbs(0)).toEqual([source]);
    expect(herbs(2)).toEqual([existing]);
    expect(source.stackCount).toBe(1);
  });

  it("allows a cross-player transfer when the recipient owns no herb", () => {
    const item = addHerb(0);
    expect(game.scene.canTransferHeldItemModifier(item, holder(2))).toBe(true);
    expect(game.scene.tryTransferHeldItemModifier(item, holder(2), false)).toBe(true);
    expect(herbs(0)).toHaveLength(0);
    expect(herbs(2)).toMatchObject([{ pokemonId: holder(2).id, stackCount: 1 }]);
  });

  it("rejects a transfer back to the same holder without losing the herb", () => {
    const item = addHerb(0);
    expect(game.scene.canTransferHeldItemModifier(item, holder(0))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(item, holder(0), false)).toBe(false);
    expect(herbs(0)).toEqual([item]);
    expect(item.stackCount).toBe(1);
  });

  it.each([false, true])("rejects a duplicate-herb Pokemon trade atomically (reversed=%s)", reversed => {
    const firstHerb = addHerb(0, 1);
    const secondHerb = addHerb(2);
    holder(2).hp = 0;
    const first = holder(0, 1);
    const second = holder(2, 1);
    first.gtsMalfunctionOriginalPlayerIndex = 2;
    second.gtsMalfunctionOriginalPlayerIndex = 0;
    game.scene.arena.restorePlayerWhiteHerbReadyWaves([43, 44, 45]);
    const parties = [0, 1, 2].map(owner => game.scene.getPlayerParty(owner as PlayerIndex).slice());
    const inventories = [0, 1, 2].map(owner => game.scene.getPlayerModifiers(owner as PlayerIndex).slice());
    const update = vi.spyOn(game.scene, "updateModifiers");
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 0);
    expect(first.isOnField()).toBe(false);
    expect(second.isOnField()).toBe(false);
    expect(reversed ? phase["tradePlayerPokemon"](2, 1, 0, 1) : phase["tradePlayerPokemon"](0, 1, 2, 1)).toBe(false);
    for (const owner of [0, 1, 2] as const) {
      expect(game.scene.getPlayerParty(owner)).toEqual(parties[owner]);
      expect(game.scene.getPlayerModifiers(owner)).toEqual(inventories[owner]);
    }
    expect(firstHerb).toMatchObject({ pokemonId: first.id, stackCount: 1 });
    expect(secondHerb).toMatchObject({ pokemonId: holder(2).id, stackCount: 1 });
    expect(first.gtsMalfunctionOriginalPlayerIndex).toBe(2);
    expect(second.gtsMalfunctionOriginalPlayerIndex).toBe(0);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([43, 44, 45]);
    expect(update).not.toHaveBeenCalled();
  });

  it("permits a balanced Pokemon trade where each player exchanges an herb holder", () => {
    addHerb(0, 1);
    addHerb(2, 1);
    const first = holder(0, 1);
    const second = holder(2, 1);
    game.scene.arena.restorePlayerWhiteHerbReadyWaves([43, 44, 45]);
    expect(new SelectModifierPhase(0, undefined, undefined, false, 0)["tradePlayerPokemon"](0, 1, 2, 1)).toBe(true);
    expect(holder(0, 1)).toBe(second);
    expect(holder(2, 1)).toBe(first);
    expect(herbs(0)).toMatchObject([{ pokemonId: second.id, stackCount: 1 }]);
    expect(herbs(2)).toMatchObject([{ pokemonId: first.id, stackCount: 1 }]);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([43, 44, 45]);
  });

  it.each([0, 1, 2] as const)("allows a Pokemon trade giving player %i their first herb", recipient => {
    const source = ((recipient + 1) % 3) as PlayerIndex;
    addHerb(source, 1);
    const first = holder(source, 1);
    const second = holder(recipient, 1);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](source, 1, recipient, 1)).toBe(true);
    expect(holder(source, 1)).toBe(second);
    expect(holder(recipient, 1)).toBe(first);
    expect(herbs(source)).toHaveLength(0);
    expect(herbs(recipient)).toMatchObject([{ pokemonId: first.id, stackCount: 1 }]);
  });

  it("allows trading non-herb holders when both players already own an herb", () => {
    const firstHerb = addHerb(0);
    const secondHerb = addHerb(2);
    const first = holder(0, 1);
    const second = holder(2, 1);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 1, 2, 1)).toBe(true);
    expect(holder(0, 1)).toBe(second);
    expect(holder(2, 1)).toBe(first);
    expect(herbs(0)).toEqual([firstHerb]);
    expect(herbs(2)).toEqual([secondHerb]);
  });

  it.each(["incoming", "retained", "both"])("includes temporarily removed herbs in a trade (%s)", removed => {
    const firstHerb = addHerb(0, 1);
    const secondHerb = addHerb(2);
    const first = holder(0, 1);
    const second = holder(2, 1);
    if (removed !== "retained") {
      expect(removeHeldItemForBattle(first, firstHerb)).toBe(true);
      first.battleData.removedHeldItems[0].reserveCapacity = false;
    }
    if (removed !== "incoming") {
      expect(removeHeldItemForBattle(holder(2), secondHerb)).toBe(true);
      holder(2).battleData.removedHeldItems[0].reserveCapacity = false;
    }
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 1, 2, 1)).toBe(false);
    expect(holder(0, 1)).toBe(first);
    expect(holder(2, 1)).toBe(second);
    restoreBattleRemovedHeldItems(first);
    restoreBattleRemovedHeldItems(holder(2));
    expect(herbs(0)).toMatchObject([{ pokemonId: first.id, stackCount: 1 }]);
    expect(herbs(2)).toMatchObject([{ pokemonId: holder(2).id, stackCount: 1 }]);
  });

  it("allows exchanging an equipped herb holder for a temporarily removed herb holder", () => {
    const firstHerb = addHerb(0, 1);
    addHerb(2, 1);
    const first = holder(0, 1);
    const second = holder(2, 1);
    expect(removeHeldItemForBattle(first, firstHerb)).toBe(true);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 1, 2, 1)).toBe(true);
    expect(holder(0, 1)).toBe(second);
    expect(holder(2, 1)).toBe(first);
    restoreBattleRemovedHeldItems(first);
    expect(herbs(0)).toMatchObject([{ pokemonId: second.id, stackCount: 1 }]);
    expect(herbs(2)).toMatchObject([{ pokemonId: first.id, stackCount: 1 }]);
  });

  it("explains a rejected trade and restores the reward menu without spending or advancing", async () => {
    addHerb(0, 1);
    addHerb(2);
    const first = holder(0, 1);
    const second = holder(2, 1);
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 0);
    const callback = vi.fn(() => true);
    phase["typeOptions"] = [];
    const modes = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    const partyMenu = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    const message = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    const wait = vi.spyOn(game.scene, "waitForPlayerInput").mockImplementation(() => {});
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    const error = vi.spyOn(game.scene.ui, "playError").mockImplementation(() => {});
    const money = game.scene.getPlayerMoney(0);
    phase["openTradeScreenWithTarget"](0, 2, () => phase["resetModifierSelect"](callback));
    await vi.waitFor(() => expect(partyMenu).toHaveBeenCalledTimes(1));
    (partyMenu.mock.calls[0][3] as (slot: number, option: PartyOption) => void)(1, PartyOption.SELECT);
    await vi.waitFor(() => expect(partyMenu).toHaveBeenCalledTimes(2));
    (partyMenu.mock.calls[1][3] as (slot: number, option: PartyOption) => void)(1, PartyOption.SELECT);
    await vi.waitFor(() => expect(message).toHaveBeenCalled());
    expect(message.mock.calls.at(-1)?.[0]).toContain("one-per-player limit");
    expect(wait.mock.calls.every(([owner]) => owner === 0)).toBe(true);
    message.mock.calls.at(-1)?.[2]?.();
    await vi.waitFor(() => expect(modes.mock.calls.at(-1)?.[0]).toBe(UiMode.MODIFIER_SELECT));
    expect(modes.mock.calls.at(-1)?.[3]).toBe(callback);
    expect(error).toHaveBeenCalledOnce();
    expect(shift).not.toHaveBeenCalled();
    expect(game.scene.getPlayerMoney(0)).toBe(money);
    expect(holder(0, 1)).toBe(first);
    expect(holder(2, 1)).toBe(second);
  });

  it("blocks stealing a duplicate but permits a player's first stolen herb", async () => {
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
    game.scene.getEnemyParty().push(enemy);
    const loot = herb(enemy);
    await game.scene.addEnemyModifier(loot, true);
    const existing = addHerb(2, 1);
    expect(game.scene.canTransferHeldItemModifier(loot, holder(2))).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(loot, holder(2), false)).toBe(false);
    expect(enemy.getHeldItems()).toEqual([loot]);
    expect(loot.stackCount).toBe(1);
    expect(herbs(2)).toEqual([existing]);
    expect(game.scene.canTransferHeldItemModifier(loot, holder(1))).toBe(true);
    expect(game.scene.tryTransferHeldItemModifier(loot, holder(1), false)).toBe(true);
    expect(enemy.getHeldItems()).toHaveLength(0);
    expect(herbs(1)).toHaveLength(1);
  });

  it.each([true, false])("counts temporarily removed herbs with reserveCapacity=%s", reserveCapacity => {
    const item = addHerb(2);
    expect(removeHeldItemForBattle(holder(2), item)).toBe(true);
    holder(2).battleData.removedHeldItems[0].reserveCapacity = reserveCapacity;
    const incoming = addHerb(0);
    expect(game.scene.canReceiveWhiteHerb(2)).toBe(false);
    expect(game.scene.addModifier(herb(holder(2, 1)), true, false, false, true, undefined, 2)).toBe(false);
    expect(game.scene.tryTransferHeldItemModifier(incoming, holder(2, 1), false)).toBe(false);
    restoreBattleRemovedHeldItems(holder(2));
    restoreBattleRemovedHeldItems(holder(2));
    expect(herbs(2)).toHaveLength(1);
    expect(holder(2).battleData.removedHeldItems).toHaveLength(0);
  });

  it("restores only negative stages and starts the actual owner's five-wave cooldown", () => {
    const item = addHerb(2);
    holder(2).setStatStage(Stat.ATK, -2);
    holder(2).setStatStage(Stat.ACC, -1);
    holder(2).setStatStage(Stat.SPD, 2);
    checkHerb(holder(2));
    expect(holder(2).getStatStage(Stat.ATK)).toBe(0);
    expect(holder(2).getStatStage(Stat.ACC)).toBe(0);
    expect(holder(2).getStatStage(Stat.SPD)).toBe(2);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([0, 0, 45]);
    expect(herbs(2)).toEqual([item]);
    expect(getConsumedHeldItems(holder(2))).toHaveLength(0);
  });

  it("does not recharge without a herb or without negative stages", () => {
    holder(0).setStatStage(Stat.ATK, -1);
    checkHerb(holder(0));
    addHerb(2);
    holder(2).setStatStage(Stat.SPD, 2);
    checkHerb(holder(2));
    expect(holder(0).getStatStage(Stat.ATK)).toBe(-1);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([0, 0, 0]);
  });

  it("waits for the final queued stat phase before activating", () => {
    addHerb(0);
    holder(0).setStatStage(Stat.ATK, -1);
    const pending = vi.spyOn(game.scene.phaseManager, "hasPhaseOfType").mockReturnValue(true);
    checkHerb(holder(0));
    expect(holder(0).getStatStage(Stat.ATK)).toBe(-1);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(0);
    pending.mockReturnValue(false);
    checkHerb(holder(0));
    expect(holder(0).getStatStage(Stat.ATK)).toBe(0);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(45);
  });

  it("cannot reactivate early and becomes ready exactly five waves later", () => {
    addHerb(0);
    holder(0).setStatStage(Stat.DEF, -1);
    checkHerb(holder(0));
    for (const wave of [40, 41, 42, 43, 44]) {
      game.scene.currentBattle.waveIndex = wave;
      holder(0).setStatStage(Stat.DEF, -1);
      checkHerb(holder(0));
      expect(holder(0).getStatStage(Stat.DEF)).toBe(-1);
      expect(game.scene.arena.getPlayerWhiteHerbRechargeWavesRemaining(0)).toBe(45 - wave);
    }
    game.scene.currentBattle.waveIndex = 45;
    checkHerb(holder(0));
    expect(holder(0).getStatStage(Stat.DEF)).toBe(0);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(50);
  });

  it("does not reset recharge when an herb is discarded and reacquired", () => {
    const item = addHerb(0);
    game.scene.arena.startPlayerWhiteHerbRecharge(0);
    expect(game.scene.tryDiscardHeldItemModifier(item)).toBe(true);
    addHerb(0, 1);
    holder(0, 1).setStatStage(Stat.ATK, -1);
    checkHerb(holder(0, 1));
    expect(holder(0, 1).getStatStage(Stat.ATK)).toBe(-1);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(45);
  });

  it("keeps enemy herbs consumable without changing player cooldowns", async () => {
    const enemy = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.SHUCKLE), 50, TrainerSlot.NONE);
    game.scene.getEnemyParty().push(enemy);
    await game.scene.addEnemyModifier(herb(enemy), true);
    enemy.setStatStage(Stat.ATK, -1);
    checkHerb(enemy);
    expect(enemy.getStatStage(Stat.ATK)).toBe(0);
    expect(enemy.getHeldItems()).toHaveLength(0);
    expect(getConsumedHeldItems(enemy)).toHaveLength(1);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([0, 0, 0]);
  });

  it("preserves cooldowns across arena changes but resets them for a fresh arena", () => {
    game.scene.arena.restorePlayerWhiteHerbReadyWaves([41, 44, 45]);
    const previous = game.scene.arena.playerWhiteHerbReadyWaveByPlayer;
    game.scene.newArena(BiomeId.FOREST, 0, true);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([41, 44, 45]);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).not.toBe(previous);
    game.scene.newArena(BiomeId.TOWN);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([0, 0, 0]);
  });

  it("defaults old and partial arena data safely and copies readiness arrays", () => {
    const oldSave = { biome: BiomeId.TOWN, weather: null, terrain: null, positionalTags: [] };
    expect(new ArenaData(oldSave).playerWhiteHerbReadyWaveByPlayer).toEqual([0, 0, 0]);
    const waves = [45];
    const data = new ArenaData({ ...oldSave, playerWhiteHerbReadyWaveByPlayer: waves });
    expect(data.playerWhiteHerbReadyWaveByPlayer).toEqual([45, 0, 0]);
    waves[0] = 99;
    expect(data.playerWhiteHerbReadyWaveByPlayer[0]).toBe(45);
  });

  it("preserves ownership and all players' cooldowns through a full session reload", async () => {
    for (const owner of [0, 1, 2] as const) {
      addHerb(owner);
      game.scene.arena.startPlayerWhiteHerbRecharge(owner, 38 + owner);
    }
    const save = JSON.stringify(game.scene.gameData.getSessionSaveData());
    await game.scene.gameData.loadSessionSnapshot(save);
    expect(game.scene.arena.playerWhiteHerbReadyWaveByPlayer).toEqual([43, 44, 45]);
    for (const owner of [0, 1, 2] as const) {
      expect(herbs(owner)).toHaveLength(1);
      expect(game.scene.canReceiveWhiteHerb(owner)).toBe(false);
      holder(owner).setStatStage(Stat.ATK, -1);
      checkHerb(holder(owner));
      expect(holder(owner).getStatStage(Stat.ATK)).toBe(-1);
    }
  });

  it("filters duplicates for the selected owner and CPU reward selection", () => {
    const item = addHerb(2, 1);
    const type = item.type as PokemonHeldItemModifierType;
    expect(type.selectFilter?.(holder(2))).not.toBeNull();
    expect(type.selectFilter?.(holder(0))).toBeNull();
    const options = [new ModifierTypeOption(type, 0)];
    expect(chooseComputerPartnerRewardOption(options, game.scene.getPlayerParty(2))).toBeUndefined();
  });

  it.each([-1, 100])("returns a stale rejected choice to the same reward menu at cost %i", async cost => {
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    const type = herb(holder(2)).type as PokemonHeldItemModifierType;
    const options = [new ModifierTypeOption(type, 0)];
    phase["typeOptions"] = options;
    const callback = vi.fn(() => true);
    const modes = vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    const partyMenu = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    vi.spyOn(game.scene, "waitForPlayerInput").mockImplementation(() => {});
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    const error = vi.spyOn(game.scene.ui, "playError").mockImplementation(() => {});
    phase["openModifierMenu"](type, cost, callback);
    const chooseRecipient = partyMenu.mock.calls[0][3] as (slot: number, option: PartyOption) => void;
    addHerb(2, 1);
    const money = game.scene.getPlayerMoney(2);
    chooseRecipient(0, PartyOption.APPLY);
    await vi.waitFor(() =>
      expect(modes.mock.calls.some(args => args[2] === options && args[3] === callback)).toBe(true),
    );
    expect(modes.mock.calls.at(-1)?.[0]).toBe(UiMode.MODIFIER_SELECT);
    expect(error).toHaveBeenCalledOnce();
    expect(shift).not.toHaveBeenCalled();
    expect(game.scene.getPlayerMoney(2)).toBe(money);
    expect(herbs(2)).toHaveLength(1);
  });

  it("ends a stale CPU reward safely instead of leaving its turn waiting for input", () => {
    addHerb(2, 1);
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "playError").mockImplementation(() => {});
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    phase["applyComputerPartnerRewardModifier"](herb(holder(2)));
    expect(shift).toHaveBeenCalledOnce();
    expect(herbs(2)).toHaveLength(1);
  });
});

describe("Items - rechargeable White Herb in battle", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingLevel(50)
      .enemyLevel(50)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.SHUCKLE)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.SHELL_SMASH, MoveId.SPLASH])
      .startingHeldItems([{ name: "WHITE_HERB" }]);
  });

  it("restores Shell Smash drops once, keeps boosts and does not restore the following turn", async () => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE);
    const pokemon = game.field.getPlayerPokemon();
    game.move.select(MoveId.SHELL_SMASH);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.ATK)).toBe(2);
    expect(pokemon.getStatStage(Stat.DEF)).toBe(0);
    expect(pokemon.getStatStage(Stat.SPDEF)).toBe(0);
    expect(pokemon.getHeldItems().filter(item => item.is("ResetNegativeStatStageModifier"))).toHaveLength(1);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(game.scene.currentBattle.waveIndex + 5);
    game.move.select(MoveId.SHELL_SMASH);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.ATK)).toBe(4);
    expect(pokemon.getStatStage(Stat.DEF)).toBe(-1);
    expect(pokemon.getStatStage(Stat.SPDEF)).toBe(-1);
  });

  it("handles enemy-caused drops with the same recharge rule", async () => {
    game.override.enemyMoveset(MoveId.GROWL);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE);
    const pokemon = game.field.getPlayerPokemon();
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.ATK)).toBe(0);
    game.move.select(MoveId.SPLASH);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.ATK)).toBe(-1);
  });

  it("preserves this build's Klutz behavior for beneficial held items", async () => {
    game.override.ability(AbilityId.KLUTZ);
    await game.classicMode.startBattle(SpeciesId.BLASTOISE);
    game.move.select(MoveId.SHELL_SMASH);
    await game.toNextTurn();
    const pokemon = game.field.getPlayerPokemon();
    expect(pokemon.getStatStage(Stat.DEF)).toBe(0);
    expect(pokemon.getStatStage(Stat.SPDEF)).toBe(0);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(game.scene.currentBattle.waveIndex + 5);
  });

  it.each([
    MoveId.EMBARGO,
    MoveId.MAGIC_ROOM,
  ])("does not start recharge under item suppression from move %i", async move => {
    await game.classicMode.startBattle(SpeciesId.BLASTOISE);
    const pokemon = game.field.getPlayerPokemon();
    if (move === MoveId.EMBARGO) {
      pokemon.addTag(BattlerTagType.EMBARGO, 5, move, pokemon.id);
    } else {
      game.scene.arena.addTag(ArenaTagType.MAGIC_ROOM, 5, move, pokemon.id);
    }
    game.move.select(MoveId.SHELL_SMASH);
    await game.toNextTurn();
    expect(pokemon.getStatStage(Stat.DEF)).toBe(-1);
    expect(pokemon.getStatStage(Stat.SPDEF)).toBe(-1);
    expect(game.scene.arena.getPlayerWhiteHerbReadyWave(0)).toBe(0);
    expect(pokemon.getHeldItems().filter(item => item.is("ResetNegativeStatStageModifier"))).toHaveLength(1);
  });
});
