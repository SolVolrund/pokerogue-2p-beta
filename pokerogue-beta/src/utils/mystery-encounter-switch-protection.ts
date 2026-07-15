import { globalScene } from "#app/global-scene";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Pokemon } from "#field/pokemon";

/**
 * Some mystery encounters put battle-critical Pokemon on the field that should not
 * participate in normal trainer switch logic.
 */
export function isMysteryEncounterSwitchProtectedPokemon(pokemon: Pokemon | undefined): boolean {
  if (!pokemon) {
    return false;
  }

  const encounter = globalScene.currentBattle?.mysteryEncounter;
  if (!encounter?.misc) {
    return false;
  }

  switch (encounter.encounterType) {
    case MysteryEncounterType.POKE_POACHERS:
      return !!encounter.misc.rescueActive && pokemon.id === encounter.misc.protectedLegendaryId;
    default:
      return false;
  }
}
