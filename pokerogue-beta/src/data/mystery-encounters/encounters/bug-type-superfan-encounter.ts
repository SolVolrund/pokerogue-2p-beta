import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { allMoves, modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import {
  AttackTypeBoosterModifier,
  BypassSpeedChanceModifier,
  ContactHeldItemTransferChanceModifier,
  GigantamaxAccessModifier,
  MegaEvolutionAccessModifier,
} from "#modifiers/modifier";
import type { AttackTypeBoosterModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { getEncounterText, showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  generateModifierTypeOption,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectOptionThenPokemon,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import {
  AttackTypeBoosterHeldItemTypeRequirement,
  CombinationPokemonRequirement,
  EncounterPokemonRequirement,
  HeldItemRequirement,
  TypeRequirement,
} from "#mystery-encounters/mystery-encounter-requirements";
import { getRandomPartyMemberFunc, trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyCompoundTemplate, TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { MoveInfoOverlay } from "#ui/move-info-overlay";
import { randSeedInt, randSeedShuffle } from "#utils/common";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/bugTypeSuperfan";

const POOL_1_POKEMON = [
  SpeciesId.PARASECT,
  SpeciesId.VENOMOTH,
  SpeciesId.LEDIAN,
  SpeciesId.ARIADOS,
  SpeciesId.YANMA,
  SpeciesId.BEAUTIFLY,
  SpeciesId.DUSTOX,
  SpeciesId.MASQUERAIN,
  SpeciesId.NINJASK,
  SpeciesId.VOLBEAT,
  SpeciesId.ILLUMISE,
  SpeciesId.ANORITH,
  SpeciesId.KRICKETUNE,
  SpeciesId.WORMADAM,
  SpeciesId.MOTHIM,
  SpeciesId.SKORUPI,
  SpeciesId.JOLTIK,
  SpeciesId.LARVESTA,
  SpeciesId.VIVILLON,
  SpeciesId.CHARJABUG,
  SpeciesId.RIBOMBEE,
  SpeciesId.SPIDOPS,
  SpeciesId.LOKIX,
] as const;

const POOL_2_POKEMON = [
  SpeciesId.SCYTHER,
  SpeciesId.PINSIR,
  SpeciesId.HERACROSS,
  SpeciesId.FORRETRESS,
  SpeciesId.SCIZOR,
  SpeciesId.SHUCKLE,
  SpeciesId.SHEDINJA,
  SpeciesId.ARMALDO,
  SpeciesId.VESPIQUEN,
  SpeciesId.DRAPION,
  SpeciesId.YANMEGA,
  SpeciesId.LEAVANNY,
  SpeciesId.SCOLIPEDE,
  SpeciesId.CRUSTLE,
  SpeciesId.ESCAVALIER,
  SpeciesId.ACCELGOR,
  SpeciesId.GALVANTULA,
  SpeciesId.VIKAVOLT,
  SpeciesId.ARAQUANID,
  SpeciesId.ORBEETLE,
  SpeciesId.CENTISKORCH,
  SpeciesId.FROSMOTH,
  SpeciesId.KLEAVOR,
] as const;

const POOL_3_POKEMON = [
  { species: SpeciesId.PINSIR, formIndex: 1 },
  { species: SpeciesId.SCIZOR, formIndex: 1 },
  { species: SpeciesId.HERACROSS, formIndex: 1 },
  { species: SpeciesId.ORBEETLE, formIndex: 1 },
  { species: SpeciesId.CENTISKORCH, formIndex: 1 },
  { species: SpeciesId.DURANT } as { species: SpeciesId.DURANT; formIndex: undefined },
  { species: SpeciesId.VOLCARONA } as { species: SpeciesId.VOLCARONA; formIndex: undefined },
  { species: SpeciesId.GOLISOPOD } as { species: SpeciesId.GOLISOPOD; formIndex: undefined },
] as const;

const POOL_4_POKEMON = [SpeciesId.GENESECT, SpeciesId.SLITHER_WING, SpeciesId.BUZZWOLE, SpeciesId.PHEROMOSA] as const;

const PHYSICAL_TUTOR_MOVES = [
  MoveId.MEGAHORN,
  MoveId.ATTACK_ORDER,
  MoveId.BUG_BITE,
  MoveId.FIRST_IMPRESSION,
  MoveId.LUNGE,
] as const;

const SPECIAL_TUTOR_MOVES = [
  MoveId.SILVER_WIND,
  MoveId.SIGNAL_BEAM,
  MoveId.BUG_BUZZ,
  MoveId.POLLEN_PUFF,
  MoveId.STRUGGLE_BUG,
] as const;

const STATUS_TUTOR_MOVES = [
  MoveId.STRING_SHOT,
  MoveId.DEFEND_ORDER,
  MoveId.RAGE_POWDER,
  MoveId.STICKY_WEB,
  MoveId.SILK_TRAP,
] as const;

const MISC_TUTOR_MOVES = [
  MoveId.LEECH_LIFE,
  MoveId.U_TURN,
  MoveId.HEAL_ORDER,
  MoveId.QUIVER_DANCE,
  MoveId.INFESTATION,
] as const;

/**
 * Wave breakpoints that determine how strong to make the Bug-Type Superfan's team
 */
const WAVE_LEVEL_BREAKPOINTS = [30, 50, 70, 100, 120, 140, 160] as const;

type BugTypeSuperfanOptionIndex = 1 | 2 | 3;

interface BugTypeSuperfanChoice {
  playerIndex: PlayerIndex;
  optionIndex: BugTypeSuperfanOptionIndex;
  chosenPokemon?: PlayerPokemon;
  chosenModifier?: PokemonHeldItemModifier;
  moveTutorOptions?: PokemonMove[];
}

interface BugTypeSuperfanData {
  choices: BugTypeSuperfanChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class PlayerBugTypeSuperfanRequirement extends EncounterPokemonRequirement {
  private readonly requirement = CombinationPokemonRequirement.Some(
    new HeldItemRequirement(["BypassSpeedChanceModifier", "ContactHeldItemTransferChanceModifier"], 1),
    new AttackTypeBoosterHeldItemTypeRequirement(PokemonType.BUG, 1),
    new TypeRequirement(PokemonType.BUG, false, 1),
  );

  constructor(private readonly playerIndex?: PlayerIndex) {
    super();
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
    return this.requirement.getDialogueToken(pokemon);
  }

  private queryPlayerParty(): PlayerPokemon[] {
    if (!globalScene.twoPlayerMode || this.playerIndex != null) {
      return this.requirement.queryParty(globalScene.getPlayerParty(this.playerIndex));
    }

    return [
      ...this.requirement.queryParty(globalScene.getPlayerParty(0)),
      ...this.requirement.queryParty(globalScene.getPlayerParty(1)),
    ];
  }
}

class PlayerBugTypeRequirement extends EncounterPokemonRequirement {
  private readonly requirement = new TypeRequirement(PokemonType.BUG, false, 1);

  constructor(private readonly playerIndex: PlayerIndex) {
    super();
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryParty([]).length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.requirement.queryParty(globalScene.getPlayerParty(this.playerIndex));
  }

  override getDialogueToken(pokemon?: PlayerPokemon): [string, string] {
    return this.requirement.getDialogueToken(pokemon);
  }
}

class PlayerBugItemRequirement extends EncounterPokemonRequirement {
  private readonly requirement = CombinationPokemonRequirement.Some(
    new HeldItemRequirement(["BypassSpeedChanceModifier", "ContactHeldItemTransferChanceModifier"], 1),
    new AttackTypeBoosterHeldItemTypeRequirement(PokemonType.BUG, 1),
  );

  constructor(private readonly playerIndex: PlayerIndex) {
    super();
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryParty([]).length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.requirement.queryParty(globalScene.getPlayerParty(this.playerIndex));
  }

  override getDialogueToken(pokemon?: PlayerPokemon): [string, string] {
    return this.requirement.getDialogueToken(pokemon);
  }
}

function getBugTypeSuperfanData(): BugTypeSuperfanData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies BugTypeSuperfanData;
  }

  return encounter.misc as BugTypeSuperfanData;
}

function getBugTypeSuperfanTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

async function hideBugTypeSuperfanNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  await Promise.all(
    ([0, 1] as PlayerIndex[])
      .filter(playerIndex => !battlePlayerSet.has(playerIndex))
      .map(
        playerIndex =>
          new Promise<void>(resolve => {
            const trainerSprite = getBugTypeSuperfanTrainerSprite(playerIndex);
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

function showBugTypeSuperfanPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.waitForPlayerInput(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildBugTypeSuperfanPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function storeBugTypeSuperfanChoice(choice: BugTypeSuperfanChoice, startingCursorIndex: number): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const data = getBugTypeSuperfanData();
  data.choices = data.choices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (choice.playerIndex === 0) {
    showBugTypeSuperfanPlayerMenu(1, startingCursorIndex);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.waitForPlayerInput(0);
  return true;
}

function createBugTypeMoveTutorOptions(): PokemonMove[] {
  return [
    new PokemonMove(PHYSICAL_TUTOR_MOVES[randSeedInt(PHYSICAL_TUTOR_MOVES.length)]),
    new PokemonMove(SPECIAL_TUTOR_MOVES[randSeedInt(SPECIAL_TUTOR_MOVES.length)]),
    new PokemonMove(STATUS_TUTOR_MOVES[randSeedInt(STATUS_TUTOR_MOVES.length)]),
    new PokemonMove(MISC_TUTOR_MOVES[randSeedInt(MISC_TUTOR_MOVES.length)]),
  ];
}

async function storeBattleChoice(playerIndex: PlayerIndex): Promise<boolean> {
  const choice: BugTypeSuperfanChoice = {
    playerIndex,
    optionIndex: 1,
    moveTutorOptions: createBugTypeMoveTutorOptions(),
  };
  return storeBugTypeSuperfanChoice(choice, 0);
}

function storeShowBugTypesChoice(playerIndex: PlayerIndex): boolean {
  const choice: BugTypeSuperfanChoice = {
    playerIndex,
    optionIndex: 2,
  };
  return storeBugTypeSuperfanChoice(choice, 1);
}

async function storeGiftBugItemChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.waitForPlayerInput(playerIndex);

  let selectedChoice: BugTypeSuperfanChoice | undefined;
  const encounter = globalScene.currentBattle.mysteryEncounter!;

  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    const validItems = getValidBugItems(pokemon);

    return validItems.map((modifier: PokemonHeldItemModifier) => {
      const option: OptionSelectItem = {
        label: modifier.type.name,
        handler: () => {
          encounter.setDialogueToken("selectedItem", modifier.type.name);
          selectedChoice = {
            playerIndex,
            optionIndex: 3,
            chosenPokemon: pokemon,
            chosenModifier: modifier,
          };
          return true;
        },
      };
      return option;
    });
  };

  const selected = await selectPokemonForOption(onPokemonSelected, undefined, getBugItemSelectableFilter());
  if (!selected || !selectedChoice) {
    return false;
  }

  return storeBugTypeSuperfanChoice(selectedChoice, 2);
}

function getValidBugItems(pokemon: PlayerPokemon | Pokemon): PokemonHeldItemModifier[] {
  return pokemon.getHeldItems().filter((item): item is PokemonHeldItemModifier => {
    return (
      (item instanceof BypassSpeedChanceModifier
        || item instanceof ContactHeldItemTransferChanceModifier
        || (item instanceof AttackTypeBoosterModifier
          && (item.type as AttackTypeBoosterModifierType).moveType === PokemonType.BUG))
      && item.isTransferable
    );
  });
}

function getBugItemSelectableFilter(): (pokemon: Pokemon) => string | null {
  return (pokemon: Pokemon) => {
    if (getValidBugItems(pokemon).length === 0) {
      return getEncounterText(`${namespace}:option.3.invalidSelection`) ?? null;
    }

    return null;
  };
}

function getShowBugTypesTextKey(numBugTypes: number): string {
  if (numBugTypes < 2) {
    return `${namespace}:option.2.selected0To1`;
  }
  if (numBugTypes < 4) {
    return `${namespace}:option.2.selected2To3`;
  }
  if (numBugTypes < 6) {
    return `${namespace}:option.2.selected4To5`;
  }
  return `${namespace}:option.2.selected6`;
}

function setShowBugTypesRewards(choice: BugTypeSuperfanChoice): void {
  globalScene.waitForPlayerInput(choice.playerIndex);

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const numBugTypes = globalScene.getPlayerParty(choice.playerIndex).filter(p => p.isOfType(PokemonType.BUG)).length;
  const numBugTypesText = i18next.t(`${namespace}:numBugTypes`, {
    count: numBugTypes,
  });
  encounter.setDialogueToken("numBugTypes", numBugTypesText);

  if (numBugTypes < 2) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.SUPER_LURE, modifierTypes.GREAT_BALL],
        fillRemaining: false,
      },
      undefined,
      undefined,
      choice.playerIndex,
    );
  } else if (numBugTypes < 4) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.QUICK_CLAW, modifierTypes.MAX_LURE, modifierTypes.ULTRA_BALL],
        fillRemaining: false,
      },
      undefined,
      undefined,
      choice.playerIndex,
    );
  } else if (numBugTypes < 6) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.GRIP_CLAW, modifierTypes.MAX_LURE, modifierTypes.ROGUE_BALL],
        fillRemaining: false,
      },
      undefined,
      undefined,
      choice.playerIndex,
    );
  } else {
    const modifierOptions: ModifierTypeOption[] = [generateModifierTypeOption(modifierTypes.MASTER_BALL)!];
    const specialOptions: ModifierTypeOption[] = [];

    if (!globalScene.findModifierForPlayer(m => m instanceof MegaEvolutionAccessModifier, choice.playerIndex)) {
      modifierOptions.push(generateModifierTypeOption(modifierTypes.MEGA_BRACELET)!);
    }
    if (!globalScene.findModifierForPlayer(m => m instanceof GigantamaxAccessModifier, choice.playerIndex)) {
      modifierOptions.push(generateModifierTypeOption(modifierTypes.DYNAMAX_BAND)!);
    }
    const nonRareEvolutionModifier = generateModifierTypeOption(modifierTypes.EVOLUTION_ITEM);
    if (nonRareEvolutionModifier) {
      specialOptions.push(nonRareEvolutionModifier);
    }
    const rareEvolutionModifier = generateModifierTypeOption(modifierTypes.RARE_EVOLUTION_ITEM);
    if (rareEvolutionModifier) {
      specialOptions.push(rareEvolutionModifier);
    }
    const formChangeModifier = generateModifierTypeOption(modifierTypes.FORM_CHANGE_ITEM);
    if (formChangeModifier) {
      specialOptions.push(formChangeModifier);
    }
    const rareFormChangeModifier = generateModifierTypeOption(modifierTypes.RARE_FORM_CHANGE_ITEM);
    if (rareFormChangeModifier) {
      specialOptions.push(rareFormChangeModifier);
    }
    if (specialOptions.length > 0) {
      modifierOptions.push(specialOptions[randSeedInt(specialOptions.length)]);
    }

    setEncounterRewards(
      {
        guaranteedModifierTypeOptions: modifierOptions,
        fillRemaining: false,
      },
      undefined,
      undefined,
      choice.playerIndex,
    );
  }
}

function setGiftBugItemRewards(choice: BugTypeSuperfanChoice): void {
  if (!choice.chosenPokemon || !choice.chosenModifier) {
    return;
  }

  globalScene.waitForPlayerInput(choice.playerIndex);
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("selectedItem", choice.chosenModifier.type.name);

  choice.chosenPokemon.loseHeldItem(choice.chosenModifier, false);
  globalScene.updateModifiers(true, true, choice.playerIndex);

  const bugNet = generateModifierTypeOption(modifierTypes.MYSTERY_ENCOUNTER_GOLDEN_BUG_NET)!;
  bugNet.type.tier = ModifierTier.ROGUE;

  setEncounterRewards(
    {
      guaranteedModifierTypeOptions: [bugNet],
      guaranteedModifierTypeFuncs: [modifierTypes.REVIVER_SEED],
      fillRemaining: false,
    },
    undefined,
    undefined,
    choice.playerIndex,
  );
}

async function showBugTypeSuperfanSelectedDialogue(choice: BugTypeSuperfanChoice): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  globalScene.waitForPlayerInput(choice.playerIndex);

  if (choice.optionIndex === 1) {
    await showEncounterDialogue(`${namespace}:option.1.selected`, `${namespace}:speaker`);
    return;
  }

  if (choice.optionIndex === 2) {
    const numBugTypes = globalScene.getPlayerParty(choice.playerIndex).filter(p => p.isOfType(PokemonType.BUG)).length;
    encounter.setDialogueToken("numBugTypes", i18next.t(`${namespace}:numBugTypes`, { count: numBugTypes }));
    await showEncounterDialogue(`${namespace}:option.2.selected`, `${namespace}:speaker`);
    await showEncounterDialogue(getShowBugTypesTextKey(numBugTypes), `${namespace}:speaker`);
    return;
  }

  if (choice.chosenModifier) {
    encounter.setDialogueToken("selectedItem", choice.chosenModifier.type.name);
  }
  await showEncounterText(`${namespace}:option.3.selected`);
  await showEncounterDialogue(`${namespace}:option.3.selectedDialogue`, `${namespace}:speaker`);
}

async function runTwoPlayerBugTypeSuperfanChoices(): Promise<boolean> {
  const choices = getBugTypeSuperfanData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battleChoices = choices.filter(choice => choice.optionIndex === 1);
  const showChoices = choices.filter(choice => choice.optionIndex === 2);
  const giftChoices = choices.filter(choice => choice.optionIndex === 3);

  for (const choice of choices) {
    await showBugTypeSuperfanSelectedDialogue(choice);
  }

  for (const choice of showChoices) {
    setShowBugTypesRewards(choice);
  }

  for (const choice of giftChoices) {
    setGiftBugItemRewards(choice);
  }

  for (const choice of battleChoices) {
    setEncounterRewards({ fillRemaining: true }, undefined, undefined, choice.playerIndex);
  }

  if (battleChoices.length === 0) {
    globalScene.waitForPlayerInput(0);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.onRewards = async () => {
    for (const choice of battleChoices) {
      await doBugTypeMoveTutor(choice.playerIndex, choice.moveTutorOptions ?? createBugTypeMoveTutorOptions());
    }
    encounter.onRewards = undefined;
  };

  const battlePlayers = battleChoices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  globalScene.waitForPlayerInput(0);
  await transitionMysteryEncounterIntroVisuals(true, true);
  await hideBugTypeSuperfanNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createBugTypeSuperfanBattleConfig(battleChoices));
  return true;
}

function createBugTypeSuperfanBattleConfig(battleChoices: BugTypeSuperfanChoice[]): EnemyPartyConfig {
  const trainerConfig = getTrainerConfigForWave(globalScene.currentBattle.waveIndex);
  if (battleChoices.length < 2) {
    return {
      trainerConfig,
      female: true,
    };
  }

  return {
    trainerConfig,
    partnerTrainerConfig: getTrainerConfigForWave(globalScene.currentBattle.waveIndex),
    female: true,
    partnerFemale: true,
    doubleBattle: true,
  };
}

function buildBattleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeBattleChoice(playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerBugTypeSuperfanChoices() : runOnePlayerBattle(),
    )
    .build();
}

function buildShowBugTypesOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withPrimaryPokemonRequirement(new PlayerBugTypeRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      disabledButtonTooltip: `${namespace}:option.2.disabledTooltip`,
    })
    .withPreOptionPhase(async () =>
      globalScene.twoPlayerMode ? storeShowBugTypesChoice(playerIndex) : runOnePlayerShowBugTypesPreOption(),
    )
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerBugTypeSuperfanChoices() : leaveEncounterWithoutBattle(),
    )
    .build();
}

function buildGiftBugItemOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withPrimaryPokemonRequirement(new PlayerBugItemRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      disabledButtonTooltip: `${namespace}:option.3.disabledTooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.3.selectedDialogue`,
        },
      ],
      secondOptionPrompt: `${namespace}:option.3.selectPrompt`,
    })
    .withPreOptionPhase(async () =>
      globalScene.twoPlayerMode ? storeGiftBugItemChoice(playerIndex) : runOnePlayerGiftBugItemPreOption(),
    )
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerBugTypeSuperfanChoices() : runOnePlayerGiftBugItem(),
    )
    .build();
}

function buildBugTypeSuperfanPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildBattleOption(playerIndex), buildShowBugTypesOption(playerIndex), buildGiftBugItemOption(playerIndex)];
}

async function runOnePlayerBattle(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const moveTutorOptions = createBugTypeMoveTutorOptions();
  encounter.misc = {
    moveTutorOptions,
  };

  encounter.onRewards = async () => {
    await doBugTypeMoveTutor(0, moveTutorOptions);
    encounter.onRewards = undefined;
  };

  setEncounterRewards({ fillRemaining: true });
  await transitionMysteryEncounterIntroVisuals(true, true);
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

function runOnePlayerShowBugTypesPreOption(): boolean {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choice: BugTypeSuperfanChoice = {
    playerIndex: 0,
    optionIndex: 2,
  };
  const numBugTypes = globalScene.getPlayerParty().filter(p => p.isOfType(PokemonType.BUG)).length;
  encounter.setDialogueToken(
    "numBugTypes",
    i18next.t(`${namespace}:numBugTypes`, {
      count: numBugTypes,
    }),
  );
  setShowBugTypesRewards(choice);
  encounter.selectedOption!.dialogue!.selected = [
    {
      speaker: `${namespace}:speaker`,
      text: getShowBugTypesTextKey(numBugTypes),
    },
  ];
  return true;
}

async function runOnePlayerGiftBugItemPreOption(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;

  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    return getValidBugItems(pokemon).map((modifier: PokemonHeldItemModifier) => {
      const option: OptionSelectItem = {
        label: modifier.type.name,
        handler: () => {
          encounter.setDialogueToken("selectedItem", modifier.type.name);
          encounter.misc = {
            chosenPokemon: pokemon,
            chosenModifier: modifier,
          };
          return true;
        },
      };
      return option;
    });
  };

  return selectPokemonForOption(onPokemonSelected, undefined, getBugItemSelectableFilter());
}

function runOnePlayerGiftBugItem(): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choice: BugTypeSuperfanChoice = {
    playerIndex: 0,
    optionIndex: 3,
    chosenPokemon: encounter.misc.chosenPokemon,
    chosenModifier: encounter.misc.chosenModifier,
  };

  setGiftBugItemRewards(choice);
  leaveEncounterWithoutBattle(true);
}

/**
 * Bug Type Superfan encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3820 | GitHub Issue #3820}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const BugTypeSuperfanEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.BUG_TYPE_SUPERFAN,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withPrimaryPokemonRequirement(new PlayerBugTypeSuperfanRequirement())
  .withMaxAllowedEncounters(1)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withScenePartySizeRequirement(3, 6)
  .withMaxAllowedEncounters(1)
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.VESPIQUEN,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      x: 35,
      y: -2,
      yShadow: -2,
    },
    {
      spriteKey: "bug_type_superfan",
      fileRoot: "trainer",
      hasShadow: true,
      x: -20,
      y: 5,
      yShadow: 5,
    },
  ])
  .withAutoHideIntroVisuals(false)
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    // Calculates what trainers are available for battle in the encounter

    // Bug type superfan trainer config
    const config = getTrainerConfigForWave(globalScene.currentBattle.waveIndex);
    encounter.enemyPartyConfigs.push({
      trainerConfig: config,
      female: true,
    });

    const requiredItems = [
      generateModifierType(modifierTypes.QUICK_CLAW),
      generateModifierType(modifierTypes.GRIP_CLAW),
      generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [PokemonType.BUG]),
    ];

    const requiredItemString = requiredItems.map(m => m?.name ?? "unknown").join("/");
    encounter.setDialogueToken("requiredBugItems", requiredItemString);

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildBattleOption(0))
  .withOption(buildShowBugTypesOption(0))
  .withOption(buildGiftBugItemOption(0))
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();

function getTrainerConfigForWave(waveIndex: number) {
  // Bug type superfan trainer config
  const config = trainerConfigs[TrainerType.BUG_TYPE_SUPERFAN].clone();
  config.name = i18next.t("trainerNames:bugTypeSuperfan");

  const pool3Copy = randSeedShuffle(POOL_3_POKEMON.slice());
  // Bang is fine here, as we know pool3Copy has at least 1 entry
  const pool3Mon = pool3Copy.pop()!;

  if (waveIndex < WAVE_LEVEL_BREAKPOINTS[0]) {
    // Use default template (2 AVG)
    config
      .setPartyMemberFunc(0, getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(1, getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true));
  } else if (waveIndex < WAVE_LEVEL_BREAKPOINTS[1]) {
    config
      .setPartyTemplates(new TrainerPartyTemplate(3, PartyMemberStrength.AVERAGE))
      .setPartyMemberFunc(0, getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(1, getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(2, getRandomPartyMemberFunc(POOL_1_POKEMON, TrainerSlot.TRAINER, true));
  } else if (waveIndex < WAVE_LEVEL_BREAKPOINTS[2]) {
    config
      .setPartyTemplates(new TrainerPartyTemplate(4, PartyMemberStrength.AVERAGE))
      .setPartyMemberFunc(0, getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(1, getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(2, getRandomPartyMemberFunc(POOL_1_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(3, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true));
  } else if (waveIndex < WAVE_LEVEL_BREAKPOINTS[3]) {
    config
      .setPartyTemplates(new TrainerPartyTemplate(5, PartyMemberStrength.AVERAGE))
      .setPartyMemberFunc(0, getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(1, getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(2, getRandomPartyMemberFunc(POOL_1_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(3, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(4, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true));
  } else if (waveIndex < WAVE_LEVEL_BREAKPOINTS[4]) {
    config
      .setPartyTemplates(new TrainerPartyTemplate(5, PartyMemberStrength.AVERAGE))
      .setPartyMemberFunc(
        0,
        getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true, p => {
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(
        1,
        getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true, p => {
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(2, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(3, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(
        4,
        getRandomPartyMemberFunc([pool3Mon.species], TrainerSlot.TRAINER, true, p => {
          if (pool3Mon.formIndex != null) {
            p.formIndex = pool3Mon.formIndex;
            p.generateAndPopulateMoveset();
            p.generateName();
          }
        }),
      );
  } else if (waveIndex < WAVE_LEVEL_BREAKPOINTS[5]) {
    const pool3Mon2 = pool3Copy.pop()!;
    config
      .setPartyTemplates(new TrainerPartyTemplate(5, PartyMemberStrength.AVERAGE))
      .setPartyMemberFunc(
        0,
        getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true, p => {
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(
        1,
        getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true, p => {
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(2, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(
        3,
        getRandomPartyMemberFunc([pool3Mon.species], TrainerSlot.TRAINER, true, p => {
          if (pool3Mon.formIndex != null) {
            p.formIndex = pool3Mon.formIndex;
            p.generateAndPopulateMoveset();
            p.generateName();
          }
        }),
      )
      .setPartyMemberFunc(
        4,
        getRandomPartyMemberFunc([pool3Mon2.species], TrainerSlot.TRAINER, true, p => {
          if (pool3Mon2.formIndex != null) {
            p.formIndex = pool3Mon2.formIndex;
            p.generateAndPopulateMoveset();
            p.generateName();
          }
        }),
      );
  } else if (waveIndex < WAVE_LEVEL_BREAKPOINTS[6]) {
    config
      .setPartyTemplates(
        new TrainerPartyCompoundTemplate(
          new TrainerPartyTemplate(4, PartyMemberStrength.AVERAGE),
          new TrainerPartyTemplate(1, PartyMemberStrength.STRONG),
        ),
      )
      .setPartyMemberFunc(
        0,
        getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true, p => {
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(
        1,
        getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true, p => {
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(2, getRandomPartyMemberFunc(POOL_2_POKEMON, TrainerSlot.TRAINER, true))
      .setPartyMemberFunc(
        3,
        getRandomPartyMemberFunc([pool3Mon.species], TrainerSlot.TRAINER, true, p => {
          if (pool3Mon.formIndex != null) {
            p.formIndex = pool3Mon.formIndex;
            p.generateAndPopulateMoveset();
            p.generateName();
          }
        }),
      )
      .setPartyMemberFunc(4, getRandomPartyMemberFunc(POOL_4_POKEMON, TrainerSlot.TRAINER, true));
  } else {
    const pool3Mon2 = pool3Copy.pop()!;
    config
      .setPartyTemplates(
        new TrainerPartyCompoundTemplate(
          new TrainerPartyTemplate(4, PartyMemberStrength.AVERAGE),
          new TrainerPartyTemplate(1, PartyMemberStrength.STRONG),
        ),
      )
      .setPartyMemberFunc(
        0,
        getRandomPartyMemberFunc([SpeciesId.BEEDRILL], TrainerSlot.TRAINER, true, p => {
          p.setBoss(true, 2);
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(
        1,
        getRandomPartyMemberFunc([SpeciesId.BUTTERFREE], TrainerSlot.TRAINER, true, p => {
          p.setBoss(true, 2);
          p.formIndex = 1;
          p.generateAndPopulateMoveset();
          p.generateName();
        }),
      )
      .setPartyMemberFunc(
        2,
        getRandomPartyMemberFunc([pool3Mon.species], TrainerSlot.TRAINER, true, p => {
          if (pool3Mon.formIndex != null) {
            p.formIndex = pool3Mon.formIndex;
            p.generateAndPopulateMoveset();
            p.generateName();
          }
        }),
      )
      .setPartyMemberFunc(
        3,
        getRandomPartyMemberFunc([pool3Mon2.species], TrainerSlot.TRAINER, true, p => {
          if (pool3Mon2.formIndex != null) {
            p.formIndex = pool3Mon2.formIndex;
            p.generateAndPopulateMoveset();
            p.generateName();
          }
        }),
      )
      .setPartyMemberFunc(4, getRandomPartyMemberFunc(POOL_4_POKEMON, TrainerSlot.TRAINER, true));
  }

  return config;
}

function doBugTypeMoveTutor(playerIndex: PlayerIndex, moveOptions: PokemonMove[]): Promise<void> {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: TODO explain
  return new Promise<void>(async resolve => {
    globalScene.waitForPlayerInput(playerIndex);
    await showEncounterDialogue(`${namespace}:battleWon`, `${namespace}:speaker`);

    const moveInfoOverlay = new MoveInfoOverlay({
      delayVisibility: false,
      onSide: true,
      right: true,
      x: 1,
      y: -MoveInfoOverlay.getHeight(true) - 1,
      width: globalScene.scaledCanvas.width - 2,
    });
    globalScene.ui.add(moveInfoOverlay);

    const optionSelectItems = moveOptions.map((move: PokemonMove) => {
      const option: OptionSelectItem = {
        label: move.getName(),
        handler: () => {
          moveInfoOverlay.active = false;
          moveInfoOverlay.setVisible(false);
          return true;
        },
        onHover: () => {
          moveInfoOverlay.active = true;
          moveInfoOverlay.show(allMoves[move.moveId]);
        },
      };
      return option;
    });

    const onHoverOverCancel = () => {
      moveInfoOverlay.active = false;
      moveInfoOverlay.setVisible(false);
    };

    const result = await selectOptionThenPokemon(
      optionSelectItems,
      `${namespace}:teachMovePrompt`,
      undefined,
      onHoverOverCancel,
    );
    // let forceExit = !!result;
    if (!result) {
      moveInfoOverlay.active = false;
      moveInfoOverlay.setVisible(false);
    }

    // TODO: add menu to confirm player doesn't want to teach a move?

    // Option select complete, handle if they are learning a move
    if (result && result.selectedOptionIndex < moveOptions.length) {
      globalScene.phaseManager.unshiftNew(
        "LearnMovePhase",
        result.selectedPokemonIndex,
        moveOptions[result.selectedOptionIndex].moveId,
        undefined,
        undefined,
        playerIndex,
      );
    }

    // Complete battle and go to rewards
    resolve();
  });
}
