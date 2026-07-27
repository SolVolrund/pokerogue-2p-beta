import type { PlayerIndex } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import {
  getMysteryEncounterPlayerTitle,
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/utils/encounter-player-utils";
import { updateWindowType } from "#ui/ui-theme";
import i18next from "i18next";

const namespace = "mysteryEncounters/mining";

interface MiningParticipationVote {
  playerIndex: PlayerIndex;
  wantsToMine: boolean;
}

interface MiningEncounterData {
  participationVotes?: MiningParticipationVote[];
  participationPlayerIndexes?: PlayerIndex[];
  skipSelectedDialogueOnce?: boolean;
}

function getMiningEncounterData(): MiningEncounterData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc ??= {};
  return encounter.misc as MiningEncounterData;
}

function getMiningHumanPlayerIndexes(): PlayerIndex[] {
  const playerIndexes = globalScene.twoPlayerMode
    ? globalScene.getActivePlayerIndexes()
    : getMysteryEncounterPlayerIndexes();
  return playerIndexes.filter(playerIndex => !globalScene.isComputerPartnerPlayer(playerIndex));
}

function buildMiningParticipationOption(
  playerIndex: PlayerIndex,
  wantsToMine: boolean,
  startingCursorIndex: number,
) {
  const optionKey = wantsToMine ? "1" : "2";
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionKey}.label`,
      buttonTooltip: `${namespace}:option.${optionKey}.tooltip`,
    })
    .withPreOptionPhase(async () => storeMiningParticipationVote(playerIndex, wantsToMine, startingCursorIndex))
    .withOptionPhase(startResolvedMining)
    .build();
}

async function promptMiningParticipationVote(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:participationVote.query`),
    overrideOptions: [
      buildMiningParticipationOption(playerIndex, true, 0),
      buildMiningParticipationOption(playerIndex, false, 1),
    ],
    startingCursorIndex,
  });

  return result ?? false;
}

async function storeMiningParticipationVote(
  playerIndex: PlayerIndex,
  wantsToMine: boolean,
  startingCursorIndex: number,
): Promise<boolean> {
  const data = getMiningEncounterData();
  data.participationVotes = data.participationVotes?.filter(vote => vote.playerIndex !== playerIndex) ?? [];
  data.participationVotes.push({ playerIndex, wantsToMine });

  const playerIndexes = getMiningHumanPlayerIndexes();
  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex, playerIndexes);
  if (nextPlayerIndex != null) {
    return promptMiningParticipationVote(nextPlayerIndex, startingCursorIndex);
  }

  data.participationPlayerIndexes = data.participationVotes
    .filter(vote => vote.wantsToMine)
    .map(vote => vote.playerIndex);
  data.skipSelectedDialogueOnce = true;
  focusMiningPlayer(0);
  return true;
}

async function startResolvedMining(): Promise<void> {
  const data = getMiningEncounterData();
  const participantPlayerIndexes = data.participationPlayerIndexes ?? [globalScene.activePlayerIndex];
  await runMiningParticipationVotes();

  if (participantPlayerIndexes.length === 0) {
    await leaveEncounterWithoutBattle(true);
    return;
  }

  globalScene.currentBattle.mysteryEncounter!.encounterMode = MysteryEncounterMode.NO_BATTLE;
  participantPlayerIndexes.forEach((playerIndex, index) => {
    globalScene.phaseManager.pushNew("MiningPhase", playerIndex, index === participantPlayerIndexes.length - 1);
  });
}

async function runMiningParticipationVotes(): Promise<boolean> {
  const data = getMiningEncounterData();
  const votes = (data.participationVotes ?? []).toSorted((a, b) => a.playerIndex - b.playerIndex);

  for (const vote of votes) {
    globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
      "playerName",
      getMysteryEncounterPlayerTitle(vote.playerIndex),
    );
    focusMiningPlayer(vote.playerIndex);
    await showEncounterText(`${namespace}:participationVote.${vote.wantsToMine ? "mineSelected" : "leaveSelected"}`);
  }

  focusMiningPlayer(0);
  return true;
}

function focusMiningPlayer(playerIndex: PlayerIndex): void {
  if (globalScene.twoPlayerMode) {
    globalScene.waitForPlayerInput(playerIndex);
  } else {
    globalScene.setActivePlayerIndex(playerIndex);
  }
  updateWindowType(playerIndex + 1);
}

export const MiningEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(MysteryEncounterType.MINING)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([
    {
      spriteKey: "relic_gold",
      fileRoot: "items",
      isItem: true,
      hasShadow: true,
      y: 8,
      yShadow: 6,
      alpha: 1,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .setLocalizationKey(namespace)
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
      .withPreOptionPhase(async () => storeMiningParticipationVote(0, true, 0))
      .withOptionPhase(startResolvedMining)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [{ text: `${namespace}:option.2.selected` }],
      })
      .withPreOptionPhase(async () => storeMiningParticipationVote(0, false, 1))
      .withOptionPhase(startResolvedMining)
      .build(),
  )
  .build();
