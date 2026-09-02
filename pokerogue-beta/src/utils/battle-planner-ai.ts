import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { TerrainType } from "#data/terrain";
import { getEffectiveWeatherForMove } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { FieldPosition } from "#enums/field-position";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { BATTLE_STATS, type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { type HealAttr, type Move, WeatherHealAttr } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import type { PokemonMove } from "#moves/pokemon-move";
import type { TurnMove } from "#types/turn-move";
import { getAiMoveTargetData, getAiRelevantOpponents } from "#utils/ai-targeting";
import { BooleanHolder } from "#utils/common";

const FAIL_SCORE = -100_000;
const KO_SCORE = 220;
const FUTURE_TURN_WEIGHTS = [0.65, 0.35] as const;
const EMERGENCY_SWITCH_MIN_HP_RATIO = 0.55;
const EMERGENCY_SWITCH_THREAT_HP_RATIO = 0.55;
const EMERGENCY_SWITCH_MIN_IMPROVEMENT = 0.5;
const PLANNER_IQ_PROFILES = {
  low: {
    label: "low",
    weights: [60, 30, 10],
    minScoreRatios: [1, 0.75, 0.6],
    maxScoreGaps: [0, 40, 70],
    switchThreatWeights: [1, 0, 0],
  },
  mid: {
    label: "mid",
    weights: [70, 25, 5],
    minScoreRatios: [1, 0.8, 0.65],
    maxScoreGaps: [0, 34, 58],
    switchThreatWeights: [1, 0.35, 0.15],
  },
  high: {
    label: "high",
    weights: [80, 20, 0],
    minScoreRatios: [1, 0.86, 0.72],
    maxScoreGaps: [0, 26, 44],
    switchThreatWeights: [1, 0.6, 0.25],
  },
  boss: {
    label: "boss",
    weights: [90, 10, 0],
    minScoreRatios: [1, 0.9, 0.78],
    maxScoreGaps: [0, 18, 30],
    switchThreatWeights: [1, 0.75, 0.4],
  },
} as const;
const PLANNER_DEBUG_STORAGE_KEY = "pokeroguePlannerAiDebug";
const PLANNER_DETAILED_DEBUG_STORAGE_KEY = "pokeroguePlannerAiDetailedDebug";
const PLANNER_FIELD_LOG_ORDER = [
  BattlerIndex.ENEMY,
  BattlerIndex.ENEMY_3,
  BattlerIndex.ENEMY_2,
  BattlerIndex.PLAYER,
  BattlerIndex.PLAYER_3,
  BattlerIndex.PLAYER_2,
] as const;

let plannerDebugConsoleHelperInstalled = false;

interface PlannerDebugConsoleHelper {
  enable: () => void;
  enableDetailed: () => void;
  disable: () => void;
  disableDetailed: () => void;
  toggle: () => boolean;
  toggleDetailed: () => boolean;
  isEnabled: () => boolean;
  isDetailedEnabled: () => boolean;
}

declare global {
  interface Window {
    pokeroguePlannerAiDebug?: PlannerDebugConsoleHelper;
  }
}

interface PlannerMoveChoice {
  move: PokemonMove;
  targets: BattlerIndex[];
  score: number;
  debug?: PlannerMoveDebugEvaluation;
  targetCandidates?: PlannerTargetDebugCandidate[];
  breakdown?: PlannerMoveScoreBreakdown;
}

interface PlannerTargetDebugCandidate {
  targets: BattlerIndex[];
  baseScore: number;
  breakdown?: PlannerMoveScoreBreakdown;
}

interface PlannerMoveScoreBreakdown {
  benefit: number;
  attack: number;
  status: number;
  threat: number;
  badStatus: number;
  healing: number;
  setup: number;
  sideSupport: number;
  enemyStatus: number;
  redundancy: number;
  protect: number;
}

interface PlannerMoveDebugEvaluation {
  baseScore: number;
  outcomeScore: number;
  totalScore: number;
  preventedThreatScore: number;
  survivalScore: number;
  objectiveSurvivalScore: number;
  spreadFollowupScore: number;
  wastedTurnPenalty: number;
  result: string;
  projectedHpByBattler: Partial<Record<BattlerIndex, number>>;
}

interface PlannerSearchAction {
  kind: "move";
  choice: PlannerMoveChoice;
  user: Pokemon;
  move: Move;
  targets: PlannerSearchTarget[];
  priority: number;
}

interface PlannerSearchTarget {
  pokemon: Pokemon;
  battlerIndex: BattlerIndex;
  damage: number;
  hpAfterAction: number;
  actsBeforeUser: boolean;
}

interface PlannerSearchState {
  user: PlannerSearchPokemon;
  allies: PlannerSearchPokemon[];
  opponents: PlannerSearchPokemon[];
}

interface PlannerSearchPokemon {
  pokemon: Pokemon;
  battlerIndex: BattlerIndex;
  hp: number;
  maxHp: number;
  speed: number;
  bestPriority: number;
}

interface PlannerSearchEvaluation {
  score: number;
  preventedThreatScore: number;
  survivalScore: number;
  objectiveSurvivalScore: number;
  spreadFollowupScore: number;
  wastedTurnPenalty: number;
}

interface PlannerOffensivePressure {
  maxDamageRatio: number;
  canKo: boolean;
}

interface PlannerIncomingThreat {
  attacker: Pokemon;
  move: Move;
  damage: number;
  label: string;
  moveName: string;
}

interface PlannerIncomingDamageEstimate {
  incomingDamage: number;
  incomingThreats: string;
  threats: PlannerIncomingThreat[];
  strongestThreat?: PlannerIncomingThreat;
}

interface PlannerIncomingTimeline {
  totalDamage: number;
  damageBeforeAction: number;
  damageAfterAction: number;
}

type PlannerIqProfile = (typeof PLANNER_IQ_PROFILES)[keyof typeof PLANNER_IQ_PROFILES];

export function choosePlannerMove(user: Pokemon, movePool: PokemonMove[]): TurnMove {
  installPlannerDebugConsoleHelper();

  const choices = movePool
    .flatMap(move => scorePlannerMoveCandidates(user, move))
    .filter((scoredMove): scoredMove is PlannerMoveChoice => !!scoredMove)
    .map(choice => scorePlannerChoiceByOneTurnSearch(user, choice))
    .sort((a, b) => b.score - a.score);

  const chosenMove = chooseFromBestPlannerChoices(user, choices);
  logPlannerMoveEvaluations(user, choices, chosenMove);

  if (!chosenMove) {
    const struggleTargets = getPlannerMoveTargets(user, MoveId.STRUGGLE);
    return {
      move: struggleTargets.length > 0 ? MoveId.STRUGGLE : MoveId.NONE,
      targets: struggleTargets,
      useMode: struggleTargets.length > 0 ? MoveUseMode.IGNORE_PP : MoveUseMode.NORMAL,
    };
  }

  return {
    move: chosenMove.move.moveId,
    targets: chosenMove.targets,
    useMode: MoveUseMode.NORMAL,
  };
}

export function getPlannerSwitchIndex(
  activePokemon: Pokemon,
  partyMemberScores: [number, number][],
  switchMultiplier: number,
  isBossTrainer = false,
  allyAlreadySwitching = false,
  reservedPartyIndexes: ReadonlySet<number> = new Set(),
): number | undefined {
  installPlannerDebugConsoleHelper();

  if (partyMemberScores.length === 0 || getAiRelevantOpponents(activePokemon).length === 0) {
    return;
  }

  const switchParty = getPlannerSwitchParty(activePokemon);
  const activePartyIndex = switchParty?.indexOf(activePokemon);
  if (!switchParty || activePartyIndex === undefined || activePartyIndex === -1) {
    return;
  }

  const currentScore = getAverageMatchupScore(activePokemon);
  const bestScore = Math.max(...partyMemberScores.map(([, score]) => score));
  const bestAdjustedScore = bestScore * switchMultiplier;
  const hpRatio = activePokemon.getHpRatio();
  const canThreatenKo = getAiRelevantOpponents(activePokemon)
    .some(opponent => estimateBestDamage(activePokemon, opponent).damage >= getPlannerHp(opponent, activePokemon));
  const currentIncoming = estimateIncomingDamageDetailed(activePokemon);
  const currentIncomingDamage = currentIncoming.incomingDamage;
  const likelyFaintsWithoutAction = currentIncomingDamage >= activePokemon.hp;
  const activeEscapeOption = likelyFaintsWithoutAction
    ? getActiveEmergencyEscapeOption(activePokemon, currentIncoming)
    : undefined;
  const effectiveIncomingDamage = activeEscapeOption?.projectedIncomingDamage ?? currentIncomingDamage;
  const likelyFaints = likelyFaintsWithoutAction && !activeEscapeOption;
  const activePressure = getBestOffensivePressure(activePokemon);
  const canContributeThisTurn =
    !likelyFaints && (activePressure.maxDamageRatio >= 0.18 || canThreatenKo || !!activeEscapeOption);
  const switchOutMomentumScore = scoreSwitchOutMomentum(
    activePokemon,
    activePressure,
    effectiveIncomingDamage,
    likelyFaints,
    canContributeThisTurn,
  );

  const multiplierThreshold = isBossTrainer ? 1.6 : 2.1;
  const improvement = bestAdjustedScore - currentScore;
  const adjustedImprovement = improvement - switchOutMomentumScore;
  const severeMismatch = currentScore < 4 && adjustedImprovement >= 4;
  const strongUpgrade = bestAdjustedScore >= currentScore * multiplierThreshold && adjustedImprovement >= 2;
  const preserveLowHpThreat = hpRatio < 0.35 && adjustedImprovement >= 3 && !canThreatenKo && !canContributeThisTurn;

  const candidateEvaluations = partyMemberScores
    .map(([partyIndex, score]) =>
      scoreSwitchCandidate({
        activePokemon,
        candidate: switchParty[partyIndex],
        switchParty,
        partyIndex,
        matchupScore: score,
        bestMatchupScore: bestScore,
        currentIncomingDamage,
        likelyActiveFaints: likelyFaints,
        canActiveContribute: canContributeThisTurn,
        allyAlreadySwitching,
        reservedPartyIndexes,
      }),
    )
    .filter((candidate): candidate is PlannerSwitchCandidate => !!candidate)
    .sort((a, b) => b.score - a.score);

  const viableCandidates = candidateEvaluations.filter(candidate => candidate.score > FAIL_SCORE);
  const emergencyCandidates = viableCandidates.filter(candidate => candidate.debug.emergencySafe);
  const escapeKo =
    likelyFaints && !canThreatenKo && improvement >= EMERGENCY_SWITCH_MIN_IMPROVEMENT && emergencyCandidates.length > 0;

  if (!severeMismatch && !strongUpgrade && !preserveLowHpThreat && !escapeKo) {
    const unsafeEmergencyReason =
      likelyFaints && !canThreatenKo && improvement >= EMERGENCY_SWITCH_MIN_IMPROVEMENT
        ? "; no switch-in stays healthy enough"
        : "";
    logPlannerSwitchEvaluations(activePokemon, {
      activeScore: currentScore,
      bestScore,
      bestAdjustedScore,
      switchMultiplier,
      improvement,
      adjustedImprovement,
      switchOutMomentumScore,
      currentIncomingDamage,
      currentIncomingThreats: currentIncoming.incomingThreats,
      activeEscapeOption,
      likelyFaints,
      canContributeThisTurn,
      allyAlreadySwitching,
      decision: "stay",
      reason:
        switchOutMomentumScore > 0
          ? `switch threshold not met; preserving momentum${unsafeEmergencyReason}`
          : `switch threshold not met${unsafeEmergencyReason}`,
      candidates: candidateEvaluations,
    });
    return;
  }

  const selectableCandidates = escapeKo ? emergencyCandidates : viableCandidates;
  const bestCandidateScore = selectableCandidates[0]?.score;
  if (bestCandidateScore === undefined) {
    logPlannerSwitchEvaluations(activePokemon, {
      activeScore: currentScore,
      bestScore,
      bestAdjustedScore,
      switchMultiplier,
      improvement,
      adjustedImprovement,
      switchOutMomentumScore,
      currentIncomingDamage,
      currentIncomingThreats: currentIncoming.incomingThreats,
      activeEscapeOption,
      likelyFaints,
      canContributeThisTurn,
      allyAlreadySwitching,
      decision: "stay",
      reason: "no viable switch target",
      candidates: candidateEvaluations,
    });
    return;
  }

  const bestIndexes = selectableCandidates
    .filter(candidate => candidate.score >= bestCandidateScore - 0.5)
    .map(candidate => candidate.partyIndex);

  const chosenPartyIndex = bestIndexes[globalScene.randBattleSeedInt(bestIndexes.length)];
  logPlannerSwitchEvaluations(activePokemon, {
    activeScore: currentScore,
    bestScore,
    bestAdjustedScore,
    switchMultiplier,
    improvement,
    adjustedImprovement,
    switchOutMomentumScore,
    currentIncomingDamage,
    currentIncomingThreats: currentIncoming.incomingThreats,
    activeEscapeOption,
    likelyFaints,
    canContributeThisTurn,
    allyAlreadySwitching,
    decision: `switch -> ${chosenPartyIndex}`,
    reason: escapeKo ? "emergency switch preserves a fainting active" : "switch threshold met",
    candidates: candidateEvaluations,
    chosenPartyIndex,
  });

  return chosenPartyIndex;
}

export function getPlannerRepositionTarget(
  activePokemon: Pokemon,
  allyAlreadyRepositioning = false,
): FieldPosition | undefined {
  installPlannerDebugConsoleHelper();

  if (
    globalScene.twoPlayerVsMode
    || (globalScene.currentBattle?.getBattlerCount() ?? 1) < 3
    || getAiRelevantOpponents(activePokemon).length === 0
  ) {
    return;
  }

  const activeAllies = getActiveSidePokemon(activePokemon, true).filter(
    ally => ally !== activePokemon && ally.fieldPosition !== activePokemon.fieldPosition,
  );
  if (activeAllies.length === 0) {
    return;
  }

  const activeBefore = getPlannerLaneState(activePokemon);
  const activeCanContribute = activeBefore.pressure >= 0.22 || activeBefore.canKo;
  const activeNeedsHelp =
    activeBefore.likelyFaints
    || activeBefore.incomingDamage >= activePokemon.hp * 0.55
    || activeBefore.matchupScore < 2.2
    || !activeCanContribute;

  const candidates = activeAllies
    .map(ally => scorePlannerRepositionCandidate(activePokemon, ally, activeBefore))
    .sort((a, b) => b.score - a.score);

  const viableCandidates = candidates.filter(candidate => candidate.score > FAIL_SCORE);
  const bestCandidate = viableCandidates[0];
  const shouldReposition =
    !allyAlreadyRepositioning
    && activeNeedsHelp
    && bestCandidate
    && bestCandidate.debug.activeGain >= (activeBefore.likelyFaints ? 0.7 : 1.2)
    && bestCandidate.debug.totalGain >= (activeBefore.likelyFaints ? 0.4 : 1.4);

  if (!shouldReposition || !bestCandidate) {
    logPlannerRepositionEvaluations(activePokemon, {
      activeBefore,
      allyAlreadyRepositioning,
      decision: "stay",
      reason: allyAlreadyRepositioning
        ? "ally already repositioning"
        : activeNeedsHelp
          ? "no safe ally lane swap"
          : "current lane is acceptable",
      candidates,
    });
    return;
  }

  const bestScore = bestCandidate.score;
  const bestTargets = viableCandidates.filter(candidate => candidate.score >= bestScore - 0.4);
  const chosenCandidate = bestTargets[globalScene.randBattleSeedInt(bestTargets.length)];
  logPlannerRepositionEvaluations(activePokemon, {
    activeBefore,
    allyAlreadyRepositioning,
    decision: `switch to ${formatPlannerFieldPosition(chosenCandidate.targetPosition)}`,
    reason: "active ally has a better lane matchup",
    candidates,
    chosenTargetPosition: chosenCandidate.targetPosition,
  });

  return chosenCandidate.targetPosition;
}

interface PlannerSwitchCandidate {
  partyIndex: number;
  score: number;
  debug: PlannerSwitchCandidateDebug;
}

interface PlannerSwitchCandidateDebug {
  pokemonName: string;
  matchupScore: number;
  incomingDamage: number;
  incomingThreats: string;
  hpAfterSwitch: number;
  hpAfterSwitchRatio: number;
  switchInDamageRatio: number;
  pressure: number;
  canKo: boolean;
  canTakeFollowup: boolean;
  emergencySafe: boolean;
  reasons: string[];
}

interface PlannerSwitchDebugSummary {
  activeScore: number;
  bestScore: number;
  bestAdjustedScore: number;
  switchMultiplier: number;
  improvement: number;
  adjustedImprovement: number;
  switchOutMomentumScore: number;
  currentIncomingDamage: number;
  currentIncomingThreats: string;
  activeEscapeOption: PlannerActiveEscapeOption | undefined;
  likelyFaints: boolean;
  canContributeThisTurn: boolean;
  allyAlreadySwitching: boolean;
  decision: string;
  reason: string;
  candidates: PlannerSwitchCandidate[];
  chosenPartyIndex?: number;
}

interface PlannerActiveEscapeOption {
  label: string;
  projectedIncomingDamage: number;
}

interface PlannerLaneState {
  score: number;
  matchupScore: number;
  incomingDamage: number;
  incomingThreats: string;
  hpAfter: number;
  hpAfterRatio: number;
  pressure: number;
  canKo: boolean;
  likelyFaints: boolean;
  canTakeFollowup: boolean;
}

interface PlannerRepositionCandidate {
  targetPosition: FieldPosition;
  ally: Pokemon;
  score: number;
  debug: PlannerRepositionCandidateDebug;
}

interface PlannerRepositionCandidateDebug {
  allyName: string;
  from: FieldPosition;
  to: FieldPosition;
  activeBefore: PlannerLaneState;
  activeAfter: PlannerLaneState;
  allyBefore: PlannerLaneState;
  allyAfter: PlannerLaneState;
  activeGain: number;
  allyDelta: number;
  totalGain: number;
  reasons: string[];
}

interface PlannerRepositionDebugSummary {
  activeBefore: PlannerLaneState;
  allyAlreadyRepositioning: boolean;
  decision: string;
  reason: string;
  candidates: PlannerRepositionCandidate[];
  chosenTargetPosition?: FieldPosition;
}

interface PlannerSwitchCandidateContext {
  activePokemon: Pokemon;
  candidate?: Pokemon;
  switchParty: Pokemon[];
  partyIndex: number;
  matchupScore: number;
  bestMatchupScore: number;
  currentIncomingDamage: number;
  likelyActiveFaints: boolean;
  canActiveContribute: boolean;
  allyAlreadySwitching: boolean;
  reservedPartyIndexes: ReadonlySet<number>;
}

function scoreSwitchOutMomentum(
  activePokemon: Pokemon,
  activePressure: PlannerOffensivePressure,
  currentIncomingDamage: number,
  likelyFaints: boolean,
  canContributeThisTurn: boolean,
): number {
  const offensiveMomentum =
    scorePositiveStatStageMomentum(activePokemon, Stat.ATK, 1.35)
    + scorePositiveStatStageMomentum(activePokemon, Stat.SPATK, 1.35);
  const defensiveMomentum =
    scorePositiveStatStageMomentum(activePokemon, Stat.DEF, 0.75)
    + scorePositiveStatStageMomentum(activePokemon, Stat.SPDEF, 0.75);
  const utilityMomentum =
    scorePositiveStatStageMomentum(activePokemon, Stat.SPD, 0.55)
    + scorePositiveStatStageMomentum(activePokemon, Stat.ACC, 0.35)
    + scorePositiveStatStageMomentum(activePokemon, Stat.EVA, 0.55);
  const pressureMomentum = Math.min(2.5, activePressure.maxDamageRatio * 2.2) + (activePressure.canKo ? 2.5 : 0);
  const damagePressure =
    currentIncomingDamage > 0 ? Math.min(1, currentIncomingDamage / Math.max(1, activePokemon.hp)) : 0;
  const survivalMultiplier = likelyFaints ? 0.35 : 1 - damagePressure * 0.2;
  const contributionMultiplier = canContributeThisTurn ? 1 : 0.45;

  return clampPlannerScore(
    (offensiveMomentum + defensiveMomentum + utilityMomentum + pressureMomentum)
      * survivalMultiplier
      * contributionMultiplier,
    0,
    12,
  );
}

function scorePositiveStatStageMomentum(pokemon: Pokemon, stat: BattleStat, weight: number): number {
  const stage = Math.max(0, pokemon.getStatStage(stat));
  if (stage === 0) {
    return 0;
  }

  return (getStatStageMultiplier(stage) - 1) * weight;
}

function scorePlannerRepositionCandidate(
  activePokemon: Pokemon,
  ally: Pokemon,
  activeBefore: PlannerLaneState,
): PlannerRepositionCandidate {
  const allyBefore = getPlannerLaneState(ally);
  const targetPosition = ally.fieldPosition;
  const debug: PlannerRepositionCandidateDebug = {
    allyName: getPlannerPokemonLabel(ally),
    from: activePokemon.fieldPosition,
    to: targetPosition,
    activeBefore,
    activeAfter: activeBefore,
    allyBefore,
    allyAfter: allyBefore,
    activeGain: 0,
    allyDelta: 0,
    totalGain: 0,
    reasons: [],
  };

  const swapResult = withPlannerFieldPositionSimulation(activePokemon, ally, () => ({
    activeAfter: getPlannerLaneState(activePokemon),
    allyAfter: getPlannerLaneState(ally),
  }));

  debug.activeAfter = swapResult.activeAfter;
  debug.allyAfter = swapResult.allyAfter;
  debug.activeGain = swapResult.activeAfter.score - activeBefore.score;
  debug.allyDelta = swapResult.allyAfter.score - allyBefore.score;
  debug.totalGain = debug.activeGain + debug.allyDelta * 0.75;

  const sacrificesHealthyAlly =
    swapResult.allyAfter.likelyFaints && !allyBefore.likelyFaints && !swapResult.allyAfter.canKo;
  const cripplesAlly =
    swapResult.allyAfter.hpAfterRatio < 0.35
    && swapResult.allyAfter.hpAfterRatio < allyBefore.hpAfterRatio - 0.2
    && !swapResult.allyAfter.canKo;
  const worsensActive =
    swapResult.activeAfter.hpAfterRatio < activeBefore.hpAfterRatio - 0.15 && !swapResult.activeAfter.canKo;

  if (sacrificesHealthyAlly) {
    debug.reasons.push("would sacrifice ally");
    return { targetPosition, ally, score: FAIL_SCORE, debug };
  }

  if (cripplesAlly) {
    debug.reasons.push("would leave ally too low");
    return { targetPosition, ally, score: FAIL_SCORE, debug };
  }

  if (worsensActive) {
    debug.reasons.push("worsens active lane");
    return { targetPosition, ally, score: FAIL_SCORE, debug };
  }

  let score = debug.totalGain;
  score += activeBefore.likelyFaints && !swapResult.activeAfter.likelyFaints ? 3 : 0;
  score += swapResult.activeAfter.canKo && !activeBefore.canKo ? 1.5 : 0;
  score += swapResult.allyAfter.canKo && !allyBefore.canKo ? 0.8 : 0;
  score -= swapResult.allyAfter.likelyFaints ? 2.5 : 0;
  debug.reasons.push("viable");

  return { targetPosition, ally, score, debug };
}

function getPlannerLaneState(pokemon: Pokemon): PlannerLaneState {
  const incoming = estimateIncomingDamageDetailed(pokemon);
  const offensivePressure = getBestOffensivePressure(pokemon);
  const hpAfter = pokemon.hp - incoming.incomingDamage;
  const hpAfterRatio = pokemon.getMaxHp() > 0 ? hpAfter / pokemon.getMaxHp() : 0;
  const incomingRatio = pokemon.hp > 0 ? incoming.incomingDamage / pokemon.hp : 0;
  const likelyFaints = incoming.incomingDamage >= pokemon.hp;
  const canTakeFollowup = hpAfter > incoming.incomingDamage && hpAfterRatio >= 0.25;
  const matchupScore = getAverageMatchupScore(pokemon);
  const score =
    matchupScore * 2.2
    + offensivePressure.maxDamageRatio * 5
    + (offensivePressure.canKo ? 3.2 : 0)
    + clampPlannerScore(hpAfterRatio, 0, 1) * 2
    - clampPlannerScore(incomingRatio * 5, 0, 10)
    - (likelyFaints ? 6 : 0)
    + (canTakeFollowup ? 0.8 : 0);

  return {
    score,
    matchupScore,
    incomingDamage: incoming.incomingDamage,
    incomingThreats: incoming.incomingThreats,
    hpAfter,
    hpAfterRatio,
    pressure: offensivePressure.maxDamageRatio,
    canKo: offensivePressure.canKo,
    likelyFaints,
    canTakeFollowup,
  };
}

function withPlannerFieldPositionSimulation<T>(activePokemon: Pokemon, ally: Pokemon, callback: () => T): T {
  const activePosition = activePokemon.fieldPosition;
  const allyPosition = ally.fieldPosition;
  activePokemon.fieldPosition = allyPosition;
  ally.fieldPosition = activePosition;
  try {
    return callback();
  } finally {
    activePokemon.fieldPosition = activePosition;
    ally.fieldPosition = allyPosition;
  }
}

function scoreSwitchCandidate(context: PlannerSwitchCandidateContext): PlannerSwitchCandidate | undefined {
  const {
    activePokemon,
    candidate,
    switchParty,
    partyIndex,
    matchupScore,
    bestMatchupScore,
    currentIncomingDamage,
    likelyActiveFaints,
    canActiveContribute,
    allyAlreadySwitching,
    reservedPartyIndexes,
  } = context;

  if (!candidate) {
    return;
  }

  const debug: PlannerSwitchCandidateDebug = {
    pokemonName: getPlannerPokemonLabel(candidate),
    matchupScore,
    incomingDamage: 0,
    incomingThreats: "",
    hpAfterSwitch: candidate.hp,
    hpAfterSwitchRatio: candidate.getHpRatio(),
    switchInDamageRatio: 0,
    pressure: 0,
    canKo: false,
    canTakeFollowup: false,
    emergencySafe: false,
    reasons: [],
  };

  if (reservedPartyIndexes.has(partyIndex)) {
    debug.reasons.push("reserved by ally switch");
    return { partyIndex, score: FAIL_SCORE, debug };
  }

  if (!candidate.isAllowedInBattle() || candidate.isOnField()) {
    return;
  }

  const switchIn = evaluateSwitchIn(activePokemon, candidate, switchParty);
  if (!switchIn) {
    return;
  }

  const hpAfterSwitch = candidate.hp - switchIn.incomingDamage;
  const hpAfterSwitchRatio = candidate.getMaxHp() > 0 ? hpAfterSwitch / candidate.getMaxHp() : 0;
  const switchInDamageRatio = candidate.hp > 0 ? switchIn.incomingDamage / candidate.hp : 1;
  const getsKoedOnEntry = hpAfterSwitch <= 0;
  const getsCrippledOnEntry = hpAfterSwitchRatio < 0.28;
  const candidateHasPlan = switchIn.offensivePressure.maxDamageRatio >= 0.22 || switchIn.offensivePressure.canKo;
  const canTakeFollowup = hpAfterSwitch > switchIn.incomingDamage;
  const hasImmediateThreat = switchIn.offensivePressure.canKo || switchIn.offensivePressure.maxDamageRatio >= 0.5;
  const emergencySafe =
    (hpAfterSwitchRatio >= EMERGENCY_SWITCH_MIN_HP_RATIO && (canTakeFollowup || hasImmediateThreat))
    || (hpAfterSwitchRatio >= EMERGENCY_SWITCH_THREAT_HP_RATIO && hasImmediateThreat && canTakeFollowup);
  const candidateIsBestMatchup = matchupScore === bestMatchupScore;
  debug.incomingDamage = switchIn.incomingDamage;
  debug.incomingThreats = switchIn.incomingThreats;
  debug.hpAfterSwitch = hpAfterSwitch;
  debug.hpAfterSwitchRatio = hpAfterSwitchRatio;
  debug.switchInDamageRatio = switchInDamageRatio;
  debug.pressure = switchIn.offensivePressure.maxDamageRatio;
  debug.canKo = switchIn.offensivePressure.canKo;
  debug.canTakeFollowup = canTakeFollowup;
  debug.emergencySafe = emergencySafe;

  if (getsKoedOnEntry) {
    debug.reasons.push("KO on entry");
    return { partyIndex, score: FAIL_SCORE, debug };
  }

  if (canActiveContribute && getsCrippledOnEntry && !candidateHasPlan) {
    debug.reasons.push("crippled on entry without enough pressure");
    return { partyIndex, score: FAIL_SCORE, debug };
  }

  if (canActiveContribute && switchIn.incomingDamage >= currentIncomingDamage * 0.85 && !candidateHasPlan) {
    debug.reasons.push("takes similar damage without enough pressure");
    return { partyIndex, score: FAIL_SCORE, debug };
  }

  if (allyAlreadySwitching && canActiveContribute && !likelyActiveFaints) {
    debug.reasons.push("ally already switching");
    return { partyIndex, score: FAIL_SCORE, debug };
  }

  let score = matchupScore * 3;
  score += candidateIsBestMatchup ? 2 : 0;
  score += switchIn.offensivePressure.canKo ? 3 : switchIn.offensivePressure.maxDamageRatio * 4;
  score += likelyActiveFaints && emergencySafe ? 6 : 0;
  score += likelyActiveFaints && !emergencySafe && hpAfterSwitchRatio > 0.45 ? 2 : 0;
  score -= switchInDamageRatio * 7;
  score -= getsCrippledOnEntry ? 4 : 0;
  score -= canActiveContribute ? 3 : 0;
  score -= allyAlreadySwitching ? 2 : 0;
  debug.reasons.push("viable");

  return { partyIndex, score, debug };
}

function evaluateSwitchIn(
  activePokemon: Pokemon,
  candidate: Pokemon,
  switchParty: Pokemon[],
): { incomingDamage: number; incomingThreats: string; offensivePressure: PlannerOffensivePressure } | undefined {
  const switchIncomingDamage = estimateSwitchIncomingDamage(activePokemon, candidate);
  return withPlannerPartySlotSimulation(activePokemon, candidate, switchParty, () => ({
    ...switchIncomingDamage,
    offensivePressure: getBestOffensivePressure(candidate),
  }));
}

function getPlannerSwitchParty(activePokemon: Pokemon): Pokemon[] | undefined {
  if (activePokemon.isPlayer()) {
    const playerIndex = globalScene.getPlayerIndexForPokemon(activePokemon);
    return playerIndex === undefined ? undefined : (globalScene.getPlayerParty(playerIndex) as unknown as Pokemon[]);
  }

  return globalScene.getEnemyParty() as unknown as Pokemon[];
}

function withEnemyPartySlotSimulation<T>(activePokemon: Pokemon, candidate: Pokemon, callback: () => T): T | undefined {
  return withPlannerPartySlotSimulation(
    activePokemon,
    candidate,
    globalScene.getEnemyParty() as unknown as Pokemon[],
    callback,
  );
}

function withPlannerPartySlotSimulation<T>(
  activePokemon: Pokemon,
  candidate: Pokemon,
  switchParty: Pokemon[],
  callback: () => T,
): T | undefined {
  const activePartyIndex = switchParty.indexOf(activePokemon);
  const candidatePartyIndex = switchParty.indexOf(candidate);

  if (activePartyIndex === -1 || candidatePartyIndex === -1 || activePartyIndex === candidatePartyIndex) {
    return;
  }

  switchParty[activePartyIndex] = candidate;
  switchParty[candidatePartyIndex] = activePokemon;
  try {
    return callback();
  } finally {
    switchParty[activePartyIndex] = activePokemon;
    switchParty[candidatePartyIndex] = candidate;
  }
}

function scorePlannerMoveCandidates(user: Pokemon, pokemonMove: PokemonMove): PlannerMoveChoice[] {
  const move = pokemonMove.getMove();
  if (!move) {
    return [];
  }

  const targetData = getAiMoveTargetData(user, move.id);
  if (targetData.lacksRequiredOpponent) {
    return [];
  }

  const { targetSet } = targetData;
  const targets = targetSet.multiple ? targetData.allTargets : targetData.selectableTargets;

  if (targetSet.multiple) {
    const targetIndexes = targets.map(fieldTarget => fieldTarget.getBattlerIndex());
    const scores = targets.map(fieldTarget => scoreMoveAgainstTargetDetailed(user, fieldTarget, move));
    const score = scores.reduce((total, targetScore) => total + targetScore.score, 0);
    const breakdown = mergePlannerMoveScoreBreakdowns(scores.map(targetScore => targetScore.breakdown));
    return [
      {
        move: pokemonMove,
        targets: targetIndexes,
        score,
        targetCandidates: [
          {
            targets: targetIndexes,
            baseScore: score,
            breakdown,
          },
        ],
        breakdown,
      },
    ];
  }

  if (targets.length === 0) {
    if (move.hasAttr("CounterDamageAttr")) {
      return [
        {
          move: pokemonMove,
          targets: [BattlerIndex.ATTACKER],
          score: 30,
          targetCandidates: [{ targets: [BattlerIndex.ATTACKER], baseScore: 30 }],
        },
      ];
    }

    return [];
  }

  const targetScores = targets
    .map(fieldTarget => {
      const targetScore = scoreMoveAgainstTargetDetailed(user, fieldTarget, move);
      return {
        battlerIndex: fieldTarget.getBattlerIndex(),
        score: targetScore.score,
        breakdown: targetScore.breakdown,
      };
    })
    .sort((a, b) => b.score - a.score);

  return targetScores.map(targetScore => ({
    move: pokemonMove,
    targets: [targetScore.battlerIndex],
    score: targetScore.score,
    breakdown: targetScore.breakdown,
    targetCandidates: targetScores.map(candidate => ({
      targets: [candidate.battlerIndex],
      baseScore: candidate.score,
      breakdown: candidate.breakdown,
    })),
  }));
}

function scorePlannerChoiceByOneTurnSearch(user: Pokemon, choice: PlannerMoveChoice): PlannerMoveChoice {
  const move = choice.move.getMove();
  if (!move) {
    return choice;
  }

  try {
    const state = createPlannerSearchState(user);
    const action = createPlannerSearchAction(user, choice, move);
    const evaluation = evaluatePlannerSearchAction(state, action);
    const totalScore = choice.score + evaluation.score;

    return {
      ...choice,
      score: totalScore,
      debug: {
        baseScore: choice.score,
        outcomeScore: evaluation.score,
        totalScore,
        preventedThreatScore: evaluation.preventedThreatScore,
        survivalScore: evaluation.survivalScore,
        objectiveSurvivalScore: evaluation.objectiveSurvivalScore,
        spreadFollowupScore: evaluation.spreadFollowupScore,
        wastedTurnPenalty: evaluation.wastedTurnPenalty,
        result: getPlannerActionResultText(action),
        projectedHpByBattler: getPlannerProjectedHpByBattler(action),
      },
    };
  } catch {
    return choice;
  }
}

function installPlannerDebugConsoleHelper(): void {
  if (plannerDebugConsoleHelperInstalled || typeof window === "undefined") {
    return;
  }

  plannerDebugConsoleHelperInstalled = true;
  window.pokeroguePlannerAiDebug = {
    enable: () => {
      setPlannerDebugEnabled(true);
      console.info("[Planner AI] Debug logging enabled.");
    },
    enableDetailed: () => {
      setPlannerDebugEnabled(true);
      setPlannerDetailedDebugEnabled(true);
      console.info("[Planner AI] Detailed debug logging enabled.");
    },
    disable: () => {
      setPlannerDebugEnabled(false);
      setPlannerDetailedDebugEnabled(false);
      console.info("[Planner AI] Debug logging disabled.");
    },
    disableDetailed: () => {
      setPlannerDetailedDebugEnabled(false);
      console.info("[Planner AI] Detailed debug logging disabled.");
    },
    toggle: () => {
      const enabled = !isPlannerDebugEnabled();
      setPlannerDebugEnabled(enabled);
      if (!enabled) {
        setPlannerDetailedDebugEnabled(false);
      }
      console.info(`[Planner AI] Debug logging ${enabled ? "enabled" : "disabled"}.`);
      return enabled;
    },
    toggleDetailed: () => {
      const enabled = !isPlannerDetailedDebugEnabled();
      setPlannerDebugEnabled(enabled || isPlannerDebugEnabled());
      setPlannerDetailedDebugEnabled(enabled);
      console.info(`[Planner AI] Detailed debug logging ${enabled ? "enabled" : "disabled"}.`);
      return enabled;
    },
    isEnabled: () => isPlannerDebugEnabled(),
    isDetailedEnabled: () => isPlannerDetailedDebugEnabled(),
  };
}

function setPlannerDebugEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PLANNER_DEBUG_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore localStorage failures; the helper is only for manual debugging.
  }
}

function isPlannerDebugEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(PLANNER_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setPlannerDetailedDebugEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(PLANNER_DETAILED_DEBUG_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore localStorage failures; the helper is only for manual debugging.
  }
}

function isPlannerDetailedDebugEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(PLANNER_DETAILED_DEBUG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function logPlannerMoveEvaluations(
  user: Pokemon,
  choices: PlannerMoveChoice[],
  chosenMove: PlannerMoveChoice | undefined,
): void {
  if (!isPlannerDebugEnabled()) {
    return;
  }

  const chosenLabel = chosenMove
    ? `${chosenMove.move.getName()} -> ${formatPlannerTargets(chosenMove.targets)}`
    : "none";
  const iqProfile = getPlannerIqProfile(user);
  const iqWeights = new Map(
    getPlannerIqEligibleChoices(getPlannerIqViableChoices(choices), iqProfile).map(rankedChoice => [
      rankedChoice.choice,
      rankedChoice.weight,
    ]),
  );
  console.groupCollapsed(
    `[Planner AI] ${getPlannerPokemonLabel(user)} evaluated ${choices.length} choices; IQ ${iqProfile.label}; chose ${chosenLabel}`,
  );
  console.table(
    choices.map((choice, index) => ({
      rank: index + 1,
      iqWeight: iqWeights.get(choice) ?? 0,
      move: choice.move.getName(),
      target: formatPlannerTargets(choice.targets),
      result: choice.debug?.result ?? "fallback score only",
      base: formatPlannerScore(choice.debug?.baseScore ?? choice.score),
      search: formatPlannerScore(choice.debug?.outcomeScore ?? 0),
      total: formatPlannerScore(choice.score),
      prevented: formatPlannerScore(choice.debug?.preventedThreatScore ?? 0),
      survival: formatPlannerScore(choice.debug?.survivalScore ?? 0),
      objective: formatPlannerScore(choice.debug?.objectiveSurvivalScore ?? 0),
      spread: formatPlannerScore(choice.debug?.spreadFollowupScore ?? 0),
      wasted: formatPlannerScore(choice.debug?.wastedTurnPenalty ?? 0),
      ...getPlannerBreakdownColumns(choice.breakdown),
      ...getPlannerProjectedHpColumns(choice),
    })),
  );
  if (isPlannerDetailedDebugEnabled()) {
    console.table(getPlannerDetailedTargetRows(user, choices, chosenMove));
  }
  console.table(getPlannerStatStageRows());
  console.groupEnd();
}

function logPlannerSwitchEvaluations(activePokemon: Pokemon, summary: PlannerSwitchDebugSummary): void {
  if (!isPlannerDebugEnabled()) {
    return;
  }

  console.groupCollapsed(
    `[Planner AI] ${getPlannerPokemonLabel(activePokemon)} switch check: ${summary.decision} (${summary.reason})`,
  );
  console.table([
    {
      active: getPlannerPokemonLabel(activePokemon),
      activeScore: formatPlannerScore(summary.activeScore),
      bestScore: formatPlannerScore(summary.bestScore),
      bestAdjusted: formatPlannerScore(summary.bestAdjustedScore),
      multiplier: formatPlannerScore(summary.switchMultiplier),
      improvement: formatPlannerScore(summary.improvement),
      adjusted: formatPlannerScore(summary.adjustedImprovement),
      momentumCost: formatPlannerScore(summary.switchOutMomentumScore),
      incoming: formatPlannerScore(summary.currentIncomingDamage),
      incomingHits: summary.currentIncomingThreats,
      escape: summary.activeEscapeOption?.label ?? "",
      likelyFaints: summary.likelyFaints,
      canAct: summary.canContributeThisTurn,
      allySwitching: summary.allyAlreadySwitching,
      decision: summary.decision,
      reason: summary.reason,
    },
  ]);
  console.table(
    summary.candidates.map(candidate => ({
      chosen: candidate.partyIndex === summary.chosenPartyIndex,
      partyIndex: candidate.partyIndex,
      pokemon: candidate.debug.pokemonName,
      score: formatPlannerScore(candidate.score),
      matchup: formatPlannerScore(candidate.debug.matchupScore),
      incoming: formatPlannerScore(candidate.debug.incomingDamage),
      incomingHits: candidate.debug.incomingThreats,
      hpAfter: formatPlannerScore(candidate.debug.hpAfterSwitch),
      hpRatio: formatPlannerScore(candidate.debug.hpAfterSwitchRatio),
      dmgRatio: formatPlannerScore(candidate.debug.switchInDamageRatio),
      pressure: formatPlannerScore(candidate.debug.pressure),
      canKo: candidate.debug.canKo,
      canTakeFollowup: candidate.debug.canTakeFollowup,
      emergencySafe: candidate.debug.emergencySafe,
      reasons: candidate.debug.reasons.join(", "),
    })),
  );
  console.groupEnd();
}

function logPlannerRepositionEvaluations(activePokemon: Pokemon, summary: PlannerRepositionDebugSummary): void {
  if (!isPlannerDebugEnabled()) {
    return;
  }

  console.groupCollapsed(
    `[Planner AI] ${getPlannerPokemonLabel(activePokemon)} lane switch check: ${summary.decision} (${summary.reason})`,
  );
  console.table([
    {
      active: getPlannerPokemonLabel(activePokemon),
      position: formatPlannerFieldPosition(activePokemon.fieldPosition),
      score: formatPlannerScore(summary.activeBefore.score),
      matchup: formatPlannerScore(summary.activeBefore.matchupScore),
      incoming: formatPlannerScore(summary.activeBefore.incomingDamage),
      incomingHits: summary.activeBefore.incomingThreats,
      hpAfter: formatPlannerScore(summary.activeBefore.hpAfter),
      hpRatio: formatPlannerScore(summary.activeBefore.hpAfterRatio),
      pressure: formatPlannerScore(summary.activeBefore.pressure),
      canKo: summary.activeBefore.canKo,
      likelyFaints: summary.activeBefore.likelyFaints,
      allyRepositioning: summary.allyAlreadyRepositioning,
      decision: summary.decision,
      reason: summary.reason,
    },
  ]);
  console.table(
    summary.candidates.map(candidate => ({
      chosen: candidate.targetPosition === summary.chosenTargetPosition,
      ally: candidate.debug.allyName,
      swapTo: formatPlannerFieldPosition(candidate.targetPosition),
      score: formatPlannerScore(candidate.score),
      activeGain: formatPlannerScore(candidate.debug.activeGain),
      allyDelta: formatPlannerScore(candidate.debug.allyDelta),
      totalGain: formatPlannerScore(candidate.debug.totalGain),
      activeAfter: formatPlannerScore(candidate.debug.activeAfter.score),
      activeIncoming: formatPlannerScore(candidate.debug.activeAfter.incomingDamage),
      activeHits: candidate.debug.activeAfter.incomingThreats,
      activeHpRatio: formatPlannerScore(candidate.debug.activeAfter.hpAfterRatio),
      allyAfter: formatPlannerScore(candidate.debug.allyAfter.score),
      allyIncoming: formatPlannerScore(candidate.debug.allyAfter.incomingDamage),
      allyHits: candidate.debug.allyAfter.incomingThreats,
      allyHpRatio: formatPlannerScore(candidate.debug.allyAfter.hpAfterRatio),
      allyCanKo: candidate.debug.allyAfter.canKo,
      reasons: candidate.debug.reasons.join(", "),
    })),
  );
  console.groupEnd();
}

function getPlannerDetailedTargetRows(
  user: Pokemon,
  choices: PlannerMoveChoice[],
  chosenMove: PlannerMoveChoice | undefined,
): Record<string, string | number | boolean>[] {
  return choices.flatMap(choice => {
    const candidates = choice.targetCandidates ?? [
      { targets: choice.targets, baseScore: choice.debug?.baseScore ?? choice.score },
    ];

    return candidates.map(candidate => {
      const candidateChoice = scorePlannerChoiceByOneTurnSearch(user, {
        move: choice.move,
        targets: candidate.targets,
        score: candidate.baseScore,
        ...(candidate.breakdown ? { breakdown: candidate.breakdown } : {}),
      });
      const selectedForMove = areBattlerTargetsEqual(candidate.targets, choice.targets);
      const finalChoice = choice === chosenMove && selectedForMove;

      return {
        move: choice.move.getName(),
        candidateTarget: formatPlannerTargets(candidate.targets),
        selectedForMove,
        finalChoice,
        result: candidateChoice.debug?.result ?? "fallback score only",
        base: formatPlannerScore(candidateChoice.debug?.baseScore ?? candidateChoice.score),
        search: formatPlannerScore(candidateChoice.debug?.outcomeScore ?? 0),
        total: formatPlannerScore(candidateChoice.score),
        prevented: formatPlannerScore(candidateChoice.debug?.preventedThreatScore ?? 0),
        survival: formatPlannerScore(candidateChoice.debug?.survivalScore ?? 0),
        objective: formatPlannerScore(candidateChoice.debug?.objectiveSurvivalScore ?? 0),
        spread: formatPlannerScore(candidateChoice.debug?.spreadFollowupScore ?? 0),
        wasted: formatPlannerScore(candidateChoice.debug?.wastedTurnPenalty ?? 0),
        ...getPlannerBreakdownColumns(candidate.breakdown),
        ...getPlannerProjectedHpColumns(candidateChoice),
      };
    });
  });
}

function getPlannerBreakdownColumns(breakdown: PlannerMoveScoreBreakdown | undefined): Record<string, number> {
  return {
    benefit: formatPlannerScore(breakdown?.benefit ?? 0),
    attack: formatPlannerScore(breakdown?.attack ?? 0),
    status: formatPlannerScore(breakdown?.status ?? 0),
    threat: formatPlannerScore(breakdown?.threat ?? 0),
    badStatus: formatPlannerScore(breakdown?.badStatus ?? 0),
    heal: formatPlannerScore(breakdown?.healing ?? 0),
    setup: formatPlannerScore(breakdown?.setup ?? 0),
    side: formatPlannerScore(breakdown?.sideSupport ?? 0),
    enemyStatus: formatPlannerScore(breakdown?.enemyStatus ?? 0),
    redundant: formatPlannerScore(breakdown?.redundancy ?? 0),
    protect: formatPlannerScore(breakdown?.protect ?? 0),
  };
}

function areBattlerTargetsEqual(left: BattlerIndex[], right: BattlerIndex[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((target, index) => target === right[index]);
}

function getPlannerActionResultText(action: PlannerSearchAction): string {
  if (action.targets.length === 0) {
    return "No direct target";
  }

  return action.targets
    .map(target => {
      const previousHp = Math.max(0, target.pokemon.hp);
      const nextHp = getProjectedHpAfterDirectHealing(
        action.user,
        target.pokemon,
        action.move,
        action.targets,
        target.hpAfterAction,
      );
      const healed = Math.max(0, nextHp - previousHp);
      const koText = previousHp > 0 && nextHp <= 0 ? ", KO before action" : "";
      const healText = healed > 0 ? `, ${healed} heal` : "";
      return `${getBattlerLogLabel(target.battlerIndex)} ${getPlannerPokemonLabel(target.pokemon)}: ${previousHp}->${nextHp} HP, ${target.damage} dmg${healText}${koText}`;
    })
    .join("; ");
}

function getPlannerProjectedHpByBattler(action: PlannerSearchAction): Partial<Record<BattlerIndex, number>> {
  return action.targets.reduce<Partial<Record<BattlerIndex, number>>>((projectedHp, target) => {
    projectedHp[target.battlerIndex] = getProjectedHpAfterDirectHealing(
      action.user,
      target.pokemon,
      action.move,
      action.targets,
      target.hpAfterAction,
    );
    return projectedHp;
  }, {});
}

function getPlannerProjectedHpColumns(choice: PlannerMoveChoice): Record<string, string> {
  return PLANNER_FIELD_LOG_ORDER.reduce<Record<string, string>>((columns, battlerIndex) => {
    const pokemon = getPokemonAtBattlerIndex(battlerIndex);
    columns[getBattlerLogLabel(battlerIndex)] = pokemon
      ? formatPlannerHpForLog(pokemon, choice.debug?.projectedHpByBattler[battlerIndex])
      : "--";
    return columns;
  }, {});
}

function getPlannerStatStageRows(): Record<string, string>[] {
  return [
    {
      row: "Enemies",
      ...getPlannerStatStageColumns([BattlerIndex.ENEMY, BattlerIndex.ENEMY_3, BattlerIndex.ENEMY_2]),
    },
    {
      row: "Players",
      ...getPlannerStatStageColumns([BattlerIndex.PLAYER, BattlerIndex.PLAYER_3, BattlerIndex.PLAYER_2]),
    },
  ];
}

function getPlannerStatStageColumns(battlerIndexes: BattlerIndex[]): Record<string, string> {
  return battlerIndexes.reduce<Record<string, string>>((columns, battlerIndex) => {
    const pokemon = getPokemonAtBattlerIndex(battlerIndex);
    columns[getBattlerLogLabel(battlerIndex)] = pokemon ? formatPlannerStatStages(pokemon) : "--";
    return columns;
  }, {});
}

function formatPlannerTargets(targets: BattlerIndex[]): string {
  if (targets.length === 0) {
    return "none";
  }

  return targets
    .map(battlerIndex => {
      const pokemon = getPokemonAtBattlerIndex(battlerIndex);
      return pokemon
        ? `${getBattlerLogLabel(battlerIndex)} ${getPlannerPokemonLabel(pokemon)}`
        : getBattlerLogLabel(battlerIndex);
    })
    .join(", ");
}

function formatPlannerHpForLog(pokemon: Pokemon, projectedHp: number | undefined): string {
  const hp = projectedHp ?? pokemon.hp;
  return `${getPlannerPokemonLabel(pokemon)} ${Math.max(0, hp)}/${getPlannerMaxHp(pokemon)}`;
}

function formatPlannerStatStages(pokemon: Pokemon): string {
  const stages = BATTLE_STATS.map(stat => ({ stat, stage: pokemon.getStatStage(stat) }))
    .filter(({ stage }) => stage !== 0)
    .map(({ stat, stage }) => `${Stat[stat]} ${stage > 0 ? "+" : ""}${stage}`);

  return stages.length > 0 ? stages.join(", ") : "none";
}

function formatPlannerScore(score: number): number {
  return Math.round(score * 10) / 10;
}

function formatPlannerFieldPosition(position: FieldPosition): string {
  return FieldPosition[position] ?? `${position}`;
}

function getPokemonAtBattlerIndex(battlerIndex: BattlerIndex): Pokemon | undefined {
  return globalScene.getField()[battlerIndex];
}

function getPlannerPokemonLabel(pokemon: Pokemon): string {
  return pokemon.getNameToRender({ useIllusion: true });
}

function shouldUsePlannerIllusion(viewer: Pokemon | undefined, target: Pokemon): boolean {
  return !!viewer && viewer.isOpponent(target) && !!target.summonData.illusion;
}

function getPlannerHp(pokemon: Pokemon, viewer?: Pokemon): number {
  return shouldUsePlannerIllusion(viewer, pokemon) ? pokemon.getHp(true) : pokemon.hp;
}

function getPlannerMaxHp(pokemon: Pokemon, viewer?: Pokemon): number {
  return shouldUsePlannerIllusion(viewer, pokemon) ? pokemon.getMaxHp(true) : pokemon.getMaxHp();
}

function getPlannerVisibleTypes(viewer: Pokemon, target: Pokemon): PokemonType[] {
  return target.getTypes({
    returnOriginalTypesIfStellar: true,
    useIllusion: shouldUsePlannerIllusion(viewer, target),
  });
}

function isPlannerAbilityKnown(viewer: Pokemon, target: Pokemon): boolean {
  return !viewer.isOpponent(target) || target.waveData.abilityRevealed || hasPlannerGuaranteedAbility(viewer, target);
}

function hasPlannerGuaranteedAbility(viewer: Pokemon, target: Pokemon): boolean {
  const speciesForm = target.getSpeciesForm(false, shouldUsePlannerIllusion(viewer, target));
  const possibleAbilities = new Set<AbilityId>();

  for (let abilityIndex = 0; abilityIndex < speciesForm.getAbilityCount(); abilityIndex++) {
    const abilityId = speciesForm.getAbility(abilityIndex);
    if (abilityId !== AbilityId.NONE) {
      possibleAbilities.add(abilityId);
    }
  }

  return possibleAbilities.size === 1;
}

function isPlannerGroundedForStatus(viewer: Pokemon, target: Pokemon): boolean {
  if (isPlannerAbilityKnown(viewer, target)) {
    return target.isGrounded();
  }

  return !getPlannerVisibleTypes(viewer, target).includes(PokemonType.FLYING);
}

function canPlannerBypassPoisonTypeStatusImmunity(source: Pokemon): boolean {
  return source.hasAbility(AbilityId.CORROSION);
}

function canPlannerSetStatus(source: Pokemon, target: Pokemon, effect: StatusEffect): boolean {
  if (!source.isOpponent(target)) {
    return target.canSetStatus(effect, true, false, source);
  }

  if (effect !== StatusEffect.FAINT) {
    if (target.status || target.turnData.pendingStatus) {
      return false;
    }

    if (isPlannerGroundedForStatus(source, target) && globalScene.arena.terrain?.terrainType === TerrainType.MISTY) {
      return false;
    }
  }

  const visibleTypes = getPlannerVisibleTypes(source, target);

  switch (effect) {
    case StatusEffect.POISON:
    case StatusEffect.TOXIC:
      if (
        visibleTypes.some(
          type =>
            (type === PokemonType.POISON || type === PokemonType.STEEL)
            && !canPlannerBypassPoisonTypeStatusImmunity(source),
        )
      ) {
        return false;
      }
      break;
    case StatusEffect.PARALYSIS:
      if (visibleTypes.includes(PokemonType.ELECTRIC)) {
        return false;
      }
      break;
    case StatusEffect.SLEEP:
      if (isPlannerGroundedForStatus(source, target) && globalScene.arena.terrainType === TerrainType.ELECTRIC) {
        return false;
      }
      break;
    case StatusEffect.FREEZE:
      if (
        visibleTypes.includes(PokemonType.ICE)
        || globalScene.arena.weatherType === WeatherType.SUNNY
        || globalScene.arena.weatherType === WeatherType.HARSH_SUN
      ) {
        return false;
      }
      break;
    case StatusEffect.BURN:
      if (visibleTypes.includes(PokemonType.FIRE)) {
        return false;
      }
      break;
  }

  if (hasKnownPlannerStatusImmunity(source, target, target, effect)) {
    return false;
  }

  for (const ally of target.getAllies()) {
    if (hasKnownPlannerStatusImmunity(source, ally, target, effect)) {
      return false;
    }
  }

  return !target.isSafeguarded(source);
}

function hasKnownPlannerStatusImmunity(
  source: Pokemon,
  abilityOwner: Pokemon,
  target: Pokemon,
  effect: StatusEffect,
): boolean {
  if (!isPlannerAbilityKnown(source, abilityOwner)) {
    return false;
  }

  const cancelled = new BooleanHolder(false);
  if (abilityOwner === target) {
    applyAbAttrs("StatusEffectImmunityAbAttr", { pokemon: target, effect, cancelled, simulated: true });
  } else {
    applyAbAttrs("UserFieldStatusEffectImmunityAbAttr", {
      pokemon: abilityOwner,
      effect,
      cancelled,
      simulated: true,
      target,
      source,
    });
  }

  return cancelled.value;
}

function getBattlerLogLabel(battlerIndex: BattlerIndex): string {
  switch (battlerIndex) {
    case BattlerIndex.PLAYER:
      return "P1";
    case BattlerIndex.PLAYER_2:
      return "P2";
    case BattlerIndex.PLAYER_3:
      return "P3";
    case BattlerIndex.ENEMY:
      return "E1";
    case BattlerIndex.ENEMY_2:
      return "E2";
    case BattlerIndex.ENEMY_3:
      return "E3";
    case BattlerIndex.ATTACKER:
      return "ATTACKER";
    default:
      return String(battlerIndex);
  }
}

function createPlannerSearchState(user: Pokemon): PlannerSearchState {
  const friendlyField = globalScene
    .getField(true)
    .filter(pokemon => pokemon.isAllowedInBattle() && !user.isOpponent(pokemon))
    .map(createPlannerSearchPokemon);
  const opponents = user
    .getOpponents()
    .filter(pokemon => pokemon.isAllowedInBattle())
    .map(createPlannerSearchPokemon);
  const userSnapshot = friendlyField.find(pokemon => pokemon.pokemon === user) ?? createPlannerSearchPokemon(user);

  return {
    user: userSnapshot,
    allies: friendlyField.filter(pokemon => pokemon.pokemon !== user),
    opponents,
  };
}

function createPlannerSearchPokemon(pokemon: Pokemon): PlannerSearchPokemon {
  return {
    pokemon,
    battlerIndex: pokemon.getBattlerIndex(),
    hp: pokemon.hp,
    maxHp: pokemon.getMaxHp(),
    speed: pokemon.getEffectiveStat(Stat.SPD),
    bestPriority: getBestMovePriority(pokemon),
  };
}

function createPlannerSearchAction(user: Pokemon, choice: PlannerMoveChoice, move: Move): PlannerSearchAction {
  const field = globalScene.getField();
  const actionPriority = move.getPriority(user);
  const targets = choice.targets
    .map(battlerIndex => field[battlerIndex])
    .filter((target): target is Pokemon => !!target && target.isAllowedInBattle())
    .map(target => {
      const damage = move.category === MoveCategory.STATUS ? 0 : estimateDamage(user, target, move).damage;
      const moveActsBeforeTarget =
        actionPriority > getBestMovePriority(target)
        || (actionPriority === getBestMovePriority(target)
          && user.getEffectiveStat(Stat.SPD, { opponent: target })
            >= target.getEffectiveStat(Stat.SPD, { opponent: user }));

      return {
        pokemon: target,
        battlerIndex: target.getBattlerIndex(),
        damage,
        hpAfterAction: getPlannerHp(target, user) - damage,
        actsBeforeUser: !moveActsBeforeTarget,
      };
    });

  return {
    kind: "move",
    choice,
    user,
    move,
    targets,
    priority: actionPriority,
  };
}

function evaluatePlannerSearchAction(state: PlannerSearchState, action: PlannerSearchAction): PlannerSearchEvaluation {
  if (action.kind !== "move") {
    return {
      score: 0,
      preventedThreatScore: 0,
      survivalScore: 0,
      objectiveSurvivalScore: 0,
      spreadFollowupScore: 0,
      wastedTurnPenalty: 0,
    };
  }

  const user = state.user.pokemon;
  const opponentTargets = action.targets.filter(target => user.isOpponent(target.pokemon));
  const preventedThreatScore = getPreventedThreatScore(state, opponentTargets);
  const survivalScore = getSearchSurvivalScore(state, action, opponentTargets);
  const objectiveSurvivalScore = getObjectiveSurvivalScore(state, action, opponentTargets);
  const spreadFollowupScore = getSpreadFollowupScore(user, opponentTargets);
  const wastedTurnPenalty = getSearchWastedTurnPenalty(state, action, opponentTargets);

  return {
    score: preventedThreatScore + survivalScore + objectiveSurvivalScore + spreadFollowupScore - wastedTurnPenalty,
    preventedThreatScore,
    survivalScore,
    objectiveSurvivalScore,
    spreadFollowupScore,
    wastedTurnPenalty,
  };
}

function getPreventedThreatScore(state: PlannerSearchState, opponentTargets: PlannerSearchTarget[]): number {
  return opponentTargets.reduce((total, target) => {
    if (target.hpAfterAction > 0 || target.actsBeforeUser) {
      return total;
    }

    const threatToUser = estimateBestDamage(target.pokemon, state.user.pokemon).damage;
    const threatToAllies = state.allies.reduce(
      (highestDamage, ally) => Math.max(highestDamage, estimateBestDamage(target.pokemon, ally.pokemon).damage),
      0,
    );
    const threatRatio = Math.max(
      threatToUser / Math.max(1, state.user.maxHp),
      threatToAllies / Math.max(1, getAverageAllyMaxHp(state)),
    );

    return total + Math.min(85, 18 + threatRatio * 70);
  }, 0);
}

function getSearchSurvivalScore(
  state: PlannerSearchState,
  action: PlannerSearchAction,
  opponentTargets: PlannerSearchTarget[],
): number {
  const residualDamage = estimateEndOfTurnResidualDamage(state.user.pokemon);
  const incomingBefore = estimateIncomingDamageDetailed(state.user.pokemon).incomingDamage + residualDamage;
  const incomingTimeline = estimateIncomingTimelineAfterSearchAction(state, action, opponentTargets);
  const incomingAfter = incomingTimeline.totalDamage + residualDamage;
  const preventedIncoming = Math.max(0, incomingBefore - incomingAfter);
  const preventedRatio = preventedIncoming / Math.max(1, state.user.maxHp);
  const projectedUserHp = getProjectedHpAfterDirectHealing(
    state.user.pokemon,
    state.user.pokemon,
    action.move,
    action.targets,
  );
  const projectedHeal = Math.max(0, projectedUserHp - state.user.hp);
  const survivesUntilAction = incomingTimeline.damageBeforeAction < state.user.hp;
  const healPreventsFaint =
    projectedHeal > 0
    && survivesUntilAction
    && incomingAfter >= state.user.hp
    && incomingTimeline.damageAfterAction + residualDamage
      < state.user.hp - incomingTimeline.damageBeforeAction + projectedHeal;
  const survivalHp = survivesUntilAction && projectedHeal > 0 ? projectedUserHp : state.user.hp;
  const stillFaints =
    incomingTimeline.damageBeforeAction >= state.user.hp
    || incomingTimeline.damageAfterAction + residualDamage >= survivalHp - incomingTimeline.damageBeforeAction;
  const wasInDanger = incomingBefore >= state.user.hp || incomingBefore >= state.user.maxHp * 0.45;

  let score = Math.min(55, preventedRatio * 90);
  if (healPreventsFaint) {
    score += Math.min(95, 52 + (projectedHeal / Math.max(1, state.user.maxHp)) * 70);
  }

  if (wasInDanger && !stillFaints && preventedIncoming > 0) {
    score += 26;
  }

  if (stillFaints && action.move.category === MoveCategory.STATUS && !action.move.hasAttr("ProtectAttr")) {
    score -= 42;
  }

  return score;
}

function getObjectiveSurvivalScore(
  state: PlannerSearchState,
  action: PlannerSearchAction,
  opponentTargets: PlannerSearchTarget[],
): number {
  const objectivePriority = getProtectedObjectivePriority(state.user.pokemon);
  if (objectivePriority <= 0) {
    return 0;
  }

  const pokemon = state.user.pokemon;
  const maxHp = Math.max(1, state.user.maxHp);
  const residualDamage = estimateEndOfTurnResidualDamage(pokemon);
  const nextResidualDamage = estimateNextEndOfTurnResidualDamage(pokemon);
  const incomingTimeline = estimateIncomingTimelineAfterSearchAction(state, action, opponentTargets);
  const incomingBefore = estimateIncomingDamageDetailed(pokemon).incomingDamage + residualDamage;
  const projectedUserHp = getProjectedHpAfterDirectHealing(pokemon, pokemon, action.move, action.targets);
  const directHeal = Math.max(0, projectedUserHp - state.user.hp);
  const survivesUntilAction = incomingTimeline.damageBeforeAction < state.user.hp;
  const baselineEndHp = state.user.hp - incomingBefore;
  const actionEndHp = survivesUntilAction
    ? projectedUserHp - incomingTimeline.damageBeforeAction - incomingTimeline.damageAfterAction - residualDamage
    : 0;
  const hpRatioAfterAction = actionEndHp / maxHp;
  const isProtect = action.move.hasAttr("ProtectAttr");
  const isWish = action.move.id === MoveId.WISH && action.targets.some(target => target.pokemon === pokemon);
  const hasResidualPressure = residualDamage > 0 || nextResidualDamage > 0;

  let score = 0;

  if (baselineEndHp <= 0 && actionEndHp > 0) {
    score += 280;
  } else if (baselineEndHp <= maxHp * 0.3 && actionEndHp > baselineEndHp) {
    score += Math.min(180, ((actionEndHp - baselineEndHp) / maxHp) * 180);
  }

  if (directHeal > 0) {
    score += Math.min(160, (directHeal / maxHp) * 150 + (hasResidualPressure ? 36 : 0));
    if (hpRatioAfterAction >= 0.5) {
      score += 28;
    } else if (hpRatioAfterAction >= 0.33) {
      score += 14;
    }
  }

  if (isProtect) {
    const prevented = Math.max(0, incomingBefore - incomingTimeline.totalDamage - residualDamage);
    score += Math.min(170, (prevented / maxHp) * 135 + (hasResidualPressure ? 24 : 0));
  }

  if (isWish) {
    const missingHp = Math.max(0, maxHp - state.user.hp);
    const futureHeal = Math.min(missingHp, Math.max(1, Math.floor(maxHp / 2)));
    if (actionEndHp > 0 && futureHeal > 0) {
      const wishSafetyMultiplier = hpRatioAfterAction >= 0.45 ? 1 : hpRatioAfterAction >= 0.25 ? 0.65 : 0.35;
      score += Math.min(130, ((futureHeal / maxHp) * 125 + (hasResidualPressure ? 25 : 0)) * wishSafetyMultiplier);
    }
  }

  if (hasResidualPressure && actionEndHp > 0) {
    if (actionEndHp <= nextResidualDamage) {
      score -= 75;
    } else if (hpRatioAfterAction < 0.35) {
      score += 36;
    } else if (hpRatioAfterAction >= 0.55) {
      score += 28;
    }
  }

  if (actionEndHp <= 0) {
    score -= baselineEndHp <= 0 ? 130 : 210;
  } else if (hpRatioAfterAction >= 0.65) {
    score += 26;
  }

  return clampPlannerScore(score * objectivePriority, -260, 380);
}

function estimateIncomingDamageAfterSearchAction(
  state: PlannerSearchState,
  action: PlannerSearchAction,
  opponentTargets: PlannerSearchTarget[],
): number {
  return estimateIncomingTimelineAfterSearchAction(state, action, opponentTargets).totalDamage;
}

function getPlannerDamagingCategory(move: Move): MoveCategory.PHYSICAL | MoveCategory.SPECIAL | undefined {
  return move.category === MoveCategory.PHYSICAL || move.category === MoveCategory.SPECIAL ? move.category : undefined;
}

function estimateIncomingTimelineAfterSearchAction(
  state: PlannerSearchState,
  action: PlannerSearchAction,
  opponentTargets: PlannerSearchTarget[],
): PlannerIncomingTimeline {
  const incoming = estimateIncomingDamageDetailed(state.user.pokemon);
  return incoming.threats.reduce<PlannerIncomingTimeline>(
    (timeline, threat) => {
      const actsBeforeThreat = doesMoveActBeforeThreat(state.user.pokemon, threat.attacker, action.move, threat.move);
      const damage = getIncomingThreatDamageAfterPlannerAction(
        threat,
        state,
        action,
        opponentTargets,
        actsBeforeThreat,
      );
      if (actsBeforeThreat) {
        timeline.damageAfterAction += damage;
      } else {
        timeline.damageBeforeAction += damage;
      }
      timeline.totalDamage += damage;
      return timeline;
    },
    { totalDamage: 0, damageBeforeAction: 0, damageAfterAction: 0 },
  );
}

function getIncomingThreatDamageAfterPlannerAction(
  threat: PlannerIncomingThreat,
  state: PlannerSearchState,
  action: PlannerSearchAction,
  opponentTargets: PlannerSearchTarget[],
  actsBeforeThreat: boolean,
): number {
  if (!actsBeforeThreat) {
    return threat.damage;
  }

  if (action.move.hasAttr("ProtectAttr")) {
    return 0;
  }

  const target = opponentTargets.find(searchTarget => searchTarget.pokemon === threat.attacker);
  if (target && target.hpAfterAction <= 0) {
    return 0;
  }

  let damage = threat.damage;
  const threatCategory = getPlannerDamagingCategory(threat.move);
  if (target) {
    damage *= threatCategory
      ? getPlannerActionOutgoingDamageScale(state.user.pokemon, threat.attacker, action.move, threatCategory)
      : 1;
  }

  if (threatCategory && action.targets.some(target => target.pokemon === state.user.pokemon)) {
    damage *= getPlannerActionIncomingDamageScale(state.user.pokemon, action.move, threatCategory);
  }

  return damage;
}

function getPlannerActionIncomingDamageScale(
  user: Pokemon,
  move: Move,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): number {
  const defenseStat = category === MoveCategory.PHYSICAL ? Stat.DEF : Stat.SPDEF;
  const stageScale = move.getAttrs("StatStageChangeAttr").reduce((scale, attr) => {
    const stages = attr.getLevels(user);
    if (!attr.selfTarget || stages <= 0 || !attr.stats.includes(defenseStat)) {
      return scale;
    }

    const appliedStages = getAppliedStatStageDelta(user, defenseStat, stages);
    if (appliedStages === 0) {
      return scale;
    }

    return (
      scale
      * (getStatStageMultiplier(user.getStatStage(defenseStat))
        / getStatStageMultiplier(user.getStatStage(defenseStat) + appliedStages))
    );
  }, 1);

  return clampPlannerScore(stageScale, 0, 1);
}

function getPlannerActionOutgoingDamageScale(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): number {
  const attackStat = category === MoveCategory.PHYSICAL ? Stat.ATK : Stat.SPATK;
  const stageScale = move.getAttrs("StatStageChangeAttr").reduce((scale, attr) => {
    const stages = attr.getLevels(user);
    if (attr.selfTarget || stages >= 0 || !attr.stats.includes(attackStat)) {
      return scale;
    }

    const appliedStages = getAppliedStatStageDelta(target, attackStat, stages);
    if (appliedStages === 0) {
      return scale;
    }

    return (
      scale
      * (getStatStageMultiplier(target.getStatStage(attackStat) + appliedStages)
        / getStatStageMultiplier(target.getStatStage(attackStat)))
    );
  }, 1);

  const statusScale = getPlannerActionStatusDamageScale(user, target, move, category);
  return clampPlannerScore(stageScale * statusScale, 0, 1);
}

function getPlannerActionStatusDamageScale(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): number {
  if (target.status) {
    return 1;
  }

  return move.getAttrs("StatusEffectAttr").reduce((scale, attr) => {
    const effects = getStatusEffectsForPlanner(attr);
    if (!effects.some(effect => canPlannerSetStatus(user, target, effect))) {
      return scale;
    }

    if (effects.includes(StatusEffect.SLEEP) || effects.includes(StatusEffect.FREEZE)) {
      return 0;
    }

    let nextScale = scale;
    if (effects.includes(StatusEffect.PARALYSIS)) {
      nextScale *= 0.75;
    }

    if (category === MoveCategory.PHYSICAL && effects.includes(StatusEffect.BURN)) {
      nextScale *= 0.5;
    }

    return nextScale;
  }, 1);
}

function getSpreadFollowupScore(user: Pokemon, opponentTargets: PlannerSearchTarget[]): number {
  if (opponentTargets.length <= 1) {
    return 0;
  }

  const damagedTargets = opponentTargets.filter(target => target.damage > 0 && target.hpAfterAction > 0);
  if (damagedTargets.length <= 1) {
    return 0;
  }

  const averageRemainingRatio =
    damagedTargets.reduce(
      (total, target) => total + target.hpAfterAction / Math.max(1, getPlannerMaxHp(target.pokemon, user)),
      0,
    ) / damagedTargets.length;

  const allyCanCleanUp = globalScene
    .getField(true)
    .filter(pokemon => pokemon !== user && !user.isOpponent(pokemon) && pokemon.isAllowedInBattle())
    .some(ally =>
      damagedTargets.some(
        target => estimateBestDamage(ally, target.pokemon).damage >= Math.max(1, target.hpAfterAction),
      ),
    );

  return allyCanCleanUp ? Math.max(0, 24 - averageRemainingRatio * 18) : 0;
}

function getSearchWastedTurnPenalty(
  state: PlannerSearchState,
  action: PlannerSearchAction,
  opponentTargets: PlannerSearchTarget[],
): number {
  if (action.move.category !== MoveCategory.STATUS) {
    return 0;
  }

  if (action.move.hasAttr("HealAttr")) {
    return 0;
  }

  if (action.move.id === MoveId.WISH && getProtectedObjectivePriority(state.user.pokemon) > 0) {
    return 0;
  }

  const incomingAfter = estimateIncomingDamageAfterSearchAction(state, action, opponentTargets);
  const usefulStatusScore = Math.max(
    action.choice.breakdown?.status ?? 0,
    action.choice.breakdown?.enemyStatus ?? 0,
    action.choice.breakdown?.setup ?? 0,
  );
  const hasSaferDamageOption = state.user.pokemon
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .some(move =>
      state.opponents.some(opponent => estimateDamage(state.user.pokemon, opponent.pokemon, move).damage > 0),
    );

  if (usefulStatusScore >= 20) {
    return 0;
  }

  return incomingAfter >= state.user.hp * 0.5 && hasSaferDamageOption ? 20 : 0;
}

function getAverageAllyMaxHp(state: PlannerSearchState): number {
  if (state.allies.length === 0) {
    return state.user.maxHp;
  }

  return state.allies.reduce((total, ally) => total + ally.maxHp, 0) / state.allies.length;
}

function getBestMovePriority(pokemon: Pokemon): number {
  return pokemon
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move)
    .reduce((highestPriority, move) => Math.max(highestPriority, move.priority), 0);
}

function scoreMoveAgainstTargetDetailed(
  user: Pokemon,
  target: Pokemon,
  move: Move,
): { score: number; breakdown: PlannerMoveScoreBreakdown } {
  const breakdown = createEmptyPlannerMoveScoreBreakdown();
  if (!doesMoveWork(user, target, move)) {
    return { score: FAIL_SCORE, breakdown };
  }

  const targetIsOpponent = user.isOpponent(target);
  const targetThreatScore = targetIsOpponent ? getTargetThreatScore(user, target) : 0;
  breakdown.benefit = getBenefitScore(user, target, move, targetIsOpponent);
  let score = breakdown.benefit;

  if (move.is("AttackMove")) {
    breakdown.attack = scoreAttackMove(user, target, move, targetIsOpponent);
    score += breakdown.attack;
    if (targetIsOpponent) {
      breakdown.threat = targetThreatScore;
      score += breakdown.threat;
    }
  } else {
    const statusScore = scoreStatusMoveDetailed(user, target, move, targetIsOpponent, targetThreatScore);
    breakdown.status = statusScore.total;
    breakdown.healing = statusScore.healing;
    breakdown.setup = statusScore.setup;
    breakdown.sideSupport = statusScore.sideSupport;
    breakdown.enemyStatus = statusScore.enemyStatus;
    breakdown.redundancy = statusScore.redundancy;
    breakdown.protect = statusScore.protect;
    score += breakdown.status;

    if (targetIsOpponent && statusScore.total < 0) {
      breakdown.badStatus = -Math.min(90, 35 + targetThreatScore * 0.2);
      score += breakdown.badStatus;
    }
  }

  return { score: Number.isNaN(score) ? 0 : score, breakdown };
}

function doesMoveWork(user: Pokemon, target: Pokemon, move: Move): boolean {
  if (move.name.endsWith(" (N)")) {
    return false;
  }

  if (
    !move.applyConditions(user, target, -1)
    && ![MoveId.SUCKER_PUNCH, MoveId.UPPER_HAND, MoveId.THUNDERCLAP].includes(move.id)
  ) {
    return false;
  }

  return (
    !globalScene.arena.isMoveWeatherCancelled(user, move)
    && !globalScene.arena.isMoveTerrainCancelled(user, [target.getBattlerIndex()], move)
  );
}

function getBenefitScore(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  return (
    move.getUserBenefitScore(user, target, move)
    + move.getTargetBenefitScore(user, target, move) * (targetIsOpponent ? -1 : 1)
  );
}

function scoreAttackMove(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  const damage = estimateDamage(user, target, move);
  const accuracy = getAccuracyFactor(user, target, move);
  const targetHp = getPlannerHp(target, user);
  const targetMaxHp = getPlannerMaxHp(target, user);
  const damageRatio = targetHp > 0 ? damage.damage / targetHp : 0;
  const maxHpRatio = targetMaxHp > 0 ? damage.damage / targetMaxHp : 0;
  const isKo = damage.damage >= targetHp;

  if (!targetIsOpponent) {
    return getAllyAttackPenalty(damageRatio, maxHpRatio, accuracy);
  }

  return (
    getOpponentAttackDamageScore(user, move, damageRatio, maxHpRatio, accuracy, isKo)
    + getAttackMoveRiskAdjustment(user, target, move, isKo)
  );
}

function scoreStatusMoveDetailed(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  targetIsOpponent: boolean,
  targetThreatScore: number,
): {
  healing: number;
  setup: number;
  sideSupport: number;
  enemyStatus: number;
  redundancy: number;
  protect: number;
  total: number;
} {
  const incomingDamage = estimateIncomingDamage(user);
  const canSurviveSetup = incomingDamage < user.hp || move.priority > 0;
  const healing =
    getHealingMoveScore(user, target, move, targetIsOpponent)
    + getStatusCureMoveScore(user, target, move, targetIsOpponent);
  const futureValue = getFutureStatusMoveValue(user, target, move, targetIsOpponent, targetThreatScore);
  const setup = getSetupMoveScore(user, move, canSurviveSetup) + (targetIsOpponent ? 0 : futureValue);
  const sideSupport = getSideSupportMoveScore(user, move, incomingDamage);
  const enemyStatus =
    getOpponentStatusMoveScore(user, target, move, targetIsOpponent, incomingDamage, targetThreatScore)
    + (targetIsOpponent ? futureValue : 0);
  const redundancy = getStatusMoveRedundancyPenalty(target, targetIsOpponent);
  const protect = getProtectMoveScore(user, move, incomingDamage);

  return {
    healing,
    setup,
    sideSupport,
    enemyStatus,
    redundancy,
    protect,
    total: healing + setup + sideSupport + enemyStatus + redundancy + protect,
  };
}

function createEmptyPlannerMoveScoreBreakdown(): PlannerMoveScoreBreakdown {
  return {
    benefit: 0,
    attack: 0,
    status: 0,
    threat: 0,
    badStatus: 0,
    healing: 0,
    setup: 0,
    sideSupport: 0,
    enemyStatus: 0,
    redundancy: 0,
    protect: 0,
  };
}

function mergePlannerMoveScoreBreakdowns(breakdowns: PlannerMoveScoreBreakdown[]): PlannerMoveScoreBreakdown {
  return breakdowns.reduce<PlannerMoveScoreBreakdown>((merged, breakdown) => {
    merged.benefit += breakdown.benefit;
    merged.attack += breakdown.attack;
    merged.status += breakdown.status;
    merged.threat += breakdown.threat;
    merged.badStatus += breakdown.badStatus;
    merged.healing += breakdown.healing;
    merged.setup += breakdown.setup;
    merged.sideSupport += breakdown.sideSupport;
    merged.enemyStatus += breakdown.enemyStatus;
    merged.redundancy += breakdown.redundancy;
    merged.protect += breakdown.protect;
    return merged;
  }, createEmptyPlannerMoveScoreBreakdown());
}

function getAllyAttackPenalty(damageRatio: number, maxHpRatio: number, accuracy: number): number {
  const allyPenalty = Math.max(30, damageRatio * 170 + maxHpRatio * 80);
  return -allyPenalty * accuracy;
}

function getOpponentAttackDamageScore(
  user: Pokemon,
  move: Move,
  damageRatio: number,
  maxHpRatio: number,
  accuracy: number,
  isKo: boolean,
): number {
  let score = (damageRatio * 90 + maxHpRatio * 40) * accuracy;

  if (isKo) {
    score += KO_SCORE;
  } else if (damageRatio >= 0.75) {
    score += 45;
  } else if (damageRatio >= 0.5) {
    score += 24;
  }

  if (user.isOfType(move.type)) {
    score += 12;
  }

  if (move.priority > 0 && isKo) {
    score += 24;
  }

  return score;
}

function getAttackMoveRiskAdjustment(user: Pokemon, target: Pokemon, move: Move, isKo: boolean): number {
  let score = 0;

  if (isSlowerKoRisk(user, target, move, isKo)) {
    score -= estimateBestDamage(target, user).damage >= user.hp ? 32 : 0;
  }

  if (move.hasAttr("RechargeAttr")) {
    score -= 45;
  }

  if (move.hasAttr("SacrificialAttr") || move.moveTarget === MoveTarget.ATTACKER) {
    score -= user.getHpRatio() > 0.5 ? 55 : 20;
  }

  return score;
}

function isSlowerKoRisk(user: Pokemon, target: Pokemon, move: Move, isKo: boolean): boolean {
  return (
    move.priority <= 0
    && isKo
    && target.getEffectiveStat(Stat.SPD, { opponent: user }) > user.getEffectiveStat(Stat.SPD, { opponent: target })
  );
}

function getProjectedHpAfterDirectHealing(
  user: Pokemon,
  pokemon: Pokemon,
  move: Move,
  actionTargets: PlannerSearchTarget[],
  startingHp = pokemon.hp,
): number {
  const healAmount = getProjectedDirectHealAmount(user, pokemon, move, actionTargets);
  return Math.min(pokemon.getMaxHp(), Math.max(0, startingHp) + healAmount);
}

function getProjectedDirectHealAmount(
  user: Pokemon,
  pokemon: Pokemon,
  move: Move,
  actionTargets: PlannerSearchTarget[],
): number {
  const healAttrs = move.getAttrs("HealAttr");
  if (healAttrs.length === 0) {
    return 0;
  }

  return healAttrs.reduce((bestHeal, attr) => {
    const healsThisPokemon =
      (attr.selfTarget && pokemon === user)
      || (!attr.selfTarget && actionTargets.some(target => target.pokemon === pokemon));

    if (!healsThisPokemon || user.isOpponent(pokemon)) {
      return bestHeal;
    }

    const expectedHeal = Math.max(1, Math.floor(pokemon.getMaxHp() * getHealingRatioForAttr(user, move, attr)));
    const missingHp = Math.max(0, pokemon.getMaxHp() - pokemon.hp);
    return Math.max(bestHeal, Math.min(missingHp, expectedHeal));
  }, 0);
}

function getHealingMoveScore(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  const healAttrs = move.getAttrs("HealAttr");
  if (healAttrs.length === 0) {
    return 0;
  }

  return healAttrs.reduce((bestScore, attr) => {
    const healedTarget = attr.selfTarget ? user : target;
    const healsOpponent = user.isOpponent(healedTarget);
    if (targetIsOpponent || healsOpponent) {
      return Math.max(bestScore, -45);
    }

    const maxHp = healedTarget.getMaxHp();
    const missingHp = Math.max(0, maxHp - healedTarget.hp);
    if (missingHp <= 0) {
      return bestScore;
    }

    const expectedHeal = Math.max(1, Math.floor(maxHp * getHealingRatioForAttr(user, move, attr)));
    const actualHeal = Math.min(missingHp, expectedHeal);
    const restoredRatio = actualHeal / maxHp;
    const overhealRatio = Math.max(0, expectedHeal - actualHeal) / maxHp;
    const incomingDamage = estimateIncomingDamage(healedTarget);
    const residualDamage = estimateEndOfTurnResidualDamage(healedTarget);
    const dangerDamage = incomingDamage + residualDamage;
    const averageFieldMaxHp = getAverageActiveFieldMaxHp();
    const absoluteHealScore = Math.min(95, (actualHeal / Math.max(1, averageFieldMaxHp)) * 120);
    const incomingCoverageScore = dangerDamage > 0 ? Math.min(85, (actualHeal / Math.max(1, dangerDamage)) * 68) : 0;
    const preventsKo = canHealBeforeLikelyKo(user, healedTarget, move, actualHeal, dangerDamage);
    const preventsResidualKo =
      residualDamage > 0
      && healedTarget.hp > incomingDamage
      && healedTarget.hp - incomingDamage <= residualDamage
      && healedTarget.hp + actualHeal - incomingDamage > residualDamage;

    let score = restoredRatio * 72 + absoluteHealScore + incomingCoverageScore - overhealRatio * 30;
    if (preventsKo) {
      score += healedTarget === user ? 155 : 125;
    } else if (preventsResidualKo) {
      score += healedTarget === user ? 130 : 105;
    } else if (dangerDamage >= healedTarget.hp * 0.5) {
      score += restoredRatio * 35;
    }

    if (healedTarget !== user && estimateIncomingDamage(user) >= user.hp) {
      score -= 25;
    }

    return Math.max(bestScore, score);
  }, 0);
}

function getStatusCureMoveScore(user: Pokemon, target: Pokemon, move: Move, targetIsOpponent: boolean): number {
  let bestScore = 0;

  if (move.getAttrs("PartyStatusCureAttr").length > 0) {
    if (target !== user) {
      return bestScore;
    }

    const partyScore = getPlannerPartyStatusCureTargets(user).reduce((total, pokemon) => {
      if (!pokemon.status || pokemon.isFainted()) {
        return total;
      }

      return total + getStatusBurdenScore(pokemon, user) * (pokemon === user ? 1 : 0.82);
    }, 0);

    bestScore = Math.max(bestScore, Math.min(190, partyScore));
  }

  for (const attr of move.getAttrs("HealStatusEffectAttr")) {
    const curedPokemon = attr.selfTarget ? user : target;
    const curesOpponent = user.isOpponent(curedPokemon);
    if (targetIsOpponent || curesOpponent || !curedPokemon.status || !attr.isOfEffect(curedPokemon.status.effect)) {
      continue;
    }

    bestScore = Math.max(bestScore, getStatusBurdenScore(curedPokemon, user));
  }

  if (move.id === MoveId.REST && user.status && user.status.effect !== StatusEffect.SLEEP) {
    bestScore = Math.max(bestScore, getStatusBurdenScore(user, user) * 0.55);
  }

  return bestScore;
}

function getPlannerPartyStatusCureTargets(user: Pokemon): Pokemon[] {
  if (!user.isPlayer()) {
    return globalScene.getEnemyParty();
  }

  const userPlayerIndex = globalScene.getPlayerIndexForPokemon(user);
  const userIsEnemySide =
    userPlayerIndex !== undefined && globalScene.isMysteryEncounterEnemySidePlayer(userPlayerIndex);

  if (!globalScene.twoPlayerMode) {
    return globalScene.getPlayerParty(userPlayerIndex ?? globalScene.activePlayerIndex);
  }

  return globalScene
    .getActivePlayerIndexes()
    .filter(playerIndex => globalScene.isMysteryEncounterEnemySidePlayer(playerIndex) === userIsEnemySide)
    .flatMap(playerIndex => globalScene.getPlayerParty(playerIndex));
}

function getStatusBurdenScore(pokemon: Pokemon, healer: Pokemon): number {
  const status = pokemon.status;
  if (!status) {
    return 0;
  }

  const maxHp = Math.max(1, pokemon.getMaxHp());
  const incomingDamage = estimateIncomingDamage(pokemon);
  const residualDamage = estimateEndOfTurnResidualDamage(pokemon);
  const dangerRatio = Math.min(1.5, (incomingDamage + residualDamage) / Math.max(1, pokemon.hp));
  const pressure = getBestOffensivePressure(pokemon);
  const outgoingDamage = estimateBestDamageAgainstSide(pokemon, getActiveSidePokemon(healer, false));
  const residualScore =
    residualDamage > 0 ? scoreFutureDamageSwing(residualDamage * getFutureTurnWeightTotal(), maxHp, 95, 1.8) : 0;
  const dangerBonus = dangerRatio >= 1 ? 42 : dangerRatio >= 0.5 ? 20 : 0;

  switch (status.effect) {
    case StatusEffect.SLEEP:
    case StatusEffect.FREEZE:
      return clampPlannerScore(
        48
          + scoreFutureDamageSwing(outgoingDamage * getFutureTurnWeightTotal(), maxHp, 110, 2)
          + Math.min(35, (incomingDamage / maxHp) * 60)
          + (pressure.canKo ? 22 : 0),
        0,
        155,
      );
    case StatusEffect.PARALYSIS:
      return clampPlannerScore(
        28
          + Math.min(45, pressure.maxDamageRatio * 36)
          + Math.min(36, scoreFutureSpeedBoost(healer, pokemon, 2) * 0.7)
          + dangerBonus,
        0,
        125,
      );
    case StatusEffect.BURN: {
      const physicalPenalty = targetReliesOnAttackCategory(pokemon, MoveCategory.PHYSICAL)
        ? Math.min(76, pressure.maxDamageRatio * 70 + (pressure.canKo ? 24 : 0))
        : 0;
      return clampPlannerScore(22 + residualScore + physicalPenalty + dangerBonus, 0, 145);
    }
    case StatusEffect.TOXIC:
      return clampPlannerScore(
        26 + residualScore * 1.35 + Math.min(48, status.toxicTurnCount * 9 + dangerRatio * 22) + dangerBonus,
        0,
        155,
      );
    case StatusEffect.POISON:
      return clampPlannerScore(18 + residualScore + dangerBonus, 0, 105);
    default:
      return 0;
  }
}

function getHealingRatioForAttr(user: Pokemon, move: Move, attr: HealAttr): number {
  if (attr instanceof WeatherHealAttr) {
    return attr.getWeatherHealRatio(getEffectiveWeatherForMove(user));
  }

  const attrData = attr as unknown as {
    healRatio?: unknown;
    normalHealRatio?: unknown;
    boostedHealRatio?: unknown;
  };

  if (typeof attrData.boostedHealRatio === "number") {
    return attrData.boostedHealRatio;
  }

  if (typeof attrData.normalHealRatio === "number") {
    return attrData.normalHealRatio;
  }

  if (typeof attrData.healRatio === "number") {
    return attrData.healRatio;
  }

  if (move.id === MoveId.REST) {
    return 1;
  }

  return 0.5;
}

function canHealBeforeLikelyKo(
  user: Pokemon,
  healedTarget: Pokemon,
  move: Move,
  actualHeal: number,
  incomingDamage: number,
): boolean {
  if (incomingDamage < healedTarget.hp || incomingDamage >= healedTarget.hp + actualHeal) {
    return false;
  }

  const threateningOpponents = healedTarget
    .getOpponents()
    .filter(opponent => estimateBestDamage(opponent, healedTarget).damage >= healedTarget.hp);

  if (threateningOpponents.length === 0) {
    return true;
  }

  return threateningOpponents.some(opponent => doesMoveActBeforeOpponent(user, opponent, move));
}

function doesMoveActBeforeOpponent(user: Pokemon, opponent: Pokemon, move: Move): boolean {
  const opponentPriority = getBestMovePriority(opponent);
  const movePriority = move.getPriority(user);
  return (
    movePriority > opponentPriority
    || (movePriority === opponentPriority
      && user.getEffectiveStat(Stat.SPD, { opponent }) >= opponent.getEffectiveStat(Stat.SPD, { opponent: user }))
  );
}

function getSetupMoveScore(user: Pokemon, move: Move, canSurviveSetup: boolean): number {
  const setupAttrs = move.getAttrs("StatStageChangeAttr").filter(attr => attr.selfTarget && attr.getLevels(user) > 0);
  if (setupAttrs.length === 0) {
    return 0;
  }

  const setupStages = setupAttrs.reduce((total, attr) => total + attr.stats.length * attr.getLevels(user), 0);
  return (canSurviveSetup ? 18 : -18) + Math.min(24, setupStages * 6) - (user.getHpRatio() < 0.25 ? 12 : 0);
}

function getSideSupportMoveScore(user: Pokemon, move: Move, incomingDamage: number): number {
  return move.moveTarget === MoveTarget.USER_SIDE ? (incomingDamage > user.getMaxHp() * 0.25 ? 28 : 10) : 0;
}

function getOpponentStatusMoveScore(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  targetIsOpponent: boolean,
  incomingDamage: number,
  targetThreatScore: number,
): number {
  if (!targetIsOpponent) {
    return 0;
  }

  const statStageScore = getOpponentStatStageMoveScore(user, target, move, incomingDamage);
  const hasUsableStatusEffect = move
    .getAttrs("StatusEffectAttr")
    .some(attr => getStatusEffectsForPlanner(attr).some(effect => canPlannerSetStatus(user, target, effect)));
  const hasImmediateDisruption = hasUsableStatusEffect || move.hasAttr("ForceSwitchOutAttr");
  const tempoRisk = isHighTempoStatusRisk(user, target, move, incomingDamage);

  let score = statStageScore;

  if (hasUsableStatusEffect) {
    score += Math.min(60, targetThreatScore * 0.35);
  }

  if (move.hasAttr("ForceSwitchOutAttr")) {
    score += Math.min(50, targetThreatScore * 0.25);
  }

  if (statStageScore > 0) {
    score += Math.min(35, targetThreatScore * 0.12);
  }

  if (tempoRisk && !hasImmediateDisruption && statStageScore <= 0) {
    score -= Math.min(120, 45 + targetThreatScore * 0.25);
  }

  return score;
}

function getOpponentStatStageMoveScore(user: Pokemon, target: Pokemon, move: Move, incomingDamage: number): number {
  const attrs = move.getAttrs("StatStageChangeAttr").filter(attr => !attr.selfTarget && attr.getLevels(user) < 0);
  if (attrs.length === 0) {
    return 0;
  }

  const tempoRisk = isHighTempoStatusRisk(user, target, move, incomingDamage);
  const canApplyBeforeTarget =
    move.priority > 0
    || user.getEffectiveStat(Stat.SPD, { opponent: target }) > target.getEffectiveStat(Stat.SPD, { opponent: user });

  return attrs.reduce((total, attr) => {
    const stages = Math.abs(attr.getLevels(user));
    return (
      total
      + attr.stats.reduce(
        (statTotal, stat) =>
          statTotal + scoreOpponentStatDrop(user, target, stat, stages, tempoRisk, canApplyBeforeTarget),
        0,
      )
    );
  }, 0);
}

function scoreOpponentStatDrop(
  user: Pokemon,
  target: Pokemon,
  stat: BattleStat,
  stages: number,
  tempoRisk: boolean,
  canApplyBeforeTarget: boolean,
): number {
  switch (stat) {
    case Stat.ATK:
      return scoreOffensiveStatDrop(target, MoveCategory.PHYSICAL, stages, tempoRisk, canApplyBeforeTarget);
    case Stat.SPATK:
      return scoreOffensiveStatDrop(target, MoveCategory.SPECIAL, stages, tempoRisk, canApplyBeforeTarget);
    case Stat.DEF:
      return scoreDefensiveStatDrop(user, target, MoveCategory.PHYSICAL, stages, tempoRisk);
    case Stat.SPDEF:
      return scoreDefensiveStatDrop(user, target, MoveCategory.SPECIAL, stages, tempoRisk);
    case Stat.SPD:
      return (tempoRisk ? 4 : 18) * stages;
    case Stat.ACC:
    case Stat.EVA:
      return (canApplyBeforeTarget ? 18 : 6) * stages;
    default:
      return 0;
  }
}

function scoreOffensiveStatDrop(
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  stages: number,
  tempoRisk: boolean,
  canApplyBeforeTarget: boolean,
): number {
  const relevant = targetReliesOnAttackCategory(target, category);
  if (!relevant) {
    return -70 * stages;
  }

  return (canApplyBeforeTarget ? 24 : 10) * stages - (tempoRisk && !canApplyBeforeTarget ? 22 * stages : 0);
}

function scoreDefensiveStatDrop(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  stages: number,
  tempoRisk: boolean,
): number {
  const canExploit = enemySideCanExploitDefenseDrop(user, target, category);
  if (!canExploit) {
    return -28 * stages;
  }

  return 12 * stages - (tempoRisk ? 34 * stages : 0);
}

function getFutureStatusMoveValue(
  user: Pokemon,
  target: Pokemon,
  move: Move,
  targetIsOpponent: boolean,
  targetThreatScore: number,
): number {
  const statStageValue = getFutureStatStageMoveValue(user, target, move);
  const statusValue = targetIsOpponent ? getFutureStatusEffectMoveValue(user, target, move, targetThreatScore) : 0;
  const accuracy = getAccuracyFactor(user, target, move);

  return clampPlannerScore((statStageValue + statusValue) * accuracy, -80, 190);
}

function getFutureStatStageMoveValue(user: Pokemon, target: Pokemon, move: Move): number {
  return move.getAttrs("StatStageChangeAttr").reduce((total, attr) => {
    const affectedPokemon = attr.selfTarget ? user : target;
    const stages = attr.getLevels(user);
    if (stages === 0) {
      return total;
    }

    const affectsOpponent = user.isOpponent(affectedPokemon);
    if (affectsOpponent && stages < 0) {
      return total + getFutureOpponentStatDropValue(user, affectedPokemon, attr.stats, stages);
    }

    if (!affectsOpponent && stages > 0) {
      return total + getFutureAllyStatBoostValue(user, affectedPokemon, attr.stats, stages);
    }

    return total - Math.min(90, Math.abs(stages) * attr.stats.length * 18);
  }, 0);
}

function getFutureOpponentStatDropValue(user: Pokemon, target: Pokemon, stats: BattleStat[], stages: number): number {
  return stats.reduce((total, stat) => {
    const appliedStages = getAppliedStatStageDelta(target, stat, stages);
    if (appliedStages === 0) {
      return total;
    }

    switch (stat) {
      case Stat.ATK:
        return total + scoreFutureOutgoingDamagePrevention(user, target, MoveCategory.PHYSICAL, appliedStages);
      case Stat.SPATK:
        return total + scoreFutureOutgoingDamagePrevention(user, target, MoveCategory.SPECIAL, appliedStages);
      case Stat.DEF:
        return total + scoreFutureIncomingDamageGain(user, target, MoveCategory.PHYSICAL, appliedStages);
      case Stat.SPDEF:
        return total + scoreFutureIncomingDamageGain(user, target, MoveCategory.SPECIAL, appliedStages);
      case Stat.SPD:
        return total + scoreFutureSpeedDrop(user, target, Math.abs(appliedStages));
      case Stat.ACC:
        return total + scoreFutureAccuracyDrop(user, target, Math.abs(appliedStages));
      case Stat.EVA:
        return total + scoreFutureEvasionDrop(user, target, Math.abs(appliedStages));
      default:
        return total;
    }
  }, 0);
}

function getFutureAllyStatBoostValue(user: Pokemon, target: Pokemon, stats: BattleStat[], stages: number): number {
  return stats.reduce((total, stat) => {
    const appliedStages = getAppliedStatStageDelta(target, stat, stages);
    if (appliedStages === 0) {
      return total;
    }

    switch (stat) {
      case Stat.ATK:
        return total + scoreFutureAllyOffenseBoost(user, target, MoveCategory.PHYSICAL, appliedStages);
      case Stat.SPATK:
        return total + scoreFutureAllyOffenseBoost(user, target, MoveCategory.SPECIAL, appliedStages);
      case Stat.DEF:
        return total + scoreFutureAllyDefenseBoost(user, target, MoveCategory.PHYSICAL, appliedStages);
      case Stat.SPDEF:
        return total + scoreFutureAllyDefenseBoost(user, target, MoveCategory.SPECIAL, appliedStages);
      case Stat.SPD:
        return total + scoreFutureSpeedBoost(user, target, appliedStages);
      case Stat.ACC:
        return total + Math.min(42, appliedStages * 18 + getBestOffensivePressure(target).maxDamageRatio * 18);
      case Stat.EVA:
        return total + Math.min(50, appliedStages * 16 + estimateIncomingDamage(target) * 1.4);
      default:
        return total;
    }
  }, 0);
}

function scoreFutureOutgoingDamagePrevention(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  appliedStages: number,
): number {
  if (!targetReliesOnAttackCategory(target, category)) {
    return -35 * Math.abs(appliedStages);
  }

  const friendlySide = getActiveSidePokemon(user, true);
  const damageScale =
    getStatStageMultiplier(
      target.getStatStage(category === MoveCategory.PHYSICAL ? Stat.ATK : Stat.SPATK) + appliedStages,
    ) / getStatStageMultiplier(target.getStatStage(category === MoveCategory.PHYSICAL ? Stat.ATK : Stat.SPATK));
  const preventedDamage = friendlySide.reduce((total, defender) => {
    const incomingDamage = estimateBestDamageByCategory(target, defender, category);
    return total + incomingDamage * Math.max(0, 1 - damageScale);
  }, 0);

  return scoreFutureDamageSwing(preventedDamage * getFutureTurnWeightTotal(), getAverageMaxHp(friendlySide), 125, 2.4);
}

function scoreFutureIncomingDamageGain(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  appliedStages: number,
): number {
  const attackers = getActiveSidePokemon(user, true);
  const stat = category === MoveCategory.PHYSICAL ? Stat.DEF : Stat.SPDEF;
  const damageScale =
    getStatStageMultiplier(target.getStatStage(stat))
    / getStatStageMultiplier(target.getStatStage(stat) + appliedStages);
  const currentDamage = attackers.reduce(
    (highestDamage, attacker) => Math.max(highestDamage, estimateBestDamageByCategory(attacker, target, category)),
    0,
  );
  const gainedDamage = currentDamage * Math.max(0, damageScale - 1);
  const targetHp = getPlannerHp(target, user);
  const targetMaxHp = getPlannerMaxHp(target, user);
  const koEnableBonus = currentDamage < targetHp && currentDamage + gainedDamage >= targetHp ? 48 : 0;

  return scoreFutureDamageSwing(gainedDamage * getFutureTurnWeightTotal(), targetMaxHp, 120, 2.2) + koEnableBonus;
}

function scoreFutureAllyOffenseBoost(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  appliedStages: number,
): number {
  const opponents = getActiveSidePokemon(user, false);
  const stat = category === MoveCategory.PHYSICAL ? Stat.ATK : Stat.SPATK;
  const damageScale =
    getStatStageMultiplier(target.getStatStage(stat) + appliedStages)
    / getStatStageMultiplier(target.getStatStage(stat));
  const currentDamage = opponents.reduce(
    (highestDamage, opponent) => Math.max(highestDamage, estimateBestDamageByCategory(target, opponent, category)),
    0,
  );
  const gainedDamage = currentDamage * Math.max(0, damageScale - 1);

  return scoreFutureDamageSwing(gainedDamage * getFutureTurnWeightTotal(), getAverageMaxHp(opponents), 118, 2.1);
}

function scoreFutureAllyDefenseBoost(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
  appliedStages: number,
): number {
  const opponents = getActiveSidePokemon(user, false);
  const stat = category === MoveCategory.PHYSICAL ? Stat.DEF : Stat.SPDEF;
  const damageScale =
    getStatStageMultiplier(target.getStatStage(stat))
    / getStatStageMultiplier(target.getStatStage(stat) + appliedStages);
  const preventedDamage = opponents.reduce((total, opponent) => {
    const incomingDamage = estimateBestDamageByCategory(opponent, target, category);
    return total + incomingDamage * Math.max(0, 1 - damageScale);
  }, 0);

  return scoreFutureDamageSwing(preventedDamage * getFutureTurnWeightTotal(), target.getMaxHp(), 125, 2.4);
}

function getFutureStatusEffectMoveValue(user: Pokemon, target: Pokemon, move: Move, targetThreatScore: number): number {
  return move.getAttrs("StatusEffectAttr").reduce((bestScore, attr) => {
    const effects = getStatusEffectsForPlanner(attr);
    const attrBestScore = effects.reduce((bestEffectScore, effect) => {
      if (!canPlannerSetStatus(user, target, effect)) {
        return bestEffectScore;
      }

      return Math.max(bestEffectScore, scoreFutureStatusEffect(user, target, effect, targetThreatScore));
    }, 0);

    return Math.max(bestScore, attrBestScore);
  }, 0);
}

function getStatusEffectsForPlanner(attr: { effect: StatusEffect }): readonly StatusEffect[] {
  const possibleMultiStatusAttr = attr as { effect: StatusEffect; effects?: readonly StatusEffect[] };
  return possibleMultiStatusAttr.effects ?? [possibleMultiStatusAttr.effect];
}

function scoreFutureStatusEffect(
  user: Pokemon,
  target: Pokemon,
  effect: StatusEffect,
  targetThreatScore: number,
): number {
  const friendlySide = getActiveSidePokemon(user, true);
  const threatDamage = estimateBestDamageAgainstSide(target, friendlySide);
  const targetMaxHp = getPlannerMaxHp(target, user);

  switch (effect) {
    case StatusEffect.SLEEP:
    case StatusEffect.FREEZE:
      return clampPlannerScore(
        scoreFutureDamageSwing(threatDamage * 1.45, getAverageMaxHp(friendlySide), 140, 2.5)
          + Math.min(55, targetThreatScore * 0.2),
        0,
        170,
      );
    case StatusEffect.PARALYSIS:
      return clampPlannerScore(
        scoreFutureDamageSwing(threatDamage * 0.32, getAverageMaxHp(friendlySide), 95, 1.8)
          + scoreFutureSpeedDrop(user, target, 2)
          + Math.min(28, targetThreatScore * 0.1),
        0,
        135,
      );
    case StatusEffect.BURN: {
      const physicalThreat = targetReliesOnAttackCategory(target, MoveCategory.PHYSICAL)
        ? scoreFutureOutgoingDamagePrevention(user, target, MoveCategory.PHYSICAL, -2) * 0.85
        : 0;
      const residualDamage = Math.max(1, Math.floor(targetMaxHp / 8)) * getFutureTurnWeightTotal();
      return clampPlannerScore(physicalThreat + scoreFutureDamageSwing(residualDamage, targetMaxHp, 90, 2), 0, 145);
    }
    case StatusEffect.TOXIC:
      return clampPlannerScore(scoreFutureDamageSwing(targetMaxHp * 0.18, targetMaxHp, 95, 1.8), 0, 110);
    case StatusEffect.POISON:
      return clampPlannerScore(scoreFutureDamageSwing(targetMaxHp * 0.125, targetMaxHp, 72, 1.4), 0, 85);
    default:
      return 0;
  }
}

function scoreFutureSpeedDrop(user: Pokemon, target: Pokemon, stages: number): number {
  const friendlySide = getActiveSidePokemon(user, true);
  const flips = friendlySide.filter(
    pokemon =>
      pokemon.getEffectiveStat(Stat.SPD, { opponent: target })
        < target.getEffectiveStat(Stat.SPD, { opponent: pokemon })
      && pokemon.getEffectiveStat(Stat.SPD, { opponent: target }) * getSpeedStageApproximation(stages)
        >= target.getEffectiveStat(Stat.SPD, { opponent: pokemon }),
  ).length;

  return Math.min(55, stages * 12 + flips * 18);
}

function scoreFutureSpeedBoost(user: Pokemon, target: Pokemon, stages: number): number {
  const opponents = getActiveSidePokemon(user, false);
  const flips = opponents.filter(
    opponent =>
      target.getEffectiveStat(Stat.SPD, { opponent }) < opponent.getEffectiveStat(Stat.SPD, { opponent: target })
      && target.getEffectiveStat(Stat.SPD, { opponent }) * getSpeedStageApproximation(stages)
        >= opponent.getEffectiveStat(Stat.SPD, { opponent: target }),
  ).length;

  return Math.min(55, stages * 12 + flips * 18 + getBestOffensivePressure(target).maxDamageRatio * 16);
}

function scoreFutureAccuracyDrop(user: Pokemon, target: Pokemon, stages: number): number {
  const friendlySide = getActiveSidePokemon(user, true);
  const threatDamage = estimateBestDamageAgainstSide(target, friendlySide);
  return scoreFutureDamageSwing(threatDamage * Math.min(0.5, stages * 0.2), getAverageMaxHp(friendlySide), 95, 1.7);
}

function scoreFutureEvasionDrop(user: Pokemon, target: Pokemon, stages: number): number {
  const friendlySide = getActiveSidePokemon(user, true);
  const pressureDamage = estimateBestDamageAgainstSideFromCategory(friendlySide, target);
  return scoreFutureDamageSwing(pressureDamage * Math.min(0.45, stages * 0.16), getPlannerMaxHp(target, user), 85, 1.4);
}

function getAppliedStatStageDelta(pokemon: Pokemon, stat: BattleStat, stages: number): number {
  const currentStage = pokemon.getStatStage(stat);
  return Math.max(-6, Math.min(6, currentStage + stages)) - currentStage;
}

function getStatStageMultiplier(stage: number): number {
  return stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage);
}

function getSpeedStageApproximation(stages: number): number {
  return getStatStageMultiplier(Math.min(6, Math.max(1, stages)));
}

function getFutureTurnWeightTotal(): number {
  return FUTURE_TURN_WEIGHTS.reduce((total, weight) => total + weight, 0);
}

function scoreFutureDamageSwing(damage: number, referenceHp: number, ratioWeight: number, flatWeight: number): number {
  if (damage <= 0) {
    return 0;
  }

  return Math.min(120, (damage / Math.max(1, referenceHp)) * ratioWeight + damage * flatWeight);
}

function getActiveSidePokemon(referencePokemon: Pokemon, sameSide: boolean): Pokemon[] {
  return globalScene
    .getField(true)
    .filter(pokemon => pokemon.isAllowedInBattle() && !pokemon.isFainted())
    .filter(pokemon => (sameSide ? !referencePokemon.isOpponent(pokemon) : referencePokemon.isOpponent(pokemon)));
}

function getAverageMaxHp(pokemon: Pokemon[]): number {
  if (pokemon.length === 0) {
    return 1;
  }

  return pokemon.reduce((total, currentPokemon) => total + currentPokemon.getMaxHp(), 0) / pokemon.length;
}

function estimateBestDamageAgainstSide(attacker: Pokemon, defenders: Pokemon[]): number {
  return defenders.reduce(
    (highestDamage, defender) => Math.max(highestDamage, estimateBestDamage(attacker, defender).damage),
    0,
  );
}

function estimateBestDamageAgainstSideFromCategory(attackers: Pokemon[], defender: Pokemon): number {
  return attackers.reduce(
    (highestDamage, attacker) => Math.max(highestDamage, estimateBestDamage(attacker, defender).damage),
    0,
  );
}

function clampPlannerScore(score: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, score));
}

function isHighTempoStatusRisk(user: Pokemon, target: Pokemon, move: Move, incomingDamage: number): boolean {
  const slowerOrTied =
    move.priority <= 0
    && target.getEffectiveStat(Stat.SPD, { opponent: user }) >= user.getEffectiveStat(Stat.SPD, { opponent: target });
  return slowerOrTied && incomingDamage >= user.hp * 0.55;
}

function getStatusMoveRedundancyPenalty(target: Pokemon, targetIsOpponent: boolean): number {
  return targetIsOpponent && target.status ? -16 : 0;
}

function getProtectMoveScore(user: Pokemon, move: Move, incomingDamage: number): number {
  return move.hasAttr("ProtectAttr") ? (incomingDamage >= user.hp ? 70 : 8) : 0;
}

function estimateDamage(user: Pokemon, target: Pokemon, move: Move) {
  const ignoreAbility = !target.waveData.abilityRevealed;
  const useIllusion = shouldUsePlannerIllusion(user, target);
  const effectiveness = useIllusion
    ? target.getAttackTypeEffectiveness(user.getMoveType(move, true, target), {
        source: user,
        simulated: true,
        move,
        useIllusion: true,
      })
    : undefined;

  return target.getAttackDamage({
    source: user,
    move,
    ignoreAbility,
    ignoreSourceAbility: false,
    ignoreAllyAbility: !target.getAllies().some(ally => ally.waveData.abilityRevealed),
    ignoreSourceAllyAbility: false,
    isCritical: move.hasAttr("CritOnlyAttr") || !!user.getTag(BattlerTagType.ALWAYS_CRIT),
    simulated: true,
    ...(effectiveness === undefined ? {} : { effectiveness }),
  });
}

function estimateBestDamage(attacker: Pokemon, defender: Pokemon): { damage: number } {
  const bestDamage = attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .filter(move => !!move && canMoveReachTarget(attacker, defender, move.id))
    .map(move => estimateDamage(attacker, defender, move).damage)
    .reduce((best, damage) => Math.max(best, damage), 0);

  return { damage: bestDamage };
}

function estimateBestDamageByCategory(
  attacker: Pokemon,
  defender: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): number {
  return attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category === category)
    .filter(move => !!move && canMoveReachTarget(attacker, defender, move.id))
    .map(move => estimateDamage(attacker, defender, move).damage)
    .reduce((best, damage) => Math.max(best, damage), 0);
}

function estimateIncomingDamage(user: Pokemon): number {
  return getAiRelevantOpponents(user)
    .reduce((highestDamage, opponent) => Math.max(highestDamage, estimateBestDamage(opponent, user).damage), 0);
}

function estimateIncomingDamageDetailed(user: Pokemon): PlannerIncomingDamageEstimate {
  const threats = getAiRelevantOpponents(user)
    .map(
      opponent =>
        opponent
          .getMoveset()
          .map(pokemonMove => pokemonMove.getMove())
          .filter(move => !!move && move.category !== MoveCategory.STATUS)
          .filter(move => !!move && canMoveReachTarget(opponent, user, move.id))
          .map(move => ({
            attacker: opponent,
            move,
            label: getPlannerPokemonLabel(opponent),
            moveName: move.name,
            damage: estimateDamage(opponent, user, move).damage,
          }))
          .sort((a, b) => b.damage - a.damage)[0],
    )
    .filter((threat): threat is PlannerIncomingThreat => !!threat && threat.damage > 0)
    .sort((a, b) => compareIncomingThreatOrder(user, a, b));

  if (threats.length === 0) {
    return { incomingDamage: 0, incomingThreats: "", threats: [] };
  }

  const incomingDamage = threats.reduce((total, threat) => total + threat.damage, 0);
  const strongestThreat = threats.reduce((strongest, threat) =>
    threat.damage > strongest.damage ? threat : strongest,
  );
  return {
    incomingDamage,
    incomingThreats: threats
      .map(threat => `${threat.label} ${threat.moveName} ${formatPlannerScore(threat.damage)}`)
      .join(" + "),
    threats,
    strongestThreat,
  };
}

function compareIncomingThreatOrder(user: Pokemon, a: PlannerIncomingThreat, b: PlannerIncomingThreat): number {
  const aPriority = a.move.getPriority(a.attacker);
  const bPriority = b.move.getPriority(b.attacker);
  if (aPriority !== bPriority) {
    return bPriority - aPriority;
  }

  const aSpeed = a.attacker.getEffectiveStat(Stat.SPD, { opponent: user });
  const bSpeed = b.attacker.getEffectiveStat(Stat.SPD, { opponent: user });
  if (aSpeed !== bSpeed) {
    return bSpeed - aSpeed;
  }

  return b.damage - a.damage;
}

function getActiveEmergencyEscapeOption(
  user: Pokemon,
  incoming: PlannerIncomingDamageEstimate,
): PlannerActiveEscapeOption | undefined {
  if (incoming.incomingDamage < user.hp || incoming.threats.length === 0) {
    return;
  }

  const options = user
    .getMoveset()
    .flatMap(pokemonMove =>
      scorePlannerMoveCandidates(user, pokemonMove).map(choice => ({
        pokemonMove,
        choice,
        move: pokemonMove.getMove(),
      })),
    )
    .filter((option): option is { pokemonMove: PokemonMove; choice: PlannerMoveChoice; move: Move } => !!option.move)
    .map(option => getActiveEmergencyEscapeFromChoice(user, incoming, option.choice, option.move))
    .filter((option): option is PlannerActiveEscapeOption => !!option)
    .sort((a, b) => a.projectedIncomingDamage - b.projectedIncomingDamage);

  return options[0];
}

function getActiveEmergencyEscapeFromChoice(
  user: Pokemon,
  incoming: PlannerIncomingDamageEstimate,
  choice: PlannerMoveChoice,
  move: Move,
): PlannerActiveEscapeOption | undefined {
  const firstThreat = incoming.threats[0];
  const strongestThreat = incoming.strongestThreat ?? firstThreat;
  if (!firstThreat || !strongestThreat) {
    return;
  }

  const actionTargets = createPlannerSearchAction(user, choice, move).targets;

  if (move.hasAttr("ProtectAttr") && doesMoveActBeforeThreat(user, firstThreat.attacker, move, firstThreat.move)) {
    return {
      label: `${move.name} blocks incoming hits`,
      projectedIncomingDamage: 0,
    };
  }

  const projectedIncomingDamage = incoming.threats.reduce((total, threat) => {
    const actsBeforeThreat = doesMoveActBeforeThreat(user, threat.attacker, move, threat.move);
    if (!actsBeforeThreat) {
      return total + threat.damage;
    }

    if (move.hasAttr("ProtectAttr")) {
      return total;
    }

    let damage = threat.damage;
    const threatCategory = getPlannerDamagingCategory(threat.move);
    const targetsThreat = choice.targets.includes(threat.attacker.getBattlerIndex());
    if (
      targetsThreat
      && doesMoveWork(user, threat.attacker, move)
      && getAccuracyFactor(user, threat.attacker, move) >= 0.85
    ) {
      const userDamage = move.category === MoveCategory.STATUS ? 0 : estimateDamage(user, threat.attacker, move).damage;
      if (userDamage >= getPlannerHp(threat.attacker, user)) {
        return total;
      }
      damage *= threatCategory ? getPlannerActionOutgoingDamageScale(user, threat.attacker, move, threatCategory) : 1;
    }

    if (threatCategory && actionTargets.some(target => target.pokemon === user)) {
      damage *= getPlannerActionIncomingDamageScale(user, move, threatCategory);
    }

    return total + damage;
  }, 0);

  const damageBeforeAction = incoming.threats
    .filter(threat => !doesMoveActBeforeThreat(user, threat.attacker, move, threat.move))
    .reduce((total, threat) => total + threat.damage, 0);

  const projectedHp = getProjectedHpAfterDirectHealing(user, user, move, actionTargets);
  if (
    projectedHp > user.hp
    && damageBeforeAction < user.hp
    && projectedIncomingDamage < projectedHp
    && projectedIncomingDamage < incoming.incomingDamage
  ) {
    return {
      label: `${move.name} heals through incoming hits`,
      projectedIncomingDamage,
    };
  }

  if (projectedIncomingDamage < user.hp && projectedIncomingDamage < incoming.incomingDamage) {
    const label = actionTargets.some(target => target.pokemon === user)
      ? `${move.name} reduces later hits to ${formatPlannerScore(projectedIncomingDamage)}`
      : `${move.name} handles ${strongestThreat.label} ${strongestThreat.moveName}`;
    return { label, projectedIncomingDamage };
  }
}

function doesMoveActBeforeThreat(user: Pokemon, attacker: Pokemon, move: Move, threatMove: Move): boolean {
  const movePriority = move.getPriority(user);
  const threatPriority = threatMove.getPriority(attacker);
  return (
    movePriority > threatPriority
    || (movePriority === threatPriority
      && user.getEffectiveStat(Stat.SPD, { opponent: attacker })
        >= attacker.getEffectiveStat(Stat.SPD, { opponent: user }))
  );
}

function estimateSwitchIncomingDamage(
  activePokemon: Pokemon,
  switchTarget: Pokemon,
): { incomingDamage: number; incomingThreats: string } {
  const weightedThreats = activePokemon
    .getOpponents()
    .map(opponent => estimateLikelySwitchInDamage(opponent, activePokemon, switchTarget))
    .filter(threat => !!threat)
    .filter(threat => threat.damage > 0)
    .sort((a, b) => b.damage - a.damage)
    .slice(0, 3);

  if (weightedThreats.length === 0) {
    return { incomingDamage: 0, incomingThreats: "" };
  }

  const weights = getPlannerIqProfile(activePokemon).switchThreatWeights;
  const incomingDamage = weightedThreats.reduce(
    (total, threat, index) => total + threat.damage * (weights[index] ?? 0),
    0,
  );
  const incomingThreats = weightedThreats
    .map((threat, index) => {
      const weight = weights[index] ?? 0;
      const threatText = `${threat.label} ${threat.moveName} ${formatPlannerScore(threat.damage)} (slot ${formatPlannerScore(threat.activeSlotDamage)})`;
      return weight === 1 ? threatText : `${threatText}x${formatPlannerScore(weight)}`;
    })
    .join(" + ");

  return { incomingDamage, incomingThreats };
}

function estimateLikelySwitchInDamage(
  attacker: Pokemon,
  activeSlotTarget: Pokemon,
  switchTarget: Pokemon,
): { label: string; moveName: string; damage: number; activeSlotDamage: number } | undefined {
  const likelyMove = attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .filter(move => !!move && canMoveReachTarget(attacker, activeSlotTarget, move.id))
    .map(move => ({
      move,
      activeSlotDamage: estimateDamage(attacker, activeSlotTarget, move).damage,
      switchDamage: estimateDamage(attacker, switchTarget, move).damage,
    }))
    .sort((a, b) => b.activeSlotDamage - a.activeSlotDamage || b.switchDamage - a.switchDamage)[0];

  if (!likelyMove) {
    return;
  }

  return {
    label: getPlannerPokemonLabel(attacker),
    moveName: likelyMove.move.name,
    damage: likelyMove.switchDamage,
    activeSlotDamage: likelyMove.activeSlotDamage,
  };
}

function estimateEndOfTurnResidualDamage(pokemon: Pokemon): number {
  const status = pokemon.status;
  if (!status) {
    return 0;
  }

  const maxHp = pokemon.getMaxHp();
  switch (status.effect) {
    case StatusEffect.BURN:
    case StatusEffect.POISON:
      return Math.max(1, Math.floor(maxHp / 8));
    case StatusEffect.TOXIC:
      return Math.max(1, Math.floor((maxHp * Math.max(1, status.toxicTurnCount + 1)) / 16));
    default:
      return 0;
  }
}

function estimateNextEndOfTurnResidualDamage(pokemon: Pokemon): number {
  const status = pokemon.status;
  if (!status) {
    return 0;
  }

  const maxHp = pokemon.getMaxHp();
  switch (status.effect) {
    case StatusEffect.BURN:
    case StatusEffect.POISON:
      return Math.max(1, Math.floor(maxHp / 8));
    case StatusEffect.TOXIC:
      return Math.max(1, Math.floor((maxHp * Math.max(1, status.toxicTurnCount + 2)) / 16));
    default:
      return 0;
  }
}

function getProtectedObjectivePriority(pokemon: Pokemon): number {
  const encounter = globalScene.currentBattle?.mysteryEncounter;
  if (!encounter?.misc) {
    return 0;
  }

  const data = encounter.misc as Record<string, unknown>;
  if (
    encounter.encounterType === MysteryEncounterType.POKE_POACHERS
    && data.rescueActive === true
    && data.protectedLegendaryId === pokemon.id
  ) {
    return 1.35;
  }

  if (
    encounter.encounterType === MysteryEncounterType.LEGENDARY_CONFLICT
    && data.legendaryConflictDuelActive === true
    && data.helpedLegendaryId === pokemon.id
  ) {
    return 1.2;
  }

  return 0;
}

function getAverageActiveFieldMaxHp(): number {
  const activePokemon = globalScene.getField(true).filter(pokemon => pokemon.isAllowedInBattle());
  if (activePokemon.length === 0) {
    return 1;
  }

  return activePokemon.reduce((total, pokemon) => total + pokemon.getMaxHp(), 0) / activePokemon.length;
}

function getBestOffensivePressure(user: Pokemon): PlannerOffensivePressure {
  return getAiRelevantOpponents(user).reduce<PlannerOffensivePressure>(
    (best, opponent) => {
      const damage = estimateBestDamage(user, opponent).damage;
      const opponentHp = getPlannerHp(opponent, user);
      const maxDamageRatio = opponentHp > 0 ? damage / opponentHp : 0;
      return {
        maxDamageRatio: Math.max(best.maxDamageRatio, maxDamageRatio),
        canKo: best.canKo || damage >= opponentHp,
      };
    },
    { maxDamageRatio: 0, canKo: false },
  );
}

function canMoveReachTarget(user: Pokemon, target: Pokemon, moveId: MoveId): boolean {
  const targetData = getAiMoveTargetData(user, moveId);
  return targetData.selectableTargets.includes(target);
}

function targetReliesOnAttackCategory(
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): boolean {
  const oppositeCategory = category === MoveCategory.PHYSICAL ? MoveCategory.SPECIAL : MoveCategory.PHYSICAL;
  const defenders = getAiRelevantOpponents(target);
  const categoryDamage = defenders.reduce(
    (best, defender) => Math.max(best, estimateBestDamageByCategory(target, defender, category)),
    0,
  );
  const oppositeDamage = defenders.reduce(
    (best, defender) => Math.max(best, estimateBestDamageByCategory(target, defender, oppositeCategory)),
    0,
  );

  return categoryDamage > 0 && categoryDamage >= Math.max(1, oppositeDamage * 0.8);
}

function enemySideCanExploitDefenseDrop(
  user: Pokemon,
  target: Pokemon,
  category: MoveCategory.PHYSICAL | MoveCategory.SPECIAL,
): boolean {
  return globalScene
    .getField(true)
    .filter(pokemon => !user.isOpponent(pokemon) && pokemon.isAllowedInBattle())
    .some(pokemon => estimateBestDamageByCategory(pokemon, target, category) >= getPlannerMaxHp(target, user) * 0.18);
}

function getPlannerMoveTargets(user: Pokemon, moveId: MoveId): BattlerIndex[] {
  const targetData = getAiMoveTargetData(user, moveId);
  const targets = targetData.targetSet.multiple ? targetData.allTargets : targetData.selectableTargets;
  return targets.map(target => target.getBattlerIndex());
}

function getAccuracyFactor(user: Pokemon, target: Pokemon, move: Move): number {
  if (move.accuracy === -1) {
    return 1;
  }

  return Math.max(0.35, Math.min(1, move.calculateBattleAccuracy(user, target, true) / 100));
}

function getTargetThreatScore(user: Pokemon, target: Pokemon): number {
  const friendlyField = globalScene.getField(true).filter(pokemon => !user.isOpponent(pokemon) && !pokemon.isFainted());

  const strongestDamageRatio = friendlyField.reduce((highestRatio, friendlyPokemon) => {
    const damage = estimateBestDamage(target, friendlyPokemon).damage;
    const ratio = friendlyPokemon.hp > 0 ? damage / friendlyPokemon.hp : 0;
    return Math.max(highestRatio, ratio);
  }, 0);

  const activeThreatScore = Math.min(70, strongestDamageRatio * 34);
  const partyThreatScore = user.isPlayer() ? 0 : getEnemyPartyThreatScore(user, target);

  return Math.min(300, activeThreatScore + partyThreatScore);
}

function getEnemyPartyThreatScore(user: Pokemon, target: Pokemon): number {
  const enemyParty = globalScene.getEnemyParty().filter(pokemon => pokemon.isAllowedInBattle());
  if (enemyParty.length === 0) {
    return 0;
  }

  const pressureScores = enemyParty
    .map(pokemon => getTargetPressureAgainstEnemyPartyMember(user, target, pokemon))
    .filter((pressure): pressure is PlannerThreatPressure => !!pressure);

  if (pressureScores.length === 0) {
    return 0;
  }

  const vulnerableCount = pressureScores.filter(pressure => pressure.incomingRatio >= 0.35).length;
  const severeCount = pressureScores.filter(pressure => pressure.incomingRatio >= 0.65 || pressure.canBeKoed).length;
  const answerCount = pressureScores.filter(pressure => pressure.answerRatio >= 0.35 || pressure.canAnswerKo).length;
  const averageIncomingRatio =
    pressureScores.reduce((total, pressure) => total + pressure.incomingRatio, 0) / pressureScores.length;

  if (vulnerableCount === 0 && severeCount === 0) {
    return 0;
  }

  const noReliableAnswer = answerCount === 0;
  const spreadPressure = hasSpreadDamagePressure(target, user) ? 24 : 0;
  const wholeTeamPressure = vulnerableCount >= Math.max(2, Math.ceil(enemyParty.length * 0.65)) ? 28 : 0;

  return Math.min(
    220,
    vulnerableCount * 18
      + severeCount * 14
      + averageIncomingRatio * 36
      + (noReliableAnswer ? 34 : 0)
      + spreadPressure
      + wholeTeamPressure
      - answerCount * 10,
  );
}

interface PlannerThreatPressure {
  incomingRatio: number;
  answerRatio: number;
  canBeKoed: boolean;
  canAnswerKo: boolean;
}

function getTargetPressureAgainstEnemyPartyMember(
  activeUser: Pokemon,
  target: Pokemon,
  defender: Pokemon,
): PlannerThreatPressure | undefined {
  const evaluatePressure = () => {
    const incomingDamage = estimateBestDamage(target, defender).damage;
    const answerDamage = estimateBestDamage(defender, target).damage;
    const targetHp = getPlannerHp(target, defender);
    const targetMaxHp = getPlannerMaxHp(target, defender);
    return {
      incomingRatio: defender.getMaxHp() > 0 ? incomingDamage / defender.getMaxHp() : 0,
      answerRatio: targetMaxHp > 0 ? answerDamage / targetMaxHp : 0,
      canBeKoed: incomingDamage >= defender.hp,
      canAnswerKo: answerDamage >= targetHp,
    };
  };

  if (defender.isOnField()) {
    return evaluatePressure();
  }

  return withEnemyPartySlotSimulation(activeUser, defender, evaluatePressure);
}

function hasSpreadDamagePressure(attacker: Pokemon, defender: Pokemon): boolean {
  return attacker
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .some(move => {
      const moveTargets = getMoveTargets(attacker, move.id);
      return moveTargets.multiple && moveTargets.targets.includes(defender.getBattlerIndex());
    });
}

function getAverageMatchupScore(pokemon: Pokemon): number {
  const opponents = getAiRelevantOpponents(pokemon);
  if (opponents.length === 0) {
    return 0;
  }

  return (
    opponents.map(opponent => pokemon.getMatchupScore(opponent)).reduce((total, score) => total + score, 0)
    / opponents.length
  );
}

function chooseFromBestPlannerChoices(user: Pokemon, choices: PlannerMoveChoice[]): PlannerMoveChoice | undefined {
  if (choices.length === 0) {
    return;
  }

  const iqProfile = getPlannerIqProfile(user);
  const viableChoices = getPlannerIqViableChoices(choices);
  if (viableChoices.length === 0) {
    return choices[0];
  }

  const rankedChoices = getPlannerIqEligibleChoices(viableChoices, iqProfile);
  const totalWeight = rankedChoices.reduce((total, rankedChoice) => total + rankedChoice.weight, 0);
  if (totalWeight <= 0) {
    return rankedChoices[0]?.choice ?? viableChoices[0];
  }

  let roll = globalScene.randBattleSeedInt(totalWeight);
  for (const rankedChoice of rankedChoices) {
    roll -= rankedChoice.weight;
    if (roll < 0) {
      return rankedChoice.choice;
    }
  }

  return rankedChoices[0]?.choice ?? viableChoices[0];
}

function getPlannerIqProfile(user: Pokemon): PlannerIqProfile {
  if (user.isBoss()) {
    return PLANNER_IQ_PROFILES.boss;
  }

  return PLANNER_IQ_PROFILES.mid;
}

function getPlannerIqViableChoices(choices: PlannerMoveChoice[]): PlannerMoveChoice[] {
  const nonFailChoices = choices.filter(choice => choice.score > FAIL_SCORE / 2);
  const nonNegativeChoices = nonFailChoices.filter(choice => choice.score >= 0);
  return nonNegativeChoices.length > 0 ? nonNegativeChoices : nonFailChoices;
}

function getPlannerIqEligibleChoices(
  choices: PlannerMoveChoice[],
  iqProfile: PlannerIqProfile,
): { choice: PlannerMoveChoice; weight: number }[] {
  const bestScore = choices[0]?.score ?? 0;
  return choices
    .slice(0, iqProfile.weights.length)
    .map((choice, rank) => ({ choice, rank, weight: iqProfile.weights[rank] ?? 0 }))
    .filter(
      ({ choice, rank, weight }) =>
        weight > 0 && isPlannerIqChoiceWithinReason(choice.score, bestScore, rank, iqProfile),
    );
}

function isPlannerIqChoiceWithinReason(
  score: number,
  bestScore: number,
  rank: number,
  iqProfile: PlannerIqProfile,
): boolean {
  if (rank === 0) {
    return true;
  }

  if (score <= FAIL_SCORE / 2) {
    return false;
  }

  if (bestScore < 0) {
    return score >= bestScore - 12;
  }

  if (score < 0) {
    return false;
  }

  return score >= bestScore * iqProfile.minScoreRatios[rank] || bestScore - score <= iqProfile.maxScoreGaps[rank];
}

installPlannerDebugConsoleHelper();
