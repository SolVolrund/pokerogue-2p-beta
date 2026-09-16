import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES, PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { getMysteryEncounterPlayerIndexes } from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PokemonData } from "#system/pokemon-data";
import { trainerConfigs } from "#trainers/trainer-config";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import type { PartyOption } from "#ui/party-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const namespace = "mysteryEncounters/lifeIsWonderful";
const PIKACHU_PARTNER_FORM_INDEX = 1;
const VITAMIN_STATS = [Stat.HP, Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;

function healAllEncounterParties(): void {
  for (const playerIndex of getMysteryEncounterPlayerIndexes()) {
    for (const pokemon of globalScene.getPlayerParty(playerIndex)) {
      pokemon.hp = pokemon.getMaxHp();
      pokemon.resetStatus(true, false, false, true);
      for (const move of pokemon.moveset) {
        move.ppUsed = 0;
      }
      pokemon.updateInfo(true);
    }
  }

  globalScene.arena.resetPlayerTerasUsed();
  globalScene.arena.resetPlayerZMovesUsed();
}

function addTownEscapePhase(): void {
  leaveEncounterWithoutBattle();
  globalScene.phaseManager.unshiftNew("SwitchBiomePhase", BiomeId.TOWN);
}

function getEncounterLevel(): number {
  return globalScene.currentBattle.getLevelForWave();
}

function getTrainerSpecies(speciesId: SpeciesId, strength: PartyMemberStrength = PartyMemberStrength.STRONGER) {
  return getPokemonSpecies(getPokemonSpecies(speciesId).getTrainerSpeciesForLevel(getEncounterLevel(), true, strength));
}

function heldModifier(
  modifier: () => unknown,
  pregenArgs?: unknown[],
  stackCount = 1,
): HeldModifierConfig {
  return {
    modifier: generateModifierType(modifier as () => any, pregenArgs) as PokemonHeldItemModifierType,
    stackCount,
    isTransferable: false,
  };
}

function vitaminModifiers(): HeldModifierConfig[] {
  return VITAMIN_STATS.map(stat => heldModifier(modifierTypes.BASE_STAT_BOOSTER, [stat], 2));
}

function amberModifiers(zCrystal: () => unknown, boosterType: PokemonType, extra: HeldModifierConfig[] = []): HeldModifierConfig[] {
  return [
    ...vitaminModifiers(),
    heldModifier(zCrystal),
    heldModifier(modifierTypes.ATTACK_TYPE_BOOSTER, [boosterType]),
    ...extra,
  ];
}

function createAmberPokemonConfig(
  speciesId: SpeciesId,
  moves: MoveId[],
  modifierConfigs: HeldModifierConfig[],
  formIndex?: number,
  bossSegmentModifier?: number,
): EnemyPokemonConfig {
  const config: EnemyPokemonConfig = {
    species: getTrainerSpecies(speciesId),
    isBoss: true,
    customPokemonData: new CustomPokemonData({ passive: AbilityId.NONE }),
    moveSet: moves,
    modifierConfigs,
    trainerSlot: TrainerSlot.TRAINER,
  };
  if (formIndex != null) {
    config.formIndex = formIndex;
  }
  if (bossSegmentModifier != null) {
    config.bossSegmentModifier = bossSegmentModifier;
  }
  return config;
}

function createJoyPokemonConfig(
  speciesId: SpeciesId,
  ability: AbilityId,
  passive: AbilityId,
  moves: MoveId[],
  trainerSlot: TrainerSlot,
  bossSegmentModifier?: number,
): EnemyPokemonConfig {
  const config: EnemyPokemonConfig = {
    species: getTrainerSpecies(speciesId, PartyMemberStrength.STRONG),
    isBoss: true,
    customPokemonData: new CustomPokemonData({ ability, passive }),
    moveSet: moves,
    trainerSlot,
  };
  if (bossSegmentModifier != null) {
    config.bossSegmentModifier = bossSegmentModifier;
  }
  return config;
}

function createLifeIsWonderfulEnemyPartyConfig(): EnemyPartyConfig {
  const partyConfig: EnemyPartyConfig = {
    trainerConfig: trainerConfigs[TrainerType.AMBER_TWO].clone(),
  };
  const trainerTeams: EnemyPokemonConfig[][] = [createAmberTeam()];
  if (globalScene.getBattleFieldSlotCount() >= 2) {
    partyConfig.partnerTrainerConfig = trainerConfigs[TrainerType.AMBERS_JOY].clone();
    trainerTeams.push(createJoyTeam(TrainerSlot.TRAINER_PARTNER));
  }
  if (globalScene.getBattleFieldSlotCount() >= 3) {
    partyConfig.partnerTrainerConfig2 = trainerConfigs[TrainerType.AMBERS_JOY].clone();
    trainerTeams.push(createJoyTeam(TrainerSlot.TRAINER_PARTNER_2));
  }

  return {
    ...partyConfig,
    pokemonConfigs: interleaveEnemyTeams(trainerTeams),
    doubleBattle: globalScene.getBattleFieldSlotCount() > 1,
    forceDoubleBattle: globalScene.getBattleFieldSlotCount() > 1,
  };
}

function interleaveEnemyTeams(teams: EnemyPokemonConfig[][]): EnemyPokemonConfig[] {
  const ret: EnemyPokemonConfig[] = [];
  const maxTeamSize = Math.max(...teams.map(team => team.length));
  for (let partyIndex = 0; partyIndex < maxTeamSize; partyIndex++) {
    for (const team of teams) {
      if (team[partyIndex]) {
        ret.push(team[partyIndex]);
      }
    }
  }
  return ret;
}

function createAmberTeam(): EnemyPokemonConfig[] {
  return [
    createAmberPokemonConfig(
      SpeciesId.BULBASAUR,
      [MoveId.GIGA_DRAIN, MoveId.GUNK_SHOT, MoveId.EARTH_POWER, MoveId.SAPPY_SEED],
      amberModifiers(modifierTypes.GRASSIUM_Z, PokemonType.GRASS),
    ),
    createAmberPokemonConfig(
      SpeciesId.SQUIRTLE,
      [MoveId.AURA_SPHERE, MoveId.ARMOR_CANNON, MoveId.SHORE_UP, MoveId.ORIGIN_PULSE],
      amberModifiers(modifierTypes.WATERIUM_Z, PokemonType.WATER),
    ),
    createAmberPokemonConfig(
      SpeciesId.CHARMANDER,
      [MoveId.DRAGON_DANCE, MoveId.AEROBLAST, MoveId.EARTH_POWER, MoveId.BITTER_BLADE],
      amberModifiers(modifierTypes.FIRIUM_Z, PokemonType.FIRE),
    ),
    createAmberPokemonConfig(
      SpeciesId.PIKACHU,
      [MoveId.MOONBLAST, MoveId.WAVE_CRASH, MoveId.VOLT_TACKLE, MoveId.TRIPLE_AXEL],
      amberModifiers(modifierTypes.ELECTRIUM_Z, PokemonType.ELECTRIC, [
        heldModifier(modifierTypes.RARE_SPECIES_STAT_BOOSTER, ["LIGHT_BALL"]),
      ]),
      PIKACHU_PARTNER_FORM_INDEX,
    ),
    createAmberPokemonConfig(
      SpeciesId.MEW,
      [MoveId.REVIVAL_BLESSING, MoveId.ASTRAL_BARRAGE, MoveId.PHOTON_GEYSER, MoveId.MOONBLAST],
      amberModifiers(modifierTypes.PSYCHIUM_Z, PokemonType.GHOST),
    ),
    createAmberPokemonConfig(
      SpeciesId.MEWTWO,
      [MoveId.METEOR_MASH, MoveId.MOONBLAST, MoveId.THUNDEROUS_KICK, MoveId.PHOTON_GEYSER],
      amberModifiers(modifierTypes.PSYCHIUM_Z, PokemonType.PSYCHIC),
      undefined,
      2,
    ),
  ];
}

function createJoyTeam(trainerSlot: TrainerSlot): EnemyPokemonConfig[] {
  return [
    createJoyPokemonConfig(
      SpeciesId.HAPPINY,
      AbilityId.HEALER,
      AbilityId.FRIEND_GUARD,
      [MoveId.HEAL_PULSE, MoveId.LIFE_DEW, MoveId.TOXIC, MoveId.REVIVAL_BLESSING],
      trainerSlot,
    ),
    createJoyPokemonConfig(
      SpeciesId.AUDINO,
      AbilityId.HEALER,
      AbilityId.FRIEND_GUARD,
      [MoveId.HEAL_PULSE, MoveId.LIFE_DEW, MoveId.MATCHA_GOTCHA],
      trainerSlot,
    ),
    createJoyPokemonConfig(
      SpeciesId.INDEEDEE,
      AbilityId.PSYCHIC_SURGE,
      AbilityId.HOSPITALITY,
      [MoveId.EXPANDING_FORCE, MoveId.MOONBLAST, MoveId.REVIVAL_BLESSING, MoveId.MATCHA_GOTCHA],
      trainerSlot,
    ),
    createJoyPokemonConfig(
      SpeciesId.LATIAS,
      AbilityId.PRISM_ARMOR,
      AbilityId.ILLUSION,
      [MoveId.CORE_ENFORCER, MoveId.FUSION_FLARE, MoveId.SPARKLY_SWIRL, MoveId.MYSTICAL_POWER],
      trainerSlot,
      1,
    ),
  ];
}

async function duplicateSelectedPokemon(playerIndex: PlayerIndex, sourcePokemon: PlayerPokemon): Promise<void> {
  const addToParty = async (slotIndex?: number): Promise<void> => {
    const dataSource = new PokemonData(sourcePokemon);
    dataSource.player = true;
    dataSource.boss = false;
    dataSource.bossSegments = 0;
    dataSource.trainerSlot = TrainerSlot.NONE;

    const newPokemon = globalScene.addPlayerPokemon(
      getPokemonSpecies(dataSource.species),
      dataSource.level,
      dataSource.abilityIndex,
      dataSource.formIndex,
      dataSource.gender,
      dataSource.shiny,
      dataSource.variant,
      dataSource.ivs,
      dataSource.nature,
      dataSource,
      playerPokemon => {
        if (dataSource.nickname) {
          playerPokemon.nickname = dataSource.nickname;
        }
      },
    );

    const party = globalScene.getPlayerParty(playerIndex);
    if (slotIndex != null && slotIndex <= party.length) {
      party.splice(slotIndex, 0, newPokemon);
    } else {
      party.push(newPokemon);
    }

    await newPokemon.loadAssets();
    cloneHeldItemsToDuplicate(playerIndex, sourcePokemon, newPokemon);
    await updateCaughtDataForDuplicate(playerIndex, newPokemon);
    await showEncounterText(i18next.t(`${namespace}:option.4.obtained`, { pokemonName: newPokemon.getNameToRender() }));
  };

  if (globalScene.isPlayerPartyFull(playerIndex)) {
    await promptReleaseForDuplicate(playerIndex, sourcePokemon.getNameToRender(), addToParty);
  } else {
    await addToParty();
  }
}

function getPartyUiFieldSlotForPlayer(playerIndex: PlayerIndex): number {
  const fieldSlot = globalScene.getPlayerFieldOwners().indexOf(playerIndex);
  return fieldSlot > -1 ? fieldSlot : playerIndex;
}

function cloneHeldItemsToDuplicate(playerIndex: PlayerIndex, sourcePokemon: PlayerPokemon, newPokemon: PlayerPokemon): void {
  const heldItems = globalScene.findModifiersForPlayer(
    modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === sourcePokemon.id,
    playerIndex,
  ) as PokemonHeldItemModifier[];

  for (const item of heldItems) {
    const clonedItem = item.clone() as PokemonHeldItemModifier;
    clonedItem.pokemonId = newPokemon.id;
    clonedItem.isTransferable = true;
    globalScene.addModifier(clonedItem, true, false, false, true, undefined, playerIndex);
  }

  globalScene.updateModifiers(true, true, playerIndex);
}

async function updateCaughtDataForDuplicate(playerIndex: PlayerIndex, pokemon: PlayerPokemon): Promise<void> {
  const gameData = globalScene.getPlayerGameData(playerIndex);
  gameData.updateSpeciesDexIvs(pokemon.species.getRootSpeciesId(true), pokemon.ivs, playerIndex);
  await gameData.setPokemonCaught(pokemon, true, false, false);
}

function promptReleaseForDuplicate(
  playerIndex: PlayerIndex,
  pokemonName: string,
  addToParty: (slotIndex?: number) => Promise<void>,
): Promise<void> {
  return new Promise(resolve => {
    const promptRelease = () => {
      globalScene.waitForPlayerInput(playerIndex);
      updateWindowType(playerIndex + 1);
      globalScene.ui.showText(
        i18next.t("battle:partyFull", { pokemonName }),
        null,
        () => {
          globalScene.ui.setMode(
            UiMode.PARTY,
            PartyUiMode.RELEASE,
            getPartyUiFieldSlotForPlayer(playerIndex),
            (slotIndex: number, _option: PartyOption) => {
              globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                if (slotIndex < PLAYER_PARTY_MAX_SIZE) {
                  addToParty(slotIndex).then(() => resolve());
                } else {
                  promptRelease();
                }
              });
            },
          );
        },
        0,
        true,
      );
    };

    promptRelease();
  });
}

/**
 * Life is Wonderful encounter.
 */
export const LifeIsWonderfulEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.LIFE_IS_WONDERFUL,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withTwoPlayerSharedDecision()
  .withIntroSpriteConfigs([
    {
      spriteKey: "ambers_joy",
      fileRoot: "trainer",
      hasShadow: true,
      x: 0,
      y: 0,
      yShadow: 0,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      text: `${namespace}:introDialogue`,
      speaker: `${namespace}:speaker`,
    },
  ])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(async () => {
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        healAllEncounterParties();
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [{ text: `${namespace}:option.2.selected` }],
      })
      .withOptionPhase(async () => {
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        addTownEscapePhase();
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        selected: [{ text: `${namespace}:option.3.selected` }],
      })
      .withOptionPhase(async () => {
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        for (const playerIndex of getMysteryEncounterPlayerIndexes()) {
          setEncounterRewards(
            {
              guaranteedModifierTypeFuncs: [modifierTypes.CLONE_BALL],
              fillRemaining: false,
              rerollMultiplier: -1,
            },
            undefined,
            undefined,
            playerIndex,
          );
        }
        await initBattleWithEnemyConfig(createLifeIsWonderfulEnemyPartyConfig());
      })
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.4.label`,
        buttonTooltip: `${namespace}:option.4.tooltip`,
        selected: [{ text: `${namespace}:option.4.selected` }],
      })
      .withPreOptionPhase(async () =>
        selectPokemonForOption(
          pokemon => {
            globalScene.currentBattle.mysteryEncounter!.misc = {
              duplicatePokemonId: pokemon.id,
              duplicatePlayerIndex: globalScene.activePlayerIndex,
            };
            return true;
          },
          undefined,
          pokemon => (pokemon.isAllowedInChallenge() ? null : i18next.t("partyUiHandler:cannotBeUsed")),
        ),
      )
      .withOptionPhase(async () => {
        const encounter = globalScene.currentBattle.mysteryEncounter!;
        const playerIndex = (encounter.misc?.duplicatePlayerIndex ?? globalScene.activePlayerIndex) as PlayerIndex;
        const pokemonId = encounter.misc?.duplicatePokemonId as number | undefined;
        const pokemon = globalScene.getPlayerParty(playerIndex).find(partyPokemon => partyPokemon.id === pokemonId);
        await transitionMysteryEncounterIntroVisuals(true, true, 500);
        if (!pokemon) {
          leaveEncounterWithoutBattle();
          return;
        }
        await duplicateSelectedPokemon(playerIndex, pokemon);
        leaveEncounterWithoutBattle();
      })
      .build(),
  )
  .build();
