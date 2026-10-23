import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { NON_LEGEND_PARADOX_POKEMON } from "#balance/special-species-groups";
import type { PokemonSpecies } from "#data/pokemon-species";
import { BattlerIndex } from "#enums/battler-index";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import type { EnemyPokemon } from "#field/pokemon";
import { IvScannerModifier } from "#modifiers/modifier";
import { getEncounterText, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getRandomEncounterPokemon,
  initSubsequentOptionSelect,
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import {
  doPlayerFlee,
  doPokemonFlee,
  getRandomSpeciesByStarterCost,
  trainerThrowPokeball,
} from "#mystery-encounters/encounter-pokemon-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getMysteryEncounterPlayerTitle,
  getNextMysteryEncounterPlayerIndex,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { BooleanHolder, NumberHolder, randSeedInt } from "#utils/common";
import {
  getBestComputerPartnerReplacementSlot,
  getComputerPartnerProfile,
  getComputerPartnerProfileWithRolePreferences,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { playTrainerThrowAnimation } from "#utils/trainer-throw-animation";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/safariZone";

const TRAINER_THROW_ANIMATION_TIMES = [512, 184, 768];

const SAFARI_MONEY_MULTIPLIER = 2;

const NUM_SAFARI_ENCOUNTERS = 3;

const eventEncs = new NumberHolder(0);
const eventChance = new NumberHolder(50);

type SafariActionIndex = 1 | 2 | 3 | 4;

interface SafariTargetState {
  pokemon: EnemyPokemon;
  catchStage: number;
  fleeStage: number;
  active: boolean;
}

interface SafariActionChoice {
  playerIndex: PlayerIndex;
  optionIndex: SafariActionIndex;
}

interface SafariTicketPayment {
  playerIndex: PlayerIndex;
  payerIndex: PlayerIndex;
}

interface SafariZoneData {
  safariPokemonRemaining: number;
  targets?: Partial<Record<PlayerIndex, SafariTargetState>>;
  choices?: SafariActionChoice[];
  participationChoices?: Partial<Record<PlayerIndex, boolean>>;
  participatingPlayers?: PlayerIndex[];
  ticketPayments?: SafariTicketPayment[];
  declinedTicketPayments?: SafariTicketPayment[];
}

class SafariEntryMoneyRequirement extends MoneyRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return super.meetsRequirement();
    }

    if (this.scalingMultiplier > 0) {
      this.requiredMoney = globalScene.getWaveMoneyAmount(this.scalingMultiplier);
    }

    return getMysteryEncounterPlayerIndexes().some(playerIndex => globalScene.getPlayerMoney(playerIndex) >= this.requiredMoney);
  }
}

function getSafariData(): SafariZoneData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc ??= {
    safariPokemonRemaining: NUM_SAFARI_ENCOUNTERS,
  };

  return encounter.misc as SafariZoneData;
}

function getSafariEntryFee(): number {
  return globalScene.getWaveMoneyAmount(SAFARI_MONEY_MULTIPLIER);
}

function spendSafariEntryFee(playerIndex: PlayerIndex, cost: number): void {
  globalScene.setPlayerMoney(Math.max(globalScene.getPlayerMoney(playerIndex) - cost, 0), playerIndex);
  if (playerIndex === globalScene.activePlayerIndex) {
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
  }
}

function getSafariTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
  const fieldOwners = globalScene.getPlayerFieldOwners();
  const fieldIndex = Math.max(0, fieldOwners.indexOf(playerIndex)) as PlayerIndex;
  globalScene.setTrainerBackSpritePosition(
    trainerSprite,
    playerIndex,
    globalScene.getTrainerBackSpriteX(fieldIndex, fieldOwners.length > 1),
  );
  return trainerSprite;
}

function showMultiplayerSafariTrainers(playerIndexes: PlayerIndex[]): void {
  for (const playerIndex of getMysteryEncounterPlayerIndexes()) {
    const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
    if (!playerIndexes.includes(playerIndex)) {
      trainerSprite.setVisible(false);
      continue;
    }

    trainerSprite
      .setVisible(true)
      .setTexture(globalScene.getTrainerBackTextureKey(playerIndex))
      .setFrame(0);
    getSafariTrainerSprite(playerIndex);
  }
}

function getSafariParticipantIndexes(): PlayerIndex[] {
  return getSafariData().participatingPlayers ?? getMysteryEncounterPlayerIndexes();
}

function getSafariActionTarget(playerIndex: PlayerIndex): SafariTargetState | undefined {
  return getSafariData().targets?.[playerIndex];
}

function focusSafariPlayer(playerIndex: PlayerIndex): void {
  const inputPlayer = globalScene.isComputerPartnerPlayer(playerIndex)
    ? getMysteryEncounterPlayerIndexes().find(index => !globalScene.isComputerPartnerPlayer(index)) ?? 0
    : playerIndex;
  globalScene.waitForPlayerSideProgressionInput(inputPlayer);
  globalScene.setActivePlayerIndex(playerIndex);
}

function getActiveSafariPlayerIndexes(): PlayerIndex[] {
  return getSafariParticipantIndexes().filter(playerIndex => getSafariActionTarget(playerIndex)?.active);
}

function beginSafariActionPlayerSelect(playerIndex: PlayerIndex, startingCursorIndex = 0): boolean | Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    // Let queued summons, scans, and capture rewards finish before the CPU acts.
    globalScene.phaseManager.pushNew("MysteryEncounterOptionSelectedPhase", async () => {
      focusSafariPlayer(playerIndex);
      const optionIndex = chooseComputerPartnerSafariAction(playerIndex);
      return handleSafariActionChoice(optionIndex, playerIndex, startingCursorIndex);
    });
    return true;
  }

  focusSafariPlayer(playerIndex);
  initSubsequentOptionSelect({
    playerIndex,
    overrideOptions: buildMultiplayerSafariZoneGameOptions(playerIndex),
    startingCursorIndex,
    hideDescription: true,
    overrideTitle: getMysteryEncounterPlayerTitle(playerIndex),
    overrideQuery: getSafariActionTarget(playerIndex)!.pokemon.getNameToRender(),
  });
  return true;
}

function beginMultiplayerSafariActionSelect(startingCursorIndex = 0): boolean | Promise<boolean> {
  const data = getSafariData();
  data.choices = [];
  const activePlayers = getActiveSafariPlayerIndexes();

  if (activePlayers.length === 0) {
    return endOrContinueMultiplayerSafari(startingCursorIndex).then(() => true);
  }

  return beginSafariActionPlayerSelect(activePlayers[0], startingCursorIndex);
}

async function handleSafariActionChoice(
  optionIndex: SafariActionIndex,
  playerIndex: PlayerIndex,
  startingCursorIndex: number,
): Promise<boolean> {
  const data = getSafariData();
  data.choices ??= [];
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex, getActiveSafariPlayerIndexes());
  if (nextPlayerIndex != null) {
    return beginSafariActionPlayerSelect(nextPlayerIndex, optionIndex - 1);
  }

  return runMultiplayerSafariRound(startingCursorIndex);
}

async function startSafariEncounter(): Promise<boolean> {
  // Start safari encounter
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.continuousEncounter = true;
  encounter.misc = {
    safariPokemonRemaining: NUM_SAFARI_ENCOUNTERS,
  };
  updatePlayerMoney(-getSafariEntryFee());
  loadSafariAssets();
  // Clear enemy party
  globalScene.currentBattle.enemyParty = [];
  await transitionMysteryEncounterIntroVisuals();
  await summonSafariPokemon();
  initSubsequentOptionSelect({
    overrideOptions: safariZoneGameOptions,
    hideDescription: true,
  });
  return true;
}

function getPendingSafariPaymentCost(payerIndex: PlayerIndex, payments: SafariTicketPayment[], cost: number): number {
  return payments.filter(payment => payment.payerIndex === payerIndex).length * cost;
}

function canAffordPendingSafariTicket(payerIndex: PlayerIndex, payments: SafariTicketPayment[], cost: number): boolean {
  return globalScene.getPlayerMoney(payerIndex) - getPendingSafariPaymentCost(payerIndex, payments, cost) >= cost;
}

function getSafariTrainerDisplayName(playerIndex: PlayerIndex): string {
  return globalScene.isComputerPartnerPlayer(playerIndex)
    ? getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex)).name
    : getMysteryEncounterPlayerTitle(playerIndex);
}

function hasDeclinedSafariTicketPayment(playerIndex: PlayerIndex, payerIndex: PlayerIndex): boolean {
  return (getSafariData().declinedTicketPayments ?? []).some(payment =>
    payment.playerIndex === playerIndex && payment.payerIndex === payerIndex);
}

function addSafariTicketPayment(playerIndex: PlayerIndex, payerIndex: PlayerIndex): void {
  const data = getSafariData();
  data.ticketPayments ??= [];
  if (!data.ticketPayments.some(payment => payment.playerIndex === playerIndex)) {
    data.ticketPayments.push({ playerIndex, payerIndex });
  }
}

function addDeclinedSafariTicketPayment(playerIndex: PlayerIndex, payerIndex: PlayerIndex): void {
  const data = getSafariData();
  data.declinedTicketPayments ??= [];
  if (!hasDeclinedSafariTicketPayment(playerIndex, payerIndex)) {
    data.declinedTicketPayments.push({ playerIndex, payerIndex });
  }
}

function initializeSafariSelfPayments(cost: number): void {
  const data = getSafariData();
  data.ticketPayments = [];
  data.declinedTicketPayments = [];
  const players = getMysteryEncounterPlayerIndexes().filter(player => data.participationChoices?.[player]);
  for (const playerIndex of players) {
    if (globalScene.getPlayerMoney(playerIndex) >= cost) {
      addSafariTicketPayment(playerIndex, playerIndex);
    }
  }
}

function continueSafariTicketResolution(cost: number): boolean | Promise<boolean> {
  const players = getMysteryEncounterPlayerIndexes();
  const data = getSafariData();
  const payments = data.ticketPayments ?? [];

  for (const playerIndex of players) {
    if (!data.participationChoices?.[playerIndex] || payments.some(payment => payment.playerIndex === playerIndex)) {
      continue;
    }

    for (const payerIndex of players.filter(candidate => candidate !== playerIndex)) {
      if (
        hasDeclinedSafariTicketPayment(playerIndex, payerIndex)
        || !canAffordPendingSafariTicket(payerIndex, payments, cost)
      ) {
        continue;
      }

      if (globalScene.isComputerPartnerPlayer(payerIndex)) {
        addSafariTicketPayment(playerIndex, payerIndex);
        globalScene.phaseManager.queueMessage(
          `${getSafariTrainerDisplayName(payerIndex)} paid for ${getSafariTrainerDisplayName(playerIndex)}'s Safari Zone ticket.`,
          null,
          true,
        );
        return continueSafariTicketResolution(cost);
      }

      beginSafariTicketSponsorSelect(playerIndex, payerIndex, cost);
      return true;
    }
  }

  return finishStartMultiplayerSafariEncounter(cost);
}

function buildSafariTicketSponsorOptions(playerIndex: PlayerIndex, payerIndex: PlayerIndex, cost: number): MysteryEncounterOption[] {
  return [
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({ buttonLabel: "menu:yes" })
      .withOptionPhase(async () => {
        addSafariTicketPayment(playerIndex, payerIndex);
        return continueSafariTicketResolution(cost);
      })
      .build(),
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({ buttonLabel: "menu:no" })
      .withOptionPhase(async () => {
        addDeclinedSafariTicketPayment(playerIndex, payerIndex);
        return continueSafariTicketResolution(cost);
      })
      .build(),
  ];
}

function beginSafariTicketSponsorSelect(playerIndex: PlayerIndex, payerIndex: PlayerIndex, cost: number): void {
  focusSafariPlayer(payerIndex);
  initSubsequentOptionSelect({
    playerIndex: payerIndex,
    overrideOptions: buildSafariTicketSponsorOptions(playerIndex, payerIndex, cost),
    overrideTitle: getMysteryEncounterPlayerTitle(payerIndex),
    overrideQuery: `${getSafariTrainerDisplayName(payerIndex)}, pay for ${getSafariTrainerDisplayName(playerIndex)}'s Safari Zone ticket?`,
    hideDescription: true,
  });
}

function buildSafariParticipationOptions(playerIndex: PlayerIndex): [MysteryEncounterOption, MysteryEncounterOption] {
  return [true, false].map(participate =>
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:participation.${participate ? "enter" : "sitOut"}`,
        buttonTooltip: `${namespace}:participation.${participate ? "enterTooltip" : "sitOutTooltip"}`,
      })
      .withOptionPhase(async () => collectSafariParticipation(playerIndex, participate))
      .build(),
  ) as [MysteryEncounterOption, MysteryEncounterOption];
}

function collectSafariParticipation(playerIndex: PlayerIndex, participate: boolean): boolean | Promise<boolean> {
  const data = getSafariData();
  data.participationChoices ??= {};
  data.participationChoices[playerIndex] = participate;
  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    if (globalScene.isComputerPartnerPlayer(nextPlayerIndex)) {
      return collectSafariParticipation(nextPlayerIndex, true);
    }
    focusSafariPlayer(nextPlayerIndex);
    initSubsequentOptionSelect({
      playerIndex: nextPlayerIndex,
      overrideOptions: buildSafariParticipationOptions(nextPlayerIndex),
      overrideTitle: getMysteryEncounterPlayerTitle(nextPlayerIndex),
      overrideQuery: `${namespace}:participation.query`,
      hideDescription: true,
    });
    return true;
  }

  const cost = getSafariEntryFee();
  initializeSafariSelfPayments(cost);
  return continueSafariTicketResolution(cost);
}

async function finishStartMultiplayerSafariEncounter(cost: number): Promise<boolean> {
  const ticketPayments = getSafariData().ticketPayments ?? [];
  const players = ticketPayments.map(payment => payment.playerIndex).sort((a, b) => a - b);
  if (players.length === 0) {
    globalScene.currentBattle.mysteryEncounter!.continuousEncounter = false;
    globalScene.clearMysteryEncounterBattlePlayerFieldOwners();
    globalScene.waitForPlayerSideProgressionInput();
    await showEncounterText(getEncounterText(`${namespace}:option.2.selected`) ?? "");
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getSafariData();
  encounter.continuousEncounter = true;
  data.participatingPlayers = players;
  data.ticketPayments = ticketPayments;

  for (const payment of ticketPayments) {
    spendSafariEntryFee(payment.payerIndex, cost);
  }
  audioManager.playSound("se/buy");

  loadSafariAssets();
  globalScene.currentBattle.enemyParty = [];
  globalScene.currentBattle.double = players.length > 1;
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(players);
  await transitionMysteryEncounterIntroVisuals();
  showMultiplayerSafariTrainers(players);
  await summonMultiplayerSafariPokemonGroup();
  return beginMultiplayerSafariActionSelect();
}

function loadSafariAssets(): void {
  globalScene
    .loadSe("PRSFX- Bug Bite", "battle_anims", "PRSFX- Bug Bite.wav")
    .loadSe("PRSFX- Sludge Bomb2", "battle_anims", "PRSFX- Sludge Bomb2.wav")
    .loadSe("PRSFX- Taunt2", "battle_anims", "PRSFX- Taunt2.wav")
    .loadAtlas("safari_zone_bait", "mystery-encounters")
    .loadAtlas("safari_zone_mud", "mystery-encounters");
}

function generateSafariPokemon(seedOffset: number): EnemyPokemon {
  let pokemon: EnemyPokemon | undefined;
  globalScene.executeWithSeedOffset(
    () => {
      console.log("Event chance %d", eventChance.value);
      const fromEvent = new BooleanHolder(false);
      pokemon = getRandomEncounterPokemon({
        level: globalScene.currentBattle.getLevelForWave(),
        includeLegendary: false,
        includeSubLegendary: false,
        includeMythical: false,
        speciesFunction: getSafariSpeciesSpawn,
        shinyRerolls: 1,
        eventShinyRerolls: 1,
        hiddenRerolls: 1,
        eventHiddenRerolls: 1,
        eventChance: eventChance.value,
        isEventEncounter: fromEvent,
      }) as EnemyPokemon;

      pokemon.init();

      // Increase chance of event encounter by 25% until one spawns
      if (fromEvent.value) {
        console.log("Safari zone encounter is from event");
        eventEncs.value++;
        eventChance.value = 50;
      } else if (eventEncs.value === 0) {
        console.log("Safari zone encounter is not from event");
        eventChance.value += 25;
      }
    },
    seedOffset,
  );

  return pokemon!;
}

async function summonMultiplayerSafariPokemonGroup(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getSafariData();
  const players = getSafariParticipantIndexes();
  encounter.setDialogueToken("remainingCount", data.safariPokemonRemaining.toString());
  globalScene.phaseManager.queueMessage(getEncounterText(`${namespace}:safari.remainingCount`) ?? "", null, true);

  const seedBase = globalScene.currentBattle.waveIndex * 1000 * data.safariPokemonRemaining;
  const pokemonEntries = players.map((playerIndex, index) => ({
    playerIndex,
    pokemon: generateSafariPokemon(seedBase + index),
  }));

  for (const { pokemon } of pokemonEntries.toReversed()) {
    globalScene.currentBattle.enemyParty.unshift(pokemon);
  }

  for (const { pokemon } of pokemonEntries) {
    for (const playerIndex of players) {
      globalScene.getPlayerGameData(playerIndex).setPokemonSeen(pokemon, true);
    }
  }

  await Promise.all(pokemonEntries.map(({ pokemon }) => pokemon.loadAssets()));

  data.targets = {};
  for (const { playerIndex, pokemon } of pokemonEntries) {
    data.targets[playerIndex] = { pokemon, catchStage: 0, fleeStage: 0, active: true };
  }
  data.safariPokemonRemaining -= 1;

  for (let fieldIndex = pokemonEntries.length - 1; fieldIndex >= 0; fieldIndex--) {
    globalScene.phaseManager.unshiftNew("SummonPhase", fieldIndex, false);
    globalScene.phaseManager.unshiftNew("PostSummonPhase", globalScene.getEnemyBattlerIndex(fieldIndex));
  }

  for (const [fieldIndex, { playerIndex }] of pokemonEntries.entries()) {
    const ivScannerModifier = globalScene.findModifierForPlayer(m => m instanceof IvScannerModifier, playerIndex);
    if (ivScannerModifier && !globalScene.isComputerPartnerPlayer(playerIndex)) {
      globalScene.phaseManager.pushNew("ScanIvsPhase", globalScene.getEnemyBattlerIndex(fieldIndex), playerIndex);
    }
  }
}

function doesSafariTargetImproveComputerPartnerTeam(playerIndex: PlayerIndex, target: SafariTargetState): boolean {
  if (!globalScene.isComputerPartnerPlayer(playerIndex)) {
    return false;
  }

  const profile = getComputerPartnerProfileWithRolePreferences(
    globalScene.getComputerPartnerKey(playerIndex),
    globalScene.getComputerPartnerRolePreferences(playerIndex),
  );
  return !!getBestComputerPartnerReplacementSlot(
    profile,
    globalScene.getPlayerParty(playerIndex),
    target.pokemon,
    globalScene.getPlayerPartyLimit(playerIndex),
  );
}

function chooseComputerPartnerSafariAction(playerIndex: PlayerIndex): SafariActionIndex {
  const target = getSafariActionTarget(playerIndex);
  return target?.active && doesSafariTargetImproveComputerPartnerTeam(playerIndex, target) ? 1 : 4;
}

async function runMultiplayerSafariRound(startingCursorIndex: number): Promise<boolean> {
  const data = getSafariData();
  const choices = (data.choices ?? []).slice().sort((a, b) => a.playerIndex - b.playerIndex);
  data.choices = [];

  for (const choice of choices) {
    const target = getSafariActionTarget(choice.playerIndex);
    if (!target?.active) {
      continue;
    }

    focusSafariPlayer(choice.playerIndex);
    await runMultiplayerSafariAction(choice.optionIndex, choice.playerIndex, target);
  }

  for (const [playerIndex, target] of Object.entries(data.targets ?? {})) {
    if (!target?.active) {
      continue;
    }

    focusSafariPlayer(Number(playerIndex) as PlayerIndex);
    const isFlee = isPokemonFlee(target.pokemon, target.fleeStage);
    if (isFlee) {
      await doPokemonFlee(target.pokemon);
      target.active = false;
    } else {
      globalScene.currentBattle.mysteryEncounter?.setDialogueToken("pokemonName", getPokemonNameWithAffix(target.pokemon));
      globalScene.phaseManager.queueMessage(getEncounterText(`${namespace}:safari.watching`) ?? "", 0, null, 1000);
    }
  }

  await endOrContinueMultiplayerSafari(startingCursorIndex);
  return true;
}

async function runMultiplayerSafariAction(
  optionIndex: SafariActionIndex,
  playerIndex: PlayerIndex,
  target: SafariTargetState,
): Promise<void> {
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("pokemonName", getPokemonNameWithAffix(target.pokemon));
  switch (optionIndex) {
    case 1:
      await showEncounterText(`${namespace}:safari.1.selected`);
      if (await throwPokeball(target.pokemon, target.catchStage, playerIndex)) {
        target.active = false;
      }
      return;
    case 2: {
      await showEncounterText(`${namespace}:safari.2.selected`);
      await throwBait(target.pokemon, playerIndex);
      target.catchStage = getChangedSafariStage(target.catchStage, 2);
      const fleeChangeResult = tryChangeSafariStage(1, 8);
      if (fleeChangeResult) {
        target.fleeStage = getChangedSafariStage(target.fleeStage, 1);
        await showEncounterText(getEncounterText(`${namespace}:safari.eating`) ?? "", null, 1000, false);
      } else {
        await showEncounterText(getEncounterText(`${namespace}:safari.busyEating`) ?? "", null, 1000, false);
      }
      return;
    }
    case 3: {
      await showEncounterText(`${namespace}:safari.3.selected`);
      await throwMud(target.pokemon, playerIndex);
      target.fleeStage = getChangedSafariStage(target.fleeStage, -2);
      const catchChangeResult = tryChangeSafariStage(-1, 8);
      if (catchChangeResult) {
        target.catchStage = getChangedSafariStage(target.catchStage, -1);
        await showEncounterText(getEncounterText(`${namespace}:safari.angry`) ?? "", null, 1000, false);
      } else {
        await showEncounterText(getEncounterText(`${namespace}:safari.besideItselfAngry`) ?? "", null, 1000, false);
      }
      return;
    }
    case 4:
      await doPlayerFlee(target.pokemon);
      target.active = false;
      return;
  }
}

async function endOrContinueMultiplayerSafari(startingCursorIndex: number): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getSafariData();
  if (getActiveSafariPlayerIndexes().length > 0) {
    await beginMultiplayerSafariActionSelect(startingCursorIndex);
    return;
  }

  if (data.safariPokemonRemaining > 0) {
    await summonMultiplayerSafariPokemonGroup();
    await beginMultiplayerSafariActionSelect();
    return;
  }

  encounter.continuousEncounter = false;
  globalScene.clearMysteryEncounterBattlePlayerFieldOwners();
  globalScene.waitForPlayerSideProgressionInput();
  leaveEncounterWithoutBattle(true);
}

function getChangedSafariStage(currentStage: number, change: number): number {
  return Math.min(Math.max(currentStage + change, -6), 6);
}

function tryChangeSafariStage(_change: number, chance?: number): boolean {
  return !(chance && randSeedInt(10) >= chance);
}

/**
 * Safari Zone encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3800 | GitHub Issue #3800}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const SafariZoneEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.SAFARI_ZONE,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new SafariEntryMoneyRequirement(0, SAFARI_MONEY_MULTIPLIER)) // Cost equal to 1 Max Revive
  .withAutoHideIntroVisuals(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "safari_zone",
      fileRoot: "mystery-encounters",
      hasShadow: false,
      x: 4,
      y: 6,
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
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken("numEncounters", NUM_SAFARI_ENCOUNTERS.toString());
    if (globalScene.twoPlayerMode) {
      encounter.misc = { safariPokemonRemaining: NUM_SAFARI_ENCOUNTERS, participationChoices: {} } satisfies SafariZoneData;
      encounter.options = buildSafariParticipationOptions(0);
      encounter.setDialogueToken("option1Money", getSafariEntryFee().toString());
      encounter.dialogue = {
        ...encounter.dialogue,
        encounterOptionsDialogue: {
          ...encounter.dialogue.encounterOptionsDialogue,
          query: `${namespace}:participation.query`,
        },
      };
    }
    eventEncs.value = 0;
    eventChance.value = 50;
    return true;
  })
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
      .withSceneRequirement(new SafariEntryMoneyRequirement(0, SAFARI_MONEY_MULTIPLIER)) // Cost equal to 1 Max Revive
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      })
      .withOptionPhase(async () => startSafariEncounter())
      .build(),
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
    async () => {
      // Leave encounter with no rewards or exp
      leaveEncounterWithoutBattle(true);
      return true;
    },
  )
  .build();

/**
 * SAFARI ZONE MINIGAME OPTIONS
 *
 * Catch and flee rate stages are calculated in the same way stat changes are (they range from -6/+6)
 * https://bulbapedia.bulbagarden.net/wiki/Catch_rate#Great_Marsh_and_Johto_Safari_Zone
 *
 * Catch Rate calculation:
 * catchRate = speciesCatchRate [1 to 255] * catchStageMultiplier [2/8 to 8/2] * ballCatchRate [1.5]
 *
 * Flee calculation:
 * The harder a species is to catch, the higher its flee rate is
 * (Caps at 50% base chance to flee for the hardest to catch Pokemon, before factoring in flee stage)
 * fleeRate = ((255^2 - speciesCatchRate^2) / 255 / 2) [0 to 127.5] * fleeStageMultiplier [2/8 to 8/2]
 * Flee chance = fleeRate / 255
 */
const safariZoneGameOptions: MysteryEncounterOption[] = [
  MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:safari.1.label`,
      buttonTooltip: `${namespace}:safari.1.tooltip`,
      selected: [
        {
          text: `${namespace}:safari.1.selected`,
        },
      ],
    })
    .withOptionPhase(async () => {
      // Throw a ball option
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      const pokemon = encounter.misc.pokemon;
      const catchResult = await throwPokeball(pokemon);

      if (catchResult) {
        // You caught pokemon
        // Check how many safari pokemon left
        if (encounter.misc.safariPokemonRemaining > 0) {
          await summonSafariPokemon();
          initSubsequentOptionSelect({
            overrideOptions: safariZoneGameOptions,
            startingCursorIndex: 0,
            hideDescription: true,
          });
        } else {
          // End safari mode
          encounter.continuousEncounter = false;
          leaveEncounterWithoutBattle(true);
        }
      } else {
        // Pokemon catch failed, end turn
        await doEndTurn(0);
      }
      return true;
    })
    .build(),
  MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:safari.2.label`,
      buttonTooltip: `${namespace}:safari.2.tooltip`,
      selected: [
        {
          text: `${namespace}:safari.2.selected`,
        },
      ],
    })
    .withOptionPhase(async () => {
      // Throw bait option
      const pokemon = globalScene.currentBattle.mysteryEncounter!.misc.pokemon;
      await throwBait(pokemon);

      // 100% chance to increase catch stage +2
      tryChangeCatchStage(2);
      // 80% chance to increase flee stage +1
      const fleeChangeResult = tryChangeFleeStage(1, 8);
      if (fleeChangeResult) {
        await showEncounterText(getEncounterText(`${namespace}:safari.eating`) ?? "", null, 1000, false);
      } else {
        await showEncounterText(getEncounterText(`${namespace}:safari.busyEating`) ?? "", null, 1000, false);
      }

      await doEndTurn(1);
      return true;
    })
    .build(),
  MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:safari.3.label`,
      buttonTooltip: `${namespace}:safari.3.tooltip`,
      selected: [
        {
          text: `${namespace}:safari.3.selected`,
        },
      ],
    })
    .withOptionPhase(async () => {
      // Throw mud option
      const pokemon = globalScene.currentBattle.mysteryEncounter!.misc.pokemon;
      await throwMud(pokemon);
      // 100% chance to decrease flee stage -2
      tryChangeFleeStage(-2);
      // 80% chance to decrease catch stage -1
      const catchChangeResult = tryChangeCatchStage(-1, 8);
      if (catchChangeResult) {
        await showEncounterText(getEncounterText(`${namespace}:safari.angry`) ?? "", null, 1000, false);
      } else {
        await showEncounterText(getEncounterText(`${namespace}:safari.besideItselfAngry`) ?? "", null, 1000, false);
      }

      await doEndTurn(2);
      return true;
    })
    .build(),
  MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:safari.4.label`,
      buttonTooltip: `${namespace}:safari.4.tooltip`,
    })
    .withOptionPhase(async () => {
      // Flee option
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      const pokemon = encounter.misc.pokemon;
      await doPlayerFlee(pokemon);
      // Check how many safari pokemon left
      if (encounter.misc.safariPokemonRemaining > 0) {
        await summonSafariPokemon();
        initSubsequentOptionSelect({
          overrideOptions: safariZoneGameOptions,
          startingCursorIndex: 3,
          hideDescription: true,
        });
      } else {
        // End safari mode
        encounter.continuousEncounter = false;
        leaveEncounterWithoutBattle(true);
      }
      return true;
    })
    .build(),
];

function buildMultiplayerSafariZoneGameOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return ([1, 2, 3, 4] as const).map(optionIndex =>
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:safari.${optionIndex}.label`,
        buttonTooltip: `${namespace}:safari.${optionIndex}.tooltip`,
      })
      .withOptionPhase(async () => handleSafariActionChoice(optionIndex, playerIndex, optionIndex - 1))
      .build(),
  );
}

async function summonSafariPokemon() {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  // Message pokemon remaining
  encounter.setDialogueToken("remainingCount", encounter.misc.safariPokemonRemaining);
  globalScene.phaseManager.queueMessage(getEncounterText(`${namespace}:safari.remainingCount`) ?? "", null, true);

  // Generate pokemon using safariPokemonRemaining so they are always the same pokemon no matter how many turns are taken
  // Safari pokemon roll twice on shiny and HA chances, but are otherwise normal
  let pokemon: any;
  globalScene.executeWithSeedOffset(
    () => {
      console.log("Event chance %d", eventChance.value);
      const fromEvent = new BooleanHolder(false);
      pokemon = getRandomEncounterPokemon({
        level: globalScene.currentBattle.getLevelForWave(),
        includeLegendary: false,
        includeSubLegendary: false,
        includeMythical: false,
        speciesFunction: getSafariSpeciesSpawn,
        shinyRerolls: 1,
        eventShinyRerolls: 1,
        hiddenRerolls: 1,
        eventHiddenRerolls: 1,
        eventChance: eventChance.value,
        isEventEncounter: fromEvent,
      });

      pokemon.init();

      // Increase chance of event encounter by 25% until one spawns
      if (fromEvent.value) {
        console.log("Safari zone encounter is from event");
        eventEncs.value++;
        eventChance.value = 50;
      } else if (eventEncs.value === 0) {
        console.log("Safari zone encounter is not from event");
        eventChance.value += 25;
      }

      globalScene.currentBattle.enemyParty.unshift(pokemon);
    },
    globalScene.currentBattle.waveIndex * 1000 * encounter.misc.safariPokemonRemaining,
  );

  globalScene.gameData.setPokemonSeen(pokemon, true);
  await pokemon.loadAssets();

  // Reset safari catch and flee rates
  encounter.misc.catchStage = 0;
  encounter.misc.fleeStage = 0;
  encounter.misc.pokemon = pokemon;
  encounter.misc.safariPokemonRemaining -= 1;

  globalScene.phaseManager.unshiftNew("SummonPhase", 0, false);
  globalScene.phaseManager.unshiftNew("PostSummonPhase", BattlerIndex.ENEMY);

  encounter.setDialogueToken("pokemonName", getPokemonNameWithAffix(pokemon));

  // TODO: If we await showEncounterText here, then the text will display without
  // the wild Pokemon on screen, but if we don't await it, then the text never
  // shows up and the IV scanner breaks. For now, we place the IV scanner code
  // separately so that at least the IV scanner works.

  const ivScannerModifier = globalScene.twoPlayerMode
    ? globalScene.findModifierForPlayer(m => m instanceof IvScannerModifier, globalScene.activePlayerIndex)
    : globalScene.findModifier(m => m instanceof IvScannerModifier);
  if (ivScannerModifier) {
    globalScene.phaseManager.pushNew("ScanIvsPhase", pokemon.getBattlerIndex());
  }
}

function throwPokeball(
  pokemon: EnemyPokemon,
  catchStage = globalScene.currentBattle.mysteryEncounter!.misc.catchStage,
  playerIndex: PlayerIndex = globalScene.activePlayerIndex,
): Promise<boolean> {
  const baseCatchRate = pokemon.species.catchRate;
  // Catch modifier ranges from 2/8 (-6 stage) to 8/2 (+6)
  const safariModifier =
    (2 + Math.min(Math.max(catchStage, 0), 6)) / (2 - Math.max(Math.min(catchStage, 0), -6));
  // Catch rate same as safari ball
  const pokeballMultiplier = 1.5;
  const catchRate = Math.round(baseCatchRate * pokeballMultiplier * safariModifier);
  const ballTwitchRate = Math.round(1048560 / Math.sqrt(Math.sqrt(16711680 / catchRate)));
  return trainerThrowPokeball(pokemon, PokeballType.SAFARI_BALL, ballTwitchRate, playerIndex);
}

async function throwBait(pokemon: EnemyPokemon, playerIndex: PlayerIndex = globalScene.activePlayerIndex): Promise<boolean> {
  const originalY: number = pokemon.y;

  const fpOffset = pokemon.getFieldPositionOffset();
  const trainerSprite = getSafariTrainerSprite(playerIndex);
  const baitX = trainerSprite.x;
  const bait: Phaser.GameObjects.Sprite = globalScene.addFieldSprite(baitX, 80 + 25, "safari_zone_bait", "0001.png");
  bait.setOrigin(0.5, 0.625);
  globalScene.field.add(bait);

  return new Promise(resolve => {
    trainerSprite.setVisible(true);
    trainerSprite.setTexture(globalScene.getTrainerBackTextureKey(playerIndex, true));
    playTrainerThrowAnimation(trainerSprite, {
      releaseDelay: TRAINER_THROW_ANIMATION_TIMES[0],
      windupDelay: TRAINER_THROW_ANIMATION_TIMES[0],
      frameDuration: TRAINER_THROW_ANIMATION_TIMES[1],
    });
    globalScene.time.delayedCall(
      TRAINER_THROW_ANIMATION_TIMES[0] + TRAINER_THROW_ANIMATION_TIMES[1] + TRAINER_THROW_ANIMATION_TIMES[2],
      () => trainerSprite.setTexture(globalScene.getTrainerBackTextureKey(playerIndex)),
    );
    globalScene.time.delayedCall(TRAINER_THROW_ANIMATION_TIMES[0], () => {
      audioManager.playSound("se/pb_throw");

      // Pokeball move and catch logic
      globalScene.tweens.add({
        targets: bait,
        x: { value: 210 + fpOffset[0], ease: "Linear" },
        y: { value: 55 + fpOffset[1], ease: "Cubic.easeOut" },
        duration: 500,
        onComplete: () => {
          let index = 1;
          globalScene.time.delayedCall(768, () => {
            globalScene.tweens.add({
              targets: pokemon,
              duration: 150,
              ease: "Cubic.easeOut",
              yoyo: true,
              y: originalY - 5,
              loop: 6,
              onStart: () => {
                audioManager.playSound("battle_anims/PRSFX- Bug Bite");
                bait.setFrame("0002.png");
              },
              onLoop: () => {
                if (index % 2 === 0) {
                  audioManager.playSound("battle_anims/PRSFX- Bug Bite");
                }
                if (index === 4) {
                  bait.setFrame("0003.png");
                }
                index++;
              },
              onComplete: () => {
                globalScene.time.delayedCall(256, () => {
                  bait.destroy();
                  resolve(true);
                });
              },
            });
          });
        },
      });
    });
  });
}

async function throwMud(pokemon: EnemyPokemon, playerIndex: PlayerIndex = globalScene.activePlayerIndex): Promise<boolean> {
  const originalY: number = pokemon.y;

  const fpOffset = pokemon.getFieldPositionOffset();
  const trainerSprite = getSafariTrainerSprite(playerIndex);
  const mudX = trainerSprite.x;
  const mud: Phaser.GameObjects.Sprite = globalScene.addFieldSprite(mudX, 80 + 35, "safari_zone_mud", "0001.png");
  mud.setOrigin(0.5, 0.625);
  globalScene.field.add(mud);

  return new Promise(resolve => {
    trainerSprite.setVisible(true);
    trainerSprite.setTexture(globalScene.getTrainerBackTextureKey(playerIndex, true));
    playTrainerThrowAnimation(trainerSprite, {
      releaseDelay: TRAINER_THROW_ANIMATION_TIMES[0],
      windupDelay: TRAINER_THROW_ANIMATION_TIMES[0],
      frameDuration: TRAINER_THROW_ANIMATION_TIMES[1],
    });
    globalScene.time.delayedCall(
      TRAINER_THROW_ANIMATION_TIMES[0] + TRAINER_THROW_ANIMATION_TIMES[1] + TRAINER_THROW_ANIMATION_TIMES[2],
      () => trainerSprite.setTexture(globalScene.getTrainerBackTextureKey(playerIndex)),
    );
    globalScene.time.delayedCall(TRAINER_THROW_ANIMATION_TIMES[0], () => {
      audioManager.playSound("se/pb_throw");

      // Mud throw and splat
      globalScene.tweens.add({
        targets: mud,
        x: { value: 230 + fpOffset[0], ease: "Linear" },
        y: { value: 55 + fpOffset[1], ease: "Cubic.easeOut" },
        duration: 500,
        onComplete: () => {
          // Mud frame 2
          audioManager.playSound("battle_anims/PRSFX- Sludge Bomb2");
          mud.setFrame("0002.png");
          // Mud splat
          globalScene.time.delayedCall(200, () => {
            mud.setFrame("0003.png");
            globalScene.time.delayedCall(400, () => {
              mud.setFrame("0004.png");
            });
          });

          // Fade mud then angry animation
          globalScene.tweens.add({
            targets: mud,
            alpha: 0,
            ease: "Cubic.easeIn",
            duration: 1000,
            onComplete: () => {
              mud.destroy();
              globalScene.tweens.add({
                targets: pokemon,
                duration: 300,
                ease: "Cubic.easeOut",
                yoyo: true,
                y: originalY - 20,
                loop: 1,
                onStart: () => {
                  audioManager.playSound("battle_anims/PRSFX- Taunt2");
                },
                onLoop: () => {
                  audioManager.playSound("battle_anims/PRSFX- Taunt2");
                },
                onComplete: () => {
                  resolve(true);
                },
              });
            },
          });
        },
      });
    });
  });
}

function isPokemonFlee(pokemon: EnemyPokemon, fleeStage: number): boolean {
  const speciesCatchRate = pokemon.species.catchRate;
  const fleeModifier = (2 + Math.min(Math.max(fleeStage, 0), 6)) / (2 - Math.max(Math.min(fleeStage, 0), -6));
  const fleeRate = ((255 * 255 - speciesCatchRate * speciesCatchRate) / 255 / 2) * fleeModifier;
  console.log("Flee rate: " + fleeRate);
  const roll = randSeedInt(256);
  console.log("Roll: " + roll);
  return roll < fleeRate;
}

function tryChangeFleeStage(change: number, chance?: number): boolean {
  if (chance && randSeedInt(10) >= chance) {
    return false;
  }
  const currentFleeStage = globalScene.currentBattle.mysteryEncounter!.misc.fleeStage ?? 0;
  globalScene.currentBattle.mysteryEncounter!.misc.fleeStage = Math.min(Math.max(currentFleeStage + change, -6), 6);
  return true;
}

function tryChangeCatchStage(change: number, chance?: number): boolean {
  if (chance && randSeedInt(10) >= chance) {
    return false;
  }
  const currentCatchStage = globalScene.currentBattle.mysteryEncounter!.misc.catchStage ?? 0;
  globalScene.currentBattle.mysteryEncounter!.misc.catchStage = Math.min(Math.max(currentCatchStage + change, -6), 6);
  return true;
}

async function doEndTurn(cursorIndex: number) {
  // First cleanup and destroy old Pokemon objects that were left in the enemyParty
  // They are left in enemyParty temporarily so that VictoryPhase properly handles EXP
  const party = globalScene.getEnemyParty();
  if (party.length > 1) {
    for (let i = 1; i < party.length; i++) {
      party[i].destroy();
    }
    globalScene.currentBattle.enemyParty = party.slice(0, 1);
  }

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const pokemon = encounter.misc.pokemon;
  const isFlee = isPokemonFlee(pokemon, encounter.misc.fleeStage);
  if (isFlee) {
    // Pokemon flees!
    await doPokemonFlee(pokemon);
    // Check how many safari pokemon left
    if (encounter.misc.safariPokemonRemaining > 0) {
      await summonSafariPokemon();
      initSubsequentOptionSelect({
        overrideOptions: safariZoneGameOptions,
        startingCursorIndex: cursorIndex,
        hideDescription: true,
      });
    } else {
      // End safari mode
      encounter.continuousEncounter = false;
      leaveEncounterWithoutBattle(true);
    }
  } else {
    encounter.setDialogueToken("pokemonName", getPokemonNameWithAffix(pokemon));
    globalScene.phaseManager.queueMessage(getEncounterText(`${namespace}:safari.watching`) ?? "", 0, null, 1000);
    initSubsequentOptionSelect({
      overrideOptions: safariZoneGameOptions,
      startingCursorIndex: cursorIndex,
      hideDescription: true,
    });
  }
}

/**
 * @returns A function to get a random species that has at most 5 starter cost and is not Mythical, Paradox, etc.
 */
export function getSafariSpeciesSpawn(): PokemonSpecies {
  return getPokemonSpecies(
    getRandomSpeciesByStarterCost([0, 5], NON_LEGEND_PARADOX_POKEMON, undefined, false, false, false),
  );
}
