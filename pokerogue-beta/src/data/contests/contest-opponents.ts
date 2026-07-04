import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { TrainerType } from "#enums/trainer-type";
import { ContestCoordinatorType } from "./contest-coordinator-types";
import { ContestType } from "./contest-type";

export enum ContestRank {
  NORMAL = "normal",
  SUPER = "super",
  ULTRA = "ultra",
  HYPER = "hyper",
  MASTER = "master",
}

export enum ContestOpponentGameVersion {
  RUBY_SAPPHIRE = "ruby_sapphire",
  EMERALD = "emerald",
}

export type ContestPrimaryJudgingScores = Record<ContestType, number>;

export interface ContestOpponentEntry {
  id: string;
  coordinatorName: string;
  coordinatorType: ContestCoordinatorType;
  pokemonSpecies: SpeciesId;
  pokemonNickname?: string;
  rank: ContestRank;
  moves: readonly [MoveId, MoveId, MoveId, MoveId];
  primaryJudgingScores: ContestPrimaryJudgingScores;
  postGameOnly?: boolean;
  gameVersions?: readonly ContestOpponentGameVersion[];
  trainerType?: TrainerType;
  spriteKey?: string;
}

export interface ContestOpponentFilterOptions {
  rank?: ContestRank;
  contestType?: ContestType;
  includePostGame?: boolean;
  gameVersion?: ContestOpponentGameVersion;
}
// most trainers taken from the bulbapedia entry for list of contest opponents generation III
export const contestOpponents: readonly ContestOpponentEntry[] = [
  {
    id: "normal_lila_zigzagoon",
    coordinatorName: "Lila",
    coordinatorType: ContestCoordinatorType.LASS,
    pokemonSpecies: SpeciesId.ZIGZAGOON,
    pokemonNickname: "Ziggy",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.TACKLE,
      MoveId.TAIL_WHIP,
      MoveId.GROWL,
      MoveId.QUICK_ATTACK,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]: 10,
      [ContestType.BEAUTY]: 0,
      [ContestType.CUTE]: 20,
      [ContestType.SMART]: 5,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_agatha_bulbasaur",
    coordinatorName: "Agatha",
    coordinatorType: ContestCoordinatorType.AROMA_LADY,
    pokemonSpecies: SpeciesId.BULBASAUR,
    pokemonNickname: "Bulby",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.GROWL,
      MoveId.LEECH_SEED,
      MoveId.TACKLE,
      MoveId.SWEET_SCENT,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]: 0,
      [ContestType.BEAUTY]: 0,
      [ContestType.CUTE]: 40,
      [ContestType.SMART]: 40,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_alec_slakoth",
    coordinatorName: "Alec",
    coordinatorType: ContestCoordinatorType.CAMPER,
    pokemonSpecies: SpeciesId.SLAKOTH,
    pokemonNickname: "Slokth",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.STRENGTH,
      MoveId.COUNTER,
      MoveId.YAWN,
      MoveId.ENCORE,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]: 0,
      [ContestType.BEAUTY]: 40,
      [ContestType.CUTE]: 40,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
    {
    id: "normal_beau_butterfree",
    coordinatorName: "Beau",
    coordinatorType: ContestCoordinatorType.HEX_MANIAC,
    pokemonSpecies: SpeciesId.BUTTERFREE,
    pokemonNickname: "Futterbe",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.SUPERSONIC,
      MoveId.WHIRLWIND,
      MoveId.SILVER_WIND,
      MoveId.SAFEGUARD,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:40,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 40,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_caitlin_polywag",
    coordinatorName: "Caitlin",
    coordinatorType: ContestCoordinatorType.TUBER,
    pokemonSpecies: SpeciesId.BUTTERFREE,
    pokemonNickname: "Wagil",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.HYDRO_PUMP,
      MoveId.RAIN_DANCE,
      MoveId.BODY_SLAM,
      MoveId.ICE_BEAM,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:50,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 50,
    },
    postGameOnly: false,
  },
    {
    id: "normal_chance_diglett",
    coordinatorName: "Chance",
    coordinatorType: ContestCoordinatorType.RICH_BOY,
    pokemonSpecies: SpeciesId.DIGLETT,
    pokemonNickname: "Digle",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.DIG,
      MoveId.EARTHQUAKE,
      MoveId.FISSURE,
      MoveId.MAGNITUDE,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:0,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 50,
      [ContestType.TOUGH]: 50,
    },
    postGameOnly: false,
  },
    {
    id: "normal_chance_electrike",
    coordinatorName: "Chance",
    coordinatorType: ContestCoordinatorType.RICH_BOY,
    pokemonSpecies: SpeciesId.ELECTRIKE,
    pokemonNickname: "Rikelec",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.SPARK,
      MoveId.THUNDER_WAVE,
      MoveId.THUNDER,
      MoveId.ROAR,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  50,
      [ContestType.BEAUTY]:50,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
      {
    id: "normal_chance_manectric",
    coordinatorName: "Chance",
    coordinatorType: ContestCoordinatorType.RICH_BOY,
    pokemonSpecies: SpeciesId.MANECTRIC,
    pokemonNickname: "Rikelec",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.SPARK,
      MoveId.THUNDER_WAVE,
      MoveId.THUNDER,
      MoveId.ROAR,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  50,
      [ContestType.BEAUTY]:50,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
      {
    id: "normal_colby_electrike",
    coordinatorName: "Colby",
    coordinatorType: ContestCoordinatorType.NINJA_BOY,
    pokemonSpecies: SpeciesId.ELECTRIKE,
    pokemonNickname: "Rikelec",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.RAGE,
      MoveId.SCREECH,
      MoveId.SURF,
      MoveId.BLIZZARD,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  60,
      [ContestType.BEAUTY]:60,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_edith_zigzagoon",
    coordinatorName: "Edith",
    coordinatorType: ContestCoordinatorType.YELLOW_DRESS_GIRL,
    pokemonSpecies: SpeciesId.ZIGZAGOON,
    pokemonNickname: "Zigoon",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.REST,
      MoveId.TAIL_WHIP,
      MoveId.TACKLE,
      MoveId.COVET,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:0,
      [ContestType.CUTE]:  40,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_edith_illumise",
    coordinatorName: "Edith",
    coordinatorType: ContestCoordinatorType.YELLOW_DRESS_GIRL,
    pokemonSpecies: SpeciesId.ILLUMISE,
    pokemonNickname: "Musille",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.REST,
      MoveId.FACADE,
      MoveId.TACKLE,
      MoveId.COVET,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:0,
      [ContestType.CUTE]:  40,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_grant_shroomish",
    coordinatorName: "Grant",
    coordinatorType: ContestCoordinatorType.YOUNGSTER,
    pokemonSpecies: SpeciesId.SHROOMISH,
    pokemonNickname: "Smish",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.STUN_SPORE,
      MoveId.LEECH_SEED,
      MoveId.MEGA_DRAIN,
      MoveId.ATTRACT,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:0,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 30,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_jimmy_poochyena",
    coordinatorName: "Jimmy",
    coordinatorType: ContestCoordinatorType.GREEN_SHOES_BOY,
    pokemonSpecies: SpeciesId.POOCHYENA,
    pokemonNickname: "Poochy",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.ROAR,
      MoveId.BITE,
      MoveId.TAKE_DOWN,
      MoveId.HOWL,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  30,
      [ContestType.BEAUTY]:0,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_kay_pidgeotto",
    coordinatorName: "Kay",
    coordinatorType: ContestCoordinatorType.COOL_TRAINER_F,
    pokemonSpecies: SpeciesId.PIDGEOTTO,
    pokemonNickname: "Pideot",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.MIRROR_MOVE,
      MoveId.QUICK_ATTACK,
      MoveId.AERIAL_ACE,
      MoveId.FEATHER_DANCE,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  40,
      [ContestType.BEAUTY]:40,
      [ContestType.CUTE]:  0,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  {
    id: "normal_kelsey_seedot",
    coordinatorName: "Kelsey",
    coordinatorType: ContestCoordinatorType.FLOWERS_GIRL,
    pokemonSpecies: SpeciesId.SEEDOT,
    pokemonNickname: "Dots",
    rank: ContestRank.NORMAL,
    moves: [
      MoveId.BIDE,
      MoveId.SYNTHESIS,
      MoveId.BULLET_SEED,
      MoveId.GROWTH,
    ],
    primaryJudgingScores: {
      [ContestType.COOL]:  0,
      [ContestType.BEAUTY]:0,
      [ContestType.CUTE]:  40,
      [ContestType.SMART]: 0,
      [ContestType.TOUGH]: 0,
    },
    postGameOnly: false,
  },
  
];

export function getContestOpponents(options: ContestOpponentFilterOptions = {}): ContestOpponentEntry[] {
  const includePostGame = options.includePostGame ?? false;

  return contestOpponents.filter(opponent => {
    if (options.rank !== undefined && opponent.rank !== options.rank) {
      return false;
    }

    if (!includePostGame && opponent.postGameOnly) {
      return false;
    }

    if (
      options.gameVersion !== undefined
      && opponent.gameVersions
      && !opponent.gameVersions.includes(options.gameVersion)
    ) {
      return false;
    }

    return options.contestType === undefined || opponent.primaryJudgingScores[options.contestType] > 0;
  });
}

export function getBestContestOpponentType(opponent: ContestOpponentEntry): ContestType {
  let bestContestType: ContestType | undefined;
  let bestScore = Number.NEGATIVE_INFINITY;
  const primaryJudgingScores = Object.entries(opponent.primaryJudgingScores) as [ContestType, number][];

  for (const [contestType, score] of primaryJudgingScores) {
    if (score > bestScore) {
      bestContestType = contestType;
      bestScore = score;
    }
  }

  if (bestContestType === undefined) {
    throw new Error(`Contest opponent ${opponent.id} has no primary judging scores.`);
  }

  return bestContestType;
}
