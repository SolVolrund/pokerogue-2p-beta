import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { Phase } from "#app/phase";
import type { BattlerIndex } from "#enums/battler-index";
import { MoveTarget } from "#enums/move-target";
import { BattlerTagType } from "#enums/battler-tag-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import type { PrivateFightPick, PrivateMedicinePick, PrivateSwitchPick, PrivateTurnPick } from "#utils/private-turn";
import { CommandPhase } from "#phases/command-phase";
import { MoveId } from "#enums/move-id";
import i18next from "i18next";
import { applyWindowAppearance } from "#ui/ui-theme";

type MovePlan = { cursor: number; targets: BattlerIndex[] };
export type PlannedFight = MovePlan | { cursor: number; baton: boolean } | PrivateMedicinePick
  | { kind: "ball"; ball: number; target: BattlerIndex };
type Option = { pick: PrivateFightPick; plan: MovePlan };

function switchPlan(actor: PlayerPokemon, pick: PrivateSwitchPick) {
  const scene = globalScene;
  const owner = scene.getPlayerIndexForPokemon(actor);
  if (owner === undefined || pick.actor !== actor.id) return;
  const party = scene.getPlayerParty(owner);
  const cursor = party.findIndex(p => p.id === pick.reserve);
  if (cursor < scene.getPlayerActiveSlotCount(owner) || !party[cursor].isAllowedInBattle()
    || scene.getPlayerField().includes(party[cursor])
    || scene.isPlayerSwitchReserved(owner, cursor, actor.getFieldIndex())
    || actor.getTag(BattlerTagType.COMMANDED)?.getSourcePokemon()?.isActive(true)) return;
  if (pick.baton ? !scene.findModifierForPlayer(m => m.is("SwitchEffectTransferModifier")
    && m.pokemonId === actor.id && m.isEffectActive(actor), owner) : actor.isTrapped()) return;
  return { cursor, baton: pick.baton };
}

/** Generate the same legal choices on every client before anyone picks. */
function optionsFor(pokemon: PlayerPokemon): Option[] {
  return pokemon.getMoveset().flatMap((entry, slot) => {
    const move = entry.getMove();
    // Don't run random/variable targeting speculatively while browsing.
    if (move.moveTarget === MoveTarget.RANDOM_NEAR_ENEMY || move.hasAttr("VariableTargetAttr")
      || !pokemon.trySelectMove(slot)[0]) return [];
    const { targets, multiple } = getMoveTargets(pokemon, entry.moveId);
    if (!targets.length) return [];
    return (multiple ? [targets] : targets.map(t => [t])).map(selected => ({
      pick: { actor: pokemon.id, slot, move: entry.moveId, target: multiple ? null : selected[0] },
      plan: { cursor: slot, targets: selected },
    }));
  });
}

export class PrivateFightPhase extends Phase {
  public readonly phaseName = "PrivateFightPhase";
  // Never change the cursor memory used for replaying ordinary shared input.
  public readonly cursors = { command: 0, move: 0 };
  public readonly bagCursors = { ball: 0, medicine: 0 };
  private actor: PlayerPokemon;
  private choices: Option[];
  private submit: (pick: PrivateTurnPick | null) => void;
  public pausing = false;

  constructor(private readonly plans: Map<number, PlannedFight>, private readonly attempt = 0) { super(); }

  getPokemon(): PlayerPokemon { return this.actor; }
  getFieldIndex(): number { return this.actor.getFieldIndex(); }

  handleMedicineCommand(typeId: string, targetId: number, moveIndex?: number): boolean {
    if (!CommandPhase.canQueueMedicine(this.getFieldIndex(), typeId, targetId, moveIndex)) return false;
    this.submit({ kind: "medicine", actor: this.actor.id, typeId, targetId, ...(moveIndex !== undefined ? { moveIndex } : {}) });
    return true;
  }

  chooseBall(ball: number): boolean {
    const ui = globalScene.ui;
    const { targets, reason } = CommandPhase.getBallOptions(this.getFieldIndex(), ball);
    const back = () => {
      ui.setMode(UiMode.COMMAND, this.getFieldIndex());
      ui.setModeWithoutClear(UiMode.BALL);
    };
    if (!targets.length) {
      if (reason) {
        ui.setMode(UiMode.MESSAGE);
        ui.showText(i18next.t(reason), null, back, null, true);
      } else ui.playError();
      return false;
    }
    const select = (indices: BattlerIndex[]) => {
      if (!indices.length) return back();
      const target = globalScene.getField()[indices[0]];
      if (target && targets.includes(indices[0])) this.submit({ kind: "ball", actor: this.actor.id, ball, targetId: target.id });
    };
    if (targets.length === 1) select(targets);
    else ui.setMode(UiMode.TARGET_SELECT, this.getFieldIndex(), MoveId.NONE, select, undefined, targets, this.actor);
    return true;
  }

  chooseSwitch(reserve: number, baton: boolean): boolean {
    const pick: PrivateSwitchPick = { kind: "switch", actor: this.actor.id, reserve, baton };
    if (!switchPlan(this.actor, pick)) return false;
    this.submit(pick);
    return true;
  }

  confirmNormalMenus(back: UiMode.COMMAND | UiMode.FIGHT): void {
    const ui = globalScene.ui;
    ui.setMode(UiMode.MESSAGE);
    ui.showText("Use normal menus for this action? Everyone will choose again.", 0);
    ui.setModeWithoutClear(UiMode.CONFIRM, () => this.submit(null), () => ui.setMode(back, this.getFieldIndex()));
  }

  chooseMove(slot: number): boolean {
    const entry = this.actor.getMoveset()[slot];
    if (!entry || !this.actor.trySelectMove(slot)[0]) return false;
    const matches = this.choices.filter(option => option.pick.slot === slot);
    if (!matches.length) {
      this.confirmNormalMenus(UiMode.FIGHT);
      return true;
    }
    const confirm = (option: Option) => {
      const target = globalScene.getField()[option.plan.targets[0]];
      if (target && this.actor.getTargetRestrictingTag(entry.moveId, target)) return false;
      this.submit(option.pick);
      return true;
    };
    if (matches.length === 1 && matches[0].plan.targets.length === 1) return confirm(matches[0]);

    const ui = globalScene.ui;
    const ally = entry.getMove().allyTargetDefault && matches.find(o => {
      const target = globalScene.getField()[o.plan.targets[0]];
      return target && this.actor.isAlly(target);
    });
    ui.setMode(UiMode.TARGET_SELECT, this.getFieldIndex(), entry.moveId, (targets: BattlerIndex[]) => {
      if (!targets.length) {
        ui.setMode(UiMode.FIGHT, this.getFieldIndex());
        return;
      }
      const option = matches.find(o => targets.length === o.plan.targets.length && targets.every((t, i) => t === o.plan.targets[i]));
      if (!option || !confirm(option)) ui.playError();
    }, ally ? ally.plan.targets : undefined, undefined, this.actor);
    return true;
  }

  override start(): void {
    super.start();
    const scene = globalScene;
    const active = scene.getPlayerField().filter(p => p?.isActive());
    const seat = scene.twoPlayerLocalInputSeat;
    const players = scene.getActivePlayerIndexes();
    const bySeat = players.map(owner => active.find(p => scene.getPlayerIndexForPokemon(p) === owner));
    if (typeof seat !== "number" || !players.includes(seat) || active.length !== players.length || bySeat.some(p =>
      !p || p.getMoveQueue().length || p.isCommandingDondozo() || CommandPhase.shouldAutoSelectFightMove(p)
      || scene.currentBattle.turnCommands[p.getBattlerIndex()]?.skip || scene.isEonFluteGuest(p))) {
      this.end();
      return;
    }
    const actors = bySeat as PlayerPokemon[];
    const options = actors.map(optionsFor);
    if (options.some(list => !list.length)) {
      this.end();
      return;
    }
    const { waveIndex, turn } = scene.currentBattle;
    const key = JSON.stringify([scene.seed, waveIndex, turn, ...actors.map(p => p.id), this.attempt]);
    scene.waitForSharedInput();
    applyWindowAppearance(seat + 1);
    const ui = scene.ui;
    let locked = false;
    const current = () => !this.pausing && scene.phaseManager.getCurrentPhase() === this;
    this.actor = actors[seat];
    this.choices = options[seat];
    this.submit = async (pick: PrivateTurnPick | null) => {
      if (locked || !current()) return;
      locked = true;
      await ui.setMode(UiMode.MESSAGE);
      if (!current()) return;
      ui.showText("Choice locked. Waiting for the other players...", 0);
      try {
        let prepared: PlannedFight[] = [];
        const batch = await scene.uiInputs.submitPrivateFight(key, pick, candidates => {
          if (!current() || candidates.length !== actors.length) return false;
          const chosen = candidates.map((p, i): PlannedFight | undefined => {
            const actor = actors[i];
            if (p.actor !== actor.id) return;
            if ("kind" in p) {
              if (p.kind === "switch") return switchPlan(actor, p);
              if (p.kind === "medicine") return CommandPhase.canQueueMedicine(actor.getFieldIndex(), p.typeId, p.targetId, p.moveIndex) ? p : undefined;
              const target = CommandPhase.getBallOptions(actor.getFieldIndex(), p.ball).targets.find(t => scene.getField()[t]?.id === p.targetId);
              return target === undefined ? undefined : { kind: "ball", ball: p.ball, target };
            }
            const plan = options[i].find(({ pick: legal }) => p.slot === legal.slot && p.move === legal.move && p.target === legal.target)?.plan;
            const target = plan && scene.getField()[plan.targets[0]];
            return target && !actor.getTargetRestrictingTag(p.move, target) ? plan : undefined;
          });
          // A peer cannot choose another player's actor or supply arbitrary battle commands.
          prepared = chosen.filter((plan): plan is PlannedFight => plan !== undefined);
          return prepared.length === actors.length;
        });
        if (!current()) return;
        if (batch) prepared.forEach((plan, i) => this.plans.set(actors[i].id, plan));
        ui.clearText();
        applyWindowAppearance(5);
        scene.clearInputOwner();
        this.end();
      } catch {
        if (current()) ui.showText("Turn sync interrupted. Leave the lobby and resume together.", 0);
      }
    };
    ui.setMode(UiMode.COMMAND, this.getFieldIndex());
    scene.uiInputs.beginPrivateDraft(key, async (owner, openedAt) => {
      if (!current()) return;
      this.pausing = true;
      await ui.dismissPrivateDraft();
      if (scene.phaseManager.getCurrentPhase() !== this) return;
      this.plans.clear();
      scene.phaseManager.unshiftNew("PrivatePauseMenuPhase", owner, this.plans, this.attempt + 1, openedAt);
      this.end();
    });
  }
}

/** Ordinary synchronized menu input, with the opening seat as its sole owner. */
export class PrivatePauseMenuPhase extends Phase {
  readonly phaseName = "PrivatePauseMenuPhase";
  private closing = false;
  private readonly previousPlayer = globalScene.activePlayerIndex;
  constructor(private readonly owner: PlayerIndex, private readonly plans: Map<number, PlannedFight> | (() => void),
    private readonly nextAttempt: number, readonly openedAt: number) { super(); }

  override start(): void {
    globalScene.waitForPlayerInput(this.owner);
    globalScene.uiInputs.broadcastTwoPlayerSettingsSnapshot();
    globalScene.ui.setMode(UiMode.MENU);
  }

  async resume(): Promise<void> {
    if (this.closing) return;
    this.closing = true;
    await globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.uiInputs.broadcastTwoPlayerSettingsSnapshot();
    globalScene.setActivePlayerIndex(this.previousPlayer);
    // With no private retry, the queued CommandPhases prompt each player normally.
    if (typeof this.plans === "function") {
      this.plans();
    } else if (globalScene.privateTurnSelection) {
      globalScene.phaseManager.unshiftNew("PrivateFightPhase", this.plans, this.nextAttempt);
    }
    this.end();
  }
}
