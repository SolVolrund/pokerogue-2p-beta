import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { timedEventManager } from "#app/global-event-manager";
import { NON_LEGEND_ULTRA_BEASTS } from "#balance/special-species-groups";
import { NIGHT_TIME } from "#constants/game-constants";
import { Gender } from "#data/gender";
import { getStatusEffectCatchRateMultiplier } from "#data/status-effect";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { PokeballType } from "#enums/pokeball";
import { type BallDesign, designBattleFrame } from "#data/ball-design";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export const MAX_PER_TYPE_POKEBALLS: number = 99;

export function getPokeballAtlasKey(type: PokeballType, design?: BallDesign): string {
  if (type === PokeballType.POKEBALL && design) return designBattleFrame(design);
  switch (type) {
    case PokeballType.POKEBALL:
      return "pb";
    case PokeballType.GREAT_BALL:
      return "gb";
    case PokeballType.ULTRA_BALL:
      return "ub";
    case PokeballType.ROGUE_BALL:
      return "rb";
    case PokeballType.MASTER_BALL:
      return "mb";
    case PokeballType.LUXURY_BALL:
      return "lb";
    case PokeballType.GLASS_BALL:
      return "glass_ball";
    case PokeballType.CLONE_BALL:
      return "cb";
    case PokeballType.SAFARI_BALL:
      return "sb";
  }
}

const ballLocaleKeys = {
  [PokeballType.POKEBALL]: "pokeBall",
  [PokeballType.GREAT_BALL]: "greatBall",
  [PokeballType.ULTRA_BALL]: "ultraBall",
  [PokeballType.ROGUE_BALL]: "rogueBall",
  [PokeballType.MASTER_BALL]: "masterBall",
  [PokeballType.LUXURY_BALL]: "luxuryBall",
  [PokeballType.GLASS_BALL]: "glassBall",
  [PokeballType.CLONE_BALL]: "cloneBall",
  [PokeballType.SAFARI_BALL]: "safariBall",
} as const satisfies Record<PokeballType, string>;

export function getPokeballName(type: PokeballType): string {
  return getPokeballDisplayName(type);
}

export function getPokeballDisplayName(type: PokeballType, design?: BallDesign): string {
  const key = type === PokeballType.POKEBALL && design ? `${design}Ball` : ballLocaleKeys[type];
  return i18next.t(`pokeball:${key}`);
}

export function getPokeballDescription(type: PokeballType, design?: BallDesign): string {
  if (type === PokeballType.GLASS_BALL) {
    return i18next.t("partyUiHandler:bagReadOnly");
  }
  const key = type === PokeballType.POKEBALL && design ? `${design}Ball` : ballLocaleKeys[type];
  return i18next.t(`pokeball:descriptions.${key}`);
}

const duskBiomes = new Set<BiomeId>([BiomeId.ABYSS, BiomeId.CAVE, BiomeId.ICE_CAVE, BiomeId.FAIRY_CAVE]);
const diveBiomes = new Set<BiomeId>([BiomeId.LAKE, BiomeId.SEABED, BiomeId.SEA]);
const moonStoneFamilies = new Set<SpeciesId>([
  SpeciesId.NIDORAN_F, SpeciesId.NIDORAN_M, SpeciesId.CLEFFA, SpeciesId.IGGLYBUFF, SpeciesId.SKITTY, SpeciesId.MUNNA,
]);

function getDesignCatchMultiplier(target: EnemyPokemon, owner: PlayerIndex, thrower?: Pokemon): number {
  switch (globalScene.getPlayerState(owner).ballDesign) {
    case "quick":
      return globalScene.currentBattle.turn === 1 ? 5 : 1;
    case "timer":
      return Math.min(4, 1 + 0.3 * Math.max(0, globalScene.currentBattle.turn - 1));
    case "fast":
      return target.getSpeciesForm(true).baseStats[Stat.SPD] >= 100 ? 4 : 1;
    case "level":
      if (!thrower || thrower.level <= target.level) return 1;
      if (thrower.level >= target.level * 4) return 8;
      return thrower.level >= target.level * 2 ? 4 : 2;
    case "love":
      return thrower?.species.speciesId === target.species.speciesId
        && thrower.gender !== Gender.GENDERLESS && target.gender !== Gender.GENDERLESS
        && thrower.gender !== target.gender ? 8 : 1;
    case "nest":
      return target.level < 30 ? (41 - target.level) / 10 : 1;
    case "dusk":
      return duskBiomes.has(globalScene.arena.biomeId) || NIGHT_TIME.includes(globalScene.arena.getTimeOfDay()) ? 3 : 1;
    case "dive":
      return diveBiomes.has(globalScene.arena.biomeId) ? 3.5 : 1;
    case "lure":
      return globalScene.getActivePlayerIndexes().some(p =>
        globalScene.findModifierForPlayer(m => m.is("DoubleBattleChanceBoosterModifier"), p)) ? 4 : 1;
    case "repeat":
      return !globalScene.isComputerPartnerPlayer(owner)
        && globalScene.getPlayerGameData(owner).dexData[target.species.speciesId]?.caughtAttr ? 3.5 : 1;
    case "moon":
      return moonStoneFamilies.has(target.species.getRootSpeciesId()) ? 4 : 1;
    case "beast":
      return NON_LEGEND_ULTRA_BEASTS.includes(target.species.speciesId) ? 5 : 0.1;
    case "net":
      return target.isOfType(PokemonType.WATER) || target.isOfType(PokemonType.BUG) ? 3.5 : 1;
    case "dream":
      return target.status?.effect === StatusEffect.SLEEP || target.hasAbility(AbilityId.COMATOSE) ? 4 : 1;
    default:
      return 1;
  }
}

export function getPokeballCatchMultiplier(type: PokeballType, target?: EnemyPokemon, owner?: PlayerIndex, thrower?: Pokemon): number {
  switch (type) {
    case PokeballType.POKEBALL:
      return target && owner !== undefined ? getDesignCatchMultiplier(target, owner, thrower) : 1;
    case PokeballType.GREAT_BALL:
    case PokeballType.SAFARI_BALL:
      return 1.5;
    case PokeballType.ULTRA_BALL:
      return 2;
    case PokeballType.ROGUE_BALL:
      return 3;
    case PokeballType.MASTER_BALL:
      return -1;
    case PokeballType.LUXURY_BALL:
      return 1;
    case PokeballType.GLASS_BALL:
      return 1;
    case PokeballType.CLONE_BALL:
      return -1;
  }
}

export function getPokeballCatchRate(type: PokeballType, target: EnemyPokemon, owner: PlayerIndex, thrower?: Pokemon) {
  let catchRate = target.species.catchRate;
  if (catchRate > 0 && type === PokeballType.POKEBALL && globalScene.getPlayerState(owner).ballDesign === "heavy") {
    const kg = target.getSpeciesForm(true).weight;
    const adjustment = kg < 100 ? -20 : kg < 200 ? 0 : kg < 300 ? 20 : 30;
    catchRate = Math.max(1, Math.min(255, catchRate + adjustment));
  }
  const pokeballMultiplier = getPokeballCatchMultiplier(type, target, owner, thrower);
  const statusMultiplier = target.status ? getStatusEffectCatchRateMultiplier(target.status.effect) : 1;
  const shinyMultiplier = target.isShiny() ? timedEventManager.getShinyCatchMultiplier() : 1;
  const tripleHp = 3 * target.getMaxHp();
  const raw = tripleHp ? (((tripleHp - 2 * target.hp) * catchRate * pokeballMultiplier) / tripleHp)
    * statusMultiplier * shinyMultiplier : 0;
  // Even an off-target Beast Ball can catch a low catch-rate species.
  const modifiedCatchRate = raw > 0 ? Math.max(1, Math.round(raw)) : Math.round(raw);
  return { catchRate, pokeballMultiplier, statusMultiplier, shinyMultiplier, modifiedCatchRate };
}

export function getPokeballTintColor(type: PokeballType): number {
  switch (type) {
    case PokeballType.POKEBALL:
      return 0xd52929;
    case PokeballType.GREAT_BALL:
      return 0x94b4de;
    case PokeballType.ULTRA_BALL:
      return 0xe6cd31;
    case PokeballType.ROGUE_BALL:
      return 0xd52929;
    case PokeballType.MASTER_BALL:
      return 0xa441bd;
    case PokeballType.LUXURY_BALL:
      return 0xffde6a;
    case PokeballType.GLASS_BALL:
      return 0x85cfff;
    case PokeballType.CLONE_BALL:
      return 0x69d7ff;
    case PokeballType.SAFARI_BALL:
      return 0x97a77b;
  }
}

/**
 * Gets the critical capture chance based on number of mons registered in Dex and modified {@link https://bulbapedia.bulbagarden.net/wiki/Catch_rate Catch rate}
 * Formula from {@link https://www.dragonflycave.com/mechanics/gen-vi-vii-capturing Dragonfly Cave Gen 6 Capture Mechanics page}
 * @param modifiedCatchRate the modified catch rate as calculated in {@linkcode AttemptCapturePhase}
 * @returns the chance of getting a critical capture, out of 256
 */
export function getCriticalCaptureChance(
  modifiedCatchRate: number,
  playerIndex: PlayerIndex = globalScene.activePlayerIndex,
): number {
  if (globalScene.gameMode.isFreshStartChallenge()) {
    return 0;
  }
  const gameData = globalScene.getPlayerGameData(playerIndex);
  const dexCount = gameData?.getSpeciesCount(d => !!d.caughtAttr) ?? 0;
  const catchingCharmMultiplier = new NumberHolder(1);
  globalScene
    .findModifierForPlayer(m => m.is("CriticalCatchChanceBoosterModifier"), playerIndex)
    ?.apply(catchingCharmMultiplier);
  const dexMultiplier =
    globalScene.gameMode.isDaily || dexCount > 800
      ? 2.5
      : dexCount > 600
        ? 2
        : dexCount > 400
          ? 1.5
          : dexCount > 200
            ? 1
            : dexCount > 100
              ? 0.5
              : 0;
  return Math.floor((catchingCharmMultiplier.value * dexMultiplier * Math.min(255, modifiedCatchRate)) / 6);
}

// TODO: fix Function annotations
export function doPokeballBounceAnim(
  pokeball: Phaser.GameObjects.Sprite,
  y1: number,
  y2: number,
  baseBounceDuration: number,
  callback: () => void,
  isCritical = false,
) {
  let bouncePower = 1;
  let bounceYOffset = y1;
  let bounceY = y2;
  const yd = y2 - y1;
  const x0 = pokeball.x;
  const x1 = x0 + 3;
  const x2 = x0 - 3;
  let critShakes = 4;

  const doBounce = () => {
    globalScene.tweens.add({
      targets: pokeball,
      y: y2,
      duration: bouncePower * baseBounceDuration,
      ease: "Cubic.easeIn",
      onComplete: () => {
        audioManager.playSound("se/pb_bounce_1", { volume: bouncePower });

        bouncePower = bouncePower > 0.01 ? bouncePower * 0.5 : 0;

        if (bouncePower) {
          bounceYOffset = yd * bouncePower;
          bounceY = y2 - bounceYOffset;

          globalScene.tweens.add({
            targets: pokeball,
            y: bounceY,
            duration: bouncePower * baseBounceDuration,
            ease: "Cubic.easeOut",
            onComplete: () => doBounce(),
          });
        } else if (callback) {
          callback();
        }
      },
    });
  };

  const doCritShake = () => {
    globalScene.tweens.add({
      targets: pokeball,
      x: x2,
      duration: 125,
      ease: "Linear",
      onComplete: () => {
        globalScene.tweens.add({
          targets: pokeball,
          x: x1,
          duration: 125,
          ease: "Linear",
          onComplete: () => {
            critShakes--;
            if (critShakes > 0) {
              doCritShake();
            } else {
              globalScene.tweens.add({
                targets: pokeball,
                x: x0,
                duration: 60,
                ease: "Linear",
                onComplete: () => globalScene.time.delayedCall(500, doBounce),
              });
            }
          },
        });
      },
    });
  };

  if (isCritical) {
    globalScene.time.delayedCall(500, doCritShake);
  } else {
    doBounce();
  }
}
