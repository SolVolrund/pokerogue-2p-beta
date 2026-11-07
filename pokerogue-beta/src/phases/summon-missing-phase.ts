import { globalScene } from "#app/global-scene";
import type { FieldPosition } from "#enums/field-position";
import { getPokemonNameWithAffix } from "#app/messages";
import { SummonPhase } from "#phases/summon-phase";
import i18next from "i18next";

export class SummonMissingPhase extends SummonPhase {
  public readonly phaseName = "SummonMissingPhase";
  constructor(fieldIndex: number, position?: FieldPosition) {
    super(fieldIndex);
    if (position !== undefined) {
      this.inheritedFieldPosition = position;
    }
  }

  preSummon(): void {
    this.setPlayerWindowTypeForField();
    globalScene.ui.showText(
      i18next.t("battle:sendOutPokemon", {
        pokemonName: getPokemonNameWithAffix(this.getPokemon()),
      }),
    );
    globalScene.time.delayedCall(250, () => this.summon());
  }
}
