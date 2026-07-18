import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";

export const ALPH_LEGENDARY_HELPER_IDS = ["papa", "mama", "uncle"] as const;
export type AlphLegendaryHelperId = (typeof ALPH_LEGENDARY_HELPER_IDS)[number];

export interface AlphLegendaryHelperConfig {
  readonly nickname: string;
  readonly species: SpeciesId;
  readonly moves: readonly MoveId[];
  readonly typeBoosters: readonly PokemonType[];
}

export const ALPH_LEGENDARY_HELPER_CONFIGS: Record<AlphLegendaryHelperId, AlphLegendaryHelperConfig> = {
  papa: {
    nickname: "Papa",
    species: SpeciesId.ENTEI,
    moves: [MoveId.EXTREME_SPEED, MoveId.SACRED_FIRE, MoveId.STONE_EDGE, MoveId.CRUNCH],
    typeBoosters: [PokemonType.FIRE, PokemonType.ROCK, PokemonType.NORMAL, PokemonType.DARK],
  },
  mama: {
    nickname: "Mama",
    species: SpeciesId.SUICUNE,
    moves: [MoveId.CALM_MIND, MoveId.SCALD, MoveId.ICE_BEAM, MoveId.SHADOW_BALL],
    typeBoosters: [PokemonType.WATER, PokemonType.ICE, PokemonType.GHOST],
  },
  uncle: {
    nickname: "Uncle",
    species: SpeciesId.RAIKOU,
    moves: [MoveId.THUNDERBOLT, MoveId.SCALD, MoveId.SHADOW_BALL, MoveId.AURA_SPHERE],
    typeBoosters: [PokemonType.ELECTRIC, PokemonType.WATER, PokemonType.GHOST, PokemonType.FIGHTING],
  },
};
