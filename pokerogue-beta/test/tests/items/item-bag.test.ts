import type { PlayerIndex } from "#app/battle-scene";
import { modifierTypes } from "#data/data-lists";
import { Status } from "#data/status-effect";
import { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { PlayerGender } from "#enums/player-gender";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { BaseStatModifier, type PokemonHeldItemModifier } from "#modifiers/modifier";
import {
  BaseStatBoosterModifierType,
  BerryModifierType,
  DestinyKnotModifierType,
  getPlayerShopModifierTypeOptionsForWave,
  type PokemonModifierType,
} from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import type { BagUiHandler } from "#ui/bag-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { PartyUiHandler } from "#ui/party-ui-handler";
import { activateCooldownHeldItem, findReadyCooldownHeldItem } from "#utils/cooldown-held-items";
import {
  canBagRewardType,
  canUseBagMedicine,
  depositBagItem,
  getBagWithdrawCapacity,
  isBagMedicineType,
  restoreBagItems,
  restoreBagMedicines,
  storeRewardInBag,
  useBagMedicine,
  withdrawBagItem,
} from "#utils/item-bag";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { canReceiveThread, getSoulBondPartner } from "#utils/soul-bond";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Item bag - storage, multiplayer and party UI", () => {
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
      for (let index = 0; index < 3; index++) {
        game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50));
      }
    }
  });
  afterEach(() => {
    game.scene.ui.handlers[UiMode.BAG].clear();
    game.scene.ui.resetModeChain();
    game.scene.configureTwoPlayerMode(false);
  });
  const holder = (owner: PlayerIndex = 0, slot = 0) => game.scene.getPlayerParty(owner)[slot];
  function rewardType(id: keyof typeof modifierTypes): PokemonModifierType {
    const factory = modifierTypes[id];
    return factory().withIdFromFunc(factory) as PokemonModifierType;
  }
  function add(id: "LEFTOVERS" | "WHITE_HERB" | "POWER_HERB", owner: PlayerIndex = 0, slot = 0, count = 1) {
    const factory = modifierTypes[id];
    const item = factory().withIdFromFunc(factory).newModifier(holder(owner, slot)) as PokemonHeldItemModifier;
    item.stackCount = count;
    expect(game.scene.addModifier(item, true, false, false, true, undefined, owner)).toBe(true);
    return item;
  }
  function addBerry(owner: PlayerIndex, slot = 0, count = 3) {
    const type = new BerryModifierType(BerryType.SITRUS);
    type.id = "BERRY";
    const item = type.newModifier(holder(owner, slot));
    item.stackCount = count;
    expect(game.scene.addModifier(item, true, false, false, true, undefined, owner)).toBe(true);
    return item;
  }
  function addThread(owner: PlayerIndex, slot = 0) {
    const type = new DestinyKnotModifierType("red");
    type.id = "DESTINY_KNOT";
    const item = type.newModifier(holder(owner, slot));
    expect(game.scene.addModifier(item, true, false, false, true, undefined, owner)).toBe(true);
    return item;
  }

  it("deposits partial stacks without granting their held effects and withdraws to another holder", () => {
    const item = add("LEFTOVERS", 1, 0, 3);
    expect(depositBagItem(1, holder(1), item, 2)).toBe(true);
    expect(item.stackCount).toBe(1);
    const stored = game.scene.getPlayerBag(1)[0];
    expect(stored.pokemonId).toBe(-1);
    expect(stored.stackCount).toBe(2);
    expect(game.scene.getPlayerModifiers(1)).not.toContain(stored);
    expect(game.scene.getPlayerBag(0)).toHaveLength(0);
    expect(withdrawBagItem(1, holder(1, 1), stored, 1)).toBe(true);
    expect(holder(1, 1).getHeldItems()[0].stackCount).toBe(1);
    expect(stored.stackCount).toBe(1);
  });

  it("merges stored berries past the per-Pokemon limit, but respects that limit on withdrawal", () => {
    for (const slot of [0, 1, 2]) {
      const berry = addBerry(0, slot);
      expect(depositBagItem(0, holder(0, slot), berry, 3)).toBe(true);
    }
    const bag = game.scene.getPlayerBag(0);
    expect(bag).toHaveLength(1);
    expect(bag[0].stackCount).toBe(9);
    const capacity = getBagWithdrawCapacity(0, holder(), bag[0]);
    expect(capacity).toBe(bag[0].getMaxHeldItemCount(holder()));
    expect(withdrawBagItem(0, holder(), bag[0], capacity + 1)).toBe(false);
    expect(withdrawBagItem(0, holder(), bag[0], capacity)).toBe(true);
    expect(getBagWithdrawCapacity(0, holder(), bag[0])).toBe(0);
  });

  it.each([
    0,
    -1,
    0.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    4,
  ])("rejects an invalid deposit quantity %s without losing anything", quantity => {
    const item = add("LEFTOVERS", 0, 0, 3);
    expect(depositBagItem(0, holder(), item, quantity)).toBe(false);
    expect(item.stackCount).toBe(3);
    expect(game.scene.getPlayerBag(0)).toHaveLength(0);
  });

  it("rejects non-transferable, guest and borrowed items, and cross-player access", () => {
    const item = add("LEFTOVERS", 1);
    expect(depositBagItem(0, holder(1), item, 1)).toBe(false);
    item.isTransferable = false;
    expect(depositBagItem(1, holder(1), item, 1)).toBe(false);
    item.isTransferable = true;
    item.eonFluteGuestItem = true;
    expect(depositBagItem(1, holder(1), item, 1)).toBe(false);
    item.eonFluteGuestItem = false;
    item.recoverableBattleTransfer = { pokemonId: holder(0).id, playerIndex: 0 };
    expect(depositBagItem(1, holder(1), item, 1)).toBe(false);
    item.recoverableBattleTransfer = undefined;
    expect(depositBagItem(1, holder(1), item, 1)).toBe(true);
    expect(withdrawBagItem(0, holder(), game.scene.getPlayerBag(1)[0], 1)).toBe(false);
    expect(withdrawBagItem(1, holder(), game.scene.getPlayerBag(1)[0], 1)).toBe(false);
  });

  it("retains cooldowns and blocks reacquisition and trades while equipment is stored", () => {
    const herb = add("POWER_HERB", 2);
    expect(activateCooldownHeldItem(holder(2), "POWER_HERB")).toBe(true);
    expect(depositBagItem(2, holder(2), herb, 1)).toBe(true);
    expect(game.scene.canReceiveCooldownHeldItem("POWER_HERB", 2)).toBe(false);
    const incoming = add("POWER_HERB", 0, 1);
    expect(game.scene.tryTransferHeldItemModifier(incoming, holder(2), false)).toBe(false);
    expect(new SelectModifierPhase()["tradePlayerPokemon"](0, 1, 2, 1)).toBe(false);
    const stored = game.scene.getPlayerBag(2)[0];
    expect(withdrawBagItem(2, holder(2, 1), stored, 1)).toBe(true);
    expect(game.scene.arena.getPlayerHeldItemReadyWave("POWER_HERB", 2)).toBe(45);
    expect(findReadyCooldownHeldItem(holder(2, 1), "POWER_HERB")).toBeUndefined();
  });

  it("counts stored Threads toward the global pair limit without bonding stored copies", () => {
    const first = addThread(0);
    addThread(1);
    expect(getSoulBondPartner(holder())).toBe(holder(1));
    expect(depositBagItem(0, holder(), first, 1)).toBe(true);
    expect(getSoulBondPartner(holder(1))).toBeUndefined();
    expect(canReceiveThread(holder(2), "red")).toBe(false);
    const stored = game.scene.getPlayerBag(0)[0];
    expect(withdrawBagItem(0, holder(0, 1), stored, 1)).toBe(true);
    expect(getSoulBondPartner(holder(1))).toBe(holder(0, 1));
  });

  it("withdraws two stored Threads individually without bypassing the one-Thread holder limit", () => {
    for (const slot of [0, 1]) {
      const item = addThread(0, slot);
      expect(depositBagItem(0, holder(0, slot), item, 1)).toBe(true);
    }
    const stored = game.scene.getPlayerBag(0)[0];
    expect(stored.stackCount).toBe(2);
    expect(withdrawBagItem(0, holder(), stored, 1)).toBe(true);
    expect(withdrawBagItem(0, holder(), stored, 1)).toBe(false);
    expect(withdrawBagItem(0, holder(0, 1), stored, 1)).toBe(true);
  });

  it("rescues transferable items on release, but not non-transferable investments or fusion cleanup", async () => {
    add("LEFTOVERS", 2, 0, 2);
    const vitamin = new BaseStatModifier(new BaseStatBoosterModifierType(Stat.HP), holder(2).id, Stat.HP, 1);
    game.scene.getPlayerModifiers(2).push(vitamin);
    await game.scene.removePartyMemberModifiers(0, 2, true);
    expect(game.scene.getPlayerBag(2).map(item => [item.type.id, item.stackCount])).toEqual([["LEFTOVERS", 2]]);
    expect(game.scene.getPlayerModifiers(2)).toHaveLength(0);
    add("LEFTOVERS", 1);
    await game.scene.removePartyMemberModifiers(0, 1);
    expect(game.scene.getPlayerBag(1)).toHaveLength(0);
  });

  it("preserves bags and generated berry types for all three players across save/load", async () => {
    for (const owner of [0, 1, 2] as const) {
      const item = add("WHITE_HERB", owner);
      expect(depositBagItem(owner, holder(owner), item, 1)).toBe(true);
      const berry = addBerry(owner);
      expect(depositBagItem(owner, holder(owner), berry, 3)).toBe(true);
      game.scene.arena.startPlayerHeldItemRecharge("WHITE_HERB", owner, 38 + owner);
    }
    game.scene.newArena(BiomeId.FOREST, 0, true);
    const save = JSON.stringify(game.scene.gameData.getSessionSaveData());
    await game.scene.gameData.loadSessionSnapshot(save);
    for (const owner of [0, 1, 2] as const) {
      expect(game.scene.getPlayerBag(owner)).toHaveLength(2);
      expect(game.scene.getPlayerBag(owner)[1].getArgs().slice(1)).toEqual([BerryType.SITRUS]);
      expect(game.scene.canReceiveWhiteHerb(owner)).toBe(false);
      expect(game.scene.arena.getPlayerHeldItemReadyWave("WHITE_HERB", owner)).toBe(43 + owner);
      expect(withdrawBagItem(owner, holder(owner), game.scene.getPlayerBag(owner)[0], 1)).toBe(true);
    }
  });

  it("saves a solo bag and clears stale bag ownership before restoring equipped cooldown items", async () => {
    game.scene.configureTwoPlayerMode(false);
    const herb = add("WHITE_HERB");
    game.scene.newArena(BiomeId.FOREST, 0, true);
    const equippedSave = JSON.stringify(game.scene.gameData.getSessionSaveData());
    expect(depositBagItem(0, holder(), herb, 1)).toBe(true);
    const bagSave = JSON.stringify(game.scene.gameData.getSessionSaveData());
    await game.scene.gameData.loadSessionSnapshot(equippedSave);
    expect(game.scene.getPlayerBag(0)).toHaveLength(0);
    expect(
      holder()
        .getHeldItems()
        .some(item => item.type.id === "WHITE_HERB"),
    ).toBe(true);
    await game.scene.gameData.loadSessionSnapshot(bagSave);
    expect(game.scene.getPlayerBag(0)[0].type.id).toBe("WHITE_HERB");
    expect(holder().getHeldItems()).toHaveLength(0);
  });

  it("rescues a borrowed battle item to its original owner's bag on release", async () => {
    const item = add("LEFTOVERS", 1);
    item.recoverableBattleTransfer = { pokemonId: holder(0).id, playerIndex: 0 };
    await game.scene.removePartyMemberModifiers(0, 1, true);
    expect(game.scene.getPlayerBag(1)).toHaveLength(0);
    expect(game.scene.getPlayerBag(0)).toHaveLength(1);
    expect(game.scene.getPlayerBag(0)[0].recoverableBattleTransfer).toBeUndefined();
    expect(game.scene.getPlayerModifiers(1)).toHaveLength(0);
  });

  it("rolls back a rejected withdrawal without losing or duplicating the stored stack", () => {
    const item = add("LEFTOVERS");
    expect(depositBagItem(0, holder(), item, 1)).toBe(true);
    const stored = game.scene.getPlayerBag(0)[0];
    vi.spyOn(game.scene, "addModifier").mockReturnValueOnce(false);
    expect(withdrawBagItem(0, holder(), stored, 1)).toBe(false);
    expect(game.scene.getPlayerBag(0)).toEqual([stored]);
    expect(stored.stackCount).toBe(1);
    expect(holder().getHeldItems()).toHaveLength(0);
  });

  it("restores bag stacks without per-holder clamping, and defaults old saves to empty bags", async () => {
    const item = addBerry(0);
    depositBagItem(0, holder(), item, 3);
    const data = new ModifierData(game.scene.getPlayerBag(0)[0], true);
    data.stackCount = 20;
    expect(restoreBagItems([data])[0].stackCount).toBe(20);
    expect(restoreBagItems()).toEqual([]);
    game.scene.newArena(BiomeId.FOREST, 0, true);
    const old = game.scene.gameData.getSessionSaveData();
    delete old.bagItems;
    old.players?.forEach(player => delete player.bagItems);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(old));
    expect(game.scene.getActivePlayerIndexes().map(owner => game.scene.getPlayerBag(owner))).toEqual([[], [], []]);
  });

  it("cycles Transfer -> Discard -> Bag, then opens the selected Pokemon without moving items", async () => {
    const party = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    party.show([PartyUiMode.MODIFIER_TRANSFER, 0, vi.fn()]);
    party.setCursor(7);
    party.processInput(Button.ACTION);
    expect(party["partyUiMode"]).toBe(PartyUiMode.DISCARD);
    party.processInput(Button.ACTION);
    expect(party["partyUiMode"]).toBe(PartyUiMode.BAG);
    party.setCursor(1);
    const open = vi.spyOn(game.scene.ui, "setOverlayMode").mockResolvedValue();
    party.processInput(Button.ACTION);
    expect(open).toHaveBeenCalledWith(UiMode.BAG, 0, holder(0, 1), expect.any(Function));
    party.clear();
  });

  it("switches columns with C, confirms quantities, and keeps held/max counts distinct", () => {
    add("LEFTOVERS", 0, 0, 3);
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    bag.show([0, holder()]);
    expect(bag["getRows"](0)).toEqual([]);
    bag.processInput(Button.STATS);
    expect(bag["column"]).toBe(1);
    expect(bag["getRows"](1)[0].quantity).toBe(3);
    bag.processInput(Button.ACTION);
    bag.processInput(Button.RIGHT);
    bag.processInput(Button.ACTION);
    expect(game.scene.getPlayerBag(0)[0].stackCount).toBe(2);
    expect(bag["getRows"](1)[0].quantity).toBe(1);
    bag.processInput(Button.STATS);
    bag.processInput(Button.ACTION);
    bag.processInput(Button.CANCEL);
    expect(game.scene.getPlayerBag(0)[0].stackCount).toBe(2);
    bag.processInput(Button.ACTION);
    bag.processInput(Button.ACTION);
    expect(game.scene.getPlayerBag(0)[0].stackCount).toBe(1);
    expect(bag.getTwoPlayerInputContextState().column).toBe(0);
  });

  it("uses the standard white cursor for both columns and Cancel instead of row highlights", () => {
    add("LEFTOVERS");
    expect(storeRewardInBag(0, rewardType("EVIOLITE"))).toBe(true);
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    bag.show([0, holder()]);
    const cursor = bag["cursorObj"];
    expect(cursor.name).toBe("item-selection-cursor");
    expect([cursor.x, cursor.y, cursor.visible]).toEqual([132, 36, true]);
    expect(bag["views"].flat().every(view => !("highlight" in view))).toBe(true);
    bag.processInput(Button.STATS);
    expect([cursor.x, cursor.y]).toEqual([230, 36]);
    bag.processInput(Button.DOWN);
    const cancel = bag["cancelLabels"][1];
    expect(cursor.x).toBe(cancel.x - cancel.displayWidth / 2 - 6);
    expect(cursor.y).toBe(cancel.y + 7);
    expect(cancel.text.startsWith(">")).toBe(false);
    bag.clear();
    expect(cursor.visible).toBe(false);
  });

  it("keeps the selection arrow on the visible scrolled row and on Cancel for empty pockets", () => {
    for (const id of ["POTION", "SUPER_POTION", "HYPER_POTION", "MAX_POTION", "ETHER", "REVIVE"] as const) {
      expect(storeRewardInBag(0, rewardType(id))).toBe(true);
    }
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    bag.show([0, holder()]);
    const cursor = bag["cursorObj"];
    expect(cursor.y).toBe(bag["cancelLabels"][0].y + 7);
    for (let i = 0; i < 3; i++) bag.processInput(Button.RIGHT);
    for (let i = 0; i < 5; i++) bag.processInput(Button.DOWN);
    expect(bag["scrollOffsets"][0]).toBe(1);
    expect([cursor.x, cursor.y]).toEqual([132, 104]);
    bag.processInput(Button.DOWN);
    expect(cursor.y).toBe(bag["cancelLabels"][0].y + 7);
    bag.processInput(Button.DOWN);
    expect(bag["scrollOffsets"][0]).toBe(0);
    expect([cursor.x, cursor.y]).toEqual([132, 36]);
  });

  it("offers six pockets and read-only balls, with male and female themes", () => {
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    vi.spyOn(game.scene, "getTrainerGender").mockReturnValue(PlayerGender.FEMALE);
    bag.show([0, holder()]);
    bag.processInput(Button.LEFT);
    expect(bag["getRows"](0).every(row => !row.enabled && !row.item)).toBe(true);
    expect(bag["getRows"](0).length).toBeGreaterThan(0);
    for (let count = 0; count < 6; count++) {
      bag.processInput(Button.RIGHT);
    }
    expect(bag.getTwoPlayerInputContextState().pocket).toBe(0);
    expect(bag["bags"]).toHaveLength(6);
    expect(bag.processInput(Button.ACTION)).toBe(false);
  });

  it("uses the same ball description in the player's Bag and below the reward inventory line", () => {
    game.scene.activePlayerIndex = 1;
    const counts = game.scene.getPlayerPokeballCounts(1);
    counts[PokeballType.CLONE_BALL] = 3;
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    bag.show([1, holder(1)]);
    bag.processInput(Button.LEFT);
    const ball = bag["getRows"](0).find(row => row.icon === "cb")!;
    expect(ball.description).toContain("clones a Pokémon rather than capturing");
    expect(ball.description).toContain("Catch Rate: 100%");
    expect(modifierTypes.CLONE_BALL().getDescription()).toBe(
      `Receive Clone Ball x1 (Inventory: 3)\n${ball.description}`,
    );
  });

  it("uses separate themed windows and restores the description width after quantity confirmation", () => {
    add("LEFTOVERS");
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    const resize = vi.spyOn(bag["descriptionWindow"], "setSize");
    bag.show([0, holder()]);
    const windows = bag["container"].list.filter(child => child.name?.startsWith("bag-"));
    expect(windows.map(window => window.name)).toEqual([
      "bag-header-0",
      "bag-list-0",
      "bag-header-1",
      "bag-list-1",
      "bag-instructions",
      "bag-description",
    ]);
    expect(resize).toHaveBeenLastCalledWith(196, 48);
    bag.processInput(Button.STATS);
    bag.processInput(Button.ACTION);
    expect(resize).toHaveBeenLastCalledWith(98, 48);
    expect(bag["quantityWindow"].visible).toBe(true);
    bag.processInput(Button.CANCEL);
    expect(resize).toHaveBeenLastCalledWith(196, 48);
    expect(bag["quantityWindow"].visible).toBe(false);
  });

  it.each([
    "POTION",
    "ETHER",
    "MAX_ETHER",
    "ELIXIR",
    "REVIVE",
    "FULL_HEAL",
    "FULL_RESTORE",
  ] as const)("stores %s without using it or requiring an eligible target", id => {
    const hp = holder(2).hp;
    expect(storeRewardInBag(2, rewardType(id))).toBe(true);
    expect(storeRewardInBag(2, rewardType(id))).toBe(true);
    expect(game.scene.getPlayerBagMedicines(2)).toEqual([{ typeId: id, quantity: 2 }]);
    expect(game.scene.getPlayerBagMedicines(0)).toEqual([]);
    expect(holder(2).hp).toBe(hp);
    expect(holder(2).getHeldItems()).toEqual([]);
  });

  it("stores held rewards unequipped and still enforces cooldown-item and Thread limits", () => {
    expect(storeRewardInBag(1, rewardType("EVIOLITE"))).toBe(true);
    expect(holder(1).getHeldItems()).toHaveLength(0);
    expect(game.scene.getPlayerBag(1)[0].type.id).toBe("EVIOLITE");
    expect(game.scene.getPlayerBag(1)[0].pokemonId).toBe(-1);
    expect(storeRewardInBag(1, rewardType("WHITE_HERB"))).toBe(true);
    expect(storeRewardInBag(1, rewardType("WHITE_HERB"))).toBe(false);
    addThread(0);
    const thread = new DestinyKnotModifierType("red");
    thread.id = "DESTINY_KNOT";
    expect(storeRewardInBag(0, thread)).toBe(true);
    expect(storeRewardInBag(2, thread)).toBe(false);
    expect(canReceiveThread(holder(2), "red")).toBe(false);
  });

  it("does not offer Bag storage for non-transferable investments, fusion or partner revives", () => {
    for (const id of ["RARE_CANDY", "PARTNER_REVIVE", "DNA_SPLICERS", "MEMORY_MUSHROOM"] as const) {
      expect(canBagRewardType(rewardType(id), 0)).toBe(false);
      expect(storeRewardInBag(0, rewardType(id))).toBe(false);
    }
    expect(canBagRewardType(new BaseStatBoosterModifierType(Stat.HP), 0)).toBe(false);
  });

  it("uses one potion on its owner's Pokemon, rejecting full HP, fainting and cross-player use", () => {
    storeRewardInBag(1, rewardType("POTION"));
    storeRewardInBag(1, rewardType("POTION"));
    const medicine = game.scene.getPlayerBagMedicines(1)[0];
    expect(useBagMedicine(1, holder(1), medicine)).toBe(false);
    holder(1).hp = 0;
    expect(useBagMedicine(1, holder(1), medicine)).toBe(false);
    holder(0).hp = 1;
    holder(1).hp = 1;
    expect(useBagMedicine(1, holder(0), medicine)).toBe(false);
    expect(useBagMedicine(0, holder(0), medicine)).toBe(false);
    expect(useBagMedicine(1, holder(1), medicine)).toBe(true);
    expect(holder(1).hp).toBe(21);
    expect(holder(0).hp).toBe(1);
    expect(medicine.quantity).toBe(1);
  });

  it("revives and heals statuses using the existing medicine effects", () => {
    storeRewardInBag(0, rewardType("REVIVE"));
    const revive = game.scene.getPlayerBagMedicines(0)[0];
    expect(useBagMedicine(0, holder(), revive)).toBe(false);
    holder().hp = 0;
    expect(useBagMedicine(0, holder(), revive)).toBe(true);
    expect(holder().hp).toBeGreaterThan(0);
    expect(game.scene.getPlayerBagMedicines(0)).toHaveLength(0);
    storeRewardInBag(0, rewardType("FULL_HEAL"));
    const heal = game.scene.getPlayerBagMedicines(0)[0];
    expect(useBagMedicine(0, holder(), heal)).toBe(false);
    holder().status = new Status(StatusEffect.BURN);
    expect(useBagMedicine(0, holder(), heal)).toBe(true);
    expect(holder().status).toBeFalsy();
  });

  it("requires a valid depleted move for Ether, but restores all moves with Elixir", () => {
    holder().moveset = [new PokemonMove(MoveId.TACKLE), new PokemonMove(MoveId.GROWL)];
    holder().moveset[1].ppUsed = 12;
    storeRewardInBag(0, rewardType("ETHER"));
    const ether = game.scene.getPlayerBagMedicines(0)[0];
    expect(canUseBagMedicine(0, holder(), ether)).toBe(true);
    expect(useBagMedicine(0, holder(), ether)).toBe(false);
    expect(useBagMedicine(0, holder(), ether, 0)).toBe(false);
    expect(useBagMedicine(0, holder(), ether, 4)).toBe(false);
    expect(useBagMedicine(0, holder(), ether, 1)).toBe(true);
    expect(holder().moveset[1].ppUsed).toBe(2);
    expect(useBagMedicine(0, holder(), ether, 1)).toBe(false);
    storeRewardInBag(0, rewardType("ELIXIR"));
    expect(useBagMedicine(0, holder(), game.scene.getPlayerBagMedicines(0)[0])).toBe(true);
    expect(holder().moveset[1].ppUsed).toBe(0);
  });

  it("preserves medicine on failed application", () => {
    storeRewardInBag(0, rewardType("POTION"));
    holder().hp = 1;
    const medicine = game.scene.getPlayerBagMedicines(0)[0];
    vi.spyOn(game.scene, "addModifier").mockReturnValueOnce(false);
    expect(useBagMedicine(0, holder(), medicine)).toBe(false);
    expect(medicine.quantity).toBe(1);
  });

  it("persists medicines for each player and clears them when loading an older save", async () => {
    for (const owner of [0, 1, 2] as const) {
      for (let count = 0; count <= owner; count++) {
        storeRewardInBag(owner, rewardType("POTION"));
      }
    }
    game.scene.newArena(BiomeId.FOREST, 0, true);
    const save = game.scene.gameData.getSessionSaveData();
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    for (const owner of [0, 1, 2] as const) {
      expect(game.scene.getPlayerBagMedicines(owner)).toEqual([{ typeId: "POTION", quantity: Math.min(2, owner + 1) }]);
    }
    delete save.bagMedicines;
    save.players?.forEach(player => delete player.bagMedicines);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    expect(game.scene.getActivePlayerIndexes().map(owner => game.scene.getPlayerBagMedicines(owner))).toEqual([
      [],
      [],
      [],
    ]);
  });

  it("caps storage per medicine and owner without charging, ending the reward, or truncating old stacks", () => {
    const potion = rewardType("POTION");
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase");
    game.scene.setPlayerMoney(500, 2);
    expect(storeRewardInBag(2, potion)).toBe(true);
    expect(storeRewardInBag(2, potion)).toBe(true);
    expect(canBagRewardType(potion, 2)).toBe(false);
    expect(phase["storeModifierInBag"](potion, 100)).toBe(false);
    expect(phase["storeModifierInBag"](potion, -1)).toBe(false);
    expect(shift).not.toHaveBeenCalled();
    expect(game.scene.getPlayerMoney(2)).toBe(500);
    expect(storeRewardInBag(2, rewardType("SUPER_POTION"))).toBe(true);
    expect(storeRewardInBag(0, potion)).toBe(true);
    const stack = game.scene.getPlayerBagMedicines(2)[0];
    stack.quantity = 4;
    expect(storeRewardInBag(2, potion)).toBe(false);
    expect(stack.quantity).toBe(4);
    holder(2).hp = 1;
    expect(useBagMedicine(2, holder(2), stack)).toBe(true);
    expect(stack.quantity).toBe(3);
  });

  it("validates restored medicine records and merges duplicate stacks", () => {
    expect(
      restoreBagMedicines([
        { typeId: "POTION", quantity: 2 },
        { typeId: "POTION", quantity: 3 },
        { typeId: "WHITE_HERB", quantity: 1 },
        { typeId: "ETHER", quantity: -1 },
        { typeId: "REVIVE", quantity: 0.5 },
        { typeId: "UNKNOWN", quantity: 1 },
      ]),
    ).toEqual([{ typeId: "POTION", quantity: 5 }]);
    expect(restoreBagMedicines()).toEqual([]);
  });

  it("adds Bag left of Cancel only for eligible reward menus and submits once", () => {
    const party = game.scene.ui.handlers[UiMode.PARTY] as PartyUiHandler;
    const store = vi.fn();
    const cancel = vi.fn();
    party.show([PartyUiMode.MODIFIER, 0, cancel, undefined, undefined, undefined, false, store]);
    expect(party["partyStoreBagButton"].visible).toBe(true);
    party.setCursor(6);
    party.processInput(Button.LEFT);
    expect(party.getCursor()).toBe(8);
    party.processInput(Button.RIGHT);
    expect(party.getCursor()).toBe(6);
    party.processInput(Button.LEFT);
    party.processInput(Button.ACTION);
    party.processInput(Button.ACTION);
    expect(store).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    party.clear();
    party.show([PartyUiMode.CHECK, 0, cancel]);
    expect(party["partyStoreBagButton"].visible).toBe(false);
    party.clear();
  });

  it.each([-1, 100])("stores rewards through the menu and settles cost %s exactly once", async cost => {
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    game.scene.setPlayerMoney(1000, 2);
    const partyMenu = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "getHandler").mockReturnValue(game.scene.ui.handlers[UiMode.MODIFIER_SELECT]);
    vi.spyOn(
      game.scene.ui.handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler,
      "updateCostText",
    ).mockImplementation(() => {});
    vi.spyOn(game.scene, "waitForPlayerInput").mockImplementation(() => {});
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    game.scene.currentBattle.waveIndex = 1;
    const shopPotion = getPlayerShopModifierTypeOptionsForWave(1, game.scene.getWaveMoneyAmount(1))[0];
    if (cost < 0) {
      phase["openModifierMenu"](rewardType("POTION"), cost, () => true);
    } else {
      phase["selectShopModifierOption"](phase["getFirstShopRowCursor"](), 0, () => true);
    }
    const store = partyMenu.mock.calls[0][8] as () => void;
    expect(store).toBeTypeOf("function");
    store();
    await vi.waitFor(() => expect(game.scene.getPlayerBagMedicines(2)).toHaveLength(1));
    expect(game.scene.getPlayerMoney(2)).toBe(cost < 0 ? 1000 : 1000 - shopPotion.cost);
    expect(game.scene.getPlayerBagMedicines(0)).toHaveLength(0);
    expect(shift).toHaveBeenCalledTimes(cost < 0 ? 1 : 0);
  });

  it("stores all ordinary shop medicines with IDs that survive saving and reloading", () => {
    const medicines = getPlayerShopModifierTypeOptionsForWave(151, 100).filter(option =>
      isBagMedicineType(option.type),
    );
    expect(medicines.map(option => option.type.id)).toEqual([
      "POTION",
      "ETHER",
      "REVIVE",
      "SUPER_POTION",
      "FULL_HEAL",
      "ELIXIR",
      "MAX_ETHER",
      "HYPER_POTION",
      "MAX_REVIVE",
      "MAX_POTION",
      "MAX_ELIXIR",
      "FULL_RESTORE",
    ]);
    for (const option of medicines) {
      expect(storeRewardInBag(2, option.type as PokemonModifierType)).toBe(true);
    }
    const saved = JSON.parse(JSON.stringify(game.scene.getPlayerBagMedicines(2)));
    expect(restoreBagMedicines(saved)).toEqual(medicines.map(option => ({ typeId: option.type.id, quantity: 1 })));
  });

  it("rejects unaffordable or duplicate bag purchases without charging or ending the reward", () => {
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    game.scene.setPlayerMoney(50, 2);
    const shift = vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
    expect(phase["storeModifierInBag"](rewardType("POTION"), 100)).toBe(false);
    add("WHITE_HERB", 2);
    expect(phase["storeModifierInBag"](rewardType("WHITE_HERB"), -1)).toBe(false);
    expect(game.scene.getPlayerMoney(2)).toBe(50);
    expect(game.scene.getPlayerBagMedicines(2)).toHaveLength(0);
    expect(game.scene.getPlayerBag(2)).toHaveLength(0);
    expect(shift).not.toHaveBeenCalled();
  });

  it("offers confirmation for bag medicine and move selection for Ether without consuming on cancel", () => {
    holder().hp = 1;
    holder().moveset = [new PokemonMove(MoveId.TACKLE, 2), new PokemonMove(MoveId.GROWL)];
    storeRewardInBag(0, rewardType("POTION"));
    storeRewardInBag(0, rewardType("ETHER"));
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    bag.show([0, holder()]);
    for (let i = 0; i < 3; i++) {
      bag.processInput(Button.RIGHT);
    }
    expect(bag["getRows"](0)).toHaveLength(2);
    const overlay = vi.spyOn(game.scene.ui, "setOverlayMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "revertMode").mockResolvedValue(true);
    bag.processInput(Button.ACTION);
    const options = overlay.mock.calls[0][1].options;
    expect(options[0].label).toContain("Potion");
    options.at(-1).handler();
    expect(game.scene.getPlayerBagMedicines(0)[0].quantity).toBe(1);
    bag.processInput(Button.DOWN);
    bag.processInput(Button.ACTION);
    const moves = overlay.mock.calls[1][1].options;
    expect(moves[0].disabled).toBe(false);
    expect(moves[1].disabled).toBe(true);
    expect(moves[0].handler()).toBe(true);
    expect(holder().moveset[0].ppUsed).toBe(0);
    expect(game.scene.getPlayerBagMedicines(0).map(item => item.typeId)).toEqual(["POTION"]);
  });
});
