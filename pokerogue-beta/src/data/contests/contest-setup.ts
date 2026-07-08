import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import type { PlayerPokemon } from "#field/pokemon";
import { randSeedShuffle } from "#utils/common";
import { chooseContestStageBgm } from "./contest-audio";
import { type ContestOpponentEntry, ContestRank, getContestOpponents } from "./contest-opponents";
import { ContestState, createContestParticipant } from "./contest-state";
import { ContestType } from "./contest-type";

const CONTEST_NPC_COUNT = 3;
const CONTEST_TOTAL_CONTESTANTS = 4;

export interface ContestPlayerContestantOptions {
  playerIndex?: PlayerIndex;
  playerName?: string;
  pokemon?: PlayerPokemon;
  spriteKey?: string;
}

export interface CreateContestStateOptions {
  contestType?: ContestType;
  rank?: ContestRank;
  playerContestants?: readonly ContestPlayerContestantOptions[];
  playerPokemon?: PlayerPokemon;
}

export function createContestStateForRank(options: CreateContestStateOptions = {}): ContestState {
  const contestType = options.contestType ?? ContestType.COOL;
  const rank = options.rank ?? ContestRank.NORMAL;
  const playerContestants = normalizePlayerContestants(options);
  const opponents = selectContestOpponents(rank, contestType, CONTEST_TOTAL_CONTESTANTS - playerContestants.length);

  return new ContestState({
    contestType,
    rank,
    bgmKey: chooseContestStageBgm(),
    contestants: [
      ...playerContestants.map((contestant, index) =>
        createContestParticipant(
          contestant.playerIndex === undefined ? "player" : `player_${contestant.playerIndex + 1}`,
          contestant.playerName ?? getDefaultPlayerContestantName(contestant.playerIndex, index),
          contestant.pokemon,
          {
            ...(contestant.pokemon
              ? { primaryJudgingScores: globalScene.gameData.getPokemonContestIntroJudgingScores(contestant.pokemon) }
              : {}),
            ...(contestant.spriteKey ? { spriteKey: contestant.spriteKey } : {}),
          },
        ),
      ),
      ...opponents.map((opponent, index) =>
        createContestParticipant(
          `contestant_${playerContestants.length + index + 1}`,
          opponent.coordinatorName,
          undefined,
          {
            coordinatorName: opponent.coordinatorName,
            coordinatorType: opponent.coordinatorType,
            pokemonSpecies: opponent.pokemonSpecies,
            ...(opponent.pokemonNickname ? { pokemonNickname: opponent.pokemonNickname } : {}),
            rank: opponent.rank,
            contestMoves: opponent.moves,
            primaryJudgingScores: opponent.primaryJudgingScores,
            ...(opponent.trainerType === undefined ? {} : { trainerType: opponent.trainerType }),
            ...(opponent.spriteKey ? { spriteKey: opponent.spriteKey } : {}),
          },
        ),
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

function normalizePlayerContestants(options: CreateContestStateOptions): ContestPlayerContestantOptions[] {
  if (options.playerContestants && options.playerContestants.length > 0) {
    return options.playerContestants.slice(0, CONTEST_TOTAL_CONTESTANTS).map(contestant => ({ ...contestant }));
  }

  return [
    {
      playerIndex: 0,
      playerName: "Player",
      ...(options.playerPokemon ? { pokemon: options.playerPokemon } : {}),
    },
  ];
}

function getDefaultPlayerContestantName(playerIndex: PlayerIndex | undefined, contestantIndex: number): string {
  return playerIndex === undefined ? `Player ${contestantIndex + 1}` : `Player ${playerIndex + 1}`;
}

function selectContestOpponents(
  rank: ContestRank,
  contestType: ContestType,
  count = CONTEST_NPC_COUNT,
): ContestOpponentEntry[] {
  if (count <= 0) {
    return [];
  }

  const preferredOpponents = getContestOpponents({ rank, contestType });
  const fallbackOpponents = getContestOpponents({ rank });
  const selected = selectUniqueCoordinators(preferredOpponents, count);

  if (selected.length >= count) {
    return selected;
  }

  const selectedIds = new Set(selected.map(opponent => opponent.id));
  const fallbackPool = fallbackOpponents.filter(opponent => !selectedIds.has(opponent.id));

  return [...selected, ...selectUniqueCoordinators(fallbackPool, count - selected.length)];
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
