import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { CustomPokemonData } from "#data/pokemon-data";
import { AiType } from "#enums/ai-type";
import { BerryType } from "#enums/berry-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemon, PlayerPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterExp,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement, MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { STEALING_MOVES } from "#mystery-encounters/requirement-groups";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import {
  getBestComputerPartnerReplacementSlot,
  getComputerPartnerProfile,
  getComputerPartnerProfileWithRolePreferences,
} from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** i18n namespace for the encounter */
const namespace = "mysteryEncounters/slumberingSnorlax";

type SlumberingSnorlaxOptionIndex = 1 | 2 | 3;

interface SlumberingSnorlaxChoice {
  playerIndex: PlayerIndex;
  optionIndex: SlumberingSnorlaxOptionIndex;
}

interface SlumberingSnorlaxOffer {
  playerIndex: PlayerIndex;
  bossConfig: EnemyPokemonConfig;
}

interface SlumberingSnorlaxData {
  offers: SlumberingSnorlaxOffer[];
  choices: SlumberingSnorlaxChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class PlayerStealingMoveRequirement extends EncounterPokemonRequirement {
  private readonly moveRequirement = new MoveRequirement(STEALING_MOVES, true);

  constructor(private readonly playerIndex: PlayerIndex) {
    super();
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryPlayerParty().length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.queryPlayerParty();
  }

  override getDialogueToken(pokemon?: PlayerPokemon): [string, string] {
    return this.moveRequirement.getDialogueToken(pokemon);
  }

  private queryPlayerParty(): PlayerPokemon[] {
    return this.moveRequirement.queryParty(globalScene.getPlayerParty(this.playerIndex));
  }
}

function getSnorlaxPokemonConfig(): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(SpeciesId.SNORLAX),
    isBoss: true,
    shiny: false, // Shiny lock because shiny is rolled only if the battle option is picked
    status: [StatusEffect.SLEEP, 6], // Extra turns on timer for Snorlax's start of fight moves
    nature: Nature.DOCILE,
    moveSet: [MoveId.BODY_SLAM, MoveId.CRUNCH, MoveId.SLEEP_TALK, MoveId.REST],
    modifierConfigs: [
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.SITRUS]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.BERRY, [BerryType.ENIGMA]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.BASE_STAT_BOOSTER, [Stat.HP]) as PokemonHeldItemModifierType,
      },
      {
        modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
        stackCount: randSeedInt(2, 0),
      },
      {
        modifier: generateModifierType(modifierTypes.LUCKY_EGG) as PokemonHeldItemModifierType,
        stackCount: randSeedInt(2, 0),
      },
    ],
    customPokemonData: new CustomPokemonData({ spriteScale: 1.25 }),
    aiType: AiType.SMART, // Required to ensure Snorlax uses Sleep Talk while it is asleep
  };
}

function getSlumberingSnorlaxData(): SlumberingSnorlaxData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      offers: getMysteryEncounterPlayerIndexes().map(playerIndex => ({
        playerIndex,
        bossConfig: getSnorlaxPokemonConfig(),
      })),
      choices: [],
    } satisfies SlumberingSnorlaxData;
  }

  return encounter.misc as SlumberingSnorlaxData;
}

function getSlumberingSnorlaxOffer(playerIndex: PlayerIndex): SlumberingSnorlaxOffer {
  return getSlumberingSnorlaxData().offers.find(offer => offer.playerIndex === playerIndex)!;
}

function getSlumberingSnorlaxStealingPokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return new MoveRequirement(STEALING_MOVES, true).queryParty(globalScene.getPlayerParty(playerIndex))[0];
}

function setOwnedLeftoversReward(playerIndex: PlayerIndex, fillRemaining: boolean): void {
  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.LEFTOVERS],
      fillRemaining,
    },
    undefined,
    undefined,
    playerIndex,
  );
}

function getSlumberingSnorlaxSpriteX(playerIndex: PlayerIndex, playerCount: number): number | undefined {
  if (playerCount <= 1) {
    return undefined;
  }
  if (playerCount > 2) {
    switch (playerIndex) {
      case 0:
        return -36;
      case 1:
        return 36;
      case 2:
        return 0;
    }
  }

  return playerIndex === 0 ? -18 : 18;
}

function chooseComputerPartnerSlumberingSnorlaxOption(playerIndex: PlayerIndex): SlumberingSnorlaxOptionIndex {
  if (getSlumberingSnorlaxStealingPokemon(playerIndex)) {
    return 3;
  }

  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return confidence.level === "medium" || confidence.level === "high" ? 1 : 2;
}

function queueComputerPartnerSlumberingSnorlaxChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: SlumberingSnorlaxOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function promptNextSlumberingSnorlaxPlayer(
  playerIndex: PlayerIndex,
  startingCursorIndex: number,
): Promise<boolean> {
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildSlumberingSnorlaxPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerSlumberingSnorlaxOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeSlumberingSnorlaxChoice(optionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function storeSlumberingSnorlaxChoice(
  optionIndex: SlumberingSnorlaxOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getSlumberingSnorlaxData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerSlumberingSnorlaxChoiceMessage(playerIndex, optionIndex);
  }

  if (globalScene.twoPlayerMode) {
    const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
    if (nextPlayerIndex != null) {
      return promptNextSlumberingSnorlaxPlayer(nextPlayerIndex, optionIndex - 1);
    }

    data.skipSelectedDialogueOnce = true;
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }

  return true;
}

async function hideSlumberingSnorlaxNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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

function createSnorlaxBattleConfig(battlePlayers: PlayerIndex[]): EnemyPartyConfig {
  return {
    doubleBattle: battlePlayers.length > 1,
    levelAdditiveModifier: 0.5,
    pokemonConfigs: battlePlayers.map(playerIndex => getSlumberingSnorlaxOffer(playerIndex).bossConfig),
  };
}

function queueSnorlaxStartOfBattleEffects(battlePlayers: PlayerIndex[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.startOfBattleEffects.push(
    ...battlePlayers.map((_playerIndex, fieldIndex) => ({
      sourceBattlerIndex: globalScene.getEnemyBattlerIndex(fieldIndex),
      targets: [globalScene.getPlayerBattlerIndex(fieldIndex)],
      move: new PokemonMove(MoveId.SNORE),
      useMode: MoveUseMode.IGNORE_PP,
    })),
  );
}

function registerSlumberingSnorlaxCaptureClaims(battlePlayers: PlayerIndex[]): void {
  const captureClaims = battlePlayers
    .map((playerIndex, targetIndex): { playerIndex: PlayerIndex; targetId: number; target: EnemyPokemon } | undefined => {
      if (!globalScene.isComputerPartnerPlayer(playerIndex)) {
        return undefined;
      }

      const target = globalScene.getEnemyParty()[targetIndex];
      if (!target) {
        return undefined;
      }

      const profile = getComputerPartnerProfileWithRolePreferences(
        globalScene.getComputerPartnerKey(playerIndex),
        globalScene.getComputerPartnerRolePreferences(playerIndex),
      );
      const replacementScore = getBestComputerPartnerReplacementSlot(
        profile,
        globalScene.getPlayerParty(playerIndex),
        target,
      );
      return replacementScore ? { playerIndex, targetId: target.id, target } : undefined;
    })
    .filter((claim): claim is { playerIndex: PlayerIndex; targetId: number; target: EnemyPokemon } => !!claim);

  globalScene.currentBattle.computerPartnerCaptureClaims = captureClaims.map(({ playerIndex, targetId }) => ({
    playerIndex,
    targetId,
  }));
  globalScene.currentBattle.computerPartnerReservedCaptureTargetIds = captureClaims.map(claim => claim.targetId);
  globalScene.currentBattle.computerPartnerReservedCaptureTargetId = captureClaims[0]?.targetId;

  for (const claim of captureClaims) {
    const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(claim.playerIndex));
    globalScene.phaseManager.queueMessage(
      `${profile.name} is interested in catching ${claim.target.getNameToRender()}.`,
      null,
      true,
    );
  }
}

function applySlumberingSnorlaxStealReward(playerIndex: PlayerIndex): void {
  setOwnedLeftoversReward(playerIndex, false);
  const thiefPokemon = getSlumberingSnorlaxStealingPokemon(playerIndex);
  if (thiefPokemon) {
    setEncounterExp(thiefPokemon.id, getPokemonSpecies(SpeciesId.SNORLAX).baseExp, true, playerIndex);
  }
}

async function showSlumberingSnorlaxSelectedDialogue(choice: SlumberingSnorlaxChoice): Promise<void> {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
}

async function runSlumberingSnorlaxChoices(): Promise<boolean> {
  const choices = getSlumberingSnorlaxData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battleChoices = choices.filter(choice => choice.optionIndex === 1);
  const restChoices = choices.filter(choice => choice.optionIndex === 2);
  const stealChoices = choices.filter(choice => choice.optionIndex === 3);

  if (globalScene.twoPlayerMode) {
    for (const choice of choices) {
      await showSlumberingSnorlaxSelectedDialogue(choice);
    }
  }

  for (const choice of battleChoices) {
    setOwnedLeftoversReward(choice.playerIndex, true);
  }

  for (const choice of stealChoices) {
    applySlumberingSnorlaxStealReward(choice.playerIndex);
  }

  for (const choice of restChoices.toReversed()) {
    globalScene.phaseManager.unshiftNew("PartyHealPhase", true, choice.playerIndex);
  }
  if (restChoices.length > 0) {
    queueEncounterMessage(`${namespace}:option.2.restResult`);
  }

  if (battleChoices.length === 0) {
    leaveEncounterWithoutBattle();
    return true;
  }

  const battlePlayers = battleChoices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  queueSnorlaxStartOfBattleEffects(battlePlayers);
  await hideSlumberingSnorlaxNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createSnorlaxBattleConfig(battlePlayers));
  registerSlumberingSnorlaxCaptureClaims(battlePlayers);
  return true;
}

function buildWakeSnorlaxOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeSlumberingSnorlaxChoice(1, playerIndex))
    .withOptionPhase(runSlumberingSnorlaxChoices)
    .build();
}

function buildWaitSnorlaxOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeSlumberingSnorlaxChoice(2, playerIndex))
    .withOptionPhase(runSlumberingSnorlaxChoices)
    .build();
}

function buildStealLeftoversOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerStealingMoveRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      disabledButtonTooltip: `${namespace}:option.3.disabledTooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeSlumberingSnorlaxChoice(3, playerIndex))
    .withOptionPhase(runSlumberingSnorlaxChoices)
    .build();
}

function buildSlumberingSnorlaxPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildWakeSnorlaxOption(playerIndex),
    buildWaitSnorlaxOption(playerIndex),
    buildStealLeftoversOption(playerIndex),
  ];
}

/**
 * Sleeping Snorlax encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3815 | GitHub Issue #3815}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const SlumberingSnorlaxEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.SLUMBERING_SNORLAX,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(15, 150)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      species: SpeciesId.SNORLAX,
      spriteKey: "",
      fileRoot: "",
      hasShadow: true,
      tint: 0.25,
      scale: 1.25,
      repeat: true,
      y: 5,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    const playerIndexes = getMysteryEncounterPlayerIndexes();
    const offers = playerIndexes.map(playerIndex => ({
      playerIndex,
      bossConfig: getSnorlaxPokemonConfig(),
    }));
    const pokemonConfigs = offers.map(offer => offer.bossConfig);
    const config: EnemyPartyConfig = {
      doubleBattle: pokemonConfigs.length > 1,
      levelAdditiveModifier: 0.5,
      pokemonConfigs,
    };
    encounter.enemyPartyConfigs = [config];
    encounter.misc = {
      offers,
      choices: [],
    } satisfies SlumberingSnorlaxData;
    encounter.spriteConfigs = offers.map(offer => {
      const x = getSlumberingSnorlaxSpriteX(offer.playerIndex, offers.length);
      return {
        species: SpeciesId.SNORLAX,
        spriteKey: "",
        fileRoot: "",
        hasShadow: true,
        tint: 0.25,
        scale: 1.25,
        repeat: true,
        ...(x != null ? { x } : {}),
        y: 5,
      };
    });

    // Load animations/sfx for Snorlax fight start moves
    loadCustomMovesForEncounter([MoveId.SNORE]);

    encounter.setDialogueToken("snorlaxName", getPokemonSpecies(SpeciesId.SNORLAX).getName());

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildWakeSnorlaxOption(0))
  .withOption(buildWaitSnorlaxOption(0))
  .withOption(buildStealLeftoversOption(0))
  .build();
