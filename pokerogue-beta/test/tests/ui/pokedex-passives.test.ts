import { speciesDataRegistry } from "#app/global-species-data-registry";
import { allAbilities } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { getPassiveUnlockAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import type { BaseOptionSelectUiHandler, OptionSelectItem } from "#ui/base-option-select-ui-handler";
import type { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("UI - Pokedex passive list", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let page: PokedexPageUiHandler;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.runToTitle();
  });

  async function openAbilities(speciesId = SpeciesId.CHARMANDER, form = 0, passiveAttr = 0) {
    const starterId = speciesDataRegistry.getStarter(speciesId);
    game.scene.gameData.starterData[starterId].passiveAttr = passiveAttr;
    game.scene.gameData.dexData[speciesId].seenAttr |= 1n;
    await game.scene.ui.setOverlayMode(UiMode.POKEDEX_PAGE, getPokemonSpecies(speciesId), { form });
    page = game.scene.ui.getHandler<PokedexPageUiHandler>();
    // The headless graphics mock cannot redraw masks; verify the description calls instead.
    vi.spyOn(page["infoOverlay"], "show").mockImplementation(() => {});
    vi.spyOn(game.scene.ui, "showText").mockImplementation((_text, _delay, callback) => callback?.());
    page.setCursor(1);
    expect(page.processInput(Button.ACTION)).toBe(true);
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.OPTION_SELECT));
    return game.scene.ui.getHandler<BaseOptionSelectUiHandler>()["config"]!.options;
  }

  function getPassiveRows(options: OptionSelectItem[]) {
    const heading = options.findIndex(option => option.label === i18next.t("pokedexUiHandler:passive"));
    return heading < 0 ? [] : options.slice(heading + 1, -1);
  }

  it("lists the primary and secondary together, with separate descriptions", async () => {
    const passives = speciesDataRegistry.getPassiveOptions(SpeciesId.CHARMANDER, 0);
    expect(passives).toHaveLength(2);
    const options = await openAbilities();
    expect(options.map(option => option.label)).toEqual([
      allAbilities[AbilityId.BLAZE].name,
      i18next.t("pokedexUiHandler:hidden"),
      allAbilities[AbilityId.SOLAR_POWER].name,
      i18next.t("pokedexUiHandler:passive"),
      ...passives.map(passive => allAbilities[passive].name),
      i18next.t("menu:cancel"),
    ]);
    const showDescription = vi.spyOn(page["infoOverlay"], "show");
    getPassiveRows(options).forEach((row, index) => {
      row.onHover?.();
      expect(showDescription).toHaveBeenLastCalledWith(allAbilities[passives[index]].description);
      expect(row.handler()).toBe(false);
    });
    expect(options.at(-1)!.handler()).toBe(true);
    await vi.waitFor(() => expect(game.scene.ui.getMode()).toBe(UiMode.POKEDEX_PAGE));
  });

  it.each([
    [0, false, false],
    [getPassiveUnlockAttr(0), true, false],
    [getPassiveUnlockAttr(1), false, true],
    [getPassiveUnlockAttr(0) | getPassiveUnlockAttr(1), true, true],
  ] as const)("styles each slot independently for unlock flags %i", async (flags, primary, secondary) => {
    const options = await openAbilities(SpeciesId.CHARMANDER, 0, flags);
    expect(getPassiveRows(options).map(row => row.style)).toEqual(
      [primary, secondary].map(unlocked => (unlocked ? TextStyle.SETTINGS_VALUE : TextStyle.SHADOW_TEXT)),
    );
  });

  it("shows only one row when a species has only one passive", async () => {
    vi.spyOn(speciesDataRegistry, "getPassiveOptions").mockReturnValue([AbilityId.SHEER_FORCE]);
    const rows = getPassiveRows(await openAbilities());
    expect(rows.map(row => row.label)).toEqual([allAbilities[AbilityId.SHEER_FORCE].name]);
  });

  it("omits the passive heading when there are no passive abilities", async () => {
    vi.spyOn(speciesDataRegistry, "getPassiveOptions").mockReturnValue([AbilityId.NONE]);
    const options = await openAbilities();
    expect(options.some(option => option.label === i18next.t("pokedexUiHandler:passive"))).toBe(false);
  });

  it("does not renumber unlock flags when an empty slot is omitted", async () => {
    vi.spyOn(speciesDataRegistry, "getPassiveOptions").mockReturnValue([AbilityId.NONE, AbilityId.SHEER_FORCE]);
    const rows = getPassiveRows(await openAbilities(SpeciesId.CHARMANDER, 0, getPassiveUnlockAttr(1)));
    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe(allAbilities[AbilityId.SHEER_FORCE].name);
    expect(rows[0].style).toBe(TextStyle.SETTINGS_VALUE);
  });

  it("uses the selected form's passives and its starter's unlock flags", async () => {
    const species = getPokemonSpecies(SpeciesId.AMPHAROS);
    const form = species.forms.findIndex(candidate => candidate.formKey === "mega");
    expect(form).toBeGreaterThan(0);
    const passives = speciesDataRegistry.getPassiveOptions(species.speciesId, form);
    expect(passives[1]).toBe(AbilityId.ELECTROMORPHOSIS);
    const rows = getPassiveRows(await openAbilities(species.speciesId, form, getPassiveUnlockAttr(1)));
    expect(rows.map(row => row.label)).toEqual(passives.map(passive => allAbilities[passive].name));
    expect(rows.map(row => row.style)).toEqual([TextStyle.SHADOW_TEXT, TextStyle.SETTINGS_VALUE]);
  });
});
