import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { TerrainType } from "#data/terrain";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { HitResult } from "#enums/hit-result";
import { WeatherType } from "#enums/weather-type";
import { TurnEndEvent } from "#events/battle-scene";
import type { Pokemon } from "#field/pokemon";
import {
  EnemyStatusEffectHealChanceModifier,
  EnemyTurnHealModifier,
  ShinyBadgeModifier,
  TurnHealModifier,
  TurnHeldItemTransferModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import { FieldPhase } from "#phases/field-phase";
import {
  FIELD_BLESSING_DAMAGE_RATIO,
  getPersistentFieldBlessing,
  isShadowyAuraDamageImmune,
} from "#utils/field-blessings";
import { toDmgValue } from "#utils/common";
import i18next from "i18next";

export class TurnEndPhase extends FieldPhase {
  public readonly phaseName = "TurnEndPhase";
  public upcomingInterlude = false;

  start() {
    super.start();

    globalScene.currentBattle.incrementTurn();
    globalScene.eventTarget.dispatchEvent(new TurnEndEvent(globalScene.currentBattle.turn));
    globalScene.phaseManager.dynamicQueueManager.clearLastTurnOrder();

    globalScene.phaseManager.hideAbilityBar();

    const handlePokemon = (pokemon: Pokemon) => {
      if (!pokemon.switchOutStatus) {
        pokemon.lapseTags(BattlerTagLapseType.TURN_END);

        globalScene.applyModifiersForPokemon(TurnHealModifier, pokemon, pokemon);

        if (globalScene.arena.terrain?.terrainType === TerrainType.GRASSY && pokemon.isGrounded()) {
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            pokemon.getBattlerIndex(),
            Math.max(pokemon.getMaxHp() >> 4, 1),
            i18next.t("battle:turnEndHpRestore", {
              pokemonName: getPokemonNameWithAffix(pokemon),
            }),
            true,
          );
        }

        if (!pokemon.isPlayer()) {
          globalScene.applyModifiers(EnemyTurnHealModifier, false, pokemon);
          globalScene.applyModifier(EnemyStatusEffectHealChanceModifier, false, pokemon);
        }

        globalScene.applyModifiersForPokemon(ShinyBadgeModifier, pokemon, pokemon, "status");

        applyAbAttrs("PostTurnAbAttr", { pokemon });
      }

      globalScene.applyModifiersForPokemon(TurnStatusEffectModifier, pokemon, pokemon);
      globalScene.applyModifiersForPokemon(TurnHeldItemTransferModifier, pokemon, pokemon);

      pokemon.tempSummonData.turnCount++;
      pokemon.tempSummonData.waveTurnCount++;
    };

    if (!this.upcomingInterlude) {
      this.executeForAll(handlePokemon);
      this.applyShinyBadgePartyRevives();
      this.applyShadowyAuraDamage();

      globalScene.arena.lapseTags();
    }

    if (globalScene.arena.weather && !globalScene.arena.weather.lapse()) {
      globalScene.arena.trySetWeather(WeatherType.NONE);
      globalScene.arena.triggerWeatherBasedFormChangesToNormal();
    }

    if (globalScene.arena.terrain && !globalScene.arena.terrain.lapse()) {
      globalScene.arena.trySetTerrain(TerrainType.NONE);
    }

    this.end();
  }

  private applyShinyBadgePartyRevives(): void {
    const playerIndexes = globalScene.twoPlayerMode ? ([0, 1] as const) : ([globalScene.activePlayerIndex] as const);

    for (const playerIndex of playerIndexes) {
      for (const pokemon of globalScene.getPlayerParty(playerIndex)) {
        if (!pokemon.isOnField() && pokemon.isFainted(true)) {
          globalScene.applyModifiersForPokemon(ShinyBadgeModifier, pokemon, pokemon, "partyRevive");
        }
      }
    }
  }

  private applyShadowyAuraDamage(): void {
    if (getPersistentFieldBlessing() !== "shadowy_aura") {
      return;
    }

    this.executeForAll((pokemon: Pokemon) => {
      if (pokemon.switchOutStatus || isShadowyAuraDamageImmune(pokemon)) {
        return;
      }

      const damage = toDmgValue(pokemon.getMaxHp() / FIELD_BLESSING_DAMAGE_RATIO);
      globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} was buffeted by the shadowy aura!`);
      pokemon.damageAndUpdate(damage, { result: HitResult.INDIRECT, ignoreSegments: true });
    });
  }
}
