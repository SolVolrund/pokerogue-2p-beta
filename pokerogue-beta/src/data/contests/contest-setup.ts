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
const CONTEST_SETUP_SEED_OFFSET = 86413;
const CONTEST_RANK_SEED_OFFSETS: Record<ContestRank, number> = {
  [ContestRank.NORMAL]: 1,
  [ContestRank.SUPER]: 2,
  [ContestRank.HYPER]: 3,
  [ContestRank.MASTER]: 4,
  [ContestRank.GRAND]: 5,
};
const CONTEST_TYPE_SEED_OFFSETS: Record<ContestType, number> = {
  [ContestType.COOL]: 1,
  [ContestType.BEAUTY]: 2,
  [ContestType.CUTE]: 3,
  [ContestType.SMART]: 4,
  [ContestType.TOUGH]: 5,
};

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
  let bgmKey = "";
  let opponents: ContestOpponentEntry[] = [];

  globalScene.executeWithSeedOffset(() => {
    bgmKey = chooseContestStageBgm();
    opponents = selectContestOpponents(rank, contestType, CONTEST_TOTAL_CONTESTANTS - playerContestants.length);
  }, getContestSetupSeedOffset(contestType, rank, playerContestants.length));

  return new ContestState({
    contestType,
    rank,
    bgmKey,
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

function getContestSetupSeedOffset(contestType: ContestType, rank: ContestRank, playerContestantCount: number): number {
  return (
    CONTEST_SETUP_SEED_OFFSET
    + (globalScene.currentBattle?.waveIndex ?? 0) * 131
    + CONTEST_RANK_SEED_OFFSETS[rank] * 17
    + CONTEST_TYPE_SEED_OFFSETS[contestType] * 31
    + playerContestantCount * 7
  );
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
