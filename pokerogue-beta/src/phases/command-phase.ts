import type { TurnCommand } from "#app/battle";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { getPokemonNameWithAffix } from "#app/messages";
import { TrappedTag } from "#data/battler-tags";
import { getDailyEventSeedBoss } from "#data/daily-seed/daily-run";
import { isDailyFinalBoss } from "#data/daily-seed/daily-seed-utils";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { isIgnorePP, isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { PokeballType } from "#enums/pokeball";
import { UiMode } from "#enums/ui-mode";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import { getMoveTargets } from "#moves/move-utils";
import { FieldPhase } from "#phases/field-phase";
import type { MoveTargetSet } from "#types/move-target-set";
import type { TurnMove } from "#types/turn-move";
import { getComputerPartnerImprovedSwitchIndex, isComputerPartnerFieldIndex } from "#utils/computer-partner-ai";
import {
  getComputerPartnerCaptureDecision,
  isComputerPartnerMoveSafeForCaptureTarget,
} from "#utils/computer-partner-capture-ai";
import i18next from "i18next";

const CAPTURE_CLAIM_BALL_TYPES = [
  PokeballType.POKEBALL,
  PokeballType.GREAT_BALL,
  PokeballType.ULTRA_BALL,
  PokeballType.ROGUE_BALL,
  PokeballType.MASTER_BALL,
] as const;

export class CommandPhase extends FieldPhase {
  public readonly phaseName = "CommandPhase";
  protected fieldIndex: number;

  /**
   * Whether the command phase is handling a switch command
   */
  private isSwitch = false;

  constructor(fieldIndex: number) {
    super();

    this.fieldIndex = fieldIndex;
  }

  private getBattlerIndex(): number {
    return globalScene.getPlayerBattlerIndex(this.fieldIndex);
  }

  private getPreviousFieldBattlerIndex(): number {
    return globalScene.getPlayerBattlerIndex(this.fieldIndex - 1);
  }

  private getTurnCommand(): TurnCommand | null {
    return globalScene.currentBattle.turnCommands[this.getBattlerIndex()];
  }

  private setTurnCommand(command: TurnCommand | null): void {
    globalScene.currentBattle.turnCommands[this.getBattlerIndex()] = command;
  }

  private setPreTurnCommand(command: TurnCommand | null): void {
    globalScene.currentBattle.preTurnCommands[this.getBattlerIndex()] = command;
  }

  private setActiveCommandPlayer(): void {
    if (!globalScene.twoPlayerMode) {
      return;
    }

    if (this.isComputerPartnerCommand()) {
      return;
    }

    const playerIndex = globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
    globalScene.waitForPlayerInput(playerIndex);
  }

  private isComputerPartnerCommand(): boolean {
    return isComputerPartnerFieldIndex(this.fieldIndex);
  }

  private shouldComputerPartnerSwitch(): number | undefined {
    const playerPokemon = this.getPokemon();

    if (playerPokemon.getMoveQueue().length > 0 || playerPokemon.isTrapped()) {
      return undefined;
    }

    const switchMultiplier =
      1
      - (globalScene.currentBattle.computerPartnerSwitchCounter
        ? Math.pow(0.1, 1 / globalScene.currentBattle.computerPartnerSwitchCounter)
        : 0);

    return getComputerPartnerImprovedSwitchIndex(this.fieldIndex, switchMultiplier);
  }

  private handleComputerPartnerCaptureCommand(playerPokemon: PlayerPokemon): boolean {
    if (!this.canComputerPartnerCaptureInCurrentBattle()) {
      return false;
    }

    const playerIndex = globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
    if (this.shouldSkipComputerPartnerCaptureCommand(playerIndex)) {
      return false;
    }

    const blockedTargetIds = this.getComputerPartnerBlockedCaptureTargetIds(playerIndex);
    const claimedTargetIds = this.getComputerPartnerClaimedCaptureTargetIds(playerIndex);
    const captureDecision = getComputerPartnerCaptureDecision(
      globalScene.getComputerPartnerKey(playerIndex),
      globalScene.getPlayerParty(playerIndex),
      playerPokemon,
      globalScene.getEnemyField(),
      globalScene.getPlayerPokeballCounts(playerIndex),
      blockedTargetIds,
      globalScene.getComputerPartnerRolePreferences(playerIndex),
      claimedTargetIds.length > 0
        ? {
          allowedBossTargetIds: claimedTargetIds,
          forceThrowTargetIds: claimedTargetIds,
          preferredTargetIds: claimedTargetIds,
        }
        : undefined,
    );

    if (!captureDecision) {
      return false;
    }

    if (captureDecision.shouldThrow) {
      this.setTurnCommand({
        command: Command.BALL,
        cursor: captureDecision.ballType,
        playerIndex,
        targets: [captureDecision.target.getBattlerIndex()],
      });
      this.end();
      return true;
    }

    if (captureDecision.weakeningMoveIndex !== undefined) {
      const weakeningMove = playerPokemon.getMoveset()[captureDecision.weakeningMoveIndex];
      if (weakeningMove && !weakeningMove.isOutOfPp()) {
        this.setTurnCommand({
          command: Command.FIGHT,
          cursor: captureDecision.weakeningMoveIndex,
          move: {
            move: weakeningMove.moveId,
            targets: [captureDecision.target.getBattlerIndex()],
            useMode: MoveUseMode.NORMAL,
          },
        });
        this.end();
        return true;
      }
    }

    return false;
  }

  private canComputerPartnerCaptureInCurrentBattle(): boolean {
    const battle = globalScene.currentBattle;
    if (battle.battleType === BattleType.WILD) {
      return true;
    }

    return (
      battle.isBattleMysteryEncounter()
      && !!battle.mysteryEncounter?.catchAllowed
      && battle.mysteryEncounter.encounterMode !== MysteryEncounterMode.TRAINER_BATTLE
    );
  }

  private shouldSkipComputerPartnerCaptureCommand(playerIndex: PlayerIndex): boolean {
    const battle = globalScene.currentBattle;
    if (battle.battleType === BattleType.WILD && battle.computerPartnerWildCaptureDisabled) {
      return true;
    }

    return !this.hasUsableCaptureBall(playerIndex);
  }

  private getComputerPartnerClaimedCaptureTargetIds(playerIndex: PlayerIndex): number[] {
    return globalScene.currentBattle.computerPartnerCaptureClaims
      .filter(claim => claim.playerIndex === playerIndex)
      .map(claim => claim.targetId);
  }

  private hasUsableCaptureBall(playerIndex: PlayerIndex): boolean {
    const pokeballCounts = globalScene.getPlayerPokeballCounts(playerIndex);
    return CAPTURE_CLAIM_BALL_TYPES.some(ballType => (pokeballCounts[ballType] ?? 0) > 0);
  }

  private getComputerPartnerBlockedCaptureTargetIds(playerIndex: PlayerIndex): number[] {
    const battle = globalScene.currentBattle;
    const activeTargetIds = new Set(globalScene.getEnemyField().filter(pokemon =>
      pokemon.isActive(true) && !pokemon.isFainted(),
    ).map(pokemon => pokemon.id));

    battle.computerPartnerCaptureClaims = battle.computerPartnerCaptureClaims.filter(claim =>
      activeTargetIds.has(claim.targetId),
    );

    if (battle.computerPartnerCaptureClaims.length > 0) {
      return [...new Set(
        battle.computerPartnerCaptureClaims
          .filter(claim => claim.playerIndex !== playerIndex && this.hasUsableCaptureBall(claim.playerIndex))
          .map(claim => claim.targetId),
      )];
    }

    const reservedTargetIds =
      battle.computerPartnerReservedCaptureTargetIds.length > 0
        ? battle.computerPartnerReservedCaptureTargetIds
        : battle.computerPartnerReservedCaptureTargetId === undefined
          ? []
          : [battle.computerPartnerReservedCaptureTargetId];
    if (reservedTargetIds.length === 0) {
      return [];
    }

    const activeReservedTargetIds = reservedTargetIds.filter(targetId => activeTargetIds.has(targetId));
    battle.computerPartnerReservedCaptureTargetIds = activeReservedTargetIds;
    battle.computerPartnerReservedCaptureTargetId = activeReservedTargetIds[0];
    return activeReservedTargetIds;
  }

  private getComputerPartnerBlockedCaptureTargets(playerIndex: PlayerIndex): EnemyPokemon[] {
    const blockedTargetIds = new Set(this.getComputerPartnerBlockedCaptureTargetIds(playerIndex));
    if (blockedTargetIds.size === 0) {
      return [];
    }

    return globalScene.getEnemyField().filter(pokemon => blockedTargetIds.has(pokemon.id));
  }

  private isUnsafeForReservedCaptureTarget(
    playerPokemon: PlayerPokemon,
    turnMove: TurnMove,
    reservedTargets: EnemyPokemon[],
  ): boolean {
    const unsafeTargets = reservedTargets.filter(reservedTarget =>
      turnMove.targets.includes(reservedTarget.getBattlerIndex()),
    );
    if (unsafeTargets.length === 0) {
      return false;
    }

    const pokemonMove = playerPokemon.getMoveset().find(move => move.moveId === turnMove.move);
    if (!pokemonMove) {
      return false;
    }

    return unsafeTargets.some(reservedTarget =>
      !isComputerPartnerMoveSafeForCaptureTarget(playerPokemon, reservedTarget, pokemonMove.getMove()),
    );
  }

  private getReservedCaptureSafeMove(playerPokemon: PlayerPokemon, reservedTargets: EnemyPokemon[]): TurnMove | undefined {
    const enemyBattlerIndexes = new Set(globalScene.getEnemyField().map(pokemon => pokemon.getBattlerIndex()));
    const reservedBattlerIndexes = new Set(reservedTargets.map(pokemon => pokemon.getBattlerIndex()));

    for (const pokemonMove of playerPokemon.getMoveset()) {
      if (pokemonMove.isOutOfPp()) {
        continue;
      }

      const targets = playerPokemon.getNextTargets(pokemonMove.moveId);
      const targetsOnlyEnemies = targets.length > 0 && targets.every(target => enemyBattlerIndexes.has(target));
      const turnMove: TurnMove = {
        move: pokemonMove.moveId,
        targets,
        useMode: MoveUseMode.NORMAL,
      };
      if (targetsOnlyEnemies && !this.isUnsafeForReservedCaptureTarget(playerPokemon, turnMove, reservedTargets)) {
        return turnMove;
      }

      const targetSet = getMoveTargets(playerPokemon, pokemonMove.moveId);
      if (targetSet.multiple) {
        continue;
      }

      const fallbackTarget = targetSet.targets.find(
        target => !reservedBattlerIndexes.has(target) && enemyBattlerIndexes.has(target),
      );
      if (fallbackTarget !== undefined) {
        return {
          move: pokemonMove.moveId,
          targets: [fallbackTarget],
          useMode: MoveUseMode.NORMAL,
        };
      }
    }

    return undefined;
  }

  private protectReservedCaptureTargets(playerIndex: PlayerIndex, playerPokemon: PlayerPokemon, turnMove: TurnMove): TurnMove {
    const reservedTargets = this.getComputerPartnerBlockedCaptureTargets(playerIndex);
    if (
      reservedTargets.length === 0
      || !this.isUnsafeForReservedCaptureTarget(playerPokemon, turnMove, reservedTargets)
    ) {
      return turnMove;
    }

    return this.getReservedCaptureSafeMove(playerPokemon, reservedTargets) ?? {
      move: MoveId.NONE,
      targets: [],
      useMode: MoveUseMode.NORMAL,
    };
  }

  private handleComputerPartnerCommand(): boolean {
    const playerPokemon = this.getPokemon();
    const playerIndex = globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
    const previousAiType = playerPokemon.aiType;

    if (this.handleComputerPartnerCaptureCommand(playerPokemon)) {
      return true;
    }

    const switchIndex = this.shouldComputerPartnerSwitch();

    if (switchIndex !== undefined) {
      this.setTurnCommand({
        command: Command.POKEMON,
        cursor: switchIndex,
        args: [false],
      });
      globalScene.currentBattle.computerPartnerSwitchCounter++;
      this.end();
      return true;
    }

    playerPokemon.aiType = AiType.SMART;
    globalScene.aiCommandInProgress = true;
    try {
      const nextMove = this.protectReservedCaptureTargets(playerIndex, playerPokemon, playerPokemon.getNextMove());
      this.setTurnCommand({
        command: Command.FIGHT,
        move: nextMove,
        skip: nextMove.move === MoveId.NONE,
      });
    } finally {
      playerPokemon.aiType = previousAiType;
      globalScene.aiCommandInProgress = false;
    }

    globalScene.currentBattle.computerPartnerSwitchCounter = Math.max(
      globalScene.currentBattle.computerPartnerSwitchCounter - 1,
      0,
    );

    this.end();
    return true;
  }

  /**
   * Resets the cursor to the position of {@linkcode Command.FIGHT} if any of the following are true
   * - The setting to remember the last action is not enabled
   * - This is the first turn of a mystery encounter, trainer battle, or the END biome
   * - The cursor is currently on the POKEMON command
   */
  private resetCursorIfNeeded(): void {
    const commandUiHandler = globalScene.ui.handlers[UiMode.COMMAND];
    const { arena, commandCursorMemory, currentBattle } = globalScene;
    const { battleType, turn } = currentBattle;
    const { biomeId } = arena;

    // If one of these conditions is true, we always reset the cursor to Command.FIGHT
    const cursorResetEvent =
      battleType === BattleType.MYSTERY_ENCOUNTER || battleType === BattleType.TRAINER || biomeId === BiomeId.END;

    if (!commandUiHandler) {
      return;
    }
    if (
      (turn === 1 && (!commandCursorMemory || cursorResetEvent))
      || commandUiHandler.getCursor() === Command.POKEMON
    ) {
      commandUiHandler.setCursor(Command.FIGHT);
    }
  }

  /**
   * Submethod of {@linkcode start} that validates field index logic for nonzero field indices.
   * Must only be called if the field index is nonzero.
   */
  private handleFieldIndexLogic(): void {
    // If we somehow are attempting to check the right pokemon but there's only one pokemon out
    // Switch back to the center pokemon. This can happen rarely in double battles with mid turn switching
    // TODO: Prevent this from happening in the first place
    if (globalScene.getPlayerField().filter(p => p.isActive()).length === 1) {
      this.fieldIndex = FieldPosition.CENTER;
      return;
    }

    const allyCommand = globalScene.currentBattle.turnCommands[this.getPreviousFieldBattlerIndex()];
    if (allyCommand?.command === Command.RUN || (!globalScene.twoPlayerMode && allyCommand?.command === Command.BALL)) {
      this.setTurnCommand({
        command: allyCommand?.command,
        skip: true,
      });
    }
  }

  /**
   * Submethod of {@linkcode start} that sets the turn command to skip if this pokemon
   * is commanding its ally via {@linkcode AbilityId.COMMANDER}.
   */
  private checkCommander(): void {
    // If the Pokemon has applied Commander's effects to its ally, skip this command
    if (
      globalScene.currentBattle?.double
      && this.getPokemon().getAlly()?.getTag(BattlerTagType.COMMANDED)?.getSourcePokemon() === this.getPokemon()
    ) {
      this.setTurnCommand({
        command: Command.FIGHT,
        move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
        skip: true,
      });
    }
  }

  /**
   * Clear out all unusable moves in front of the currently acting pokemon's move queue.
   */
  // TODO: Refactor move queue handling to ensure that this method is not necessary.
  private clearUnusableMoves(): void {
    const playerPokemon = this.getPokemon();
    const moveQueue = playerPokemon.getMoveQueue();
    if (moveQueue.length === 0) {
      return;
    }

    let entriesToDelete = 0;
    const moveset = playerPokemon.getMoveset();
    for (const queuedMove of moveQueue) {
      const movesetQueuedMove = moveset.find(m => m.moveId === queuedMove.move);
      if (
        queuedMove.move !== MoveId.NONE
        && !isVirtual(queuedMove.useMode)
        && !(movesetQueuedMove?.isUsable(playerPokemon, isIgnorePP(queuedMove.useMode), true)?.[0] ?? false)
      ) {
        entriesToDelete++;
      } else {
        break;
      }
    }
    if (entriesToDelete) {
      moveQueue.splice(0, entriesToDelete);
    }
  }

  /**
   * Attempt to execute the first usable move in this Pokemon's move queue
   * @returns Whether a queued move was successfully set to be executed.
   */
  private tryExecuteQueuedMove(): boolean {
    this.clearUnusableMoves();
    const playerPokemon = globalScene.getPlayerField()[this.fieldIndex];
    const moveQueue = playerPokemon.getMoveQueue();

    if (moveQueue.length === 0) {
      return false;
    }

    const queuedMove = moveQueue[0];
    if (queuedMove.move === MoveId.NONE) {
      this.handleCommand(Command.FIGHT, -1);
      return true;
    }
    const moveIndex = playerPokemon.getMoveset().findIndex(m => m.moveId === queuedMove.move);
    if (!isVirtual(queuedMove.useMode) && moveIndex === -1) {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    } else {
      this.handleCommand(Command.FIGHT, moveIndex, queuedMove.useMode, queuedMove);
    }

    return true;
  }

  public override start(): void {
    super.start();

    this.setActiveCommandPlayer();
    globalScene.updateGameInfo();
    this.resetCursorIfNeeded();

    if (this.fieldIndex) {
      this.handleFieldIndexLogic();
    }

    this.checkCommander();

    if (this.getTurnCommand()?.skip) {
      this.end();
      return;
    }

    if (this.tryExecuteQueuedMove()) {
      return;
    }

    if (this.isComputerPartnerCommand() && this.handleComputerPartnerCommand()) {
      return;
    }

    if (
      globalScene.currentBattle.isBattleMysteryEncounter()
      && globalScene.currentBattle.mysteryEncounter?.skipToFightInput
    ) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.FIGHT, this.fieldIndex);
    } else {
      globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    }
  }

  /**
   * Submethod of {@linkcode handleFightCommand} responsible for queuing the provided error message when the move cannot be used
   * @param msg - The reason why the move cannot be used
   */
  private queueFightErrorMessage(msg: string): void {
    const ui = globalScene.ui;
    ui.setMode(UiMode.MESSAGE);
    ui.showText(
      msg,
      null,
      () => {
        ui.clearText();
        ui.setMode(UiMode.FIGHT, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleFightCommand} that returns the moveID for the phase
   * based on the move passed in or the cursor.
   *
   * Does not check if the move is usable or not, that should be handled by the caller.
   */
  private computeMoveId(playerPokemon: PlayerPokemon, cursor: number, move: TurnMove | undefined): MoveId {
    return move?.move ?? (cursor > -1 ? playerPokemon.getMoveset()[cursor]?.moveId : MoveId.NONE);
  }

  /**
   * Process the logic for executing a fight-related command
   *
   * @remarks
   * - Validates whether the move can be used, using struggle if not
   * - Constructs the turn command and inserts it into the battle's turn commands
   *
   * @param command - The command to handle (FIGHT or TERA)
   * @param cursor - The index that the cursor is placed on, or -1 if no move can be selected.
   * @param ignorePP - Whether to ignore PP when checking if the move can be used.
   * @param move - The move to force the command to use, if any.
   */
  private handleFightCommand(
    command: Command.FIGHT | Command.TERA,
    cursor: number,
    useMode: MoveUseMode = MoveUseMode.NORMAL,
    move?: TurnMove,
  ): boolean {
    const playerPokemon = this.getPokemon();
    const ignorePP = isIgnorePP(useMode);
    const [canUse, reason] = cursor === -1 ? [true, ""] : playerPokemon.trySelectMove(cursor, ignorePP);

    // Ternary here ensures we don't compute struggle conditions unless necessary
    const useStruggle = canUse
      ? false
      : cursor > -1 && !playerPokemon.getMoveset().some(m => m.isUsable(playerPokemon, ignorePP, true)[0]);

    if (!canUse && !useStruggle) {
      this.queueFightErrorMessage(reason);
      return false;
    }

    const moveId = useStruggle ? MoveId.STRUGGLE : this.computeMoveId(playerPokemon, cursor, move);

    const turnCommand: TurnCommand = {
      command: Command.FIGHT,
      cursor,
      move: { move: moveId, targets: [], useMode },
      args: [useMode, move],
    };
    const preTurnCommand: TurnCommand = {
      command,
      targets: [this.getBattlerIndex()],
      skip: command === Command.FIGHT,
    };

    const moveTargets: MoveTargetSet =
      move === undefined
        ? getMoveTargets(playerPokemon, moveId)
        : {
            targets: move.targets,
            multiple: move.targets.length > 1,
          };

    if (moveId === MoveId.NONE) {
      turnCommand.targets = [this.getBattlerIndex()];
    }

    console.log(
      "Move:",
      MoveId[moveId],
      "Move targets:",
      moveTargets,
      "\nPlayer Pokemon:",
      getPokemonNameWithAffix(playerPokemon),
    );

    if (moveTargets.targets.length > 1 && moveTargets.multiple) {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
    }

    if (turnCommand.move && (moveTargets.targets.length <= 1 || moveTargets.multiple)) {
      turnCommand.move.targets = moveTargets.targets;
    } else if (
      turnCommand.move
      && playerPokemon.getTag(BattlerTagType.CHARGING)
      && playerPokemon.getMoveQueue().length > 0
    ) {
      turnCommand.move.targets = playerPokemon.getMoveQueue()[0].targets;
    } else {
      globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex);
    }

    this.setPreTurnCommand(preTurnCommand);
    this.setTurnCommand(turnCommand);

    return true;
  }

  /**
   * Set the mode in preparation to show the text, and then show the text.
   * Only works for parameterless i18next keys.
   * @param key - The i18next key for the text to show
   */
  private queueShowText(key: string): void {
    globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
    globalScene.ui.setMode(UiMode.MESSAGE);

    globalScene.ui.showText(
      i18next.t(key),
      null,
      () => {
        globalScene.ui.showText("", 0);
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
      },
      null,
      true,
    );
  }

  /**
   * Helper method for {@linkcode handleBallCommand} that checks if a pokeball can be thrown
   * and displays the appropriate error message.
   *
   * @remarks
   * The pokeball may not be thrown if any of the following are true:
   * - It is a trainer battle
   * - The player is in the {@linkcode BiomeId.END | End} biome and
   *   - it is not classic mode; or
   *   - the player has not caught the target before and the player is still missing more than one starter
   * - The player is in a mystery encounter that disallows catching the pokemon
   * @returns Whether a pokeball can be thrown
   */
  private checkCanUseBall(): boolean {
    const { arena, currentBattle, gameData, gameMode } = globalScene;
    const { battleType } = currentBattle;
    const { biomeId } = arena;
    const { isClassic, isEndless, isDaily } = gameMode;
    const { dexData } = gameData;

    const isClassicFinalBoss = gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex);
    const isEndlessMinorBoss = gameMode.isEndlessMinorBoss(globalScene.currentBattle.waveIndex);
    const isFullFreshStart = gameMode.isFullFreshStartChallenge();
    const someUncaughtSpeciesOnField = globalScene
      .getEnemyField()
      .some(p => p.isActive() && !dexData[p.species.speciesId].caughtAttr);
    const missingMultipleStarters =
      gameData.getStarterCount(d => !!d.caughtAttr) < speciesDataRegistry.getAllStarters().length - 1;
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

    if (biomeId === BiomeId.END && battleType === BattleType.WILD) {
      if (
        (isClassic && !isClassicFinalBoss && someUncaughtSpeciesOnField)
        || (isFullFreshStart && !isClassicFinalBoss)
        || (isEndless && !isEndlessMinorBoss)
      ) {
        // Uncatchable paradox mons in classic and endless
        this.queueShowText("battle:noPokeballForce");
      } else if (
        (isClassic && isClassicFinalBoss && missingMultipleStarters)
        || (isFullFreshStart && isClassicFinalBoss)
        || (isEndless && isEndlessMinorBoss)
        || (isDaily && !isCatchableDailyBoss)
      ) {
        // Uncatchable final boss in classic, endless and daily
        this.queueShowText("battle:noPokeballForceFinalBoss");
      } else {
        return true;
      }
    } else if (battleType === BattleType.TRAINER) {
      this.queueShowText("battle:noPokeballTrainer");
    } else if (currentBattle.isBattleMysteryEncounter() && !currentBattle.mysteryEncounter!.catchAllowed) {
      this.queueShowText("battle:noPokeballMysteryEncounter");
    } else {
      return true;
    }

    return false;
  }

  /**
   * Checks whether the selected ball can be thrown at a specific target.
   * @param targetPokemon - The Pokemon being targeted by the ball
   * @param pokeballType - The selected ball type
   * @returns The locale key for the denial message, or `undefined` when the target is valid
   */
  private getBallTargetBlockMessage(targetPokemon: EnemyPokemon, pokeballType: PokeballType): string | undefined {
    const isChallengeActive = globalScene.gameMode.hasAnyChallenges();
    const isFinalBoss = globalScene.gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex);
    const isCatchableDailyBoss = isDailyFinalBoss() && (getDailyEventSeedBoss()?.catchable ?? false);

    if (
      !targetPokemon.isBoss()
      || targetPokemon.bossSegmentIndex < 1 // TODO: Decouple this hardcoded exception for wonder guard and just check the target...
      || targetPokemon.hasAbility(AbilityId.WONDER_GUARD, false, true)
    ) {
      return undefined;
    }

    // When facing the final boss, it must be weakened unless a Master Ball is used AND no challenges are active.
    // The message is customized for the final boss.
    if (
      isFinalBoss
      && (pokeballType < PokeballType.MASTER_BALL
        || (pokeballType === PokeballType.MASTER_BALL && isChallengeActive))
    ) {
      return "battle:noPokeballForceFinalBossCatchable";
    }

    // When facing any other boss, Master Ball can always be used, and we use the standard message.
    if (isCatchableDailyBoss || pokeballType < PokeballType.MASTER_BALL) {
      return "battle:noPokeballStrong";
    }

    return undefined;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is to use a pokeball.
   *
   * @param cursor - The index of the pokeball to use
   * @returns Whether the command was successfully initiated
   */
  private handleBallCommand(cursor: number): boolean {
    const targets = globalScene
      .getEnemyField()
      .filter(p => p.isActive(true))
      .map(p => p.getBattlerIndex());

    if (!this.checkCanUseBall()) {
      return false;
    }

    if (targets.length > 1 && !globalScene.twoPlayerMode) {
      this.queueShowText("battle:noPokeballMulti");
      return false;
    }

    const numBallTypes = 5;
    if (cursor < numBallTypes) {
      const validTargets = targets.filter(target => {
        const targetPokemon = globalScene.getField()[target] as EnemyPokemon | undefined;
        return targetPokemon && !this.getBallTargetBlockMessage(targetPokemon, cursor);
      });

      if (validTargets.length === 0) {
        const firstTarget = targets
          .map(target => globalScene.getField()[target] as EnemyPokemon | undefined)
          .find(targetPokemon => !!targetPokemon);
        this.queueShowText(
          firstTarget
            ? this.getBallTargetBlockMessage(firstTarget, cursor) ?? "battle:noPokeballStrong"
            : "battle:noPokeballStrong",
        );
        return false;
      }

      this.setTurnCommand({
        command: Command.BALL,
        cursor,
        playerIndex: globalScene.getPlayerIndexForFieldSlot(this.fieldIndex),
      });
      this.getTurnCommand()!.targets = validTargets;
      if (validTargets.length > 1) {
        globalScene.phaseManager.unshiftNew("SelectTargetPhase", this.fieldIndex, validTargets);
      }
      if (!globalScene.twoPlayerMode && this.fieldIndex) {
        globalScene.currentBattle.turnCommands[this.getPreviousFieldBattlerIndex()]!.skip = true;
      }
      return true;
    }

    return false;
  }

  /**
   * Submethod of {@linkcode tryLeaveField} to handle the logic for effects that prevent the pokemon from leaving the field
   * due to trapping abilities or effects.
   *
   * This method queues the proper messages in the case of trapping abilities or effects.
   *
   * @returns Whether the pokemon is currently trapped
   */
  private handleTrap(): boolean {
    const playerPokemon = this.getPokemon();
    const trappedAbMessages: string[] = [];
    const isSwitch = this.isSwitch;
    if (!playerPokemon.isTrapped(trappedAbMessages)) {
      return false;
    }
    if (trappedAbMessages.length > 0) {
      if (isSwitch) {
        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          globalScene.ui.showText(
            trappedAbMessages[0],
            null,
            () => {
              globalScene.ui.showText("", 0);
              if (isSwitch) {
                globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
              }
            },
            null,
            true,
          );
        });
      }
    } else {
      const trapTag = playerPokemon.getTag(TrappedTag);
      const fairyLockTag = globalScene.arena.getTagOnSide(ArenaTagType.FAIRY_LOCK, ArenaTagSide.PLAYER);

      if (!isSwitch) {
        globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        globalScene.ui.setMode(UiMode.MESSAGE);
      }
      if (trapTag) {
        this.showNoEscapeText(trapTag, false);
      } else if (fairyLockTag) {
        this.showNoEscapeText(fairyLockTag, false);
      }
    }

    return true;
  }

  /**
   * Common helper method that attempts to have the pokemon leave the field.
   * Checks for trapping abilities and effects.
   *
   * @param cursor - The index of the option that the cursor is on
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private tryLeaveField(cursor?: number, isBatonSwitch = false): boolean {
    const currentBattle = globalScene.currentBattle;

    if (isBatonSwitch || !this.handleTrap()) {
      this.setTurnCommand(this.isSwitch
        ? {
            command: Command.POKEMON,
            cursor,
            args: [isBatonSwitch],
          }
        : {
            command: Command.RUN,
          });
      if (!this.isSwitch && this.fieldIndex) {
        currentBattle.turnCommands[this.getPreviousFieldBattlerIndex()]!.skip = true;
      }
      return true;
    }

    return false;
  }

  /**
   * Helper method for {@linkcode handleCommand} that handles the logic when the selected command is RUN.
   *
   * @remarks
   * Checks if the player is allowed to flee, and if not, queues the appropriate message.
   *
   * The player cannot flee if:
   * - The player is in the {@linkcode BiomeId.END | End} biome
   * - The player is in a trainer battle
   * - The player is in a mystery encounter that disallows fleeing
   * - The player's pokemon is trapped by an ability or effect
   * @returns Whether the pokemon is able to leave the field, indicating the command phase should end
   */
  private handleRunCommand(): boolean {
    const { currentBattle, arena } = globalScene;
    const mysteryEncounterFleeAllowed = currentBattle.mysteryEncounter?.fleeAllowed ?? true;
    if (arena.biomeId === BiomeId.END || !mysteryEncounterFleeAllowed) {
      this.queueShowText("battle:noEscapeForce");
      return false;
    }
    if (
      currentBattle.battleType === BattleType.TRAINER
      || currentBattle.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE
    ) {
      this.queueShowText("battle:noEscapeTrainer");
      return false;
    }

    const success = this.tryLeaveField();

    return success;
  }

  private handleRepositionCommand(targetPosition: FieldPosition): boolean {
    const playerPokemon = this.getPokemon();
    if (
      !globalScene.twoPlayerMode
      || globalScene.getPlayerFieldOwners().length < 3
      || globalScene.currentBattle.getBattlerCount() < 3
      || playerPokemon.fieldPosition === targetPosition
    ) {
      return false;
    }

    this.setTurnCommand({
      command: Command.REPOSITION,
      cursor: targetPosition,
      playerIndex: globalScene.getPlayerIndexForFieldSlot(this.fieldIndex),
    });
    return true;
  }

  /**
   * Show a message indicating that the pokemon cannot escape, and then return to the command phase.
   */
  private showNoEscapeText(tag: any, isSwitch: boolean): void {
    globalScene.ui.showText(
      i18next.t("battle:noEscapePokemon", {
        pokemonName:
          tag.sourceId && globalScene.getPokemonById(tag.sourceId)
            ? getPokemonNameWithAffix(globalScene.getPokemonById(tag.sourceId)!)
            : "",
        moveName: tag.getMoveName(),
        escapeVerb: i18next.t(isSwitch ? "battle:escapeVerbSwitch" : "battle:escapeVerbFlee"),
      }),
      null,
      () => {
        globalScene.ui.showText("", 0);
        if (!isSwitch) {
          globalScene.ui.setMode(UiMode.COMMAND, this.fieldIndex);
        }
      },
      null,
      true,
    );
  }

  // Overloads for handleCommand to provide a more specific signature for the different options
  /**
   * Process the command phase logic based on the selected command
   *
   * @param command - The kind of command to handle
   * @param cursor - The index of option that the cursor is on, or -1 if no option is selected
   * @param useMode - The mode to use for the move, if applicable. For switches, a boolean that specifies whether the switch is a Baton switch.
   * @param move - For {@linkcode Command.FIGHT}, the move to use
   * @returns Whether the command was successful
   */
  handleCommand(command: Command.FIGHT | Command.TERA, cursor: number, useMode?: MoveUseMode, move?: TurnMove): boolean;
  handleCommand(command: Command.POKEMON, cursor: number, useBaton: boolean): boolean;
  handleCommand(command: Command.REPOSITION, cursor: FieldPosition): boolean;
  handleCommand(command: Command.BALL | Command.RUN, cursor: number): boolean;
  handleCommand(command: Command, cursor: number, useMode?: boolean | MoveUseMode, move?: TurnMove): boolean;

  public handleCommand(
    command: Command,
    cursor: number,
    useMode: boolean | MoveUseMode = false,
    move?: TurnMove,
  ): boolean {
    let success = false;

    switch (command) {
      case Command.TERA:
      case Command.FIGHT:
        success = this.handleFightCommand(command, cursor, typeof useMode === "boolean" ? undefined : useMode, move);
        break;
      case Command.BALL:
        success = this.handleBallCommand(cursor);
        break;
      case Command.POKEMON:
        this.isSwitch = true;
        success = this.tryLeaveField(cursor, typeof useMode === "boolean" ? useMode : undefined);
        this.isSwitch = false;
        break;
      case Command.REPOSITION:
        success = this.handleRepositionCommand(cursor);
        break;
      case Command.RUN:
        success = this.handleRunCommand();
    }

    if (success) {
      this.end();
    }

    return success;
  }

  cancel() {
    if (this.fieldIndex) {
      for (let fieldIndex = 0; fieldIndex <= this.fieldIndex; fieldIndex++) {
        globalScene.phaseManager.unshiftNew("CommandPhase", fieldIndex);
      }
      this.end();
    }
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }

  getPokemon(): PlayerPokemon {
    return globalScene.getPlayerField()[this.fieldIndex];
  }

  end() {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}
