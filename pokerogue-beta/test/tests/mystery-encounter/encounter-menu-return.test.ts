import { Battle } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Pokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { DancingLessonsEncounter } from "#mystery-encounters/dancing-lessons-encounter";
import * as Dialogue from "#mystery-encounters/encounter-dialogue-utils";
import { selectOptionThenPokemon, selectPokemonForOption } from "#mystery-encounters/encounter-phase-utils";
import { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { TrainingSessionEncounter } from "#mystery-encounters/training-session-encounter";
import { GameManager } from "#test/framework/game-manager";
import type { OptionSelectConfig } from "#ui/abstract-option-select-ui-handler";
import type { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { PartyOption } from "#ui/party-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Mystery encounter submenu return", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    vi.spyOn(Pokemon.prototype, "playAnim").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "refreshAccessoryOutfitSprites").mockImplementation(() => {});
    vi.spyOn(Pokemon.prototype, "loadAssets").mockResolvedValue();
    await game.runToTitle();
    vi.spyOn(Dialogue, "showEncounterText").mockResolvedValue();
    vi.spyOn(Dialogue, "showEncounterDialogue").mockResolvedValue();
  });

  afterEach(() => {
    game.scene.configureTwoPlayerMode(false);
  });

  async function setup(template = TrainingSessionEncounter, count: 1 | 3 = 3) {
    const scene = game.scene;
    scene.configureTwoPlayerMode(count > 1, 6, false, count);
    scene.currentBattle = new Battle(scene.gameMode, {
      waveIndex: 105,
      battleType: BattleType.MYSTERY_ENCOUNTER,
      double: count > 1,
    });
    scene.currentBattle.incrementTurn();
    for (const playerIndex of scene.getActivePlayerIndexes()) {
      const party = scene.getPlayerParty(playerIndex);
      party.splice(0);
      const pokemon = scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 50);
      pokemon.moveset = [new PokemonMove(MoveId.SWORDS_DANCE)];
      party.push(pokemon);
    }
    const encounter = new MysteryEncounter(template);
    scene.currentBattle.mysteryEncounter = encounter;
    encounter.onInit?.();
    await scene.ui.setMode(UiMode.MESSAGE);
    await scene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, { slideInDescription: false });
    return encounter;
  }

  function menu() {
    return game.scene.ui.handlers[UiMode.MYSTERY_ENCOUNTER] as MysteryEncounterUiHandler;
  }

  function currentOptions() {
    return menu().getReturnSettings().overrideOptions ?? game.scene.currentBattle.mysteryEncounter!.options;
  }

  function choose(option: MysteryEncounterOption, cursor: number) {
    menu().setCursor(cursor);
    game.scene.currentBattle.mysteryEncounter!.selectedOption = option;
    return option.onPreOptionPhase!();
  }

  function watchSubmenus() {
    const setMode = vi.spyOn(game.scene.ui, "setMode");
    const setModeWithoutClear = vi.spyOn(game.scene.ui, "setModeWithoutClear");
    return {
      async pickPokemon(index: number) {
        await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.PARTY));
        if (index >= game.scene.getPlayerParty().length) {
          expect(game.scene.ui.getHandler().processInput(Button.CANCEL)).toBe(true);
          return;
        }
        const call = setMode.mock.calls.filter(call => call[0] === UiMode.PARTY).at(-1)!;
        const callback = call[3] as (slot: number, option: PartyOption) => Promise<void> | void;
        await callback(index, PartyOption.CANCEL);
      },
      async optionConfig() {
        await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT));
        const call = [...setMode.mock.calls, ...setModeWithoutClear.mock.calls]
          .filter(call => call[0] === UiMode.OPTION_SELECT)
          .at(-1)!;
        return call[1] as OptionSelectConfig;
      },
    };
  }

  const scenarios = [
    { name: "light training", template: TrainingSessionEncounter, optionIndex: 0, advanceIndex: 3, secondary: false },
    { name: "nature training", template: TrainingSessionEncounter, optionIndex: 1, advanceIndex: 3, secondary: true },
    { name: "ability training", template: TrainingSessionEncounter, optionIndex: 2, advanceIndex: 3, secondary: true },
    { name: "learn a dance", template: DancingLessonsEncounter, optionIndex: 1, advanceIndex: 0, secondary: false },
    { name: "show a dance", template: DancingLessonsEncounter, optionIndex: 2, advanceIndex: 0, secondary: true },
  ].flatMap(scenario => ([1, 2] as const).map(playerIndex => ({ ...scenario, playerIndex })));

  it.each(scenarios)("keeps player index $playerIndex's $name menu and earlier choices", async scenario => {
    const { template, optionIndex, advanceIndex, secondary, playerIndex } = scenario;
    const encounter = await setup(template);
    const submenus = watchSubmenus();
    for (let previous = 0; previous < playerIndex; previous++) {
      expect(await choose(currentOptions()[advanceIndex], advanceIndex)).toBe(false);
      await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.MYSTERY_ENCOUNTER));
    }
    const choices = () =>
      (encounter.misc.trainingChoices ?? encounter.misc.choices) as {
        playerIndex: PlayerIndex;
        optionIndex: number;
      }[];
    const priorChoices = [...choices()];
    const options = currentOptions();
    const title = menu().getReturnSettings().overrideTitle;

    for (let attempt = 0; attempt < 2; attempt++) {
      const pending = choose(currentOptions()[optionIndex], optionIndex);
      await submenus.pickPokemon(game.scene.getPlayerParty(playerIndex).length);
      expect(await pending).toBe(false);
      expect(currentOptions()).toBe(options);
      expect(menu().getReturnSettings().overrideTitle).toBe(title);
      expect(menu().getCursor()).toBe(optionIndex);
      expect(game.scene.activePlayerIndex).toBe(playerIndex);
      expect(game.scene.inputOwner).toBe(playerIndex);
      expect(choices()).toEqual(priorChoices);
    }

    if (secondary) {
      const pending = choose(currentOptions()[optionIndex], optionIndex);
      await submenus.pickPokemon(0);
      await submenus.optionConfig();
      expect(game.scene.ui.getHandler().processInput(Button.CANCEL)).toBe(true);
      expect(await pending).toBe(false);
      expect(currentOptions()).toBe(options);
      expect(menu().getCursor()).toBe(optionIndex);
      expect(game.scene.activePlayerIndex).toBe(playerIndex);
      expect(game.scene.inputOwner).toBe(playerIndex);
      expect(choices()).toEqual(priorChoices);
    }

    // Choose a different action after cancelling; do not replay P1 or skip the next player.
    expect(await choose(currentOptions()[advanceIndex], advanceIndex)).toBe(playerIndex === 2);
    expect(choices().slice(0, -1)).toEqual(priorChoices);
    expect(choices().at(-1)).toMatchObject({ playerIndex, optionIndex: advanceIndex + 1 });
    if (playerIndex === 1) {
      await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.MYSTERY_ENCOUNTER));
      expect(game.scene.activePlayerIndex).toBe(2);
    }
  });

  it.each([false, true])("restores the option-first menu context (accept Pokemon: %s)", async accept => {
    await setup();
    const scene = game.scene;
    scene.waitForPlayerInput(1);
    await scene.ui.setMode(UiMode.MESSAGE);
    const options = currentOptions();
    await scene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      overrideTitle: "Player 2",
      overrideOptions: options,
      privateOwnerPlayerIndex: 1,
      privateWaitingQuery: "Waiting for Player 2",
      startingCursorIndex: 2,
    });
    const settings = menu().getReturnSettings();
    const submenus = watchSubmenus();
    const pending = selectOptionThenPokemon([{ label: "Option", handler: () => true }], "");
    (await submenus.optionConfig()).options[0].handler();
    await submenus.pickPokemon(accept ? 0 : scene.getPlayerParty().length);
    if (!accept) {
      await submenus.optionConfig();
      expect(game.scene.ui.getHandler().processInput(Button.CANCEL)).toBe(true);
    }
    expect(await pending).toEqual(accept ? { selectedPokemonIndex: 0, selectedOptionIndex: 0 } : null);
    expect(menu().getReturnSettings()).toEqual(settings);
    expect(scene.activePlayerIndex).toBe(1);
    expect(scene.inputOwner).toBe(1);
  });

  it("preserves a solo player's cursor and successful selection", async () => {
    await setup(TrainingSessionEncounter, 1);
    menu().setCursor(2);
    const selected = vi.fn();
    const submenus = watchSubmenus();
    const pending = selectPokemonForOption(selected);
    await submenus.pickPokemon(0);
    expect(await pending).toBe(true);
    expect(selected).toHaveBeenCalledWith(game.scene.getPlayerParty()[0]);
    expect(menu().getCursor()).toBe(2);
    expect(game.scene.activePlayerIndex).toBe(0);
  });

  it("restores the menu owner when selecting from another player's party", async () => {
    await setup();
    game.scene.waitForPlayerInput(2);
    const submenus = watchSubmenus();
    const pending = selectPokemonForOption(vi.fn(), undefined, undefined, 1);
    expect(game.scene.activePlayerIndex).toBe(1);
    await submenus.pickPokemon(game.scene.getPlayerParty(1).length);
    expect(await pending).toBe(false);
    expect(game.scene.activePlayerIndex).toBe(2);
    expect(game.scene.inputOwner).toBe(2);
  });

  it("returns progression control to EP in a CPU-only run", async () => {
    await setup(TrainingSessionEncounter, 1);
    game.scene.configureTwoPlayerMode(true, 6, true, 1, [0], false, true);
    game.scene.waitForPlayerSideProgressionInput(0);
    const submenus = watchSubmenus();
    const pending = selectPokemonForOption(vi.fn());
    await submenus.pickPokemon(game.scene.getPlayerParty().length);
    expect(await pending).toBe(false);
    expect(game.scene.activePlayerIndex).toBe(0);
    expect(game.scene.inputOwner).toBe("ep");
  });

  it("leaves non-encounter return modes unchanged", async () => {
    await setup();
    await game.scene.ui.setMode(UiMode.MESSAGE);
    const selected = vi.fn();
    const cancelled = vi.fn();
    const submenus = watchSubmenus();
    const pending = selectPokemonForOption(selected, cancelled, undefined, 1);
    await submenus.pickPokemon(game.scene.getPlayerParty(1).length);
    expect(await pending).toBe(false);
    expect(game.scene.ui.getMode()).toBe(UiMode.MESSAGE);
    expect(selected).not.toHaveBeenCalled();
    expect(cancelled).toHaveBeenCalledOnce();
  });
});
