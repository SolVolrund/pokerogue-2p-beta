import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { PokemonSpecies } from "#data/pokemon-species";
import { UiMode } from "#enums/ui-mode";
import { ModifierRewardPhase } from "#phases/modifier-reward-phase";
import type { ModifierTypeFunc } from "#types/modifier-types";
import i18next from "i18next";

export class RibbonModifierRewardPhase extends ModifierRewardPhase {
  public readonly phaseName = "RibbonModifierRewardPhase";
  private species: PokemonSpecies;

  constructor(modifierTypeFunc: ModifierTypeFunc, species: PokemonSpecies, playerIndex?: PlayerIndex) {
    super(modifierTypeFunc, playerIndex);

    this.species = species;
  }

  doReward(): Promise<void> {
    return new Promise<void>(resolve => {
      const newModifier = this.modifierType.newModifier();
      globalScene.addModifier(newModifier, undefined, undefined, undefined, undefined, undefined, this.playerIndex);
      audioManager.playSound("se/level_up_fanfare");
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.showText(
        i18next.t("battle:beatModeFirstTime", {
          speciesName: this.species.name,
          gameMode: globalScene.gameMode.getName(),
          newModifier: newModifier?.type.name,
        }),
        null,
        () => {
          resolve();
        },
        null,
        true,
        1500,
      );
    });
  }
}
