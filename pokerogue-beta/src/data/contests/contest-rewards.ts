import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import { getModifierType } from "#utils/modifier-utils";
import type { ContestParticipant, ContestState } from "./contest-state";

export function setContestPlacementRewards(contestState: ContestState): void {
  const playerRewardTiers = getContestPlayerRewardTiers(contestState);
  const pokeblockKitRewardPlayers = getFirstContestPokeblockKitRewardPlayers(contestState);

  for (const [playerIndex, tier] of playerRewardTiers) {
    setEncounterRewards(
      {
        forcedModifierTier: tier,
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

function getContestPlayerRewardTiers(contestState: ContestState): Map<PlayerIndex, ModifierTier> {
  const tiers = new Map<PlayerIndex, ModifierTier>();

  for (const contestant of contestState.contestants) {
    const playerIndex = getContestantPlayerIndex(contestant);
    if (playerIndex === undefined) {
      continue;
    }

    const tier = getContestRewardTier(getContestPlacement(contestState, contestant));
    const existingTier = tiers.get(playerIndex);
    if (existingTier === undefined || tier > existingTier) {
      tiers.set(playerIndex, tier);
    }
  }

  return tiers;
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

function getContestPlacement(contestState: ContestState, contestant: ContestParticipant): number {
  return 1 + contestState.contestants.filter(other => other.totalScore > contestant.totalScore).length;
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
