import type { PostMoveUsedAbAttrParams } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { Phase } from "#app/phase";
import type { Pokemon } from "#field/pokemon";
import type { DynamicPhase } from "#types/phase-types";

/** Resolves each Dancer response in speed order after the original move finishes. */
export class DancerPhase extends Phase implements DynamicPhase {
  public override readonly phaseName = "DancerPhase";

  constructor(private readonly params: Readonly<PostMoveUsedAbAttrParams>) {
    super();
  }

  public getPokemon(): Pokemon {
    return this.params.pokemon;
  }

  public override start(): void {
    super.start();
    if (this.getPokemon().isActive(true)) {
      applyAbAttrs("PostMoveUsedAbAttr", this.params);
    }
    super.end();
  }
}
