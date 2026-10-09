import { globalScene } from "#app/global-scene";
import { towerWildPools, TOWER_TRAINER_CHANCE, type TowerPokemonEntry } from "#data/pokemon-tower-encounters";
import { BiomePoolTier } from "#enums/biome-pool-tier";
import type { PartyMemberStrength } from "#enums/party-member-strength";
import type { SpeciesId } from "#enums/species-id";
import type { EnemyPokemon } from "#field/pokemon";
import { getPartyLuckValue } from "#modifiers/modifier-type";
import { randSeedInt, randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export function rollTowerTrainerEncounter(): boolean {
  return randSeedInt(TOWER_TRAINER_CHANCE) === 0;
}

export function resolveTowerSpecies(
  entry: TowerPokemonEntry,
  level: number,
  strength?: PartyMemberStrength,
): SpeciesId {
  if (entry.fixed) {
    return entry.species;
  }
  const species = getPokemonSpecies(entry.species);
  return strength === undefined
    ? species.getWildSpeciesForLevel(level, true, false, globalScene.gameMode)
    : species.getTrainerSpeciesForLevel(level, true, strength);
}

export function applyTowerPokemonIdentity(pokemon: EnemyPokemon, entry: TowerPokemonEntry): void {
  if (entry.nickname) {
    pokemon.nickname = btoa(String.fromCharCode(...new TextEncoder().encode(entry.nickname)));
  }
  // Explicit Unown letters and default forms, rather than biome-random alternate forms.
  pokemon.formIndex = entry.formIndex ?? 0;
}

export function rollTowerWildEntry(): TowerPokemonEntry {
  let tier = globalScene.arena.generateNonBossBiomeTier(
    randSeedInt(512 - getPartyLuckValue(globalScene.getPlayerParty()) * 2),
  );
  while (!towerWildPools[tier]?.length && tier > BiomePoolTier.COMMON) {
    tier--;
  }
  return randSeedItem(towerWildPools[tier]!);
}
