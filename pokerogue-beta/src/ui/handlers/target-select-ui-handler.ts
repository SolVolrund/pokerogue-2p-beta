import { globalScene } from "#app/global-scene";
import { SubstituteTag } from "#data/battler-tags";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { FieldPosition } from "#enums/field-position";
import type { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import type { Pokemon } from "#field/pokemon";
import type { ModifierBar } from "#modifiers/modifier";
import { getMoveTargets } from "#moves/move-utils";
import { UiHandler } from "#ui/ui-handler";
import { fixedInt } from "#utils/common";
import { isEnemyBattlerIndex, isPlayerBattlerIndex } from "#utils/battler-index-utils";

export type TargetSelectCallback = (targets: BattlerIndex[]) => void;

export class TargetSelectUiHandler extends UiHandler {
  private fieldIndex: number;
  private move: MoveId;
  private targetSelectCallback: TargetSelectCallback;
  private cursor0: number; // associated with BattlerIndex.PLAYER
  private cursor1: number; // associated with BattlerIndex.PLAYER_2
  private cursor2: number; // associated with BattlerIndex.PLAYER_3

  private isMultipleTargets = false;
  private targets: BattlerIndex[];
  private targetsHighlighted: Pokemon[];
  private targetFlashTween: Phaser.Tweens.Tween | null;
  private enemyModifiers: ModifierBar;
  private targetBattleInfoMoveTween: Phaser.Tweens.Tween[] = [];

  constructor() {
    super(UiMode.TARGET_SELECT);

    this.cursor = -1;
  }

  setup(): void {}

  show(
    args: [
      fieldIndex: number,
      moveId: MoveId,
      callback: TargetSelectCallback,
      defaultTargets?: BattlerIndex[],
      explicitTargets?: BattlerIndex[],
    ],
  ): boolean {
    if (args.length < 3) {
      return false;
    }

    super.show(args);

    [this.fieldIndex, this.move, this.targetSelectCallback] = args;
    const user = globalScene.getPlayerField()[this.fieldIndex];

    const explicitTargets = args[4];
    if (explicitTargets?.length) {
      this.targets = explicitTargets.filter(target => globalScene.getField()[target]?.isActive(true));
      this.isMultipleTargets = false;
    } else {
      const moveTargets = getMoveTargets(user, this.move);
      this.targets = moveTargets.targets;
      this.isMultipleTargets = moveTargets.multiple;
    }

    if (this.targets.length === 0) {
      return false;
    }

    this.enemyModifiers = globalScene.getModifierBar(true);

    // If default targets are specified, use them instead
    // TODO: This logic should emphatically _not_ be done inside a UI handler
    const defaultTargets = args[3];
    if (defaultTargets && defaultTargets.length > 0 && this.targets.includes(defaultTargets[0])) {
      this.setCursor(defaultTargets[0]);
      return true;
    }

    if (this.fieldIndex === 0) {
      this.resetCursor(this.cursor0, user);
    } else if (this.fieldIndex === 1) {
      this.resetCursor(this.cursor1, user);
    } else if (this.fieldIndex === 2) {
      this.resetCursor(this.cursor2, user);
    }
    return true;
  }

  /**
   * Determines what value to assign the main cursor based on the previous turn's target or the user's status
   * @param cursorN the cursor associated with the user's field index
   * @param user the Pokemon using the move
   */
  resetCursor(cursorN: number, user: Pokemon): void {
    if (
      cursorN != null
      && (isPlayerBattlerIndex(cursorN) || user.tempSummonData.waveTurnCount === 1)
    ) {
      // Reset cursor on the first turn of a fight or if an ally was targeted last turn
      cursorN = -1;
    }
    this.setCursor(this.targets.includes(cursorN) ? cursorN : this.targets[0]);
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    if (button === Button.ACTION || button === Button.CANCEL) {
      const targetIndexes: BattlerIndex[] = this.isMultipleTargets ? this.targets : [this.cursor];
      this.targetSelectCallback(button === Button.ACTION ? targetIndexes : []);
      success = true;
      if (this.fieldIndex === 0) {
        if (this.cursor0 == null || this.cursor0 !== this.cursor) {
          this.cursor0 = this.cursor;
        }
      } else if (this.fieldIndex === 1 && (this.cursor1 == null || this.cursor1 !== this.cursor)) {
        this.cursor1 = this.cursor;
      } else if (this.fieldIndex === 2 && (this.cursor2 == null || this.cursor2 !== this.cursor)) {
        this.cursor2 = this.cursor;
      }
    } else if (this.isMultipleTargets) {
      success = false;
    } else if ((globalScene.currentBattle?.getBattlerCount() ?? 1) > 2) {
      success = this.processTripleTargetInput(button);
    } else {
      switch (button) {
        case Button.UP:
          if (isPlayerBattlerIndex(this.cursor) && this.targets.findIndex(t => isEnemyBattlerIndex(t)) > -1) {
            success = this.setCursor(this.targets.find(t => isEnemyBattlerIndex(t))!); // TODO: is the bang correct here?
          }
          break;
        case Button.DOWN:
          if (isEnemyBattlerIndex(this.cursor) && this.targets.findIndex(t => isPlayerBattlerIndex(t)) > -1) {
            success = this.setCursor(this.targets.find(t => isPlayerBattlerIndex(t))!); // TODO: is the bang correct here?
          }
          break;
        case Button.LEFT:
          if (this.cursor % 2 && this.targets.findIndex(t => t === this.cursor - 1) > -1) {
            success = this.setCursor(this.cursor - 1);
          }
          break;
        case Button.RIGHT:
          if (!(this.cursor % 2) && this.targets.findIndex(t => t === this.cursor + 1) > -1) {
            success = this.setCursor(this.cursor + 1);
          }
          break;
      }
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  private processTripleTargetInput(button: Button): boolean {
    const nextCursor = this.getNextTripleTargetCursor(button);
    return nextCursor !== undefined ? this.setCursor(nextCursor) : false;
  }

  private getNextTripleTargetCursor(button: Button): BattlerIndex | undefined {
    const cursorPosition = getTripleTargetPosition(this.cursor);
    if (!cursorPosition) {
      return;
    }

    let candidates = this.targets
      .filter(target => target !== this.cursor)
      .map(target => ({ target, position: getTripleTargetPosition(target) }))
      .filter((candidate): candidate is { target: BattlerIndex; position: TripleTargetPosition } => !!candidate.position);

    switch (button) {
      case Button.UP:
        candidates = candidates.filter(candidate => candidate.position.row < cursorPosition.row);
        break;
      case Button.DOWN:
        candidates = candidates.filter(candidate => candidate.position.row > cursorPosition.row);
        break;
      case Button.LEFT:
        candidates = candidates.filter(
          candidate => candidate.position.row === cursorPosition.row && candidate.position.column < cursorPosition.column,
        );
        break;
      case Button.RIGHT:
        candidates = candidates.filter(
          candidate => candidate.position.row === cursorPosition.row && candidate.position.column > cursorPosition.column,
        );
        break;
      default:
        return;
    }

    candidates.sort((a, b) => {
      const aDistance = getTripleTargetDistance(cursorPosition, a.position);
      const bDistance = getTripleTargetDistance(cursorPosition, b.position);
      if (aDistance !== bDistance) {
        return aDistance - bDistance;
      }

      return Math.abs(a.position.column - cursorPosition.column) - Math.abs(b.position.column - cursorPosition.column);
    });

    return candidates[0]?.target;
  }

  setCursor(cursor: number): boolean {
    const singleTarget = globalScene.getField()[cursor];
    const multipleTargets = this.targets.map(index => globalScene.getField()[index]);

    this.targetsHighlighted = this.isMultipleTargets ? multipleTargets : [singleTarget];

    const ret = super.setCursor(cursor);

    if (this.targetFlashTween) {
      this.targetFlashTween.stop();
      for (const pokemon of multipleTargets) {
        pokemon.setAlpha(pokemon.getTag(SubstituteTag) ? 0.5 : 1);
        this.highlightItems(pokemon.id, 1);
      }
    }

    this.targetFlashTween = globalScene.tweens.add({
      targets: this.targetsHighlighted,
      key: { start: 1, to: 0.25 },
      loop: -1,
      loopDelay: 150,
      duration: fixedInt(450),
      ease: "Sine.easeInOut",
      yoyo: true,
      onUpdate: t => {
        for (const target of this.targetsHighlighted) {
          target.setAlpha(t.getValue() ?? 1);
          this.highlightItems(target.id, t.getValue() ?? 1);
        }
      },
    });

    if (this.targetBattleInfoMoveTween.length > 0) {
      this.targetBattleInfoMoveTween.filter(t => t !== undefined).forEach(tween => tween.stop());
      for (const pokemon of multipleTargets) {
        pokemon.getBattleInfo().resetY();
      }
    }

    const targetsBattleInfo = this.targetsHighlighted.map(target => target.getBattleInfo());

    targetsBattleInfo.map(info => {
      this.targetBattleInfoMoveTween.push(
        globalScene.tweens.add({
          targets: [info],
          y: { start: info.getBaseY(), to: info.getBaseY() + 1 },
          loop: -1,
          duration: fixedInt(250),
          ease: "Linear",
          yoyo: true,
        }),
      );
    });
    return ret;
  }

  eraseCursor() {
    if (this.targetFlashTween) {
      this.targetFlashTween.stop();
      this.targetFlashTween = null;
    }

    for (const pokemon of this.targetsHighlighted) {
      pokemon.setAlpha(pokemon.getTag(SubstituteTag) ? 0.5 : 1);
      this.highlightItems(pokemon.id, 1);
    }

    if (this.targetBattleInfoMoveTween.length > 0) {
      this.targetBattleInfoMoveTween.filter(t => t !== undefined).forEach(tween => tween.stop());
      this.targetBattleInfoMoveTween = [];
    }
    for (const pokemon of this.targetsHighlighted) {
      pokemon.getBattleInfo().resetY();
    }
  }

  private highlightItems(targetId: number, val: number): void {
    const targetItems = this.enemyModifiers.getAll("name", targetId.toString());
    for (const item of targetItems as Phaser.GameObjects.Container[]) {
      item.setAlpha(val);
    }
  }

  clear() {
    super.clear();
    this.eraseCursor();
  }
}

interface TripleTargetPosition {
  row: number;
  column: number;
}

function getTripleTargetPosition(target: number): TripleTargetPosition | undefined {
  const pokemon = globalScene.getField()[target];
  if (pokemon && (globalScene.currentBattle?.getBattlerCount() ?? 1) > 2) {
    const shinyBadgePosition = getShinyBadgeDuelTargetPosition(pokemon);
    if (shinyBadgePosition) {
      return shinyBadgePosition;
    }

    const row = pokemon.isEnemy() ? 0 : 1;
    switch (pokemon.fieldPosition) {
      case FieldPosition.LEFT:
        return { row, column: 0 };
      case FieldPosition.CENTER:
        return { row, column: 1 };
      case FieldPosition.RIGHT:
        return { row, column: 2 };
    }
  }

  switch (target) {
    case BattlerIndex.ENEMY:
      return { row: 0, column: 0 };
    case BattlerIndex.ENEMY_3:
      return { row: 0, column: 1 };
    case BattlerIndex.ENEMY_2:
      return { row: 0, column: 2 };
    case BattlerIndex.PLAYER:
      return { row: 1, column: 0 };
    case BattlerIndex.PLAYER_3:
      return { row: 1, column: 1 };
    case BattlerIndex.PLAYER_2:
      return { row: 1, column: 2 };
  }
}

function getShinyBadgeDuelTargetPosition(pokemon: Pokemon): TripleTargetPosition | undefined {
  const misc = globalScene.currentBattle?.mysteryEncounter?.misc;
  if (!pokemon.isPlayer() || !misc?.shinyBadgeDuelActive || !Array.isArray(misc.shinyBadgeDuelPlayerIndexes)) {
    return;
  }

  const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon);
  if (playerIndex == null || !misc.shinyBadgeDuelPlayerIndexes.includes(playerIndex)) {
    return;
  }

  if (globalScene.isMysteryEncounterEnemySidePlayer(playerIndex)) {
    return { row: 0, column: 1 };
  }

  const lowerPlayers = globalScene
    .getPlayerFieldOwners()
    .filter(
      lowerPlayerIndex =>
        misc.shinyBadgeDuelPlayerIndexes.includes(lowerPlayerIndex)
        && !globalScene.isMysteryEncounterEnemySidePlayer(lowerPlayerIndex),
    );
  const lowerIndex = lowerPlayers.indexOf(playerIndex);

  return { row: 1, column: lowerIndex === 0 ? 0 : 2 };
}

function getTripleTargetDistance(from: TripleTargetPosition, to: TripleTargetPosition): number {
  return Math.abs(from.row - to.row) * 10 + Math.abs(from.column - to.column);
}
