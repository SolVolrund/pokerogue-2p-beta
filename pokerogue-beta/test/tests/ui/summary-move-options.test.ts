import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { PrivateFightPhase } from "#phases/private-fight-phase";
import { PrivateRegistrationPhase } from "#phases/private-registration-phase";
import { UiInputs } from "#app/ui-inputs";
import { PartyOption, PartyUiMode, type PartyUiHandler } from "#ui/party-ui-handler";
import { GameManager } from "#test/framework/game-manager";
import type { BaseOptionSelectUiHandler } from "#ui/base-option-select-ui-handler";
import { type SummaryUiHandler, SummaryUiMode } from "#ui/summary-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Summary move options", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let summary: SummaryUiHandler;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .moveset([MoveId.TACKLE, MoveId.GROWL, MoveId.PROTECT, MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    game.override.moveset([]);
    summary = game.scene.ui.handlers[UiMode.SUMMARY] as SummaryUiHandler;
    // Enter through a non-transitioning menu; headless tests do not advance UI fades.
    await game.scene.ui.setMode(UiMode.OPTION_SELECT, { options: [{ label: "Cancel", handler: () => true }] });
  });

  afterEach(() => {
    summary.clear();
    game.scene.ui.resetModeChain();
    game.scene.activePlayerIndex = 0;
    game.scene.inputOwner = "none";
  });

  async function openSummary(pokemon: Pokemon = game.field.getPlayerPokemon(), reward = true) {
    if (reward) {
      vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(new SelectModifierPhase());
    }
    await game.scene.ui.setMode(UiMode.SUMMARY, pokemon, SummaryUiMode.DEFAULT, 2);
    summary.showMoveSelect();
  }

  function openOptions() {
    summary.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT);
    return game.scene.ui.getHandler<BaseOptionSelectUiHandler>();
  }

  it.each(["battle", "ep", "vote", "entrant"])("inspects a private %s party without committing a choice", async context => {
    const scene = game.scene;
    const ui = scene.ui;
    scene.twoPlayerLocalInputSeat = context === "ep" ? "ep" : 0;
    const phase = context === "battle" || context === "ep" ? new PrivateFightPhase(new Map()) : new PrivateRegistrationPhase({
      name: "test", legal: () => [0], queueSequential: vi.fn(), queueCommit: vi.fn(),
    });
    vi.spyOn(scene.phaseManager, "getCurrentPhase").mockReturnValue(phase);
    // Exercise actual Party/Summary transitions without waiting for Phaser's clock.
    vi.spyOn(ui, "fadeOut").mockResolvedValue();
    vi.spyOn(ui, "fadeIn").mockResolvedValue();
    const timer = scene.time.delayedCall.bind(scene.time);
    vi.spyOn(scene.time, "delayedCall").mockImplementation((delay, cb, args, scope) => {
      if (delay !== 100) return timer(delay, cb, args, scope);
      cb.apply(scope, args ?? []);
      return {} as Phaser.Time.TimerEvent;
    });
    const pick = vi.fn();
    const party = ui.handlers[UiMode.PARTY] as PartyUiHandler;
    await ui.setMode(UiMode.PARTY, context === "ep" ? PartyUiMode.ENEMY_SWITCH : context === "battle" ? PartyUiMode.SWITCH
      : context === "vote" ? PartyUiMode.CHECK : PartyUiMode.SELECT, 0, pick);
    const pokemon = context === "ep" ? game.field.getEnemyPokemon() : game.field.getPlayerPokemon();
    const original = [...pokemon.moveset];
    const inputs: UiInputs = Object.create(UiInputs.prototype);
    const press = (button: Button) => inputs["processLocalButtonInput"](button, true);
    press(Button.ACTION);
    expect(party["options"]).toContain(PartyOption.SUMMARY);
    expect(party["options"]).not.toContain(PartyOption.RENAME);
    party.setCursor(party["options"].indexOf(PartyOption.SUMMARY));
    press(Button.ACTION);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.SUMMARY));
    expect(summary["summaryUiMode"]).toBe(SummaryUiMode.READ_ONLY);
    expect(summary["pokemon"]).toBe(pokemon);
    const nextPage = () => {
      expect(press(Button.RIGHT)).toBe(true);
      scene.tweens.getTweensOf(summary["summaryPageTransitionContainer"]).forEach(tween => tween.complete());
    };
    nextPage();
    expect(press(Button.STATS)).toBe(true);
    expect(press(Button.STATS)).toBe(true);
    expect(summary["contestStatsContainer"].visible).toBe(true);
    nextPage();
    expect(press(Button.STATS)).toBe(true);
    expect(summary["contestMoveInfoVisible"]).toBe(true);
    expect(press(Button.ACTION)).toBe(true);
    expect(ui.getMode()).toBe(UiMode.SUMMARY);
    expect(pokemon.moveset).toEqual(original);
    press(Button.CANCEL);
    press(Button.CANCEL);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.PARTY));
    expect(party.getCursor()).toBe(0);
    expect(pick).not.toHaveBeenCalled();
    // A shared pause can arrive during the fade into inspection.
    party["processSummaryOption"](pokemon);
    await ui.dismissPrivateDraft();
    expect(ui.getMode()).toBe(UiMode.MESSAGE);
    expect(summary.active || party.active).toBe(false);
    expect(pick).not.toHaveBeenCalled();
  });

  function chooseForget() {
    const options = openOptions();
    expect(options["config"]?.options.map(option => option.label)).toEqual(["Swap Move", "Forget Move", "Cancel"]);
    options.setCursor(1);
    options.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.CONFIRM);
    return game.scene.ui.getHandler<BaseOptionSelectUiHandler>();
  }

  it.each([0, 1, 3])("forgets move %i after confirmation and rebuilds the visible rows", async index => {
    const pokemon = game.field.getPlayerPokemon();
    const expected = pokemon.moveset.filter((_move, i) => i !== index);
    await openSummary();
    summary.setCursor(index);
    const confirm = chooseForget();
    expect(pokemon.moveset).toHaveLength(4);
    expect(summary["canDeleteMove"](pokemon)).toBe(true);
    expect(confirm.getCursor()).toBe(0);
    const confirmed = vi.spyOn(confirm["config"]!.options[0], "handler");
    confirm["unblockInput"]();
    confirm.processInput(Button.ACTION);
    expect(confirmed).toHaveBeenCalledOnce();
    expect(game.scene.ui.getMode()).toBe(UiMode.SUMMARY);
    expect(pokemon.moveset).toEqual(expected);
    expect(summary["moveCursor"]).toBe(Math.min(index, 2));
    const rows = summary["moveRowsContainer"].list as Phaser.GameObjects.Container[];
    expect(rows).toHaveLength(4);
    for (let i = 0; i < 3; i++) {
      expect((rows[i].list[1] as Phaser.GameObjects.Text).text).toBe(expected[i].getName());
      expect(rows[i].getData("moveTypeIcon")).toBeDefined();
    }
    expect((rows[3].list[0] as Phaser.GameObjects.Text).text).toBe("-");
  });

  it("leaves the moveset unchanged when cancelling the confirmation", async () => {
    const pokemon = game.field.getPlayerPokemon();
    const expected = [...pokemon.moveset];
    await openSummary();
    chooseForget().processInput(Button.CANCEL);
    expect(game.scene.ui.getMode()).toBe(UiMode.SUMMARY);
    expect(pokemon.moveset).toEqual(expected);
  });

  it("preserves swapping moves through the new options menu", async () => {
    const pokemon = game.field.getPlayerPokemon();
    const [first, second] = pokemon.moveset;
    await openSummary();
    openOptions().processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.SUMMARY);
    summary.setCursor(1);
    summary.processInput(Button.ACTION);
    expect(pokemon.moveset.slice(0, 2)).toEqual([second, first]);
  });

  it("does not offer forgetting during battle", async () => {
    await openSummary(game.field.getPlayerPokemon(), false);
    expect(openOptions()["config"]?.options.map(option => option.label)).toEqual(["Swap Move", "Cancel"]);
  });

  it.each([
    "other reward owner",
    "other input owner",
    "enemy input",
  ])("does not offer forgetting for %s", async context => {
    await openSummary();
    if (context === "other reward owner") {
      game.scene.activePlayerIndex = 1;
    } else {
      game.scene.inputOwner = context === "enemy input" ? "ep" : 1;
    }
    expect(openOptions()["config"]?.options.map(option => option.label)).toEqual(["Swap Move", "Cancel"]);
  });

  it("keeps enemy inspection read-only", async () => {
    await openSummary(game.field.getEnemyPokemon());
    summary.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.SUMMARY);
  });

  it("cannot remove the final move", async () => {
    game.field.getPlayerPokemon().moveset.splice(1);
    await openSummary();
    summary.processInput(Button.ACTION);
    expect(game.scene.ui.getMode()).toBe(UiMode.SUMMARY);
    expect(game.field.getPlayerPokemon().moveset).toHaveLength(1);
  });

  it("rechecks permission after opening the confirmation", async () => {
    await openSummary();
    const confirm = chooseForget();
    game.scene.inputOwner = "ep";
    confirm["unblockInput"]();
    confirm.processInput(Button.ACTION);
    expect(game.field.getPlayerPokemon().moveset).toHaveLength(4);
  });

  it("retains the learn-move callback instead of opening the options menu", async () => {
    const callback = vi.fn();
    await game.scene.ui.setMode(
      UiMode.SUMMARY,
      game.field.getPlayerPokemon(),
      SummaryUiMode.LEARN_MOVE,
      allMoves[MoveId.QUICK_ATTACK],
      callback,
    );
    summary.setCursor(1);
    summary.processInput(Button.ACTION);
    expect(callback).toHaveBeenCalledWith(1);
    expect(game.scene.ui.getMode()).toBe(UiMode.SUMMARY);
  });
});
