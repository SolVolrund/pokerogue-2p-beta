import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { modifierTypes } from "#data/data-lists";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PERMANENT_STATS, Stat } from "#enums/stat";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { BerryModifier } from "#modifiers/modifier";
import type { BerryModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  generateModifierTypeOption,
  getRandomEncounterPokemon,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterExp,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
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
  fastestPokemonByPlayer: Record<PlayerIndex, PlayerPokemon>;
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

function buildFastestPokemonByPlayer(): Record<PlayerIndex, PlayerPokemon> {
  return {
    0: getFastestPokemonForPlayer(0),
    1: getFastestPokemonForPlayer(1),
  };
}

function setBerriesAboundPlayerTokens(playerIndex: PlayerIndex): void {
  const data = getBerriesAboundData();
  const fastestPokemon = data.fastestPokemonByPlayer[playerIndex];
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("fastestPokemon", fastestPokemon.getNameToRender());
}

function showBerriesAboundPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setBerriesAboundPlayerTokens(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildBerriesAboundPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function getBerriesAboundTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

async function hideBerriesAboundNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  await Promise.all(
    ([0, 1] as PlayerIndex[])
      .filter(playerIndex => !battlePlayerSet.has(playerIndex))
      .map(
        playerIndex =>
          new Promise<void>(resolve => {
            const trainerSprite = getBerriesAboundTrainerSprite(playerIndex);
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

function storeBerriesAboundChoice(optionIndex: BerriesAboundOptionIndex, playerIndex: PlayerIndex): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setBerriesAboundPlayerTokens(playerIndex);

  const data = getBerriesAboundData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (playerIndex === 0) {
    showBerriesAboundPlayerMenu(1, optionIndex - 1);
    return false;
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
    globalScene.setActivePlayerIndex(playerIndex);
    updateWindowType(playerIndex + 1);
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
  const fastestPokemon = data.fastestPokemonByPlayer[playerIndex];
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
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      statChangesForBattle,
      1,
    );
  };

  return config;
}

function createBerriesAboundBattleConfig(battlePlayers: PlayerIndex[], enraged: boolean): EnemyPartyConfig {
  const baseConfig = enraged
    ? configureEnragedBoss()
    : globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0];

  return {
    ...baseConfig,
    doubleBattle: battlePlayers.length > 1,
  };
}

async function startBerriesAboundBattle(battlePlayers: PlayerIndex[], enraged: boolean): Promise<void> {
  globalScene.setActivePlayerIndex(battlePlayers[0]);
  updateWindowType(battlePlayers[0] + 1);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  await hideBerriesAboundNonBattleTrainers(battlePlayers);
  await initBattleWithEnemyConfig(createBerriesAboundBattleConfig(battlePlayers, enraged));
}

async function runOnePlayerBattlePokemon(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  setBerryRewards(globalScene.activePlayerIndex, encounter.misc.numBerries);
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

async function runOnePlayerRaceToBush(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playerIndex = globalScene.activePlayerIndex;
  const { fastestPokemon, speedDiff, berryCount } = getRaceResult(playerIndex);

  if (speedDiff < 1) {
    setBerryRewards(playerIndex, encounter.misc.numBerries);
    await showEncounterText(`${namespace}:option.2.selectedBad`);
    await initBattleWithEnemyConfig(configureEnragedBoss());
    return;
  }

  encounter.setDialogueToken("numBerries", String(berryCount));
  setEncounterExp(fastestPokemon.id, encounter.enemyPartyConfigs[0].pokemonConfigs![0].species.baseExp, true, playerIndex);
  setBerryRewards(playerIndex, berryCount, fastestPokemon);
  await showEncounterText(`${namespace}:option.2.selected`);
  leaveEncounterWithoutBattle();
}

async function runTwoPlayerBerriesAboundChoices(): Promise<boolean> {
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
      globalScene.twoPlayerMode ? runTwoPlayerBerriesAboundChoices() : runOnePlayerBattlePokemon(),
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
      globalScene.twoPlayerMode ? runTwoPlayerBerriesAboundChoices() : runOnePlayerRaceToBush(),
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
        ? runTwoPlayerBerriesAboundChoices()
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
    const fastestPokemon = fastestPokemonByPlayer[globalScene.activePlayerIndex];
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
