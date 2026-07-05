import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { EntryHazardTag } from "#data/arena-tag";
import { allMoves } from "#data/data-lists";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { MoveId } from "#enums/move-id";
import type { PlayerPokemon } from "#field/pokemon";
import { isDawnEntryHazardMove } from "#utils/computer-partner-hazard-support";
import { getComputerPartnerProfile, isComputerPartnerAcePokemon } from "#utils/computer-partner-profile";

export function isComputerPartnerFieldIndex(fieldIndex: number): boolean {
  return globalScene.isComputerPartnerPlayer(globalScene.getPlayerIndexForFieldSlot(fieldIndex));
}

export function getComputerPartnerPartyMemberMatchupScores(playerIndex: PlayerIndex): [number, number][] {
  const party = globalScene.getPlayerParty(playerIndex);
  const enemyField = globalScene.getEnemyField().filter(p => p.isAllowedInBattle());

  return party
    .map((pokemon, partyIndex) => [pokemon, partyIndex] as const)
    .filter(([pokemon, partyIndex]) => partyIndex > 0 && pokemon.isAllowedInBattle() && !pokemon.isOnField())
    .map(([pokemon, partyIndex]) => {
      let score = 0;

      if (enemyField.length > 0) {
        for (const enemyPokemon of enemyField) {
          score += pokemon.getMatchupScore(enemyPokemon);
          if (enemyPokemon.species.legendary) {
            score /= 2;
          }
        }
        score /= enemyField.length;
        globalScene.arena
          .findTagsOnSide(t => t instanceof EntryHazardTag, ArenaTagSide.PLAYER)
          .forEach(t => (score *= (t as EntryHazardTag).getMatchupScoreMultiplier(pokemon)));
      }

      return [partyIndex, score] as [number, number];
    });
}

export function getSortedComputerPartnerPartyMemberMatchupScores(
  partyMemberScores: [number, number][],
): [number, number][] {
  return partyMemberScores.slice(0).sort((a, b) => {
    const scoreA = a[1];
    const scoreB = b[1];
    return scoreA < scoreB ? 1 : scoreA > scoreB ? -1 : 0;
  });
}

export function getComputerPartnerNextSummonIndex(partyMemberScores: [number, number][]): number | undefined {
  if (partyMemberScores.length === 0) {
    return undefined;
  }

  const sortedPartyMemberScores = getSortedComputerPartnerPartyMemberMatchupScores(partyMemberScores);
  const maxScorePartyMemberIndexes = partyMemberScores
    .filter(partyMemberScore => partyMemberScore[1] === sortedPartyMemberScores[0][1])
    .map(partyMemberScore => partyMemberScore[0]);

  if (maxScorePartyMemberIndexes.length > 1) {
    return maxScorePartyMemberIndexes[globalScene.randBattleSeedInt(maxScorePartyMemberIndexes.length)];
  }

  return maxScorePartyMemberIndexes[0];
}

export function getComputerPartnerBestSwitchIndex(playerIndex: PlayerIndex): number | undefined {
  const partyMemberScores = getComputerPartnerPartyMemberMatchupScores(playerIndex);
  return getDawnEntryHazardSwitchIndex(playerIndex, partyMemberScores)
    ?? getComputerPartnerNextSummonIndex(partyMemberScores);
}

export function getComputerPartnerImprovedSwitchIndex(
  fieldIndex: number,
  switchMultiplier = 1,
  scoreMultiplier = 3,
): number | undefined {
  const playerIndex = globalScene.getPlayerIndexForFieldSlot(fieldIndex);
  const playerPokemon = globalScene.getPlayerPokemonForFieldSlot(fieldIndex);
  if (!playerPokemon) {
    return undefined;
  }

  const partyMemberScores = getComputerPartnerPartyMemberMatchupScores(playerIndex);
  if (partyMemberScores.length === 0) {
    return undefined;
  }

  const dawnHazardSwitchIndex = getDawnEntryHazardSwitchIndex(playerIndex, partyMemberScores, playerPokemon);
  if (dawnHazardSwitchIndex !== undefined) {
    return dawnHazardSwitchIndex;
  }

  const opponents = playerPokemon.getOpponents();
  if (opponents.length === 0) {
    return undefined;
  }

  const matchupScore =
    opponents.map(opponent => playerPokemon.getMatchupScore(opponent)).reduce((total, score) => total + score, 0)
    / opponents.length;
  const sortedPartyMemberScores = getSortedComputerPartnerPartyMemberMatchupScores(partyMemberScores);

  if (sortedPartyMemberScores[0][1] * switchMultiplier >= matchupScore * scoreMultiplier) {
    return getComputerPartnerNextSummonIndex(partyMemberScores);
  }

  return undefined;
}

function getDawnEntryHazardSwitchIndex(
  playerIndex: PlayerIndex,
  partyMemberScores: [number, number][],
  activePokemon?: PlayerPokemon,
): number | undefined {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  if (profile.key !== "dawn_zorua") {
    return undefined;
  }

  if (globalScene.arena.findTagsOnSide(t => t instanceof EntryHazardTag, ArenaTagSide.ENEMY).length > 0) {
    return undefined;
  }

  if (activePokemon && hasDawnEntryHazardMove(activePokemon)) {
    return undefined;
  }

  const party = globalScene.getPlayerParty(playerIndex);
  const matchupScores = new Map(partyMemberScores);
  const candidates = partyMemberScores
    .map(([partyIndex]) => ({ partyIndex, pokemon: party[partyIndex] }))
    .filter(({ pokemon }) => !!pokemon && hasDawnEntryHazardMove(pokemon))
    .map(({ partyIndex, pokemon }) => ({
      partyIndex,
      score:
        (matchupScores.get(partyIndex) ?? 0)
        + getDawnHazardSwitchRoleBonus(profile, partyIndex, pokemon),
    }))
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.partyIndex;
}

function hasDawnEntryHazardMove(pokemon: { getMoveset(): { moveId: MoveId }[] }): boolean {
  return pokemon.getMoveset().some(pokemonMove => {
    const move = allMoves[pokemonMove.moveId];
    return !!move && isDawnEntryHazardMove(move);
  });
}

function getDawnHazardSwitchRoleBonus(
  profile: ReturnType<typeof getComputerPartnerProfile>,
  partyIndex: number,
  pokemon: Parameters<typeof isComputerPartnerAcePokemon>[0],
): number {
  const role = isComputerPartnerAcePokemon(pokemon, profile) ? "ace" : profile.roles[partyIndex] ?? "balanced";
  switch (role) {
    case "speed":
      return 12;
    case "ace":
      return 6;
    default:
      return 4;
  }
}
