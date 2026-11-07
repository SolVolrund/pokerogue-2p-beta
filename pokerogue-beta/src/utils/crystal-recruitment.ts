import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { Gender } from "#data/gender";
import { ModifierTier } from "#enums/modifier-tier";
import type { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { getPartyLuckValue } from "#modifiers/modifier-type";
import { checkSpeciesValidForChallenge } from "#utils/challenge-utils";
import { randSeedItem } from "#utils/common";
import {
  getBestComputerPartnerReplacementSlot,
  getComputerPartnerProfileWithRolePreferences,
  isComputerPartnerCandidateAllowed,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { getRewardPokemonSpeciesPool } from "#utils/reward-pokemon";
import { rollRewardTier } from "#utils/reward-tier";

export const CRYSTAL_RECRUITMENT_CHOICES = 3;
export const CRYSTAL_RECRUITMENT_COST_BANDS = {
  [ModifierTier.COMMON]: [1, 3],
  [ModifierTier.GREAT]: [4, 4],
  [ModifierTier.ULTRA]: [5, 6],
  [ModifierTier.ROGUE]: [7, 8],
  [ModifierTier.MASTER]: [9, 10],
} as const;

export interface CrystalRecruitmentCandidate {
  pokemon: PlayerPokemon;
  tier: ModifierTier;
  starterSpeciesId: SpeciesId;
}

export function isCrystalRecruitmentDue(playerIndex: PlayerIndex): boolean {
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  return (
    wave > 0
    && (wave % 10 === 4 || wave % 10 === 7)
    && !globalScene.canPlayerUsePokeballs(playerIndex)
    && (globalScene.getPlayerState(playerIndex).lastCrystalRecruitmentWave ?? 0) < wave
    && globalScene.hasPlayerUsablePokemon(playerIndex)
  );
}

function getRecruitmentProfile(playerIndex: PlayerIndex) {
  return getComputerPartnerProfileWithRolePreferences(
    globalScene.getComputerPartnerKey(playerIndex),
    globalScene.getComputerPartnerRolePreferences(playerIndex),
  );
}

/** Candidates remain outside the party until selected; the caller owns/destroys them. */
export function generateCrystalRecruitmentCandidates(playerIndex: PlayerIndex): CrystalRecruitmentCandidate[] {
  const candidates: CrystalRecruitmentCandidate[] = [];
  const profile = getRecruitmentProfile(playerIndex);
  const party = globalScene.getPlayerParty(playerIndex);
  const level = Math.max(1, Math.min(globalScene.getMaxExpLevel(), Math.max(1, ...party.map(p => p.level))));
  const previousPlayer = globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);
  try {
    globalScene.executeWithSeedOffset(
      () => {
        const luck = getPartyLuckValue(party);
        for (let index = 0; index < CRYSTAL_RECRUITMENT_CHOICES; index++) {
          const tier = Math.min(
            rollRewardTier(luck).tier,
            ModifierTier.MASTER,
          ) as keyof typeof CRYSTAL_RECRUITMENT_COST_BANDS;
          const [minCost, maxCost] = CRYSTAL_RECRUITMENT_COST_BANDS[tier];
          const pool = getRewardPokemonSpeciesPool(minCost, maxCost);
          const unusedPool = pool.filter(id => !candidates.some(candidate => candidate.starterSpeciesId === id));
          const remaining = [...(unusedPool.length > 0 ? unusedPool : pool)];
          // Do not reroll a failed tier into a better one when challenge restrictions exclude its species.
          while (remaining.length > 0) {
            const starterSpeciesId = randSeedItem(remaining);
            remaining.splice(remaining.indexOf(starterSpeciesId), 1);
            const starter = getPokemonSpecies(starterSpeciesId);
            const species = getPokemonSpecies(starter.getTrainerSpeciesForLevel(level, true));
            const pokemon = globalScene.addPlayerPokemon(species, level, undefined, undefined, undefined, false);
            pokemon.trySetShinySeed(undefined, true);
            pokemon.setCrystalized(true);
            pokemon.setVisible(false);
            const valid =
              isComputerPartnerCandidateAllowed(profile, pokemon, playerIndex)
              && checkSpeciesValidForChallenge(
                species,
                {
                  shiny: pokemon.shiny,
                  female: pokemon.gender === Gender.FEMALE,
                  variant: pokemon.variant,
                  formIndex: pokemon.formIndex,
                },
                false,
                playerIndex,
              );
            if (!valid) {
              pokemon.destroy();
              continue;
            }
            pokemon.generateAndPopulateMoveset();
            candidates.push({ pokemon, tier, starterSpeciesId });
            break;
          }
        }
      },
      globalScene.currentBattle.waveIndex,
      `${globalScene.seed}:crystal-recruitment:${playerIndex}`,
    );
    return candidates;
  } catch (error) {
    candidates.forEach(candidate => candidate.pokemon.destroy());
    throw error;
  } finally {
    globalScene.setActivePlayerIndex(previousPlayer);
  }
}

export function chooseCrystalRecruit(playerIndex: PlayerIndex, candidates: CrystalRecruitmentCandidate[]) {
  const profile = getRecruitmentProfile(playerIndex);
  const party = globalScene.getPlayerParty(playerIndex);
  return candidates
    .flatMap(candidate => {
      const replacement = getBestComputerPartnerReplacementSlot(
        profile,
        party,
        candidate.pokemon,
        globalScene.getPlayerPartyLimit(playerIndex),
      );
      return replacement ? [{ candidate, replacement }] : [];
    })
    .sort((a, b) => b.replacement.candidateTeamScore - a.replacement.candidateTeamScore)[0];
}

export async function recruitCrystalPokemon(playerIndex: PlayerIndex): Promise<string[]> {
  if (!isCrystalRecruitmentDue(playerIndex)) {
    return [];
  }
  const wave = globalScene.currentBattle.waveIndex;
  const candidates = generateCrystalRecruitmentCandidates(playerIndex);
  let recruited: PlayerPokemon | undefined;
  try {
    const choice = chooseCrystalRecruit(playerIndex, candidates);
    const name = getRecruitmentProfile(playerIndex).name;
    const options = candidates.map(({ pokemon }) => `${pokemon.isShiny() ? "Shiny " : ""}${pokemon.getNameToRender()}`);
    const messages = options.length > 0 ? [`${name}'s crystal choices:\n${options.join(", ")}.`] : [];
    if (choice) {
      const pokemon = choice.candidate.pokemon;
      await pokemon.loadAssets();
      const replacedIndex = choice.replacement.replacedPokemonIndex;
      const party = globalScene.getPlayerParty(playerIndex);
      if (replacedIndex === undefined) {
        party.push(pokemon);
        messages.push(`${name} recruited ${pokemon.getNameToRender()}.`);
      } else {
        const replaced = party[replacedIndex];
        const replacedName = replaced.getNameToRender();
        await globalScene.removePartyMemberModifiers(replacedIndex, playerIndex, true);
        globalScene.removePokemonFromPlayerParty(replaced);
        party.splice(replacedIndex, 0, pokemon);
        messages.push(`${name} recruited ${pokemon.getNameToRender()}, replacing ${replacedName}.`);
      }
      recruited = pokemon;
    } else {
      messages.push(`${name} kept her current team.`);
    }
    // This is run state only: crystal recruitment never writes to a human's collection.
    globalScene.getPlayerState(playerIndex).lastCrystalRecruitmentWave = wave;
    return messages;
  } finally {
    candidates.filter(candidate => candidate.pokemon !== recruited).forEach(candidate => candidate.pokemon.destroy());
  }
}
