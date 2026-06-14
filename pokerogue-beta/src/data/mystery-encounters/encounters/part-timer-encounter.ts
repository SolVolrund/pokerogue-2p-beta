import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { MoneyMultiplierModifier } from "#app/modifier/modifier";
import { NumberHolder, coerceArray } from "#app/utils/common";
import type { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterExp,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { isPokemonValidForEncounterOptionSelection } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement, MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { CHARMING_MOVES } from "#mystery-encounters/requirement-groups";
import { updateWindowType } from "#ui/ui-theme";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/partTimer";

type PartTimerOptionIndex = 1 | 2 | 3;

interface PartTimerChoice {
  playerIndex: PlayerIndex;
  optionIndex: PartTimerOptionIndex;
  pokemon: PlayerPokemon;
  moneyMultiplier: number;
  workApplied?: boolean;
}

interface PartTimerData {
  choices: PartTimerChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class PlayerMoveRequirement extends EncounterPokemonRequirement {
  private readonly moveRequirement: MoveRequirement;
  private readonly playerIndex: PlayerIndex | undefined;

  constructor(moves: MoveId | MoveId[], excludeDisallowedPokemon: boolean, playerIndex?: PlayerIndex) {
    super();
    this.playerIndex = playerIndex;
    this.moveRequirement = new MoveRequirement(moves, excludeDisallowedPokemon);
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
    return this.moveRequirement.getDialogueToken(pokemon);
  }

  private queryPlayerParty(): PlayerPokemon[] {
    const party =
      globalScene.twoPlayerMode && this.playerIndex != null
        ? globalScene.getPlayerParty(this.playerIndex)
        : globalScene.getPlayerParty();

    return this.moveRequirement.queryParty(party);
  }
}

function getPartTimerData(): PartTimerData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies PartTimerData;
  }

  return encounter.misc as PartTimerData;
}

function calculateDeliveryMoneyMultiplier(pokemon: PlayerPokemon): number {
  const baselineValue = Math.floor((2 * 90 + 16) * pokemon.level * 0.01) + 5;
  const percentDiff = (pokemon.getStat(Stat.SPD) - baselineValue) / baselineValue;
  return Math.min(Math.max(2.5 * (1 + percentDiff), 1), 4);
}

function calculateWarehouseMoneyMultiplier(pokemon: PlayerPokemon): number {
  const baselineHp = Math.floor((2 * 75 + 16) * pokemon.level * 0.01) + pokemon.level + 10;
  const baselineAtkDef = Math.floor((2 * 75 + 16) * pokemon.level * 0.01) + 5;
  const baselineValue = baselineHp + 1.5 * (baselineAtkDef * 2);
  const strongestValue = pokemon.getStat(Stat.HP) + 1.5 * (pokemon.getStat(Stat.ATK) + pokemon.getStat(Stat.DEF));
  const percentDiff = (strongestValue - baselineValue) / baselineValue;
  return Math.min(Math.max(2.5 * (1 + percentDiff), 1), 4);
}

function getSalesPokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return new MoveRequirement(CHARMING_MOVES, true).queryParty(globalScene.getPlayerParty(playerIndex))[0];
}

function getPartTimerMoneyMultiplier(optionIndex: PartTimerOptionIndex, pokemon: PlayerPokemon): number {
  if (optionIndex === 1) {
    return calculateDeliveryMoneyMultiplier(pokemon);
  }
  if (optionIndex === 2) {
    return calculateWarehouseMoneyMultiplier(pokemon);
  }
  return 2.5;
}

function setPartTimerChoiceTokens(choice: PartTimerChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("selectedPokemon", choice.pokemon.getNameToRender());

  if (choice.optionIndex === 3) {
    const move = choice.pokemon.moveset.find(move => move.moveId && CHARMING_MOVES.includes(move.moveId));
    encounter.setDialogueToken("option3PrimaryName", choice.pokemon.getNameToRender());
    encounter.setDialogueToken("option3PrimaryMove", move?.getName() ?? "");
  }
}

function setPartTimerPlayerOptionTokens(playerIndex: PlayerIndex): void {
  const pokemon = getSalesPokemon(playerIndex);
  const move = pokemon?.moveset.find(move => move.moveId && CHARMING_MOVES.includes(move.moveId));
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("option3PrimaryName", pokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("option3PrimaryMove", move?.getName() ?? "");
}

function storePartTimerChoice(choice: PartTimerChoice): void {
  const data = getPartTimerData();
  data.choices = data.choices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.choices.push(choice);
  setPartTimerChoiceTokens(choice);
}

function finishPartTimerChoiceCollection(playerIndex: PlayerIndex, startingCursorIndex: number): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  if (playerIndex === 0) {
    showPartTimerPlayerMenu(1, startingCursorIndex);
    return false;
  }

  const data = getPartTimerData();
  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function showPartTimerPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setPartTimerPlayerOptionTokens(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildPartTimerPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function applyPartTimerWorkEffects(choice: PartTimerChoice): void {
  if (choice.workApplied) {
    return;
  }

  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  setPartTimerChoiceTokens(choice);

  for (const move of choice.pokemon.moveset) {
    if (move) {
      const newPpUsed = move.getMovePp() - 2;
      move.ppUsed = move.ppUsed < newPpUsed ? newPpUsed : move.ppUsed;
    }
  }

  setEncounterExp(choice.pokemon.id, 100, true, choice.playerIndex);
  transitionMysteryEncounterIntroVisuals(true, false);

  if (choice.optionIndex === 1) {
    doDeliverySfx();
  } else if (choice.optionIndex === 2) {
    doStrongWorkSfx();
  } else {
    doSalesSfx();
  }

  choice.workApplied = true;
}

async function collectPartTimerPokemonChoice(
  optionIndex: 1 | 2,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  let selectedChoice: PartTimerChoice | undefined;
  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    selectedChoice = {
      playerIndex,
      optionIndex,
      pokemon,
      moneyMultiplier: getPartTimerMoneyMultiplier(optionIndex, pokemon),
    };
    storePartTimerChoice(selectedChoice);
  };

  const selectableFilter = (pokemon: Pokemon) => {
    return isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
  };

  const selected = await selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
  if (!selected || !selectedChoice) {
    return false;
  }

  if (!globalScene.twoPlayerMode) {
    applyPartTimerWorkEffects(selectedChoice);
  }

  return finishPartTimerChoiceCollection(playerIndex, optionIndex - 1);
}

function collectPartTimerSalesChoice(playerIndex: PlayerIndex): boolean {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const pokemon = getSalesPokemon(playerIndex);
  if (!pokemon) {
    return false;
  }

  const choice: PartTimerChoice = {
    playerIndex,
    optionIndex: 3,
    pokemon,
    moneyMultiplier: 2.5,
  };
  storePartTimerChoice(choice);

  if (!globalScene.twoPlayerMode) {
    applyPartTimerWorkEffects(choice);
  }

  return finishPartTimerChoiceCollection(playerIndex, 2);
}

async function runPartTimerChoices(): Promise<boolean> {
  const data = getPartTimerData();
  const choices = data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    setPartTimerChoiceTokens(choice);

    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
      applyPartTimerWorkEffects(choice);
    }

    await transitionMysteryEncounterIntroVisuals(false, false);

    if (choice.moneyMultiplier > 2.5 || choice.optionIndex === 3) {
      await showEncounterDialogue(`${namespace}:jobCompleteGood`, `${namespace}:speaker`);
    } else {
      await showEncounterDialogue(`${namespace}:jobCompleteBad`, `${namespace}:speaker`);
    }

    const formattedMoneyAmount = applyMoneyMultipliers(choice.moneyMultiplier, choice.playerIndex);
    await showEncounterText(i18next.t("mysteryEncounterMessages:receiveMoney", { amount: formattedMoneyAmount }));
    await showEncounterText(`${namespace}:pokemonTired`);

    setEncounterRewards({ fillRemaining: true }, undefined, undefined, choice.playerIndex);
  }

  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  leaveEncounterWithoutBattle();
  return true;
}

function buildPartTimerDeliveryOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectPartTimerPokemonChoice(1, playerIndex))
    .withOptionPhase(runPartTimerChoices)
    .build();
}

function buildPartTimerWarehouseOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectPartTimerPokemonChoice(2, playerIndex))
    .withOptionPhase(runPartTimerChoices)
    .build();
}

function buildPartTimerSalesOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerMoveRequirement(CHARMING_MOVES, true, playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      disabledButtonTooltip: `${namespace}:option.3.disabledTooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectPartTimerSalesChoice(playerIndex))
    .withOptionPhase(runPartTimerChoices)
    .build();
}

function buildPartTimerPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildPartTimerDeliveryOption(playerIndex),
    buildPartTimerWarehouseOption(playerIndex),
    buildPartTimerSalesOption(playerIndex),
  ];
}

/**
 * Part Timer encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3813 | GitHub Issue #3813}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const PartTimerEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.PART_TIMER,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([
    {
      spriteKey: "part_timer_crate",
      fileRoot: "mystery-encounters",
      hasShadow: false,
      y: 6,
      x: 15,
    },
    {
      spriteKey: "worker_f",
      fileRoot: "trainer",
      hasShadow: true,
      x: -18,
      y: 4,
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
    // Load sfx
    globalScene
      .loadSe("PRSFX- Horn Drill1", "battle_anims", "PRSFX- Horn Drill1.wav")
      .loadSe("PRSFX- Horn Drill3", "battle_anims", "PRSFX- Horn Drill3.wav")
      .loadSe("PRSFX- Guillotine2", "battle_anims", "PRSFX- Guillotine2.wav")
      .loadSe("PRSFX- Heavy Slam2", "battle_anims", "PRSFX- Heavy Slam2.wav")
      .loadSe("PRSFX- Agility", "battle_anims", "PRSFX- Agility.wav")
      .loadSe("PRSFX- Extremespeed1", "battle_anims", "PRSFX- Extremespeed1.wav")
      .loadSe("PRSFX- Accelerock1", "battle_anims", "PRSFX- Accelerock1.wav")
      .loadSe("PRSFX- Captivate", "battle_anims", "PRSFX- Captivate.wav")
      .loadSe("PRSFX- Attract2", "battle_anims", "PRSFX- Attract2.wav")
      .loadSe("PRSFX- Aurora Veil2", "battle_anims", "PRSFX- Aurora Veil2.wav");

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildPartTimerDeliveryOption(0))
  .withOption(buildPartTimerWarehouseOption(0))
  .withOption(buildPartTimerSalesOption(0))
  .withOutroDialogue([
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:outro`,
    },
  ])
  .build();

function doStrongWorkSfx() {
  audioManager.playSound("battle_anims/PRSFX- Horn Drill1");
  audioManager.playSound("battle_anims/PRSFX- Horn Drill1");

  globalScene.time.delayedCall(1000, () => {
    audioManager.playSound("battle_anims/PRSFX- Guillotine2");
  });

  globalScene.time.delayedCall(2000, () => {
    audioManager.playSound("battle_anims/PRSFX- Heavy Slam2");
  });

  globalScene.time.delayedCall(2500, () => {
    audioManager.playSound("battle_anims/PRSFX- Guillotine2");
  });
}

function doDeliverySfx() {
  audioManager.playSound("battle_anims/PRSFX- Accelerock1");

  globalScene.time.delayedCall(1500, () => {
    audioManager.playSound("battle_anims/PRSFX- Extremespeed1");
  });

  globalScene.time.delayedCall(2000, () => {
    audioManager.playSound("battle_anims/PRSFX- Extremespeed1");
  });

  globalScene.time.delayedCall(2250, () => {
    audioManager.playSound("battle_anims/PRSFX- Agility");
  });
}

function doSalesSfx() {
  audioManager.playSound("battle_anims/PRSFX- Captivate");

  globalScene.time.delayedCall(1500, () => {
    audioManager.playSound("battle_anims/PRSFX- Attract2");
  });

  globalScene.time.delayedCall(2000, () => {
    audioManager.playSound("battle_anims/PRSFX- Aurora Veil2");
  });

  globalScene.time.delayedCall(3000, () => {
    audioManager.playSound("battle_anims/PRSFX- Attract2");
  });
}

function applyMoneyMultipliers(
  moneyMultiplier: number,
  playerIndex: PlayerIndex = globalScene.activePlayerIndex,
): number {
  globalScene.setActivePlayerIndex(playerIndex);
  const moneyChange = new NumberHolder(globalScene.getWaveMoneyAmount(moneyMultiplier));
  globalScene.applyModifiersForPlayer(MoneyMultiplierModifier, playerIndex, moneyChange);
  globalScene.addMoneyForPlayer(moneyChange.value, playerIndex);
  audioManager.playSound("se/buy");

  return moneyChange.value;
}
