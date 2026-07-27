import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { Pokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import i18next from "i18next";

export class ZMovePhase extends BattlePhase {
  public readonly phaseName = "ZMovePhase";
  public readonly pokemon: Pokemon;

  constructor(pokemon: Pokemon) {
    super();

    this.pokemon = pokemon;
  }

  start() {
    super.start();

    globalScene.phaseManager.queueMessage(
      i18next.t("battle:pokemonSurroundedByZPower", {
        pokemonNameWithAffix: getPokemonNameWithAffix(this.pokemon),
      }),
    );

    this.end();
  }

  end() {
    if (this.pokemon.isPlayer()) {
      const playerIndex = globalScene.getPlayerIndexForPokemon(this.pokemon) ?? 0;
      globalScene.arena.incrementPlayerZMovesUsed(playerIndex);
      globalScene.arena.startPlayerZMoveRecharge(playerIndex);
    }

    super.end();
  }
}
