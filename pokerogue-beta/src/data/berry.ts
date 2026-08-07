import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { getStatusEffectHealText } from "#data/status-effect";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { HitResult } from "#enums/hit-result";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import type { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { DamageResult } from "#types/damage-result";
import { NumberHolder, randSeedInt, toDmgValue } from "#utils/common";
import i18next from "i18next";

export function getBerryName(berryType: BerryType): string {
  return i18next.t(`berry:${BerryType[berryType].toLowerCase()}.name`);
}

export function getBerryEffectDescription(berryType: BerryType): string {
  return i18next.t(`berry:${BerryType[berryType].toLowerCase()}.effect`);
}

export type BerryPredicate = (pokemon: Pokemon) => boolean;

export type BerryUseTrigger = "turn-end" | "damage" | "status";

export interface BerryUseContext {
  readonly trigger: BerryUseTrigger;
  readonly source?: Pokemon | undefined;
  readonly move?: Move | undefined;
  readonly hitResult?: DamageResult | undefined;
  readonly damage?: number | undefined;
  readonly statusEffect?: StatusEffect | undefined;
}

const DAMAGE_TRIGGER_BERRIES = new Set([
  BerryType.SITRUS,
  BerryType.ENIGMA,
  BerryType.LIECHI,
  BerryType.GANLON,
  BerryType.PETAYA,
  BerryType.APICOT,
  BerryType.SALAC,
  BerryType.LANSAT,
  BerryType.STARF,
]);

const STATUS_TRIGGER_BERRIES = new Set([BerryType.LUM]);

const DAMAGE_REDUCTION_BERRY_TYPES = new Set([
  BerryType.OCCA,
  BerryType.PASSHO,
  BerryType.WACAN,
  BerryType.RINDO,
  BerryType.YACHE,
  BerryType.CHOPLE,
  BerryType.KEBIA,
  BerryType.SHUCA,
  BerryType.COBA,
  BerryType.PAYAPA,
  BerryType.TANGA,
  BerryType.CHARTI,
  BerryType.KASIB,
  BerryType.HABAN,
  BerryType.COLBUR,
  BerryType.BABIRI,
  BerryType.CHILAN,
  BerryType.ROSELI,
]);

const DAMAGE_REDUCTION_BERRY_MOVE_TYPES = new Map<BerryType, PokemonType>([
  [BerryType.OCCA, PokemonType.FIRE],
  [BerryType.PASSHO, PokemonType.WATER],
  [BerryType.WACAN, PokemonType.ELECTRIC],
  [BerryType.RINDO, PokemonType.GRASS],
  [BerryType.YACHE, PokemonType.ICE],
  [BerryType.CHOPLE, PokemonType.FIGHTING],
  [BerryType.KEBIA, PokemonType.POISON],
  [BerryType.SHUCA, PokemonType.GROUND],
  [BerryType.COBA, PokemonType.FLYING],
  [BerryType.PAYAPA, PokemonType.PSYCHIC],
  [BerryType.TANGA, PokemonType.BUG],
  [BerryType.CHARTI, PokemonType.ROCK],
  [BerryType.KASIB, PokemonType.GHOST],
  [BerryType.HABAN, PokemonType.DRAGON],
  [BerryType.COLBUR, PokemonType.DARK],
  [BerryType.BABIRI, PokemonType.STEEL],
  [BerryType.CHILAN, PokemonType.NORMAL],
  [BerryType.ROSELI, PokemonType.FAIRY],
]);

export function isDamageReductionBerryType(berryType: BerryType): boolean {
  return DAMAGE_REDUCTION_BERRY_TYPES.has(berryType);
}

export function getDamageReductionBerryTypeForMoveType(moveType: PokemonType): BerryType | undefined {
  for (const [berryType, resistedType] of DAMAGE_REDUCTION_BERRY_MOVE_TYPES) {
    if (resistedType === moveType) {
      return berryType;
    }
  }
  return undefined;
}

export function getDamageReductionBerryResistedType(berryType: BerryType): PokemonType | undefined {
  return DAMAGE_REDUCTION_BERRY_MOVE_TYPES.get(berryType);
}

export function canBerryTriggerInContext(berryType: BerryType, context?: BerryUseContext): boolean {
  switch (context?.trigger ?? "turn-end") {
    case "damage":
      return DAMAGE_TRIGGER_BERRIES.has(berryType);
    case "status":
      return STATUS_TRIGGER_BERRIES.has(berryType);
    case "turn-end":
      return !isDamageReductionBerryType(berryType);
  }
}

export function getBerryPredicate(berryType: BerryType): BerryPredicate {
  switch (berryType) {
    case BerryType.SITRUS:
      return (pokemon: Pokemon) => pokemon.getHpRatio() < 0.5;
    case BerryType.LUM:
      return (pokemon: Pokemon) => !!pokemon.status || !!pokemon.getTag(BattlerTagType.CONFUSED);
    case BerryType.ENIGMA:
      return (pokemon: Pokemon) =>
        pokemon.turnData.attacksReceived.some(
          a => a.result === HitResult.SUPER_EFFECTIVE || a.result === HitResult.EXTREMELY_EFFECTIVE,
        );
    case BerryType.LIECHI:
    case BerryType.GANLON:
    case BerryType.PETAYA:
    case BerryType.APICOT:
    case BerryType.SALAC:
      return (pokemon: Pokemon) => {
        const hpRatioReq = new NumberHolder(0.25);
        // Offset BerryType such that LIECHI -> Stat.ATK = 1, GANLON -> Stat.DEF = 2, so on and so forth
        const stat: BattleStat = berryType - BerryType.ENIGMA;
        applyAbAttrs("ReduceBerryUseThresholdAbAttr", { pokemon, hpRatioReq });
        return pokemon.getHpRatio() < hpRatioReq.value && pokemon.getStatStage(stat) < 6;
      };
    case BerryType.LANSAT:
      return (pokemon: Pokemon) => {
        const hpRatioReq = new NumberHolder(0.25);
        applyAbAttrs("ReduceBerryUseThresholdAbAttr", { pokemon, hpRatioReq });
        return pokemon.getHpRatio() < 0.25 && !pokemon.getTag(BattlerTagType.CRIT_BOOST);
      };
    case BerryType.STARF:
      return (pokemon: Pokemon) => {
        const hpRatioReq = new NumberHolder(0.25);
        applyAbAttrs("ReduceBerryUseThresholdAbAttr", { pokemon, hpRatioReq });
        return pokemon.getHpRatio() < 0.25;
      };
    case BerryType.LEPPA:
      return (pokemon: Pokemon) => {
        const hpRatioReq = new NumberHolder(0.25);
        applyAbAttrs("ReduceBerryUseThresholdAbAttr", { pokemon, hpRatioReq });
        return !!pokemon.getMoveset().find(m => !m.getPpRatio());
      };
    case BerryType.OCCA:
    case BerryType.PASSHO:
    case BerryType.WACAN:
    case BerryType.RINDO:
    case BerryType.YACHE:
    case BerryType.CHOPLE:
    case BerryType.KEBIA:
    case BerryType.SHUCA:
    case BerryType.COBA:
    case BerryType.PAYAPA:
    case BerryType.TANGA:
    case BerryType.CHARTI:
    case BerryType.KASIB:
    case BerryType.HABAN:
    case BerryType.COLBUR:
    case BerryType.BABIRI:
    case BerryType.CHILAN:
    case BerryType.ROSELI:
      return () => false;
  }
}

export type BerryEffectFunc = (consumer: Pokemon) => void;

export function getBerryEffectFunc(berryType: BerryType, berryPhase = false): BerryEffectFunc {
  return (consumer: Pokemon) => {
    // Apply an effect pertaining to what berry we're using
    switch (berryType) {
      case BerryType.SITRUS:
      case BerryType.ENIGMA:
        {
          const hpHealed = new NumberHolder(toDmgValue(consumer.getMaxHp() / 4));
          applyAbAttrs("DoubleBerryEffectAbAttr", { pokemon: consumer, effectValue: hpHealed });
          globalScene.phaseManager.unshiftNew(
            "PokemonHealPhase",
            consumer.getBattlerIndex(),
            hpHealed.value,
            i18next.t("battle:hpHealBerry", {
              pokemonNameWithAffix: getPokemonNameWithAffix(consumer),
              berryName: getBerryName(berryType),
            }),
            true,
          );
        }
        break;
      case BerryType.LUM:
        {
          if (consumer.status) {
            globalScene.phaseManager.queueMessage(
              getStatusEffectHealText(consumer.status.effect, getPokemonNameWithAffix(consumer)),
            );
          }
          consumer.resetStatus(true, true);
          consumer.updateInfo();
        }
        break;
      case BerryType.LIECHI:
      case BerryType.GANLON:
      case BerryType.PETAYA:
      case BerryType.APICOT:
      case BerryType.SALAC:
        {
          // Offset BerryType such that LIECHI --> Stat.ATK = 1, GANLON --> Stat.DEF = 2, etc etc.
          const stat: BattleStat = berryType - BerryType.ENIGMA;
          const statStages = new NumberHolder(1);
          applyAbAttrs("DoubleBerryEffectAbAttr", { pokemon: consumer, effectValue: statStages });
          if (berryPhase) {
            const queuedChange = consumer.queuedBerryStatChanges.find(c => c.stat === stat);
            if (queuedChange == null) {
              consumer.queuedBerryStatChanges.push({ stat, stages: statStages.value });
            } else {
              queuedChange.stages += statStages.value;
            }
          } else {
            globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
              battlerIndex: consumer.getBattlerIndex(),
              changes: [{ stat, stages: statStages.value }],
              sourcePokemon: consumer,
            });
          }
        }
        break;

      case BerryType.LANSAT:
        {
          consumer.addTag(BattlerTagType.CRIT_BOOST);
        }
        break;

      case BerryType.STARF:
        {
          const randStat = randSeedInt(Stat.SPD, Stat.ATK);
          const stages = new NumberHolder(2);
          applyAbAttrs("DoubleBerryEffectAbAttr", { pokemon: consumer, effectValue: stages });
          if (berryPhase) {
            const queuedChange = consumer.queuedBerryStatChanges.find(c => c.stat === randStat);
            if (queuedChange == null) {
              consumer.queuedBerryStatChanges.push({ stat: randStat, stages: stages.value });
            } else {
              queuedChange.stages += stages.value;
            }
          } else {
            globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
              battlerIndex: consumer.getBattlerIndex(),
              changes: [{ stat: randStat, stages: stages.value }],
              sourcePokemon: consumer,
            });
          }
        }
        break;

      case BerryType.LEPPA:
        {
          // Pick the first move completely out of PP, or else the first one that has any PP missing
          const ppRestoreMove =
            consumer.getMoveset().find(m => m.ppUsed === m.getMovePp())
            ?? consumer.getMoveset().find(m => m.ppUsed < m.getMovePp());
          if (ppRestoreMove) {
            ppRestoreMove.ppUsed = Math.max(ppRestoreMove.ppUsed - 10, 0);
            globalScene.phaseManager.queueMessage(
              i18next.t("battle:ppHealBerry", {
                pokemonNameWithAffix: getPokemonNameWithAffix(consumer),
                moveName: ppRestoreMove.getName(),
                berryName: getBerryName(berryType),
              }),
            );
          }
        }
        break;
      case BerryType.OCCA:
      case BerryType.PASSHO:
      case BerryType.WACAN:
      case BerryType.RINDO:
      case BerryType.YACHE:
      case BerryType.CHOPLE:
      case BerryType.KEBIA:
      case BerryType.SHUCA:
      case BerryType.COBA:
      case BerryType.PAYAPA:
      case BerryType.TANGA:
      case BerryType.CHARTI:
      case BerryType.KASIB:
      case BerryType.HABAN:
      case BerryType.COLBUR:
      case BerryType.BABIRI:
      case BerryType.CHILAN:
      case BerryType.ROSELI:
        break;
      default:
        console.error("Incorrect BerryType %d passed to GetBerryEffectFunc", berryType);
    }
  };
}
