import { EVOLVE_MOVE, RELEARN_MOVE } from "#app/constants";
import { getTmNumber, tmPoolTiers } from "#balance/tm-pool-tiers";
import { allMoves } from "#data/data-lists";
import { Button } from "#enums/buttons";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { BaseOptionSelectUiHandler } from "#ui/base-option-select-ui-handler";
import type { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Pokedex move details", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let page: PokedexPageUiHandler;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, getPokemonSpecies(SpeciesId.BULBASAUR), {});
    page = game.scene.ui.getHandler<PokedexPageUiHandler>();
    // Complete the menu's introductory text without advancing battle phases.
    vi.spyOn(game.scene.ui, "showText").mockImplementation((_text, _delay, callback) => callback?.());
  });

  async function openMoves(cursor: number) {
    page.setCursor(cursor);
    expect(page.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT));
    return game.scene.ui.getHandler<BaseOptionSelectUiHandler>()["config"]!.options;
  }

  it("marks evolution and recall moves without marking ordinary level moves", async () => {
    page["levelMoves"] = [
      [EVOLVE_MOVE, MoveId.PETAL_DANCE],
      [RELEARN_MOVE, MoveId.GROWL],
      [7, MoveId.VINE_WHIP],
    ];
    const options = await openMoves(2);
    expect(options.map(option => option.item)).toEqual(["big_mushroom", "big_mushroom", undefined, undefined]);
    const showText = vi.spyOn(page, "showText").mockImplementation(() => {});
    options[0].onHover?.();
    expect(showText).toHaveBeenLastCalledWith(i18next.t("pokedexUiHandler:onlyEvolutionMove"), 0);
    options[1].onHover?.();
    expect(showText).toHaveBeenLastCalledWith(i18next.t("pokedexUiHandler:onlyRecallMove"), 0);
    options[2].onHover?.();
    expect(showText).toHaveBeenLastCalledWith(i18next.t("pokedexUiHandler:byLevelUpMove"), 0);
  });

  it("shows a typed TM icon, number and reward tier", async () => {
    const move = MoveId.PROTECT;
    page["tmMoves"] = [move];
    const options = await openMoves(4);
    expect(options[0].item).toBe(`tm_${PokemonType[allMoves[move].type].toLowerCase()}`);
    const showText = vi.spyOn(page, "showText").mockImplementation(() => {});
    options[0].onHover?.();
    expect(showText).toHaveBeenCalledWith(
      i18next.t("pokedexUiHandler:tmMove", {
        number: getTmNumber(move),
        tier: i18next.t(`modifier:tier.${ModifierTier[tmPoolTiers[move]!].toLowerCase()}`),
      }),
      0,
    );
  });

  it("does not invent a TM number for a move outside the reward pool", async () => {
    expect(getTmNumber(MoveId.NONE)).toBeNull();
    page["tmMoves"] = [MoveId.SPLASH];
    const options = await openMoves(4);
    const showText = vi.spyOn(page, "showText").mockImplementation(() => {});
    options[0].onHover?.();
    expect(showText).toHaveBeenCalledWith(i18next.t("pokedexUiHandler:showTmMoves"), 0);
  });

  it("retains the existing item numbering for every TM", () => {
    Object.keys(tmPoolTiers).forEach((move, index) => {
      expect(getTmNumber(Number(move))).toBe(String(index + 1).padStart(3, "0"));
    });
  });
});
