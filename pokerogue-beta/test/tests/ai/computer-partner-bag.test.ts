import { modifierTypes } from "#data/data-lists";
import { BerryType } from "#enums/berry-type";
import { Command } from "#enums/command";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Pokemon } from "#field/pokemon";
import { BerryModifierType, ModifierTypeOption, PokemonHeldItemModifierType, SpeciesStatBoosterModifierType } from "#modifiers/modifier-type";
import { CommandPhase } from "#phases/command-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { UseBagMedicinePhase } from "#phases/use-bag-medicine-phase";
import { GameManager } from "#test/framework/game-manager";
import { chooseComputerPartnerRewardOption, chooseComputerPartnerStockPurchase } from "#utils/computer-partner-reward-ai";
import { getModifierType } from "#utils/modifier-utils";
import { storeRewardInBag } from "#utils/item-bag";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("CPU partner bags", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  beforeAll(() => { phaserGame = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    vi.spyOn(Pokemon.prototype, "updateInfo").mockResolvedValue();
    game.scene.configureTwoPlayerMode(true, 6, true, 3, [1, 2]);
    game.scene.newBattle();
    for (const owner of [0, 1, 2] as const) {
      for (let i = 0; i < 2; i++) {
        game.scene.getPlayerParty(owner).push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EMPOLEON), 50));
      }
    }
    vi.spyOn(game.scene.phaseManager, "shiftPhase").mockImplementation(() => {});
  });
  afterEach(() => game.scene.configureTwoPlayerMode(false));
  const option = (id: keyof typeof modifierTypes, cost = 0) =>
    new ModifierTypeOption(getModifierType(modifierTypes[id]), 0, cost);
  function visit(rewards: ModifierTypeOption[], shop: ModifierTypeOption[]) {
    const phase = new SelectModifierPhase(0, undefined, undefined, false, 2);
    phase["typeOptions"] = rewards;
    vi.spyOn(phase as unknown as { getComputerPartnerShopOptions(): ModifierTypeOption[] }, "getComputerPartnerShopOptions").mockReturnValue(shop);
    expect(phase["tryAutoComputerPartnerShopPurchases"]()).toBe(true);
  }
  it("re-equips released gear on the preferred teammate without consuming the free reward or using other bags", async () => {
    const party = game.scene.getPlayerParty(2);
    const released = party[0];
    const ace = party[1];
    ace.computerPartnerAce = true;
    const type = option("LEFTOVERS").type as PokemonHeldItemModifierType;
    expect(game.scene.addModifier(type.newModifier(released), true, false, false, true, undefined, 2)).toBe(true);
    await game.scene.removePartyMemberModifiers(0, 2, true);
    party[0] = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.SNORLAX), 50);
    expect(storeRewardInBag(0, type)).toBe(true);
    expect(storeRewardInBag(1, type)).toBe(true);
    const money = game.scene.getPlayerMoney(2);
    visit([option("HYPER_POTION")], []);
    expect(ace.getHeldItems().map(i => i.type.id)).toContain("LEFTOVERS");
    expect(party[0].getHeldItems()).toHaveLength(0);
    expect(game.scene.getPlayerBag(2)).toHaveLength(0);
    expect(game.scene.getPlayerBag(0)).toHaveLength(1);
    expect(game.scene.getPlayerBag(1)).toHaveLength(1);
    expect(game.scene.getPlayerBagMedicines(2)).toEqual([{ typeId: "HYPER_POTION", quantity: 1 }]);
    expect(game.scene.getPlayerMoney(2)).toBe(money);
  });
  it("splits a rescued stack up to each holder's cap and keeps the excess on repeated visits", () => {
    const type = new BerryModifierType(BerryType.SITRUS);
    type.id = "BERRY";
    for (let i = 0; i < 7; i++) {
      expect(storeRewardInBag(2, type)).toBe(true);
    }
    visit([], []);
    visit([], []);
    expect(game.scene.getPlayerParty(2).map(p => p.getHeldItems()[0].stackCount)).toEqual([2, 2]);
    expect(game.scene.getPlayerBag(2).map(i => i.stackCount)).toEqual([3]);
  });
  it("can equip an already-owned herb and waits for a useful recipient for a Light Ball", () => {
    const herb = option("WHITE_HERB").type as PokemonHeldItemModifierType;
    const lightBall = new SpeciesStatBoosterModifierType("LIGHT_BALL");
    expect(storeRewardInBag(2, herb)).toBe(true);
    expect(storeRewardInBag(2, lightBall)).toBe(true);
    visit([], []);
    expect(game.scene.getPlayerParty(2).flatMap(p => p.getHeldItems()).map(i => i.type.id)).toEqual(["WHITE_HERB"]);
    expect(game.scene.getPlayerBag(2).map(i => i.type)).toEqual([lightBall]);
    const pikachu = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.PIKACHU), 50);
    game.scene.getPlayerParty(2).push(pikachu);
    visit([], []);
    expect(pikachu.getHeldItems().map(i => i.type)).toEqual([lightBall]);
    expect(game.scene.getPlayerBag(2)).toHaveLength(0);
  });
  it("banks a good free potion for a healthy party without touching other players or money", () => {
    const potion = option("HYPER_POTION");
    potion.type.tier = ModifierTier.GREAT;
    const offers = [option("POKEBALL"), new ModifierTypeOption(new BerryModifierType(BerryType.SITRUS), 0), potion];
    const money = game.scene.getPlayerMoney(2);
    visit(offers, []);
    expect(game.scene.getPlayerBagMedicines(2)).toEqual([{ typeId: "HYPER_POTION", quantity: 1 }]);
    expect(game.scene.getPlayerMoney(2)).toBe(money);
    expect(game.scene.getPlayerBagMedicines(0)).toEqual([]);
    expect(game.scene.getPlayerBagMedicines(1)).toEqual([]);
    const bag = [{ typeId: "HYPER_POTION", quantity: 2 }];
    const party = game.scene.getPlayerParty(2);
    const context = { bagMedicines: bag, pokeballCounts: { [PokeballType.POKEBALL]: 4 } };
    expect(chooseComputerPartnerRewardOption(offers, party, context)?.itemId).not.toBe("HYPER_POTION");
    party[0].hp = 1;
    const needed = chooseComputerPartnerRewardOption([potion], party, context);
    expect(needed?.targetPokemonIndex).toBe(0);
    expect(needed?.storeInBag).toBeUndefined();
  });
  it("buys only one item for storage and preserves it when buying treatment on the next visit", () => {
    const shop = [option("POTION", 10), option("HYPER_POTION", 80), option("REVIVE", 100)];
    game.scene.setPlayerMoney(1000, 2);
    visit([], shop);
    expect(game.scene.getPlayerBagMedicines(2)).toEqual([{ typeId: "HYPER_POTION", quantity: 1 }]);
    expect(game.scene.getPlayerMoney(2)).toBe(920);
    const patient = game.scene.getPlayerParty(2)[1];
    patient.hp = 1;
    game.scene.setPlayerMoney(80, 2);
    visit([], [option("HYPER_POTION", 80)]);
    expect(patient.isFullHp()).toBe(true);
    expect(game.scene.getPlayerBagMedicines(2)).toEqual([{ typeId: "HYPER_POTION", quantity: 1 }]);
    expect(game.scene.getPlayerMoney(2)).toBe(0);
  });
  it("protects emergency savings and does not buy an offered free copy or keep buying a complete kit", () => {
    const shop = [option("POTION", 10), option("REVIVE", 100)];
    const party = game.scene.getPlayerParty(1);
    expect(chooseComputerPartnerStockPurchase(shop, [], party, 119, [])).toBeUndefined();
    expect(chooseComputerPartnerStockPurchase(shop, [], party, 1000, shop)).toBeUndefined();
    expect(chooseComputerPartnerStockPurchase(shop, [
      { typeId: "SUPER_POTION", quantity: 2 }, { typeId: "REVIVE", quantity: 1 },
    ], party, 1000, [])).toBeUndefined();
  });
  it("buys two immediate treatments and one additional item for storage on the same visit", () => {
    const party = game.scene.getPlayerParty(2);
    party.forEach(pokemon => { pokemon.hp = 1; });
    game.scene.setPlayerMoney(500, 2);
    visit([], [option("MAX_POTION", 90)]);
    expect(party.filter(p => p.isFullHp())).toHaveLength(2);
    expect(game.scene.getPlayerBagMedicines(2)).toEqual([{ typeId: "MAX_POTION", quantity: 1 }]);
    expect(game.scene.getPlayerMoney(2)).toBe(230);
  });
  it("queues the CPU's own Revive as its turn and revives its bench without consuming another player's copy", () => {
    const [actor, reserve] = game.scene.getPlayerParty(1);
    reserve.hp = 0;
    for (const owner of [0, 1, 2] as const) {
      game.scene.getPlayerBagMedicines(owner).push({ typeId: "REVIVE", quantity: 1 });
    }
    const command = new CommandPhase(1);
    vi.spyOn(command, "end").mockImplementation(() => {});
    vi.spyOn(actor, "getNextMove").mockReturnValue({ move: MoveId.SPLASH, targets: [actor.getBattlerIndex()], useMode: MoveUseMode.NORMAL });
    expect(command["continueComputerPartnerCommand"](actor, 1, true)).toBe(true);
    const queued = game.scene.currentBattle.turnCommands[actor.getBattlerIndex()];
    expect(queued).toMatchObject({ command: Command.MEDICINE, medicine: { typeId: "REVIVE", targetId: reserve.id }, playerIndex: 1 });
    const use = new UseBagMedicinePhase(1, queued!.medicine!);
    vi.spyOn(use, "end").mockImplementation(() => {});
    use.start();
    expect(reserve.hp).toBe(Math.floor(reserve.getMaxHp() / 2));
    expect(game.scene.getPlayerBagMedicines(1)).toEqual([]);
    expect([0, 2].map(i => game.scene.getPlayerBagMedicines(i as 0 | 2)[0].quantity)).toEqual([1, 1]);
  });
});
