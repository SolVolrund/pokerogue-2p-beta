import { speciesDataRegistry } from "#app/global-species-data-registry";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("Eevee - Yes testing learnset", () => {
  it.each(["", "partner", SpeciesFormKey.GIGANTAMAX])("adds Yes alongside Sand Attack at level 5 for form %s", form => {
    const moves = speciesDataRegistry.getLevelMoves(SpeciesId.EEVEE, form);
    expect(moves).toContainEqual([5, MoveId.YES]);
    expect(moves).toContainEqual([5, MoveId.SAND_ATTACK]);
  });
});
