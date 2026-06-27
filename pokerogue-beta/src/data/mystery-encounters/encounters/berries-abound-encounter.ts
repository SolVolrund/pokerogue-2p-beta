import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { modifierTypes } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { FieldPosition } from "#enums/field-position";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import type { BerryModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  generateModifierTypeOption,
  getRandomEncounterPokemon,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterExp,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import {
  applyModifierTypeToPlayerPokemon,
  getEncounterPokemonLevelForWave,
  getSpriteKeysFromPokemon,
  STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PokemonData } from "#system/pokemon-data";
import { updateWindowType } from "#ui/ui-theme";
import {
  getBestComputerPartnerReplacementSlot,
  getComputerPartnerProfile,
  getComputerPartnerProfileWithRolePreferences,
} from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import { randSeedItem } from "#utils/common";
import { getEnumValues } from "#utils/enums";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/berriesAbound";

type BerriesAboundOptionIndex = 1 | 2 | 3;

interface BerriesAboundChoice {
  playerIndex: PlayerIndex;
  optionIndex: BerriesAboundOptionIndex;
}

interface BerriesAboundData {
  choices: BerriesAboundChoice[];
  fastestPokemonByPlayer: Partial<Record<PlayerIndex, PlayerPokemon>>;
  enemySpeed: number;
  numBerries: number;
  skipSelectedDialogueOnce?: boolean;
}

function getBerriesAboundData(): BerriesAboundData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      fastestPokemonByPlayer: buildFastestPokemonByPlayer(),
      enemySpeed: encounter.misc?.enemySpeed ?? 1,
      numBerries: encounter.misc?.numBerries ?? 2,
    } satisfies BerriesAboundData;
  }

  return encounter.misc as BerriesAboundData;
}

function getFastestPokemonForPlayer(playerIndex: PlayerIndex): PlayerPokemon {
  const party = globalScene.getPlayerParty(playerIndex);
  const candidates = party.filter(pokemon => pokemon.isAllowedInChallenge() && !pokemon.isFainted());
  const searchParty = candidates.length > 0 ? candidates : party;

  return searchParty.reduce((fastest, pokemon) =>
    pokemon.getStat(PERMANENT_STATS[Stat.SPD]) > fastest.getStat(PERMANENT_STATS[Stat.SPD]) ? pokemon : fastest,
  );
}

function buildFastestPokemonByPlayer(): Partial<Record<PlayerIndex, PlayerPokemon>> {
  return Object.fromEntries(
    getMysteryEncounterPlayerIndexes().map(playerIndex => [playerIndex, getFastestPokemonForPlayer(playerIndex)]),
  ) as Partial<Record<PlayerIndex, PlayerPokemon>>;
}

function setBerriesAboundPlayerTokens(playerIndex: PlayerIndex): void {
  const data = getBerriesAboundData();
  const fastestPokemon = data.fastestPokemonByPlayer[playerIndex] ?? getFastestPokemonForPlayer(playerIndex);
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("fastestPokemon", fastestPokemon.getNameToRender());
}

function chooseComputerPartnerBerriesAboundOption(playerIndex: PlayerIndex): BerriesAboundOptionIndex {
  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  if (confidence.level === "medium" || confidence.level === "high") {
    return 1;
  }

  return getRaceResult(playerIndex).speedDiff >= 1 ? 2 : 3;
}

function queueComputerPartnerBerriesAboundChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: BerriesAboundOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

async function promptNextBerriesAboundPlayer(playerIndex: PlayerIndex, startingCursorIndex = 0): Promise<boolean> {
  setBerriesAboundPlayerTokens(playerIndex);

  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildBerriesAboundPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerBerriesAboundOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeBerriesAboundChoice(optionIndex as BerriesAboundOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function hideBerriesAboundNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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

async function storeBerriesAboundChoice(
  optionIndex: BerriesAboundOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setBerriesAboundPlayerTokens(playerIndex);

  const data = getBerriesAboundData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerBerriesAboundChoiceMessage(playerIndex, optionIndex);
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
  if (nextPlayerIndex != null) {
    return promptNextBerriesAboundPlayer(nextPlayerIndex, optionIndex - 1);
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function createBerryShopOptions(): ModifierTypeOption[] {
  const shopOptions: ModifierTypeOption[] = [];
  for (let i = 0; i < 5; i++) {
    const mod = generateModifierTypeOption(modifierTypes.BERRY);
    if (mod) {
      shopOptions.push(mod);
    }
  }
  return shopOptions;
}

function setBerryRewards(
  playerIndex: PlayerIndex,
  berryCount: number,
  prioritizedPokemon?: PlayerPokemon,
): void {
  const doBerryRewards = () => {
    globalScene.waitForPlayerInput(playerIndex);
    const berryText = i18next.t(`${namespace}:berries`);

    audioManager.playSound("se/item_fanfare");
    queueEncounterMessage(
      i18next.t("battle:rewardGainCount", {
        modifierName: berryText,
        count: berryCount,
      }),
    );

    for (let i = 0; i < berryCount; i++) {
      tryGiveBerry(prioritizedPokemon, playerIndex);
    }
  };

  setEncounterRewards(
    { guaranteedModifierTypeOptions: createBerryShopOptions(), fillRemaining: false },
    undefined,
    doBerryRewards,
    playerIndex,
  );
}

function getRaceResult(playerIndex: PlayerIndex): {
  fastestPokemon: PlayerPokemon;
  speedDiff: number;
  berryCount: number;
} {
  const data = getBerriesAboundData();
  const fastestPokemon = data.fastestPokemonByPlayer[playerIndex] ?? getFastestPokemonForPlayer(playerIndex);
  const speedDiff = fastestPokemon.getStat(Stat.SPD) / (data.enemySpeed * 1.1);
  const berryCount = Math.max(Math.min(Math.round((speedDiff - 1) / 0.08), data.numBerries), 2);
  return { fastestPokemon, speedDiff, berryCount };
}

function configureEnragedBoss(): EnemyPartyConfig {
  const config = globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0];
  const statChangesForBattle: (
    | Stat.ATK
    | Stat.DEF
    | Stat.SPATK
    | Stat.SPDEF
    | Stat.SPD
    | Stat.ACC
    | Stat.EVA
  )[] =
    globalScene.currentBattle.waveIndex < 50
      ? [Stat.DEF, Stat.SPDEF, Stat.SPD]
      : [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];

  config.pokemonConfigs![0].tags = [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON];
  config.pokemonConfigs![0].mysteryEncounterBattleEffects = (pokemon: Pokemon) => {
    queueEncounterMessage(`${namespace}:option.2.bossEnraged`);
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
      battlerIndex: pokemon.getBattlerIndex(),
      changes: statChangesForBattle.map(stat => ({ stat, stages: 1 })),
      sourcePokemon: pokemon,
    });
  };

  return config;
}

function createBerriesAboundBattleConfig(battlePlayers: PlayerIndex[], enraged: boolean): EnemyPartyConfig {
  const baseConfig = enraged
    ? configureEnragedBoss()
    : globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0];
  const fieldPosition = battlePlayers.length > 2 ? FieldPosition.CENTER : undefined;

  return {
    ...baseConfig,
    doubleBattle: battlePlayers.length > 1,
    pokemonConfigs: baseConfig.pokemonConfigs?.map((config, index) =>
      index === 0 && fieldPosition != null ? { ...config, fieldPosition } : config,
    ),
  };
}

function queueBerriesAboundStartOfBattleEffects(battlePlayers: PlayerIndex[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const bossBattlerIndex = BattlerIndex.ENEMY;
  encounter.startOfBattleEffects.push(
    ...battlePlayers.map(() => ({
      sourceBattlerIndex: bossBattlerIndex,
      targets: [bossBattlerIndex],
      move: new PokemonMove(MoveId.STOCKPILE),
      useMode: MoveUseMode.IGNORE_PP,
    })),
  );
}

function registerBerriesAboundCaptureClaims(battlePlayers: PlayerIndex[]): void {
  const boss = globalScene.getEnemyParty()[0];
  if (!boss) {
    globalScene.currentBattle.computerPartnerCaptureClaims = [];
    globalScene.currentBattle.computerPartnerReservedCaptureTargetIds = [];
    globalScene.currentBattle.computerPartnerReservedCaptureTargetId = undefined;
    return;
  }

  const captureClaim = battlePlayers
    .map((playerIndex): { playerIndex: PlayerIndex; targetId: number; target: EnemyPokemon } | undefined => {
      if (!globalScene.isComputerPartnerPlayer(playerIndex)) {
        return undefined;
      }

      const profile = getComputerPartnerProfileWithRolePreferences(
        globalScene.getComputerPartnerKey(playerIndex),
        globalScene.getComputerPartnerRolePreferences(playerIndex),
      );
      const replacementScore = getBestComputerPartnerReplacementSlot(
        profile,
        globalScene.getPlayerParty(playerIndex),
        boss,
      );
      return replacementScore ? { playerIndex, targetId: boss.id, target: boss } : undefined;
    })
    .find((claim): claim is { playerIndex: PlayerIndex; targetId: number; target: EnemyPokemon } => !!claim);

  globalScene.currentBattle.computerPartnerCaptureClaims = captureClaim
    ? [{ playerIndex: captureClaim.playerIndex, targetId: captureClaim.targetId }]
    : [];
  globalScene.currentBattle.computerPartnerReservedCaptureTargetIds = captureClaim ? [captureClaim.targetId] : [];
  globalScene.currentBattle.computerPartnerReservedCaptureTargetId = captureClaim?.targetId;

  if (captureClaim) {
    const claim = captureClaim;
    const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(claim.playerIndex));
    globalScene.phaseManager.queueMessage(
      `${profile.name} is interested in catching ${claim.target.getNameToRender()}.`,
      null,
      true,
    );
  }
}

async function startBerriesAboundBattle(battlePlayers: PlayerIndex[], enraged: boolean): Promise<void> {
  globalScene.waitForPlayerInput(battlePlayers[0]);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  await hideBerriesAboundNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createBerriesAboundBattleConfig(battlePlayers, enraged));
  registerBerriesAboundCaptureClaims(battlePlayers);
}

async function runOnePlayerBattlePokemon(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  setBerryRewards(globalScene.activePlayerIndex, encounter.misc.numBerries);
  queueBerriesAboundStartOfBattleEffects([globalScene.activePlayerIndex]);
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

async function runOnePlayerRaceToBush(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerIndex = globalScene.activePlayerIndex;
  const { fastestPokemon, speedDiff, berryCount } = getRaceResult(playerIndex);

  if (speedDiff < 1) {
    setBerryRewards(playerIndex, encounter.misc.numBerries);
    await showEncounterText(`${namespace}:option.2.selectedBad`);
    queueBerriesAboundStartOfBattleEffects([playerIndex]);
    await initBattleWithEnemyConfig(configureEnragedBoss());
    return;
  }

  encounter.setDialogueToken("numBerries", String(berryCount));
  setEncounterExp(fastestPokemon.id, encounter.enemyPartyConfigs[0].pokemonConfigs![0].species.baseExp, true, playerIndex);
  setBerryRewards(playerIndex, berryCount, fastestPokemon);
  await showEncounterText(`${namespace}:option.2.selected`);
  leaveEncounterWithoutBattle();
}

async function runMultiplayerBerriesAboundChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getBerriesAboundData();
  const choices = data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battlePlayers: PlayerIndex[] = [];
  let bossEnraged = false;
  let hasRewards = false;

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    setBerriesAboundPlayerTokens(choice.playerIndex);

    if (choice.optionIndex === 1) {
      await showEncounterText(`${namespace}:option.1.selected`);
      setBerryRewards(choice.playerIndex, data.numBerries);
      hasRewards = true;
      battlePlayers.push(choice.playerIndex);
      continue;
    }

    if (choice.optionIndex === 2) {
      const { fastestPokemon, speedDiff, berryCount } = getRaceResult(choice.playerIndex);
      if (speedDiff < 1) {
        await showEncounterText(`${namespace}:option.2.selectedBad`);
        setBerryRewards(choice.playerIndex, data.numBerries);
        hasRewards = true;
        bossEnraged = true;
        battlePlayers.push(choice.playerIndex);
        continue;
      }

      encounter.setDialogueToken("numBerries", String(berryCount));
      await showEncounterText(`${namespace}:option.2.selected`);
      setEncounterExp(
        fastestPokemon.id,
        encounter.enemyPartyConfigs[0].pokemonConfigs![0].species.baseExp,
        true,
        choice.playerIndex,
      );
      setBerryRewards(choice.playerIndex, berryCount, fastestPokemon);
      hasRewards = true;
      continue;
    }

    await showEncounterText(`${namespace}:option.3.selected`);
  }

  if (battlePlayers.length === 0) {
    leaveEncounterWithoutBattle(!hasRewards);
    return true;
  }

  queueBerriesAboundStartOfBattleEffects(battlePlayers);
  await startBerriesAboundBattle(battlePlayers, bossEnraged);
  return true;
}

function buildBattlePokemonOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeBerriesAboundChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerBerriesAboundChoices() : runOnePlayerBattlePokemon(),
    )
    .build();
}

function buildRaceToBushOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
    })
    .withPreOptionPhase(async () => storeBerriesAboundChoice(2, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runMultiplayerBerriesAboundChoices() : runOnePlayerRaceToBush(),
    )
    .build();
}

function buildLeaveOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeBerriesAboundChoice(3, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode
        ? runMultiplayerBerriesAboundChoices()
        : (leaveEncounterWithoutBattle(true), true),
    )
    .build();
}

function buildBerriesAboundPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildBattlePokemonOption(playerIndex), buildRaceToBushOption(playerIndex), buildLeaveOption(playerIndex)];
}

/**
 * Berries Abound encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3810 | GitHub Issue #3810}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const BerriesAboundEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.BERRIES_ABOUND,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCatchAllowed(true)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([]) // Set in onInit()
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    // Calculate boss mon
    const level = getEncounterPokemonLevelForWave(STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER);
    const bossPokemon = getRandomEncounterPokemon({
      level,
      isBoss: true,
      eventShinyRerolls: 2,
      eventHiddenRerolls: 1,
    });
    encounter.setDialogueToken("enemyPokemon", getPokemonNameWithAffix(bossPokemon));
    const config: EnemyPartyConfig = {
      pokemonConfigs: [
        {
          level,
          species: bossPokemon.species,
          dataSource: new PokemonData(bossPokemon),
          isBoss: true,
        },
      ],
    };
    encounter.enemyPartyConfigs = [config];
    loadCustomMovesForEncounter([MoveId.STOCKPILE]);

    // Calculate the number of extra berries that player receives
    // 10-40: 2, 40-120: 4, 120-160: 5, 160-180: 7
    const numBerries =
      globalScene.currentBattle.waveIndex > 160
        ? 7
        : globalScene.currentBattle.waveIndex > 120
          ? 5
          : globalScene.currentBattle.waveIndex > 40
            ? 4
            : 2;
    regenerateModifierPoolThresholds(globalScene.getPlayerParty(), ModifierPoolType.PLAYER, 0);

    const { spriteKey, fileRoot } = getSpriteKeysFromPokemon(bossPokemon);
    encounter.spriteConfigs = [
      {
        spriteKey: "berries_abound_bush",
        fileRoot: "mystery-encounters",
        x: 25,
        y: -6,
        yShadow: -7,
        disableAnimation: true,
        hasShadow: true,
      },
      {
        spriteKey,
        fileRoot,
        hasShadow: true,
        tint: 0.25,
        x: -5,
        repeat: true,
        isPokemon: true,
        isShiny: bossPokemon.shiny,
        variant: bossPokemon.variant,
      },
    ];

    const fastestPokemonByPlayer = buildFastestPokemonByPlayer();
    encounter.misc = {
      choices: [],
      fastestPokemonByPlayer,
      enemySpeed: bossPokemon.getStat(Stat.SPD),
      numBerries,
    } satisfies BerriesAboundData;
    const fastestPokemon =
      fastestPokemonByPlayer[globalScene.activePlayerIndex] ?? getFastestPokemonForPlayer(globalScene.activePlayerIndex);
    encounter.setDialogueToken("fastestPokemon", fastestPokemon.getNameToRender());

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildBattlePokemonOption(0))
  .withOption(buildRaceToBushOption(0))
  .withOption(buildLeaveOption(0))
  .build();

function tryGiveBerry(prioritizedPokemon?: PlayerPokemon, playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
  const berryType = randSeedItem(getEnumValues(BerryType));
  const berry = generateModifierType(modifierTypes.BERRY, [berryType]) as BerryModifierType;

  globalScene.setActivePlayerIndex(playerIndex);
  const party = globalScene.getPlayerParty(playerIndex);

  // Will try to apply to prioritized pokemon first, then do normal application method if it fails
  if (prioritizedPokemon) {
    const heldBerriesOfType = globalScene.findModifier(
      m =>
        m instanceof BerryModifier
        && m.pokemonId === prioritizedPokemon.id
        && (m as BerryModifier).berryType === berryType,
      true,
      playerIndex,
    ) as BerryModifier;

    if (!heldBerriesOfType || heldBerriesOfType.getStackCount() < heldBerriesOfType.getMaxStackCount()) {
      applyModifierTypeToPlayerPokemon(prioritizedPokemon, berry);
      return;
    }
  }

  // Iterate over the party until berry was successfully given
  for (const pokemon of party) {
    const heldBerriesOfType = globalScene.findModifier(
      m => m instanceof BerryModifier && m.pokemonId === pokemon.id && (m as BerryModifier).berryType === berryType,
      true,
      playerIndex,
    ) as BerryModifier;

    if (!heldBerriesOfType || heldBerriesOfType.getStackCount() < heldBerriesOfType.getMaxStackCount()) {
      applyModifierTypeToPlayerPokemon(pokemon, berry);
      return;
    }
  }
}
