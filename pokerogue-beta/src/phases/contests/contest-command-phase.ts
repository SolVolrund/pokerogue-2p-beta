import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { playContestTurnNotification } from "#data/contests/contest-audio";
import { getContestSpectacularMove } from "#data/contests/contest-spectacular-moves";
import type { ContestParticipant, ContestParticipantId, ContestState } from "#data/contests/contest-state";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { getContestPlayerMoves, getContestUi } from "#ui/contest-ui";
import { updateWindowType } from "#ui/ui-theme";
import { ContestPhase } from "./contest-phase";

const FALLBACK_CONTEST_MOVES = [MoveId.TACKLE, MoveId.GROWL, MoveId.TAIL_WHIP, MoveId.QUICK_ATTACK] as const;

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
      this.contestState.queueMove(this.contestant.id, selectContestMove(this.contestant, this.contestState.round));
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
    globalScene.inputController.events.on("input_down", this.handleInput, this);
  }

  override end(): void {
    globalScene.inputController.events.off("input_down", this.handleInput, this);
    if (this.contestState.currentCommandContestantId === this.contestantId) {
      this.contestState.currentCommandContestantId = undefined;
    }
    super.end();
  }

  private handleInput(input: { button: Button }): void {
    if (this.complete) {
      return;
    }

    switch (input.button) {
      case Button.UP:
      case Button.LEFT:
        this.moveSelection(-1);
        return;
      case Button.DOWN:
      case Button.RIGHT:
        this.moveSelection(1);
        return;
      case Button.ACTION:
        this.confirmSelection();
        return;
      default:
        return;
    }
  }

  private moveSelection(delta: number): void {
    this.selectionIndex = wrapMoveSelection(this.selectionIndex + delta, this.playerMoves.length);
    getContestUi().setCommandSelection(this.selectionIndex, this.contestState);
  }

  private confirmSelection(): void {
    if (!this.contestant) {
      return;
    }

    this.complete = true;
    this.contestState.queueMove(
      this.contestant.id,
      this.playerMoves[wrapMoveSelection(this.selectionIndex, this.playerMoves.length)] ?? MoveId.TACKLE,
    );
    this.queueAppealPhase();
    this.end();
  }

  private queueAppealPhase(): void {
    globalScene.phaseManager.unshiftNew("ContestAppealPhase", this.contestState, this.contestantId);
  }
}

function selectContestMove(contestant: ContestParticipant, round: number): MoveId {
  if (contestant.contestMoves && contestant.contestMoves.length > 0) {
    return contestant.contestMoves[(round - 1) % contestant.contestMoves.length] ?? contestant.contestMoves[0];
  }

  const moveset = contestant.pokemon
    ?.getMoveset()
    .map(move => move.moveId)
    .filter(moveId => moveId !== MoveId.NONE && getContestSpectacularMove(moveId));

  if (moveset && moveset.length > 0) {
    return moveset[(round - 1) % moveset.length] ?? moveset[0];
  }

  return FALLBACK_CONTEST_MOVES[(round - 1) % FALLBACK_CONTEST_MOVES.length] ?? MoveId.TACKLE;
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
