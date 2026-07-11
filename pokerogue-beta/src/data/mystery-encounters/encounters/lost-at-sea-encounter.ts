import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { CanLearnMoveRequirement } from "#mystery-encounters/can-learn-move-requirement";
import { PokemonMove } from "#moves/pokemon-move";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle, setEncounterExp } from "#mystery-encounters/encounter-phase-utils";
import { applyDamageToPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import {
  getMysteryEncounterPlayerTitle,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const OPTION_1_REQUIRED_MOVE = MoveId.SURF;
const OPTION_2_REQUIRED_MOVE = MoveId.FLY;
const SECRET_ROUTE_BIOME = BiomeId.ALTO_MARE;
const SECRET_ROUTE_SPECIES = new Set<SpeciesId>([SpeciesId.TOTODILE, SpeciesId.CROCONAW, SpeciesId.FERALIGATR]);
/**
 * Damage percentage taken when wandering aimlessly.
 * Can be a number between `0` - `100`.
 * The higher the more damage taken (100% = instant KO).
 */
const DAMAGE_PERCENTAGE: number = 25;
/** The i18n namespace for the encounter */
const namespace = "mysteryEncounters/lostAtSea";

type LostAtSeaOptionIndex = 1 | 2 | 3 | 4;

interface LostAtSeaChoice {
  playerIndex: PlayerIndex;
  optionIndex: LostAtSeaOptionIndex;
  guidePokemon?: PlayerPokemon;
}

interface LostAtSeaData {
  choices: LostAtSeaChoice[];
  selectingPlayerIndex?: PlayerIndex;
  skipSelectedDialogueOnce?: boolean;
}

class PlayerCanLearnMoveRequirement extends EncounterPokemonRequirement {
  private readonly moveRequirement: CanLearnMoveRequirement;
  private readonly playerIndex: PlayerIndex | undefined;
  private readonly requiredMove: MoveId;

  constructor(requiredMove: MoveId, playerIndex?: PlayerIndex) {
    super();
    this.requiredMove = requiredMove;
    this.playerIndex = playerIndex;
    this.moveRequirement = new CanLearnMoveRequirement(requiredMove);
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryPlayerParty().length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.queryPlayerParty();
  }

  override getDialogueToken(_pokemon?: PlayerPokemon): [string, string] {
    return ["requiredMoves", new PokemonMove(this.requiredMove).getName()];
  }

  private queryPlayerParty(): PlayerPokemon[] {
    const party =
      globalScene.twoPlayerMode && this.playerIndex != null
        ? globalScene.getPlayerParty(this.playerIndex)
        : globalScene.getPlayerParty();

    return this.moveRequirement.queryParty(party.filter(pokemon => pokemon.isAllowedInBattle()));
  }
}

class PlayerTotodileLineRequirement extends EncounterPokemonRequirement {
  private readonly playerIndex: PlayerIndex | undefined;

  constructor(playerIndex?: PlayerIndex) {
    super();
    this.playerIndex = playerIndex;
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryPlayerParty().length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.queryPlayerParty();
  }

  override getDialogueToken(pokemon?: PlayerPokemon): [string, string] {
    return [
      "option4PrimaryName",
      pokemon?.getNameToRender() ?? getTotodileLinePokemon(this.playerIndex ?? 0)?.getNameToRender() ?? "",
    ];
  }

  private queryPlayerParty(): PlayerPokemon[] {
    const party =
      globalScene.twoPlayerMode && this.playerIndex != null
        ? globalScene.getPlayerParty(this.playerIndex)
        : globalScene.getPlayerParty();

    return party.filter(
      pokemon =>
        pokemon.isAllowedInBattle()
        && SECRET_ROUTE_SPECIES.has(pokemon.species.speciesId),
    );
  }
}

function getLostAtSeaData(): LostAtSeaData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      selectingPlayerIndex: 0,
    } satisfies LostAtSeaData;
  }

  return encounter.misc as LostAtSeaData;
}

function getGuidePokemon(playerIndex: PlayerIndex, requiredMove: MoveId): PlayerPokemon | undefined {
  const requirement = new CanLearnMoveRequirement(requiredMove);
  return requirement.queryParty(globalScene.getPlayerParty(playerIndex).filter(pokemon => pokemon.isAllowedInBattle()))[0];
}

function getChoiceGuidePokemon(playerIndex: PlayerIndex, optionIndex: LostAtSeaOptionIndex): PlayerPokemon | undefined {
  if (optionIndex === 1) {
    return getGuidePokemon(playerIndex, OPTION_1_REQUIRED_MOVE);
  }
  if (optionIndex === 2) {
    return getGuidePokemon(playerIndex, OPTION_2_REQUIRED_MOVE);
  }
  if (optionIndex === 4) {
    return getTotodileLinePokemon(playerIndex);
  }
  return undefined;
}

function chooseComputerPartnerLostAtSeaOption(playerIndex: PlayerIndex): LostAtSeaOptionIndex {
  if (getChoiceGuidePokemon(playerIndex, 4)) {
    return 4;
  }
  if (getChoiceGuidePokemon(playerIndex, 1)) {
    return 1;
  }
  if (getChoiceGuidePokemon(playerIndex, 2)) {
    return 2;
  }
  return 3;
}

function getLostAtSeaTrainerDisplayName(playerIndex: PlayerIndex): string {
  return globalScene.isComputerPartnerPlayer(playerIndex)
    ? getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex)).name
    : getMysteryEncounterPlayerTitle(playerIndex);
}

function queueComputerPartnerLostAtSeaChoiceMessage(playerIndex: PlayerIndex, optionIndex: LostAtSeaOptionIndex): void {
  const guidePokemon = getChoiceGuidePokemon(playerIndex, optionIndex);
  if (!guidePokemon) {
    return;
  }

  const actionText =
    optionIndex === 1
      ? "pushed"
      : optionIndex === 2
        ? "helped guide"
        : "tugged";
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(
    optionIndex === 4
      ? `${guidePokemon.getNameToRender()} ${actionText} ${getLostAtSeaTrainerDisplayName(playerIndex)}'s boat toward a strange current.`
      : `${guidePokemon.getNameToRender()} ${actionText} ${getLostAtSeaTrainerDisplayName(playerIndex)}'s boat to shore.`,
    null,
    true,
  );
}

async function promptNextLostAtSeaPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  setLostAtSeaPlayerOptionTokens(playerIndex);
  const options = buildLostAtSeaPlayerOptions(playerIndex);
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: "What will you do?",
    overrideOptions: options,
    startingCursorIndex: Math.min(startingCursorIndex, options.length - 1),
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerLostAtSeaOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeLostAtSeaChoice(optionIndex as LostAtSeaOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

function storeLostAtSeaChoice(optionIndex: LostAtSeaOptionIndex, playerIndex: PlayerIndex = 0): boolean | Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  const data = getLostAtSeaData();
  const guidePokemon = getChoiceGuidePokemon(playerIndex, optionIndex);
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({
    playerIndex,
    optionIndex,
    ...(guidePokemon ? { guidePokemon } : {}),
  });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerLostAtSeaChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    data.selectingPlayerIndex = nextPlayerIndex;
    return promptNextLostAtSeaPlayer(nextPlayerIndex, optionIndex - 1);
  }

  delete data.selectingPlayerIndex;
  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function setLostAtSeaPlayerOptionTokens(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const surfPokemon = getChoiceGuidePokemon(playerIndex, 1);
  const flyPokemon = getChoiceGuidePokemon(playerIndex, 2);
  const totodileLinePokemon = getChoiceGuidePokemon(playerIndex, 4);

  encounter.setDialogueToken("option1PrimaryName", surfPokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("option2PrimaryName", flyPokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("option4PrimaryName", totodileLinePokemon?.getNameToRender() ?? "");
}

function buildLostAtSeaPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  const options = [
    buildLostAtSeaMoveOption(1, OPTION_1_REQUIRED_MOVE, playerIndex),
    buildLostAtSeaMoveOption(2, OPTION_2_REQUIRED_MOVE, playerIndex),
    buildLostAtSeaWanderOption(playerIndex),
  ];

  if (getTotodileLinePokemon(playerIndex)) {
    options.push(buildLostAtSeaSecretRouteOption(playerIndex));
  }

  return options;
}

function buildLostAtSeaMoveOption(
  optionIndex: 1 | 2,
  requiredMove: MoveId,
  playerIndex: PlayerIndex,
): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withPrimaryPokemonRequirement(new PlayerCanLearnMoveRequirement(requiredMove, playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      disabledButtonLabel: `${namespace}:option.${optionIndex}.labelDisabled`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
      disabledButtonTooltip: `${namespace}:option.${optionIndex}.tooltipDisabled`,
      selected: [
        {
          text: `${namespace}:option.${optionIndex}.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeLostAtSeaChoice(optionIndex, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerLostAtSeaChoices() : handlePokemonGuidingYouPhase(),
    )
    .build();
}

function buildLostAtSeaWanderOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeLostAtSeaChoice(3, playerIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerLostAtSeaChoices();
      }

      applyLostAtSeaWanderDamage();
      leaveEncounterWithoutBattle();
      return true;
    })
    .build();
}

function buildLostAtSeaSecretRouteOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerTotodileLineRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.4.label`,
      disabledButtonLabel: `${namespace}:option.4.labelDisabled`,
      buttonTooltip: `${namespace}:option.4.tooltip`,
      disabledButtonTooltip: `${namespace}:option.4.tooltipDisabled`,
      selected: [
        {
          text: `${namespace}:option.4.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeLostAtSeaChoice(4, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerLostAtSeaChoices() : handleTotodileRoutePhase(),
    )
    .build();
}

async function runTwoPlayerLostAtSeaChoices(): Promise<boolean> {
  const data = getLostAtSeaData();
  const laprasSpecies = getPokemonSpecies(SpeciesId.LAPRAS);

  if (await shouldTakeSecretRoute(data)) {
    return handleTwoPlayerTotodileRoutePhase(data);
  }

  for (const choice of data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex)) {
    globalScene.waitForPlayerInput(choice.playerIndex);

    if (choice.optionIndex === 3) {
      await showEncounterText(`${namespace}:option.3.selected`);
      applyLostAtSeaWanderDamage(choice.playerIndex);
      continue;
    }
    if (choice.optionIndex === 4) {
      const guidePokemon = choice.guidePokemon ?? getChoiceGuidePokemon(choice.playerIndex, choice.optionIndex);
      if (guidePokemon) {
        globalScene.currentBattle.mysteryEncounter!.setDialogueToken("option4PrimaryName", guidePokemon.getNameToRender());
      }
      await showEncounterText(`${namespace}:option.4.rejected`);
      applyLostAtSeaWanderDamage(choice.playerIndex);
      continue;
    }

    const guidePokemon = choice.guidePokemon ?? getChoiceGuidePokemon(choice.playerIndex, choice.optionIndex);
    if (!guidePokemon) {
      applyLostAtSeaWanderDamage(choice.playerIndex);
      continue;
    }

    globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
      `option${choice.optionIndex}PrimaryName`,
      guidePokemon.getNameToRender(),
    );
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
    setEncounterExp(guidePokemon.id, laprasSpecies.baseExp, true, choice.playerIndex);
  }

  globalScene.waitForPlayerInput(0);
  leaveEncounterWithoutBattle();
  return true;
}

async function shouldTakeSecretRoute(data: LostAtSeaData): Promise<boolean> {
  const totodileOwnerChoices = data.choices.filter(choice => getTotodileLinePokemon(choice.playerIndex));
  if (totodileOwnerChoices.length === 0) {
    return false;
  }

  const secretRouteChoices = totodileOwnerChoices.filter(choice => choice.optionIndex === 4);
  if (secretRouteChoices.length === 0) {
    return false;
  }

  const nonSecretRouteChoiceCount = totodileOwnerChoices.length - secretRouteChoices.length;
  if (secretRouteChoices.length > nonSecretRouteChoiceCount) {
    return true;
  }
  if (secretRouteChoices.length < nonSecretRouteChoiceCount) {
    return false;
  }

  const winningPlayerIndex = globalScene.resolvePlayerTieBreak(totodileOwnerChoices.map(choice => choice.playerIndex));
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
    "tieBreakPlayerName",
    getLostAtSeaTrainerDisplayName(winningPlayerIndex),
  );
  await showEncounterText(`${namespace}:option.4.tieBreak`);
  return totodileOwnerChoices.find(choice => choice.playerIndex === winningPlayerIndex)?.optionIndex === 4;
}

async function handleTwoPlayerTotodileRoutePhase(data: LostAtSeaData): Promise<boolean> {
  const laprasSpecies = getPokemonSpecies(SpeciesId.LAPRAS);
  const secretRouteChoices = data.choices
    .filter(choice => choice.optionIndex === 4)
    .toSorted((a, b) => a.playerIndex - b.playerIndex);
  const firstGuidePokemon = secretRouteChoices[0]?.guidePokemon ?? getTotodileLinePokemon(secretRouteChoices[0]?.playerIndex ?? 0);

  globalScene.waitForPlayerInput(secretRouteChoices[0]?.playerIndex ?? 0);
  if (firstGuidePokemon) {
    globalScene.currentBattle.mysteryEncounter!.setDialogueToken("option4PrimaryName", firstGuidePokemon.getNameToRender());
  }

  await showEncounterText(`${namespace}:option.4.selected`);

  for (const choice of secretRouteChoices) {
    const guidePokemon = choice.guidePokemon ?? getTotodileLinePokemon(choice.playerIndex);
    if (guidePokemon) {
      setEncounterExp(guidePokemon.id, laprasSpecies.baseExp, true, choice.playerIndex);
    }
  }

  globalScene.waitForPlayerInput(0);
  leaveEncounterWithoutBattle();
  globalScene.phaseManager.unshiftNew("SwitchBiomePhase", SECRET_ROUTE_BIOME);
  return true;
}

function applyLostAtSeaWanderDamage(playerIndex: PlayerIndex = globalScene.activePlayerIndex): void {
  const allowedPokemon = globalScene.getPlayerParty(playerIndex).filter(p => p.isAllowedInBattle());

  for (const pkm of allowedPokemon) {
    const percentage = DAMAGE_PERCENTAGE / 100;
    const damage = Math.floor(pkm.getMaxHp() * percentage);
    applyDamageToPokemon(pkm, damage);
  }
}

function getTotodileLinePokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return globalScene
    .getPlayerParty(playerIndex)
    .filter(pokemon => pokemon.isAllowedInBattle())
    .find(pokemon => SECRET_ROUTE_SPECIES.has(pokemon.species.speciesId));
}

/**
 * Lost at sea encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3793 | GitHub Issue #3793}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const LostAtSeaEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.LOST_AT_SEA,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([
    {
      spriteKey: "lost_at_sea_buoy",
      fileRoot: "mystery-encounters",
      hasShadow: false,
      x: 20,
      y: 3,
    },
  ])
  .withIntroDialogue([{ text: `${namespace}:intro` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    encounter.setDialogueToken("damagePercentage", String(DAMAGE_PERCENTAGE));
    encounter.setDialogueToken("option1RequiredMove", new PokemonMove(OPTION_1_REQUIRED_MOVE).getName());
    encounter.setDialogueToken("option2RequiredMove", new PokemonMove(OPTION_2_REQUIRED_MOVE).getName());
    setLostAtSeaPlayerOptionTokens(0);

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Option 1: Use a (non fainted) pokemon that can learn Surf to guide you back/
    buildLostAtSeaMoveOption(1, OPTION_1_REQUIRED_MOVE, 0),
  )
  .withOption(
    //Option 2: Use a (non fainted) pokemon that can learn fly to guide you back.
    buildLostAtSeaMoveOption(2, OPTION_2_REQUIRED_MOVE, 0),
  )
  .withOption(
    // Option 3: Wander aimlessly
    buildLostAtSeaWanderOption(0),
  )
  .withOption(
    // Option 4: Totodile's secret current to Alto Mare
    buildLostAtSeaSecretRouteOption(0),
  )
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();

/**
 * Generic handler for using a guiding pokemon to guide you back.
 */
function handlePokemonGuidingYouPhase() {
  const laprasSpecies = getPokemonSpecies(SpeciesId.LAPRAS);
  const { mysteryEncounter } = globalScene.currentBattle;

  if (mysteryEncounter?.selectedOption?.primaryPokemon?.id) {
    setEncounterExp(mysteryEncounter.selectedOption.primaryPokemon.id, laprasSpecies.baseExp, true);
  } else {
    console.warn("Lost at sea: No guide pokemon found but pokemon guides player. huh!?");
  }

  leaveEncounterWithoutBattle();
  return true;
}

function handleTotodileRoutePhase(): boolean {
  const laprasSpecies = getPokemonSpecies(SpeciesId.LAPRAS);
  const { mysteryEncounter } = globalScene.currentBattle;
  const guidePokemon = mysteryEncounter?.selectedOption?.primaryPokemon ?? getTotodileLinePokemon(0);

  if (guidePokemon?.id) {
    mysteryEncounter?.setDialogueToken("option4PrimaryName", guidePokemon.getNameToRender());
    setEncounterExp(guidePokemon.id, laprasSpecies.baseExp, true);
  }

  leaveEncounterWithoutBattle();
  globalScene.phaseManager.unshiftNew("SwitchBiomePhase", SECRET_ROUTE_BIOME);
  return true;
}
