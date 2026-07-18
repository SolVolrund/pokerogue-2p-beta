import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getPokeballTintColor } from "#data/pokeball";
import { FieldPhase } from "#phases/field-phase";
import i18next from "i18next";

export class EonFluteDismissPhase extends FieldPhase {
  public readonly phaseName = "EonFluteDismissPhase";

  constructor(
    private readonly playerIndex: PlayerIndex,
    private readonly summonRealPokemon = false,
    private readonly destroyGuest = true,
  ) {
    super();
  }

  start(): void {
    super.start();

    const pokemon = globalScene.getEonFluteGuest(this.playerIndex);
    if (!pokemon) {
      this.queueRealPokemonSummon();
      this.end();
      return;
    }

    const finish = () => {
      if (pokemon.isOnField()) {
        pokemon.leaveField(true, false, false);
      }
      pokemon.resetSprite();
      pokemon.resetTurnData();
      pokemon.resetSummonData();

      if (this.destroyGuest) {
        globalScene.clearEonFluteGuest(this.playerIndex, true);
      }

      globalScene.updateFieldScale();
      this.queueRealPokemonSummon();
      this.end();
    };

    if (!pokemon.isOnField()) {
      finish();
      return;
    }

    const doReturn = () => {
      audioManager.playSound("se/pb_rel");
      pokemon.hideInfo();
      pokemon.tint(getPokeballTintColor(pokemon.getPokeball(true)), 1, 250, "Sine.easeIn");
      globalScene.tweens.add({
        targets: pokemon,
        duration: 250,
        ease: "Sine.easeIn",
        scale: 0.5,
        alpha: 0,
        onComplete: finish,
      });
    };

    if (this.summonRealPokemon) {
      globalScene.ui.showText(
        i18next.t(globalScene.isLegendaryHelperGuest(pokemon) ? "battle:glassBallReturn" : "battle:eonFluteReturn", {
          pokemonName: getPokemonNameWithAffix(pokemon),
        }),
        null,
        doReturn,
        0,
        true,
      );
    } else {
      doReturn();
    }
  }

  private queueRealPokemonSummon(): void {
    if (!this.summonRealPokemon) {
      return;
    }

    const fieldIndex = globalScene.getEonFluteFieldIndex(this.playerIndex);
    const pokemon = globalScene.getPokemonAllowedInBattle(this.playerIndex)[0];
    if (pokemon && !pokemon.isOnField()) {
      globalScene.phaseManager.unshiftNew("SummonPhase", fieldIndex);
    }
  }
}
