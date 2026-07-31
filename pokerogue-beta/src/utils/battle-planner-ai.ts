import { globalScene } from "#app/global-scene";
import { getEffectiveWeatherForMove } from "#data/weather";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { BATTLE_STATS, type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { type HealAttr, type Move, WeatherHealAttr } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import type { PokemonMove } from "#moves/pokemon-move";
import type { TurnMove } from "#types/turn-move";
import { getAiMoveTargetData } from "#utils/ai-targeting";

const FAIL_SCORE = -100_000;
const KO_SCORE = 220;
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
  spreadFollowupScore: number;
  wastedTurnPenalty: number;
}

interface PlannerTargetScore {
  battlerIndex: BattlerIndex;
  score: number;
  breakdown: PlannerMoveScoreBreakdown;
}

interface PlannerOffensivePressure {
  maxDamageRatio: number;
  canKo: boolean;
}

export function choosePlannerMove(user: Pokemon, movePool: PokemonMove[]): TurnMove {
  installPlannerDebugConsoleHelper();

  const choices = movePool
    .map(move => scorePlannerMove(user, move))
    .filter((scoredMove): scoredMove is PlannerMoveChoice => !!scoredMove)
    .map(choice => scorePlannerChoiceByOneTurnSearch(user, choice))
    .sort((a, b) => b.score - a.score);

  const chosenMove = chooseFromBestPlannerChoices(choices);
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
): number | undefined {
  installPlannerDebugConsoleHelper();

  if (partyMemberScores.length === 0 || activePokemon.getOpponents().length === 0) {
    return;
  }

  const enemyParty = globalScene.getEnemyParty();
  const activePartyIndex = enemyParty.indexOf(activePokemon as (typeof enemyParty)[number]);
  if (activePokemon.isPlayer() || activePartyIndex === -1) {
    return;
  }

  const currentScore = getAverageMatchupScore(activePokemon);
  const bestScore = Math.max(...partyMemberScores.map(([, score]) => score));
  const bestAdjustedScore = bestScore * switchMultiplier;
  const hpRatio = activePokemon.getHpRatio();
  const canThreatenKo = activePokemon
    .getOpponents()
    .some(opponent => estimateBestDamage(activePokemon, opponent).damage >= opponent.hp);
  const currentIncomingDamage = estimateIncomingDamage(activePokemon);
  const likelyFaints = currentIncomingDamage >= activePokemon.hp;
  const activePressure = getBestOffensivePressure(activePokemon);
  const canContributeThisTurn = !likelyFaints && (activePressure.maxDamageRatio >= 0.18 || canThreatenKo);

  const multiplierThreshold = isBossTrainer ? 1.6 : 2.1;
  const improvement = bestAdjustedScore - currentScore;
  const severeMismatch = currentScore < 4 && improvement >= 4;
  const strongUpgrade = bestAdjustedScore >= currentScore * multiplierThreshold;
  const preserveLowHpThreat = hpRatio < 0.35 && improvement >= 3 && !canThreatenKo && !canContributeThisTurn;
  const escapeKo = likelyFaints && improvement >= 2 && !canThreatenKo;

  const candidateEvaluations = partyMemberScores
    .map(([partyIndex, score]) =>
      scoreSwitchCandidate({
        activePokemon,
        candidate: enemyParty[partyIndex],
        partyIndex,
        matchupScore: score,
        bestMatchupScore: bestScore,
        currentIncomingDamage,
        likelyActiveFaints: likelyFaints,
        canActiveContribute: canContributeThisTurn,
        allyAlreadySwitching,
      }),
    )
    .filter((candidate): candidate is PlannerSwitchCandidate => !!candidate)
    .sort((a, b) => b.score - a.score);

  if (!severeMismatch && !strongUpgrade && !preserveLowHpThreat && !escapeKo) {
    logPlannerSwitchEvaluations(activePokemon, {
      activeScore: currentScore,
      bestScore,
      bestAdjustedScore,
      switchMultiplier,
      improvement,
      currentIncomingDamage,
      likelyFaints,
      canContributeThisTurn,
      allyAlreadySwitching,
      decision: "stay",
      reason: "switch threshold not met",
      candidates: candidateEvaluations,
    });
    return;
  }

  const viableCandidates = candidateEvaluations.filter(candidate => candidate.score > FAIL_SCORE);

  const bestCandidateScore = viableCandidates[0]?.score;
  if (bestCandidateScore === undefined) {
    logPlannerSwitchEvaluations(activePokemon, {
      activeScore: currentScore,
      bestScore,
      bestAdjustedScore,
      switchMultiplier,
      improvement,
      currentIncomingDamage,
      likelyFaints,
      canContributeThisTurn,
      allyAlreadySwitching,
      decision: "stay",
      reason: "no viable switch target",
      candidates: candidateEvaluations,
    });
    return;
  }

  const bestIndexes = viableCandidates
    .filter(candidate => candidate.score >= bestCandidateScore - 0.5)
    .map(candidate => candidate.partyIndex);

  const chosenPartyIndex = bestIndexes[globalScene.randBattleSeedInt(bestIndexes.length)];
  logPlannerSwitchEvaluations(activePokemon, {
    activeScore: currentScore,
    bestScore,
    bestAdjustedScore,
    switchMultiplier,
    improvement,
    currentIncomingDamage,
    likelyFaints,
    canContributeThisTurn,
    allyAlreadySwitching,
    decision: `switch -> ${chosenPartyIndex}`,
    reason: "switch threshold met",
    candidates: candidateEvaluations,
    chosenPartyIndex,
  });

  return chosenPartyIndex;
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
  hpAfterSwitch: number;
  hpAfterSwitchRatio: number;
  switchInDamageRatio: number;
  pressure: number;
  canKo: boolean;
  reasons: string[];
}

interface PlannerSwitchDebugSummary {
  activeScore: number;
  bestScore: number;
  bestAdjustedScore: number;
  switchMultiplier: number;
  improvement: number;
  currentIncomingDamage: number;
  likelyFaints: boolean;
  canContributeThisTurn: boolean;
  allyAlreadySwitching: boolean;
  decision: string;
  reason: string;
  candidates: PlannerSwitchCandidate[];
  chosenPartyIndex?: number;
}

interface PlannerSwitchCandidateContext {
  activePokemon: Pokemon;
  candidate?: Pokemon;
  partyIndex: number;
  matchupScore: number;
  bestMatchupScore: number;
  currentIncomingDamage: number;
  likelyActiveFaints: boolean;
  canActiveContribute: boolean;
  allyAlreadySwitching: boolean;
}

function scoreSwitchCandidate(context: PlannerSwitchCandidateContext): PlannerSwitchCandidate | undefined {
  const {
    activePokemon,
    candidate,
    partyIndex,
    matchupScore,
    bestMatchupScore,
    currentIncomingDamage,
    likelyActiveFaints,
    canActiveContribute,
    allyAlreadySwitching,
  } = context;

  if (!candidate?.isAllowedInBattle() || candidate.isOnField()) {
    return;
  }

  const switchIn = evaluateSwitchIn(activePokemon, candidate);
  if (!switchIn) {
    return;
  }

  const hpAfterSwitch = candidate.hp - switchIn.incomingDamage;
  const hpAfterSwitchRatio = candidate.getMaxHp() > 0 ? hpAfterSwitch / candidate.getMaxHp() : 0;
  const switchInDamageRatio = candidate.hp > 0 ? switchIn.incomingDamage / candidate.hp : 1;
  const getsKoedOnEntry = hpAfterSwitch <= 0;
  const getsCrippledOnEntry = hpAfterSwitchRatio < 0.28;
  const candidateHasPlan = switchIn.offensivePressure.maxDamageRatio >= 0.22 || switchIn.offensivePressure.canKo;
  const candidateIsBestMatchup = matchupScore === bestMatchupScore;
  const debug: PlannerSwitchCandidateDebug = {
    pokemonName: getPlannerPokemonLabel(candidate),
    matchupScore,
    incomingDamage: switchIn.incomingDamage,
    hpAfterSwitch,
    hpAfterSwitchRatio,
    switchInDamageRatio,
    pressure: switchIn.offensivePressure.maxDamageRatio,
    canKo: switchIn.offensivePressure.canKo,
    reasons: [],
  };

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
  score += likelyActiveFaints && hpAfterSwitchRatio > 0.45 ? 3 : 0;
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
): { incomingDamage: number; offensivePressure: PlannerOffensivePressure } | undefined {
  return withEnemyPartySlotSimulation(activePokemon, candidate, () => ({
    incomingDamage: estimateIncomingDamage(candidate),
    offensivePressure: getBestOffensivePressure(candidate),
  }));
}

function withEnemyPartySlotSimulation<T>(activePokemon: Pokemon, candidate: Pokemon, callback: () => T): T | undefined {
  const enemyParty = globalScene.getEnemyParty();
  const activePartyIndex = enemyParty.indexOf(activePokemon as (typeof enemyParty)[number]);
  const candidatePartyIndex = enemyParty.indexOf(candidate as (typeof enemyParty)[number]);

  if (activePartyIndex === -1 || candidatePartyIndex === -1 || activePartyIndex === candidatePartyIndex) {
    return;
  }

  enemyParty[activePartyIndex] = candidate as (typeof enemyParty)[number];
  enemyParty[candidatePartyIndex] = activePokemon as (typeof enemyParty)[number];
  try {
    return callback();
  } finally {
    enemyParty[activePartyIndex] = activePokemon as (typeof enemyParty)[number];
    enemyParty[candidatePartyIndex] = candidate as (typeof enemyParty)[number];
  }
}

function scorePlannerMove(user: Pokemon, pokemonMove: PokemonMove): PlannerMoveChoice | undefined {
  const move = pokemonMove.getMove();
  if (!move) {
    return;
  }

  const targetData = getAiMoveTargetData(user, move.id);
  if (targetData.lacksRequiredOpponent) {
    return;
  }

  const { targetSet } = targetData;
  const targets = targetSet.multiple ? targetData.allTargets : targetData.selectableTargets;

  if (targetSet.multiple) {
    const targetIndexes = targets.map(fieldTarget => fieldTarget.getBattlerIndex());
    const scores = targets.map(fieldTarget => scoreMoveAgainstTargetDetailed(user, fieldTarget, move));
    const score = scores.reduce((total, targetScore) => total + targetScore.score, 0);
    return {
      move: pokemonMove,
      targets: targetIndexes,
      score,
      targetCandidates: [
        {
          targets: targetIndexes,
          baseScore: score,
          breakdown: mergePlannerMoveScoreBreakdowns(scores.map(targetScore => targetScore.breakdown)),
        },
      ],
      breakdown: mergePlannerMoveScoreBreakdowns(scores.map(targetScore => targetScore.breakdown)),
    };
  }

  if (targets.length === 0) {
    if (move.hasAttr("CounterDamageAttr")) {
      return {
        move: pokemonMove,
        targets: [BattlerIndex.ATTACKER],
        score: 30,
        targetCandidates: [{ targets: [BattlerIndex.ATTACKER], baseScore: 30 }],
      };
    }

    return;
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

  const chosenTarget = chooseFromBestTargets(targetScores);
  if (!chosenTarget) {
    return;
  }

  return {
    move: pokemonMove,
    targets: [chosenTarget.battlerIndex],
    score: chosenTarget.score,
    breakdown: chosenTarget.breakdown,
    targetCandidates: targetScores.map(targetScore => ({
      targets: [targetScore.battlerIndex],
      baseScore: targetScore.score,
      breakdown: targetScore.breakdown,
    })),
  };
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
  console.groupCollapsed(
    `[Planner AI] ${getPlannerPokemonLabel(user)} evaluated ${choices.length} choices; chose ${chosenLabel}`,
  );
  console.table(
    choices.map(choice => ({
      move: choice.move.getName(),
      target: formatPlannerTargets(choice.targets),
      result: choice.debug?.result ?? "fallback score only",
      base: formatPlannerScore(choice.debug?.baseScore ?? choice.score),
      search: formatPlannerScore(choice.debug?.outcomeScore ?? 0),
      total: formatPlannerScore(choice.score),
      prevented: formatPlannerScore(choice.debug?.preventedThreatScore ?? 0),
      survival: formatPlannerScore(choice.debug?.survivalScore ?? 0),
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
      incoming: formatPlannerScore(summary.currentIncomingDamage),
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
      hpAfter: formatPlannerScore(candidate.debug.hpAfterSwitch),
      hpRatio: formatPlannerScore(candidate.debug.hpAfterSwitchRatio),
      dmgRatio: formatPlannerScore(candidate.debug.switchInDamageRatio),
      pressure: formatPlannerScore(candidate.debug.pressure),
      canKo: candidate.debug.canKo,
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
  return `${getPlannerPokemonLabel(pokemon)} ${Math.max(0, hp)}/${pokemon.getMaxHp()}`;
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

function getPokemonAtBattlerIndex(battlerIndex: BattlerIndex): Pokemon | undefined {
  return globalScene.getField()[battlerIndex];
}

function getPlannerPokemonLabel(pokemon: Pokemon): string {
  return pokemon.name;
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
  const targets = choice.targets
    .map(battlerIndex => field[battlerIndex])
    .filter((target): target is Pokemon => !!target && target.isAllowedInBattle())
    .map(target => {
      const damage = move.category === MoveCategory.STATUS ? 0 : estimateDamage(user, target, move).damage;
      const moveActsBeforeTarget =
        move.priority > getBestMovePriority(target)
        || (move.priority === getBestMovePriority(target)
          && user.getEffectiveStat(Stat.SPD, { opponent: target })
            >= target.getEffectiveStat(Stat.SPD, { opponent: user }));

      return {
        pokemon: target,
        battlerIndex: target.getBattlerIndex(),
        damage,
        hpAfterAction: target.hp - damage,
        actsBeforeUser: !moveActsBeforeTarget,
      };
    });

  return {
    kind: "move",
    choice,
    user,
    move,
    targets,
    priority: move.priority,
  };
}

function evaluatePlannerSearchAction(state: PlannerSearchState, action: PlannerSearchAction): PlannerSearchEvaluation {
  if (action.kind !== "move") {
    return {
      score: 0,
      preventedThreatScore: 0,
      survivalScore: 0,
      spreadFollowupScore: 0,
      wastedTurnPenalty: 0,
    };
  }

  const user = state.user.pokemon;
  const opponentTargets = action.targets.filter(target => user.isOpponent(target.pokemon));
  const preventedThreatScore = getPreventedThreatScore(state, opponentTargets);
  const survivalScore = getSearchSurvivalScore(state, action, opponentTargets);
  const spreadFollowupScore = getSpreadFollowupScore(user, opponentTargets);
  const wastedTurnPenalty = getSearchWastedTurnPenalty(state, action, opponentTargets);

  return {
    score: preventedThreatScore + survivalScore + spreadFollowupScore - wastedTurnPenalty,
    preventedThreatScore,
    survivalScore,
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
  const incomingBefore = estimateIncomingDamage(state.user.pokemon) + residualDamage;
  const incomingAfter = estimateIncomingDamageAfterSearchAction(state, opponentTargets) + residualDamage;
  const preventedIncoming = Math.max(0, incomingBefore - incomingAfter);
  const preventedRatio = preventedIncoming / Math.max(1, state.user.maxHp);
  const projectedUserHp = getProjectedHpAfterDirectHealing(
    state.user.pokemon,
    state.user.pokemon,
    action.move,
    action.targets,
  );
  const projectedHeal = Math.max(0, projectedUserHp - state.user.hp);
  const healPreventsFaint =
    projectedHeal > 0
    && incomingAfter >= state.user.hp
    && incomingAfter < projectedUserHp
    && canHealBeforeLikelyKo(state.user.pokemon, state.user.pokemon, action.move, projectedHeal, incomingAfter);
  const survivalHp =
    projectedHeal > 0
    && canHealBeforeLikelyKo(state.user.pokemon, state.user.pokemon, action.move, projectedHeal, incomingAfter)
      ? projectedUserHp
      : state.user.hp;
  const stillFaints = incomingAfter >= survivalHp;
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

function estimateIncomingDamageAfterSearchAction(
  state: PlannerSearchState,
  opponentTargets: PlannerSearchTarget[],
): number {
  return state.opponents.reduce((highestDamage, opponent) => {
    const target = opponentTargets.find(searchTarget => searchTarget.pokemon === opponent.pokemon);
    const preventedFromActing = target && target.hpAfterAction <= 0 && !target.actsBeforeUser;
    if (preventedFromActing) {
      return highestDamage;
    }

    return Math.max(highestDamage, estimateBestDamage(opponent.pokemon, state.user.pokemon).damage);
  }, 0);
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
    damagedTargets.reduce((total, target) => total + target.hpAfterAction / Math.max(1, target.pokemon.getMaxHp()), 0)
    / damagedTargets.length;

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

  const incomingAfter = estimateIncomingDamageAfterSearchAction(state, opponentTargets);
  const hasSaferDamageOption = state.user.pokemon
    .getMoveset()
    .map(pokemonMove => pokemonMove.getMove())
    .filter(move => !!move && move.category !== MoveCategory.STATUS)
    .some(move =>
      state.opponents.some(opponent => estimateDamage(state.user.pokemon, opponent.pokemon, move).damage > 0),
    );

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

    if (targetIsOpponent && statusScore.total <= 0) {
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
  const damageRatio = target.hp > 0 ? damage.damage / target.hp : 0;
  const maxHpRatio = target.getMaxHp() > 0 ? damage.damage / target.getMaxHp() : 0;
  const isKo = damage.damage >= target.hp;

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
  const healing = getHealingMoveScore(user, target, move, targetIsOpponent);
  const setup = getSetupMoveScore(user, move, canSurviveSetup);
  const sideSupport = getSideSupportMoveScore(user, move, incomingDamage);
  const enemyStatus = getOpponentStatusMoveScore(
    user,
    target,
    move,
    targetIsOpponent,
    incomingDamage,
    targetThreatScore,
  );
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
  return (
    move.priority > opponentPriority
    || (move.priority === opponentPriority
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
  const hasImmediateDisruption = move.hasAttr("StatusEffectAttr") || move.hasAttr("ForceSwitchOutAttr");
  const tempoRisk = isHighTempoStatusRisk(user, target, move, incomingDamage);

  let score = statStageScore;

  if (move.hasAttr("StatusEffectAttr")) {
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
  return target.getAttackDamage({
    source: user,
    move,
    ignoreAbility: !target.waveData.abilityRevealed,
    ignoreSourceAbility: false,
    ignoreAllyAbility: !target.getAllies().some(ally => ally.waveData.abilityRevealed),
    ignoreSourceAllyAbility: false,
    isCritical: move.hasAttr("CritOnlyAttr") || !!user.getTag(BattlerTagType.ALWAYS_CRIT),
    simulated: true,
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
  return user
    .getOpponents()
    .reduce((highestDamage, opponent) => Math.max(highestDamage, estimateBestDamage(opponent, user).damage), 0);
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

function getAverageActiveFieldMaxHp(): number {
  const activePokemon = globalScene.getField(true).filter(pokemon => pokemon.isAllowedInBattle());
  if (activePokemon.length === 0) {
    return 1;
  }

  return activePokemon.reduce((total, pokemon) => total + pokemon.getMaxHp(), 0) / activePokemon.length;
}

function getBestOffensivePressure(user: Pokemon): PlannerOffensivePressure {
  return user.getOpponents().reduce<PlannerOffensivePressure>(
    (best, opponent) => {
      const damage = estimateBestDamage(user, opponent).damage;
      const maxDamageRatio = opponent.hp > 0 ? damage / opponent.hp : 0;
      return {
        maxDamageRatio: Math.max(best.maxDamageRatio, maxDamageRatio),
        canKo: best.canKo || damage >= opponent.hp,
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
  const defenders = target.getOpponents();
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
    .some(pokemon => estimateBestDamageByCategory(pokemon, target, category) >= target.getMaxHp() * 0.18);
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
    return {
      incomingRatio: defender.getMaxHp() > 0 ? incomingDamage / defender.getMaxHp() : 0,
      answerRatio: target.getMaxHp() > 0 ? answerDamage / target.getMaxHp() : 0,
      canBeKoed: incomingDamage >= defender.hp,
      canAnswerKo: answerDamage >= target.hp,
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
  const opponents = pokemon.getOpponents();
  if (opponents.length === 0) {
    return 0;
  }

  return (
    opponents.map(opponent => pokemon.getMatchupScore(opponent)).reduce((total, score) => total + score, 0)
    / opponents.length
  );
}

function chooseFromBestPlannerChoices(choices: PlannerMoveChoice[]): PlannerMoveChoice | undefined {
  if (choices.length === 0) {
    return;
  }

  const topScore = choices[0].score;
  const closeChoices = choices.filter(choice => choice.score >= topScore - 8);
  return closeChoices[globalScene.randBattleSeedInt(closeChoices.length)];
}

function chooseFromBestTargets(targetScores: PlannerTargetScore[]): PlannerTargetScore | undefined {
  if (targetScores.length === 0) {
    return;
  }

  const topScore = targetScores[0].score;
  const closeTargets = targetScores.filter(target => target.score >= topScore - 6);
  return closeTargets[globalScene.randBattleSeedInt(closeTargets.length)];
}

installPlannerDebugConsoleHelper();
