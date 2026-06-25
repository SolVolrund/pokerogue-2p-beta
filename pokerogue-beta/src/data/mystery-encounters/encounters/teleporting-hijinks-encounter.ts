import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { modifierTypes } from "#data/data-lists";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { getBiomeKey } from "#field/arena";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EnemyPokemon } from "#field/pokemon";
import { getPartyLuckValue } from "#modifiers/modifier-type";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierTypeOption,
  initBattleWithEnemyConfig,
  setEncounterExp,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getEncounterPokemonLevelForWave,
  STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import {
  EncounterPokemonRequirement,
  MoneyRequirement,
  TypeRequirement,
  WaveModulusRequirement,
} from "#mystery-encounters/mystery-encounter-requirements";
import { PokemonData } from "#system/pokemon-data";
import { updateWindowType } from "#ui/ui-theme";
import { playTween } from "#utils/anim-utils";
import { randSeedInt } from "#utils/common";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/teleportingHijinks";

const MONEY_COST_MULTIPLIER = 1.75;
const BIOME_CANDIDATES = [
  BiomeId.SPACE,
  BiomeId.FAIRY_CAVE,
  BiomeId.LABORATORY,
  BiomeId.ISLAND,
  BiomeId.WASTELAND,
  BiomeId.DOJO,
];
const MACHINE_INTERFACING_TYPES = [PokemonType.ELECTRIC, PokemonType.STEEL];

type TeleportingHijinksOptionIndex = 1 | 2 | 3;

interface TeleportingHijinksChoice {
  playerIndex: PlayerIndex;
  optionIndex: TeleportingHijinksOptionIndex;
  helperPokemon?: PlayerPokemon;
}

interface TeleportingHijinksData {
  price: number;
  choices?: TeleportingHijinksChoice[];
  skipSelectedDialogueOnce?: boolean;
}

class TwoPlayerAnyPlayerTeleportMoneyRequirement extends MoneyRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return super.meetsRequirement();
    }

    if (this.scalingMultiplier > 0) {
      this.requiredMoney = globalScene.getWaveMoneyAmount(this.scalingMultiplier);
    }

    return ([0, 1] as PlayerIndex[]).some(playerIndex => globalScene.getPlayerMoney(playerIndex) >= this.requiredMoney);
  }
}

class TeleportingHijinksPlayerMoneyRequirement extends MoneyRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super(0);
  }

  override meetsRequirement(): boolean {
    this.requiredMoney = getTeleportingHijinksPrice();
    return globalScene.getPlayerMoney(this.playerIndex) >= this.requiredMoney;
  }

  override getDialogueToken(): [string, string] {
    return ["money", getTeleportingHijinksPrice().toString()];
  }
}

class PlayerMachineInterfaceRequirement extends EncounterPokemonRequirement {
  private readonly requirement = new TypeRequirement(MACHINE_INTERFACING_TYPES, true, 1);

  constructor(private readonly playerIndex: PlayerIndex | undefined) {
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
    return this.requirement.getDialogueToken(pokemon);
  }

  private queryPlayerParty(): PlayerPokemon[] {
    const party =
      globalScene.twoPlayerMode && this.playerIndex != null
        ? globalScene.getPlayerParty(this.playerIndex)
        : globalScene.getPlayerParty();
    return this.requirement.queryParty(party);
  }
}

function getTeleportingHijinksData(): TeleportingHijinksData {
  return globalScene.currentBattle.mysteryEncounter!.misc as TeleportingHijinksData;
}

function getTeleportingHijinksPrice(): number {
  const data = globalScene.currentBattle?.mysteryEncounter?.misc as Partial<TeleportingHijinksData> | undefined;
  return data?.price ?? globalScene.getWaveMoneyAmount(MONEY_COST_MULTIPLIER);
}

function getMachineInterfacePokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return new PlayerMachineInterfaceRequirement(playerIndex).queryParty(globalScene.getPlayerParty(playerIndex))[0];
}

function setTeleportingHijinksPlayerOptionTokens(playerIndex: PlayerIndex): void {
  const helperPokemon = getMachineInterfacePokemon(playerIndex);
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("price", getTeleportingHijinksPrice().toString());
  encounter.setDialogueToken("option2PrimaryName", helperPokemon?.getNameToRender() ?? "");
}

function setTeleportingHijinksChoiceTokens(choice: TeleportingHijinksChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("price", getTeleportingHijinksPrice().toString());
  if (choice.helperPokemon) {
    encounter.setDialogueToken("option2PrimaryName", choice.helperPokemon.getNameToRender());
  }
}

function spendTeleportingHijinksMoney(playerIndex: PlayerIndex): void {
  const price = getTeleportingHijinksPrice();
  globalScene.setPlayerMoney(Math.max(globalScene.getPlayerMoney(playerIndex) - price, 0), playerIndex);

  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
  }

  audioManager.playSound("se/buy");
  globalScene.phaseManager.queueMessage(i18next.t("mysteryEncounterMessages:paidMoney", { amount: price }), null, true);
}

function storeTeleportingHijinksChoice(
  optionIndex: TeleportingHijinksOptionIndex,
  playerIndex: PlayerIndex = 0,
): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const data = getTeleportingHijinksData();
  const helperPokemon = optionIndex === 2 ? getMachineInterfacePokemon(playerIndex) : undefined;
  data.choices = (data.choices ?? []).filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({
    playerIndex,
    optionIndex,
    ...(helperPokemon ? { helperPokemon } : {}),
  });

  if (playerIndex === 0) {
    showTeleportingHijinksPlayerMenu(1, optionIndex - 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function showTeleportingHijinksPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  const overrideOptions = buildTeleportingHijinksPlayerOptions(playerIndex);
  setTeleportingHijinksPlayerOptionTokens(playerIndex);
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions,
      startingCursorIndex,
    });
  });
}

function buildTeleportingHijinksMoneyOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new TeleportingHijinksPlayerMoneyRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return storeTeleportingHijinksChoice(1, playerIndex);
      }
      spendTeleportingHijinksMoney(playerIndex);
      return true;
    })
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerTeleportingHijinksChoices();
      }
      const config: EnemyPartyConfig = await doBiomeTransitionDialogueAndBattleInit();
      setEncounterRewards({ fillRemaining: true });
      await initBattleWithEnemyConfig(config);
    })
    .build();
}

function buildTeleportingHijinksHelperOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerMachineInterfaceRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      disabledButtonTooltip: `${namespace}:option.2.disabledTooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeTeleportingHijinksChoice(2, playerIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerTeleportingHijinksChoices();
      }
      const config: EnemyPartyConfig = await doBiomeTransitionDialogueAndBattleInit();
      setEncounterRewards({ fillRemaining: true });
      setEncounterExp(globalScene.currentBattle.mysteryEncounter!.selectedOption!.primaryPokemon!.id, 100);
      await initBattleWithEnemyConfig(config);
    })
    .build();
}

function buildTeleportingHijinksInspectOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeTeleportingHijinksChoice(3, playerIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerTeleportingHijinksChoices();
      }
      await runOnePlayerInspectMachine();
    })
    .build();
}

function buildTeleportingHijinksPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildTeleportingHijinksMoneyOption(playerIndex),
    buildTeleportingHijinksHelperOption(playerIndex),
    buildTeleportingHijinksInspectOption(playerIndex),
  ];
}

/**
 * Teleporting Hijinks encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3817 | GitHub Issue #3817}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TeleportingHijinksEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.TELEPORTING_HIJINKS,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new WaveModulusRequirement([2, 3, 4], 10)) // Must be in first 3 waves after boss wave
  .withSceneRequirement(new TwoPlayerAnyPlayerTeleportMoneyRequirement(0, MONEY_COST_MULTIPLIER)) // Must be able to pay teleport cost
  .withAutoHideIntroVisuals(false)
  .withCatchAllowed(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "teleporting_hijinks_teleporter",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      x: 4,
      y: 4,
      yShadow: 1,
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
    const price = globalScene.getWaveMoneyAmount(MONEY_COST_MULTIPLIER);
    encounter.setDialogueToken("price", price.toString());
    encounter.misc = {
      price,
    };

    return true;
  })
  .withOption(buildTeleportingHijinksMoneyOption(0))
  .withOption(buildTeleportingHijinksHelperOption(0))
  .withOption(buildTeleportingHijinksInspectOption(0))
  .build();

async function runTwoPlayerTeleportingHijinksChoices(): Promise<boolean> {
  const data = getTeleportingHijinksData();
  const choices = (data.choices ?? []).toSorted((a, b) => a.playerIndex - b.playerIndex);
  const teleportChoices = choices.filter(choice => choice.optionIndex !== 3);
  const inspectChoices = choices.filter(choice => choice.optionIndex === 3);
  let useTeleportRoute = teleportChoices.length > 0 && inspectChoices.length === 0;

  if (teleportChoices.length > 0 && inspectChoices.length > 0) {
    const winningPlayerIndex = globalScene.resolvePlayerTieBreak(choices.map(choice => choice.playerIndex));
    useTeleportRoute = teleportChoices.some(choice => choice.playerIndex === winningPlayerIndex);
    await showEncounterText(`Player ${winningPlayerIndex + 1}'s choice wins this time.`);
  }

  const winningChoices = useTeleportRoute ? teleportChoices : inspectChoices;
  for (const choice of winningChoices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    setTeleportingHijinksChoiceTokens(choice);
    await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);

    if (useTeleportRoute && choice.optionIndex === 1) {
      spendTeleportingHijinksMoney(choice.playerIndex);
    } else if (useTeleportRoute && choice.optionIndex === 2 && choice.helperPokemon) {
      setEncounterExp(choice.helperPokemon.id, 100, true, choice.playerIndex);
    }
  }

  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners([0, 1]);

  if (useTeleportRoute) {
    const config = await doBiomeTransitionDialogueAndBattleInit(2);
    setTeleportingHijinksDefaultRewards([0, 1]);
    await initBattleWithEnemyConfig(config);
    return true;
  }

  await runInspectMachine([0, 1], 2);
  return true;
}

async function runOnePlayerInspectMachine(): Promise<void> {
  await runInspectMachine([0], 1);
}

async function runInspectMachine(playerIndexes: PlayerIndex[], bossCount: number): Promise<void> {
  const config = createBossBattleConfig(false, bossCount);

  for (const playerIndex of playerIndexes) {
    setTeleportingHijinksInspectRewards(playerIndex);
  }

  await transitionMysteryEncounterIntroVisuals(true, true);
  await initBattleWithEnemyConfig(config);
}

function setTeleportingHijinksDefaultRewards(playerIndexes: PlayerIndex[]): void {
  for (const playerIndex of playerIndexes) {
    setEncounterRewards({ fillRemaining: true }, undefined, undefined, playerIndex);
  }
}

function setTeleportingHijinksInspectRewards(playerIndex: PlayerIndex): void {
  const magnet = generateModifierTypeOption(modifierTypes.ATTACK_TYPE_BOOSTER, [PokemonType.STEEL])!;
  const metalCoat = generateModifierTypeOption(modifierTypes.ATTACK_TYPE_BOOSTER, [PokemonType.ELECTRIC])!;
  setEncounterRewards(
    {
      guaranteedModifierTypeOptions: [magnet, metalCoat],
      fillRemaining: true,
    },
    undefined,
    undefined,
    playerIndex,
  );
}

async function doBiomeTransitionDialogueAndBattleInit(bossCount = 1) {
  // Calculate new biome (cannot be current biome)
  const filteredBiomes = BIOME_CANDIDATES.filter(b => globalScene.arena.biomeId !== b);
  // TODO: should this use `randSeedItem`?
  const newBiome = filteredBiomes[randSeedInt(filteredBiomes.length)];

  // Show dialogue and transition biome
  await showEncounterText(`${namespace}:transport`);
  await Promise.all([animateBiomeChange(newBiome), transitionMysteryEncounterIntroVisuals()]);
  globalScene.updateBiomeWaveText();
  audioManager.playBgm();
  await showEncounterText(`${namespace}:attacked`);

  return createBossBattleConfig(true, bossCount);
}

function createBossBattleConfig(enraged: boolean, bossCount: number): EnemyPartyConfig {
  const pokemonConfigs: EnemyPokemonConfig[] = [];

  // Defense/Spd buffs below wave 50, +1 to all stats otherwise
  const statChangesForBattle: (Stat.ATK | Stat.DEF | Stat.SPATK | Stat.SPDEF | Stat.SPD | Stat.ACC | Stat.EVA)[] =
    globalScene.currentBattle.waveIndex < 50
      ? [Stat.DEF, Stat.SPDEF, Stat.SPD]
      : [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD];

  for (let i = 0; i < bossCount; i++) {
    const level = getEncounterPokemonLevelForWave(STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER);
    const bossSpecies = globalScene.arena.randomSpecies(
      globalScene.currentBattle.waveIndex,
      level,
      i,
      getTeleportingHijinksLuckValue(),
      true,
    );
    const bossPokemon = new EnemyPokemon(bossSpecies, level, TrainerSlot.NONE, true);
    if (i === 0) {
      globalScene.currentBattle.mysteryEncounter!.setDialogueToken("enemyPokemon", getPokemonNameWithAffix(bossPokemon));
    }

    pokemonConfigs.push({
      level,
      species: bossSpecies,
      dataSource: new PokemonData(bossPokemon),
      isBoss: true,
      ...(enraged
        ? {
            tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
            mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
              queueEncounterMessage(`${namespace}:bossEnraged`);
              globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
                battlerIndex: pokemon.getBattlerIndex(),
                changes: statChangesForBattle.map(stat => ({ stat, stages: 1 })),
                sourcePokemon: pokemon,
              });
            },
          }
        : {}),
    });
  }

  return {
    doubleBattle: bossCount > 1,
    pokemonConfigs,
  };
}

function getTeleportingHijinksLuckValue(): number {
  if (!globalScene.twoPlayerMode) {
    return getPartyLuckValue(globalScene.getPlayerParty());
  }

  return getPartyLuckValue([...globalScene.getPlayerParty(0), ...globalScene.getPlayerParty(1)]);
}

async function animateBiomeChange(nextBiome: BiomeId): Promise<void> {
  await playTween({
    targets: [globalScene.arenaEnemy, globalScene.lastEnemyTrainer],
    x: "+=300",
    duration: 2000,
  });

  const previousBiome = globalScene.arena.biomeId;
  await globalScene.loadBiomeAssets(nextBiome);
  globalScene.newArena(nextBiome);

  const biomeKey = getBiomeKey(nextBiome);
  const bgTexture = `${biomeKey}_bg`;
  globalScene.arenaBgTransition //
    .setTexture(bgTexture)
    .setAlpha(0)
    .setVisible(true);
  globalScene.arenaPlayerTransition //
    .setAlpha(0)
    .setVisible(true)
    .setBiome(nextBiome);

  await playTween({
    targets: [globalScene.arenaPlayer, globalScene.arenaBgTransition, globalScene.arenaPlayerTransition],
    duration: 1000,
    ease: "Sine.easeInOut",
    alpha: (target: any) => (target === globalScene.arenaPlayer ? 0 : 1),
  });

  globalScene.arenaBg.setTexture(bgTexture);
  globalScene.arenaPlayer //
    .setAlpha(1)
    .setBiome(nextBiome);
  globalScene.arenaEnemy //
    .setAlpha(1)
    .setBiome(nextBiome);
  globalScene.arenaNextEnemy.setBiome(nextBiome);
  globalScene.arenaBgTransition.setVisible(false);
  globalScene.arenaPlayerTransition.setVisible(false);
  if (globalScene.lastEnemyTrainer) {
    globalScene.lastEnemyTrainer.destroy();
  }

  globalScene.clearBiomeAssets(previousBiome);

  // TODO: This is floating
  playTween({
    targets: globalScene.arenaEnemy,
    x: "-=300",
  });
}
