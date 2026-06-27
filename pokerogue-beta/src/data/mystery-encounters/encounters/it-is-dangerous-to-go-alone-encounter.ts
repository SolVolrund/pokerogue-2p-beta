import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { getPlayerTrainerSpriteBackTextureKey } from "#enums/player-trainer-sprite";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import {
  COMPUTER_PARTNER_KEYS,
  getComputerPartnerProfile,
  type ComputerPartnerKey,
} from "#utils/computer-partner-profile";
import { canInviteComputerPartnerToRun, inviteComputerPartnerToRun } from "#utils/computer-partner-run";
import { randSeedShuffle } from "#utils/common";

const namespace = "mysteryEncounters/itIsDangerousToGoAlone";
const PARTNER_OPTIONS = 3;
const PARTNER_SPRITE_X = [-32, 0, 32];
const ELIGIBLE_PARTNER_KEYS = COMPUTER_PARTNER_KEYS.filter(key => key !== "alex");

class SoloPartnerOfferRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return globalScene.gameMode.isClassic && canInviteComputerPartnerToRun();
  }

  override getDialogueToken(): [string, string] {
    return ["soloMode", "true"];
  }
}

export const ItIsDangerousToGoAloneEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.IT_IS_DANGEROUS_TO_GO_ALONE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new SoloPartnerOfferRequirement())
  .withMaxAllowedEncounters(2)
  .withIntroSpriteConfigs([])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const existingPartnerKeys = globalScene
      .getActivePlayerIndexes()
      .filter(playerIndex => globalScene.isComputerPartnerPlayer(playerIndex))
      .map(playerIndex => globalScene.getComputerPartnerKey(playerIndex));
    const partnerKeys = randSeedShuffle(
      ELIGIBLE_PARTNER_KEYS.filter(key => !existingPartnerKeys.includes(key)),
    ).slice(0, PARTNER_OPTIONS);

    encounter.misc = { partnerKeys };
    partnerKeys.forEach((key, index) => {
      const profile = getComputerPartnerProfile(key);
      encounter.setDialogueToken(`partner${index + 1}`, profile.name);
    });
    encounter.spriteConfigs = partnerKeys.map((key, index) => {
      const profile = getComputerPartnerProfile(key);
      return {
        spriteKey: getPlayerTrainerSpriteBackTextureKey(profile.trainerSprite!),
        fileRoot: "trainer",
        hasShadow: true,
        x: PARTNER_SPRITE_X[index],
        y: 4,
        yShadow: 4,
      };
    });

    return true;
  })
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => choosePartner(0),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    },
    async () => choosePartner(1),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    },
    async () => choosePartner(2),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.4.label`,
      buttonTooltip: `${namespace}:option.4.tooltip`,
      selected: [
        {
          text: `${namespace}:option.4.selected`,
        },
      ],
    },
    async () => {
      leaveEncounterWithoutBattle(false);
    },
  )
  .build();

async function choosePartner(optionIndex: number): Promise<void> {
  const partnerKey = getEncounterPartnerKeys()[optionIndex];

  await inviteComputerPartnerToRun(partnerKey);
  leaveEncounterWithoutBattle(false);
}

function getEncounterPartnerKeys(): ComputerPartnerKey[] {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  return encounter.misc?.partnerKeys ?? [];
}
