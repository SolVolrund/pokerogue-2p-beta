import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { Pokemon } from "#field/pokemon";
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
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/utils/encounter-player-utils";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";

const namespace = "mysteryEncounters/shinyBadge";

type ShinyBadgeOptionIndex = 1 | 2;

interface ShinyBadgeChoice {
  playerIndex: PlayerIndex;
  optionIndex: ShinyBadgeOptionIndex;
}

interface ShinyBadgeData {
  choices: ShinyBadgeChoice[];
  shinyBadgeDuelActive?: boolean;
  shinyBadgeDuelPlayerIndexes?: PlayerIndex[];
  skipSelectedDialogueOnce?: boolean;
  selectingPlayerIndex?: PlayerIndex;
}

class ShinyBadgeSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return (
      globalScene.twoPlayerMode
      && getMysteryEncounterPlayerIndexes().every(
        playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length > 0,
      )
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

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerShinyBadgeChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    data.selectingPlayerIndex = nextPlayerIndex;
    const result = await promptShinyBadgePlayer(nextPlayerIndex, optionIndex - 1);
    return result ?? false;
  }

  data.skipSelectedDialogueOnce = true;
  delete data.selectingPlayerIndex;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function promptShinyBadgePlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean | undefined> {
  return showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: "What will you do?",
    overrideOptions: buildShinyBadgeOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerShinyBadgeOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeShinyBadgeChoice(optionIndex as ShinyBadgeOptionIndex, choicePlayerIndex),
    },
  });
}

function chooseComputerPartnerShinyBadgeOption(playerIndex: PlayerIndex): ShinyBadgeOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return confidence.level === "medium" || confidence.level === "high" ? 1 : 2;
}

function queueComputerPartnerShinyBadgeChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: ShinyBadgeOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionName = optionIndex === 1 ? "Claim the badge" : "Pass";
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionName}.`, null, true);
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
    .withOptionPhase(runShinyBadgeChoices)
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
    .withOptionPhase(runShinyBadgeChoices)
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

async function runShinyBadgeChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choices = getShinyBadgeData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
  }

  const wantChoices = choices.filter(choice => choice.optionIndex === 1);

  if (wantChoices.length === 1) {
    await awardShinyBadgeWithoutBattle(wantChoices[0].playerIndex, `${namespace}:outro.awarded`);
    return true;
  }

  if (wantChoices.length === 0) {
    const winningPlayerIndex = globalScene.resolvePlayerTieBreak(choices.map(choice => choice.playerIndex));
    await showEncounterText(`Player ${winningPlayerIndex + 1}'s choice wins this time.`);
    await awardShinyBadgeWithoutBattle(winningPlayerIndex, `${namespace}:outro.tiebreak`);
    return true;
  }

  encounter.dialogue.outro = [];
  await showEncounterText(`${namespace}:duel.start`);
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  const data = getShinyBadgeData();
  const duelPlayerIndexes = wantChoices.map(choice => choice.playerIndex);
  data.shinyBadgeDuelActive = true;
  data.shinyBadgeDuelPlayerIndexes = duelPlayerIndexes;
  encounter.onGameOver = onShinyBadgeDuelGameOver;
  encounter.onPokemonFaint = handleShinyBadgeDuelFaint;
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(duelPlayerIndexes);
  globalScene.setMysteryEncounterEnemySidePlayerIndexes(getShinyBadgeEnemySidePlayers(duelPlayerIndexes));
  globalScene.setActivePlayerIndex(duelPlayerIndexes[0]);
  updateWindowType(duelPlayerIndexes[0] + 1);
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

function getShinyBadgeEnemySidePlayers(duelPlayerIndexes: PlayerIndex[]): PlayerIndex[] | undefined {
  return duelPlayerIndexes.length > 1 ? [duelPlayerIndexes[1]] : undefined;
}

function handleShinyBadgeDuelFaint(pokemon: Pokemon): boolean {
  if (!pokemon.isPlayer()) {
    return false;
  }

  const data = getShinyBadgeData();
  if (!data.shinyBadgeDuelActive || !data.shinyBadgeDuelPlayerIndexes?.length) {
    return false;
  }

  const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon);
  if (playerIndex == null || !data.shinyBadgeDuelPlayerIndexes.includes(playerIndex)) {
    return false;
  }

  const remainingPlayers = getRemainingShinyBadgeDuelPlayers(data.shinyBadgeDuelPlayerIndexes);
  if (remainingPlayers.length > 1) {
    return false;
  }

  const winner = remainingPlayers[0] ?? globalScene.resolvePlayerTieBreak(data.shinyBadgeDuelPlayerIndexes);
  finishShinyBadgeDuel(winner, data.shinyBadgeDuelPlayerIndexes);
  return false;
}

function getRemainingShinyBadgeDuelPlayers(duelPlayerIndexes: PlayerIndex[]): PlayerIndex[] {
  return duelPlayerIndexes.filter(playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length > 0);
}

function onShinyBadgeDuelGameOver(): boolean {
  const data = getShinyBadgeData();
  const duelPlayerIndexes = data.shinyBadgeDuelPlayerIndexes ?? [];
  const remainingPlayers = getRemainingShinyBadgeDuelPlayers(duelPlayerIndexes);
  const winner = remainingPlayers[0] ?? globalScene.resolvePlayerTieBreak(duelPlayerIndexes);
  finishShinyBadgeDuel(winner, duelPlayerIndexes);
  return false;
}

function finishShinyBadgeDuel(winner: PlayerIndex, duelPlayerIndexes: PlayerIndex[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getShinyBadgeData();
  data.shinyBadgeDuelActive = false;
  data.shinyBadgeDuelPlayerIndexes = undefined;
  encounter.onGameOver = undefined;
  encounter.onPokemonFaint = undefined;
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
  globalScene.phaseManager.clearPhaseQueue(true);
  for (const loser of duelPlayerIndexes.filter(playerIndex => playerIndex !== winner)) {
    globalScene.phaseManager.unshiftNew("PartyHealPhase", true, loser);
  }
  globalScene.phaseManager.pushNew("BattleEndPhase", false);
  setShinyBadgeReward(winner);
  globalScene.phaseManager.pushNew("MysteryEncounterRewardsPhase", false);
  globalScene.phaseManager.pushNew("EggLapsePhase");
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
      shinyBadgeDuelPlayerIndexes: undefined,
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
