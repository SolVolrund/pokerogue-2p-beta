import {
  getPokemonAccessoryAnchor,
  getPokemonAccessorySlots,
  hasPokemonAccessoryAnchors,
  loadPokemonAccessoryAnchors,
} from "#data/pokemon-accessory-anchors";
import { SpeciesId } from "#enums/species-id";
import { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { beforeAll, describe, expect, it } from "vitest";

describe("Accessory anchor availability", () => {
  beforeAll(async () => {
    await loadPokemonAccessoryAnchors();
  });

  it.each([
    SpeciesId.CHARMANDER,
    SpeciesId.CHARMELEON,
    SpeciesId.CHARIZARD,
    SpeciesId.VENONAT,
    SpeciesId.VENOMOTH,
    SpeciesId.TRAPINCH,
    SpeciesId.VIBRAVA,
    SpeciesId.FLYGON,
    SpeciesId.CHESPIN,
  ])("loads the exported anchors for species %s on both sides", speciesId => {
    expect(hasPokemonAccessoryAnchors(speciesId, undefined, "front")).toBe(true);
    expect(hasPokemonAccessoryAnchors(speciesId, undefined, "back")).toBe(true);
  });

  it("loads Partner Eevee separately from regular Eevee", () => {
    for (const formKey of [undefined, "partner"]) {
      expect(hasPokemonAccessoryAnchors(SpeciesId.EEVEE, formKey, "front")).toBe(true);
      expect(hasPokemonAccessoryAnchors(SpeciesId.EEVEE, formKey, "back")).toBe(true);
    }
  });

  it.each([SpeciesId.DEERLING, SpeciesId.SAWSBUCK])("exposes all four seasonal forms for species %s", speciesId => {
    const handler = Object.create(StarterSelectUiHandler.prototype) as StarterSelectUiHandler;
    handler["lastSpecies"] = getPokemonSpecies(speciesId);
    const targets = handler["getAceDressTargets"]().filter(target => target.speciesId === speciesId && target.formKey);

    expect(targets.map(target => target.formKey)).toEqual(["spring", "summer", "autumn", "winter"]);
    for (const target of targets) {
      for (const side of ["front", "back"] as const) {
        const slots = getPokemonAccessorySlots(speciesId, side, target.formKey);
        expect(slots.length).toBeGreaterThan(0);
        for (const slot of slots) {
          expect(getPokemonAccessoryAnchor(speciesId, slot.id, "0001.png", side, target.formKey)).toEqual({
            x: expect.any(Number),
            y: expect.any(Number),
          });
        }
      }
    }
  });

  it("includes Mimikyu's first named form in the dress menu", () => {
    const handler = Object.create(StarterSelectUiHandler.prototype) as StarterSelectUiHandler;
    handler["lastSpecies"] = getPokemonSpecies(SpeciesId.MIMIKYU);
    const targets = handler["getAceDressTargets"]();
    const disguised = targets.find(target => target.formKey === "disguised");

    expect(disguised?.formIndex).toBe(0);
    expect(hasPokemonAccessoryAnchors(SpeciesId.MIMIKYU, disguised?.formKey)).toBe(true);
  });
});
