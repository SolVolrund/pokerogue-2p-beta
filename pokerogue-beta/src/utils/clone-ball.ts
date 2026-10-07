import type { PlayerIndex } from "#app/battle-scene";
import { PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { createEmptyAceEvSpread } from "#data/ace-evs";
import { Gender } from "#data/gender";
import { PokemonBattleData, PokemonSummonData } from "#data/pokemon-data";
import { PokeballType } from "#enums/pokeball";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { achvs } from "#system/achv";
import { PokemonData } from "#system/pokemon-data";
import { checkSpeciesValidForChallenge } from "#utils/challenge-utils";
import { isUnownCrystalGauntletWave } from "#utils/classic-final-boss-utils";
import { randSeedInt } from "#utils/common";
import {
  getComputerPartnerProfileWithRolePreferences,
  getComputerPartnerReplacementScores,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export function getCloneBallBattleBlockMessage(): string | undefined {
  const battle = globalScene.currentBattle;
  if (battle.isClassicFinalBoss) {
    return "battle:noCloneBallFinalBoss";
  }
  if (isUnownCrystalGauntletWave(battle.waveIndex, globalScene.gameMode.modeId)) {
    return "battle:noPokeballForce";
  }
  if (battle.trainer?.config.getDerivedType() === TrainerType.RIVAL) {
    return "battle:noCloneBallRival";
  }
  return;
}

export function getCloneBallTargets(playerIndex: PlayerIndex): Pokemon[] {
  if (!globalScene.canPlayerUsePokeballs(playerIndex, PokeballType.CLONE_BALL) || getCloneBallBattleBlockMessage()) {
    return [];
  }
  return globalScene.getField().filter(pokemon => pokemon?.isActive(true) && !pokemon.isFainted());
}

/** A copy owns all its mutable data and is never another trainer's Ace or borrowed Pokemon. */
export function createCloneBallCopy(source: Pokemon): PlayerPokemon {
  const data = new PokemonData(JSON.parse(JSON.stringify(new PokemonData(source))));
  const usedIds = new Set([
    ...globalScene.getActivePlayerIndexes().flatMap(index => globalScene.getPlayerParty(index).map(p => p.id)),
    ...globalScene.getEnemyParty().map(p => p.id),
    source.id,
  ]);
  data.id = randSeedInt(4294967296);
  while (usedIds.has(data.id)) {
    data.id = (data.id + 1) >>> 0;
  }
  data.player = true;
  data.boss = false;
  data.bossSegments = 0;
  data.trainerSlot = TrainerSlot.NONE;
  data.pokeball = PokeballType.CLONE_BALL;
  data.ace = false;
  data.computerPartnerAce = false;
  data.aceType = undefined;
  data.aceEvs = createEmptyAceEvSpread();
  data.gtsMalfunctionOriginalPlayerIndex = undefined;
  data.metBiome = globalScene.arena.biomeId;
  data.metWave = globalScene.currentBattle.waveIndex;
  data.metLevel = source.level;
  data.metSpecies = source.species.speciesId;
  data.isTerastallized = false;
  data.stellarTypesBoosted = [];
  data.summonData = new PokemonSummonData();
  data.battleData = new PokemonBattleData();
  data.summonDataSpeciesFormIndex = 0;
  const pokemon = globalScene.addPlayerPokemon(
    getPokemonSpecies(data.species),
    data.level,
    data.abilityIndex,
    data.formIndex,
    data.gender,
    data.shiny,
    data.variant,
    data.ivs,
    data.nature,
    data,
  );
  if (data.crystalized) {
    pokemon.setCrystalized(true, data.crystalColor ?? undefined);
  }
  pokemon.calculateStats();
  pokemon.setVisible(false);
  return pokemon;
}

export function getCloneBallHeldItems(source: Pokemon): PokemonHeldItemModifier[] {
  return (
    globalScene.findModifiersForPokemon(
      modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === source.id,
      source,
    ) as PokemonHeldItemModifier[]
  ).map(item => {
    const copy = item.clone() as PokemonHeldItemModifier;
    copy.isTransferable = true;
    copy.recoverableBattleTransfer = undefined;
    return copy;
  });
}

export function canKeepCloneBallCopy(pokemon: PlayerPokemon, playerIndex: PlayerIndex): boolean {
  return checkSpeciesValidForChallenge(
    pokemon.species,
    {
      shiny: pokemon.shiny,
      female: pokemon.gender === Gender.FEMALE,
      variant: pokemon.variant,
      formIndex: pokemon.formIndex,
    },
    false,
    playerIndex,
  );
}

export function getComputerPartnerCloneReplacement(playerIndex: PlayerIndex, candidate: PlayerPokemon) {
  if (!canKeepCloneBallCopy(candidate, playerIndex)) {
    return;
  }
  const profile = getComputerPartnerProfileWithRolePreferences(
    globalScene.getComputerPartnerKey(playerIndex),
    globalScene.getComputerPartnerRolePreferences(playerIndex),
  );
  const party = globalScene.getPlayerParty(playerIndex);
  // Checked during planning and again before spending a ball, including queued throws.
  if (profile.key === "amber_two" && party.some(pokemon => pokemon.species.speciesId === candidate.species.speciesId)) {
    return;
  }
  return getComputerPartnerReplacementScores(profile, party, candidate, globalScene.getPlayerPartyLimit(playerIndex))
    .filter(score => score.canReplace && !score.replacedPokemon?.isOnField())
    .sort((a, b) => b.candidateTeamScore - a.candidateTeamScore)[0];
}

export function getComputerPartnerCloneTarget(playerIndex: PlayerIndex): Pokemon | undefined {
  if (!(globalScene.getPlayerPokeballCounts(playerIndex)[PokeballType.CLONE_BALL] > 0)) {
    return;
  }
  let best: { source: Pokemon; score: number } | undefined;
  const previousPlayer = globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);
  try {
    // Preview copies must not consume the battle RNG or depend on local profile IDs.
    globalScene.executeWithSeedOffset(
      () => {
        for (const source of getCloneBallTargets(playerIndex)) {
          if (source.isPlayer() && globalScene.getPlayerIndexForPokemon(source) === playerIndex) {
            continue;
          }
          const candidate = createCloneBallCopy(source);
          try {
            const replacement = getComputerPartnerCloneReplacement(playerIndex, candidate);
            if (replacement && (!best || replacement.candidateTeamScore > best.score)) {
              best = { source, score: replacement.candidateTeamScore };
            }
          } finally {
            candidate.destroy();
          }
        }
      },
      globalScene.currentBattle.turn,
      `${globalScene.waveSeed}:clone-preview:${playerIndex}`,
    );
  } finally {
    globalScene.setActivePlayerIndex(previousPlayer);
  }
  return best?.source;
}

export async function keepCloneBallCopy(
  pokemon: PlayerPokemon,
  items: PokemonHeldItemModifier[],
  playerIndex: PlayerIndex,
  replacementIndex?: number,
  insertionIndex?: number,
): Promise<void> {
  await pokemon.loadAssets();
  const party = globalScene.getPlayerParty(playerIndex);
  if (replacementIndex !== undefined) {
    await globalScene.removePartyMemberModifiers(replacementIndex, playerIndex);
    globalScene.removePokemonFromPlayerParty(party[replacementIndex]);
  }
  party.splice(insertionIndex ?? replacementIndex ?? party.length, 0, pokemon);
  for (const item of items) {
    item.pokemonId = pokemon.id;
    await globalScene.addModifier(item, true, false, false, true, undefined, playerIndex);
  }
  await globalScene.updateModifiers(true, true, playerIndex);
  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    if (!globalScene.isCpuPlayersVsEnemyPlayerMode()) {
      globalScene
        .getPlayerGameData(0)
        .recordComputerPartnerPokemonCaught(globalScene.getComputerPartnerKey(playerIndex), pokemon);
      globalScene.savePlayerSystemSaveLocal(0);
    }
  } else {
    if (party.filter(p => p.isShiny()).length === PLAYER_PARTY_MAX_SIZE) {
      globalScene.validateAchvForPlayer(achvs.SHINY_PARTY, playerIndex);
    }
    const gameData = globalScene.getPlayerGameData(playerIndex);
    gameData.updateSpeciesDexIvs(pokemon.species.getRootSpeciesId(true), pokemon.ivs, playerIndex);
    await gameData.setPokemonCaught(pokemon, true, false, false);
    await globalScene.savePlayerSystemSave(playerIndex);
  }
}
