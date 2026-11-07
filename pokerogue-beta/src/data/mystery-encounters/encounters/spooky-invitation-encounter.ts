import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { HAUNTING_SPIRIT_FOOT_OFFSET, HAUNTING_SPIRIT_KEY } from "#field/haunting-spirit";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import { getMysteryEncounterPlayerIndexes } from "#mystery-encounters/encounter-player-utils";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";

const ns = "mysteryEncounters/spookyInvitation";

class InactiveHauntingRequirement extends EncounterSceneRequirement {
  meetsRequirement(): boolean {
    const state = globalScene.seasonalEncounters;
    return !state.active && !state.hauntingsResolved && globalScene.gameMode.hasTrainers && !globalScene.gameMode.isDaily
      && getMysteryEncounterPlayerIndexes().some(p => !globalScene.isComputerPartnerPlayer(p));
  }

  getDialogueToken(): [string, string] {
    return ["speaker", `${ns}:speaker`];
  }
}

function choice(accept: boolean) {
  const key = accept ? "yes" : "no";
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${ns}:${key}.label`,
      buttonTooltip: `${ns}:${key}.tooltip`,
      selected: [{ text: `${ns}:${key}.selected`, speaker: `${ns}:speaker` }],
    })
    .withOptionPhase(async () => {
      if (accept && !globalScene.seasonalEncounters.hauntingsResolved) {
        globalScene.seasonalEncounters.active = true;
      }
      leaveEncounterWithoutBattle();
    }).build();
}

export const SpookyInvitationEncounter = MysteryEncounterBuilder.withEncounterType(MysteryEncounterType.SPOOKY_INVITATION)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withMaxAllowedEncounters(1)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new InactiveHauntingRequirement())
  .withTwoPlayerSharedDecision("unanimousHumanYes")
  .withIntroSpriteConfigs([
    { spriteKey: HAUNTING_SPIRIT_KEY, fileRoot: "trainer", x: -4, y: HAUNTING_SPIRIT_FOOT_OFFSET, repeat: true },
    { spriteKey: "hex_maniac", fileRoot: "trainer", x: -4, hasShadow: true },
  ])
  .withAutoHideIntroVisuals(false)
  .withIntroDialogue([{ text: `${ns}:intro` }, { text: `${ns}:greeting`, speaker: `${ns}:speaker` }])
  .setLocalizationKey(ns)
  .withTitle(`${ns}:title`).withDescription(`${ns}:description`).withQuery(`${ns}:query`)
  .withOption(choice(true)).withOption(choice(false))
  .build();
