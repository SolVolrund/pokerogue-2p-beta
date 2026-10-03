import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement, MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { restoreGameCornerBgm, startGameCornerBgm } from "#mystery-encounters/game-corner-music";
import {
  getMysteryEncounterPlayerIndexes,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { PlayerPokemon } from "#field/pokemon";
import i18next from "i18next";

const namespace = "mysteryEncounters/gameCorner";

const INVESTIGATIVE_MOVES = [
  MoveId.ODOR_SLEUTH,
  MoveId.MIRACLE_EYE,
  MoveId.FORESIGHT,
  MoveId.MIND_READER,
  MoveId.LOCK_ON,
  MoveId.DETECT,
];

interface GameCornerVisitData {
  gameCornerChoices?: Partial<Record<PlayerIndex, number>>;
  skipSelectedDialogueOnce?: boolean;
  rocketHqDiscovered?: boolean;
}

class GameCornerSlotMachineRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return false;
  }

  override getDialogueToken(): [string, string] {
    return ["availability", i18next.t(`${namespace}:option.2.tooltip`)];
  }
}

class RocketHqVisitRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return !globalScene.mysteryEncounterSaveData.rocketHqVisited;
  }

  override getDialogueToken(): [string, string] {
    return ["availability", i18next.t(`${namespace}:option.3.${this.meetsRequirement() ? "available" : "visited"}`)];
  }
}

class GameCornerMoveRequirement extends MoveRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super(INVESTIGATIVE_MOVES, true);
  }

  override queryParty(_party: PlayerPokemon[]): PlayerPokemon[] {
    return super.queryParty(globalScene.getPlayerParty(this.playerIndex));
  }
}

function getVisitData(): GameCornerVisitData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc ??= {};
  return encounter.misc;
}

function buildGameCornerOption(playerIndex: PlayerIndex, optionIndex: number) {
  const builder = MysteryEncounterOptionBuilder.newOptionWithMode(
    optionIndex === 1
      ? MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
      : optionIndex === 2
        ? MysteryEncounterOptionMode.DISABLED_OR_SPECIAL
        : MysteryEncounterOptionMode.DEFAULT,
  )
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex + 1}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex + 1}.tooltip`,
    })
    .withPreOptionPhase(() => recordGameCornerChoice(playerIndex, optionIndex))
    .withOptionPhase(startGameCornerVisits)
    .withPostOptionPhase(enterDiscoveredRocketHq);
  if (optionIndex === 1) {
    builder.withSceneRequirement(new GameCornerSlotMachineRequirement());
  }
  if (optionIndex === 2) {
    builder.withSceneRequirement(new RocketHqVisitRequirement());
    builder.withPrimaryPokemonRequirement(new GameCornerMoveRequirement(playerIndex));
  }
  return builder.build();
}

async function recordGameCornerChoice(playerIndex: PlayerIndex, optionIndex: number): Promise<boolean> {
  if (optionIndex === 1 || (optionIndex === 2 && globalScene.mysteryEncounterSaveData.rocketHqVisited)) {
    return false;
  }
  const data = getVisitData();
  data.gameCornerChoices ??= {};
  data.gameCornerChoices[playerIndex] = optionIndex;
  if (optionIndex === 2) {
    data.rocketHqDiscovered = true;
  }
  const players = getMysteryEncounterPlayerIndexes();
  const nextHuman = players.find(index => index > playerIndex && !globalScene.isComputerPartnerPlayer(index));
  if (nextHuman !== undefined) {
    await showMysteryEncounterPlayerMenu({
      playerIndex: nextHuman,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: [0, 1, 2, 3].map(option => buildGameCornerOption(nextHuman, option)),
    });
    return false;
  }
  data.skipSelectedDialogueOnce = true;
  return true;
}

async function startGameCornerVisits(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choices = getVisitData().gameCornerChoices ?? {};
  const players = getMysteryEncounterPlayerIndexes();
  const participants = players.filter(player => globalScene.isComputerPartnerPlayer(player) || choices[player] === 0);
  for (const player of players) {
    if (globalScene.isComputerPartnerPlayer(player) || choices[player] === 0) {
      continue;
    }
    globalScene.waitForPlayerSideProgressionInput(player);
    if (choices[player] === 2) {
      const pokemon = new GameCornerMoveRequirement(player).queryParty(globalScene.getPlayerParty(player))[0];
      encounter.setDialogueToken("option3PrimaryName", pokemon?.getNameToRender() ?? "");
    }
    await showEncounterText(`${namespace}:option.${(choices[player] ?? 3) + 1}.selected`);
  }
  if (participants.length === 0) {
    restoreGameCornerBgm();
    leaveEncounterWithoutBattle(true);
    return;
  }
  encounter.encounterMode = MysteryEncounterMode.NO_BATTLE;
  participants.forEach((player, index) => {
    globalScene.phaseManager.pushNew("VoltorbFlipPhase", player, index === participants.length - 1);
  });
}

async function enterDiscoveredRocketHq(): Promise<void> {
  const data = getVisitData();
  if (!data.rocketHqDiscovered || globalScene.mysteryEncounterSaveData.rocketHqVisited) {
    return;
  }
  data.rocketHqDiscovered = false;
  globalScene.mysteryEncounterSaveData.rocketHqVisited = true;
  globalScene.waitForPlayerSideProgressionInput();
  await showEncounterText(`${namespace}:enterRocketHq`);
  globalScene.phaseManager.unshiftNew("SwitchBiomePhase", BiomeId.ROCKET_HQ);
}

export const GameCornerEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.GAME_CORNER,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([
    {
      spriteKey: "dealer",
      fileRoot: "game_corner",
      disableAnimation: true,
      hasShadow: false,
      scale: 1.5,
      x: 5,
      y: 8,
    },
  ])
  .withOnVisualsStart(() => {
    startGameCornerBgm();
    return true;
  })
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildGameCornerOption(0, 0))
  .withOption(buildGameCornerOption(0, 1))
  .withOption(buildGameCornerOption(0, 2))
  .withOption(buildGameCornerOption(0, 3))
  .build();
