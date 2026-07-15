import type { PlayerIndex } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { AiType } from "#enums/ai-type";
import { BattlerIndex } from "#enums/battler-index";
import { BerryType } from "#enums/berry-type";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  handleMysteryEncounterBattleFailed,
  handleMysteryEncounterVictory,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { trainerConfigs } from "#trainers/trainer-config";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const namespace = "mysteryEncounters/pokePoachers";

type PokePoachersOptionIndex = 1 | 2;

interface PokePoachersScenario {
  protectedSpeciesId: SpeciesId.LATIAS | SpeciesId.LATIOS;
  poacherTrainerTypes: TrainerType[];
}

interface PokePoachersChoice {
  playerIndex: PlayerIndex;
  optionIndex: PokePoachersOptionIndex;
}

interface PokePoachersData {
  scenario: PokePoachersScenario;
  choices?: PokePoachersChoice[];
  battlePlayerIndexes?: PlayerIndex[];
  declined?: boolean;
  rescueActive?: boolean;
  rewardEligible?: boolean;
  rewardQueued?: boolean;
  protectedLegendaryId?: number;
  protectedLegendaryPartyIndex?: number;
  poacherPokemonIds?: number[];
  skipSelectedDialogueOnce?: boolean;
}

const PROTECTED_LEGENDARIES = [SpeciesId.LATIAS, SpeciesId.LATIOS] as const;

const LATIAS_MOVES = [MoveId.RECOVER, MoveId.WISH, MoveId.MIST_BALL, MoveId.PROTECT] as const;
const LATIOS_MOVES = [MoveId.RECOVER, MoveId.PROTECT, MoveId.LUSTER_PURGE, MoveId.CHILLING_WATER] as const;

export const PokePoachersEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.POKE_POACHERS,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withMaxAllowedEncounters(1)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const playerIndexes = getMysteryEncounterPlayerIndexes();
    const protectedSpeciesId = randSeedItem(PROTECTED_LEGENDARIES);
    const poacherTrainerTypes =
      playerIndexes.length > 2
        ? [TrainerType.ANNIE, TrainerType.OAKLEY]
        : [randSeedItem([TrainerType.ANNIE, TrainerType.OAKLEY])];
    const scenario = {
      protectedSpeciesId,
      poacherTrainerTypes,
    } satisfies PokePoachersScenario;

    encounter.misc = {
      scenario,
      choices: [],
      rescueActive: false,
      rewardEligible: false,
    } satisfies PokePoachersData;
    encounter.onPokemonFaint = handlePokePoachersFaint;
    encounter.onRewards = applyPokePoachersRewards;
    encounter.spriteConfigs = buildPokePoachersIntroSpriteConfigs(scenario);
    setPokePoachersDialogueTokens(scenario);

    loadCustomMovesForEncounter([MoveId.TOXIC, MoveId.STICKY_WEB]);
    return true;
  })
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildPokePoachersOption(1))
  .withOption(buildPokePoachersOption(2))
  .build();

function getPokePoachersData(): PokePoachersData {
  return globalScene.currentBattle.mysteryEncounter!.misc as PokePoachersData;
}

function getPokePoachersVotingPlayerIndexes(): PlayerIndex[] {
  const playerIndexes = getMysteryEncounterPlayerIndexes();
  const humanPlayerIndexes = playerIndexes.filter(playerIndex => !globalScene.isComputerPartnerPlayer(playerIndex));
  return humanPlayerIndexes.length > 0 ? humanPlayerIndexes : playerIndexes;
}

function buildPokePoachersOption(optionIndex: PokePoachersOptionIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
      selected: [
        {
          text: `${namespace}:option.${optionIndex}.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storePokePoachersChoice(optionIndex, 0))
    .withOptionPhase(runPokePoachersChoices)
    .build();
}

function buildPokePoachersPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildPokePoachersOptionForPlayer(1, playerIndex),
    buildPokePoachersOptionForPlayer(2, playerIndex),
  ];
}

function buildPokePoachersOptionForPlayer(
  optionIndex: PokePoachersOptionIndex,
  playerIndex: PlayerIndex,
): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
      selected: [
        {
          text: `${namespace}:option.${optionIndex}.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storePokePoachersChoice(optionIndex, playerIndex))
    .withOptionPhase(runPokePoachersChoices)
    .build();
}

async function storePokePoachersChoice(
  optionIndex: PokePoachersOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  const data = getPokePoachersData();
  data.choices = (data.choices ?? []).filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex, getPokePoachersVotingPlayerIndexes());
  if (nextPlayerIndex != null) {
    const result = await showMysteryEncounterPlayerMenu({
      playerIndex: nextPlayerIndex,
      slideInDescription: false,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildPokePoachersPlayerOptions(nextPlayerIndex),
      startingCursorIndex: optionIndex - 1,
    });
    return result ?? false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function runPokePoachersChoices(): Promise<boolean> {
  const data = getPokePoachersData();
  const votingPlayerIndexes = getPokePoachersVotingPlayerIndexes();
  const choices = (data.choices ?? [])
    .filter(choice => votingPlayerIndexes.includes(choice.playerIndex))
    .toSorted((a, b) => a.playerIndex - b.playerIndex);

  if (globalScene.twoPlayerMode) {
    for (const choice of choices) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
    }
  }

  const winningOption = await getWinningPokePoachersOption(choices);
  if (winningOption === 2) {
    data.declined = true;
    leaveEncounterWithoutBattle(false);
    return true;
  }

  await startPokePoachersBattle(getMysteryEncounterPlayerIndexes());
  return true;
}

async function getWinningPokePoachersOption(choices: PokePoachersChoice[]): Promise<PokePoachersOptionIndex> {
  if (choices.length <= 1) {
    return choices[0]?.optionIndex ?? 2;
  }

  const helpVotes = choices.filter(choice => choice.optionIndex === 1).length;
  const leaveVotes = choices.length - helpVotes;
  if (helpVotes !== leaveVotes) {
    return helpVotes > leaveVotes ? 1 : 2;
  }

  const winningPlayerIndex = globalScene.resolvePlayerTieBreak(choices.map(choice => choice.playerIndex));
  await showEncounterText(`Player ${winningPlayerIndex + 1}'s choice wins this time.`);
  return choices.find(choice => choice.playerIndex === winningPlayerIndex)?.optionIndex ?? choices[0].optionIndex;
}

async function startPokePoachersBattle(playerIndexes: PlayerIndex[]): Promise<void> {
  const data = getPokePoachersData();
  data.battlePlayerIndexes = playerIndexes;
  data.rescueActive = true;
  data.rewardEligible = false;
  data.rewardQueued = false;

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(playerIndexes);
  alignPokePoachersPlayerField(playerIndexes);
  globalScene.setActivePlayerIndex(playerIndexes[0]);
  updateWindowType(playerIndexes[0] + 1);
  await initBattleWithEnemyConfig(createPokePoachersBattleConfig(data.scenario, playerIndexes.length));

  data.protectedLegendaryPartyIndex = getProtectedLegendaryPartyIndex(data.scenario, playerIndexes.length);
  const protectedLegendary = getProtectedLegendary(data);
  if (protectedLegendary) {
    data.protectedLegendaryId = protectedLegendary.id;
  } else {
    delete data.protectedLegendaryId;
  }
  data.poacherPokemonIds = globalScene
    .getEnemyParty()
    .filter((pokemon, index) => pokemon && index !== data.protectedLegendaryPartyIndex)
    .map(pokemon => pokemon.id);

  queuePokePoachersStartOfBattleEffects(playerIndexes.length);
}

function createPokePoachersBattleConfig(scenario: PokePoachersScenario, playerCount: number): EnemyPartyConfig {
  const primaryPoacher = scenario.poacherTrainerTypes[0];
  const secondaryPoacher = scenario.poacherTrainerTypes[1];
  const pokemonConfigs = [
    createPoacherPokemonConfig(primaryPoacher, TrainerSlot.TRAINER, FieldPosition.LEFT),
  ];

  if (secondaryPoacher != null) {
    pokemonConfigs.push(createPoacherPokemonConfig(secondaryPoacher, TrainerSlot.TRAINER_PARTNER, FieldPosition.RIGHT));
  }

  pokemonConfigs.push(
    createProtectedLegendaryConfig(
      scenario.protectedSpeciesId,
      playerCount > 2 ? FieldPosition.CENTER : FieldPosition.RIGHT,
      playerCount,
    ),
  );

  return {
    trainerType: primaryPoacher,
    partnerTrainerType: secondaryPoacher,
    doubleBattle: true,
    forceDoubleBattle: true,
    disableSwitch: false,
    female: false,
    partnerFemale: false,
    pokemonConfigs,
  };
}

function createPoacherPokemonConfig(
  trainerType: TrainerType,
  trainerSlot: TrainerSlot,
  fieldPosition: FieldPosition,
): EnemyPokemonConfig {
  const speciesId = trainerType === TrainerType.ANNIE ? SpeciesId.GLIMMORA : SpeciesId.ARIADOS;
  return {
    species: getPokemonSpecies(speciesId),
    isBoss: false,
    aiType: AiType.SMART,
    trainerSlot,
    fieldPosition,
  };
}

function createProtectedLegendaryConfig(
  protectedSpeciesId: SpeciesId.LATIAS | SpeciesId.LATIOS,
  fieldPosition: FieldPosition,
  playerCount: number,
): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(protectedSpeciesId),
    isBoss: false,
    aiType: AiType.SMART,
    trainerSlot: TrainerSlot.NONE,
    fieldPosition,
    moveSet: protectedSpeciesId === SpeciesId.LATIAS ? [...LATIAS_MOVES] : [...LATIOS_MOVES],
    modifierConfigs: [
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.SITRUS]) as PokemonHeldItemModifierType,
        stackCount: playerCount > 2 ? 2 : 1,
        isTransferable: false,
      },
    ],
  };
}

function getProtectedLegendaryPartyIndex(scenario?: PokePoachersScenario, playerCount?: number): number {
  return (playerCount ?? 0) > 2 && scenario?.poacherTrainerTypes[1] != null ? 2 : 1;
}

function getProtectedLegendary(data: PokePoachersData): Pokemon | undefined {
  if (data.protectedLegendaryId != null) {
    const protectedLegendary = globalScene.getEnemyParty().find(pokemon => pokemon.id === data.protectedLegendaryId);
    if (protectedLegendary) {
      return protectedLegendary;
    }
  }

  const partyIndex = data.protectedLegendaryPartyIndex ?? getProtectedLegendaryPartyIndex(data.scenario, data.battlePlayerIndexes?.length);
  return globalScene.getEnemyParty()[partyIndex];
}

function getActivePoacherPokemon(data: PokePoachersData): Pokemon[] {
  const poacherPokemonIds = data.poacherPokemonIds ?? [];
  return globalScene
    .getEnemyField()
    .filter(pokemon => !!pokemon && poacherPokemonIds.includes(pokemon.id) && pokemon.isActive(false));
}

function queuePokePoachersStartOfBattleEffects(playerCount: number): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getPokePoachersData();
  const protectedLegendary = getProtectedLegendary(data);
  if (!protectedLegendary) {
    return;
  }

  const activePoachers = getActivePoacherPokemon(data);
  for (const poacher of activePoachers) {
    encounter.startOfBattleEffects.push({
      sourcePokemon: poacher,
      targets: [protectedLegendary.getBattlerIndex()],
      move: new PokemonMove(MoveId.TOXIC),
      useMode: MoveUseMode.IGNORE_PP,
    });
  }

  if (playerCount <= 2) {
    return;
  }

  const stickyWebTarget = globalScene.getPlayerField().find(pokemon => pokemon?.isActive(false))?.getBattlerIndex()
    ?? BattlerIndex.PLAYER;
  for (const poacher of activePoachers) {
    encounter.startOfBattleEffects.push({
      sourcePokemon: poacher,
      targets: [stickyWebTarget],
      move: new PokemonMove(MoveId.STICKY_WEB),
      useMode: MoveUseMode.IGNORE_PP,
    });
  }
}

function handlePokePoachersFaint(pokemon: Pokemon): boolean {
  const data = getPokePoachersData();
  if (!data.rescueActive || !pokemon.isEnemy()) {
    return false;
  }

  if (pokemon.id === data.protectedLegendaryId) {
    finishPokePoachersBattle(false);
    return true;
  }

  if (!(data.poacherPokemonIds ?? []).includes(pokemon.id)) {
    return false;
  }

  if (!hasRemainingPoacherPokemon(data, pokemon.id) && isProtectedLegendaryStillStanding(data)) {
    finishPokePoachersBattle(true);
  }

  return false;
}

function hasRemainingPoacherPokemon(data: PokePoachersData, faintingPokemonId?: number): boolean {
  const poacherPokemonIds = data.poacherPokemonIds ?? [];
  return globalScene
    .getEnemyParty()
    .some(pokemon =>
      poacherPokemonIds.includes(pokemon.id)
      && pokemon.id !== faintingPokemonId
      && !pokemon.isFainted(true)
      && pokemon.hp > 0,
    );
}

function isProtectedLegendaryStillStanding(data: PokePoachersData): boolean {
  const protectedLegendary = getProtectedLegendary(data);
  return !!protectedLegendary && !protectedLegendary.isFainted(true) && protectedLegendary.hp > 0;
}

function finishPokePoachersBattle(success: boolean): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getPokePoachersData();
  if (!data.rescueActive) {
    return;
  }

  data.rescueActive = false;
  data.rewardEligible = success;
  encounter.onPokemonFaint = undefined;
  encounter.dialogue.outro = [
    {
      text: success ? `${namespace}:outro.success` : `${namespace}:outro.failed`,
    },
  ];

  globalScene.phaseManager.clearPhaseQueue(true);
  if (success) {
    queuePokePoachersRewards(data);
    handleMysteryEncounterVictory(false);
  } else {
    handleMysteryEncounterBattleFailed(false);
  }
}

function queuePokePoachersRewards(data: PokePoachersData): void {
  if (data.rewardQueued) {
    return;
  }

  data.rewardQueued = true;
  for (const playerIndex of data.battlePlayerIndexes ?? getMysteryEncounterPlayerIndexes()) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.EON_FLUTE],
        fillRemaining: true,
      },
      undefined,
      undefined,
      playerIndex,
    );
  }
}

async function applyPokePoachersRewards(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getPokePoachersData();
  encounter.onRewards = undefined;

  data.rescueActive = false;
  delete data.poacherPokemonIds;
  delete data.protectedLegendaryId;

  if (data.declined) {
    encounter.dialogue.outro = [];
    return;
  }

  encounter.dialogue.outro = [
    {
      text: data.rewardEligible ? `${namespace}:outro.success` : `${namespace}:outro.failed`,
    },
  ];
}

function alignPokePoachersPlayerField(playerIndexes: PlayerIndex[]): void {
  const fieldPositions = getPokePoachersPlayerFieldPositions(playerIndexes.length);
  playerIndexes.forEach((playerIndex, fieldIndex) => {
    const pokemon = globalScene.getPlayerParty(playerIndex)[0];
    if (!pokemon?.isOnField()) {
      return;
    }

    const fieldPosition = fieldPositions[fieldIndex] ?? FieldPosition.CENTER;
    pokemon.setFieldPosition(fieldPosition, 0);
    const [offsetX, offsetY] = pokemon.getFieldPositionOffset();
    pokemon.setPosition(106 + offsetX, 148 + offsetY);
  });
}

function getPokePoachersPlayerFieldPositions(playerCount: number): FieldPosition[] {
  return playerCount > 2
    ? [FieldPosition.LEFT, FieldPosition.CENTER, FieldPosition.RIGHT]
    : playerCount > 1
      ? [FieldPosition.LEFT, FieldPosition.RIGHT]
      : [FieldPosition.CENTER];
}

function buildPokePoachersIntroSpriteConfigs(scenario: PokePoachersScenario) {
  const trainerOffsets = scenario.poacherTrainerTypes.length > 1 ? [-48, 48] : [42];
  const trainerSprites = scenario.poacherTrainerTypes.map((trainerType, index) => ({
    spriteKey: trainerConfigs[trainerType].getSpriteKey(),
    fileRoot: "trainer",
    hasShadow: true,
    disableAnimation: true,
    x: trainerOffsets[index] ?? 0,
    y: 4,
    yShadow: 4,
  }));

  return [
    {
      spriteKey: "",
      fileRoot: "pokemon",
      species: scenario.protectedSpeciesId,
      hasShadow: true,
      x: scenario.poacherTrainerTypes.length > 1 ? 0 : -32,
      y: -3,
      yShadow: -3,
      isPokemon: true,
    },
    ...trainerSprites,
  ];
}

function setPokePoachersDialogueTokens(scenario: PokePoachersScenario): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("legendaryPokemon", getPokemonSpecies(scenario.protectedSpeciesId).getName());
  encounter.setDialogueToken(
    "poachers",
    scenario.poacherTrainerTypes.map(trainerType => trainerConfigs[trainerType].name).join(" and "),
  );
}
