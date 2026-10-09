import type { PokemonData } from "#system/pokemon-data";

export interface GreatHauntState {
  stage: "ghost" | "clones" | "marowak";
  ghostId?: number;
  level?: number;
  marowakId?: number;
  /** Optional for saves made before the clone wave had an explicit initialization flag. */
  clonesSpawned?: boolean;
  fallen: PokemonData[];
  forcedFaintIds: number[];
}

export const GREAT_HAUNT_SPRITE = "great_haunt";
