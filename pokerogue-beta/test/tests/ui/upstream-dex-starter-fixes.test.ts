import { getGameMode } from "#app/game-mode";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import {
  SpeciesFormChangeLapseTeraTrigger,
  SpeciesFormChangeStatusEffectTrigger,
  SpeciesFormChangeTeraTrigger,
} from "#data/pokemon-forms/form-change-triggers";
import { AbilityAttr } from "#enums/ability-attr";
import { Button } from "#enums/buttons";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { StarterAttributes } from "#types/save-data";
import type { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import type { PokedexUiHandler } from "#ui/pokedex-ui-handler";
import type { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { getStarterPreferencesDataString, type StarterPreferences } from "#utils/data";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { readFileSync } from "node:fs";
import i18next from "i18next";
import { JSDOM } from "jsdom";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

it("shows the touch IV button on Dex pages without exposing it in battle", () => {
  const css = readFileSync("index.css", "utf8");
  const dom = new JSDOM(`<style>${css}</style><div id="touchControls"><button id="apadCycleTera"></button></div>`);
  try {
    const controls = dom.window.document.getElementById("touchControls")!;
    const button = dom.window.document.getElementById("apadCycleTera")!;
    for (const mode of ["STARTER_SELECT", "POKEDEX", "POKEDEX_PAGE"]) {
      controls.setAttribute("data-ui-mode", mode);
      expect(dom.window.getComputedStyle(button).display).not.toBe("none");
    }
    controls.setAttribute("data-ui-mode", "COMMAND");
    expect(dom.window.getComputedStyle(button).display).toBe("none");
  } finally {
    dom.window.close();
  }
});

describe("UI - Upstream Dex and starter fixes", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
    game.scene.dexForDevs = false;
  });

  afterEach(() => {
    game.scene.dexForDevs = false;
    game.scene.activePlayerIndex = 0;
    game.scene.configureTwoPlayerMode(false);
  });

  function unlock(speciesId: SpeciesId) {
    for (const id of new Set([speciesId, speciesDataRegistry.getStarter(speciesId)])) {
      const species = getPokemonSpecies(id);
      const entry = game.scene.gameData.dexData[id];
      entry.caughtAttr = species.getFullUnlocksData();
      entry.seenAttr = entry.caughtAttr;
    }
  }

  async function openPage(speciesId: SpeciesId, attributes: StarterAttributes = {}) {
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, getPokemonSpecies(speciesId), attributes);
    return game.scene.ui.getHandler<PokedexPageUiHandler>();
  }

  it.each([
    false,
    true,
  ])("lists only Espurr's matching evolution for female=%s, including after cycling", async female => {
    unlock(SpeciesId.ESPURR);
    const page = await openPage(SpeciesId.ESPURR, { female });
    expect(page["evolutions"].map(evolution => evolution.evoFormKey)).toEqual([female ? "female" : "male"]);
    expect(page.processInput(Button.CYCLE_GENDER)).toBe(true);
    expect(page["evolutions"].map(evolution => evolution.evoFormKey)).toEqual([female ? "male" : "female"]);
  });

  it("uses the actual unlocked gender before filtering evolutions", async () => {
    unlock(SpeciesId.COMBEE);
    game.scene.gameData.dexData[SpeciesId.COMBEE].caughtAttr &= ~DexAttr.FEMALE;
    const page = await openPage(SpeciesId.COMBEE, { female: true });
    expect(page["starterAttributes"].female).toBe(false);
    expect(page["evolutions"]).toHaveLength(0);
  });

  it.each([false, true])("keeps Mega Meowstic's form when female=%s", async female => {
    unlock(SpeciesId.MEOWSTIC);
    const species = getPokemonSpecies(SpeciesId.MEOWSTIC);
    const form = species.forms.findIndex(candidate => candidate.formKey === "mega");
    expect(form).toBeGreaterThan(1);
    const loadAssets = vi.spyOn(species, "loadAssets").mockResolvedValue();
    const page = await openPage(species.speciesId, { female, form });
    expect(page["getCurrentDexProps"](species.speciesId).formIndex).toBe(form);
    expect(loadAssets).toHaveBeenCalledWith(female, form, false, 0, true, false);
    expect(page["canCycleForm"]).toBe(false);
    page.processInput(Button.CYCLE_FORM);
    expect(page["formIndex"]).toBe(form);
  });

  it("allows developer Dex browsing without granting any unlocks", async () => {
    game.scene.dexForDevs = true;
    const species = getPokemonSpecies(SpeciesId.MEOWSTIC);
    const entry = game.scene.gameData.dexData[species.speciesId];
    entry.caughtAttr = 0n;
    entry.seenAttr = 0n;
    const page = await openPage(species.speciesId);
    expect(page["isCaught"]()).toBe(species.getFullUnlocksData());
    expect(page["canCycleForm"]).toBe(true);
    expect(page["getCurrentDexProps"](species.speciesId)).toEqual({
      female: false,
      shiny: false,
      variant: 0,
      formIndex: 0,
    });
    expect(entry.caughtAttr).toBe(0n);
  });

  it("keeps explicit base-form, non-shiny, and male selections", async () => {
    unlock(SpeciesId.MEOWSTIC);
    const attributes = { form: 0, female: false, shiny: false, variant: 0 };
    const page = await openPage(SpeciesId.MEOWSTIC, attributes);
    expect(page["getCurrentDexProps"](SpeciesId.MEOWSTIC)).toEqual({
      formIndex: 0,
      female: false,
      shiny: false,
      variant: 0,
    });
    page.processInput(Button.CYCLE_GENDER);
    expect(attributes).toEqual({ form: 0, female: false, shiny: false, variant: 0 });
  });

  it("uses the evolved species' caught form without intersecting unrelated starter form bits", async () => {
    unlock(SpeciesId.WORMADAM);
    const entry = game.scene.gameData.dexData[SpeciesId.WORMADAM];
    entry.caughtAttr =
      DexAttr.NON_SHINY | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | game.scene.gameData.getFormAttr(2);
    game.scene.gameData.dexData[SpeciesId.BURMY].caughtAttr =
      DexAttr.NON_SHINY | DexAttr.FEMALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
    const page = await openPage(SpeciesId.WORMADAM);
    expect(page["formIndex"]).toBe(2);
    expect(page["getCurrentDexProps"](SpeciesId.WORMADAM).formIndex).toBe(2);
    expect(page["passives"]).toEqual(speciesDataRegistry.getPassiveOptions(SpeciesId.WORMADAM, 2));
  });

  it("uses the Dex's selected player data for defaults", async () => {
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    const species = getPokemonSpecies(SpeciesId.BULBASAUR);
    const p1 = game.scene.getPlayerGameData(0);
    const p2 = game.scene.getPlayerGameData(1);
    p1.dexData[species.speciesId].caughtAttr =
      DexAttr.NON_SHINY | DexAttr.MALE | DexAttr.DEFAULT_VARIANT | DexAttr.DEFAULT_FORM;
    p2.dexData[species.speciesId].caughtAttr =
      DexAttr.SHINY | DexAttr.FEMALE | DexAttr.VARIANT_3 | DexAttr.DEFAULT_FORM;
    game.scene.savePlayerStarterPreferences({}, 1);
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX, p2);
    const dex = game.scene.ui.getHandler<PokedexUiHandler>();
    dex["starterPreferences"][species.speciesId] = {};
    expect(dex.getCurrentDexProps(species.speciesId)).toEqual({
      female: true,
      shiny: true,
      variant: 2,
      formIndex: 0,
    });
    expect(p1.dexData[species.speciesId].caughtAttr & DexAttr.SHINY).toBe(0n);
  });

  it("wraps down instead of selecting an empty cell after scrolling", async () => {
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX);
    const dex = game.scene.ui.getHandler<PokedexUiHandler>();
    dex["filteredPokemonData"] = dex["filteredPokemonData"].slice(0, 92);
    dex["scrollCursor"] = 1;
    dex["cursor"] = 80;
    vi.spyOn(dex, "updateScroll").mockImplementation(() => {});
    const setCursor = vi.spyOn(dex, "setCursor").mockReturnValue(true);
    expect(dex.processInput(Button.DOWN)).toBe(true);
    expect(dex["scrollCursor"]).toBe(0);
    expect(setCursor).toHaveBeenCalledWith(8);
  });

  it("keeps the IV toggle functional on the Dex page", async () => {
    unlock(SpeciesId.BULBASAUR);
    const page = await openPage(SpeciesId.BULBASAUR);
    // The headless chart stub cannot redraw its polygon when the IV panel closes.
    vi.spyOn(page["statsContainer"], "updateIvs").mockImplementation(() => {});
    expect(page.processInput(Button.CYCLE_TERA)).toBe(true);
    expect(page["statsMode"]).toBe(true);
    expect(page.processInput(Button.CYCLE_TERA)).toBe(true);
    expect(page["statsMode"]).toBe(false);
  });

  it.each([
    [SpeciesId.SNORUNT, false, true],
    [SpeciesId.RALTS, true, false],
  ] as const)("selects the allowed gen-IV gender for %s without rewriting the saved choice", (id, original, expected) => {
    unlock(id);
    game.scene.gameMode = getGameMode(GameModes.CHALLENGE);
    game.scene.gameMode.setChallengeValue(Challenges.SINGLE_GENERATION, 4);
    const handler = game.scene.ui.handlers[UiMode.STARTER_SELECT] as StarterSelectUiHandler;
    const saved: StarterPreferences = { [id]: { female: original } };
    const restricted: StarterPreferences = { [id]: { female: original } };
    expect(handler.initStarterPrefs(getPokemonSpecies(id), restricted).female).toBe(expected);
    expect(handler.initStarterPrefs(getPokemonSpecies(id), saved, true).female).toBe(original);
    expect(game.scene.gameData.dexData[id].caughtAttr & DexAttr.MALE).not.toBe(0n);
    expect(game.scene.gameData.dexData[id].caughtAttr & DexAttr.FEMALE).not.toBe(0n);
  });

  it.each([
    [0, "party"],
    [0, "start"],
    [1, "party"],
    [1, "start"],
    [2, "party"],
    [2, "start"],
  ] as const)("preserves player %i's choices while clearing the %s cursor", async (player, cursor) => {
    game.scene.configureTwoPlayerMode(true, 6, true, 3);
    game.scene.activePlayerIndex = player;
    unlock(SpeciesId.BULBASAUR);
    game.scene.gameData.starterData[SpeciesId.BULBASAUR].abilityAttr =
      AbilityAttr.ABILITY_1 | AbilityAttr.ABILITY_HIDDEN;
    const preferences: StarterPreferences = { [SpeciesId.BULBASAUR]: { ability: 2, passiveIndex: 1, female: true } };
    game.scene.savePlayerStarterPreferences(preferences, player);
    const untouchedPlayer = player === 0 ? 1 : 0;
    game.scene.savePlayerStarterPreferences({ [SpeciesId.CHARMANDER]: { ability: 0, female: false } }, untouchedPlayer);
    const untouchedPreferences = structuredClone(game.scene.getPlayerStarterPreferences(untouchedPlayer));
    await game.scene.ui.setOverlayMode(UiMode.STARTER_SELECT, () => {});
    const handler = game.scene.ui.getHandler<StarterSelectUiHandler>();
    handler["starterSpecies"] = [getPokemonSpecies(SpeciesId.BULBASAUR)];
    handler["starterIconsCursorObj"].setVisible(cursor === "party");
    handler["startCursorObj"].setVisible(cursor === "start");
    handler["starterIconsCursorIndex"] = 0;
    const moveCursor = vi.spyOn(handler, "moveStarterIconsCursor");
    const setSpecies = vi.spyOn(handler, "setSpecies");
    const saved = getStarterPreferencesDataString(handler["originalStarterPreferences"]);
    handler.clear();
    expect(moveCursor).not.toHaveBeenCalled();
    expect(setSpecies).not.toHaveBeenCalled();
    expect(game.scene.getPlayerStarterPreferences(player)).toEqual(JSON.parse(saved));
    expect(game.scene.getPlayerStarterPreferences(player)[SpeciesId.BULBASAUR]?.ability).toBe(2);
    expect(game.scene.getPlayerStarterPreferences(untouchedPlayer)).toEqual(untouchedPreferences);
  });

  it.each([1, 2] as const)("displays variant %i when it is the only caught shiny", async variant => {
    const entry = game.scene.gameData.dexData[SpeciesId.BULBASAUR];
    entry.caughtAttr =
      DexAttr.SHINY | DexAttr.FEMALE | DexAttr.DEFAULT_FORM | (variant === 1 ? DexAttr.VARIANT_2 : DexAttr.VARIANT_3);
    entry.seenAttr = entry.caughtAttr;
    const page = await openPage(SpeciesId.BULBASAUR);
    expect(page["getCurrentDexProps"](SpeciesId.BULBASAUR)).toEqual({
      shiny: true,
      female: true,
      variant,
      formIndex: 0,
    });
  });

  it("provides readable status and Terastallization form-change descriptions", () => {
    expect(new SpeciesFormChangeStatusEffectTrigger(StatusEffect.FREEZE).description).toBe(
      i18next.t("pokemonEvolutions:forms.statusEffect"),
    );
    expect(new SpeciesFormChangeTeraTrigger().description).toBe(i18next.t("pokemonEvolutions:forms.tera"));
    expect(new SpeciesFormChangeLapseTeraTrigger().description).toBe(i18next.t("pokemonEvolutions:forms.teraLapse"));
  });
});
