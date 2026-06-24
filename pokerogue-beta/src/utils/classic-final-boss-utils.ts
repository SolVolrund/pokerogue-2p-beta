import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";

export const CLASSIC_FINAL_BOSS_SEGMENTS = 5;

export function isClassicFinalBossPhaseTwo(pokemon: Pokemon): boolean {
  switch (pokemon.species.speciesId) {
    case SpeciesId.ETERNATUS:
      return pokemon.formIndex > 0;
    case SpeciesId.NECROZMA:
      return pokemon.hasSpecies(SpeciesId.NECROZMA, "ultra");
    default:
      return false;
  }
}

export function isClassicFinalBossPhaseOne(pokemon: Pokemon): boolean {
  switch (pokemon.species.speciesId) {
    case SpeciesId.ETERNATUS:
      return pokemon.formIndex === 0;
    case SpeciesId.NECROZMA:
      return pokemon.hasSpecies(SpeciesId.NECROZMA, "dusk-mane")
        || pokemon.hasSpecies(SpeciesId.NECROZMA, "dawn-wings");
    default:
      return false;
  }
}

