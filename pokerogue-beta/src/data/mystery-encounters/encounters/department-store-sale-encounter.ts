import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { leaveEncounterWithoutBattle, setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import {
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { getPlayerModifierTypeOptions, type ModifierTypeOption } from "#modifiers/modifier-type";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { randSeedInt } from "#utils/common";
import { getComputerPartnerProfileWithRolePreferences } from "#utils/computer-partner-profile";
import { chooseComputerPartnerRewardOption } from "#utils/computer-partner-reward-ai";
import i18next from "i18next";

/** i18n namespace for encounter */
const namespace = "mysteryEncounters/departmentStoreSale";

type DepartmentStoreOptionIndex = 1 | 2 | 3 | 4;

interface DepartmentStoreChoice {
  playerIndex: PlayerIndex;
  optionIndex: DepartmentStoreOptionIndex;
  rewardOptions: ModifierTypeOption[];
}

interface DepartmentStoreData {
  choices: DepartmentStoreChoice[];
}

function getDepartmentStoreData(): DepartmentStoreData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies DepartmentStoreData;
  }

  return encounter.misc as DepartmentStoreData;
}

const CATCH_BALL_TYPES = [
  PokeballType.POKEBALL,
  PokeballType.GREAT_BALL,
  PokeballType.ULTRA_BALL,
  PokeballType.ROGUE_BALL,
] as const;
const LOW_CATCH_BALL_TOTAL = 6;

function createDepartmentStoreModifierOptions(
  optionIndex: DepartmentStoreOptionIndex,
  playerIndex: PlayerIndex,
): ModifierTypeOption[] {
  const modifierTypeFuncs = getDepartmentStoreModifiers(optionIndex);
  return getPlayerModifierTypeOptions(modifierTypeFuncs.length, globalScene.getPlayerParty(playerIndex), [], {
    guaranteedModifierTypeFuncs: modifierTypeFuncs,
    fillRemaining: false,
  });
}

function previewDepartmentStoreModifierOptions(
  optionIndex: DepartmentStoreOptionIndex,
  playerIndex: PlayerIndex,
): ModifierTypeOption[] {
  const seedState = Phaser.Math.RND.state();
  const options = createDepartmentStoreModifierOptions(optionIndex, playerIndex);
  Phaser.Math.RND.state(seedState);
  return options;
}

function hasLowCatchBallSupply(playerIndex: PlayerIndex): boolean {
  const pokeballCounts = globalScene.getPlayerPokeballCounts(playerIndex);
  const catchBallTotal = CATCH_BALL_TYPES.reduce((total, ballType) => total + (pokeballCounts[ballType] ?? 0), 0);
  return catchBallTotal <= LOW_CATCH_BALL_TOTAL;
}

function getComputerPartnerRewardContext(playerIndex: PlayerIndex) {
  return {
    pokeballCounts: globalScene.getPlayerPokeballCounts(playerIndex),
    computerPartnerProfile: getComputerPartnerProfileWithRolePreferences(
      globalScene.getComputerPartnerKey(playerIndex),
      globalScene.getComputerPartnerRolePreferences(playerIndex),
    ),
  };
}

function chooseComputerPartnerDepartmentStoreOption(playerIndex: PlayerIndex): DepartmentStoreOptionIndex {
  if (hasLowCatchBallSupply(playerIndex)) {
    return 4;
  }

  const party = globalScene.getPlayerParty(playerIndex);
  const context = getComputerPartnerRewardContext(playerIndex);
  const tmChoice = chooseComputerPartnerRewardOption(previewDepartmentStoreModifierOptions(1, playerIndex), party, context);
  if (tmChoice?.itemId.startsWith("TM")) {
    return 1;
  }

  return 2;
}

function queueComputerPartnerDepartmentStoreChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: DepartmentStoreOptionIndex,
): void {
  const profile = getComputerPartnerProfileWithRolePreferences(
    globalScene.getComputerPartnerKey(playerIndex),
    globalScene.getComputerPartnerRolePreferences(playerIndex),
  );
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

function buildDepartmentStoreOption(optionIndex: DepartmentStoreOptionIndex, playerIndex?: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
    })
    .withPreOptionPhase(async () => storeDepartmentStoreChoice(optionIndex, playerIndex))
    .withOptionPhase(async () => runDepartmentStoreSale())
    .build();
}

function buildDepartmentStorePlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [1, 2, 3, 4].map(optionIndex =>
    buildDepartmentStoreOption(optionIndex as DepartmentStoreOptionIndex, playerIndex),
  );
}

async function storeDepartmentStoreChoice(
  optionIndex: DepartmentStoreOptionIndex,
  playerIndex: PlayerIndex = globalScene.activePlayerIndex,
): Promise<boolean> {
  const data = getDepartmentStoreData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({
    playerIndex,
    optionIndex,
    rewardOptions: createDepartmentStoreModifierOptions(optionIndex, playerIndex),
  });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerDepartmentStoreChoiceMessage(playerIndex, optionIndex);
  }

  if (globalScene.twoPlayerMode) {
    const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
    if (nextPlayerIndex != null) {
      const result = await showMysteryEncounterPlayerMenu({
        playerIndex: nextPlayerIndex,
        overrideOptions: buildDepartmentStorePlayerOptions(nextPlayerIndex),
        slideInDescription: false,
        overrideQuery: i18next.t(`${namespace}:query`),
        startingCursorIndex: optionIndex - 1,
        computerPartnerOption: {
          chooseOptionIndex: chooseComputerPartnerDepartmentStoreOption,
          onOptionChosen: (nextOptionIndex, nextChoicePlayerIndex) =>
            storeDepartmentStoreChoice(nextOptionIndex as DepartmentStoreOptionIndex, nextChoicePlayerIndex),
        },
      });
      return result ?? false;
    }

    globalScene.waitForPlayerInput(0);
  }

  return true;
}

function getDepartmentStoreModifiers(optionIndex: DepartmentStoreOptionIndex): ModifierTypeFunc[] {
  const modifiers: ModifierTypeFunc[] = [];

  switch (optionIndex) {
    case 1:
      while (modifiers.length < 5) {
        // 2/2/1 weight on TM rarity
        const roll = randSeedInt(5);
        if (roll < 2) {
          modifiers.push(modifierTypes.TM_COMMON);
        } else if (roll < 4) {
          modifiers.push(modifierTypes.TM_GREAT);
        } else {
          modifiers.push(modifierTypes.TM_ULTRA);
        }
      }
      return modifiers;
    case 2:
      while (modifiers.length < 3) {
        // 2/1 weight on base stat booster vs PP Up
        modifiers.push(randSeedInt(3) === 0 ? modifierTypes.PP_UP : modifierTypes.BASE_STAT_BOOSTER);
      }
      return modifiers;
    case 3:
      while (modifiers.length < 5) {
        // 4/1 weight on base stat booster vs Dire Hit
        modifiers.push(randSeedInt(5) === 0 ? modifierTypes.DIRE_HIT : modifierTypes.TEMP_STAT_STAGE_BOOSTER);
      }
      return modifiers;
    case 4:
      while (modifiers.length < 4) {
        // 10/30/20/5 weight on pokeballs
        const roll = randSeedInt(65);
        if (roll < 10) {
          modifiers.push(modifierTypes.POKEBALL);
        } else if (roll < 40) {
          modifiers.push(modifierTypes.GREAT_BALL);
        } else if (roll < 60) {
          modifiers.push(modifierTypes.ULTRA_BALL);
        } else {
          modifiers.push(modifierTypes.ROGUE_BALL);
        }
      }
      return modifiers;
  }
}

function runDepartmentStoreSale(): void {
  const data = getDepartmentStoreData();
  for (const choice of data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex)) {
    setEncounterRewards(
      {
        guaranteedModifierTypeOptions: choice.rewardOptions,
        fillRemaining: false,
      },
      undefined,
      undefined,
      choice.playerIndex,
    );
  }

  leaveEncounterWithoutBattle();
}

/**
 * Department Store Sale encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3797 | GitHub Issue #3797}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const DepartmentStoreSaleEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DEPARTMENT_STORE_SALE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[0], 100)
  .withIntroSpriteConfigs([
    {
      spriteKey: "department_store_sale_lady",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      x: -20,
    },
    {
      spriteKey: "",
      fileRoot: "",
      species: SpeciesId.FURFROU,
      hasShadow: true,
      repeat: true,
      x: 30,
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
  .withAutoHideIntroVisuals(false)
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildDepartmentStoreOption(1))
  .withOption(buildDepartmentStoreOption(2))
  .withOption(buildDepartmentStoreOption(3))
  .withOption(buildDepartmentStoreOption(4))
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
