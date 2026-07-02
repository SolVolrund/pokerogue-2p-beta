import { allMoves } from "#data/data-lists";
import { MoveId } from "#enums/move-id";
import { Stat } from "#enums/stat";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Move } from "#moves/move";

export interface DawnStrategyMoveCapabilities {
  entryHazard: boolean;
  offensiveSetup: boolean;
  defensiveSetup: boolean;
}

const ENTRY_HAZARD_MOVES = new Set<MoveId>([
  MoveId.SPIKES,
  MoveId.TOXIC_SPIKES,
  MoveId.STEALTH_ROCK,
  MoveId.STICKY_WEB,
  MoveId.STONE_AXE,
  MoveId.CEASELESS_EDGE,
]);

const OFFENSIVE_SETUP_STATS = new Set<Stat>([Stat.ATK, Stat.SPATK]);
const DEFENSIVE_SETUP_STATS = new Set<Stat>([Stat.DEF, Stat.SPDEF]);

export function getDawnStrategyMoveCapabilities(move: Move): DawnStrategyMoveCapabilities {
  let offensiveSetup = false;
  let defensiveSetup = false;

  for (const attr of move.getAttrs("StatStageChangeAttr")) {
    if (!attr.selfTarget || attr.stages <= 0) {
      continue;
    }

    offensiveSetup ||= attr.stats.some(stat => OFFENSIVE_SETUP_STATS.has(stat));
    defensiveSetup ||= attr.stats.some(stat => DEFENSIVE_SETUP_STATS.has(stat));
  }

  return {
    entryHazard: isDawnEntryHazardMove(move),
    offensiveSetup,
    defensiveSetup,
  };
}

export function isDawnEntryHazardMove(move: Move): boolean {
  return ENTRY_HAZARD_MOVES.has(move.id);
}

export function getSpeciesEntryHazardAccessScore(species: PokemonSpecies): number {
  const learnableMoveIds = new Set<MoveId>([
    ...species.getLevelMoves().map(([, moveId]) => moveId),
    ...species.getTms(),
  ]);
  let score = 0;

  for (const moveId of learnableMoveIds) {
    const move = allMoves[moveId];
    if (!move || !isDawnEntryHazardMove(move)) {
      continue;
    }

    score = Math.max(score, move.power > 0 ? 16 : 20);
  }

  return score;
}
