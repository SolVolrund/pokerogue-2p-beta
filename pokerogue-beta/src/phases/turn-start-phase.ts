import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { TurnCommand } from "#app/battle";
import { allMoves } from "#data/data-lists";
import { globalScene } from "#app/global-scene";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveTarget } from "#enums/move-target";
import { SwitchType } from "#enums/switch-type";
import type { Pokemon } from "#field/pokemon";
import { BypassSpeedChanceModifier } from "#modifiers/modifier";
import { PokemonMove } from "#moves/pokemon-move";
import { FieldPhase } from "#phases/field-phase";
import { randSeedInt } from "#utils/common";
import { areBattlerIndexesAllies, isEnemyBattlerIndex, isPlayerBattlerIndex } from "#utils/battler-index-utils";
import { inSpeedOrder } from "#utils/speed-order-generator";

type FieldPositionSnapshot = Map<BattlerIndex, FieldPosition>;

export class TurnStartPhase extends FieldPhase {
  public readonly phaseName = "TurnStartPhase";

  /**
   * Returns an ordering of the current field based on command priority
   * @returns The sequence of commands for this turn
   */
  private getCommandOrder(): BattlerIndex[] {
    const playerField = globalScene.getPlayerField(true).map(p => p.getBattlerIndex());
    const enemyField = globalScene.getEnemyField(true).map(p => p.getBattlerIndex());
    const orderedTargets: BattlerIndex[] = playerField.concat(enemyField);
    const shouldCoinTossBallOrder =
      globalScene.twoPlayerMode
      && playerField.length > 1
      && globalScene.currentBattle.turnCommands[playerField[0]]?.command === Command.BALL
      && globalScene.currentBattle.turnCommands[playerField[1]]?.command === Command.BALL;

    // The function begins sorting orderedTargets based on command priority, move priority, and possible speed bypasses.
    // Non-FIGHT commands (SWITCH, BALL, RUN) have a higher command priority and will always occur before any FIGHT commands.
    orderedTargets.sort((a, b) => {
      const aCommand = globalScene.currentBattle.turnCommands[a];
      const bCommand = globalScene.currentBattle.turnCommands[b];

      if (aCommand?.command !== bCommand?.command) {
        if (aCommand?.command === Command.FIGHT) {
          return 1;
        }
        if (bCommand?.command === Command.FIGHT) {
          return -1;
        }
      }

      const aIndex = orderedTargets.indexOf(a);
      const bIndex = orderedTargets.indexOf(b);

      return aIndex < bIndex ? -1 : aIndex > bIndex ? 1 : 0;
    });

    if (shouldCoinTossBallOrder && randSeedInt(2)) {
      const firstPlayerIndex = orderedTargets.indexOf(playerField[0]);
      const secondPlayerIndex = orderedTargets.indexOf(playerField[1]);
      [orderedTargets[firstPlayerIndex], orderedTargets[secondPlayerIndex]] = [
        orderedTargets[secondPlayerIndex],
        orderedTargets[firstPlayerIndex],
      ];
    }

    return orderedTargets;
  }

  // TODO: Refactor this alongside `CommandPhase.handleCommand` to use SEPARATE METHODS
  // Also need a clearer distinction between "turn command" and queued moves
  start() {
    super.start();

    const field = globalScene.getField();
    const moveOrder = this.getCommandOrder();
    const initialPositions = this.getFieldPositionSnapshot(field);
    const finalPositions = this.getPlannedFieldPositions(moveOrder, field, initialPositions);
    this.remapTurnTargetsToFinalPositions(initialPositions, finalPositions);

    for (const pokemon of inSpeedOrder(ArenaTagSide.BOTH)) {
      const preTurnCommand = globalScene.currentBattle.preTurnCommands[pokemon.getBattlerIndex()];

      if (preTurnCommand?.skip) {
        continue;
      }

      switch (preTurnCommand?.command) {
        case Command.TERA:
          globalScene.phaseManager.pushNew("TeraPhase", pokemon);
      }
    }

    const phaseManager = globalScene.phaseManager;
    for (const pokemon of inSpeedOrder(ArenaTagSide.BOTH)) {
      if (globalScene.currentBattle.turnCommands[pokemon.getBattlerIndex()]?.command !== Command.FIGHT) {
        continue;
      }

      applyAbAttrs("BypassSpeedChanceAbAttr", { pokemon });
      globalScene.applyModifiers(BypassSpeedChanceModifier, pokemon.isPlayer(), pokemon);
    }

    moveOrder.forEach((o, index) => {
      const pokemon = field[o];
      const turnCommand = globalScene.currentBattle.turnCommands[o];

      if (!turnCommand || turnCommand.skip) {
        return;
      }

      // TODO: Remove `turnData.order` -
      // it is used exclusively for Fusion Flare/Bolt
      // and uses a really jank (and incorrect) implementation
      if (turnCommand.command === Command.FIGHT) {
        pokemon.turnData.order = index;
      }
      this.handleTurnCommand(turnCommand, pokemon);
    });

    // Queue various effects for the end of the turn.
    phaseManager.pushNew("CheckInterludePhase");

    // TODO: Re-order these phases to be consistent with mainline turn order:
    // https://www.smogon.com/forums/threads/sword-shield-battle-mechanics-research.3655528/page-64#post-9244179

    // TODO: In an ideal world, this is handled by the phase manager. The change is nontrivial due to the ordering of post-turn phases like those queued by VictoryPhase
    globalScene.phaseManager.queueTurnEndPhases();

    /*
     * `this.end()` will call `PhaseManager#shiftPhase()`, which dumps everything from `phaseQueuePrepend`
     * (aka everything that is queued via `unshift()`) to the front of the queue and dequeues to start the next phase.
     * This is important since stuff like `SwitchSummonPhase`, `AttemptRunPhase`, and `AttemptCapturePhase` break the "flow" and should take precedence
     */
    this.end();
  }

  private handleTurnCommand(turnCommand: TurnCommand, pokemon: Pokemon) {
    switch (turnCommand?.command) {
      case Command.FIGHT:
        this.handleFightCommand(turnCommand, pokemon);
        break;
      case Command.BALL:
        globalScene.phaseManager.unshiftNew(
          "AttemptCapturePhase",
          globalScene.getFieldIndexForBattlerIndex(turnCommand.targets![0]),
          turnCommand.cursor!,
          turnCommand.playerIndex,
        ); //TODO: is the bang correct here?
        break;
      case Command.POKEMON:
        globalScene.phaseManager.unshiftNew(
          "SwitchSummonPhase",
          turnCommand.args?.[0] ? SwitchType.BATON_PASS : SwitchType.SWITCH,
          pokemon.getFieldIndex(),
          turnCommand.cursor!, // TODO: Is this bang correct?
          true,
          pokemon.isPlayer(),
        );
        break;
      case Command.REPOSITION:
        globalScene.phaseManager.unshiftNew(
          "RepositionPhase",
          pokemon.getBattlerIndex(),
          turnCommand.cursor as FieldPosition,
        );
        break;
      case Command.RUN:
        globalScene.phaseManager.unshiftNew("AttemptRunPhase");
        break;
    }
  }

  private handleFightCommand(turnCommand: TurnCommand, pokemon: Pokemon) {
    const queuedMove = turnCommand.move;
    if (!queuedMove) {
      return;
    }

    // TODO: This seems somewhat dubious
    const move =
      pokemon.getMoveset().find(m => m.moveId === queuedMove.move && m.ppUsed < m.getMovePp())
      ?? new PokemonMove(queuedMove.move);

    if (move.getMove().hasAttr("MoveHeaderAttr")) {
      globalScene.phaseManager.unshiftNew("MoveHeaderPhase", pokemon, move);
    }

    globalScene.phaseManager.pushNew(
      "MovePhase",
      pokemon,
      turnCommand.targets ?? queuedMove.targets,
      move,
      queuedMove.useMode,
    );
  }

  private getFieldPositionSnapshot(field: Pokemon[]): FieldPositionSnapshot {
    const snapshot: FieldPositionSnapshot = new Map();
    field.forEach((pokemon, battlerIndex) => {
      if (pokemon?.isActive(true)) {
        snapshot.set(battlerIndex as BattlerIndex, pokemon.fieldPosition);
      }
    });
    return snapshot;
  }

  private getPlannedFieldPositions(
    moveOrder: BattlerIndex[],
    field: Pokemon[],
    initialPositions: FieldPositionSnapshot,
  ): FieldPositionSnapshot {
    const plannedPositions: FieldPositionSnapshot = new Map(initialPositions);

    for (const battlerIndex of moveOrder) {
      const turnCommand = globalScene.currentBattle.turnCommands[battlerIndex];
      const pokemon = field[battlerIndex];
      if (!pokemon?.isActive(true) || turnCommand?.command !== Command.REPOSITION) {
        continue;
      }

      const targetPosition = turnCommand.cursor as FieldPosition;
      const previousPosition = plannedPositions.get(battlerIndex);
      if (previousPosition === undefined || previousPosition === targetPosition) {
        continue;
      }

      const swapBattler = this.findBattlerAtPlannedPosition(plannedPositions, targetPosition, battlerIndex);
      plannedPositions.set(battlerIndex, targetPosition);
      if (swapBattler !== undefined) {
        plannedPositions.set(swapBattler, previousPosition);
      }
    }

    return plannedPositions;
  }

  private findBattlerAtPlannedPosition(
    plannedPositions: FieldPositionSnapshot,
    position: FieldPosition,
    sourceBattler: BattlerIndex,
  ): BattlerIndex | undefined {
    for (const [battlerIndex, battlerPosition] of plannedPositions) {
      if (
        battlerIndex !== sourceBattler
        && battlerPosition === position
        && areBattlerIndexesAllies(battlerIndex, sourceBattler)
      ) {
        return battlerIndex;
      }
    }
  }

  private remapTurnTargetsToFinalPositions(
    initialPositions: FieldPositionSnapshot,
    finalPositions: FieldPositionSnapshot,
  ): void {
    for (const [battlerIndex, turnCommand] of Object.entries(globalScene.currentBattle.turnCommands)) {
      if (!turnCommand || turnCommand.command === Command.REPOSITION) {
        continue;
      }

      const userIndex = Number(battlerIndex) as BattlerIndex;
      if (turnCommand.command === Command.FIGHT && turnCommand.move) {
        const move = allMoves[turnCommand.move.move];
        if (move) {
          turnCommand.move.targets = this.remapTargetsToFinalPositions(
            turnCommand.move.targets,
            userIndex,
            move.moveTarget,
            initialPositions,
            finalPositions,
          );
          if (turnCommand.targets) {
            turnCommand.targets = this.remapTargetsToFinalPositions(
              turnCommand.targets,
              userIndex,
              move.moveTarget,
              initialPositions,
              finalPositions,
            );
          }
        }
      } else if (turnCommand.targets) {
        turnCommand.targets = this.remapTargetsToFinalPositions(
          turnCommand.targets,
          userIndex,
          undefined,
          initialPositions,
          finalPositions,
        );
      }
    }
  }

  private remapTargetsToFinalPositions(
    targets: BattlerIndex[],
    userIndex: BattlerIndex,
    moveTarget: MoveTarget | undefined,
    initialPositions: FieldPositionSnapshot,
    finalPositions: FieldPositionSnapshot,
  ): BattlerIndex[] {
    const remappedTargets = targets.map(target =>
      this.remapTargetToFinalPosition(target, userIndex, moveTarget, initialPositions, finalPositions),
    );
    return [...new Set(remappedTargets)];
  }

  private remapTargetToFinalPosition(
    target: BattlerIndex,
    userIndex: BattlerIndex,
    moveTarget: MoveTarget | undefined,
    initialPositions: FieldPositionSnapshot,
    finalPositions: FieldPositionSnapshot,
  ): BattlerIndex {
    if (
      target === userIndex
      || target < 0
      || !initialPositions.has(target)
      || !this.shouldRemapTargetByPosition(moveTarget)
    ) {
      return target;
    }

    return this.findBattlerAtInitialTargetPosition(target, initialPositions, finalPositions) ?? target;
  }

  private shouldRemapTargetByPosition(moveTarget: MoveTarget | undefined): boolean {
    switch (moveTarget) {
      case MoveTarget.USER:
      case MoveTarget.PARTY:
      case MoveTarget.USER_SIDE:
      case MoveTarget.ENEMY_SIDE:
      case MoveTarget.BOTH_SIDES:
        return false;
      default:
        return true;
    }
  }

  private findBattlerAtInitialTargetPosition(
    target: BattlerIndex,
    initialPositions: FieldPositionSnapshot,
    finalPositions: FieldPositionSnapshot,
  ): BattlerIndex | undefined {
    const targetPosition = initialPositions.get(target);
    if (targetPosition === undefined) {
      return;
    }

    for (const [battlerIndex, finalPosition] of finalPositions) {
      if (
        finalPosition === targetPosition
        && this.areBattlerIndexesOnSameSide(battlerIndex, target)
      ) {
        return battlerIndex;
      }
    }
  }

  private areBattlerIndexesOnSameSide(a: BattlerIndex, b: BattlerIndex): boolean {
    return (
      (isPlayerBattlerIndex(a) && isPlayerBattlerIndex(b))
      || (isEnemyBattlerIndex(a) && isEnemyBattlerIndex(b))
    );
  }
}
