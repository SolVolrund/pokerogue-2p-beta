import type { PlayerIndex } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { CONTEST_LOBBY_BGM } from "#data/contests/contest-audio";
import { ensureContestHallScheduledWave, markContestHallDeclined } from "#data/contests/contest-hall-schedule";
import { ContestRank } from "#data/contests/contest-opponents";
import { type ContestPlayerContestantOptions, createContestStateForRank } from "#data/contests/contest-setup";
import type { ContestState } from "#data/contests/contest-state";
import {
  CONTEST_ENCOUNTER_VISUAL_HIDE_DURATION,
  CONTEST_SCREEN_FADE_DURATION,
} from "#data/contests/contest-transition";
import { ContestType, contestTypeData } from "#data/contests/contest-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getMysteryEncounterPlayerTitle,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import i18next from "i18next";

const namespace = "mysteryEncounters/contestHall";

const CONTEST_TYPE_OPTIONS = [
  ContestType.COOL,
  ContestType.TOUGH,
  ContestType.CUTE,
  ContestType.SMART,
  ContestType.BEAUTY,
] as const;

interface ContestParticipationVote {
  playerIndex: PlayerIndex;
  wantsToEnter: boolean;
}

interface ContestTypeVote {
  playerIndex: PlayerIndex;
  contestType: ContestType;
}

interface ContestHallData {
  participationVotes: ContestParticipationVote[];
  participationResolvedWantsToEnter?: boolean;
  contestTypeVotes: ContestTypeVote[];
  playerContestants: ContestPlayerContestantOptions[];
  skipSelectedDialogueOnce?: boolean;
}

class ContestHallProgressRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    const progress = globalScene.mysteryEncounterSaveData.contestHallProgress;
    return (
      !progress.declined
      && !progress.wonGrand
      && ensureContestHallScheduledWave() === globalScene.currentBattle.waveIndex
    );
  }

  override getDialogueToken(): [string, string] {
    return ["contestHallScheduledWave", ensureContestHallScheduledWave()?.toString() ?? ""];
  }
}

function getContestHallData(): ContestHallData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc) {
    encounter.misc = {};
  }

  const data = encounter.misc as Partial<ContestHallData>;
  data.participationVotes ??= [];
  data.contestTypeVotes ??= [];
  data.playerContestants ??= [];

  return data as ContestHallData;
}

function resetContestHallData(): ContestHallData {
  const data = getContestHallData();
  data.participationVotes = [];
  delete data.participationResolvedWantsToEnter;
  data.contestTypeVotes = [];
  data.playerContestants = [];
  data.skipSelectedDialogueOnce = false;

  return data;
}

function getContestPlayerPokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return globalScene.getPlayerParty(playerIndex).find(pokemon => pokemon.isAllowedInBattle());
}

function createInitialContestState(contestType: ContestType): ContestState {
  const data = getContestHallData();
  const progress = globalScene.mysteryEncounterSaveData.contestHallProgress
  if (progress.wonGrand)
  {
    return createContestStateForRank({
    rank: ContestRank.MASTER,
    contestType,
    playerContestants: data.playerContestants,
  });
  }
  if (progress.wonMaster)
  {
    return createContestStateForRank({
    rank: ContestRank.GRAND,
    contestType,
    playerContestants: data.playerContestants,
  });
  }
  if (progress.wonHyper)
  {
    return createContestStateForRank({
    rank: ContestRank.MASTER,
    contestType,
    playerContestants: data.playerContestants,
  });
  }
    if (progress.wonSuper)
  {
    return createContestStateForRank({
    rank: ContestRank.HYPER,
    contestType,
    playerContestants: data.playerContestants,
  });
  }
  if (progress.wonNormal)
  {
    return createContestStateForRank({
    rank: ContestRank.SUPER,
    contestType,
    playerContestants: data.playerContestants,
  });
  }
  return createContestStateForRank({
    rank: ContestRank.NORMAL,
    contestType,
    playerContestants: data.playerContestants,
  });
}

function buildContestParticipationVoteOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildContestParticipationVoteOption(playerIndex, true, 0),
    buildContestParticipationVoteOption(playerIndex, false, 1),
  ];
}

function buildContestParticipationVoteOption(
  playerIndex: PlayerIndex,
  wantsToEnter: boolean,
  startingCursorIndex: number,
): MysteryEncounterOption {
  const optionKey = wantsToEnter ? "1" : "2";
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionKey}.label`,
      buttonTooltip: `${namespace}:option.${optionKey}.tooltip`,
    })
    .withPreOptionPhase(async () => storeContestParticipationVote(playerIndex, wantsToEnter, startingCursorIndex))
    .withOptionPhase(runResolvedContestParticipationOutcome)
    .build();
}

async function promptContestParticipationVote(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:participationVote.query`),
    overrideOptions: buildContestParticipationVoteOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerParticipationOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeContestParticipationVote(choicePlayerIndex, optionIndex === 0, optionIndex),
    },
  });

  return result ?? false;
}

function chooseComputerPartnerParticipationOption(playerIndex: PlayerIndex): number {
  return getContestPlayerPokemon(playerIndex) ? 0 : 1;
}

async function storeContestParticipationVote(
  playerIndex: PlayerIndex,
  wantsToEnter: boolean,
  startingCursorIndex: number,
): Promise<boolean> {
  focusContestHallPlayer(playerIndex);

  const data = getContestHallData();
  data.participationVotes = data.participationVotes.filter(vote => vote.playerIndex !== playerIndex);
  data.participationVotes.push({ playerIndex, wantsToEnter });

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptContestParticipationVote(nextPlayerIndex, startingCursorIndex);
  }

  data.skipSelectedDialogueOnce = true;
  focusContestHallPlayer(0);
  return runContestParticipationVotes();
}

async function runContestParticipationVotes(): Promise<boolean> {
  const data = getContestHallData();
  const votes = data.participationVotes.toSorted((a, b) => a.playerIndex - b.playerIndex);

  await globalScene.ui.setMode(UiMode.MESSAGE);

  for (const vote of votes) {
    setContestParticipationVoteTokens(vote);
    await showEncounterText(
      `${namespace}:participationVote.${vote.wantsToEnter ? "enterSelected" : "leaveSelected"}`,
    );
  }

  const shouldEnter = await getWinningContestParticipation(votes);
  data.participationResolvedWantsToEnter = shouldEnter;
  if (shouldEnter) {
    await showEncounterText(`${namespace}:option.1.selected`);
    return promptContestTypeVote(getMysteryEncounterPlayerIndexes()[0] ?? 0);
  }

  await showEncounterText(`${namespace}:option.2.selected`);
  return true;
}

async function runResolvedContestParticipationOutcome(): Promise<boolean> {
  const data = getContestHallData();
  if (data.participationResolvedWantsToEnter === false) {
    await skipContest();
  }

  return true;
}

async function getWinningContestParticipation(votes: ContestParticipationVote[]): Promise<boolean> {
  if (votes.length === 0) {
    return false;
  }

  const enterVotes = votes.filter(vote => vote.wantsToEnter);
  const leaveVotes = votes.filter(vote => !vote.wantsToEnter);

  if (enterVotes.length > leaveVotes.length) {
    return true;
  }

  if (leaveVotes.length > enterVotes.length) {
    return false;
  }

  const winningPlayerIndex = globalScene.resolvePlayerTieBreak(votes.map(vote => vote.playerIndex));
  const winningVote = votes.find(vote => vote.playerIndex === winningPlayerIndex) ?? votes[0];
  setContestParticipationVoteTokens(winningVote);
  await showEncounterText(`${namespace}:participationVote.tieBreak`);

  return winningVote.wantsToEnter;
}

function setContestParticipationVoteTokens(vote: ContestParticipationVote): void {
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("playerName", getContestPlayerName(vote.playerIndex));
}

function buildContestTypeVoteOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return CONTEST_TYPE_OPTIONS.map((contestType, index) => buildContestTypeVoteOption(playerIndex, contestType, index));
}

function buildContestTypeVoteOption(
  playerIndex: PlayerIndex,
  contestType: ContestType,
  optionIndex: number,
): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: contestTypeData[contestType].name,
      buttonTooltip: i18next.t(`${namespace}:contestTypeVote.tooltip`, {
        contestType: contestTypeData[contestType].name,
      }),
    })
    .withPreOptionPhase(async () => storeContestTypeVote(playerIndex, contestType, optionIndex))
    .withOptionPhase(runContestTypeVotes)
    .build();
}

async function promptContestTypeVote(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:contestTypeVote.query`),
    overrideOptions: buildContestTypeVoteOptions(playerIndex),
    startingCursorIndex,
    optionRowSpacing: 12,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerContestTypeOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeContestTypeVote(choicePlayerIndex, CONTEST_TYPE_OPTIONS[optionIndex] ?? ContestType.COOL, optionIndex),
    },
  });

  return result ?? false;
}

function chooseComputerPartnerContestTypeOption(_playerIndex: PlayerIndex): number {
  return randSeedInt(CONTEST_TYPE_OPTIONS.length);
}

async function storeContestTypeVote(
  playerIndex: PlayerIndex,
  contestType: ContestType,
  startingCursorIndex: number,
): Promise<boolean> {
  focusContestHallPlayer(playerIndex);

  const data = getContestHallData();
  data.contestTypeVotes = data.contestTypeVotes.filter(vote => vote.playerIndex !== playerIndex);
  data.contestTypeVotes.push({ playerIndex, contestType });

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptContestTypeVote(nextPlayerIndex, startingCursorIndex);
  }

  data.skipSelectedDialogueOnce = true;
  focusContestHallPlayer(0);
  return true;
}

async function runContestTypeVotes(): Promise<boolean> {
  const data = getContestHallData();
  const votes = data.contestTypeVotes.toSorted((a, b) => a.playerIndex - b.playerIndex);

  await globalScene.ui.setMode(UiMode.MESSAGE);

  for (const vote of votes) {
    setContestVoteTokens(vote);
    await showEncounterText(`${namespace}:contestTypeVote.selected`);
  }

  const contestType = await getWinningContestType(votes);
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("contestType", contestTypeData[contestType].name);
  await showEncounterText(`${namespace}:contestTypeVote.winner`);

  await collectContestPokemonSelections();
  await startContest(contestType);
  return true;
}

async function getWinningContestType(votes: ContestTypeVote[]): Promise<ContestType> {
  if (votes.length === 0) {
    return ContestType.COOL;
  }

  const voteCounts = new Map<ContestType, number>();
  for (const vote of votes) {
    voteCounts.set(vote.contestType, (voteCounts.get(vote.contestType) ?? 0) + 1);
  }

  const highestCount = Math.max(...voteCounts.values());
  const tiedTypes = [...voteCounts.entries()]
    .filter(([, count]) => count === highestCount)
    .map(([contestType]) => contestType);

  if (tiedTypes.length === 1) {
    return tiedTypes[0];
  }

  const tiedVotes = votes.filter(vote => tiedTypes.includes(vote.contestType));
  const winningPlayerIndex = globalScene.resolvePlayerTieBreak(tiedVotes.map(vote => vote.playerIndex));
  const winningVote = tiedVotes.find(vote => vote.playerIndex === winningPlayerIndex) ?? tiedVotes[0];
  setContestVoteTokens(winningVote);
  await showEncounterText(`${namespace}:contestTypeVote.tieBreak`);

  return winningVote.contestType;
}

function setContestVoteTokens(vote: ContestTypeVote): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("playerName", getContestPlayerName(vote.playerIndex));
  encounter.setDialogueToken("contestType", contestTypeData[vote.contestType].name);
}

async function collectContestPokemonSelections(): Promise<void> {
  const data = getContestHallData();
  data.playerContestants = [];

  for (const playerIndex of getMysteryEncounterPlayerIndexes()) {
    await collectContestPokemonSelection(playerIndex);
  }
}

async function collectContestPokemonSelection(playerIndex: PlayerIndex): Promise<void> {
  focusContestHallPlayer(playerIndex);

  const fallbackPokemon = getContestPlayerPokemon(playerIndex);
  if (!fallbackPokemon) {
    setContestPokemonTokens(playerIndex);
    await showEncounterText(`${namespace}:pokemonSelect.none`);
    return;
  }

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    storeContestPlayerPokemon(playerIndex, fallbackPokemon);
    await showContestPokemonSelectedText(playerIndex, fallbackPokemon);
    return;
  }

  const pokemon = await promptContestPokemonSelection(playerIndex);
  storeContestPlayerPokemon(playerIndex, pokemon);
  await showContestPokemonSelectedText(playerIndex, pokemon);
}

async function promptContestPokemonSelection(playerIndex: PlayerIndex): Promise<PlayerPokemon> {
  let selectedPokemon: PlayerPokemon | undefined;

  while (!selectedPokemon) {
    setContestPokemonTokens(playerIndex);
    await showEncounterText(`${namespace}:pokemonSelect.prompt`);
    focusContestHallPlayer(playerIndex);

    const selected = await selectPokemonForOption(
      pokemon => {
        selectedPokemon = pokemon;
      },
      undefined,
      getContestPokemonSelectableFilter(),
    );

    if (!selected || !selectedPokemon) {
      await showEncounterText(`${namespace}:pokemonSelect.required`);
    }
  }

  return selectedPokemon;
}

function getContestPokemonSelectableFilter(): (pokemon: Pokemon) => string | null {
  return (pokemon: Pokemon) => {
    if (pokemon.isAllowedInBattle()) {
      return null;
    }

    return i18next.t(`${namespace}:pokemonSelect.invalid`, {
      pokemonName: pokemon.getNameToRender(),
    });
  };
}

function storeContestPlayerPokemon(playerIndex: PlayerIndex, pokemon: PlayerPokemon): void {
  const data = getContestHallData();
  data.playerContestants = data.playerContestants.filter(contestant => contestant.playerIndex !== playerIndex);
  data.playerContestants.push({
    playerIndex,
    playerName: getContestPlayerName(playerIndex),
    pokemon,
  });
}

async function showContestPokemonSelectedText(playerIndex: PlayerIndex, pokemon: PlayerPokemon): Promise<void> {
  setContestPokemonTokens(playerIndex, pokemon);
  await showEncounterText(`${namespace}:pokemonSelect.selected`);
}

function setContestPokemonTokens(playerIndex: PlayerIndex, pokemon?: PlayerPokemon): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("playerName", getContestPlayerName(playerIndex));
  encounter.setDialogueToken("pokemonName", pokemon?.getNameToRender() ?? "");
}

function getContestPlayerName(playerIndex: PlayerIndex): string {
  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    return getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex)).name;
  }

  return getMysteryEncounterPlayerTitle(playerIndex);
}

function focusContestHallPlayer(playerIndex: PlayerIndex): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  globalScene.waitForPlayerInput(globalScene.isComputerPartnerPlayer(playerIndex) ? 0 : playerIndex);
}

async function startContest(contestType: ContestType): Promise<void> {
  const data = getContestHallData();
  if (data.playerContestants.length === 0) {
    const fallbackPokemon = getContestPlayerPokemon(0);
    if (fallbackPokemon) {
      storeContestPlayerPokemon(0, fallbackPokemon);
    }
  }

  await globalScene.ui.fadeOut(CONTEST_SCREEN_FADE_DURATION);
  await transitionMysteryEncounterIntroVisuals(true, true, CONTEST_ENCOUNTER_VISUAL_HIDE_DURATION);
  const firstPlayerIndex = (data.playerContestants[0]?.playerIndex ?? 0) as PlayerIndex;
  focusContestHallPlayer(firstPlayerIndex);
  globalScene.phaseManager.pushNew("ContestStartPhase", createInitialContestState(contestType));
}

async function skipContest(): Promise<boolean> {
  markContestHallDeclined();
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  leaveEncounterWithoutBattle(true);
  return true;
}

export const ContestHallEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.CONTEST_HALL,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new ContestHallProgressRequirement())
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "Emerald contest hall",
      fileRoot: "contests",
      disableAnimation: true,
      hasShadow: false,
      scale: 1.8,
      x: 5,
      y: 8,
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
  .withOnInit(() => {
    audioManager.playBgm(CONTEST_LOBBY_BGM, true);
    resetContestHallData();
    return true;
  })
  .withOption(buildContestParticipationVoteOption(0, true, 0))
  .withOption(buildContestParticipationVoteOption(0, false, 1))
  .build();
