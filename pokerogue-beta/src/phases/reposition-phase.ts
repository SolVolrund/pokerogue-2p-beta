import { globalScene } from "#app/global-scene";
import type { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";
import type { Pokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";

export class RepositionPhase extends FieldPhase {
  public readonly phaseName = "RepositionPhase";

  constructor(
    private readonly battlerIndex: BattlerIndex,
    private readonly targetPosition: FieldPosition,
  ) {
    super();
  }

  start(): void {
    super.start();

    const pokemon = globalScene.getField()[this.battlerIndex];
    if (!pokemon?.isActive(true) || pokemon.fieldPosition === this.targetPosition) {
      this.end();
      return;
    }

    const previousPosition = pokemon.fieldPosition;
    const side = pokemon.isPlayer() ? globalScene.getPlayerField(true) : globalScene.getEnemyField(true);
    const swapTarget = side.find(
      sidePokemon => sidePokemon !== pokemon && sidePokemon.fieldPosition === this.targetPosition,
    );
    const positionUpdates: Promise<void>[] = [pokemon.setFieldPosition(this.targetPosition, 250)];

    if (swapTarget) {
      positionUpdates.push(swapTarget.setFieldPosition(previousPosition, 250));
    }

    Promise.all(positionUpdates).then(() => {
      globalScene.updateFieldDepthOrder();
      void globalScene.updateFieldScale();
      this.end();
    });
  }
}
