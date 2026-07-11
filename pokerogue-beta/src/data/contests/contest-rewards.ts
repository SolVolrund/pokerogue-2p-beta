import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { Unlockables } from "#enums/unlockables";
import { GrandLaurelModifier } from "#modifiers/modifier";
import { setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import { getModifierType } from "#utils/modifier-utils";
import { ContestRank } from "./contest-opponents";
import { compareContestantTieBreakers, type ContestParticipant, type ContestState } from "./contest-state";

export function setContestPlacementRewards(contestState: ContestState): void {
  const playerPlacements = getContestPlayerPlacements(contestState);
  const pokeblockKitRewardPlayers = getFirstContestPokeblockKitRewardPlayers(contestState);

  for (const [playerIndex, placement] of playerPlacements) {
    const grandFestivalWin = contestState.rank === ContestRank.GRAND && placement === 1;
    if (grandFestivalWin && !hasGrandLaurel(playerIndex)) {
      setEncounterRewards(
        {
          guaranteedModifierTypeFuncs: [modifierTypes.GRAND_LAUREL],
          fillRemaining: false,
          rerollMultiplier: -1,
          allowLuckUpgrades: false,
        },
        undefined,
        () => unlockGrandLaurel(playerIndex),
        playerIndex,
      );
      continue;
    }

    setEncounterRewards(
      {
        forcedModifierTier: grandFestivalWin ? ModifierTier.MASTER : getContestRewardTier(placement),
        fillRemaining: true,
        allowLuckUpgrades: false,
      },
      undefined,
      pokeblockKitRewardPlayers.has(playerIndex) ? () => awardPokeblockKit(playerIndex) : undefined,
      playerIndex,
    );
  }
}

function getFirstContestPokeblockKitRewardPlayers(contestState: ContestState): Set<PlayerIndex> {
  const progress = globalScene.mysteryEncounterSaveData.contestHallProgress;
  if (progress.receivedPokeblockKit) {
    return new Set();
  }

  const playerIndexes = new Set<PlayerIndex>();
  for (const contestant of contestState.contestants) {
    const playerIndex = getContestantPlayerIndex(contestant);
    if (playerIndex !== undefined) {
      playerIndexes.add(playerIndex);
    }
  }

  if (playerIndexes.size > 0) {
    progress.receivedPokeblockKit = true;
  }

  return playerIndexes;
}

function awardPokeblockKit(playerIndex: PlayerIndex): void {
  const modifier = getModifierType(modifierTypes.POKEBLOCK_KIT).newModifier();
  globalScene.addModifier(modifier, false, true, false, true, undefined, playerIndex);
}

function unlockGrandLaurel(playerIndex: PlayerIndex): void {
  const gameData = globalScene.getPlayerGameData(playerIndex);
  gameData.unlocks[Unlockables.GRAND_LAUREL] = true;
  if (globalScene.twoPlayerMode) {
    globalScene.savePlayerSystemSaveLocal(playerIndex);
  } else {
    gameData.saveSystemLocal();
  }
}

function hasGrandLaurel(playerIndex: PlayerIndex): boolean {
  return !!globalScene.findModifierForPlayer(modifier => modifier instanceof GrandLaurelModifier, playerIndex);
}

function getContestPlayerPlacements(contestState: ContestState): Map<PlayerIndex, number> {
  const placements = new Map<PlayerIndex, number>();

  for (const [index, contestant] of getContestPlacementOrder(contestState).entries()) {
    const playerIndex = getContestantPlayerIndex(contestant);
    if (playerIndex === undefined) {
      continue;
    }

    const placement = index + 1;
    const existingPlacement = placements.get(playerIndex);
    if (existingPlacement === undefined || placement < existingPlacement) {
      placements.set(playerIndex, placement);
    }
  }

  return placements;
}

function getContestantPlayerIndex(contestant: ContestParticipant): PlayerIndex | undefined {
  if (contestant.pokemon) {
    return globalScene.getPlayerIndexForPokemon(contestant.pokemon);
  }

  if (contestant.id === "player") {
    return globalScene.activePlayerIndex;
  }

  const playerIdMatch = contestant.id.match(/^player_(\d+)$/);
  if (!playerIdMatch) {
    return;
  }

  const playerIndex = Number(playerIdMatch[1]) - 1;
  if (!globalScene.getActivePlayerIndexes().includes(playerIndex as PlayerIndex)) {
    return;
  }

  return playerIndex as PlayerIndex;
}

function getContestPlacementOrder(contestState: ContestState): ContestParticipant[] {
  return contestState.contestants
    .slice()
    .sort((a, b) => b.totalScore - a.totalScore || compareContestantTieBreakers(a, b, "reward-placement"));
}

function getContestRewardTier(placement: number): ModifierTier {
  switch (placement) {
    case 1:
      return ModifierTier.ROGUE;
    case 2:
      return ModifierTier.ULTRA;
    case 3:
      return ModifierTier.GREAT;
    default:
      return ModifierTier.COMMON;
  }
}
