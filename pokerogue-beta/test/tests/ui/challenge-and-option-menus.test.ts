import { allChallenges, copyChallenge } from "#data/challenge";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { BaseOptionSelectUiHandler, OptionSelectConfig } from "#ui/base-option-select-ui-handler";
import type { GameChallengesUiHandler } from "#ui/handlers/challenges-select-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Upstream menu integration", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let options: BaseOptionSelectUiHandler;
  let challenges: GameChallengesUiHandler;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    options = game.scene.ui.handlers[UiMode.OPTION_SELECT] as BaseOptionSelectUiHandler;
    challenges = game.scene.ui.handlers[UiMode.CHALLENGE_SELECT] as GameChallengesUiHandler;
  });

  afterEach(() => {
    options.clear();
    challenges.clear();
    game.scene.ui.resetModeChain();
    game.scene.activePlayerIndex = 0;
    game.scene.inputOwner = "none";
  });

  function openOptions(extra: Partial<OptionSelectConfig> = {}) {
    const items = Array.from({ length: 12 }, (_, i) => ({ label: `Option ${i}`, handler: vi.fn(() => true) }));
    options.show([{ options: items, maxOptions: 4, ...extra }]);
    return items;
  }

  it("uses four actual rows, without selectable arrow entries", () => {
    const items = openOptions();
    expect(options.getOptionsWithScroll()).toEqual(items.slice(0, 4));
    expect(options["scrollBar"]).toBeDefined();
    for (let i = 0; i < 4; i++) {
      options.processInput(Button.DOWN);
    }
    expect(options.getOptionsWithScroll()).toEqual(items.slice(1, 5));
    expect(options.getTwoPlayerInputContextState()).toEqual({ optionIndex: 4, scrollCursor: 1 });
    options.processInput(Button.ACTION);
    expect(items[4].handler).toHaveBeenCalledOnce();
  });

  it("wraps between the first and last entries, keeping the selection visible", () => {
    const items = openOptions();
    options.processInput(Button.UP);
    expect(options.getOptionsWithScroll()).toEqual(items.slice(8));
    expect(options.getCursor()).toBe(3);
    options.processInput(Button.DOWN);
    expect(options.getOptionsWithScroll()).toEqual(items.slice(0, 4));
    expect(options.getCursor()).toBe(0);
  });

  it("skips disabled and informational rows when scrolling", () => {
    const items = Array.from({ length: 9 }, (_, i) => ({
      label: `${i}`,
      handler: vi.fn(() => true),
      skip: i === 1,
      disabled: i === 2,
    }));
    openOptions({ options: items, maxOptions: 2 });
    options.processInput(Button.DOWN);
    expect(options["scrollCursor"]).toBe(2);
    options.processInput(Button.ACTION);
    expect(items[3].handler).toHaveBeenCalledOnce();
    expect(items[1].handler).not.toHaveBeenCalled();
    expect(items[2].handler).not.toHaveBeenCalled();
  });

  it("honors noCancel on a scrolling menu", () => {
    const items = openOptions({ noCancel: true });
    expect(options.processInput(Button.CANCEL)).toBe(false);
    expect(items.at(-1)!.handler).not.toHaveBeenCalled();
    expect(options["config"]).not.toBeNull();
  });

  it("cancels through the last selectable option even when it is offscreen", () => {
    const items = openOptions();
    options.processInput(Button.CANCEL);
    expect(items.at(-1)!.handler).toHaveBeenCalledOnce();
    expect(options["config"]).toBeNull();
  });

  it("creates item icons only for the visible rows and resets a reopened menu", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({ label: `${i}`, item: "candy", handler: () => true }));
    openOptions({ options: items, initialCursor: 10 });
    expect(options["scrollCursor"]).toBe(7);
    expect(options["optionSelectIcons"]).toHaveLength(8);
    openOptions({ options: items.slice(0, 2) });
    expect(options["scrollCursor"]).toBe(0);
    expect(options["scrollBar"]).toBeUndefined();
    expect(options["optionSelectIcons"]).toHaveLength(4);
  });

  it("retains column navigation and centered cancel for custom partner/EV grids", () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ label: `${i}`, handler: vi.fn(() => true) }));
    openOptions({ options: items, gridLayout: { rows: 3, columns: 2, centerLastOption: true } });
    expect(options["scrollBar"]).toBeUndefined();
    options.processInput(Button.RIGHT);
    expect(options.getCursor()).toBe(3);
    options.processInput(Button.DOWN);
    options.processInput(Button.DOWN);
    options.processInput(Button.DOWN);
    expect(options.getCursor()).toBe(6);
    options.processInput(Button.ACTION);
    expect(items[6].handler).toHaveBeenCalledOnce();
  });

  it("keeps the Spinda pattern cursor on the chosen digit after each preview refresh", async () => {
    const { ui, gameData } = game.scene;
    const starter = ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    vi.spyOn(gameData, "getSpindaPidDigitMasks").mockReturnValue(Array(8).fill(0xffff));
    vi.spyOn(starter, "setSpeciesDetails").mockImplementation(() => {});
    vi.spyOn(ui, "setMode").mockResolvedValue();
    vi.spyOn(ui, "showText").mockImplementation((_text, _delay, callback) => callback?.());
    vi.spyOn(ui, "setModeWithoutClear").mockImplementation(async (_mode, config) => {
      options.show([config]);
    });

    const attributes = { spindaPid: 0 };
    const original = { ...attributes };
    starter["showSpindaPatternOptions"](attributes, original);
    await Promise.resolve();
    expect(options.getCursor()).toBe(8); // First digit, after the eight position labels.
    options.setCursor(127); // F in the last position.
    options.processInput(Button.ACTION);
    await Promise.resolve();
    expect(attributes.spindaPid).toBe(0xf);
    expect(options.getCursor()).toBe(135);

    options.processInput(Button.LEFT);
    options.processInput(Button.ACTION);
    await Promise.resolve();
    expect(original.spindaPid).toBe(0xe);
    expect(options.getCursor()).toBe(127);
  });

  it("reserves a consistent icon column across mixed rows and scroll positions", () => {
    const items = [
      { label: "Level move", handler: () => false },
      { label: "Relearn move", item: "big_mushroom", handler: () => false },
      { label: "Another move", handler: () => false },
      { label: "Cancel", handler: () => true },
    ];
    openOptions({ options: items, maxOptions: 2 });
    expect(options["textContent"]).toContain("]    Level move");
    expect(options["textContent"]).toContain("]    Relearn move");
    expect(options["optionSelectIcons"]).toHaveLength(1);
    options.processInput(Button.UP);
    expect(options["textContent"]).toContain("]    Another move");
    expect(options["textContent"]).toContain("]    Cancel");
    expect(options["optionSelectIcons"]).toHaveLength(0);
  });

  function openChallenges() {
    game.scene.gameMode.challenges = allChallenges.map(copyChallenge);
    const config = { onConfirm: vi.fn(), onCancel: vi.fn() };
    challenges.show([config]);
    return config;
  }

  it("starts with both randomizers and preserves per-player monotypes on the challenge tab", () => {
    openChallenges();
    expect(challenges["getFilteredChallenges"]().map(c => c.id)).toEqual([
      Challenges.MOVESET_RANDOMIZER,
      Challenges.ABILITY_RANDOMIZER,
    ]);
    challenges.processInput(Button.CYCLE_SHINY);
    expect(challenges.getTwoPlayerInputContextState()).toMatchObject({ tab: 1, scrollCursor: 0, startSelected: false });
    expect(challenges["getFilteredChallenges"]().map(c => c.id)).toEqual(
      expect.arrayContaining([Challenges.SINGLE_TYPE_P1, Challenges.SINGLE_TYPE_P2, Challenges.SINGLE_TYPE_P3]),
    );
    challenges.processInput(Button.CYCLE_FORM);
    expect(challenges["tabMenu"].selectedIndex).toBe(0);
  });

  it("cannot start with all challenges off, and confirms through the original callback", () => {
    const config = openChallenges();
    expect(challenges.processInput(Button.ACTION)).toBe(false);
    challenges.processInput(Button.RIGHT);
    challenges.processInput(Button.ACTION);
    expect(challenges["startCursor"].visible).toBe(true);
    expect(challenges["descriptionText"].text).toContain("ribbon");
    expect(config.onConfirm).not.toHaveBeenCalled();
    challenges.processInput(Button.ACTION);
    expect(config.onConfirm).toHaveBeenCalledOnce();
  });

  it("leaves the start preview when switching tabs and resets all categories through a synchronized button", () => {
    openChallenges();
    challenges.processInput(Button.RIGHT);
    challenges.processInput(Button.ACTION);
    challenges.processInput(Button.CYCLE_SHINY);
    expect(challenges["startCursor"].visible).toBe(false);
    expect(challenges.getCursor()).toBe(0);
    challenges.processInput(Button.RIGHT);
    challenges.processInput(Button.CYCLE_ABILITY);
    expect(game.scene.gameMode.challenges.every(c => c.value === 0)).toBe(true);
    expect(challenges["hasSelectedChallenge"]).toBe(false);
  });

  it("backs out of the ribbon preview before cancelling the challenge screen", () => {
    const config = openChallenges();
    challenges.processInput(Button.RIGHT);
    challenges.processInput(Button.ACTION);
    challenges.processInput(Button.CANCEL);
    expect(config.onCancel).not.toHaveBeenCalled();
    challenges.processInput(Button.CANCEL);
    expect(config.onCancel).toHaveBeenCalledOnce();
  });
});
