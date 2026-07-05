import type { PlayerPokemon } from "#field/pokemon";
import { randSeedShuffle } from "#utils/common";
import {
  type ContestOpponentEntry,
  ContestRank,
  getContestOpponents,
} from "./contest-opponents";
import { chooseContestStageBgm } from "./contest-audio";
import { ContestState, createContestParticipant } from "./contest-state";
import { ContestType } from "./contest-type";

const CONTEST_NPC_COUNT = 3;

export interface CreateContestStateOptions {
  contestType?: ContestType;
  rank?: ContestRank;
  playerPokemon?: PlayerPokemon;
}

export function createContestStateForRank(options: CreateContestStateOptions = {}): ContestState {
  const contestType = options.contestType ?? ContestType.COOL;
  const rank = options.rank ?? ContestRank.NORMAL;
  const opponents = selectContestOpponents(rank, contestType);

  return new ContestState({
    contestType,
    rank,
    bgmKey: chooseContestStageBgm(),
    contestants: [
      createContestParticipant("player", "Player", options.playerPokemon),
      ...opponents.map((opponent, index) =>
        createContestParticipant(`contestant_${index + 2}`, opponent.coordinatorName, undefined, {
          coordinatorName: opponent.coordinatorName,
          coordinatorType: opponent.coordinatorType,
          pokemonSpecies: opponent.pokemonSpecies,
          ...(opponent.pokemonNickname ? { pokemonNickname: opponent.pokemonNickname } : {}),
          rank: opponent.rank,
          contestMoves: opponent.moves,
          primaryJudgingScores: opponent.primaryJudgingScores,
          ...(opponent.trainerType !== undefined ? { trainerType: opponent.trainerType } : {}),
          ...(opponent.spriteKey ? { spriteKey: opponent.spriteKey } : {}),
        }),
      ),
    ],
  });
}

export function createNormalRankContestState(playerPokemon?: PlayerPokemon): ContestState {
  return createContestStateForRank({
    rank: ContestRank.NORMAL,
    contestType: ContestType.COOL,
    ...(playerPokemon ? { playerPokemon } : {}),
  });
}

function selectContestOpponents(rank: ContestRank, contestType: ContestType): ContestOpponentEntry[] {
  const preferredOpponents = getContestOpponents({ rank, contestType });
  const fallbackOpponents = getContestOpponents({ rank });
  const selected = selectUniqueCoordinators(preferredOpponents, CONTEST_NPC_COUNT);

  if (selected.length >= CONTEST_NPC_COUNT) {
    return selected;
  }

  const selectedIds = new Set(selected.map(opponent => opponent.id));
  const fallbackPool = fallbackOpponents.filter(opponent => !selectedIds.has(opponent.id));

  return [
    ...selected,
    ...selectUniqueCoordinators(fallbackPool, CONTEST_NPC_COUNT - selected.length),
  ];
}

function selectUniqueCoordinators(opponents: readonly ContestOpponentEntry[], count: number): ContestOpponentEntry[] {
  const selected: ContestOpponentEntry[] = [];
  const usedCoordinatorNames = new Set<string>();

  for (const opponent of randSeedShuffle([...opponents])) {
    if (usedCoordinatorNames.has(opponent.coordinatorName)) {
      continue;
    }

    selected.push(opponent);
    usedCoordinatorNames.add(opponent.coordinatorName);

    if (selected.length >= count) {
      return selected;
    }
  }

  for (const opponent of randSeedShuffle([...opponents])) {
    if (selected.includes(opponent)) {
      continue;
    }

    selected.push(opponent);
    if (selected.length >= count) {
      return selected;
    }
  }

  return selected;
}
