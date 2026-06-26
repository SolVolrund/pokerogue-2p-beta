import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import { getPlayerModifierTypeOptions, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { queueEncounterMessage } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  getRandomEncounterPokemon,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterExp,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import {
  getEncounterPokemonLevelForWave,
  getSpriteKeysFromPokemon,
  STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER,
} from "#mystery-encounters/encounter-pokemon-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement, MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { STEALING_MOVES } from "#mystery-encounters/requirement-groups";
import { PokemonData } from "#system/pokemon-data";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { getComputerPartnerTeamConfidence } from "#utils/computer-partner-team-confidence";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/fightOrFlight";

type FightOrFlightReward = {
  playerIndex: PlayerIndex;
  item: ModifierTypeOption;
};

type FightOrFlightOptionIndex = 1 | 2 | 3;

interface FightOrFlightChoice {
  playerIndex: PlayerIndex;
  optionIndex: FightOrFlightOptionIndex;
}

interface FightOrFlightOffer {
  playerIndex: PlayerIndex;
  reward: FightOrFlightReward;
  bossConfig: EnemyPokemonConfig;
  bossName: string;
}

type FightOrFlightData = {
  offers: FightOrFlightOffer[];
  choices: FightOrFlightChoice[];
  skipSelectedDialogueOnce?: boolean;
};

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

function getFightOrFlightRewardTier(): ModifierTier {
  return globalScene.currentBattle.waveIndex > 160
    ? ModifierTier.MASTER
    : globalScene.currentBattle.waveIndex > 120
      ? ModifierTier.ROGUE
      : globalScene.currentBattle.waveIndex > 40
        ? ModifierTier.ULTRA
        : ModifierTier.GREAT;
}

function getFightOrFlightReward(playerIndex: PlayerIndex, tier: ModifierTier): FightOrFlightReward {
  const previousPlayerIndex = globalScene.activePlayerIndex;
  globalScene.setActivePlayerIndex(playerIndex);

  const party = globalScene.getPlayerParty(playerIndex);
  regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0);
  let item: ModifierTypeOption | null = null;
  // TMs and Candy Jar excluded from possible rewards as they're too swingy in value for a singular item reward
  while (!item || item.type.id.includes("TM_") || item.type.id === "CANDY_JAR") {
    item = getPlayerModifierTypeOptions(1, party, [], {
      guaranteedModifierTiers: [tier],
      allowLuckUpgrades: false,
    })[0];
  }

  globalScene.setActivePlayerIndex(previousPlayerIndex);
  return { playerIndex, item };
}

function getFightOrFlightBossConfig(level: number): { pokemonConfig: EnemyPokemonConfig; pokemon: Pokemon } {
  const bossPokemon = getRandomEncounterPokemon({
    level,
    isBoss: true,
    eventShinyRerolls: 2,
    eventHiddenRerolls: 1,
  });

  return {
    pokemon: bossPokemon,
    pokemonConfig: {
      level,
      species: bossPokemon.species,
      dataSource: new PokemonData(bossPokemon),
      isBoss: true,
      tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
      mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
        globalScene.currentBattle.mysteryEncounter?.setDialogueToken("enemyPokemon", pokemon.getNameToRender());
        queueEncounterMessage(`${namespace}:option.1.statBoost`);
        // Randomly boost 1 stat 2 stages. Cannot boost Spd, Acc, or Evasion.
        globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
          battlerIndex: pokemon.getBattlerIndex(),
          changes: [{ stat: randSeedInt(4, 1), stages: 2 }],
          sourcePokemon: pokemon,
        });
      },
    },
  };
}

function getFightOrFlightData(): FightOrFlightData {
  return globalScene.currentBattle.mysteryEncounter!.misc as FightOrFlightData;
}

function getFightOrFlightOffer(playerIndex: PlayerIndex): FightOrFlightOffer {
  return getFightOrFlightData().offers.find(offer => offer.playerIndex === playerIndex)!;
}

function getFightOrFlightStealingPokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return new MoveRequirement(STEALING_MOVES, true).queryParty(globalScene.getPlayerParty(playerIndex))[0];
}

function setFightOrFlightOfferTokens(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const offer = getFightOrFlightOffer(playerIndex);
  encounter.setDialogueToken("enemyPokemon", offer.bossName);
  encounter.setDialogueToken("itemName", offer.reward.item.type.name);
}

function setFightOrFlightRewards(offers: FightOrFlightOffer[]): void {
  for (const offer of offers) {
    setEncounterRewards(
      {
        guaranteedModifierTypeOptions: [offer.reward.item],
        fillRemaining: false,
      },
      undefined,
      undefined,
      offer.playerIndex,
    );
  }
}

function createFightOrFlightOffers(): FightOrFlightOffer[] {
  const level = getEncounterPokemonLevelForWave(STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER);
  const tier = getFightOrFlightRewardTier();
  return getMysteryEncounterPlayerIndexes().map(playerIndex => {
    const boss = getFightOrFlightBossConfig(level);
    return {
      playerIndex,
      reward: getFightOrFlightReward(playerIndex, tier),
      bossConfig: boss.pokemonConfig,
      bossName: boss.pokemon.getNameToRender(),
    };
  });
}

function getFightOrFlightItemX(playerIndex: PlayerIndex, playerCount: number): number {
  if (playerCount <= 1) {
    return 35;
  }
  if (playerCount > 2) {
    switch (playerIndex) {
      case 0:
        return 15;
      case 1:
        return 55;
      case 2:
        return 35;
    }
  }

  return playerIndex === 0 ? 25 : 45;
}

function getFightOrFlightPokemonX(playerIndex: PlayerIndex, playerCount: number): number {
  if (playerCount <= 1) {
    return -5;
  }
  if (playerCount > 2) {
    switch (playerIndex) {
      case 0:
        return -30;
      case 1:
        return 30;
      case 2:
        return 0;
    }
  }

  return playerIndex === 0 ? -20 : 20;
}

function getFightOrFlightSpritePokemon(offer: FightOrFlightOffer): Pokemon {
  return offer.bossConfig.dataSource!.toPokemon();
}

function chooseComputerPartnerFightOrFlightOption(playerIndex: PlayerIndex): FightOrFlightOptionIndex {
  if (getFightOrFlightStealingPokemon(playerIndex)) {
    return 2;
  }

  const confidence = getComputerPartnerTeamConfidence(globalScene.getPlayerParty(playerIndex));
  return confidence.level === "medium" || confidence.level === "high" ? 1 : 3;
}

function queueComputerPartnerFightOrFlightChoiceMessage(
  playerIndex: PlayerIndex,
  optionIndex: FightOrFlightOptionIndex,
): void {
  const profile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
  const optionLabel = i18next.t(`${namespace}:option.${optionIndex}.label`);
  globalScene.waitForPlayerInput(0);
  globalScene.phaseManager.queueMessage(`${profile.name}: Chose ${optionLabel}.`, null, true);
}

function buildFightOrFlightPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildFightOrFlightFightOption(playerIndex),
    buildFightOrFlightStealOption(playerIndex),
    buildFightOrFlightFleeOption(playerIndex),
  ];
}

async function promptNextFightOrFlightPlayer(
  playerIndex: PlayerIndex,
  startingCursorIndex: number,
): Promise<boolean> {
  setFightOrFlightOfferTokens(playerIndex);
  const result = await showMysteryEncounterPlayerMenu({
    playerIndex,
    slideInDescription: false,
    overrideQuery: i18next.t(`${namespace}:query`),
    overrideOptions: buildFightOrFlightPlayerOptions(playerIndex),
    startingCursorIndex,
    computerPartnerOption: {
      chooseOptionIndex: chooseComputerPartnerFightOrFlightOption,
      onOptionChosen: (optionIndex, choicePlayerIndex) =>
        storeFightOrFlightChoice(optionIndex as FightOrFlightOptionIndex, choicePlayerIndex),
    },
  });
  return result ?? false;
}

async function storeFightOrFlightChoice(
  optionIndex: FightOrFlightOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setFightOrFlightOfferTokens(playerIndex);

  const data = getFightOrFlightData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (globalScene.isComputerPartnerPlayer(playerIndex)) {
    queueComputerPartnerFightOrFlightChoiceMessage(playerIndex, optionIndex);
  }

  if (globalScene.twoPlayerMode) {
    const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex);
    if (nextPlayerIndex != null) {
      return promptNextFightOrFlightPlayer(nextPlayerIndex, optionIndex - 1);
    }

    data.skipSelectedDialogueOnce = true;
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
  }

  return true;
}

function hideFightOrFlightNonBattleTrainers(battlePlayers: PlayerIndex[]): void {
  if (!globalScene.twoPlayerMode) {
    return;
  }

  const battlePlayerSet = new Set(battlePlayers);
  getMysteryEncounterPlayerIndexes()
    .filter(playerIndex => !battlePlayerSet.has(playerIndex))
    .forEach(playerIndex => {
      const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
      globalScene.tweens.killTweensOf(trainerSprite);

      if (!trainerSprite.visible) {
        return;
      }

      globalScene.tweens.add({
        targets: trainerSprite,
        x: -36,
        duration: 500,
        onComplete: () => trainerSprite.setVisible(false),
      });
    });
}

function resolveFightOrFlightRewardsAndExp(choices: FightOrFlightChoice[]): void {
  const rewardOffers = choices
    .filter(choice => choice.optionIndex === 1 || choice.optionIndex === 2)
    .map(choice => getFightOrFlightOffer(choice.playerIndex));
  setFightOrFlightRewards(rewardOffers);

  for (const choice of choices.filter(choice => choice.optionIndex === 2)) {
    const thiefPokemon = getFightOrFlightStealingPokemon(choice.playerIndex);
    const offer = getFightOrFlightOffer(choice.playerIndex);
    if (thiefPokemon) {
      setEncounterExp(thiefPokemon.id, offer.bossConfig.species.baseExp, true, choice.playerIndex);
    }
  }

}

async function runFightOrFlightChoices(): Promise<boolean> {
  const choices = getFightOrFlightData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const fightingPlayers = choices
    .filter(choice => choice.optionIndex === 1)
    .map(choice => choice.playerIndex);

  resolveFightOrFlightRewardsAndExp(choices);
  hideFightOrFlightNonBattleTrainers(fightingPlayers);

  if (fightingPlayers.length === 0) {
    leaveEncounterWithoutBattle(choices.every(choice => choice.optionIndex === 3));
    return true;
  }

  const fightingOffers = fightingPlayers.map(getFightOrFlightOffer);
  const config: EnemyPartyConfig = {
    doubleBattle: fightingOffers.length > 1,
    pokemonConfigs: fightingOffers.map(offer => offer.bossConfig),
  };
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(fightingPlayers);
  await initBattleWithEnemyConfig(config);
  return true;
}

function buildFightOrFlightFightOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeFightOrFlightChoice(1, playerIndex))
    .withOptionPhase(runFightOrFlightChoices)
    .build();
}

function buildFightOrFlightStealOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerStealingMoveRequirement(playerIndex))
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
    .withPreOptionPhase(async () => storeFightOrFlightChoice(2, playerIndex))
    .withOptionPhase(runFightOrFlightChoices)
    .build();
}

function buildFightOrFlightFleeOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeFightOrFlightChoice(3, playerIndex))
    .withOptionPhase(runFightOrFlightChoices)
    .build();
}

/**
 * Fight or Flight encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3795 | GitHub Issue #3795}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const FightOrFlightEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.FIGHT_OR_FLIGHT,
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

    const offers = createFightOrFlightOffers();
    const playerCount = offers.length;
    encounter.enemyPartyConfigs = [
      {
        doubleBattle: playerCount > 1,
        pokemonConfigs: offers.map(offer => offer.bossConfig),
      },
    ];
    encounter.misc = {
      offers,
      choices: [],
    } satisfies FightOrFlightData;

    setFightOrFlightOfferTokens(offers[0].playerIndex);

    const itemSprites = offers.map(offer => ({
      spriteKey: offer.reward.item.type.iconImage,
      fileRoot: "items",
      hasShadow: false,
      x: getFightOrFlightItemX(offer.playerIndex, playerCount),
      y: -5,
      scale: 0.75,
      isItem: true,
      disableAnimation: true,
    }));
    const pokemonSprites = offers.map(offer => {
      const pokemon = getFightOrFlightSpritePokemon(offer);
      const { spriteKey, fileRoot } = getSpriteKeysFromPokemon(pokemon);
      return {
        spriteKey,
        fileRoot,
        hasShadow: true,
        tint: 0.25,
        x: getFightOrFlightPokemonX(offer.playerIndex, playerCount),
        repeat: true,
        isPokemon: true,
        isShiny: pokemon.shiny,
        variant: pokemon.variant,
      };
    });
    encounter.spriteConfigs = [...itemSprites, ...pokemonSprites];

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildFightOrFlightFightOption(0))
  .withOption(buildFightOrFlightStealOption(0))
  .withOption(buildFightOrFlightFleeOption(0))
  .build();
