import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { EncounterBattleAnim } from "#data/battle-anims";
import { getTypeDamageMultiplier } from "#data/type";
import { allAbilities, modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { Challenges } from "#enums/challenges";
import { EncounterAnim } from "#enums/encounter-anims";
import { FieldPosition } from "#enums/field-position";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokemonType, type RegularPokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import {
  applyAbilityOverrideToPokemon,
  applyModifierTypeToPlayerPokemon,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { OptionSelectConfig } from "#ui/abstract-option-select-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt, randSeedShuffle } from "#utils/common";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import { getPokemonSpecies, getRandomRegularPokemonType } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/clowningAround";

const RANDOM_ABILITY_POOL = [
  AbilityId.STURDY,
  AbilityId.PICKUP,
  AbilityId.INTIMIDATE,
  AbilityId.GUTS,
  AbilityId.DROUGHT,
  AbilityId.DRIZZLE,
  AbilityId.SNOW_WARNING,
  AbilityId.SAND_STREAM,
  AbilityId.ELECTRIC_SURGE,
  AbilityId.PSYCHIC_SURGE,
  AbilityId.GRASSY_SURGE,
  AbilityId.MISTY_SURGE,
  AbilityId.MAGICIAN,
  AbilityId.SHEER_FORCE,
  AbilityId.PRANKSTER,
];

type ClowningAroundOptionIndex = 1 | 2 | 3;

interface ClowningAroundChoice {
  playerIndex: PlayerIndex;
  optionIndex: ClowningAroundOptionIndex;
}

interface ClowningAroundData {
  ability: AbilityId;
  choices: ClowningAroundChoice[];
  battlePlayers: PlayerIndex[];
  skipSelectedDialogueOnce?: boolean;
}

function getClowningAroundData(): ClowningAroundData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      ability: encounter.misc?.ability,
      choices: [],
      battlePlayers: [],
    } satisfies ClowningAroundData;
  }

  return encounter.misc as ClowningAroundData;
}

function chooseComputerPartnerClowningAroundOption(playerIndex: PlayerIndex): ClowningAroundOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  if (confidence.level === "medium" || confidence.level === "high") {
    return 1;
  }
  if (confidence.level === "low") {
    return 3;
  }
  return 2;
}

function queueComputerPartnerClowningAroundChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: ClowningAroundOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function promptNextClowningAroundPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildClowningAroundPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerClowningAroundOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeClowningAroundChoice(optionIndex as ClowningAroundOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function hideClowningAroundNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  await Promise.all(
    getMysteryEncounterPlayerIndexes()
      .filter(playerIndex => !battlePlayerSet.has(playerIndex))
      .map(
        playerIndex =>
          new Promise<void>(resolve => {
            const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
            globalScene.tweens.killTweensOf(trainerSprite);

            if (!trainerSprite.visible) {
              resolve();
              return;
            }

            globalScene.tweens.add({
              targets: trainerSprite,
              x: -36,
              duration: 500,
              onComplete: () => {
                trainerSprite.setVisible(false);
                resolve();
              },
            });
          }),
      ),
  );
}

async function storeClowningAroundChoice(
  optionIndex: ClowningAroundOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getClowningAroundData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerClowningAroundChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptNextClowningAroundPlayer(nextPlayerIndex, optionIndex - 1);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function applyClowningAroundItemShuffle(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  globalScene.waitForPlayerInput(playerIndex);

  const party = globalScene.getPlayerParty(playerIndex);
  let mostHeldItemsPokemon = party[0];
  let count = mostHeldItemsPokemon
    .getHeldItems()
    .filter(m => m.isTransferable && !(m instanceof BerryModifier))
    .reduce((v, m) => v + m.stackCount, 0);

  for (const pokemon of party) {
    const nextCount = pokemon
      .getHeldItems()
      .filter(m => m.isTransferable && !(m instanceof BerryModifier))
      .reduce((v, m) => v + m.stackCount, 0);
    if (nextCount > count) {
      mostHeldItemsPokemon = pokemon;
      count = nextCount;
    }
  }

  encounter.setDialogueToken("switchPokemon", mostHeldItemsPokemon.getNameToRender());

  const items = mostHeldItemsPokemon.getHeldItems();

  let numBerries = 0;
  for (const m of items.filter(m => m instanceof BerryModifier)) {
    numBerries += m.stackCount;
    globalScene.removeModifier(m, false, playerIndex);
  }

  generateItemsOfTier(mostHeldItemsPokemon, numBerries, "Berries", playerIndex);

  let numUltra = 0;
  let numRogue = 0;

  for (const m of items.filter(m => m.isTransferable && !(m instanceof BerryModifier))) {
    const type = m.type.withTierFromPool(ModifierPoolType.PLAYER, party);
    const tier = type.tier ?? ModifierTier.ULTRA;
    if (type.id === "GOLDEN_EGG" || tier === ModifierTier.ROGUE) {
      numRogue += m.stackCount;
      globalScene.removeModifier(m, false, playerIndex);
    } else if (type.id === "LUCKY_EGG" || type.id === "SOOTHE_BELL" || tier === ModifierTier.ULTRA) {
      numUltra += m.stackCount;
      globalScene.removeModifier(m, false, playerIndex);
    }
  }

  generateItemsOfTier(mostHeldItemsPokemon, numUltra, ModifierTier.ULTRA, playerIndex);
  generateItemsOfTier(mostHeldItemsPokemon, numRogue, ModifierTier.ROGUE, playerIndex);
}

function applyClowningAroundTypeShuffle(playerIndex: PlayerIndex): void {
  globalScene.waitForPlayerInput(playerIndex);

  for (const pokemon of globalScene.getPlayerParty(playerIndex)) {
    const originalTypes = pokemon.getTypes({
      includeTeraType: false,
      bypassSummonData: true,
      ignoreThirdType: true,
    });

    let priorityTypes = pokemon.moveset
      .filter(move => move && !originalTypes.includes(move.getMove().type) && move.getMove().category !== MoveCategory.STATUS)
      .map(move => move!.getMove().type) as RegularPokemonType[];
    if (priorityTypes?.length > 0) {
      priorityTypes = [...new Set(priorityTypes)].sort();
      priorityTypes = randSeedShuffle(priorityTypes);
    }

    const newTypes: (RegularPokemonType | null)[] = [null];
    let secondType: RegularPokemonType | null = null;
    while (secondType == null || originalTypes.includes(secondType)) {
      if (priorityTypes.length > 0) {
        secondType = priorityTypes.pop() ?? null;
      } else {
        secondType = getRandomRegularPokemonType();
      }
    }
    newTypes.push(secondType);

    pokemon.customPokemonData.types = newTypes;
    if (pokemon.isFusion()) {
      if (!pokemon.fusionCustomPokemonData) {
        pokemon.fusionCustomPokemonData = new CustomPokemonData();
      }
      pokemon.fusionCustomPokemonData.types = newTypes;
    }
  }
}

function getPartyTypes(pokemon: PlayerPokemon): PokemonType[] {
  return pokemon.getTypes({
    includeTeraType: false,
    bypassSummonData: true,
    ignoreThirdType: true,
  });
}

function hasPokemonType(pokemon: PlayerPokemon, type: PokemonType): boolean {
  return getPartyTypes(pokemon).includes(type);
}

function isWeakToType(pokemon: PlayerPokemon, attackType: PokemonType): boolean {
  return getPartyTypes(pokemon).reduce((multiplier, type) => multiplier * getTypeDamageMultiplier(attackType, type), 1) > 1;
}

function offensiveScore(pokemon: PlayerPokemon): number {
  return Math.max(pokemon.getStat(Stat.ATK), pokemon.getStat(Stat.SPATK));
}

function bulkScore(pokemon: PlayerPokemon): number {
  return pokemon.getStat(Stat.HP) + pokemon.getStat(Stat.DEF) + pokemon.getStat(Stat.SPDEF);
}

function getComputerPartnerAcePokemon(party: PlayerPokemon[]): PlayerPokemon | undefined {
  return party.find(pokemon => pokemon.computerPartnerAce) ?? party[0];
}

function getHighestScoringPokemon(
  party: PlayerPokemon[],
  scorePokemon: (pokemon: PlayerPokemon) => number,
): PlayerPokemon | undefined {
  return party.toSorted((pokemon1, pokemon2) => scorePokemon(pokemon2) - scorePokemon(pokemon1))[0];
}

function getLowestScoringPokemon(
  party: PlayerPokemon[],
  scorePokemon: (pokemon: PlayerPokemon) => number,
): PlayerPokemon | undefined {
  return party.toSorted((pokemon1, pokemon2) => scorePokemon(pokemon1) - scorePokemon(pokemon2))[0];
}

function getBestTypedPokemon(
  party: PlayerPokemon[],
  type: PokemonType,
  scorePokemon: (pokemon: PlayerPokemon) => number = offensiveScore,
): PlayerPokemon | undefined {
  return getHighestScoringPokemon(party.filter(pokemon => hasPokemonType(pokemon, type)), scorePokemon);
}

function hasSheerForceMove(pokemon: PlayerPokemon): boolean {
  return pokemon.moveset.some(pokemonMove => {
    const move = pokemonMove?.getMove();
    return !!move && move.category !== MoveCategory.STATUS && move.power > 0 && move.chance > 0;
  });
}

function sheerForceScore(pokemon: PlayerPokemon): number {
  return pokemon.moveset.reduce((total, pokemonMove) => {
    const move = pokemonMove?.getMove();
    return total + (move && move.category !== MoveCategory.STATUS && move.power > 0 && move.chance > 0 ? move.power : 0);
  }, 0);
}

function hasPranksterMove(pokemon: PlayerPokemon): boolean {
  return pokemon.moveset.some(pokemonMove => pokemonMove?.getMove().category === MoveCategory.STATUS);
}

function chooseComputerPartnerAbilityPokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  const party = globalScene.getPlayerParty(playerIndex);
  const ability = getClowningAroundData().ability;
  const acePokemon = getComputerPartnerAcePokemon(party);

  switch (ability) {
    case AbilityId.STURDY:
      return party.toSorted(
        (pokemon1, pokemon2) =>
          pokemon1.getStat(Stat.HP) - pokemon2.getStat(Stat.HP)
          || pokemon2.getStat(Stat.SPD) - pokemon1.getStat(Stat.SPD),
      )[0];
    case AbilityId.PICKUP:
    case AbilityId.MAGICIAN:
      return getComputerPartnerAcePokemon(party);
    case AbilityId.INTIMIDATE:
      return getLowestScoringPokemon(party, pokemon => pokemon.getStat(Stat.DEF));
    case AbilityId.GUTS:
      return getHighestScoringPokemon(
        party.filter(pokemon => pokemon !== acePokemon),
        pokemon => pokemon.getStat(Stat.ATK),
      );
    case AbilityId.DROUGHT:
      return (
        getBestTypedPokemon(party, PokemonType.FIRE)
        ?? getHighestScoringPokemon(party.filter(pokemon => isWeakToType(pokemon, PokemonType.WATER)), offensiveScore)
      );
    case AbilityId.DRIZZLE:
      return (
        getBestTypedPokemon(party, PokemonType.WATER)
        ?? getHighestScoringPokemon(party.filter(pokemon => isWeakToType(pokemon, PokemonType.FIRE)), offensiveScore)
      );
    case AbilityId.SNOW_WARNING:
      return getLowestScoringPokemon(
        party.filter(pokemon => hasPokemonType(pokemon, PokemonType.ICE)),
        pokemon => pokemon.getStat(Stat.DEF),
      );
    case AbilityId.SAND_STREAM:
      return (
        getLowestScoringPokemon(
          party.filter(pokemon => hasPokemonType(pokemon, PokemonType.ROCK)),
          pokemon => pokemon.getStat(Stat.SPDEF),
        )
        ?? getHighestScoringPokemon(party.filter(pokemon => hasPokemonType(pokemon, PokemonType.GROUND)), bulkScore)
      );
    case AbilityId.ELECTRIC_SURGE:
      return getBestTypedPokemon(party, PokemonType.ELECTRIC);
    case AbilityId.PSYCHIC_SURGE:
      return getBestTypedPokemon(party, PokemonType.PSYCHIC);
    case AbilityId.GRASSY_SURGE:
      return getBestTypedPokemon(party, PokemonType.GRASS, bulkScore) ?? getHighestScoringPokemon(party, bulkScore);
    case AbilityId.MISTY_SURGE:
      return getBestTypedPokemon(party, PokemonType.FAIRY) ?? getHighestScoringPokemon(party, bulkScore);
    case AbilityId.SHEER_FORCE:
      return getHighestScoringPokemon(party.filter(hasSheerForceMove), sheerForceScore);
    case AbilityId.PRANKSTER:
      return getHighestScoringPokemon(party.filter(hasPranksterMove), pokemon => pokemon.getStat(Stat.SPD));
  }
}

function queueClowningAroundStartOfBattleEffects(battlePlayers: PlayerIndex[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const blacephalonBattlerIndex = battlePlayers.length > 2 ? BattlerIndex.ENEMY_3 : BattlerIndex.ENEMY_2;
  encounter.startOfBattleEffects.push(
    {
      sourceBattlerIndex: BattlerIndex.ENEMY,
      targets: [blacephalonBattlerIndex],
      move: new PokemonMove(MoveId.ROLE_PLAY),
      useMode: MoveUseMode.IGNORE_PP,
    },
    {
      sourceBattlerIndex: blacephalonBattlerIndex,
      targets: [BattlerIndex.PLAYER],
      move: new PokemonMove(MoveId.TAUNT),
      useMode: MoveUseMode.IGNORE_PP,
    },
    ...battlePlayers.slice(1).map((_playerIndex, fieldIndex) => ({
      sourceBattlerIndex: blacephalonBattlerIndex,
      targets: [globalScene.getPlayerBattlerIndex(fieldIndex + 1)],
      move: new PokemonMove(MoveId.TAUNT),
      useMode: MoveUseMode.IGNORE_PP,
    })),
  );
}

function createMrMimeEnemyConfig(): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(SpeciesId.MR_MIME),
    isBoss: true,
    moveSet: [MoveId.TEETER_DANCE, MoveId.ALLY_SWITCH, MoveId.DAZZLING_GLEAM, MoveId.PSYCHIC],
  };
}

function createClowningAroundBattleConfig(battlePlayers: PlayerIndex[]): EnemyPartyConfig {
  const config = globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0];
  if (battlePlayers.length <= 2) {
    return config;
  }

  const [firstMrMimeConfig, blacephalonConfig] = config.pokemonConfigs ?? [];
  if (!firstMrMimeConfig || !blacephalonConfig) {
    return config;
  }

  return {
    ...config,
    pokemonConfigs: [
      firstMrMimeConfig,
      {
        ...createMrMimeEnemyConfig(),
        fieldPosition: FieldPosition.RIGHT,
      },
      {
        ...blacephalonConfig,
        fieldPosition: FieldPosition.CENTER,
      },
    ],
  };
}

async function runMultiplayerClowningAroundChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getClowningAroundData();
  const choices = data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battlePlayers: PlayerIndex[] = [];

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterDialogue(`${namespace}:option.${choice.optionIndex}.selected`, `${namespace}:speaker`);

    if (choice.optionIndex === 1) {
      setEncounterRewards({ fillRemaining: true }, undefined, undefined, choice.playerIndex);
      battlePlayers.push(choice.playerIndex);
      continue;
    }

    if (choice.optionIndex === 2) {
      applyClowningAroundItemShuffle(choice.playerIndex);
      await showEncounterText(`${namespace}:option.2.selected2`);
      await showEncounterDialogue(`${namespace}:option.2.selected3`, `${namespace}:speaker`);
      continue;
    }

    applyClowningAroundTypeShuffle(choice.playerIndex);
    await showEncounterText(`${namespace}:option.3.selected2`);
    await showEncounterDialogue(`${namespace}:option.3.selected3`, `${namespace}:speaker`);
  }

  data.battlePlayers = battlePlayers;
  if (battlePlayers.length === 0) {
    leaveEncounterWithoutBattle(true);
    return true;
  }

  globalScene.waitForPlayerInput(battlePlayers[0]);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  queueClowningAroundStartOfBattleEffects(battlePlayers);
  await transitionMysteryEncounterIntroVisuals();
  await hideClowningAroundNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createClowningAroundBattleConfig(battlePlayers));
  return true;
}

async function runOnePlayerClowningAroundBattle(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  setEncounterRewards({ fillRemaining: true });
  getClowningAroundData().battlePlayers = [globalScene.activePlayerIndex];
  queueClowningAroundStartOfBattleEffects([globalScene.activePlayerIndex]);

  await transitionMysteryEncounterIntroVisuals();
  await initBattleWithEnemyConfig(createClowningAroundBattleConfig([globalScene.activePlayerIndex]));
}

function buildClowningAroundBattleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
          speaker: `${namespace}:speaker`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeClowningAroundChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerClowningAroundChoices() : runOnePlayerClowningAroundBattle(),
    )
    .withPostOptionPhase(runClowningAroundPostOptionPhase)
    .build();
}

function buildClowningAroundItemShuffleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
          speaker: `${namespace}:speaker`,
        },
        {
          text: `${namespace}:option.2.selected2`,
        },
        {
          text: `${namespace}:option.2.selected3`,
          speaker: `${namespace}:speaker`,
        },
      ],
    })
    .withPreOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return storeClowningAroundChoice(2, playerIndex);
      }

      applyClowningAroundItemShuffle(playerIndex);
      return true;
    })
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerClowningAroundChoices() : leaveEncounterWithoutBattle(true),
    )
    .withPostOptionPhase(runClowningAroundPostOptionPhase)
    .build();
}

function buildClowningAroundTypeShuffleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
          speaker: `${namespace}:speaker`,
        },
        {
          text: `${namespace}:option.3.selected2`,
        },
        {
          text: `${namespace}:option.3.selected3`,
          speaker: `${namespace}:speaker`,
        },
      ],
    })
    .withPreOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return storeClowningAroundChoice(3, playerIndex);
      }

      applyClowningAroundTypeShuffle(playerIndex);
      return true;
    })
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerClowningAroundChoices() : leaveEncounterWithoutBattle(true),
    )
    .withPostOptionPhase(runClowningAroundPostOptionPhase)
    .build();
}

function buildClowningAroundPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildClowningAroundBattleOption(playerIndex),
    buildClowningAroundItemShuffleOption(playerIndex),
    buildClowningAroundTypeShuffleOption(playerIndex),
  ];
}

/**
 * Clowning Around encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3807 | GitHub Issue #3807}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const ClowningAroundEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.CLOWNING_AROUND,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withDisallowedChallenges(Challenges.SINGLE_TYPE)
  .withSceneWaveRangeRequirement(80, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withAnimations(EncounterAnim.SMOKESCREEN)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.MR_MIME,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      x: -25,
      tint: 0.3,
      y: -3,
      yShadow: -3,
    },
    {
      species: SpeciesId.BLACEPHALON,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      x: 25,
      tint: 0.3,
      y: -3,
      yShadow: -3,
    },
    {
      spriteKey: "harlequin",
      fileRoot: "trainer",
      hasShadow: true,
      x: 0,
      y: 2,
      yShadow: 2,
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
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    const clownTrainerType = TrainerType.HARLEQUIN;
    const clownConfig = trainerConfigs[clownTrainerType].clone();
    const clownPartyTemplate = new TrainerPartyCompoundTemplate(
      new TrainerPartyTemplate(1, PartyMemberStrength.STRONG),
      new TrainerPartyTemplate(1, PartyMemberStrength.STRONGER),
    );
    clownConfig.setPartyTemplates(clownPartyTemplate);
    clownConfig.setDoubleOnly();
    // @ts-expect-error
    clownConfig.partyTemplateFunc = null; // Overrides party template func if it exists

    // Generate random ability for Blacephalon from pool
    // TODO: should this use `randSeedItem`?
    const ability = RANDOM_ABILITY_POOL[randSeedInt(RANDOM_ABILITY_POOL.length)];
    encounter.setDialogueToken("ability", allAbilities[ability].name);
    encounter.misc = { ability };

    // Decide the random types for Blacephalon. They should not be the same.
    const firstType: number = randSeedInt(18);
    let secondType: number = randSeedInt(17);
    if (secondType >= firstType) {
      secondType++;
    }

    encounter.enemyPartyConfigs.push({
      trainerConfig: clownConfig,
      pokemonConfigs: [
        // Overrides first 2 pokemon to be Mr. Mime and Blacephalon
        createMrMimeEnemyConfig(),
        {
          // Blacephalon has the random ability from pool, and 2 entirely random types to fit with the theme of the encounter
          species: getPokemonSpecies(SpeciesId.BLACEPHALON),
          customPokemonData: new CustomPokemonData({
            ability,
            types: [firstType, secondType],
          }),
          isBoss: true,
          moveSet: [MoveId.TRICK, MoveId.HYPNOSIS, MoveId.SHADOW_BALL, MoveId.MIND_BLOWN],
        },
      ],
      doubleBattle: true,
    });

    // Load animations/sfx for start of fight moves
    loadCustomMovesForEncounter([MoveId.ROLE_PLAY, MoveId.TAUNT]);

    encounter.setDialogueToken("blacephalonName", getPokemonSpecies(SpeciesId.BLACEPHALON).getName());

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildClowningAroundBattleOption(0))
  .withOption(buildClowningAroundItemShuffleOption(0))
  .withOption(buildClowningAroundTypeShuffleOption(0))
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();

async function runClowningAroundPostOptionPhase(): Promise<boolean> {
  const data = getClowningAroundData();
  for (const playerIndex of data.battlePlayers) {
    globalScene.waitForPlayerInput(playerIndex);
    const abilityWasSwapped = await handleSwapAbility(playerIndex);
    if (abilityWasSwapped) {
      await showEncounterText(`${namespace}:option.1.abilityGained`);
    }
  }

  if (data.battlePlayers.length > 0) {
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "+=16",
      y: "-=16",
      alpha: 0,
      ease: "Sine.easeInOut",
      duration: 250,
    });
  }

  const background = new EncounterBattleAnim(
    EncounterAnim.SMOKESCREEN,
    globalScene.getPlayerPokemon()!,
    globalScene.getPlayerPokemon(),
  );
  background.playWithoutTargets(230, 40, 2);

  if (data.battlePlayers.length === 0) {
    await transitionMysteryEncounterIntroVisuals(true, true, 200);
  }

  globalScene.waitForPlayerInput(0);
  return true;
}

async function handleSwapAbility(playerIndex: PlayerIndex) {
  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    return handleComputerPartnerSwapAbility(playerIndex);
  }

  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: TODO: Consider refactoring to avoid async promise executor
  return new Promise<boolean>(async resolve => {
    globalScene.waitForPlayerInput(playerIndex);
    await showEncounterDialogue(`${namespace}:option.1.applyAbilityDialogue`, `${namespace}:speaker`);
    await showEncounterText(`${namespace}:option.1.applyAbilityMessage`);

    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      displayYesNoOptions(resolve, playerIndex);
    });
  });
}

async function handleComputerPartnerSwapAbility(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.waitForPlayerInput(0);
  await showEncounterDialogue(`${namespace}:option.1.applyAbilityDialogue`, `${namespace}:speaker`);

  const chosenPokemon = chooseComputerPartnerAbilityPokemon(playerIndex);
  if (!chosenPokemon) {
    const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
    globalScene.phaseManager.queueMessage(`${profile.name}: Passed on ${allAbilities[getClowningAroundData().ability].name}.`, null, true);
    return false;
  }

  applyAbilityOverrideToPokemon(chosenPokemon, getClowningAroundData().ability);
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("chosenPokemon", chosenPokemon.getNameToRender());
  return true;
}

function displayYesNoOptions(resolve: (value: boolean) => void, playerIndex: PlayerIndex) {
  globalScene.waitForPlayerInput(playerIndex);
  showEncounterText(`${namespace}:option.1.abilityPrompt`, null, 500, false);
  const fullOptions = [
    {
      label: i18next.t("menu:yes"),
      handler: () => {
        onYesAbilitySwap(resolve, playerIndex);
        return true;
      },
    },
    {
      label: i18next.t("menu:no"),
      handler: () => {
        resolve(false);
        return true;
      },
    },
  ];

  const config: OptionSelectConfig = {
    options: fullOptions,
    maxOptions: 7,
    yOffset: 0,
  };
  globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config, null, true);
}

function onYesAbilitySwap(resolve: (value: boolean) => void, playerIndex: PlayerIndex) {
  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    // Do ability swap
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    applyAbilityOverrideToPokemon(pokemon, getClowningAroundData().ability);
    encounter.setDialogueToken("chosenPokemon", pokemon.getNameToRender());
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => resolve(true));
  };

  const onPokemonNotSelected = () => {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      displayYesNoOptions(resolve, playerIndex);
    });
  };

  globalScene.waitForPlayerInput(playerIndex);
  selectPokemonForOption(onPokemonSelected, onPokemonNotSelected);
}

function generateItemsOfTier(
  pokemon: PlayerPokemon,
  numItems: number,
  tier: ModifierTier | "Berries",
  playerIndex: PlayerIndex = globalScene.activePlayerIndex,
) {
  // These pools have to be defined at runtime so that modifierTypes exist
  // Pools have instances of the modifier type equal to the max stacks that modifier can be applied to any one pokemon
  // This is to prevent "over-generating" a random item of a certain type during item swaps
  const ultraPool = [
    [modifierTypes.REVIVER_SEED, 1],
    [modifierTypes.GOLDEN_PUNCH, 5],
    [modifierTypes.ATTACK_TYPE_BOOSTER, 99],
    [modifierTypes.QUICK_CLAW, 3],
    [modifierTypes.WIDE_LENS, 3],
  ];

  const roguePool = [
    [modifierTypes.LEFTOVERS, 4],
    [modifierTypes.SHELL_BELL, 4],
    [modifierTypes.SOUL_DEW, 10],
    [modifierTypes.SCOPE_LENS, 1],
    [modifierTypes.BATON, 1],
    [modifierTypes.FOCUS_BAND, 5],
    [modifierTypes.KINGS_ROCK, 3],
    [modifierTypes.GRIP_CLAW, 5],
  ];

  const berryPool = [
    [BerryType.APICOT, 3],
    [BerryType.ENIGMA, 2],
    [BerryType.GANLON, 3],
    [BerryType.LANSAT, 3],
    [BerryType.LEPPA, 2],
    [BerryType.LIECHI, 3],
    [BerryType.LUM, 2],
    [BerryType.PETAYA, 3],
    [BerryType.SALAC, 2],
    [BerryType.SITRUS, 2],
    [BerryType.STARF, 3],
  ];

  let pool: any[];
  if (tier === "Berries") {
    pool = berryPool;
  } else {
    pool = tier === ModifierTier.ULTRA ? ultraPool : roguePool;
  }

  for (let i = 0; i < numItems; i++) {
    if (pool.length === 0) {
      // Stop generating new items if somehow runs out of items to spawn
      return;
    }
    const randIndex = randSeedInt(pool.length);
    const newItemType = pool[randIndex];
    let newMod: PokemonHeldItemModifierType;
    if (tier === "Berries") {
      newMod = generateModifierType(modifierTypes.BERRY, [newItemType[0]]) as PokemonHeldItemModifierType;
    } else {
      newMod = generateModifierType(newItemType[0]) as PokemonHeldItemModifierType;
    }
    globalScene.setActivePlayerIndex(playerIndex);
    applyModifierTypeToPlayerPokemon(pokemon, newMod);
    // Decrement max stacks and remove from pool if at max
    newItemType[1]--;
    if (newItemType[1] <= 0) {
      pool.splice(randIndex, 1);
    }
  }
}
