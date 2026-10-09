import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { GREAT_HAUNT_SPRITE } from "#data/great-haunt";
import { SwitchType } from "#enums/switch-type";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import {
  cancelGreatHauntTurn,
  createGreatHauntBoss,
  createGreatHauntClone,
  recordGreatHauntFaint,
} from "#utils/great-haunt-utils";
import i18next from "i18next";

/** Resolves the disguise's knockout, then summons the next stage after the resulting faints. */
export class GreatHauntPhase extends Phase {
  public readonly phaseName = "GreatHauntPhase";

  override start(): void {
    super.start();
    void this.advance().then(() => this.end());
  }

  private async advance(): Promise<void> {
    const battle = globalScene.currentBattle;
    const state = battle.greatHauntState;
    if (!state || state.stage === "marowak") {
      return;
    }
    const manager = globalScene.phaseManager;
    if (state.stage === "ghost") {
      cancelGreatHauntTurn();
      const victims = globalScene.getPlayerField().filter(p => p.isOnField());
      // A simultaneous KO may already have queued one of these faints. Resolve each victim only once.
      manager.removeAllPhasesOfType("FaintPhase");
      // Set every victim's HP first so the normal faint logic sees a simultaneous knockout.
      victims.forEach(p => {
        recordGreatHauntFaint(p);
        state.forcedFaintIds.push(p.id);
        p.hp = 0;
      });
      state.stage = "clones";
      state.clonesSpawned = false;
      for (const victim of victims) {
        manager.queueMessage(
          i18next.t("battle:greatHauntDestinyBond", { pokemonName: victim.getNameToRender() }),
          null,
          true,
        );
        manager.unshiftNew("FaintPhase", victim.getBattlerIndex(), true);
      }
      manager.pushNew("GreatHauntPhase");
      return;
    }

    if (globalScene.areAllActivePlayersOutOfUsablePokemon()) {
      manager.clearPhaseQueue();
      manager.unshiftNew("GameOverPhase");
      return;
    }

    const oldParty = [...battle.enemyParty];
    // Older saves have no flag. Identify the actual disguise, not an ID a clone may have reused.
    state.clonesSpawned ??= !oldParty.some(p => p.customPokemonData.eventVariant === GREAT_HAUNT_SPRITE);
    if (oldParty.every(p => p.isFainted())) {
      // Return stolen player items before retiring this stage's enemies and their item records.
      globalScene.recoverBattleTransferredHeldItems(globalScene.getActivePlayerIndexes(), true);
    }
    if (!state.clonesSpawned) {
      state.clonesSpawned = true;
      // The disguise knockout cancelled TurnEndPhase; reset commands without applying its residual effects.
      battle.incrementTurn();
      manager.dynamicQueueManager.clearLastTurnOrder();
      battle.enemyParty = [];
      for (const snapshot of state.fallen) {
        battle.enemyParty.push(createGreatHauntClone(snapshot));
      }
      manager.queueMessage(i18next.t("battle:greatHauntClones"), null, true);
    } else if (state.stage === "clones" && oldParty.some(p => !p.isFainted())) {
      const reserved = new Set<number>();
      for (let field = 0; field < Math.min(battle.getBattlerCount(), oldParty.length); field++) {
        if (!oldParty[field].isFainted()) {
          continue;
        }
        const next = oldParty.findIndex((p, i) => i >= battle.getBattlerCount() && !p.isFainted() && !reserved.has(i));
        if (next >= 0) {
          reserved.add(next);
          await oldParty[next].loadAssets();
          manager.pushNew("SwitchSummonPhase", SwitchType.SWITCH, field, next, false, false);
        }
      }
      return;
    } else {
      cancelGreatHauntTurn();
      state.stage = "marowak";
      battle.enemyParty = [createGreatHauntBoss(false)];
      manager.queueMessage(i18next.t("battle:greatHauntRevealed"), null, true);
    }

    battle.enemyLevels = battle.enemyParty.map(p => p.level);
    await Promise.all(battle.enemyParty.map(p => p.loadAssets()));
    for (const pokemon of oldParty) {
      pokemon.destroy();
    }
    for (const modifier of globalScene.findModifiers(
      m => m instanceof PokemonHeldItemModifier,
      false,
    ) as PokemonHeldItemModifier[]) {
      if (oldParty.some(p => p.id === modifier.pokemonId)) {
        globalScene.removeModifier(modifier, true);
      }
    }
    for (let field = 0; field < Math.min(battle.getBattlerCount(), battle.enemyParty.length); field++) {
      battle.enemyParty[field].setPosition(236, 84);
      manager.pushNew("SummonPhase", field, false);
    }
  }
}
