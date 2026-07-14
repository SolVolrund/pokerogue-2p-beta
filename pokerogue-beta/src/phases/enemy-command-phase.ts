import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { Command } from "#enums/command";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import type { EnemyPokemon } from "#field/pokemon";
import { FieldPhase } from "#phases/field-phase";
import { shouldAiRepositionToCenter } from "#utils/ai-targeting";
import { getPlannerSwitchIndex } from "#utils/battle-planner-ai";

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

  start() {
    super.start();

    const enemyPokemon = globalScene.getEnemyField()[this.fieldIndex];

    const battle = globalScene.currentBattle;

    const trainer = battle.trainer;

    if (
      battle.double
      && enemyPokemon.hasAbility(AbilityId.COMMANDER)
      && enemyPokemon.getAlly()?.getTag(BattlerTagType.COMMANDED)
    ) {
      this.skipTurn = true;
    }

    if (!this.skipTurn && shouldAiRepositionToCenter(enemyPokemon)) {
      battle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
        command: Command.REPOSITION,
        cursor: FieldPosition.CENTER,
        skip: this.skipTurn,
      };

      return this.end();
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
    if (trainer && enemyPokemon.getMoveQueue().length === 0) {
      const opponents = enemyPokemon.getOpponents();

      if (!enemyPokemon.isTrapped()) {
        const partyMemberScores = trainer.getPartyMemberMatchupScores(enemyPokemon.trainerSlot, true);

        if (partyMemberScores.length > 0) {
          const matchupScores = opponents.map(opp => enemyPokemon.getMatchupScore(opp));
          const matchupScore = matchupScores.reduce((total, score) => (total += score), 0) / matchupScores.length;

          const sortedPartyMemberScores = trainer.getSortedPartyMemberMatchupScores(partyMemberScores);

          const switchMultiplier = 1 - (battle.enemySwitchCounter ? Math.pow(0.1, 1 / battle.enemySwitchCounter) : 0);
          const usePlannerSwitch = globalScene.plannerAiEnabled && enemyPokemon.aiType === AiType.PLANNER;
          const allyAlreadySwitching = globalScene.getEnemyField().some((fieldPokemon, fieldIndex) => {
            return (
              fieldPokemon !== enemyPokemon
              && battle.turnCommands[globalScene.getEnemyBattlerIndex(fieldIndex)]?.command === Command.POKEMON
            );
          });

          const plannerSwitchIndex = usePlannerSwitch
            ? getPlannerSwitchIndex(
                enemyPokemon,
                partyMemberScores,
                switchMultiplier,
                trainer.config.isBoss,
                allyAlreadySwitching,
              )
            : undefined;
          const legacyShouldSwitch =
            !usePlannerSwitch
            && sortedPartyMemberScores[0][1] * switchMultiplier >= matchupScore * (trainer.config.isBoss ? 2 : 3);

          if (plannerSwitchIndex !== undefined || legacyShouldSwitch) {
            const index = plannerSwitchIndex ?? trainer.getNextSummonIndex(enemyPokemon.trainerSlot, partyMemberScores);

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
    const nextMove = enemyPokemon.getNextMove();

    if (this.shouldTera(enemyPokemon)) {
      globalScene.currentBattle.preTurnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
        command: Command.TERA,
      };
    }

    globalScene.currentBattle.turnCommands[globalScene.getEnemyBattlerIndex(this.fieldIndex)] = {
      command: Command.FIGHT,
      move: nextMove,
      skip: this.skipTurn || nextMove.move === MoveId.NONE,
    };

    globalScene.currentBattle.enemySwitchCounter = Math.max(globalScene.currentBattle.enemySwitchCounter - 1, 0);

    this.end();
  }

  private shouldTera(pokemon: EnemyPokemon): boolean {
    return !!globalScene.currentBattle.trainer?.shouldTera(pokemon);
  }

  getFieldIndex(): number {
    return this.fieldIndex;
  }
}
