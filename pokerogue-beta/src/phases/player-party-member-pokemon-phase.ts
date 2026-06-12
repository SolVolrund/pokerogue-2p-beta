import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { PlayerPokemon } from "#field/pokemon";
import { PartyMemberPokemonPhase } from "#phases/party-member-pokemon-phase";

export abstract class PlayerPartyMemberPokemonPhase extends PartyMemberPokemonPhase {
  protected playerIndex: PlayerIndex;

  constructor(partyMemberIndex: number, playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
    super(partyMemberIndex, true);

    this.playerIndex = playerIndex;
  }

  override getParty(): PlayerPokemon[] {
    return globalScene.getPlayerParty(this.playerIndex);
  }

  getPlayerPokemon(): PlayerPokemon {
    return super.getPokemon() as PlayerPokemon;
  }
}
