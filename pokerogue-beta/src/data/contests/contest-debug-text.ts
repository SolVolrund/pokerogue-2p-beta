import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { ContestMoveResolution } from "./contest-rules";
import { type ContestParticipant, type ContestState, compareContestantTieBreakers } from "./contest-state";
import { contestTypeData } from "./contest-type";

export function getContestantDisplayName(contestant: ContestParticipant): string {
  const pokemonName =
    contestant.pokemon?.getNameToRender()
    ?? contestant.pokemonNickname
    ?? formatEnumName(contestant.pokemonSpecies === undefined ? undefined : SpeciesId[contestant.pokemonSpecies])
    ?? "Pokemon";

  if (contestant.pokemon) {
    return pokemonName;
  }

  return `${contestant.name}'s ${pokemonName}`;
}

export function getContestMoveName(moveId: MoveId): string {
  return allMoves[moveId]?.name ?? formatEnumName(MoveId[moveId]) ?? "Unknown Move";
}

export function formatContestStartMessage(contestState: ContestState): string {
  const contestType = contestTypeData[contestState.contestType].name;
  const rank = contestState.rank ? `${formatEnumName(contestState.rank)} Rank` : "Contest";
  const contestants = contestState.contestants.map(getContestantDisplayName).join(", ");

  return `${rank} ${contestType} Contest!\nContestants: ${contestants}`;
}

export function formatContestIntroScoreMessage(contestState: ContestState): string {
  const lines = contestState.getOrderedContestants().map((contestant, index) => {
    const primaryScore = contestState.getPrimaryJudgingScore(contestant.id);
    return `${index + 1}. ${getContestantDisplayName(contestant)} (${primaryScore})`;
  });

  return `Primary judging is complete.\nAppeal order:\n${lines.join("\n")}`;
}

export function formatContestAppealMessage(contestState: ContestState, resolution: ContestMoveResolution): string {
  const contestant = contestState.getContestant(resolution.contestantId);
  const contestantName = getContestantDisplayName(contestant);
  const moveName = getContestMoveName(resolution.moveId);

  if (resolution.skipped) {
    return `${contestantName} could not appeal with ${moveName}.\n${resolution.messages.join("\n")}`;
  }

  const lines = [`${contestantName} used ${moveName}!`, `Appeal: +${resolution.appeal}`];

  if (resolution.repeatPenalty > 0) {
    lines.push(`Repeat penalty: -${resolution.repeatPenalty}`);
  }

  if (resolution.comboBonus > 0) {
    lines.push(`Combo bonus: +${resolution.comboBonus}`);
  }

  if (resolution.applauseDelta > 0) {
    lines.push(`Audience excitement: ${contestState.applause}/${contestState.maxApplause}`);
  }

  if (resolution.applauseBonus > 0) {
    lines.push(`Audience bonus: +${resolution.applauseBonus}`);
  }

  for (const jamResult of resolution.jamResults) {
    const target = contestState.getContestant(jamResult.contestantId);
    lines.push(`${getContestantDisplayName(target)} was jammed for ${jamResult.appliedJam}.`);
  }

  lines.push(...resolution.messages);
  lines.push(`Round score: ${contestant.roundScore} | Total: ${contestant.totalScore}`);

  return lines.join("\n");
}

export function formatContestRoundSummaryMessage(contestState: ContestState): string {
  const lines = contestState.contestants
    .slice()
    .sort((a, b) => b.roundScore - a.roundScore || compareContestantTieBreakers(a, b, `summary-${contestState.round}`))
    .map(
      (contestant, index) =>
        `${index + 1}. ${getContestantDisplayName(contestant)}: ${contestant.roundScore} this round (${contestant.totalScore} total)`,
    );

  return `Round ${contestState.round} results:\n${lines.join("\n")}`;
}

export function formatContestFinalMessage(contestState: ContestState): string {
  const lines = contestState.contestants
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore || compareContestantTieBreakers(a, b, "final-summary"))
    .map((contestant, index) => `${index + 1}. ${getContestantDisplayName(contestant)}: ${contestant.totalScore}`);

  return `Contest results:\n${lines.join("\n")}`;
}

function formatEnumName(value?: string): string | undefined {
  if (!value) {
    return;
  }

  return value
    .toLowerCase()
    .split(/[_-]/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
