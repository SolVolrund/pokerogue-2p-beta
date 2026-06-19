import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";

const namespace = "mysteryEncounters/shinyBadge";

type ShinyBadgeOptionIndex = 1 | 2;

interface ShinyBadgeChoice {
  playerIndex: PlayerIndex;
  optionIndex: ShinyBadgeOptionIndex;
}

interface ShinyBadgeData {
  choices: ShinyBadgeChoice[];
  shinyBadgeDuelActive?: boolean;
  skipSelectedDialogueOnce?: boolean;
}

class ShinyBadgeSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return (
      globalScene.twoPlayerMode
      && ([0, 1] as PlayerIndex[]).every(playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length > 0)
    );
  }

  override getDialogueToken(): [string, string] {
    return ["twoPlayerMode", "true"];
  }
}

function getShinyBadgeData(): ShinyBadgeData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies ShinyBadgeData;
  }

  return encounter.misc as ShinyBadgeData;
}

async function storeShinyBadgeChoice(optionIndex: ShinyBadgeOptionIndex, playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getShinyBadgeData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (playerIndex === 0) {
    showShinyBadgePlayerMenu(1, optionIndex - 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function showShinyBadgePlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: "What will you do?",
      overrideOptions: buildShinyBadgeOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function buildShinyBadgeWantOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeShinyBadgeChoice(1, playerIndex))
    .withOptionPhase(runTwoPlayerShinyBadgeChoices)
    .build();
}

function buildShinyBadgePassOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeShinyBadgeChoice(2, playerIndex))
    .withOptionPhase(runTwoPlayerShinyBadgeChoices)
    .build();
}

function buildShinyBadgeOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildShinyBadgeWantOption(playerIndex), buildShinyBadgePassOption(playerIndex)];
}

function setShinyBadgeReward(playerIndex: PlayerIndex): void {
  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.SHINY_BADGE],
      fillRemaining: false,
      rerollMultiplier: -1,
    },
    undefined,
    undefined,
    playerIndex,
  );
}

async function runTwoPlayerShinyBadgeChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choices = getShinyBadgeData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
  }

  const wantChoices = choices.filter(choice => choice.optionIndex === 1);
  const passChoices = choices.filter(choice => choice.optionIndex === 2);

  if (wantChoices.length === 1 && passChoices.length === 1) {
    await awardShinyBadgeWithoutBattle(wantChoices[0].playerIndex, `${namespace}:outro.awarded`);
    return true;
  }

  if (wantChoices.length === 0) {
    const winningPlayerIndex = globalScene.twoPlayerMysteryDecisionPriority;
    globalScene.twoPlayerMysteryDecisionPriority = winningPlayerIndex === 0 ? 1 : 0;
    await showEncounterText(`Player ${winningPlayerIndex + 1}'s choice wins this time.`);
    await awardShinyBadgeWithoutBattle(winningPlayerIndex, `${namespace}:outro.tiebreak`);
    return true;
  }

  encounter.dialogue.outro = [];
  await showEncounterText(`${namespace}:duel.start`);
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  getShinyBadgeData().shinyBadgeDuelActive = true;
  encounter.onGameOver = onShinyBadgeDuelGameOver;
  globalScene.setMysteryEncounterBattlePlayerFieldOwners([0, 1]);
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  await initBattleWithEnemyConfig(getDuelBattleConfig());
  return true;
}

async function awardShinyBadgeWithoutBattle(playerIndex: PlayerIndex, outroText: string): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setShinyBadgeReward(playerIndex);
  encounter.dialogue.outro = [
    {
      text: outroText,
    },
  ];
  leaveEncounterWithoutBattle(false);
}

function getDuelBattleConfig(): EnemyPartyConfig {
  return {
    allowEmptyEnemyParty: true,
    doubleBattle: true,
    pokemonConfigs: [],
    disableSwitch: false,
  };
}

function onShinyBadgeDuelGameOver(): boolean {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getShinyBadgeData();
  const loser = ([0, 1] as PlayerIndex[]).find(
    playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length === 0,
  );

  if (loser == null) {
    return true;
  }

  const winner = loser === 0 ? 1 : 0;
  data.shinyBadgeDuelActive = false;
  encounter.onGameOver = undefined;
  encounter.dialogue.outro = [
    {
      text: `${namespace}:outro.duel`,
    },
    {
      text: `${namespace}:outro.heal`,
    },
  ];

  audioManager.playBgm(globalScene.arena.bgm);
  globalScene.setActivePlayerIndex(winner);
  updateWindowType(winner + 1);
  globalScene.phaseManager.clearPhaseQueue();
  globalScene.phaseManager.unshiftNew("PartyHealPhase", true, loser);
  globalScene.phaseManager.pushNew("BattleEndPhase", false);
  setShinyBadgeReward(winner);
  globalScene.phaseManager.pushNew("MysteryEncounterRewardsPhase", false);
  globalScene.phaseManager.pushNew("EggLapsePhase");
  return false;
}

export const ShinyBadgeEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.SHINY_BADGE,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new ShinyBadgeSpawnRequirement())
  .withMaxAllowedEncounters(1)
  .withHideWildIntroMessage(true)
  .withAutoHideIntroVisuals(false)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "shiny_badge",
      fileRoot: "items",
      hasShadow: true,
      isItem: true,
      scale: 1.25,
      x: 0,
      y: 0,
      disableAnimation: true,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = {
      choices: [],
      shinyBadgeDuelActive: false,
    } satisfies ShinyBadgeData;

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildShinyBadgeWantOption(0))
  .withOption(buildShinyBadgePassOption(0))
  .build();
