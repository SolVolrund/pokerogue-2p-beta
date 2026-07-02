import { globalScene } from "#app/global-scene";
import type { PlayerIndex } from "#app/battle-scene";
import { Gender } from "#data/gender";
import type { PlayerPokemon } from "#field/pokemon";
import type { Starter } from "#types/save-data";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  isComputerPartnerStarterAce,
  type ComputerPartnerKey,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export function canInviteComputerPartnerToRun(): boolean {
  return getNextComputerPartnerInviteIndex() != null;
}

export function getNextComputerPartnerInviteIndex(): PlayerIndex | undefined {
  if (!globalScene.twoPlayerMode) {
    return 1;
  }
  if (!globalScene.twoPlayerComputerPartner || globalScene.multiplayerPlayerCount >= 3) {
    return undefined;
  }

  return 2;
}

export async function inviteComputerPartnerToRun(key: ComputerPartnerKey): Promise<void> {
  const playerIndex = getNextComputerPartnerInviteIndex();
  if (playerIndex == null) {
    return;
  }

  const profile = getComputerPartnerProfile(key);
  const starters = createComputerPartnerStarter(profile);

  if (!starters.length) {
    return;
  }

  globalScene.configureTwoPlayerMode(true, 6, true, playerIndex === 2 ? 3 : 2);
  applyComputerPartnerIdentity(profile, playerIndex);

  const party = globalScene.getPlayerParty(playerIndex);
  party.splice(0, party.length);

  const loadPokemonAssets = starters.map((starter, index) => {
    const starterPokemon = createPartnerPokemon(starter, isComputerPartnerStarterAce(profile, starter, index));
    party.push(starterPokemon);
    return starterPokemon.loadAssets();
  });

  await Promise.all(loadPokemonAssets);
  globalScene.setActivePlayerIndex(0);
}

export function dismissComputerPartnerFromRun(playerIndex: PlayerIndex = 1): string {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));

  if (!globalScene.twoPlayerComputerPartner) {
    return profile.name;
  }

  globalScene.clearMysteryEncounterBattlePlayerFieldOwners();
  globalScene.getActivePlayerIndexes()
    .filter(partnerIndex => globalScene.isComputerPartnerPlayer(partnerIndex))
    .forEach(partnerIndex => {
      globalScene.getPlayerParty(partnerIndex).forEach(pokemon => {
        if (pokemon.isOnField()) {
          pokemon.leaveField(true, true, false);
        }
      });
      globalScene.players[partnerIndex].party.splice(0, globalScene.players[partnerIndex].party.length);
      globalScene.players[partnerIndex].modifiers.splice(0, globalScene.players[partnerIndex].modifiers.length);
    });
  globalScene.setActivePlayerIndex(0);
  globalScene.configureTwoPlayerMode(false);

  return profile.name;
}

function applyComputerPartnerIdentity(profile: ReturnType<typeof getComputerPartnerProfile>, playerIndex: PlayerIndex): void {
  globalScene.setComputerPartnerKey(playerIndex, profile.key);
}

function createPartnerPokemon(starter: Starter, isAce: boolean): PlayerPokemon {
  const species = getPokemonSpecies(starter.speciesId);
  const pokemon = globalScene.addPlayerPokemon(
    species,
    getComputerPartnerJoinLevel(),
    starter.abilityIndex,
    starter.formIndex,
    getStarterGender(starter),
    starter.shiny,
    starter.variant,
    starter.ivs,
    starter.nature,
  );

  pokemon.computerPartnerAce = isAce;
  if (starter.moveset) {
    pokemon.tryPopulateMoveset(starter.moveset);
  }
  if (starter.passive) {
    pokemon.passive = true;
  }
  if (starter.nickname) {
    pokemon.nickname = starter.nickname;
  }
  pokemon.teraType = starter.teraType ?? pokemon.species.type1;
  pokemon.setVisible(false);

  return pokemon;
}

function getStarterGender(starter: Starter): Gender {
  const species = getPokemonSpecies(starter.speciesId);

  if (species.malePercent === null) {
    return Gender.GENDERLESS;
  }
  if (species.malePercent === 0) {
    return Gender.FEMALE;
  }
  if (species.malePercent === 100) {
    return Gender.MALE;
  }

  return starter.female ? Gender.FEMALE : Gender.MALE;
}

function getComputerPartnerJoinLevel(): number {
  const party = globalScene.getPlayerParty(0);
  const activeParty = party.filter(pokemon => !pokemon.isFainted());
  const referenceParty = activeParty.length ? activeParty : party;

  if (!referenceParty.length) {
    return globalScene.gameMode.getStartingLevel();
  }

  const averageLevel = referenceParty.reduce((total, pokemon) => total + pokemon.level, 0) / referenceParty.length;
  return Math.max(globalScene.gameMode.getStartingLevel(), Math.round(averageLevel));
}
