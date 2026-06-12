import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { PlayerIndex } from "#app/battle-scene";
import type { PlayerPokemon } from "#field/pokemon";
import { ExpBoosterModifier } from "#modifiers/modifier";
import { PlayerPartyMemberPokemonPhase } from "#phases/player-party-member-pokemon-phase";
import { ValueHolder } from "#utils/value-holder";
import i18next from "i18next";

/**
 * Phase to update the EXP value and play corresponding messages
 * for a {@linkcode PlayerPokemon} which is on the field.
 */
export class ExpPhase extends PlayerPartyMemberPokemonPhase {
  public readonly phaseName = "ExpPhase";
  private readonly expValue: number;

  constructor(partyMemberIndex: number, expValue: number, playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
    super(partyMemberIndex, playerIndex);

    this.expValue = expValue;
  }

  public override start(): void {
    super.start();

    const pokemon = this.getPlayerPokemon();
    const exp = new ValueHolder(this.expValue);
    globalScene.applyModifiersForPlayer(ExpBoosterModifier, this.playerIndex, exp);
    exp.value = Math.floor(exp.value);
    globalScene.ui.showText(
      i18next.t("battle:expGain", {
        pokemonName: getPokemonNameWithAffix(pokemon),
        exp: exp.value,
      }),
      null,
      () => {
        const lastLevel = pokemon.level;
        pokemon.addExp(exp.value);
        const newLevel = pokemon.level;
        if (newLevel > lastLevel) {
          globalScene.phaseManager.unshiftNew("LevelUpPhase", this.partyMemberIndex, lastLevel, newLevel, this.playerIndex);
        }
        pokemon.showExpGain(lastLevel).then(() => this.end());
      },
      null,
      true,
    );
  }
}
