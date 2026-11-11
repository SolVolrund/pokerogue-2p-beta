import type { PlayerIndex } from "#app/battle-scene";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { type BallDesign, designBattleFrame, KURT_OFFER_POOL } from "#data/ball-design";
import { getPokeballDescription, getPokeballDisplayName, MAX_PER_TYPE_POKEBALLS } from "#data/pokeball";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { randSeedShuffle } from "#utils/common";
import i18next from "i18next";

const ns = "mysteryEncounters/captureCustomizer";
const base = PokeballType.POKEBALL;
const gift = 10;

interface Visit {
  offers: BallDesign[];
  choices: Partial<Record<PlayerIndex, number>>;
  finished?: boolean;
}

function visit(): Visit {
  return globalScene.currentBattle.mysteryEncounter!.misc as Visit;
}

async function choose(slot: number, owner: PlayerIndex): Promise<boolean> {
  visit().choices[owner] = globalScene.canPlayerReceivePokeballRewards(owner) ? slot : 3;
  const next = getNextMysteryEncounterPlayerIndex(owner);
  if (next === undefined) return true;
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex: next,
    overrideOptions: [0, 1, 2, 3].map(i => option(i, next)),
    overrideQuery: i18next.t(`${ns}:query`),
    computerPartnerOption: {
      chooseOptionIndex: player => (globalScene.canPlayerReceivePokeballRewards(player) ? player % 3 : 3),
      onOptionChosen: choose,
    },
  });
  return result ?? false;
}

async function finish(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (visit().finished) return;
  visit().finished = true;
  for (const player of getMysteryEncounterPlayerIndexes()) {
    const choice = visit().choices[player];
    const design = choice === undefined ? undefined : visit().offers[choice];
    globalScene.waitForPlayerSideProgressionInput(globalScene.isComputerPartnerPlayer(player) ? 0 : player);
    encounter.setDialogueToken("playerName", globalScene.getPlayerDisplayName(player));
    if (!design) {
      await showEncounterDialogue(`${ns}:decline`, `${ns}:speaker`);
      continue;
    }
    globalScene.getPlayerState(player).ballDesign = design;
    const inventory = globalScene.getPlayerPokeballCounts(player);
    const before = inventory[base] ?? 0;
    inventory[base] = Math.min(MAX_PER_TYPE_POKEBALLS, before + gift);
    encounter.setDialogueToken("ballName", getPokeballDisplayName(base, design));
    encounter.setDialogueToken("amount", String(inventory[base] - before));
    await showEncounterText(`${ns}:accept`);
    await showEncounterText(`${ns}:received`);
  }
  globalScene.waitForPlayerSideProgressionInput(0);
  leaveEncounterWithoutBattle();
}

function option(slot: number, owner: PlayerIndex = 0) {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: slot === 3 ? `${ns}:noThanks` : `{{ball${slot}}}`,
      ...(slot < 3 && { buttonIcon: () => ({ texture: "pb", frame: designBattleFrame(visit().offers[slot]) }) }),
      buttonTooltip: slot === 3 ? `${ns}:keep` : `${ns}:tooltip${slot}`,
    })
    .withPreOptionPhase(() => choose(slot, owner))
    .withOptionPhase(finish)
    .build();
}

export const CaptureCustomizerEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.CAPTURE_CUSTOMIZER,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withMaxAllowedEncounters(1)
  .withIntroSpriteConfigs([{ spriteKey: "kurt_kyledove", fileRoot: "mystery-encounters", hasShadow: true }])
  .withAutoHideIntroVisuals(false)
  .withIntroDialogue([{ text: `${ns}:intro` }, { text: `${ns}:greeting`, speaker: `${ns}:speaker` }])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const offers = randSeedShuffle([...KURT_OFFER_POOL]).slice(0, 3);
    encounter.misc = { offers, choices: {} } satisfies Visit;
    offers.forEach((design, i) => {
      encounter.setDialogueToken(`ball${i}`, getPokeballDisplayName(base, design));
      encounter.setDialogueToken(`detail${i}`, getPokeballDescription(base, design));
    });
    return true;
  })
  .setLocalizationKey(ns)
  .withTitle(`${ns}:title`)
  .withDescription(`${ns}:description`)
  .withQuery(`${ns}:query`)
  .withOption(option(0))
  .withOption(option(1))
  .withOption(option(2))
  .withOption(option(3))
  .build();

CaptureCustomizerEncounter.acceptPrivateChoices = choices => {
  for (const player of getMysteryEncounterPlayerIndexes()) {
    visit().choices[player] = globalScene.canPlayerReceivePokeballRewards(player) ? choices[player] : 3;
  }
};
