import { globalScene } from "#app/global-scene";
import { SwitchType } from "#enums/switch-type";
import { UiMode } from "#enums/ui-mode";
import { BattlePhase } from "#phases/battle-phase";
import { PartyOption, PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import {
  getComputerPartnerBestSwitchIndex,
  getComputerPartnerImprovedSwitchIndex,
  isComputerPartnerFieldIndex,
} from "#utils/computer-partner-ai";

/**
 * Opens the party selector UI and transitions into a {@linkcode SwitchSummonPhase}
 * for the player (if a switch would be valid for the current battle state).
 */
export class SwitchPhase extends BattlePhase {
  public readonly phaseName = "SwitchPhase";
  protected readonly fieldIndex: number;
  private readonly switchType: SwitchType;
  private readonly isModal: boolean;
  private readonly doReturn: boolean;

  /**
   * Creates a new SwitchPhase
   * @param switchType {@linkcode SwitchType} The type of switch logic this phase implements
   * @param fieldIndex Field index to switch out
   * @param isModal Indicates if the switch should be forced (true) or is
   * optional (false).
   * @param doReturn Indicates if the party member on the field should be
   * recalled to ball or has already left the field. Passed to {@linkcode SwitchSummonPhase},
   * and is (ostensibly) only set to `false` from `FaintPhase`.
   */
  constructor(switchType: SwitchType, fieldIndex: number, isModal: boolean, doReturn: boolean) {
    super();

    this.switchType = switchType;
    this.fieldIndex = fieldIndex;
    this.isModal = isModal;
    this.doReturn = doReturn;
  }

  start() {
    super.start();

    const playerIndex = globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
    const allowedPartyMembers = globalScene.getPokemonAllowedInBattle(playerIndex);
    const activePartySlotCount = globalScene.twoPlayerMode ? 1 : globalScene.currentBattle.getBattlerCount();
    const fieldPokemon = globalScene.getPlayerPokemonForFieldSlot(this.fieldIndex);

    // Skip modal switch if impossible (no remaining party members that aren't already in battle)
    if (this.isModal && allowedPartyMembers.every(p => p.isOnField())) {
      return super.end();
    }

    /**
     * Skip if the fainted party member has been revived already. doReturn is
     * only passed as `false` from FaintPhase (as opposed to other usages such
     * as ForceSwitchOutAttr or CheckSwitchPhase), so we only want to check this
     * if the mon should have already been returned but is still alive and well
     * on the field. see also; battle.test.ts
     */
    // TODO: If a Phasing move kills its own user, when does said user appear on field?
    // Is it after the user faints
    if (this.isModal && !this.doReturn && fieldPokemon && !fieldPokemon.isFainted()) {
      return super.end();
    }

    // Check if there is any space still in field
    if (this.isModal && globalScene.getPlayerField(true).length > globalScene.currentBattle.getBattlerCount()) {
      return super.end();
    }

    // Override field index to 0 in case of double battle where 2/3 remaining legal party members fainted at once
    const fieldIndex =
      globalScene.twoPlayerMode
        ? this.fieldIndex
        : globalScene.currentBattle.getBattlerCount() === 1 || allowedPartyMembers.length > 1
        ? this.fieldIndex
        : 0;

    if (isComputerPartnerFieldIndex(fieldIndex)) {
      const switchIndex = this.isModal
        ? getComputerPartnerBestSwitchIndex(playerIndex)
        : getComputerPartnerImprovedSwitchIndex(fieldIndex);
      if (switchIndex !== undefined) {
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          this.switchType,
          fieldIndex,
          switchIndex,
          this.doReturn,
        );
      }
      globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      return;
    }

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(playerIndex);
    }

    globalScene.ui.setMode(
      UiMode.PARTY,
      this.isModal ? PartyUiMode.FAINT_SWITCH : PartyUiMode.POST_BATTLE_SWITCH,
      fieldIndex,
      (slotIndex: number, option: PartyOption) => {
        if (slotIndex >= activePartySlotCount && slotIndex < 6) {
          const switchType = option === PartyOption.PASS_BATON ? SwitchType.BATON_PASS : this.switchType;
          globalScene.phaseManager.unshiftNew("SwitchSummonPhase", switchType, fieldIndex, slotIndex, this.doReturn);
        }
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
      },
      PartyUiHandler.FilterNonFainted,
    );
  }
}
