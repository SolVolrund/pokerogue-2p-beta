import { globalScene } from "#app/global-scene";
import { BattlerIndex } from "#enums/battler-index";
import { BattleType } from "#enums/battle-type";
import { TurnInitEvent } from "#events/battle-scene";
import type { PlayerPokemon } from "#field/pokemon";
import {
  handleMysteryEncounterBattleStartEffects,
  handleMysteryEncounterBattleFailed,
  handleMysteryEncounterTurnStartEffects,
} from "#mystery-encounters/encounter-phase-utils";
import { FieldPhase } from "#phases/field-phase";
import type { PlannedFight } from "#phases/private-fight-phase";
import { reformHordePlayers } from "#utils/horde-battle";
import i18next from "i18next";

export class TurnInitPhase extends FieldPhase {
  public readonly phaseName = "TurnInitPhase";
  async start() {
    super.start();

    let queuedVsModeVictory = false;

    globalScene.getPlayerField().forEach(p => {
      if (queuedVsModeVictory) {
        return;
      }

      // If this pokemon is in play and evolved into something illegal under the current challenge, force a switch
      if (p.isOnField() && !p.isAllowedInBattle()) {
        globalScene.phaseManager.queueMessage(
          i18next.t("challenges:illegalEvolution", { pokemon: p.name }),
          null,
          true,
        );

        const playerIndex = globalScene.getPlayerIndexForPokemon(p) ?? globalScene.getPlayerIndexForFieldSlot(p.getFieldIndex());
        const activePartySlotCount = globalScene.getPlayerActiveSlotCount(playerIndex);
        const allowedPokemon = globalScene.getPokemonAllowedInBattle(playerIndex);

        if (allowedPokemon.length === 0 && globalScene.queueVsModeVictoryIfDecided()) {
          queuedVsModeVictory = true;
          return;
        } else if (allowedPokemon.length === 0 && globalScene.areAllActivePlayersOutOfUsablePokemon()) {
          // If no active player has legal Pokemon left, game over.
          globalScene.phaseManager.clearPhaseQueue();
          globalScene.phaseManager.unshiftNew("GameOverPhase");
        } else if (
          allowedPokemon.length === 0
          && globalScene.currentBattle.mysteryEncounter
          && globalScene.areAllPlayerFieldOwnersOutOfUsablePokemon()
        ) {
          globalScene.phaseManager.clearPhaseQueue(true);
          handleMysteryEncounterBattleFailed();
        } else if (
          allowedPokemon.length >= activePartySlotCount
          || (globalScene.currentBattle.double && allowedPokemon.length > 0 && !allowedPokemon[0].isActive(true))
        ) {
          // If there is at least one pokemon in the back that is legal to switch in, force a switch.
          p.switchOut();
        } else {
          // If there are no pokemon in the back but we're not game overing, just hide the pokemon.
          // This should only happen in double battles.
          p.leaveField();
        }
        if (!globalScene.twoPlayerMode && allowedPokemon.length === 1 && globalScene.currentBattle.double) {
          globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
        }
      }
    });

    if (queuedVsModeVictory) {
      this.end();
      return;
    }

    globalScene.eventTarget.dispatchEvent(new TurnInitEvent());

    handleMysteryEncounterBattleStartEffects();

    // If true, will skip remainder of current phase (and not queue CommandPhases etc.)
    if (handleMysteryEncounterTurnStartEffects()) {
      this.end();
      return;
    }

    if (globalScene.queueEonFluteDismissalsForRevivedPlayers()) {
      this.end();
      return;
    }

    if (globalScene.currentBattle.horde) {
      await reformHordePlayers();
    }
    const plans = canPlanPrivateTurn() ? new Map<number, PlannedFight>() : undefined;
    if (plans) globalScene.phaseManager.pushNew("PrivateFightPhase", plans);
    globalScene.getField().forEach((pokemon, i) => {
      if (pokemon?.isActive()) {
        if (pokemon.isPlayer()) {
          globalScene.currentBattle.addParticipant(pokemon as PlayerPokemon);
          pokemon.refreshAccessoryOutfitSprites();
        }

        pokemon.resetTurnData();

        if (pokemon.isPlayer()) {
          globalScene.phaseManager.pushNew("CommandPhase", globalScene.getFieldIndexForBattlerIndex(i), plans);
        } else {
          globalScene.phaseManager.pushNew("EnemyCommandPhase", globalScene.getFieldIndexForBattlerIndex(i));
        }
      }
    });

    globalScene.phaseManager.pushNew("TurnStartPhase");

    this.end();
  }
}

export function canPlanPrivateTurn(): boolean {
  const scene = globalScene;
  if (!scene.privateTurnSelection || !scene.twoPlayerMode || scene.twoPlayerEnemyPlayerMode
    || scene.uiInputs?.privateFightSeats !== scene.multiplayerPlayerCount) return false;
  const players = scene.getActivePlayerIndexes();
  if (![2, 3].includes(players.length) || players.some(p => scene.isComputerPartnerPlayer(p))) return false;
  const battle = scene.currentBattle;
  if (battle.mysteryEncounter?.misc?.shinyBadgeDuelActive) return players.length === 2;
  if (!battle.double || scene.twoPlayerVsMode || battle.mysteryEncounter || battle.horde
    || battle.isClassicFinalBoss || scene.seasonalEncounters.tower || battle.getBattlerCount() !== players.length) return false;
  if (battle.battleType === BattleType.TRAINER) return !!battle.trainer && scene.uiInputs.privateTrainerFightsEnabled;
  return battle.battleType === BattleType.WILD && !scene.getEnemyField().some(p => p?.isBoss());
}
