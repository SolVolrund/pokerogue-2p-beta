import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { PartyUiMode } from "#enums/party-ui-mode";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { OptionSelectSettings } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { applyWindowAppearance } from "#ui/ui-theme";

export type RegistrationStep = {
  name: string;
  menu?: (seat: PlayerIndex) => OptionSelectSettings;
  openingSwitch?: (seat: PlayerIndex) => { question: string; fieldIndex: number };
  partyFilter?: (pokemon: Pokemon) => string | null;
  legal: (seat: PlayerIndex) => number[];
  veto?: () => void;
  queueSequential: () => void;
} & ({ commit: (choices: number[]) => Promise<void | boolean> } | { queueCommit: (choices: number[]) => void });

/** Local menus only collect choices. Shared dialogue, RNG and rewards run after unanimous validation. */
export class PrivateRegistrationPhase extends Phase {
  readonly phaseName = "PrivateRegistrationPhase";
  readonly seat = globalScene.twoPlayerLocalInputSeat as PlayerIndex;
  locked = false;
  pausing = false;
  private key: string;

  constructor(private readonly step: RegistrationStep, private readonly attempt = 0) { super(); }

  override start(): void {
    const scene = globalScene;
    this.key = (this.step.veto ? "contest:unanimous:" : "contest:") + JSON.stringify([scene.seed, scene.currentBattle.waveIndex, this.step.name, this.attempt]);
    scene.waitForSharedInput();
    applyWindowAppearance(this.seat + 1);
    scene.uiInputs.beginPrivateDraft(this.key, async (owner, openedAt) => {
      if (!this.current()) return;
      this.pausing = true;
      await scene.ui.dismissPrivateDraft();
      const resume = () => {
        if (scene.privateTurnSelection) scene.phaseManager.unshiftNew("PrivateRegistrationPhase", this.step, this.attempt + 1);
        else this.step.queueSequential();
      };
      scene.phaseManager.unshiftNew("PrivatePauseMenuPhase", owner, resume, this.attempt + 1, openedAt);
      this.end();
    }, this.step.veto ? async () => {
      if (!this.current()) return;
      this.pausing = true;
      await scene.ui.dismissPrivateDraft();
      scene.waitForPlayerSideProgressionInput(0);
      this.step.veto!();
      this.end();
    } : undefined);
    if (this.step.openingSwitch) {
      if (this.step.legal(this.seat).length === 1) {
        void this.choose(-1);
        return;
      }
      const { question, fieldIndex } = this.step.openingSwitch(this.seat);
      scene.ui.showText(question, 0);
      scene.ui.setMode(UiMode.CONFIRM, () => {
        if (!this.current() || this.locked) return;
        scene.ui.setMode(UiMode.PARTY, PartyUiMode.POST_BATTLE_SWITCH, fieldIndex, (slot: number) => {
          void this.choose(slot === 6 ? -1 : scene.getPlayerParty(this.seat)[slot]?.id);
        });
      }, () => void this.choose(-1));
    } else if (this.step.menu) {
      scene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, this.step.menu(this.seat));
    } else if (!this.step.legal(this.seat).includes(-1)) {
      scene.ui.setMode(UiMode.PARTY, PartyUiMode.SELECT, -1, (slot: number) => {
        const pokemon = scene.getPlayerParty(this.seat)[slot];
        if (pokemon) void this.choose(pokemon.id);
      }, this.step.partyFilter);
    } else void this.choose(-1);
  }

  handleOptionSelect(_option: MysteryEncounterOption, index: number): boolean {
    if (!this.current() || this.locked || !this.step.legal(this.seat).includes(index)) return false;
    void this.choose(index);
    return true;
  }

  private current(): boolean {
    return !this.pausing && globalScene.phaseManager.getCurrentPhase() === this;
  }

  private async choose(value: number): Promise<void> {
    if (!this.current() || this.locked || !this.step.legal(this.seat).includes(value)) return;
    this.locked = true;
    const scene = globalScene;
    await scene.ui.setMode(UiMode.MESSAGE);
    if (!this.current()) return;
    scene.ui.showText("Choice locked. Waiting for the other players...", 0);
    try {
      const players = scene.getActivePlayerIndexes();
      const choices = await scene.uiInputs.submitPrivateContest(this.key, value, picks =>
        this.current() && picks.length === players.length && players.every((p, i) => this.step.legal(p).includes(picks[i])));
      if (!this.current()) return;
      scene.ui.clearText();
      scene.waitForPlayerSideProgressionInput(0);
      const step = this.step;
      if (!choices) step.queueSequential();
      else if ("queueCommit" in step) step.queueCommit(choices);
      else scene.phaseManager.unshiftNew("MysteryEncounterOptionSelectedPhase", () => step.commit(choices));
      this.end();
    } catch {
      if (this.current()) scene.ui.showText("Choice sync interrupted. Leave the lobby and resume together.", 0);
    }
  }
}
