import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { leaveEncounterWithoutBattle, setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import type { ModifierTypeFunc } from "#types/modifier-types";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import i18next from "i18next";

/** i18n namespace for encounter */
const namespace = "mysteryEncounters/departmentStoreSale";

type DepartmentStoreOptionIndex = 1 | 2 | 3 | 4;

interface DepartmentStoreChoice {
  playerIndex: PlayerIndex;
  optionIndex: DepartmentStoreOptionIndex;
}

interface DepartmentStoreData {
  choices: DepartmentStoreChoice[];
  selectingPlayerIndex?: PlayerIndex;
}

function getDepartmentStoreData(): DepartmentStoreData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      selectingPlayerIndex: 0,
    } satisfies DepartmentStoreData;
  }

  return encounter.misc as DepartmentStoreData;
}

function storeDepartmentStoreChoice(optionIndex: DepartmentStoreOptionIndex): boolean {
  const data = getDepartmentStoreData();
  const playerIndex = globalScene.twoPlayerMode ? (data.selectingPlayerIndex ?? 0) : globalScene.activePlayerIndex;
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.twoPlayerMode && playerIndex === 0) {
    data.selectingPlayerIndex = 1;
    globalScene.setActivePlayerIndex(1);
    updateWindowType(2);
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: "Player 2",
      overrideQuery: i18next.t(`${namespace}:query`),
      startingCursorIndex: optionIndex - 1,
    });
    return false;
  }

  delete data.selectingPlayerIndex;
  if (globalScene.twoPlayerMode) {
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
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
  for (const choice of data.choices) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: getDepartmentStoreModifiers(choice.optionIndex),
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
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
      })
      .withPreOptionPhase(async () => storeDepartmentStoreChoice(1))
      .withOptionPhase(async () => runDepartmentStoreSale())
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
      })
      .withPreOptionPhase(async () => storeDepartmentStoreChoice(2))
      .withOptionPhase(async () => runDepartmentStoreSale())
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
      })
      .withPreOptionPhase(async () => storeDepartmentStoreChoice(3))
      .withOptionPhase(async () => runDepartmentStoreSale())
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.4.label`,
        buttonTooltip: `${namespace}:option.4.tooltip`,
      })
      .withPreOptionPhase(async () => storeDepartmentStoreChoice(4))
      .withOptionPhase(async () => runDepartmentStoreSale())
      .build(),
  )
  .withOutroDialogue([
    {
      text: `${namespace}:outro`,
    },
  ])
  .build();
