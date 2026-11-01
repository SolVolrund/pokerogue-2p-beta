import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { canReceiveFormSelectionItem, getFormSelectionTarget } from "#data/form-selection-items";
import { getFormSelectionChange } from "#data/pokemon-forms";
import { Button } from "#enums/buttons";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { PartyUiMode } from "#enums/party-ui-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonFormChangeItemModifier } from "#modifiers/modifier";
import { FormChangeItemModifierType, getDowsingItemOptions } from "#modifiers/modifier-type";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import type { FormChangePhase } from "#phases/form-change-phase";
import { ModifierData } from "#system/modifier-data";
import { GameManager } from "#test/framework/game-manager";
import type { BaseOptionSelectUiHandler } from "#ui/base-option-select-ui-handler";
import { PartyOption, type PartyUiHandler } from "#ui/party-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Reusable form items", () => {
  const fashion = FormChangeItem.FASHION_CASE;
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let furfrou: PlayerPokemon;
  let type: FormChangeItemModifierType;

  beforeAll(() => { phaserGame = new Phaser.Game({ type: Phaser.HEADLESS }); });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    await game.classicMode.startBattle(SpeciesId.FURFROU);
    furfrou = game.scene.getPlayerParty()[0];
    furfrou.formIndex = 0;
    const generator = modifierTypes.FORM_CHANGE_ITEM();
    generator.withIdFromFunc(modifierTypes.FORM_CHANGE_ITEM);
    type = generator.generateType([furfrou]) as FormChangeItemModifierType;
    expect(type.formChangeItem).toBe(FormChangeItem.FASHION_CASE);
  });
  afterEach(() => { game.scene.configureTwoPlayerMode(false); });

  function equip(pokemon = furfrou) {
    const item = type.newModifier(pokemon) as PokemonFormChangeItemModifier;
    game.scene.addModifier(item, true, false, false, true, undefined, game.scene.getPlayerIndexForPokemon(pokemon));
    return item;
  }

  function addMember(id: SpeciesId, key: string) {
    const species = getPokemonSpecies(id);
    const index = species.forms.findIndex(f => f.formKey === key);
    expect(index).toBeGreaterThanOrEqual(0);
    const pokemon = game.scene.addPlayerPokemon(species, 5, 0, index);
    game.scene.getPlayerParty().push(pokemon);
    return pokemon;
  }

  function makeItem(pokemon: PlayerPokemon, id: FormChangeItem) {
    const generator = modifierTypes.FORM_CHANGE_ITEM();
    generator.withIdFromFunc(modifierTypes.FORM_CHANGE_ITEM);
    const type = generator.generateType([pokemon], [id])!;
    return type.newModifier(pokemon) as PokemonFormChangeItemModifier;
  }

  it.each([
    [SpeciesId.DEOXYS, FormChangeItem.BIG_METEOR, PartyOption.CHANGE_FORM, ["normal", "attack", "defense", "speed"]],
    [SpeciesId.PIKACHU, FormChangeItem.PROP_CASE, PartyOption.CHANGE_COSTUME,
      ["cosplay", "beauty-cosplay", "cute-cosplay", "cool-cosplay", "smart-cosplay", "tough-cosplay"]],
    [SpeciesId.ROTOM, FormChangeItem.ROTOM_CATALOGUE, PartyOption.CHANGE_APPLIANCE, ["", "heat", "wash", "frost", "fan", "mow"]],
    [SpeciesId.ORICORIO, FormChangeItem.NECTAR_CASE, PartyOption.CHANGE_STYLE, ["baile", "pompom", "pau", "sensu"]],
  ] as const)("species %i: rolls the reusable item, shows only its forms and returns to base", async (id, itemId, action, keys) => {
    const pokemon = addMember(id, keys[1]);
    const generator = modifierTypes.FORM_CHANGE_ITEM();
    expect((generator.generateType([pokemon]) as FormChangeItemModifierType).formChangeItem).toBe(itemId);
    const item = makeItem(pokemon, itemId);
    expect(getFormSelectionChange(pokemon, itemId, 0)).toBeUndefined();
    game.scene.addModifier(item, true, false, false, true);
    expect(pokemon.getFormKey()).toBe(keys[1]);
    expect(item.active).toBe(false);
    expect(new ModifierData(item, true).toModifier(PokemonFormChangeItemModifier))
      .toMatchObject({ pokemonId: pokemon.id, formChangeItem: itemId, active: false });
    expect(generator.generateType([pokemon])).toBeNull();
    const ui = game.scene.ui;
    vi.spyOn(game.scene.phaseManager, "getCurrentPhase").mockReturnValue(new SelectModifierPhase(0));
    await ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, -1);
    const party = ui.handlers[UiMode.PARTY] as PartyUiHandler;
    party.setCursor(game.scene.getPlayerParty().indexOf(pokemon));
    party.showOptions();
    expect(party["options"]).toContain(action);
    expect(party["processActionButtonForOptions"](action)).toBe(true);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.OPTION_SELECT));
    const menu = ui.handlers[UiMode.OPTION_SELECT] as BaseOptionSelectUiHandler;
    const indices = pokemon.species.forms.flatMap((f, i) => (keys as readonly string[]).includes(f.formKey) ? [i] : []);
    expect(menu["config"]?.options.map(o => o.label)).toEqual([...indices.map(i => pokemon.species.getFormNameToDisplay(i)), "Cancel"]);
    expect(menu["config"]?.initialCursor).toBe(indices.indexOf(pokemon.formIndex));
    menu.processInput(Button.CANCEL);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.PARTY));
    if (id === SpeciesId.ROTOM) {
      pokemon.setMove(0, MoveId.OVERHEAT);
    } else if (id === SpeciesId.PIKACHU) {
      pokemon.setMove(0, MoveId.ICICLE_CRASH);
      expect(getFormSelectionChange(pokemon, itemId, 0)).toBeUndefined();
    }
    for (const key of [keys[2], keys[0]]) {
      const index = pokemon.species.forms.findIndex(f => f.formKey === key);
      await pokemon.changeForm(getFormSelectionChange(pokemon, itemId, index)!);
      expect(pokemon.getFormKey()).toBe(key);
      if (id === SpeciesId.ROTOM || id === SpeciesId.PIKACHU) {
        const expected = key === keys[0] ? MoveId.THUNDER_SHOCK : id === SpeciesId.ROTOM ? MoveId.HYDRO_PUMP : MoveId.DRAINING_KISS;
        expect(pokemon.getMoveset().some(move => move?.moveId === expected)).toBe(true);
      }
    }
  });

  it("excludes non-Cosplay Pikachu and retires every old meteorite, scarf and appliance from Dowsing", () => {
    const pikachu = addMember(SpeciesId.PIKACHU, "");
    for (const [index, form] of pikachu.species.forms.entries()) {
      pikachu.formIndex = index;
      expect(canReceiveFormSelectionItem(pikachu, FormChangeItem.PROP_CASE)).toBe(form.formKey.includes("cosplay"));
    }
    const retired = [
      FormChangeItem.SHARP_METEORITE, FormChangeItem.HARD_METEORITE, FormChangeItem.SMOOTH_METEORITE,
      FormChangeItem.COSPLAY_RED_SCARF, FormChangeItem.COSPLAY_BLUE_SCARF, FormChangeItem.COSPLAY_PINK_SCARF,
      FormChangeItem.COSPLAY_GREEN_SCARF, FormChangeItem.COSPLAY_YELLOW_SCARF,
      FormChangeItem.ROTOM_OVEN, FormChangeItem.ROTOM_WASHER, FormChangeItem.ROTOM_FRIDGE, FormChangeItem.ROTOM_FAN, FormChangeItem.ROTOM_MOWER,
    ];
    const options = getDowsingItemOptions([pikachu], "FORM_CHANGE_ITEM");
    expect(options.filter(o => retired.includes(o.item as FormChangeItem))).toEqual([]);
  });

  it("restores legacy appliances and only suppresses their triggers while the same holder has a catalogue", () => {
    const rotom = addMember(SpeciesId.ROTOM, "");
    const old = makeItem(rotom, FormChangeItem.ROTOM_OVEN);
    const restored = new ModifierData(old, true).toModifier(PokemonFormChangeItemModifier) as PokemonFormChangeItemModifier;
    expect(restored.formChangeItem).toBe(FormChangeItem.ROTOM_OVEN);
    const inventory = game.scene.getPlayerModifiers();
    inventory.push(restored);
    const trigger = new SpeciesFormChangeItemTrigger(FormChangeItem.ROTOM_OVEN);
    expect(trigger.canChange(rotom)).toBe(true);
    const catalogue = makeItem(rotom, FormChangeItem.ROTOM_CATALOGUE);
    inventory.push(catalogue);
    expect(trigger.canChange(rotom)).toBe(false);
    expect(getFormSelectionChange(rotom, FormChangeItem.ROTOM_CATALOGUE, 2)?.formKey).toBe("wash");
    inventory.splice(inventory.indexOf(catalogue), 1);
    expect(trigger.canChange(rotom)).toBe(true);
  });

  it("rolls one normal form item, targets only eligible holders, and never applies a trim on pickup", () => {
    const other = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 5);
    const options = (party: PlayerPokemon[]) => getDowsingItemOptions(party, "FORM_CHANGE_ITEM")
      .filter(o => o.item === FormChangeItem.FASHION_CASE);
    expect(options([furfrou])).toHaveLength(1);
    expect(options([furfrou])[0]).toMatchObject({ available: true, type: { tier: ModifierTier.ULTRA } });
    expect(options([other])[0].available).toBe(false);
    expect(type.selectFilter!(other)).not.toBeNull();
    expect(type.selectFilter!(furfrou)).toBeNull();
    furfrou.formIndex = 4;
    const item = equip();
    expect(furfrou.formIndex).toBe(4);
    expect(options([furfrou])[0].available).toBe(false);
    expect(type.selectFilter!(furfrou)).not.toBeNull();
    expect(item.getMaxHeldItemCount(furfrou)).toBe(1);
    expect(new ModifierData(item, true).toModifier(PokemonFormChangeItemModifier))
      .toMatchObject({ pokemonId: furfrou.id, formChangeItem: FormChangeItem.FASHION_CASE, active: false });
  });

  it("changes directly between trims and back to Natural, recording only visited forms", async () => {
    equip();
    const data = game.scene.gameData;
    const dex = data.dexData[SpeciesId.FURFROU];
    dex.caughtAttr = dex.seenAttr = furfrou.getDexAttr();
    const caughtCount = dex.caughtCount;
    for (const index of [1, 9, 0]) {
      const change = getFormSelectionChange(furfrou, fashion, index)!;
      expect(change.preFormKey).toBe(furfrou.getFormKey());
      await furfrou.changeForm(change);
      expect(furfrou.formIndex).toBe(index);
      expect(dex.seenAttr & dex.caughtAttr & data.getFormAttr(index)).toBe(data.getFormAttr(index));
      expect(getFormSelectionChange(furfrou, fashion, index)).toBeUndefined();
    }
    expect(dex.caughtAttr & data.getFormAttr(8)).toBe(0n);
    expect(dex.caughtCount).toBe(caughtCount);
    expect(getFormSelectionChange(furfrou, fashion, 10)).toBeUndefined();
  });

  it("uses the Furfrou form list for the donor of a fusion", () => {
    const body = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.EEVEE), 5);
    game.scene.getPlayerParty().push(body);
    body.fusionSpecies = furfrou.species;
    body.fusionFormIndex = 2;
    expect(canReceiveFormSelectionItem(body, fashion)).toBe(true);
    equip(body);
    expect(getFormSelectionTarget(body, fashion)?.index).toBe(2);
    const change = getFormSelectionChange(body, fashion, 3)!;
    expect(change.preFormKey).toBe("star");
    expect(change.formKey).toBe("diamond");
    expect(body.isFusionFormChange(change)).toBe(true);
  });

  it("lets only the reward owner browse all ten trims, cancel, and open the selected form phase", async () => {
    game.scene.configureTwoPlayerMode(true);
    const guest = game.scene.addPlayerPokemon(furfrou.species, 5);
    guest.formIndex = 1;
    game.scene.getPlayerParty(1).push(guest);
    equip(guest);
    const ui = game.scene.ui, phases = game.scene.phaseManager;
    const party = ui.handlers[UiMode.PARTY] as PartyUiHandler;
    const menu = ui.handlers[UiMode.OPTION_SELECT] as BaseOptionSelectUiHandler;
    const override = vi.spyOn(phases, "overridePhase").mockReturnValue(true);
    expect(party["processFormSelection"](guest, fashion)).toBe(false);
    vi.spyOn(phases, "getCurrentPhase").mockReturnValue(new SelectModifierPhase(0, undefined, undefined, false, 1));
    expect(party["processFormSelection"](guest, fashion)).toBe(false);
    game.scene.setActivePlayerIndex(1);
    await ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, -1);
    party.showOptions();
    expect(party["getFormChangeItemsModifiers"](guest)).toHaveLength(0);
    expect(party["processActionButtonForOptions"](PartyOption.CHANGE_TRIM)).toBe(true);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.OPTION_SELECT));
    expect(menu["config"]?.options.map(o => o.label)).toEqual([
      "Natural Form", "Heart Trim", "Star Trim", "Diamond Trim", "Debutante Trim", "Matron Trim",
      "Dandy Trim", "La Reine Trim", "Kabuki Trim", "Pharaoh Trim", "Cancel",
    ]);
    expect(menu["config"]?.initialCursor).toBe(1);
    menu.processInput(Button.CANCEL);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.PARTY));
    expect(override).not.toHaveBeenCalled();
    expect(guest.formIndex).toBe(1);
    party["processActionButtonForOptions"](PartyOption.CHANGE_TRIM);
    await vi.waitFor(() => expect(ui.getMode()).toBe(UiMode.OPTION_SELECT));
    menu.setCursor(9);
    menu.processInput(Button.ACTION);
    await vi.waitFor(() => expect(override).toHaveBeenCalledOnce());
    const phase = override.mock.calls[0][0] as FormChangePhase;
    expect(phase.phaseName).toBe("FormChangePhase");
    expect(phase["pokemon"]).toBe(guest);
    expect(phase["playerIndex"]).toBe(1);
    expect(phase["formChange"].formKey).toBe("pharaoh");
  });
});
