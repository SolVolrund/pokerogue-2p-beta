import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Stat, type BattleStat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import { modifyPlayerPokemonBST } from "#mystery-encounters/encounter-pokemon-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/theStrongStuff";

// Halved for HP stat
const HIGH_BST_REDUCTION_VALUE = 15;
const BST_INCREASE_VALUE = 10;
const MIN_PARTY_SIZE_FOR_STRONG_STUFF = 3;

type StrongStuffOptionIndex = 1 | 2;

interface StrongStuffChoice {
  playerIndex: PlayerIndex;
  optionIndex: StrongStuffOptionIndex;
}

interface StrongStuffData {
  choices: StrongStuffChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class StrongStuffSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return globalScene.getPlayerParty().length >= MIN_PARTY_SIZE_FOR_STRONG_STUFF;
    }

    return getMysteryEncounterPlayerIndexes().every(
      playerIndex => globalScene.getPlayerParty(playerIndex).length >= MIN_PARTY_SIZE_FOR_STRONG_STUFF,
    );
  }

  override getDialogueToken(): [string, string] {
    return ["partySize", MIN_PARTY_SIZE_FOR_STRONG_STUFF.toString()];
  }
}

function getStrongStuffData(): StrongStuffData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies StrongStuffData;
  }

  return encounter.misc as StrongStuffData;
}

function chooseComputerPartnerStrongStuffOption(playerIndex: PlayerIndex): StrongStuffOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return confidence.level === "medium" || confidence.level === "high" ? 2 : 1;
}

function queueComputerPartnerStrongStuffChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: StrongStuffOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionNames: Record<StrongStuffOptionIndex, string> = {
    1: "Approach carefully",
    2: "Battle Shuckle",
  };
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionNames[optionIndex]}.`, null, true);
}

function buildStrongStuffPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildStrongStuffApproachOption(playerIndex), buildStrongStuffBattleOption(playerIndex)];
}

async function promptNextStrongStuffPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: "What will you do?",
    overrideOptions: buildStrongStuffPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerStrongStuffOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeStrongStuffChoice(optionIndex as StrongStuffOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function storeStrongStuffChoice(optionIndex: StrongStuffOptionIndex, playerIndex: PlayerIndex): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getStrongStuffData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerStrongStuffChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptNextStrongStuffPlayer(nextPlayerIndex, optionIndex - 1);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function getShucklePokemonConfig(): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(SpeciesId.SHUCKLE),
    isBoss: true,
    bossSegments: 5,
    shiny: false, // Shiny lock because shiny is rolled only if the battle option is picked
    customPokemonData: new CustomPokemonData({ spriteScale: 1.25 }),
    nature: Nature.HARDY,
    moveSet: [MoveId.INFESTATION, MoveId.SALT_CURE, MoveId.GASTRO_ACID, MoveId.HEAL_ORDER],
    modifierConfigs: [
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.SITRUS]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.ENIGMA]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.APICOT]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.GANLON]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.LUM]) as PokemonHeldItemModifierType,
        stackCount: 2,
      },
    ],
    tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
    mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
      queueEncounterMessage(`${namespace}:option.2.statBoost`);
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
        battlerIndex: pokemon.getBattlerIndex(),
        changes: ([Stat.DEF, Stat.SPDEF] as BattleStat[]).map(stat => ({ stat, stages: 1 })),
        sourcePokemon: pokemon,
      });
    },
  };
}

function createShuckleEnemyPartyConfig(shuckleCount: 1 | 2 | 3): EnemyPartyConfig {
  return {
    levelAdditiveModifier: 1,
    disableSwitch: true,
    doubleBattle: shuckleCount > 1,
    pokemonConfigs: Array.from({ length: shuckleCount }, () => getShucklePokemonConfig()),
  };
}

function queueShuckleStartOfBattleEffects(playerIndexes: PlayerIndex[], shuckleCount: 1 | 2 | 3): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.startOfBattleEffects.push(
    ...Array.from({ length: shuckleCount }, (_unused, fieldIndex) => {
      const sourceBattlerIndex = globalScene.getEnemyBattlerIndex(fieldIndex);
      const target = globalScene.getPlayerBattlerIndex(
        Math.min(fieldIndex, Math.max(playerIndexes.length - 1, 0)),
      );
      return [
        {
          sourceBattlerIndex,
          targets: [target],
          move: new PokemonMove(MoveId.GASTRO_ACID),
          useMode: MoveUseMode.IGNORE_PP,
        },
        {
          sourceBattlerIndex,
          targets: [target],
          move: new PokemonMove(MoveId.STEALTH_ROCK),
          useMode: MoveUseMode.IGNORE_PP,
        },
      ];
    }).flat(),
  );
}

function setStrongStuffBattleReward(playerIndex: PlayerIndex): void {
  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.SOUL_DEW],
      fillRemaining: true,
    },
    undefined,
    undefined,
    playerIndex,
  );
}

async function hideStrongStuffNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  await Promise.all(
    getMysteryEncounterPlayerIndexes()
      .filter(playerIndex => !battlePlayerSet.has(playerIndex))
      .map(
        playerIndex =>
          new Promise<void>(resolve => {
            const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
            globalScene.tweens.killTweensOf(trainerSprite);

            if (!trainerSprite.visible) {
              resolve();
              return;
            }

            globalScene.tweens.add({
              targets: trainerSprite,
              x: -36,
              duration: 500,
              onComplete: () => {
                trainerSprite.setVisible(false);
                resolve();
              },
            });
          }),
      ),
  );
}

function applyStrongStuffApproachStatChanges(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;

  const sortedParty = globalScene
    .getPlayerParty(playerIndex)
    .slice(0)
    .sort((pokemon1, pokemon2) => {
      const pokemon1Bst = pokemon1.getSpeciesForm().getBaseStatTotal();
      const pokemon2Bst = pokemon2.getSpeciesForm().getBaseStatTotal();
      return pokemon2Bst - pokemon1Bst;
    });

  for (const [index, pokemon] of sortedParty.entries()) {
    if (index < 2) {
      modifyPlayerPokemonBST(pokemon, false);
      encounter.setDialogueToken("highBstPokemon" + (index + 1), pokemon.getNameToRender());
    } else {
      modifyPlayerPokemonBST(pokemon, true);
    }
  }

  encounter.setDialogueToken("reductionValue", HIGH_BST_REDUCTION_VALUE.toString());
  encounter.setDialogueToken("increaseValue", BST_INCREASE_VALUE.toString());
}

async function applyStrongStuffApproachEffect(playerIndex: PlayerIndex): Promise<void> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  applyStrongStuffApproachStatChanges(playerIndex);
  await showEncounterText(`${namespace}:option.1.selected2`, null, undefined, true);
  setEncounterRewards({ fillRemaining: true }, undefined, undefined, playerIndex);
}

function queueStrongStuffPostBattleApproachEffects(approachPlayers: PlayerIndex[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.onRewards = async () => {
    for (const playerIndex of approachPlayers) {
      await applyStrongStuffApproachEffect(playerIndex);
    }
    encounter.onRewards = undefined;
  };
}

function buildStrongStuffApproachOption(playerIndex: PlayerIndex) {
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
    .withPreOptionPhase(async () => storeStrongStuffChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerStrongStuffChoices() : runOnePlayerApproachShuckle(),
    )
    .build();
}

function buildStrongStuffBattleOption(playerIndex: PlayerIndex) {
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
    .withPreOptionPhase(async () => storeStrongStuffChoice(2, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerStrongStuffChoices() : runOnePlayerBattleShuckle(),
    )
    .build();
}

async function runOnePlayerApproachShuckle(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  // Do blackout and hide intro visuals during blackout
  globalScene.time.delayedCall(750, () => {
    transitionMysteryEncounterIntroVisuals(true, true, 50);
  });

  await applyStrongStuffApproachEffect(0);
  encounter.dialogue.outro = [
    {
      text: `${namespace}:outro`,
    },
  ];
  leaveEncounterWithoutBattle(true);
  return true;
}

async function runOnePlayerBattleShuckle(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  setStrongStuffBattleReward(0);
  queueShuckleStartOfBattleEffects([0], 1);

  encounter.dialogue.outro = [];
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

async function runTwoPlayerStrongStuffChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const choices = getStrongStuffData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const approachChoices = choices.filter(choice => choice.optionIndex === 1);
  const battleChoices = choices.filter(choice => choice.optionIndex === 2);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
  }

  if (approachChoices.length > 0 && battleChoices.length === 0) {
    globalScene.time.delayedCall(750, () => {
      transitionMysteryEncounterIntroVisuals(true, true, 50);
    });

    for (const choice of approachChoices) {
      await applyStrongStuffApproachEffect(choice.playerIndex);
    }
  }

  if (battleChoices.length === 0) {
    encounter.dialogue.outro = [
      {
        text: `${namespace}:outro`,
      },
    ];
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const battlePlayers = battleChoices.map(choice => choice.playerIndex);
  const shuckleCount = battlePlayers.length as 1 | 2 | 3;
  for (const playerIndex of battlePlayers) {
    setStrongStuffBattleReward(playerIndex);
  }

  encounter.dialogue.outro = [];
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  await hideStrongStuffNonBattleTrainers(battlePlayers);
  if (approachChoices.length > 0) {
    queueStrongStuffPostBattleApproachEffects(approachChoices.map(choice => choice.playerIndex));
  }
  queueShuckleStartOfBattleEffects(battlePlayers, shuckleCount);
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await initBattleWithEnemyConfig(createShuckleEnemyPartyConfig(shuckleCount));
  return true;
}

/**
 * The Strong Stuff encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3803 | GitHub Issue #3803}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TheStrongStuffEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.THE_STRONG_STUFF,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new StrongStuffSpawnRequirement()) // Both 2P players must have at least 3 Pokemon
  .withMaxAllowedEncounters(1)
  .withHideWildIntroMessage(true)
  .withAutoHideIntroVisuals(false)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "berry_juice_good",
      fileRoot: "items",
      hasShadow: true,
      isItem: true,
      scale: 1.25,
      x: -15,
      y: 3,
      disableAnimation: true,
    },
    {
      species: SpeciesId.SHUCKLE,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      repeat: true,
      scale: 1.25,
      x: 20,
      y: 10,
      yShadow: 7,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.enemyPartyConfigs = [createShuckleEnemyPartyConfig(1)];
    if (globalScene.twoPlayerMode) {
      encounter.misc = {
        ...(encounter.misc ?? {}),
        choices: [],
      } satisfies StrongStuffData;
    }

    loadCustomMovesForEncounter([MoveId.GASTRO_ACID, MoveId.STEALTH_ROCK]);

    encounter.setDialogueToken("shuckleName", getPokemonSpecies(SpeciesId.SHUCKLE).getName());

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildStrongStuffApproachOption(0))
  .withOption(buildStrongStuffBattleOption(0))
  .build();
