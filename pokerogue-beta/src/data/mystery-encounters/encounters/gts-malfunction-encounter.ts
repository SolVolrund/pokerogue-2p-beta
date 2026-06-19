import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { BattleType } from "#enums/battle-type";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { randSeedInt, randSeedItem, randSeedShuffle } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** i18n namespace for the encounter */
const namespace = "mysteryEncounters/gtsMalfunction";

const GTS_MALFUNCTION_FORCED_TEST_WAVE: number | null = 2;
const GTS_MALFUNCTION_SEED_OFFSET = 81237;

type GtsPokemonPair = readonly [SpeciesId, SpeciesId];

const TRADE_EVO_PAIRS: GtsPokemonPair[] = [
  [SpeciesId.ALAKAZAM, SpeciesId.GENGAR],
  [SpeciesId.GOLEM, SpeciesId.MACHAMP],
  [SpeciesId.GIGALITH, SpeciesId.CONKELDURR],
  [SpeciesId.TREVENANT, SpeciesId.GOURGEIST],
  [SpeciesId.ESCAVALIER, SpeciesId.ACCELGOR],
  [SpeciesId.POLITOED, SpeciesId.SLOWKING],
  [SpeciesId.STEELIX, SpeciesId.SCIZOR],
  [SpeciesId.HUNTAIL, SpeciesId.GOREBYSS],
  [SpeciesId.RHYPERIOR, SpeciesId.ELECTIVIRE],
  [SpeciesId.ELECTIVIRE, SpeciesId.MAGMORTAR],
  [SpeciesId.MAGMORTAR, SpeciesId.RHYPERIOR],
  [SpeciesId.AROMATISSE, SpeciesId.SLURPUFF],
  [SpeciesId.MILOTIC, SpeciesId.DUSKNOIR],
];

const TRADE_EXCLUSIVE_PAIRS: GtsPokemonPair[] = [
  [SpeciesId.EKANS, SpeciesId.SANDSHREW],
  [SpeciesId.ODDISH, SpeciesId.BELLSPROUT],
  [SpeciesId.GROWLITHE, SpeciesId.VULPIX],
  [SpeciesId.MANKEY, SpeciesId.MEOWTH],
  [SpeciesId.SCYTHER, SpeciesId.PINSIR],
  [SpeciesId.KABUTO, SpeciesId.OMANYTE],
  [SpeciesId.LEDYBA, SpeciesId.SPINARAK],
  [SpeciesId.GLIGAR, SpeciesId.DELIBIRD],
  [SpeciesId.TEDDIURSA, SpeciesId.PHANPY],
  [SpeciesId.MANTINE, SpeciesId.SKARMORY],
  [SpeciesId.HOUNDOUR, SpeciesId.SNEASEL],
  [SpeciesId.LARVITAR, SpeciesId.BAGON],
  [SpeciesId.SEEDOT, SpeciesId.LOTAD],
  [SpeciesId.ZANGOOSE, SpeciesId.SEVIPER],
  [SpeciesId.SOLROCK, SpeciesId.LUNATONE],
  [SpeciesId.GOTHITA, SpeciesId.SOLOSIS],
  [SpeciesId.SAWK, SpeciesId.THROH],
  [SpeciesId.CRANIDOS, SpeciesId.SHIELDON],
  [SpeciesId.LILEEP, SpeciesId.ANORITH],
  [SpeciesId.TIRTOUGA, SpeciesId.ARCHEN],
  [SpeciesId.JANGMO_O, SpeciesId.GOOMY],
  [SpeciesId.MAWILE, SpeciesId.SABLEYE],
];

const GTS_MALFUNCTION_BUCKETS = [
  { min: 10, max: 20, weight: 1 },
  { min: 21, max: 30, weight: 3 },
  { min: 31, max: 40, weight: 6 },
  { min: 41, max: 50, weight: 10 },
  { min: 51, max: 60, weight: 15 },
  { min: 61, max: 70, weight: 21 },
  { min: 71, max: 80, weight: 26 },
  { min: 81, max: 90, weight: 30 },
  { min: 91, max: 100, weight: 31 },
  { min: 101, max: 110, weight: 30 },
  { min: 111, max: 120, weight: 26 },
  { min: 121, max: 130, weight: 21 },
  { min: 131, max: 140, weight: 15 },
  { min: 141, max: 150, weight: 10 },
  { min: 151, max: 160, weight: 6 },
  { min: 161, max: 170, weight: 3 },
  { min: 171, max: 180, weight: 1 },
] as const;

class GtsMalfunctionSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    return (
      globalScene.twoPlayerMode
      && globalScene.currentBattle.waveIndex === getGtsMalfunctionTargetWave()
      && ([0, 1] as PlayerIndex[]).every(playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length >= 2)
    );
  }

  override getDialogueToken(): [string, string] {
    return ["gtsWave", getGtsMalfunctionTargetWave().toString()];
  }
}

function getGtsModsTeamSize(wave: number): number {
  const clamped = Math.max(10, Math.min(180, wave));
  const index = Math.floor(((clamped - 10) * 6) / 171);
  return 2 + Math.min(index, 5) * 2;
}

function getGtsMalfunctionTargetWave(): number {
  if (GTS_MALFUNCTION_FORCED_TEST_WAVE != null) {
    return GTS_MALFUNCTION_FORCED_TEST_WAVE;
  }

  let targetWave = 10;

  globalScene.executeWithSeedOffset(() => {
    const weightedBuckets = GTS_MALFUNCTION_BUCKETS.map(bucket => ({
      ...bucket,
      waves: getGtsMalfunctionEligibleWaves(bucket.min, bucket.max),
    })).filter(bucket => bucket.waves.length > 0);
    const totalWeight = weightedBuckets.reduce((total, bucket) => total + bucket.weight, 0);
    let roll = randSeedInt(totalWeight);
    const bucket =
      weightedBuckets.find(bucket => {
        roll -= bucket.weight;
        return roll < 0;
      }) ?? weightedBuckets[0];

    targetWave = randSeedItem(bucket.waves);
  }, GTS_MALFUNCTION_SEED_OFFSET);

  return targetWave;
}

function getGtsMalfunctionEligibleWaves(min: number, max: number): number[] {
  const waves: number[] = [];
  for (let wave = min; wave <= max; wave++) {
    if (
      globalScene.isMysteryEncounterValidForWave(BattleType.WILD, wave)
      && !globalScene.gameMode.isFixedBattle(wave)
      && !globalScene.gameMode.isWaveFinal(wave)
    ) {
      waves.push(wave);
    }
  }

  return waves;
}

function getGtsMalfunctionPairPool(pairIndex: number): GtsPokemonPair[] {
  return pairIndex % 2 === 0 ? TRADE_EXCLUSIVE_PAIRS : TRADE_EVO_PAIRS;
}

function getGtsMalfunctionEnemyConfigs(wave: number): EnemyPokemonConfig[] {
  const usedSpecies = new Set<SpeciesId>();
  const speciesIds: SpeciesId[] = [];
  const pairCount = getGtsModsTeamSize(wave) / 2;

  for (let pairIndex = 0; pairIndex < pairCount; pairIndex++) {
    const pool = getGtsMalfunctionPairPool(pairIndex);
    const unusedPool = pool.filter(pair => !usedSpecies.has(pair[0]) && !usedSpecies.has(pair[1]));
    const pair = randSeedItem(unusedPool.length > 0 ? unusedPool : pool);

    usedSpecies.add(pair[0]);
    usedSpecies.add(pair[1]);
    speciesIds.push(pair[0], pair[1]);
  }

  return speciesIds.map(speciesId => ({
    species: getPokemonSpecies(speciesId),
    isBoss: false,
  }));
}

function buildGtsMalfunctionBattleConfig(): EnemyPartyConfig {
  return {
    doubleBattle: true,
    pokemonConfigs: getGtsMalfunctionEnemyConfigs(globalScene.currentBattle.waveIndex),
    countAsSeen: false,
  };
}

function buildGtsMalfunctionIntroSpriteConfigs() {
  return [
    {
      spriteKey: "global_trade_system",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      disableAnimation: true,
      x: 3,
      y: 5,
      yShadow: 1,
    },
    {
      spriteKey: randSeedInt(2) ? "scientist_f" : "scientist_m",
      fileRoot: "trainer",
      hasShadow: true,
      x: -18,
      y: 4,
    },
  ];
}

function getPlayerHeldItemModifiers(pokemon: PlayerPokemon, playerIndex: PlayerIndex): PokemonHeldItemModifier[] {
  return globalScene.findModifiersForPlayer(
    modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === pokemon.id,
    playerIndex,
  ) as PokemonHeldItemModifier[];
}

function moveHeldItemModifiers(
  modifiers: PokemonHeldItemModifier[],
  fromPlayer: PlayerIndex,
  toPlayer: PlayerIndex,
): void {
  const sourceModifiers = globalScene.getPlayerModifiers(fromPlayer);
  const targetModifiers = globalScene.getPlayerModifiers(toPlayer);

  for (const modifier of modifiers) {
    const sourceIndex = sourceModifiers.indexOf(modifier);
    if (sourceIndex > -1) {
      sourceModifiers.splice(sourceIndex, 1);
      targetModifiers.push(modifier);
    }
  }
}

function swapPlayerPokemon(
  firstPlayerIndex: PlayerIndex,
  firstPartyIndex: number,
  secondPlayerIndex: PlayerIndex,
  secondPartyIndex: number,
): void {
  const firstParty = globalScene.getPlayerParty(firstPlayerIndex);
  const secondParty = globalScene.getPlayerParty(secondPlayerIndex);
  const firstPokemon = firstParty[firstPartyIndex];
  const secondPokemon = secondParty[secondPartyIndex];

  if (!firstPokemon || !secondPokemon) {
    return;
  }

  const firstPokemonHeldItems = getPlayerHeldItemModifiers(firstPokemon, firstPlayerIndex);
  const secondPokemonHeldItems = getPlayerHeldItemModifiers(secondPokemon, secondPlayerIndex);

  firstParty[firstPartyIndex] = secondPokemon;
  secondParty[secondPartyIndex] = firstPokemon;

  moveHeldItemModifiers(firstPokemonHeldItems, firstPlayerIndex, secondPlayerIndex);
  moveHeldItemModifiers(secondPokemonHeldItems, secondPlayerIndex, firstPlayerIndex);
}

function refreshPlayerPartyModifiers(): void {
  const previousActivePlayer = globalScene.activePlayerIndex;

  for (const playerIndex of [0, 1] as PlayerIndex[]) {
    globalScene.setActivePlayerIndex(playerIndex);
    globalScene.updateModifiers(true, true, playerIndex);
  }

  globalScene.setActivePlayerIndex(previousActivePlayer);
}

function tradePlayerTeams(): void {
  const partySizes = ([0, 1] as PlayerIndex[]).map(playerIndex => globalScene.getPlayerParty(playerIndex).length);
  const sourcePlayerIndex: PlayerIndex =
    partySizes[0] === partySizes[1] ? (randSeedInt(2) as PlayerIndex) : partySizes[0] < partySizes[1] ? 0 : 1;
  const targetPlayerIndex: PlayerIndex = sourcePlayerIndex === 0 ? 1 : 0;
  const sourcePartyIndexes = randSeedShuffle(
    globalScene.getPlayerParty(sourcePlayerIndex).map((_, partyIndex) => partyIndex),
  );

  for (const sourcePartyIndex of sourcePartyIndexes) {
    const targetParty = globalScene.getPlayerParty(targetPlayerIndex);
    const targetPartyIndex = randSeedInt(targetParty.length);
    swapPlayerPokemon(sourcePlayerIndex, sourcePartyIndex, targetPlayerIndex, targetPartyIndex);
  }

  refreshPlayerPartyModifiers();
}

function hideGtsMalfunctionIntroVisuals(): Promise<void> {
  return new Promise(resolve => {
    const introVisuals = globalScene.currentBattle.mysteryEncounter?.introVisuals;
    if (!introVisuals || !introVisuals.visible) {
      resolve();
      return;
    }

    globalScene.tweens.add({
      targets: introVisuals,
      x: "+=16",
      y: "-=16",
      alpha: 0,
      ease: "Sine.easeInOut",
      duration: 750,
      onComplete: () => {
        introVisuals.setVisible(false);
        resolve();
      },
    });
  });
}

async function startGtsMalfunctionBattle(): Promise<boolean> {
  await showEncounterText(`${namespace}:tradeStart`);
  tradePlayerTeams();
  await showEncounterText(`${namespace}:battleStart`);
  await hideGtsMalfunctionIntroVisuals();

  for (const playerIndex of [0, 1] as PlayerIndex[]) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.LINKING_CORD_GOLD],
        fillRemaining: false,
        rerollMultiplier: -1,
      },
      undefined,
      undefined,
      playerIndex,
    );
  }

  globalScene.setActivePlayerIndex(0);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners([0, 1]);
  await initBattleWithEnemyConfig(buildGtsMalfunctionBattleConfig());
  return true;
}

/**
 * GTS Malfunction encounter.
 *
 * A two-player-only event where a Scientist's experimental GTS upgrade shuffles
 * the players' teams, then drops them into a double battle against angry traded Pokemon.
 */
export const GtsMalfunctionEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.GTS_MALFUNCTION,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(GTS_MALFUNCTION_FORCED_TEST_WAVE ?? 10, GTS_MALFUNCTION_FORCED_TEST_WAVE ?? 180)
  .withSceneRequirement(new GtsMalfunctionSpawnRequirement())
  .withTwoPlayerSharedDecision()
  .withMaxAllowedEncounters(1)
  .withHideWildIntroMessage(true)
  .withFleeAllowed(false)
  .withPreventGameStatsUpdates(true)
  .withIntroSpriteConfigs([])
  .withAutoHideIntroVisuals(false)
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withOnInit(() => {
    globalScene.currentBattle.mysteryEncounter!.spriteConfigs = buildGtsMalfunctionIntroSpriteConfigs();
    return true;
  })
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.1.label`,
        buttonTooltip: `${namespace}:option.1.tooltip`,
        selected: [
          {
            text: `${namespace}:option.1.selected`,
          },
        ],
      })
      .withOptionPhase(startGtsMalfunctionBattle)
      .build(),
  )
  .withOption(
    MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
      .withDialogue({
        buttonLabel: `${namespace}:option.2.label`,
        buttonTooltip: `${namespace}:option.2.tooltip`,
        selected: [
          {
            text: `${namespace}:option.2.selected`,
          },
        ],
      })
      .withOptionPhase(async () => {
        leaveEncounterWithoutBattle(true);
        return true;
      })
      .build(),
  )
  .build();
