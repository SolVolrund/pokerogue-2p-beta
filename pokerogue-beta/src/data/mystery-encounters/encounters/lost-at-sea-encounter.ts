import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { CanLearnMoveRequirement } from "#mystery-encounters/can-learn-move-requirement";
import { PokemonMove } from "#moves/pokemon-move";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle, setEncounterExp } from "#mystery-encounters/encounter-phase-utils";
import { applyDamageToPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const OPTION_1_REQUIRED_MOVE = MoveId.SURF;
const OPTION_2_REQUIRED_MOVE = MoveId.FLY;
/**
 * Damage percentage taken when wandering aimlessly.
 * Can be a number between `0` - `100`.
 * The higher the more damage taken (100% = instant KO).
 */
const DAMAGE_PERCENTAGE: number = 25;
/** The i18n namespace for the encounter */
const namespace = "mysteryEncounters/lostAtSea";

type LostAtSeaOptionIndex = 1 | 2 | 3;

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

class ActivePlayerCanLearnMoveRequirement extends EncounterPokemonRequirement {
  private readonly moveRequirement: CanLearnMoveRequirement;
  private readonly requiredMove: MoveId;

  constructor(requiredMove: MoveId) {
    super();
    this.requiredMove = requiredMove;
    this.moveRequirement = new CanLearnMoveRequirement(requiredMove);
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryActivePlayerParty().length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.queryActivePlayerParty();
  }

  override getDialogueToken(_pokemon?: PlayerPokemon): [string, string] {
    return ["requiredMoves", new PokemonMove(this.requiredMove).getName()];
  }

  private queryActivePlayerParty(): PlayerPokemon[] {
    return this.moveRequirement.queryParty(
      globalScene.getPlayerParty(globalScene.activePlayerIndex).filter(pokemon => pokemon.isAllowedInBattle()),
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
  return undefined;
}

function storeLostAtSeaChoice(optionIndex: LostAtSeaOptionIndex): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const data = getLostAtSeaData();
  const playerIndex = data.selectingPlayerIndex ?? 0;
  const guidePokemon = getChoiceGuidePokemon(playerIndex, optionIndex);
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({
    playerIndex,
    optionIndex,
    ...(guidePokemon ? { guidePokemon } : {}),
  });

  if (playerIndex === 0) {
    data.selectingPlayerIndex = 1;
    globalScene.setActivePlayerIndex(1);
    updateWindowType(2);
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: "Player 2",
      overrideQuery: "What will you do?",
      startingCursorIndex: optionIndex - 1,
    });
    return false;
  }

  delete data.selectingPlayerIndex;
  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function runTwoPlayerLostAtSeaChoices(): Promise<boolean> {
  const data = getLostAtSeaData();
  const laprasSpecies = getPokemonSpecies(SpeciesId.LAPRAS);

  for (const choice of data.choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);

    if (choice.optionIndex === 3) {
      await showEncounterText(`${namespace}:option.3.selected`);
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

  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  leaveEncounterWithoutBattle();
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

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    // Option 1: Use a (non fainted) pokemon that can learn Surf to guide you back/
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withPrimaryPokemonRequirement(new ActivePlayerCanLearnMoveRequirement(OPTION_1_REQUIRED_MOVE))
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        disabledButtonLabel: `${namespace}:option.1.labelDisabled`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        disabledButtonTooltip: `${namespace}:option.1.tooltipDisabled`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      })
      .withPreOptionPhase(async () => storeLostAtSeaChoice(1))
      .withOptionPhase(async () =>
        globalScene.twoPlayerMode ? runTwoPlayerLostAtSeaChoices() : handlePokemonGuidingYouPhase(),
      )
      .build(),
  )
  .withOption(
    //Option 2: Use a (non fainted) pokemon that can learn fly to guide you back.
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withPrimaryPokemonRequirement(new ActivePlayerCanLearnMoveRequirement(OPTION_2_REQUIRED_MOVE))
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        disabledButtonLabel: `${namespace}:option.2.labelDisabled`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        disabledButtonTooltip: `${namespace}:option.2.tooltipDisabled`,
        selected: [
          {
            text: `${namespace}:option.2.selected`,
          },
        ],
      })
      .withPreOptionPhase(async () => storeLostAtSeaChoice(2))
      .withOptionPhase(async () =>
        globalScene.twoPlayerMode ? runTwoPlayerLostAtSeaChoices() : handlePokemonGuidingYouPhase(),
      )
      .build(),
  )
  .withOption(
    // Option 3: Wander aimlessly
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        selected: [
          {
            text: `${namespace}:option.3.selected`,
          },
        ],
      })
      .withPreOptionPhase(async () => storeLostAtSeaChoice(3))
      .withOptionPhase(async () => {
        if (globalScene.twoPlayerMode) {
          return runTwoPlayerLostAtSeaChoices();
        }

        applyLostAtSeaWanderDamage();
        leaveEncounterWithoutBattle();
        return true;
      })
      .build(),
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
