import type { PokeballCounts } from "#app/battle-scene";
import { timedEventManager } from "#app/global-event-manager";
import type { Move } from "#data/moves/move";
import { getCriticalCaptureChance, getPokeballCatchMultiplier } from "#data/pokeball";
import { getStatusEffectCatchRateMultiplier } from "#data/status-effect";
import { getTypeDamageMultiplier } from "#data/type";
import { MoveCategory } from "#enums/move-category";
import { PokeballType } from "#enums/pokeball";
import { Stat } from "#enums/stat";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import {
  type ComputerPartnerKey,
  type ComputerPartnerProfile,
  type ComputerPartnerRolePreferences,
  type ComputerPartnerSlotScore,
  getBestComputerPartnerReplacementSlot,
  getComputerPartnerProfileWithRolePreferences,
  isComputerPartnerCandidateAllowed,
} from "#utils/computer-partner-profile";

export interface ComputerPartnerCaptureDecision {
  target: EnemyPokemon;
  targetIndex: number;
  replacementScore: ComputerPartnerSlotScore;
  ballType: PokeballType;
  chance: number;
  shouldThrow: boolean;
  weakeningMoveIndex: number | undefined;
}

export interface ComputerPartnerCaptureInterest {
  target: EnemyPokemon;
  targetIndex: number;
  replacementScore: ComputerPartnerSlotScore;
}

export interface ComputerPartnerCaptureDecisionOptions {
  allowedBossTargetIds?: number | readonly number[];
  forceThrowTargetIds?: number | readonly number[];
  plannedDamageRatios?: ReadonlyMap<number, number>;
  preferredTargetIds?: number | readonly number[];
}

const PREFERRED_CATCH_CHANCE = 0.4;
const MIN_DESPERATE_CATCH_CHANCE = 0.25;
const MAX_SAFE_WEAKENING_DAMAGE_RATIO = 0.8;
const CAPTURE_BALL_ORDER = [
  PokeballType.POKEBALL,
  PokeballType.GREAT_BALL,
  PokeballType.ULTRA_BALL,
  PokeballType.ROGUE_BALL,
  PokeballType.MASTER_BALL,
] as const;

export function getComputerPartnerCaptureDecision(
  partnerKey: ComputerPartnerKey,
  party: PlayerPokemon[],
  activePokemon: PlayerPokemon,
  enemyField: EnemyPokemon[],
  pokeballCounts: PokeballCounts,
  reservedTargetIds?: number | readonly number[],
  rolePreferences?: ComputerPartnerRolePreferences,
  options: ComputerPartnerCaptureDecisionOptions = {},
): ComputerPartnerCaptureDecision | undefined {
  return getComputerPartnerCaptureDecisions(
    partnerKey,
    party,
    activePokemon,
    enemyField,
    pokeballCounts,
    reservedTargetIds,
    rolePreferences,
    options,
  )[0];
}

export function getComputerPartnerCaptureDecisions(
  partnerKey: ComputerPartnerKey,
  party: PlayerPokemon[],
  activePokemon: PlayerPokemon,
  enemyField: EnemyPokemon[],
  pokeballCounts: PokeballCounts,
  reservedTargetIds?: number | readonly number[],
  rolePreferences?: ComputerPartnerRolePreferences,
  options: ComputerPartnerCaptureDecisionOptions = {},
): ComputerPartnerCaptureDecision[] {
  const interests = getComputerPartnerCaptureInterests(
    partnerKey,
    party,
    enemyField,
    reservedTargetIds,
    rolePreferences,
    options,
  );

  return getComputerPartnerCaptureDecisionsFromInterests(
    activePokemon,
    interests,
    enemyField,
    pokeballCounts,
    reservedTargetIds,
    options,
  );
}

export function getComputerPartnerCaptureInterests(
  partnerKey: ComputerPartnerKey,
  party: PlayerPokemon[],
  enemyField: EnemyPokemon[],
  reservedTargetIds?: number | readonly number[],
  rolePreferences?: ComputerPartnerRolePreferences,
  options: ComputerPartnerCaptureDecisionOptions = {},
): ComputerPartnerCaptureInterest[] {
  const profile = getComputerPartnerProfileWithRolePreferences(partnerKey, rolePreferences);
  const reservedTargetIdSet = new Set(
    Array.isArray(reservedTargetIds)
      ? reservedTargetIds
      : reservedTargetIds === undefined
        ? []
        : [reservedTargetIds],
  );
  const allowedBossTargetIdSet = toNumberSet(options.allowedBossTargetIds);
  const forceThrowTargetIdSet = toNumberSet(options.forceThrowTargetIds);
  const preferredTargetIdSet = toNumberSet(options.preferredTargetIds);
  return enemyField
    .map((target, targetIndex) => {
      const isAllowedBossTarget = allowedBossTargetIdSet.has(target.id);
      if (
        !target.isActive(true)
        || target.isFainted()
        || (target.isBoss() && (!isAllowedBossTarget || target.bossSegmentIndex >= 1))
        || reservedTargetIdSet.has(target.id)
      ) {
        return undefined;
      }

      const replacementScore =
        getBestComputerPartnerReplacementSlot(profile, party, target)
        ?? getForcedComputerPartnerCaptureSlotScore(profile, party, target, forceThrowTargetIdSet);
      if (!replacementScore) {
        return undefined;
      }

      return {
        target,
        targetIndex,
        replacementScore,
      };
    })
    .filter((interest): interest is ComputerPartnerCaptureInterest => !!interest)
    .sort((a, b) => {
      const preferredDelta =
        Number(preferredTargetIdSet.has(b.target.id)) - Number(preferredTargetIdSet.has(a.target.id));
      if (preferredDelta) {
        return preferredDelta;
      }
      return b.replacementScore.candidateScore - a.replacementScore.candidateScore;
    });
}

export function getComputerPartnerCaptureDecisionsFromInterests(
  activePokemon: PlayerPokemon,
  interests: ComputerPartnerCaptureInterest[],
  enemyField: EnemyPokemon[],
  pokeballCounts: PokeballCounts,
  reservedTargetIds?: number | readonly number[],
  options: ComputerPartnerCaptureDecisionOptions = {},
): ComputerPartnerCaptureDecision[] {
  const reservedTargetIdSet = new Set(
    Array.isArray(reservedTargetIds)
      ? reservedTargetIds
      : reservedTargetIds === undefined
        ? []
        : [reservedTargetIds],
  );
  const allowedBossTargetIdSet = toNumberSet(options.allowedBossTargetIds);
  const forceThrowTargetIdSet = toNumberSet(options.forceThrowTargetIds);
  const preferredTargetIdSet = toNumberSet(options.preferredTargetIds);

  return interests
    .map(interest => {
      const target = enemyField.find(pokemon => pokemon.id === interest.target.id) ?? interest.target;
      const targetIndex = enemyField.indexOf(target);
      const isAllowedBossTarget = allowedBossTargetIdSet.has(target.id);
      if (
        targetIndex < 0
        || !target.isActive(true)
        || target.isFainted()
        || (target.isBoss() && (!isAllowedBossTarget || target.bossSegmentIndex >= 1))
        || reservedTargetIdSet.has(target.id)
      ) {
        return undefined;
      }

      const ballChoice = chooseComputerPartnerPokeball(
        target,
        pokeballCounts,
        forceThrowTargetIdSet.has(target.id),
      );
      if (ballChoice.ballType === undefined) {
        return undefined;
      }

      const weakeningMoveIndex =
        ballChoice.chance < PREFERRED_CATCH_CHANCE && !forceThrowTargetIdSet.has(target.id)
          ? getSafestComputerPartnerWeakeningMoveIndex(
              activePokemon,
              target,
              options.plannedDamageRatios?.get(target.id) ?? 0,
            )
          : undefined;
      const shouldThrow =
        forceThrowTargetIdSet.has(target.id)
        || ballChoice.chance >= PREFERRED_CATCH_CHANCE
        || (weakeningMoveIndex === undefined && ballChoice.chance >= MIN_DESPERATE_CATCH_CHANCE);
      if (!shouldThrow && weakeningMoveIndex === undefined) {
        return undefined;
      }

      return {
        target,
        targetIndex,
        replacementScore: interest.replacementScore,
        ballType: ballChoice.ballType,
        chance: ballChoice.chance,
        shouldThrow,
        weakeningMoveIndex,
      };
    })
    .filter((decision): decision is ComputerPartnerCaptureDecision => !!decision)
    .sort((a, b) => {
      const preferredDelta =
        Number(preferredTargetIdSet.has(b.target.id)) - Number(preferredTargetIdSet.has(a.target.id));
      if (preferredDelta) {
        return preferredDelta;
      }
      const roleDelta = b.replacementScore.candidateScore - a.replacementScore.candidateScore;
      if (roleDelta) {
        return roleDelta;
      }
      return b.chance - a.chance;
    });
}

function toNumberSet(values?: number | readonly number[]): Set<number> {
  return new Set(
    Array.isArray(values)
      ? values
      : values === undefined
        ? []
        : [values],
  );
}

function getForcedComputerPartnerCaptureSlotScore(
  profile: ComputerPartnerProfile,
  party: PlayerPokemon[],
  target: EnemyPokemon,
  forceThrowTargetIdSet: Set<number>,
): ComputerPartnerSlotScore | undefined {
  if (
    !forceThrowTargetIdSet.has(target.id)
    || party.length >= profile.roles.length
    || !isComputerPartnerCandidateAllowed(profile, target)
  ) {
    return undefined;
  }

  return {
    slotIndex: party.length,
    role: profile.roles[party.length] ?? "balanced",
    currentScore: undefined,
    candidateScore: 1,
    improvementRatio: Number.POSITIVE_INFINITY,
    canReplace: true,
    replacedPokemon: undefined,
    replacedPokemonIndex: undefined,
    currentTeamScore: 0,
    candidateTeamScore: 1,
  };
}

export function getComputerPartnerCaptureChance(pokemon: EnemyPokemon, pokeballType: PokeballType): number {
  const pokeballMultiplier = getPokeballCatchMultiplier(pokeballType);
  if (pokeballMultiplier === -1) {
    return 1;
  }

  const maxHp = pokemon.getMaxHp();
  const modifiedCatchRate = getComputerPartnerModifiedCatchRate(pokemon, pokeballType);
  if (modifiedCatchRate >= 255) {
    return 1;
  }
  if (!maxHp || modifiedCatchRate <= 0) {
    return 0;
  }

  const shakeProbability = Math.round(65536 / Math.pow(255 / modifiedCatchRate, 0.1875));
  const shakeChance = Math.min(Math.max(shakeProbability / 65536, 0), 1);
  const criticalCaptureChance = Math.min(Math.max(getCriticalCaptureChance(modifiedCatchRate, 1) / 256, 0), 1);

  return criticalCaptureChance * shakeChance + (1 - criticalCaptureChance) * Math.pow(shakeChance, 3);
}

function chooseComputerPartnerPokeball(
  pokemon: EnemyPokemon,
  pokeballCounts: PokeballCounts,
  preferBestBall = false,
): { ballType?: PokeballType; chance: number } {
  const usableBalls = CAPTURE_BALL_ORDER.filter(ballType => (pokeballCounts[ballType] ?? 0) > 0);
  if (!usableBalls.length) {
    return { chance: 0 };
  }

  const ballScores = usableBalls.map(ballType => ({
    ballType,
    chance: getComputerPartnerCaptureChance(pokemon, ballType),
  }));

  if (preferBestBall) {
    return ballScores.sort((a, b) => b.chance - a.chance)[0];
  }

  const preferredBall = ballScores.find(ballScore => ballScore.chance >= PREFERRED_CATCH_CHANCE);
  if (preferredBall) {
    return preferredBall;
  }

  return ballScores.sort((a, b) => b.chance - a.chance)[0];
}

function getComputerPartnerModifiedCatchRate(pokemon: EnemyPokemon, pokeballType: PokeballType): number {
  const maxHp = pokemon.getMaxHp();
  if (!maxHp) {
    return 0;
  }

  const hpFactor = Math.max(3 * maxHp - 2 * pokemon.hp, 1) / (3 * maxHp);
  const statusMultiplier = pokemon.status ? getStatusEffectCatchRateMultiplier(pokemon.status.effect) : 1;
  const pokeballMultiplier = getPokeballCatchMultiplier(pokeballType);
  const shinyMultiplier = pokemon.isShiny() ? timedEventManager.getShinyCatchMultiplier() : 1;

  return Math.round(hpFactor * pokemon.species.catchRate * pokeballMultiplier * statusMultiplier * shinyMultiplier);
}

function getSafestComputerPartnerWeakeningMoveIndex(
  attacker: PlayerPokemon,
  target: EnemyPokemon,
  plannedDamageRatio = 0,
): number | undefined {
  return attacker
    .getMoveset()
    .map((pokemonMove, moveIndex) => ({
      moveIndex,
      damageRatio: estimateComputerPartnerMoveDamageRatio(attacker, target, pokemonMove.getMove()),
      isUsable: !pokemonMove.isOutOfPp(),
    }))
    .filter(
      moveScore =>
        moveScore.isUsable
        && moveScore.damageRatio > 0
        && plannedDamageRatio + moveScore.damageRatio < MAX_SAFE_WEAKENING_DAMAGE_RATIO,
    )
    .sort((a, b) => b.damageRatio - a.damageRatio)[0]?.moveIndex;
}

export function isComputerPartnerMoveSafeForCaptureTarget(
  attacker: PlayerPokemon,
  target: EnemyPokemon,
  move: Move,
  plannedDamageRatio = 0,
): boolean {
  const damageRatio = estimateComputerPartnerMoveDamageRatio(attacker, target, move);
  return damageRatio <= 0 || plannedDamageRatio + damageRatio < MAX_SAFE_WEAKENING_DAMAGE_RATIO;
}

export function estimateComputerPartnerMoveDamageRatio(
  attacker: PlayerPokemon,
  target: EnemyPokemon,
  move: Move,
): number {
  if (!move.power || move.category === MoveCategory.STATUS) {
    return 0;
  }

  const moveType = attacker.getMoveType(move);
  const attackStat = move.category === MoveCategory.PHYSICAL ? Stat.ATK : Stat.SPATK;
  const defenseStat = move.category === MoveCategory.PHYSICAL ? Stat.DEF : Stat.SPDEF;
  const stab = attacker.isOfType(moveType, { includeTeraType: false }) ? 1.5 : 1;
  const effectiveness = target
    .getTypes({ includeTeraType: false })
    .reduce((multiplier, defenderType) => multiplier * getTypeDamageMultiplier(moveType, defenderType), 1);
  const roughDamage =
    ((((2 * attacker.level) / 5 + 2) * move.power * attacker.getStat(attackStat) / Math.max(target.getStat(defenseStat), 1)) / 50
      + 2)
    * stab
    * effectiveness;

  return roughDamage / Math.max(target.hp, 1);
}
