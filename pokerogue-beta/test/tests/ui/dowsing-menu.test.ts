import { EvolutionItem } from "#balance/pokemon-evolutions";
import { modifierTypes } from "#data/data-lists";
import { Button } from "#enums/buttons";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { DowsingMachineModifier } from "#modifiers/modifier";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import type { BaseOptionSelectUiHandler, OptionSelectConfig } from "#ui/base-option-select-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Dowsing menu", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let machine: DowsingMachineModifier;
  let phase: SelectModifierPhase;
  let options: BaseOptionSelectUiHandler;
  let rewards: ModifierSelectUiHandler;
  let config: OptionSelectConfig;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.getPlayerParty().push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 50));
    machine = new DowsingMachineModifier(modifierTypes.DOWSING_MACHINE());
    game.scene.getPlayerModifiers(0).push(machine);
    phase = new SelectModifierPhase();
    options = game.scene.ui.handlers[UiMode.OPTION_SELECT] as BaseOptionSelectUiHandler;
    rewards = game.scene.ui.handlers[UiMode.MODIFIER_SELECT] as ModifierSelectUiHandler;
    vi.spyOn(phase, "showRewardOptionSelect" as never).mockImplementation(((next: OptionSelectConfig) => {
      config = next;
      options.show([next]);
    }) as never);
  });
  afterEach(() => {
    options.clear();
    game.scene.ui.resetModeChain();
  });

  it("opens all five groups and None, with white, grey and selected yellow entries", () => {
    phase["openDowsingScreen"](() => true);
    expect(config.options.map(option => option.label)).toEqual([
      "Evolution Item",
      "Rare Evolution Item",
      "Mega Stone",
      "Form-Change Item",
      "Z-Crystal",
      "Back",
    ]);
    options.processInput(Button.ACTION);
    expect(config.options[0].label).toBe("None");
    expect(config.options[0].style).toBe(TextStyle.SUMMARY_GOLD);
    const thunderIndex = config.options.findIndex(option => option.item === "thunder_stone");
    expect(config.options[thunderIndex].style).toBe(TextStyle.WINDOW);
    expect(config.options.find(option => option.item === "linking_cord")?.style).toBe(TextStyle.SHADOW_TEXT);
    options.setCursor(thunderIndex);
    options.processInput(Button.ACTION);
    expect(machine.preferences.EVOLUTION_ITEM).toBe(EvolutionItem.THUNDER_STONE);
    expect(config.options[thunderIndex].style).toBe(TextStyle.SUMMARY_GOLD);
    expect(options["config"]).not.toBeNull();
    expect(options.getOptionsWithScroll().length).toBeGreaterThan(0);
    expect(options.getOptionsWithScroll().length).toBeLessThanOrEqual(8);
    expect(options["scrollBar"]).toBeDefined();
  });

  it("rejects unusable selections and clears a preference through None", () => {
    phase["openDowsingScreen"](() => true, "EVOLUTION_ITEM");
    expect(config.options.find(option => option.item === "linking_cord")!.handler()).toBe(false);
    expect(machine.preferences).toEqual({});
    config.options.find(option => option.item === "thunder_stone")!.handler();
    options.setCursor(0);
    options.processInput(Button.ACTION);
    expect(machine.preferences).toEqual({});
  });

  it("returns through the group menu without rerolling existing rewards", () => {
    const restore = vi.spyOn(phase, "resetModifierSelect" as never).mockImplementation(() => {});
    phase["openDowsingScreen"](() => true, "EVOLUTION_ITEM");
    options.processInput(Button.CANCEL);
    expect(config.options).toHaveLength(6);
    expect(options["config"]).not.toBeNull();
    options.processInput(Button.CANCEL);
    expect(restore).toHaveBeenCalledOnce();
  });

  it("refuses to open without the current player's machine", () => {
    game.scene.getPlayerModifiers(0).splice(0);
    expect(phase["openDowsingScreen"](() => true)).toBe(false);
  });

  it("refreshes nested options through the real UI even when the mode is already OPTION_SELECT", async () => {
    vi.mocked(phase["showRewardOptionSelect"]).mockRestore();
    await game.scene.ui.setMode(UiMode.OPTION_SELECT, { options: [{ label: "Temporary", handler: () => true }] });
    phase["openDowsingScreen"](() => true);
    options.processInput(Button.ACTION);
    expect(options["config"]!.options[0].label).toBe("None");
    const index = options["config"]!.options.findIndex(option => option.item === "thunder_stone");
    options.setCursor(index);
    options.processInput(Button.ACTION);
    expect(options["config"]!.options[index].style).toBe(TextStyle.SUMMARY_GOLD);
    options.processInput(Button.CANCEL);
    expect(options["config"]!.options).toHaveLength(6);
  });

  it("navigates the six actions in visual order, skips hidden actions and preserves rarity lock", () => {
    for (const key of [
      "rerollButtonContainer",
      "transferButtonContainer",
      "alphButtonContainer",
      "dowsingButtonContainer",
      "tradeButtonContainer",
      "checkButtonContainer",
    ] as const) {
      rewards[key].setVisible(true);
    }
    rewards["tokenShopButtonContainer"].setVisible(false);
    rewards["lockRarityButtonContainer"].setVisible(false);
    rewards["rowCursor"] = 0;
    rewards["awaitingActionInput"] = true;
    rewards.setRerollCost(500);
    rewards.setCursor(0);
    for (const expected of [1, 5, 6, 2, 3, 0]) {
      rewards.processInput(Button.RIGHT);
      expect(rewards.getCursor()).toBe(expected);
    }
    rewards["alphButtonContainer"].setVisible(false);
    rewards["transferButtonContainer"].setVisible(false);
    rewards.processInput(Button.RIGHT);
    expect(rewards.getCursor()).toBe(6);
    rewards.processInput(Button.LEFT);
    expect(rewards.getCursor()).toBe(0);
    rewards["lockRarityButtonContainer"].setVisible(true);
    rewards.processInput(Button.DOWN);
    expect(rewards.getCursor()).toBe(4);
    rewards.processInput(Button.UP);
    expect(rewards.getCursor()).toBe(0);
  });
});
