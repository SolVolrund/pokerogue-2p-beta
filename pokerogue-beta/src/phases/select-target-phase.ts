import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { PokemonPhase } from "#phases/pokemon-phase";

export class SelectTargetPhase extends PokemonPhase {
  public readonly phaseName = "SelectTargetPhase";
  private explicitTargets: BattlerIndex[] | undefined;

  // biome-ignore lint/complexity/noUselessConstructor: This makes `fieldIndex` required
  constructor(fieldIndex: number, explicitTargets?: BattlerIndex[]) {
    super(fieldIndex);
    this.explicitTargets = explicitTargets;
  }

  start() {
    super.start();

    const turnCommand = globalScene.currentBattle.turnCommands[this.fieldIndex];
    if (!turnCommand) {
      this.end();
      return;
    }

    const moveId = turnCommand.move?.move;
    if (!moveId && !this.explicitTargets?.length) {
      this.end();
      return;
    }

    // TODO: Move the logic for computing default targets here instead of `target-select-ui-handler`
    const move = moveId ? allMoves[moveId] : undefined;
    const fieldSide = globalScene.getField();

    const user = fieldSide[this.fieldIndex];
    const ally = user.getAlly();
    const shouldDefaultToAlly =
      globalScene.currentBattle.double // formatting
      && !!move?.allyTargetDefault
      && ally != null
      && !ally.isFainted();
    const defaultTargets = shouldDefaultToAlly ? [ally.getBattlerIndex()] : undefined;

    globalScene.ui.setMode(
      UiMode.TARGET_SELECT,
      this.fieldIndex,
      move?.id ?? MoveId.NONE,
      (targets: BattlerIndex[]) => {
        globalScene.ui.setMode(UiMode.MESSAGE);
        // Find any tags blocking this target from being selected
        // TODO: Denest and make less jank

        // TODO: when would this occur?
        if (moveId && targets[0]) {
          const restrictingTag = user.getTargetRestrictingTag(moveId, fieldSide[targets[0]]);
          if (restrictingTag) {
            globalScene.phaseManager.queueMessage(restrictingTag.selectionDeniedText(user, moveId));
            targets = [];
          }
        }

        if (targets.length === 0) {
          globalScene.currentBattle.turnCommands[this.fieldIndex] = null;
          globalScene.phaseManager.unshiftNew("CommandPhase", this.fieldIndex);
        } else {
          turnCommand.targets = targets;
        }
        if (turnCommand.command === Command.BALL && this.fieldIndex && !globalScene.twoPlayerMode) {
          globalScene.currentBattle.turnCommands[this.fieldIndex - 1]!.skip = true;
        }
        this.end();
      },
      defaultTargets,
      this.explicitTargets,
    );
  }
}
