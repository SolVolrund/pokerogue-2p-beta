import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
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
import { MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { restoreGameCornerBgm, startGameCornerBgm } from "#mystery-encounters/game-corner-music";

const namespace = "mysteryEncounters/gameCorner";

const INVESTIGATIVE_MOVES = [
  MoveId.ODOR_SLEUTH,
  MoveId.MIRACLE_EYE,
  MoveId.FORESIGHT,
  MoveId.MIND_READER,
  MoveId.LOCK_ON,
  MoveId.DETECT,
];

async function startVoltorbFlip(): Promise<void> {
  globalScene.currentBattle.mysteryEncounter!.encounterMode = MysteryEncounterMode.NO_BATTLE;
  globalScene.phaseManager.pushNew("VoltorbFlipPhase");
}

async function handleSlotMachineUnavailable(): Promise<void> {
  restoreGameCornerBgm();
  await leaveEncounterWithoutBattle(true);
}

async function handleStakeOut(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const pokemon = encounter.selectedOption?.primaryPokemon;
  const move = pokemon?.moveset.find(pokemonMove =>
    pokemonMove != null && INVESTIGATIVE_MOVES.includes(pokemonMove.moveId),
  );

  encounter.setDialogueToken("option3PrimaryName", pokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("option3PrimaryMove", move?.getName() ?? "");
  await showEncounterText(`${namespace}:stakeOutPlaceholder`);
  restoreGameCornerBgm();
  await leaveEncounterWithoutBattle(true);
}

async function leaveGameCorner(): Promise<void> {
  restoreGameCornerBgm();
  await leaveEncounterWithoutBattle(true);
}

export const GameCornerEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.GAME_CORNER,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([
    {
      spriteKey: "worker_f",
      fileRoot: "trainer",
      hasShadow: true,
      y: 4,
      alpha: 1,
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
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [{ text: `${namespace}:option.1.selected` }],
      })
      .withOptionPhase(startVoltorbFlip)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [{ text: `${namespace}:option.2.selected` }],
      })
      .withOptionPhase(handleSlotMachineUnavailable)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      .withDialogue({
        buttonLabel: `${namespace}:option.3.label`,
        buttonTooltip: `${namespace}:option.3.tooltip`,
        selected: [{ text: `${namespace}:option.3.selected` }],
      })
      .withPrimaryPokemonRequirement(new MoveRequirement(INVESTIGATIVE_MOVES, true))
      .withOptionPhase(handleStakeOut)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.4.label`,
        buttonTooltip: `${namespace}:option.4.tooltip`,
        selected: [{ text: `${namespace}:option.4.selected` }],
      })
      .withOptionPhase(leaveGameCorner)
      .build(),
  )
  .build();
