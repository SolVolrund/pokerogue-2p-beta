import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { Pokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";
import { tryEatBerries } from "#utils/berry-use-utils";

/**
 * The phase after attacks where the pokemon eat berries.
 * Also triggers Cud Chew's "repeat berry use" effects
 */
export class BerryPhase extends FieldPhase {
  public readonly phaseName = "BerryPhase";
  start() {
    super.start();

    this.executeForAll(pokemon => {
      this.eatBerries(pokemon);
      applyAbAttrs("CudChewConsumeBerryAbAttr", { pokemon });
    });

    this.end();
  }

  /**
   * Attempt to eat all of a given {@linkcode Pokemon}'s berries once.
   * @param pokemon - The {@linkcode Pokemon} to check
   */
  eatBerries(pokemon: Pokemon): void {
    tryEatBerries(pokemon, { trigger: "turn-end" });
  }
}
