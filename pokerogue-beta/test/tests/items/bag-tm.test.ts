import type { PlayerIndex } from "#app/battle-scene";
import { allMoves } from "#data/data-lists";
import { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { TmModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { LearnMovePhase } from "#phases/learn-move-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import type { OptionSelectConfig } from "#ui/abstract-option-select-ui-handler";
import type { BagUiHandler } from "#ui/bag-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import {
  canBagRewardType,
  canUseBagTm,
  getBagTmType,
  restoreBagTms,
  storeRewardInBag,
  useBagTm,
} from "#utils/item-bag";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Bag TMs", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  const holder = (owner: PlayerIndex = 0) => game.scene.getPlayerParty(owner)[0];
  const store = (owner: PlayerIndex = 0, moveId = MoveId.PROTECT) => {
    expect(storeRewardInBag(owner, new TmModifierType(moveId))).toBe(true);
    return game.scene.getPlayerBagTms(owner).find(item => item.moveId === moveId)!;
  };

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
    for (const owner of [0, 1, 2] as const) {
      const pokemon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50);
      pokemon.moveset = [new PokemonMove(MoveId.TACKLE)];
      game.scene.getPlayerParty(owner).push(pokemon);
    }
  });
  afterEach(() => {
    game.scene.ui.handlers[UiMode.BAG].clear();
    game.scene.ui.resetModeChain();
    game.scene.configureTwoPlayerMode(false);
  });

  it("stores exact moves, merges copies and does not learn or queue learning when acquired", () => {
    const queue = vi.spyOn(game.scene.phaseManager, "unshiftNew");
    expect(canBagRewardType(new TmModifierType(MoveId.PROTECT), 2)).toBe(true);
    store(2);
    store(2);
    store(2, MoveId.THUNDERBOLT);
    expect(game.scene.getPlayerBagTms(2)).toEqual([
      { moveId: MoveId.PROTECT, quantity: 2 },
      { moveId: MoveId.THUNDERBOLT, quantity: 1 },
    ]);
    expect(holder(2).moveset.map(move => move!.moveId)).toEqual([MoveId.TACKLE]);
    expect(game.scene.getPlayerBagTms(0)).toEqual([]);
    expect(queue).not.toHaveBeenCalled();
  });

  it("rejects incompatible, already-known, empty and other players' TMs", () => {
    const tm = store(1);
    expect(canUseBagTm(1, holder(1), tm)).toBe(true);
    expect(canUseBagTm(0, holder(), tm)).toBe(false);
    expect(canUseBagTm(1, holder(), tm)).toBe(false);
    expect(canUseBagTm(1, holder(1), { ...tm })).toBe(false);
    expect(canUseBagTm(1, holder(1), store(1, MoveId.THUNDERBOLT))).toBe(false);
    holder(1).setMove(1, MoveId.PROTECT);
    expect(canUseBagTm(1, holder(1), tm)).toBe(false);
    tm.quantity = 0;
    expect(useBagTm(1, holder(1), tm, vi.fn())).toBe(false);
  });

  it("validates saved TM records and merges duplicates without sharing saved references", () => {
    const saved = { moveId: MoveId.PROTECT, quantity: 2 };
    const restored = restoreBagTms([
      saved,
      { moveId: MoveId.PROTECT, quantity: 3 },
      { moveId: MoveId.NONE, quantity: 1 },
      { moveId: -1 as MoveId, quantity: 1 },
      { moveId: MoveId.TOXIC, quantity: -1 },
      { moveId: MoveId.TOXIC, quantity: 0.5 },
      { moveId: MoveId.TOXIC, quantity: Number.POSITIVE_INFINITY },
    ]);
    expect(restored).toEqual([{ moveId: MoveId.PROTECT, quantity: 5 }]);
    expect(saved.quantity).toBe(2);
    expect(restoreBagTms()).toEqual([]);
    expect(getBagTmType(restored[0])?.moveId).toBe(MoveId.PROTECT);
    restored[0].quantity = Number.MAX_SAFE_INTEGER;
    game.scene.getPlayerState(0).bagTms = restored;
    expect(storeRewardInBag(0, new TmModifierType(MoveId.PROTECT))).toBe(false);
  });

  it("saves all three owners independently and clears TMs for older saves", async () => {
    for (const owner of [0, 1, 2] as const) {
      for (let count = 0; count <= owner; count++) {
        store(owner);
      }
    }
    game.scene.newArena(BiomeId.FOREST, 0, true);
    const save = game.scene.gameData.getSessionSaveData();
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    for (const owner of [0, 1, 2] as const) {
      expect(game.scene.getPlayerBagTms(owner)).toEqual([{ moveId: MoveId.PROTECT, quantity: owner + 1 }]);
    }
    delete save.bagTms;
    save.players?.forEach(player => delete player.bagTms);
    await game.scene.gameData.loadSessionSnapshot(JSON.stringify(save));
    expect(game.scene.getActivePlayerIndexes().map(owner => game.scene.getPlayerBagTms(owner))).toEqual([[], [], []]);
  });

  it.each([-1, 100])("stores a reward TM with cost %s without starting learning", async cost => {
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
    phase["openModifierMenu"](new TmModifierType(MoveId.PROTECT), cost, () => true);
    const storeCallback = partyMenu.mock.calls[0][8] as () => void;
    expect(storeCallback).toBeTypeOf("function");
    storeCallback();
    await vi.waitFor(() => expect(game.scene.getPlayerBagTms(2)).toHaveLength(1));
    expect(game.scene.getPlayerMoney(2)).toBe(cost < 0 ? 1000 : 900);
    expect(shift).toHaveBeenCalledTimes(cost < 0 ? 1 : 0);
    expect(game.scene.phaseManager.hasPhaseOfType("LearnMovePhase")).toBe(false);
  });

  function beginLearning(owner: PlayerIndex = 2) {
    const tm = store(owner);
    const standby = new SelectModifierPhase(0, undefined, undefined, false, owner);
    game.scene.phaseManager["currentPhase"] = standby;
    game.scene.phaseManager.pushNew("SelectModifierPhase");
    const done = vi.fn();
    expect(useBagTm(owner, holder(owner), tm, done)).toBe(true);
    const phase = game.scene.phaseManager.getCurrentPhase() as LearnMovePhase;
    expect(phase).toBeInstanceOf(LearnMovePhase);
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "showTextPromise").mockResolvedValue();
    const text = vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    return { tm, phase, standby, done, text };
  }

  it("learns into an empty slot, consumes once and preserves the pending reward phase", () => {
    const { tm, phase, standby, done, text } = beginLearning();
    phase.start();
    expect(holder(2).moveset[1]?.moveId).toBe(MoveId.PROTECT);
    expect(holder(2).usedTMs).toContain(MoveId.PROTECT);
    expect(tm.quantity).toBe(1);
    text.mock.calls.at(-1)![2]!();
    expect(game.scene.getPlayerBagTms(2)).toEqual([]);
    expect(done).toHaveBeenCalledOnce();
    expect(game.scene.phaseManager.getCurrentPhase()).toBe(standby);
    expect(game.scene.phaseManager.hasPhaseOfType("SelectModifierPhase")).toBe(true);
    phase.end();
    expect(done).toHaveBeenCalledOnce();
    expect(game.scene.phaseManager.getCurrentPhase()).toBe(standby);
  });

  it.each([true, false])("preserves a TM after declining learning (skip confirmation %s)", async skipConfirm => {
    const { tm, phase, standby, done } = beginLearning();
    holder(2).moveset = [MoveId.TACKLE, MoveId.GROWL, MoveId.VINE_WHIP, MoveId.LEECH_SEED].map(
      id => new PokemonMove(id),
    );
    game.scene.hideMoveSkipConfirm = skipConfirm;
    const modes = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    phase.start();
    await vi.waitFor(() =>
      expect(modes).toHaveBeenCalledWith(UiMode.CONFIRM, expect.any(Function), expect.any(Function)),
    );
    (modes.mock.calls.at(-1)![2] as () => void)();
    if (!skipConfirm) {
      await vi.waitFor(() => expect(modes).toHaveBeenCalledTimes(2));
      (modes.mock.calls.at(-1)![1] as () => void)();
    }
    await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
    expect(game.scene.getPlayerBagTms(2)).toEqual([tm]);
    expect(tm.quantity).toBe(1);
    expect(holder(2).usedTMs ?? []).not.toContain(MoveId.PROTECT);
    expect(game.scene.phaseManager.getCurrentPhase()).toBe(standby);
  });

  it.each([1, 4])("uses the usual replacement screen, including cancelling at index %s", async index => {
    const { tm, phase, done, text } = beginLearning();
    const previous = [MoveId.TACKLE, MoveId.GROWL, MoveId.VINE_WHIP, MoveId.LEECH_SEED];
    holder(2).moveset = previous.map(id => new PokemonMove(id));
    game.scene.hideMoveSkipConfirm = true;
    const modes = vi.spyOn(game.scene.ui, "setModeWithoutClear").mockResolvedValue();
    phase.start();
    await vi.waitFor(() => expect(modes).toHaveBeenCalled());
    await phase.forgetMoveProcess(allMoves[MoveId.PROTECT], holder(2));
    const summary = modes.mock.calls.find(call => call[0] === UiMode.SUMMARY)!;
    (summary[4] as (index: number) => void)(index);
    if (index < 4) {
      await vi.waitFor(() => expect(holder(2).moveset[index]?.moveId).toBe(MoveId.PROTECT));
      await vi.waitFor(() => expect(text).toHaveBeenCalled());
      text.mock.calls.at(-1)![2]!();
      expect(game.scene.getPlayerBagTms(2)).toEqual([]);
    } else {
      await vi.waitFor(() => expect(done).toHaveBeenCalledOnce());
      expect(holder(2).moveset.map(move => move!.moveId)).toEqual(previous);
      expect(tm.quantity).toBe(1);
    }
  });

  it("keeps the TM when another modal phase prevents learning", () => {
    const tm = store();
    game.scene.phaseManager["standbyPhase"] = new SelectModifierPhase();
    const done = vi.fn();
    expect(useBagTm(0, holder(), tm, done)).toBe(false);
    expect(tm.quantity).toBe(1);
    expect(done).not.toHaveBeenCalled();
  });

  it("still removes the queued reward copy when teaching an ordinary reward TM", async () => {
    const phase = new LearnMovePhase(0, MoveId.PROTECT, LearnMoveType.TM);
    const remove = vi.spyOn(game.scene.phaseManager, "tryRemovePhase");
    vi.spyOn(game.scene.ui, "setMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "showText").mockImplementation(() => {});
    await phase.learnMove(1, allMoves[MoveId.PROTECT], holder());
    expect(remove).toHaveBeenCalledWith("SelectModifierPhase");
  });

  it("shows compatibility in the TM pocket and leaves the TM untouched on Use-menu cancel", async () => {
    const tm = store();
    store(0, MoveId.THUNDERBOLT);
    const bag = game.scene.ui.handlers[UiMode.BAG] as BagUiHandler;
    bag.show([0, holder()]);
    for (let count = 0; count < 4; count++) {
      bag.processInput(Button.RIGHT);
    }
    expect(bag["getRows"](0).map(row => row.enabled)).toEqual([true, false]);
    expect(bag["getRows"](0)[0].description).not.toContain("Hold C");
    const overlays = vi.spyOn(game.scene.ui, "setOverlayMode").mockResolvedValue();
    vi.spyOn(game.scene.ui, "revertMode").mockResolvedValue(true);
    bag.processInput(Button.ACTION);
    const options = (overlays.mock.calls[0][1] as OptionSelectConfig).options;
    expect(options).toHaveLength(2);
    options[1].handler();
    await Promise.resolve();
    expect(tm.quantity).toBe(1);
    expect(holder().usedTMs ?? []).not.toContain(MoveId.PROTECT);
  });
});
