import { globalScene } from "#app/global-scene";
import { Gender } from "#data/gender";
import { PlayerGender } from "#enums/player-gender";
import { PlayerTrainerSprite } from "#enums/player-trainer-sprite";
import type { PlayerPokemon } from "#field/pokemon";
import type { Starter } from "#types/save-data";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  type ComputerPartnerKey,
  type ComputerPartnerProfile,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export async function inviteComputerPartnerToRun(key: ComputerPartnerKey): Promise<void> {
  const profile = getComputerPartnerProfile(key);
  const starters = createComputerPartnerStarter(profile);

  if (!starters.length) {
    return;
  }

  globalScene.configureTwoPlayerMode(true, 6, true);
  applyComputerPartnerIdentity(profile);

  const party = globalScene.getPlayerParty(1);
  party.splice(0, party.length);

  const loadPokemonAssets = starters.map((starter, index) => {
    const starterPokemon = createPartnerPokemon(starter, index === 0);
    party.push(starterPokemon);
    return starterPokemon.loadAssets();
  });

  await Promise.all(loadPokemonAssets);
  globalScene.setActivePlayerIndex(0);
}

export function dismissComputerPartnerFromRun(): string {
  const profile = getComputerPartnerProfile(globalScene.computerPartnerKey);

  if (!globalScene.twoPlayerComputerPartner) {
    return profile.name;
  }

  globalScene.clearMysteryEncounterBattlePlayerFieldOwners();
  globalScene.getPlayerParty(1).forEach(pokemon => {
    if (pokemon.isOnField()) {
      pokemon.leaveField(true, true, false);
    }
  });
  globalScene.players[1].party.splice(0, globalScene.players[1].party.length);
  globalScene.players[1].modifiers.splice(0, globalScene.players[1].modifiers.length);
  globalScene.setActivePlayerIndex(0);
  globalScene.configureTwoPlayerMode(false);

  return profile.name;
}

function applyComputerPartnerIdentity(profile: ComputerPartnerProfile): void {
  globalScene.computerPartnerKey = profile.key;
  globalScene.twoPlayerGuestTrainerSprite = profile.trainerSprite ?? PlayerTrainerSprite.BASE_GIRL;
  globalScene.twoPlayerGuestGender = profile.trainerGender ?? PlayerGender.FEMALE;
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
