import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { Phase } from "#app/phase";
import type { BattlerIndex } from "#enums/battler-index";
import { MoveTarget } from "#enums/move-target";
import { BattlerTagType } from "#enums/battler-tag-type";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import { EnemyCommandPhase } from "#phases/enemy-command-phase";
import { Command } from "#enums/command";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import { getMoveTargets } from "#moves/move-utils";
import type { PrivateFieldPick, PrivateFightPick, PrivateMedicinePick, PrivateSwitchPick, PrivateTurnPick } from "#utils/private-turn";
import { CommandPhase } from "#phases/command-phase";
import { MoveId } from "#enums/move-id";
import i18next from "i18next";
import { applyWindowAppearance } from "#ui/ui-theme";

type MovePlan = { cursor: number; targets: BattlerIndex[] };
export type PlannedFight = MovePlan | { cursor: number; baton: boolean } | PrivateMedicinePick | PrivateFieldPick
  | { kind: "ball"; ball: number; target: BattlerIndex };
type Option = { pick: PrivateFightPick; plan: MovePlan };

type Actor = PlayerPokemon | EnemyPokemon;
function switchPlan(actor: Actor, pick: PrivateSwitchPick) {
  const scene = globalScene;
  if (actor.isEnemy()) {
    const option = !pick.baton && new EnemyCommandPhase(actor.getFieldIndex()).getSwitchOptions(actor).find(p => p.pokemon.id === pick.reserve);
    return option && pick.actor === actor.id ? { cursor: option.partyIndex, baton: false } : undefined;
  }
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
function optionsFor(pokemon: Actor): Option[] {
  return pokemon.getMoveset().flatMap((entry, slot) => {
    const move = entry.getMove();
    // Don't run random/variable targeting speculatively while browsing.
    if (move.moveTarget === MoveTarget.RANDOM_NEAR_ENEMY || move.hasAttr("VariableTargetAttr")
      || !pokemon.trySelectMove(slot)[0]) return [];
    const { targets, multiple } = getMoveTargets(pokemon, entry.moveId);
    // As in CommandPhase, a usable move with no legal target is still a fight command.
    return (multiple || !targets.length ? [targets] : targets.map(t => [t])).map(selected => ({
      pick: { actor: pokemon.id, slot, move: entry.moveId, target: multiple ? null : (selected[0] ?? null) },
      plan: { cursor: slot, targets: selected },
    }));
  });
}

export class PrivateFightPhase extends Phase {
  public readonly phaseName = "PrivateFightPhase";
  // Never change the cursor memory used for replaying ordinary shared input.
  public readonly cursors = { command: 0, move: 0 };
  public readonly bagCursors = { ball: 0, medicine: 0 };
  private actor: Actor;
  private localPicks: PrivateTurnPick[] = [];
  private choices: Option[];
  private submit: (pick: PrivateTurnPick | null) => void;
  public pausing = false;

  constructor(private readonly plans: Map<number, PlannedFight>, private readonly attempt = 0) { super(); }

  getPokemon(): Actor { return this.actor; }
  getFieldIndex(): number { return this.actor.getFieldIndex(); }

  chooseFieldAction(pick: PrivateFieldPick): boolean {
    if (pick.actor !== this.actor.id || !(pick.kind === "pass"
      ? CommandPhase.hasFieldOptions(this.actor.isEnemy()) : CommandPhase.canReposition(this.actor, pick.position))) return false;
    if (globalScene.uiInputs.privateFieldActionsEnabled || globalScene.twoPlayerEnemyPlayerMode) this.submit(pick);
    else this.confirmNormalMenus(UiMode.COMMAND);
    return true;
  }

  handleMedicineCommand(typeId: string, targetId: number, moveIndex?: number): boolean {
    if (!this.validMedicine(this.actor, typeId, targetId, moveIndex) || !this.canReserveMedicine(this.actor, typeId)) return false;
    this.submit({ kind: "medicine", actor: this.actor.id, typeId, targetId, ...(moveIndex !== undefined ? { moveIndex } : {}) });
    return true;
  }

  chooseBall(ball: number): boolean {
    if (!this.actor.isPlayer()) return false;
    const ui = globalScene.ui;
    if (this.localPicks.length && !this.canReserveBall(this.actor, ball, this.localPicks)) {
      ui.playError();
      return false;
    }
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
    if (!switchPlan(this.actor, pick) || this.localPicks.some(p => "kind" in p && p.kind === "switch" && p.reserve === reserve)) return false;
    this.submit(pick);
    return true;
  }

  private validMedicine(actor: Actor, typeId: string, targetId: number, moveIndex?: number) {
    return actor.isEnemy() ? moveIndex === undefined && new EnemyCommandPhase(actor.getFieldIndex()).canQueueMedicine(typeId, targetId)
      : CommandPhase.canQueueMedicine(actor.getFieldIndex(), typeId, targetId, moveIndex);
  }

  private canReservePick(actor: Actor, pick: PrivateTurnPick, previous: PrivateTurnPick[]): boolean {
    if (actor.id !== pick.actor) return false;
    if (!("kind" in pick)) return true;
    switch (pick.kind) {
      case "medicine": return this.canReserveMedicine(actor, pick.typeId, previous);
      case "switch": return !previous.some(p => "reserve" in p && p.reserve === pick.reserve);
      case "ball": return actor.isPlayer() && this.canReserveBall(actor, pick.ball, previous);
      default: return true;
    }
  }

  private canReserveBall(actor: PlayerPokemon, ball: number, previous: PrivateTurnPick[]): boolean {
    const owner = globalScene.getPlayerIndexForFieldSlot(actor.getFieldIndex());
    return previous.filter(p => "ball" in p && p.ball === ball).length < (globalScene.getPlayerPokeballCounts(owner)[ball] ?? 0);
  }

  private canReserveMedicine(actor: Actor, typeId: string, previous = this.localPicks): boolean {
    const scene = globalScene;
    const medicines = previous.filter(p => "kind" in p && p.kind === "medicine");
    if (actor.isEnemy()) {
      const trainer = scene.currentBattle.trainer;
      return !!trainer && !medicines.some(p => {
        const other = scene.getEnemyField().find(e => e.id === p.actor);
        return other && trainer.getMedicineOwner(other) === trainer.getMedicineOwner(actor);
      });
    }
    return medicines.filter(p => "typeId" in p && p.typeId === typeId).length
      < (scene.getPlayerBagMedicines(scene.getPlayerIndexForFieldSlot(actor.getFieldIndex())).find(p => p.typeId === typeId)?.quantity ?? 0);
  }

  canUseEnemyCommand(command: Command): boolean {
    return new EnemyCommandPhase(this.getFieldIndex()).canUseCommand(command)
      && (command !== Command.BALL || this.canReserveMedicine(this.actor, ""));
  }

  openEnemyParty(): void {
    const ui = globalScene.ui;
    void ui.setMode(UiMode.PARTY, PartyUiMode.ENEMY_SWITCH, this.getFieldIndex(), (index: number, option: PartyOption) => {
      const target = globalScene.getEnemyParty()[index];
      if (option !== PartyOption.SEND_OUT || !target || !this.chooseSwitch(target.id, false)) {
        void ui.setMode(UiMode.COMMAND, this.getFieldIndex());
      }
    });
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
    if (matches.length === 1 && matches[0].plan.targets.length <= 1) return confirm(matches[0]);

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
    const ep = scene.twoPlayerEnemyPlayerMode;
    const groups: Actor[][] = players.map(owner => active.filter(p => scene.getPlayerIndexForPokemon(p) === owner));
    if (ep) groups.push(scene.getEnemyField(true));
    const localSeat = seat === "ep" && ep ? players.length : typeof seat === "number" && players.includes(seat) ? seat : -1;
    const actors = groups.flat();
    const autoSkip = new Set(actors.filter(p => !ep && !scene.currentBattle.mysteryEncounter && p.isPlayer()
      && CommandPhase.shouldAutoSkipClearedVsModeLane(p)));
    if (localSeat < 0 || groups.some(group => !group.length || group.length > (ep ? 3 : 1))
      || (autoSkip.size && (!scene.uiInputs.privateFieldActionsEnabled || actors.length - autoSkip.size < 2))
      || actors.some(p => !autoSkip.has(p) && (
      p.getMoveQueue().length || p.isCommandingDondozo() || (p.isPlayer() && (CommandPhase.shouldAutoSelectFightMove(p) || scene.isEonFluteGuest(p)))
      || scene.currentBattle.turnCommands[p.getBattlerIndex()]?.skip))) {
      this.end();
      return;
    }
    const options = actors.map(p => autoSkip.has(p) ? [] : optionsFor(p));
    // Keep turn entry in sync with older clients, which only count moves with targets here.
    if (options.some((list, i) => !autoSkip.has(actors[i]) && !list.some(option => option.plan.targets.length))) {
      this.end();
      return;
    }
    const { waveIndex, turn } = scene.currentBattle;
    const battleSeed = scene.currentBattle.rocketHqFloor ? scene.waveSeed : scene.seed;
    const key = (ep ? "ep:" : "") + JSON.stringify([battleSeed, waveIndex, turn, ...actors.map(p => p.id), this.attempt]);
    scene.waitForSharedInput();
    applyWindowAppearance(seat === "ep" ? 4 : localSeat + 1);
    const ui = scene.ui;
    let locked = false;
    const current = () => !this.pausing && scene.phaseManager.getCurrentPhase() === this;
    this.localPicks = [];
    const localGroup = groups[localSeat];
    const showActor = () => {
      this.actor = localGroup[this.localPicks.length];
      this.choices = options[actors.indexOf(this.actor)];
      if (autoSkip.has(this.actor)) this.submit({ kind: "pass", actor: this.actor.id });
      else void ui.setMode(UiMode.COMMAND, this.getFieldIndex());
    };
    this.submit = async (pick: PrivateTurnPick | null) => {
      if (locked || !current()) return;
      locked = true;
      await ui.setMode(UiMode.MESSAGE);
      if (!current()) return;
      if (pick && ep) {
        this.localPicks.push(pick);
        if (this.localPicks.length < localGroup.length) {
          locked = false;
          showActor();
          return;
        }
      }
      ui.showText("Choice locked. Waiting for the other players...", 0);
      try {
        let prepared: PlannedFight[] = [];
        const review = (candidates: PrivateTurnPick[]) => {
          if (!current() || candidates.length !== actors.length) return false;
          const chosen = candidates.map((p, i): PlannedFight | undefined => {
            const actor = actors[i];
            if (p.actor !== actor.id) return;
            // The relay needs one pick per seat. Only a cleared lane may acknowledge without choosing.
            if (autoSkip.has(actor)) return "kind" in p && p.kind === "pass" ? p : undefined;
            if ("kind" in p) {
              if (p.kind === "pass" || p.kind === "reposition") {
                return (ep || scene.uiInputs.privateFieldActionsEnabled) && (p.kind === "pass"
                  ? CommandPhase.hasFieldOptions(actor.isEnemy()) : CommandPhase.canReposition(actor, p.position)) ? p : undefined;
              }
              if (p.kind === "switch") return switchPlan(actor, p);
              if (p.kind === "medicine") return this.validMedicine(actor, p.typeId, p.targetId, p.moveIndex) ? p : undefined;
              if (!actor.isPlayer()) return;
              const target = CommandPhase.getBallOptions(actor.getFieldIndex(), p.ball).targets.find(t => scene.getField()[t]?.id === p.targetId);
              return target === undefined ? undefined : { kind: "ball", ball: p.ball, target };
            }
            const plan = options[i].find(({ pick: legal }) => p.slot === legal.slot && p.move === legal.move && p.target === legal.target)?.plan;
            if (!plan || !plan.targets.length) return plan;
            const target = scene.getField()[plan.targets[0]];
            return target && !actor.getTargetRestrictingTag(p.move, target) ? plan : undefined;
          });
          // A peer cannot choose another player's actor or supply arbitrary battle commands.
          prepared = chosen.filter((plan): plan is PlannedFight => plan !== undefined);
          return prepared.length === actors.length;
        };
        const batch = ep ? await scene.uiInputs.submitPrivateEpFight(key, pick && this.localPicks, seats => {
          if (seats.length !== groups.length || !seats.every((picks, i) => picks.length === groups[i].length
            && picks.every((p, j) => this.canReservePick(groups[i][j], p, picks.slice(0, j))))) return false;
          return review(seats.flat());
        }) : await scene.uiInputs.submitPrivateFight(key, pick, review);
        if (!current()) return;
        if (batch) prepared.forEach((plan, i) => {
          if (!autoSkip.has(actors[i])) this.plans.set(actors[i].id, plan);
        });
        ui.clearText();
        applyWindowAppearance(5);
        scene.clearInputOwner();
        this.end();
      } catch {
        if (current()) ui.showText("Turn sync interrupted. Leave the lobby and resume together.", 0);
      }
    };
    scene.uiInputs.beginPrivateDraft(key, async (owner, openedAt) => {
      if (!current()) return;
      this.pausing = true;
      await ui.dismissPrivateDraft();
      if (scene.phaseManager.getCurrentPhase() !== this) return;
      this.plans.clear();
      scene.phaseManager.unshiftNew("PrivatePauseMenuPhase", owner, this.plans, this.attempt + 1, openedAt);
      this.end();
    });
    showActor();
  }
}

/** Ordinary synchronized menu input, with the opening seat as its sole owner. */
export class PrivatePauseMenuPhase extends Phase {
  readonly phaseName = "PrivatePauseMenuPhase";
  private closing = false;
  private readonly previousPlayer = globalScene.activePlayerIndex;
  constructor(private readonly owner: PlayerIndex | "ep", private readonly plans: Map<number, PlannedFight> | (() => void),
    private readonly nextAttempt: number, readonly openedAt: number) { super(); }

  override start(): void {
    if (this.owner === "ep") globalScene.waitForEnemyPlayerInput();
    else globalScene.waitForPlayerInput(this.owner);
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
