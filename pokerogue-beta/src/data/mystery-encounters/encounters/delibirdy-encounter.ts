import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier, PokemonInstantReviveModifier } from "#modifiers/modifier";
import {
  BerryModifier,
  HealingBoosterModifier,
  LevelIncrementBoosterModifier,
  MoneyMultiplierModifier,
  PreserveBerryModifier,
} from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { getEncounterText, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  generateModifierType,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getNextMysteryEncounterPlayerIndex,
  getMysteryEncounterPlayerIndexes,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import { applyModifierTypeToPlayerPokemon } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedItem } from "#utils/common";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/delibirdy";

/** Berries only */
const OPTION_2_ALLOWED_MODIFIERS = ["BerryModifier", "PokemonInstantReviveModifier"];

/** Disallowed items are berries, Reviver Seeds, and Vitamins (form change items and fusion items are not PokemonHeldItemModifiers) */
const OPTION_3_DISALLOWED_MODIFIERS = [
  "BerryModifier",
  "PokemonInstantReviveModifier",
  "TerastallizeModifier",
  "PokemonBaseStatModifier",
  "PokemonBaseStatTotalModifier",
];

const DELIBIRDY_MONEY_PRICE_MULTIPLIER = 2;

type DelibirdyOptionIndex = 1 | 2 | 3;

interface DelibirdyChoice {
  playerIndex: PlayerIndex;
  optionIndex: DelibirdyOptionIndex;
  chosenPokemon?: PlayerPokemon;
  chosenModifier?: PokemonHeldItemModifier;
  cost?: number;
}

interface DelibirdyData {
  choices: DelibirdyChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class DelibirdyPlayerMoneyRequirement extends EncounterSceneRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super();
  }

  override meetsRequirement(): boolean {
    return globalScene.getPlayerMoney(this.playerIndex) >= getDelibirdyMoneyPrice();
  }

  override getDialogueToken(): [string, string] {
    return ["money", getDelibirdyMoneyPrice().toString()];
  }
}

class DelibirdyPlayerHeldItemRequirement extends EncounterSceneRequirement {
  constructor(
    private readonly playerIndex: PlayerIndex,
    private readonly optionIndex: 2 | 3,
  ) {
    super();
  }

  override meetsRequirement(): boolean {
    return globalScene.getPlayerParty(this.playerIndex).some(pokemon => getDelibirdyValidItems(pokemon, this.optionIndex).length > 0);
  }

  override getDialogueToken(): [string, string] {
    return ["item", ""];
  }
}

class DelibirdyPlayerAnyPaymentRequirement extends EncounterSceneRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super();
  }

  override meetsRequirement(): boolean {
    return (
      globalScene.getPlayerMoney(this.playerIndex) >= getDelibirdyMoneyPrice()
      || globalScene.getPlayerParty(this.playerIndex).some(
        pokemon => getDelibirdyValidItems(pokemon, 2).length > 0 || getDelibirdyValidItems(pokemon, 3).length > 0,
      )
    );
  }

  override getDialogueToken(): [string, string] {
    return ["money", getDelibirdyMoneyPrice().toString()];
  }
}

class DelibirdySpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return (
        globalScene.getPlayerMoney() >= getDelibirdyMoneyPrice()
        && globalScene.getPlayerParty().some(
          pokemon => getDelibirdyValidItems(pokemon, 2).length > 0 || getDelibirdyValidItems(pokemon, 3).length > 0,
        )
      );
    }

    return getMysteryEncounterPlayerIndexes().every(playerIndex =>
      new DelibirdyPlayerAnyPaymentRequirement(playerIndex).meetsRequirement(),
    );
  }

  override getDialogueToken(): [string, string] {
    return ["money", getDelibirdyMoneyPrice().toString()];
  }
}

const doEventReward = (playerIndex: PlayerIndex = globalScene.activePlayerIndex) => {
  const event_buff = timedEventManager.getDelibirdyBuff();
  if (event_buff.length > 0) {
    const candidates = event_buff.filter(c => {
      const mtype = generateModifierType(modifierTypes[c]);
      const existingCharm = globalScene.findModifierForPlayer(m => m.type.id === mtype?.id, playerIndex);
      return !(existingCharm && existingCharm.getStackCount() >= existingCharm.getMaxStackCount());
    });
    if (candidates.length > 0) {
      globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes[randSeedItem(candidates)], playerIndex);
    } else {
      // At max stacks, give a Voucher instead
      globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.VOUCHER, playerIndex);
    }
  }
};

function getDelibirdyData(): DelibirdyData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies DelibirdyData;
  }

  return encounter.misc as DelibirdyData;
}

function getDelibirdyMoneyPrice(): number {
  return globalScene.getWaveMoneyAmount(DELIBIRDY_MONEY_PRICE_MULTIPLIER);
}

function spendDelibirdyMoney(cost: number, playerIndex: PlayerIndex): void {
  globalScene.setPlayerMoney(Math.max(globalScene.getPlayerMoney(playerIndex) - cost, 0), playerIndex);

  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
  }

  audioManager.playSound("se/buy");
  globalScene.phaseManager.queueMessage(i18next.t("mysteryEncounterMessages:paidMoney", { amount: cost }), null, true);
}

function getDelibirdyValidItems(pokemon: Pokemon, optionIndex: 2 | 3): PokemonHeldItemModifier[] {
  return pokemon.getHeldItems().filter(item => {
    if (!item.isTransferable) {
      return false;
    }

    if (optionIndex === 2) {
      return OPTION_2_ALLOWED_MODIFIERS.some(heldItem => item.constructor.name === heldItem);
    }

    return !OPTION_3_DISALLOWED_MODIFIERS.some(heldItem => item.constructor.name === heldItem);
  });
}

function getDelibirdySelectableFilter(
  playerIndex: PlayerIndex,
  optionIndex: 2 | 3,
): (pokemon: Pokemon) => string | null {
  return (pokemon: Pokemon) => {
    if (!globalScene.getPlayerParty(playerIndex).includes(pokemon as PlayerPokemon)) {
      return getEncounterText(`${namespace}:invalidSelection`) ?? null;
    }

    return getDelibirdyValidItems(pokemon, optionIndex).length > 0
      ? null
      : getEncounterText(`${namespace}:invalidSelection`) ?? null;
  };
}

function getDelibirdyHeldItemDonationCandidates(
  playerIndex: PlayerIndex,
): { pokemon: PlayerPokemon; modifier: PokemonHeldItemModifier; tier: ModifierTier }[] {
  return globalScene.getPlayerParty(playerIndex).flatMap(pokemon =>
    getDelibirdyValidItems(pokemon, 3)
      .map(modifier => ({
        pokemon,
        modifier,
        tier: modifier.type.getOrInferTier() ?? ModifierTier.COMMON,
      }))
      .filter(candidate => candidate.tier < ModifierTier.MASTER),
  );
}

function getDelibirdyBestHeldItemDonation(playerIndex: PlayerIndex): DelibirdyChoice | undefined {
  const existing = globalScene.findModifierForPlayer(
    m => m instanceof HealingBoosterModifier,
    playerIndex,
  ) as HealingBoosterModifier;
  if (existing && existing.getStackCount() >= existing.getMaxStackCount()) {
    return undefined;
  }

  const candidate = getDelibirdyHeldItemDonationCandidates(playerIndex)
    .sort((a, b) => a.tier - b.tier || a.modifier.type.name.localeCompare(b.modifier.type.name))[0];
  return candidate
    ? {
        playerIndex,
        optionIndex: 3,
        chosenPokemon: candidate.pokemon,
        chosenModifier: candidate.modifier,
      }
    : undefined;
}

function getDelibirdyBestFoodDonation(playerIndex: PlayerIndex, preferReviverSeed: boolean): DelibirdyChoice | undefined {
  const candidates = globalScene.getPlayerParty(playerIndex).flatMap(pokemon =>
    getDelibirdyValidItems(pokemon, 2).map(modifier => ({ pokemon, modifier })),
  );
  const candidate = candidates
    .filter(({ modifier }) => preferReviverSeed === modifier.is("PokemonInstantReviveModifier"))
    .sort((a, b) => a.modifier.type.name.localeCompare(b.modifier.type.name))[0];

  return candidate
    ? {
        playerIndex,
        optionIndex: 2,
        chosenPokemon: candidate.pokemon,
        chosenModifier: candidate.modifier,
      }
    : undefined;
}

function getDelibirdyMoneyChoice(playerIndex: PlayerIndex): DelibirdyChoice | undefined {
  return globalScene.getPlayerMoney(playerIndex) >= getDelibirdyMoneyPrice()
    ? {
        playerIndex,
        optionIndex: 1,
        cost: getDelibirdyMoneyPrice(),
      }
    : undefined;
}

function chooseComputerPartnerDelibirdyChoice(playerIndex: PlayerIndex): DelibirdyChoice {
  return (
    getDelibirdyBestHeldItemDonation(playerIndex)
    ?? getDelibirdyBestFoodDonation(playerIndex, true)
    ?? getDelibirdyMoneyChoice(playerIndex)
    ?? getDelibirdyBestFoodDonation(playerIndex, false)
    ?? {
        playerIndex,
        optionIndex: 1,
        cost: getDelibirdyMoneyPrice(),
      }
  );
}

function chooseComputerPartnerDelibirdyOption(playerIndex: PlayerIndex): DelibirdyOptionIndex {
  return chooseComputerPartnerDelibirdyChoice(playerIndex).optionIndex;
}

function queueComputerPartnerDelibirdyChoiceMessage(choice: DelibirdyChoice): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(choice.playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${choice.optionIndex}.label`);
  const itemText = choice.chosenModifier ? ` with ${choice.chosenModifier.type.name}` : "";
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}${itemText}.`, null, true);
}

async function promptNextDelibirdyPlayer(playerIndex: PlayerIndex, startingCursorIndex: number): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildDelibirdyPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerDelibirdyOption,
      onOptionChosen: (_optionIndex, choicePlayerIndex) => collectComputerPartnerDelibirdyChoice(choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function storeDelibirdyChoice(choice: DelibirdyChoice): Promise<boolean> {
  const data = getDelibirdyData();
  data.choices = data.choices.filter(existingChoice => existingChoice.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (globalScene.isComputerPartnerPlayer(choice.playerIndex)) {
    queueComputerPartnerDelibirdyChoiceMessage(choice);
  }

  if (globalScene.twoPlayerMode) {
    const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(choice.playerIndex);
    if (nextPlayerIndex != null) {
      return promptNextDelibirdyPlayer(nextPlayerIndex, choice.optionIndex - 1);
    }
  }

  if (globalScene.twoPlayerMode) {
    data.skipSelectedDialogueOnce = true;
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }
  return true;
}

function collectDelibirdyMoneyChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  return storeDelibirdyChoice({
    playerIndex,
    optionIndex: 1,
    cost: getDelibirdyMoneyPrice(),
  });
}

function collectComputerPartnerDelibirdyChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  return storeDelibirdyChoice(chooseComputerPartnerDelibirdyChoice(playerIndex));
}

async function collectDelibirdyItemChoice(optionIndex: 2 | 3, playerIndex: PlayerIndex): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  let choice: DelibirdyChoice | undefined;
  const selected = await selectPokemonForOption(
    pokemon => {
      const validItems = getDelibirdyValidItems(pokemon, optionIndex);
      return validItems.map((modifier: PokemonHeldItemModifier) => {
        const option: OptionSelectItem = {
          label: modifier.type.name,
          handler: () => {
            encounter.setDialogueToken("chosenItem", modifier.type.name);
            choice = {
              playerIndex,
              optionIndex,
              chosenPokemon: pokemon,
              chosenModifier: modifier,
            };
            return true;
          },
        };
        return option;
      });
    },
    undefined,
    getDelibirdySelectableFilter(playerIndex, optionIndex),
  );

  if (!selected || !choice) {
    return false;
  }

  return storeDelibirdyChoice(choice);
}

async function giveDelibirdyFallbackShellBell(playerIndex: PlayerIndex): Promise<void> {
  const shellBell = generateModifierType(modifierTypes.SHELL_BELL) as PokemonHeldItemModifierType;
  await applyModifierTypeToPlayerPokemon(globalScene.getPlayerParty(playerIndex)[0], shellBell);
  audioManager.playSound("se/item_fanfare");
  await showEncounterText(i18next.t("battle:rewardGain", { modifierName: shellBell.name }), null, undefined, true);
}

async function queueDelibirdyReward(choice: DelibirdyChoice): Promise<void> {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);

  switch (choice.optionIndex) {
    case 1: {
      spendDelibirdyMoney(choice.cost ?? getDelibirdyMoneyPrice(), choice.playerIndex);

      const existing = globalScene.findModifierForPlayer(
        m => m instanceof MoneyMultiplierModifier,
        choice.playerIndex,
      ) as MoneyMultiplierModifier;

      if (existing && existing.getStackCount() >= existing.getMaxStackCount()) {
        await giveDelibirdyFallbackShellBell(choice.playerIndex);
      } else {
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.AMULET_COIN, choice.playerIndex);
      }
      doEventReward(choice.playerIndex);
      return;
    }
    case 2: {
      const modifier = choice.chosenModifier as BerryModifier | PokemonInstantReviveModifier;
      const chosenPokemon = choice.chosenPokemon!;
      if (modifier instanceof BerryModifier) {
        const existing = globalScene.findModifierForPlayer(
          m => m instanceof LevelIncrementBoosterModifier,
          choice.playerIndex,
        ) as LevelIncrementBoosterModifier;

        if (existing && existing.getStackCount() >= existing.getMaxStackCount()) {
          await giveDelibirdyFallbackShellBell(choice.playerIndex);
        } else {
          globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.CANDY_JAR, choice.playerIndex);
        }
      } else {
        const existing = globalScene.findModifierForPlayer(
          m => m instanceof PreserveBerryModifier,
          choice.playerIndex,
        ) as PreserveBerryModifier;

        if (existing && existing.getStackCount() >= existing.getMaxStackCount()) {
          await giveDelibirdyFallbackShellBell(choice.playerIndex);
        } else {
          globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.BERRY_POUCH, choice.playerIndex);
        }
      }

      chosenPokemon.loseHeldItem(modifier, false);
      doEventReward(choice.playerIndex);
      return;
    }
    case 3: {
      const modifier = choice.chosenModifier!;
      const chosenPokemon = choice.chosenPokemon!;
      const existing = globalScene.findModifierForPlayer(
        m => m instanceof HealingBoosterModifier,
        choice.playerIndex,
      ) as HealingBoosterModifier;

      if (existing && existing.getStackCount() >= existing.getMaxStackCount()) {
        await giveDelibirdyFallbackShellBell(choice.playerIndex);
      } else {
        globalScene.phaseManager.unshiftNew("ModifierRewardPhase", modifierTypes.HEALING_CHARM, choice.playerIndex);
      }

      chosenPokemon.loseHeldItem(modifier, false);
      doEventReward(choice.playerIndex);
      return;
    }
  }
}

async function runDelibirdyChoices(): Promise<boolean> {
  const data = getDelibirdyData();
  const choices = data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    if (choice.chosenModifier) {
      globalScene.currentBattle.mysteryEncounter!.setDialogueToken("chosenItem", choice.chosenModifier.type.name);
    }
    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
    }
    await queueDelibirdyReward(choice);
  }

  if (globalScene.twoPlayerMode) {
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }

  leaveEncounterWithoutBattle(true);
  return true;
}

function buildDelibirdyMoneyOption(playerIndex: PlayerIndex) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new DelibirdyPlayerMoneyRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectDelibirdyMoneyChoice(playerIndex))
    .withOptionPhase(async () => runDelibirdyChoices())
    .build();
}

function buildDelibirdyFoodOption(playerIndex: PlayerIndex) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new DelibirdyPlayerHeldItemRequirement(playerIndex, 2))
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      secondOptionPrompt: `${namespace}:option.2.selectPrompt`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectDelibirdyItemChoice(2, playerIndex))
    .withOptionPhase(async () => runDelibirdyChoices())
    .build();
}

function buildDelibirdyItemOption(playerIndex: PlayerIndex) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new DelibirdyPlayerHeldItemRequirement(playerIndex, 3))
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      secondOptionPrompt: `${namespace}:option.3.selectPrompt`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => collectDelibirdyItemChoice(3, playerIndex))
    .withOptionPhase(async () => runDelibirdyChoices())
    .build();
}

function buildDelibirdyPlayerOptions(playerIndex: PlayerIndex) {
  return [
    buildDelibirdyMoneyOption(playerIndex),
    buildDelibirdyFoodOption(playerIndex),
    buildDelibirdyItemOption(playerIndex),
  ];
}

/**
 * Delibird-y encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3804 | GitHub Issue #3804}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const DelibirdyEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DELIBIRDY,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withMaxAllowedEncounters(4)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new DelibirdySpawnRequirement()) // Each 2P player must have at least one way to pay
  .withIntroSpriteConfigs([
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.DELIBIRD,
      hasShadow: true,
      repeat: true,
      startFrame: 38,
      scale: 0.94,
    },
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.DELIBIRD,
      hasShadow: true,
      repeat: true,
      scale: 1.06,
    },
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.DELIBIRD,
      hasShadow: true,
      repeat: true,
      startFrame: 65,
      x: 1,
      y: 5,
      yShadow: 5,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken("delibirdName", getPokemonSpecies(SpeciesId.DELIBIRD).getName());
    return true;
  })
  .withOnVisualsStart(() => {
    audioManager.playBgm("mystery_encounter_delibirdy", true);
    return true;
  })
  .withOption(buildDelibirdyMoneyOption(0))
  .withOption(buildDelibirdyFoodOption(0))
  .withOption(buildDelibirdyItemOption(0))
  .build();
