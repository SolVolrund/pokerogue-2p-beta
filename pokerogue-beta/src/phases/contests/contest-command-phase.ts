import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { chooseContestAiMove } from "#data/contests/contest-ai";
import { playContestTurnNotification } from "#data/contests/contest-audio";
import type { ContestParticipant, ContestParticipantId, ContestState } from "#data/contests/contest-state";
import { MoveId } from "#enums/move-id";
import { clearContestInputMode, setContestInputMode } from "#ui/contest-input-ui-handler";
import { getContestPlayerMoves, getContestUi } from "#ui/contest-ui";
import { updateWindowType } from "#ui/ui-theme";
import { ContestPhase } from "./contest-phase";

const CONTEST_COMMAND_INPUT_DELAY_MS = 750;

export class ContestCommandPhase extends ContestPhase {
  public readonly phaseName = "ContestCommandPhase";
  private readonly contestantId: ContestParticipantId;
  private contestant: ContestParticipant | undefined;
  private playerMoves: readonly MoveId[] = [];
  private selectionIndex = 0;
  private complete = false;
  private playerIndex: PlayerIndex | undefined;

  constructor(contestState: ContestState, contestantId: ContestParticipantId) {
    super(contestState);
    this.contestantId = contestantId;
  }

  start(): void {
    super.start();

    this.contestant = this.contestState.getContestant(this.contestantId);
    this.contestState.currentCommandContestantId = this.contestantId;
    this.showContestUi();
    playContestTurnNotification();

    this.playerIndex = this.contestant.pokemon
      ? globalScene.getPlayerIndexForPokemon(this.contestant.pokemon)
      : undefined;

    if (!this.contestant.pokemon || isComputerPartnerContestant(this.playerIndex)) {
      this.contestState.queueMove(this.contestant.id, chooseContestAiMove(this.contestant, this.contestState));
      this.queueAppealPhase();
      this.end();
      return;
    }

    if (this.playerIndex !== undefined) {
      globalScene.waitForPlayerInput(this.playerIndex);
      updateWindowType(this.playerIndex + 1);
    }

    this.playerMoves = getContestPlayerMoves(this.contestState);
    this.selectionIndex = 0;
    getContestUi().setCommandSelection(this.selectionIndex, this.contestState);
    setContestInputMode({
      inputDelayMs: CONTEST_COMMAND_INPUT_DELAY_MS,
      onMoveSelection: delta => this.moveSelection(delta),
      onConfirm: () => this.confirmSelection(),
    });
  }

  override end(): void {
    clearContestInputMode();
    if (this.contestState.currentCommandContestantId === this.contestantId) {
      this.contestState.currentCommandContestantId = undefined;
    }
    super.end();
  }

  private moveSelection(delta: number): boolean {
    if (this.complete) {
      return false;
    }

    this.selectionIndex = wrapMoveSelection(this.selectionIndex + delta, this.playerMoves.length);
    getContestUi().setCommandSelection(this.selectionIndex, this.contestState);
    return true;
  }

  private confirmSelection(): boolean {
    if (!this.contestant || this.complete) {
      return false;
    }

    this.complete = true;
    this.contestState.queueMove(
      this.contestant.id,
      this.playerMoves[wrapMoveSelection(this.selectionIndex, this.playerMoves.length)] ?? MoveId.TACKLE,
    );
    this.queueAppealPhase();
    this.end();
    return true;
  }

  private queueAppealPhase(): void {
    globalScene.phaseManager.unshiftNew("ContestAppealPhase", this.contestState, this.contestantId);
  }
}

function wrapMoveSelection(selectionIndex: number, moveCount: number): number {
  if (moveCount <= 0) {
    return 0;
  }

  return ((selectionIndex % moveCount) + moveCount) % moveCount;
}

function isComputerPartnerContestant(playerIndex: PlayerIndex | undefined): boolean {
  return playerIndex !== undefined && globalScene.isComputerPartnerPlayer(playerIndex);
}
