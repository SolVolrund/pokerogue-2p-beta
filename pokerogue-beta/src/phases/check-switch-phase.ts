import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { BattleStyle } from "#enums/battle-style";
import { BattlerTagType } from "#enums/battler-tag-type";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { BattlePhase } from "#phases/battle-phase";
import { getComputerPartnerImprovedSwitchIndex, isComputerPartnerFieldIndex } from "#utils/computer-partner-ai";
import i18next from "i18next";

export class CheckSwitchPhase extends BattlePhase {
  public readonly phaseName = "CheckSwitchPhase";
  protected fieldIndex: number;
  protected useName: boolean;

  constructor(fieldIndex: number, useName: boolean) {
    super();

    this.fieldIndex = fieldIndex;
    this.useName = useName;
  }

  private getPlayerPokemon(): PlayerPokemon | undefined {
    const fieldPokemon = globalScene.getPlayerField()[this.fieldIndex];
    if (fieldPokemon) {
      return fieldPokemon;
    }

    const battlerPokemon = globalScene.getField()[this.fieldIndex];
    return battlerPokemon?.isPlayer() ? (battlerPokemon as PlayerPokemon) : undefined;
  }

  start() {
    super.start();

    const pokemon = this.getPlayerPokemon();
    if (pokemon) {
      this.fieldIndex = pokemon.getFieldIndex();
    }

    const playerIndex = pokemon
      ? globalScene.getPlayerIndexForPokemon(pokemon) ?? globalScene.getPlayerIndexForFieldSlot(this.fieldIndex)
      : globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
    const activePartySlotCount = globalScene.twoPlayerMode ? 1 : globalScene.currentBattle.getBattlerCount();

    // End this phase early...

    // ...if the user is playing in Set Mode
    if (globalScene.battleStyle === BattleStyle.SET) {
      this.end();
      return;
    }

    // ...if the checked Pokemon is somehow not on the field
    if (!pokemon || globalScene.field.getAll().indexOf(pokemon) === -1) {
      globalScene.phaseManager.unshiftNew("SummonMissingPhase", this.fieldIndex);
      return super.end();
    }

    // ...if there are no other allowed Pokemon in the player's party to switch with
    if (
      globalScene
        .getPlayerParty(playerIndex)
        .slice(activePartySlotCount)
        .filter(p => p.isActive()).length === 0
    ) {
      this.end();
      return;
    }

    // ...or if any player Pokemon has an effect that prevents the checked Pokemon from switching
    if (
      pokemon.getTag(BattlerTagType.FRENZY)
      || pokemon.isTrapped()
      || globalScene.getPlayerField().some(p => p.getTag(BattlerTagType.COMMANDED))
    ) {
      this.end();
      return;
    }

    if (isComputerPartnerFieldIndex(this.fieldIndex)) {
      const switchIndex = getComputerPartnerImprovedSwitchIndex(this.fieldIndex);
      if (switchIndex !== undefined) {
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          SwitchType.INITIAL_SWITCH,
          this.fieldIndex,
          switchIndex,
          true,
        );
      }
      this.end();
      return;
    }

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(playerIndex);
    }

    globalScene.ui.showText(
      i18next.t("battle:switchQuestion", {
        pokemonName: this.useName ? getPokemonNameWithAffix(pokemon) : i18next.t("battle:pokemon"),
      }),
      null,
      () => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(playerIndex);
        }
        globalScene.ui.setMode(
          UiMode.CONFIRM,
          () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.phaseManager.unshiftNew("SwitchPhase", SwitchType.INITIAL_SWITCH, this.fieldIndex, false, true);
            this.end();
          },
          () => {
            globalScene.ui.setMode(UiMode.MESSAGE);
            this.end();
          },
        );
      },
    );
  }
}
