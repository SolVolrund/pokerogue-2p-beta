import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { createNormalRankContestState } from "#data/contests/contest-setup";
import type { ContestState } from "#data/contests/contest-state";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { PlayerPokemon } from "#field/pokemon";
import {
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";

const namespace = "mysteryEncounters/contestHall";

function getContestPlayerPokemon(): PlayerPokemon | undefined {
  return globalScene.getPlayerParty().find(pokemon => pokemon.isAllowedInBattle());
}

function createInitialContestState(): ContestState {
  const playerPokemon = getContestPlayerPokemon();

  return createNormalRankContestState(playerPokemon);
}

async function enterContest(): Promise<boolean> {
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  globalScene.phaseManager.pushNew("ContestStartPhase", createInitialContestState());
  return true;
}

async function skipContest(): Promise<boolean> {
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  leaveEncounterWithoutBattle(true);
  return true;
}

export const ContestHallEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.CONTEST_HALL,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "Emerald contest hall",
      fileRoot: "contests",
      disableAnimation: true,
      hasShadow: false,
      x: 0,
      y: 0,
    },
  ])
  .withIntroDialogue([
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
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
    enterContest,
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
    skipContest,
  )
  .build();
