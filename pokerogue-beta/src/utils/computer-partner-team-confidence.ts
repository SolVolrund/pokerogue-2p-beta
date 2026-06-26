import type { PlayerPokemon } from "#field/pokemon";

export type ComputerPartnerDangerLevel = "low" | "medium" | "high";
export type ComputerPartnerTeamConfidenceLevel = "none" | "low" | "medium" | "high";

export interface ComputerPartnerTeamConfidence {
  score: number;
  level: ComputerPartnerTeamConfidenceLevel;
  availablePokemon: number;
}

const MAX_PARTY_SLOTS = 6;

function getPokemonHealthScore(pokemon: PlayerPokemon | undefined): number {
  if (!pokemon || !pokemon.isAllowedInBattle()) {
    return 0;
  }

  const maxHp = pokemon.getMaxHp();
  if (maxHp <= 0) {
    return 0;
  }

  const hpRatio = pokemon.hp / maxHp;
  if (hpRatio <= 0.25) {
    return 0.2;
  }
  if (hpRatio <= 0.5) {
    return 0.5;
  }
  if (hpRatio <= 0.75) {
    return 0.75;
  }
  return 1;
}

function getConfidenceLevel(score: number): ComputerPartnerTeamConfidenceLevel {
  if (score >= 4) {
    return "high";
  }
  if (score >= 2.75) {
    return "medium";
  }
  if (score >= 1.5) {
    return "low";
  }
  return "none";
}

export function getComputerPartnerTeamConfidence(party: PlayerPokemon[]): ComputerPartnerTeamConfidence {
  let score = 0;
  let availablePokemon = 0;

  for (let i = 0; i < MAX_PARTY_SLOTS; i++) {
    const pokemon = party[i];
    const pokemonScore = getPokemonHealthScore(pokemon);
    score += pokemonScore;
    if (pokemonScore > 0) {
      availablePokemon++;
    }
  }

  return {
    score,
    level: getConfidenceLevel(score),
    availablePokemon,
  };
}

export function isComputerPartnerConfidentForDanger(
  confidence: ComputerPartnerTeamConfidence | ComputerPartnerTeamConfidenceLevel,
  dangerLevel: ComputerPartnerDangerLevel,
): boolean {
  const confidenceLevel = typeof confidence === "string" ? confidence : confidence.level;
  const confidenceRank: Record<ComputerPartnerTeamConfidenceLevel, number> = {
    none: 0,
    low: 1,
    medium: 2,
    high: 3,
  };
  const dangerRank: Record<ComputerPartnerDangerLevel, number> = {
    low: 1,
    medium: 2,
    high: 3,
  };

  return confidenceRank[confidenceLevel] >= dangerRank[dangerLevel];
}
