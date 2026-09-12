import type { TurnCommand } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { BattleType } from "#enums/battle-type";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { isIgnorePP, MoveUseMode } from "#enums/move-use-mode";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import { FieldPhase } from "#phases/field-phase";
import type { MoveTargetSet } from "#types/move-target-set";
import type { TurnMove } from "#types/turn-move";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import { shouldAiRepositionToCenter } from "#utils/ai-targeting";
import { getPlannerRepositionTarget, getPlannerSwitchIndex } from "#utils/battle-planner-ai";
import { isMysteryEncounterSwitchProtectedPokemon } from "#utils/mystery-encounter-switch-protection";
import { getZMoveForPokemonMove, shouldSpendZMoveForTurnMove } from "#utils/z-move-utils";

/**
 * Phase for determining an enemy AI's action for the next turn.
 * During this phase, the enemy decides whether to switch (if it has a trainer)
 * or to use a move from its moveset.
 *
 * For more information on how the Enemy AI works, see docs/enemy-ai.md
 * @see {@linkcode Pokemon.getMatchupScore}
 * @see {@linkcode EnemyPokemon.getNextMove}
 */
export class EnemyCommandPhase extends FieldPhase {
  public readonly phaseName = "EnemyCommandPhase";
  protected fieldIndex: number;
  protected skipTurn = false;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
    if (globalScene.currentBattle.mysteryEncounter?.skipEnemyBattleTurns) {
      this.skipTurn = true;
    }
  }

  private getBattlerIndex(): number {
    return globalScene.getEnemyBattlerIndex(this.fieldIndex);
  }

  start() {
    super.start();

    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];

    const battle = globalScene.currentBattle;

    const trainer = battle.trainer;

    if (
      battle.double
      && enemyPokemon.hasAbility(AbilityId.COMMANDER)
      && enemyPokemon.isCommandingDondozo()
    ) {
      this.skipTurn = true;
    }

    if (this.shouldAskEnemyPlayerForCommand(enemyPokemon)) {
      this.showEnemyPlayerCommandMenu();
      return;
    }

    if (!globalScene.twoPlayerVsMode && !this.skipTurn && shouldAiRepositionToCenter(enemyPokemon)) {
      battle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
        command: Command.REPOSITION,
        cursor: FieldPosition.CENTER,
        skip: this.skipTurn,
      };

      return this.end();
    }

    const usePlannerAi = globalScene.plannerAiEnabled && enemyPokemon.aiType === AiType.PLANNER;
    if (!globalScene.twoPlayerVsMode && !this.skipTurn && usePlannerAi) {
      const allyAlreadyRepositioning = globalScene.getEnemyField().some((fieldPokemon, fieldIndex) => {
        if (fieldPokemon === enemyPokemon) {
          return false;
        }

        return battle.turnCommands[globalScene.getEnemyBattlerIndex(fieldIndex)]?.command === Command.REPOSITION;
      });
      const repositionTarget = getPlannerRepositionTarget(enemyPokemon, allyAlreadyRepositioning);
      if (repositionTarget !== undefined) {
        battle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
          command: Command.REPOSITION,
          cursor: repositionTarget,
          skip: this.skipTurn,
        };

        return this.end();
      }
    }

    /**
     * If the enemy has a trainer, decide whether or not the enemy should switch
     * to another member in its party.
     *
     * This block compares the active enemy Pokemon's {@linkcode Pokemon.getMatchupScore | matchup score}
     * against the active player Pokemon with the enemy party's other non-fainted Pokemon. If a party
     * member's matchup score is 3x the active enemy's score (or 2x for "boss" trainers),
     * the enemy will switch to that Pokemon.
     */
    if (
      trainer
      && !globalScene.twoPlayerVsMode
      && enemyPokemon.getMoveQueue().length === 0
      && !isMysteryEncounterSwitchProtectedPokemon(enemyPokemon)
    ) {
      const opponents = enemyPokemon.getOpponents();

      if (!enemyPokemon.isTrapped()) {
        const partyMemberScores = trainer.getPartyMemberMatchupScores(enemyPokemon.trainerSlot, true, enemyPokemon);

        if (partyMemberScores.length > 0) {
          const matchupScores = opponents.map(opp => enemyPokemon.getMatchupScore(opp));
          const matchupScore = matchupScores.reduce((total, score) => (total += score), 0) / matchupScores.length;

          const sortedPartyMemberScores = trainer.getSortedPartyMemberMatchupScores(partyMemberScores);

          const switchMultiplier = 1 - (battle.enemySwitchCounter ? Math.pow(0.1, 1 / battle.enemySwitchCounter) : 0);
          const usePlannerSwitch = usePlannerAi;
          const reservedSwitchIndexes = new Set<number>();
          globalScene.getEnemyField().forEach((fieldPokemon, fieldIndex) => {
            const turnCommand = battle.turnCommands[globalScene.getEnemyBattlerIndex(fieldIndex)];
            if (
              fieldPokemon !== enemyPokemon
              && turnCommand?.command === Command.POKEMON
              && typeof turnCommand.cursor === "number"
            ) {
              reservedSwitchIndexes.add(turnCommand.cursor);
            }
          });
          const allyAlreadySwitching = reservedSwitchIndexes.size > 0;

          const plannerSwitchIndex = usePlannerSwitch
            ? getPlannerSwitchIndex(
                enemyPokemon,
                partyMemberScores,
                switchMultiplier,
                trainer.config.isBoss,
                allyAlreadySwitching,
                reservedSwitchIndexes,
              )
            : undefined;
          const legacyShouldSwitch =
            !usePlannerSwitch
            && sortedPartyMemberScores[0][1] * switchMultiplier >= matchupScore * (trainer.config.isBoss ? 2 : 3);

          if (plannerSwitchIndex !== undefined || legacyShouldSwitch) {
            const index =
              plannerSwitchIndex ?? trainer.getNextSummonIndex(enemyPokemon.trainerSlot, partyMemberScores, enemyPokemon);

            battle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
              command: Command.POKEMON,
              cursor: index,
              args: [false],
              skip: this.skipTurn,
            };

            battle.enemySwitchCounter++;

            return this.end();
          }
        }
      }
    }

    /** Select a move to use (and a target to use it against, if applicable) */
    let nextMove = enemyPokemon.getNextMove();

    if (this.shouldTera(enemyPokemon)) {
      globalScene.currentBattle.preTurnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
        command: Command.TERA,
      };
    } else {
      nextMove = this.upgradeEnemyZMove(enemyPokemon, nextMove);
    }

    globalScene.currentBattle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
      command: Command.FIGHT,
      move: nextMove,
      skip: this.skipTurn || nextMove.move === MoveId.NONE,
    };

    globalScene.currentBattle.enemySwitchCounter = Math.max(globalScene.currentBattle.enemySwitchCounter - 1, 0);

    this.end();
  }

  private shouldAskEnemyPlayerForCommand(enemyPokemon: EnemyPokemon): boolean {
    return (
      globalScene.twoPlayerEnemyPlayerMode
      && !this.skipTurn
      && enemyPokemon.isActive(true)
      && enemyPokemon.getMoveQueue().length === 0
    );
  }

  private showEnemyPlayerCommandMenu(): void {
    globalScene.waitForEnemyPlayerInput();
    globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
  }

  public canUseCommand(command: Command): boolean {
    switch (command) {
      case Command.FIGHT:
        return true;
      case Command.POKEMON:
        return this.canInspectTrainerParty(this.getPokemon());
      default:
        return false;
    }
  }

  public handleCommand(command: Command, cursor: number, _useMode?: MoveUseMode): boolean {
    const enemyPokemon = this.getPokemon();

    switch (command) {
      case Command.FIGHT:
        return this.handleEnemyPlayerFightCommand(enemyPokemon, cursor, _useMode ?? MoveUseMode.NORMAL);
      case Command.POKEMON:
        if (!this.canUseCommand(Command.POKEMON)) {
          return false;
        }
        this.showEnemyPlayerSwitchSelect(enemyPokemon);
        return true;
      default:
        return false;
    }
  }

  public getFieldIndex(): number {
    return this.fieldIndex;
  }

  public getPokemon(): EnemyPokemon {
    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];
    if (!enemyPokemon) {
      throw new Error(`No enemy Pokemon found for field slot ${this.fieldIndex}`);
    }

    return enemyPokemon;
  }

  private showEnemyPlayerSwitchSelect(enemyPokemon: EnemyPokemon): void {
    globalScene.ui.setMode(
      UiMode.PARTY,
      PartyUiMode.ENEMY_SWITCH,
      this.fieldIndex,
      (partyIndex: number, option: PartyOption) => {
        if (option === PartyOption.CANCEL) {
          globalScene.waitForEnemyPlayerInput();
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
          return;
        }

        if (partyIndex < 0) {
          globalScene.waitForEnemyPlayerInput();
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
          return;
        }

        this.queueEnemyPlayerSwitchCommand(partyIndex);
      },
    );
  }

  private getSwitchOptions(enemyPokemon: EnemyPokemon): Array<{ pokemon: EnemyPokemon; partyIndex: number }> {
    const trainer = globalScene.currentBattle.trainer;
    if (!trainer || enemyPokemon.isTrapped() || isMysteryEncounterSwitchProtectedPokemon(enemyPokemon)) {
      return [];
    }

    const battlerCount = globalScene.currentBattle.getBattlerCount();
    return globalScene.getEnemyParty()
      .map((pokemon, partyIndex) => ({ pokemon, partyIndex }))
      .filter(({ pokemon, partyIndex }) => (
        partyIndex >= battlerCount
        && pokemon.trainerSlot === enemyPokemon.trainerSlot
        && pokemon.isAllowedInBattle()
      ));
  }

  private canInspectTrainerParty(enemyPokemon: EnemyPokemon): boolean {
    return (
      !!globalScene.currentBattle.trainer
      && globalScene.getEnemyParty().some(pokemon => pokemon.trainerSlot === enemyPokemon.trainerSlot)
    );
  }

  private queueEnemyPlayerSwitchCommand(partyIndex: number): void {
    globalScene.currentBattle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
      command: Command.POKEMON,
      cursor: partyIndex,
      args: [false],
      skip: this.skipTurn,
    };
    globalScene.currentBattle.enemySwitchCounter++;
    this.end();
  }

  private queueFightErrorMessage(msg: string): void {
    const ui = globalScene.ui;
    ui.setMode(UiMode.MESSAGE);
    ui.showText(
      msg,
      null,
      () => {
        ui.clearText();
        globalScene.waitForEnemyPlayerInput();
        ui.setMode(UiMode.FIGHT, this.fieldIndex);
      },
      null,
      true,
    );
  }

  private handleEnemyPlayerFightCommand(
    enemyPokemon: EnemyPokemon,
    moveIndex: number,
    useMode: MoveUseMode = MoveUseMode.NORMAL,
  ): boolean {
    const ignorePP = isIgnorePP(useMode);
    const [canUse, reason] = moveIndex === -1 ? [true, ""] : enemyPokemon.trySelectMove(moveIndex, ignorePP);
    const useStruggle = canUse
      ? false
      : moveIndex > -1 && !enemyPokemon.getMoveset().some(move => move.isUsable(enemyPokemon, ignorePP, true)[0]);

    if (!canUse && !useStruggle) {
      this.queueFightErrorMessage(reason);
      return false;
    }

    const selectedMove = moveIndex > -1 ? enemyPokemon.getMoveset()[moveIndex] : undefined;
    const moveId = useStruggle ? MoveId.STRUGGLE : (selectedMove?.moveId ?? MoveId.NONE);
    const turnCommand: TurnCommand = {
      command: Command.FIGHT,
      cursor: moveIndex,
      move: {
        move: moveId,
        targets: [],
        useMode,
      },
    };

    if (moveId === MoveId.NONE) {
      turnCommand.targets = [this.getBattlerIndex()];
      turnCommand.skip = true;
      this.finalizeEnemyPlayerFightCommand(enemyPokemon, turnCommand);
      return true;
    }

    const moveTargets = getMoveTargets(enemyPokemon, moveId);
    if (turnCommand.move && (moveTargets.targets.length <= 1 || moveTargets.multiple)) {
      turnCommand.move.targets = moveTargets.targets;
    } else if (
      turnCommand.move
      && enemyPokemon.getTag(BattlerTagType.CHARGING)
      && enemyPokemon.getMoveQueue().length > 0
    ) {
      turnCommand.move.targets = enemyPokemon.getMoveQueue()[0].targets;
    } else {
      this.showEnemyPlayerTargetSelect(enemyPokemon, turnCommand, moveTargets);
      return true;
    }

    this.finalizeEnemyPlayerFightCommand(enemyPokemon, turnCommand);
    return true;
  }

  private showEnemyPlayerTargetSelect(
    enemyPokemon: EnemyPokemon,
    turnCommand: TurnCommand,
    moveTargets: MoveTargetSet,
  ): void {
    globalScene.waitForEnemyPlayerInput();
    globalScene.ui.setMode(
      UiMode.TARGET_SELECT,
      this.fieldIndex,
      turnCommand.move?.move ?? MoveId.NONE,
      (targets: BattlerIndex[]) => {
        globalScene.ui.setMode(UiMode.MESSAGE);

        if (turnCommand.move && targets[0]) {
          const target = globalScene.getField()[targets[0]];
          const restrictingTag = target
            ? enemyPokemon.getTargetRestrictingTag(turnCommand.move.move, target)
            : undefined;
          if (restrictingTag) {
            globalScene.phaseManager.queueMessage(restrictingTag.selectionDeniedText(enemyPokemon, turnCommand.move.move));
            targets = [];
          }
        }

        if (targets.length === 0) {
          globalScene.currentBattle.turnCommands[this.getBattlerIndex()] = null;
          globalScene.waitForEnemyPlayerInput();
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
          return;
        }

        if (turnCommand.move) {
          turnCommand.move.targets = targets;
        }
        this.finalizeEnemyPlayerFightCommand(enemyPokemon, turnCommand);
      },
      undefined,
      moveTargets.targets,
      enemyPokemon,
    );
  }

  private finalizeEnemyPlayerFightCommand(enemyPokemon: EnemyPokemon, turnCommand: TurnCommand): void {
    if (this.shouldTera(enemyPokemon)) {
      globalScene.currentBattle.preTurnCommands[this.getBattlerIndex()] = {
        command: Command.TERA,
      };
    } else if (turnCommand.move) {
      turnCommand.move = this.upgradeEnemyZMove(enemyPokemon, turnCommand.move);
    }

    if (turnCommand.move) {
      turnCommand.skip = turnCommand.skip || turnCommand.move.move === MoveId.NONE;
    }

    globalScene.currentBattle.turnCommands[this.getBattlerIndex()] = turnCommand;
    globalScene.currentBattle.enemySwitchCounter = Math.max(globalScene.currentBattle.enemySwitchCounter - 1, 0);
    this.end();
  }

  private shouldTera(pokemon: EnemyPokemon): boolean {
    const trainer = globalScene.currentBattle.trainer;
    if (!trainer?.shouldTera(pokemon)) {
      return false;
    }

    return globalScene.currentBattle.reserveEnemyTrainerSlotTera(trainer.getTeraUsageTrainerSlot(pokemon));
  }

  private upgradeEnemyZMove(pokemon: EnemyPokemon, turnMove: TurnMove): TurnMove {
    const trainer = globalScene.currentBattle.trainer;
    if (
      globalScene.currentBattle.battleType !== BattleType.TRAINER
      || !trainer
      || turnMove.move === MoveId.NONE
      || turnMove.useMode !== MoveUseMode.NORMAL
    ) {
      return turnMove;
    }

    const zMoveUsageTrainerSlot = trainer.getTeraUsageTrainerSlot(pokemon);
    if (globalScene.currentBattle.hasEnemyTrainerSlotUsedZMove(zMoveUsageTrainerSlot)) {
      return turnMove;
    }

    const sourceMove = pokemon.getMoveset().find(move => move.moveId === turnMove.move);
    const zMoveSelection = sourceMove ? getZMoveForPokemonMove(pokemon, sourceMove, true) : undefined;
    if (!zMoveSelection || !shouldSpendZMoveForTurnMove(pokemon, turnMove, zMoveSelection)) {
      return turnMove;
    }

    const targets = this.resolveTargetsForMove(pokemon, zMoveSelection.moveId, turnMove.targets);
    if (targets.length === 0) {
      return turnMove;
    }

    const zTurnMove: TurnMove = {
      ...turnMove,
      move: zMoveSelection.moveId,
      targets,
    };

    if (!shouldSpendZMoveForTurnMove(pokemon, zTurnMove, zMoveSelection)) {
      return turnMove;
    }

    if (!globalScene.currentBattle.reserveEnemyTrainerSlotZMove(zMoveUsageTrainerSlot)) {
      return turnMove;
    }

    globalScene.currentBattle.preTurnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
      command: Command.Z_MOVE,
    };

    return {
      ...zTurnMove,
      zMove: {
        sourceMove: zMoveSelection.sourceMoveId,
        ...(zMoveSelection.power === undefined ? {} : { power: zMoveSelection.power }),
      },
    };
  }

  private resolveTargetsForMove(
    pokemon: EnemyPokemon,
    moveId: MoveId,
    preferredTargets: readonly BattlerIndex[] = [],
  ): BattlerIndex[] {
    const moveTargets = getMoveTargets(pokemon, moveId);
    if (moveTargets.multiple || moveTargets.targets.length <= 1) {
      return moveTargets.targets;
    }

    const preferredTarget = preferredTargets.find(target => moveTargets.targets.includes(target));
    return preferredTarget === undefined ? [] : [preferredTarget];
  }

  override end(): void {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}
