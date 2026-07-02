import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { leaveEncounterWithoutBattle, setEncounterRewards } from "#mystery-encounters/encounter-phase-utils";
import { getMysteryEncounterPlayerIndexes } from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";

/** i18n namespace for the encounter */
const namespace = "mysteryEncounters/farawayIslandTreasure";

function playTreasureOpenAnimation(): void {
  const introVisuals = globalScene.currentBattle.mysteryEncounter?.introVisuals;
  if (!introVisuals) {
    return;
  }

  introVisuals.spriteConfigs[0].disableAnimation = false;
  introVisuals.playAnim();
}

async function openFarawayIslandTreasure(): Promise<void> {
  getMysteryEncounterPlayerIndexes().forEach(playerIndex => {
    setEncounterRewards(
      {
        guaranteedModifierTiers: [ModifierTier.MASTER],
      },
      undefined,
      undefined,
      playerIndex,
    );
  });

  leaveEncounterWithoutBattle();
}

/**
 * Faraway Island treasure encounter.
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const FarawayIslandTreasureEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.FARAWAY_ISLAND_TREASURE,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withMaxAllowedEncounters(1)
  .withAutoHideIntroVisuals(false)
  .withTwoPlayerSharedDecision()
  .withIntroSpriteConfigs([
    {
      spriteKey: "mysterious_chest_blue",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      y: 8,
      yShadow: 6,
      alpha: 1,
      disableAnimation: true,
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
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withPreOptionPhase(async () => playTreasureOpenAnimation())
      .withOptionPhase(openFarawayIslandTreasure)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [{ text: `${namespace}:option.2.selected` }],
      })
      .withOptionPhase(async () => leaveEncounterWithoutBattle(true))
      .build(),
  )
  .build();
