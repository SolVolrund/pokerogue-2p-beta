import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { EncounterBattleAnim } from "#data/battle-anims";
import { allAbilities, modifierTypes } from "#data/data-lists";
import { Gender } from "#data/gender";
import { AbilityId } from "#enums/ability-id";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { EncounterAnim } from "#enums/encounter-anims";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat, type BattleStat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { AttackTypeBoosterModifierType } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  loadCustomMovesForEncounter,
  setEncounterExp,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import {
  applyAbilityOverrideToPokemon,
  applyDamageToPokemon,
  applyModifierTypeToPlayerPokemon,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import {
  AbilityRequirement,
  CombinationPokemonRequirement,
  EncounterPokemonRequirement,
  TypeRequirement,
} from "#mystery-encounters/mystery-encounter-requirements";
import { FIRE_RESISTANT_ABILITIES } from "#mystery-encounters/requirement-groups";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/fieryFallout";

/**
 * Damage percentage taken when suffering the heat.
 * Can be a number between `0` - `100`.
 * The higher the more damage taken (100% = instant KO).
 */
const DAMAGE_PERCENTAGE: number = 20;

type FieryFalloutOptionIndex = 1 | 2 | 3;

interface FieryFalloutChoice {
  playerIndex: PlayerIndex;
  optionIndex: FieryFalloutOptionIndex;
  helperPokemon?: PlayerPokemon;
}

interface FieryFalloutData {
  choices: FieryFalloutChoice[];
  selectingPlayerIndex?: PlayerIndex;
  skipSelectedDialogueOnce?: boolean;
}

class PlayerFireResistantRequirement extends EncounterPokemonRequirement {
  private readonly playerIndex: PlayerIndex | undefined;
  private readonly requirement: CombinationPokemonRequirement;

  constructor(playerIndex?: PlayerIndex) {
    super();
    this.playerIndex = playerIndex;
    this.requirement = createFireResistantRequirement();
    this.minNumberOfPokemon = 1;
    this.invertQuery = false;
  }

  override meetsRequirement(): boolean {
    return this.queryPlayerParty().length >= this.minNumberOfPokemon;
  }

  override queryParty(_partyPokemon: PlayerPokemon[]): PlayerPokemon[] {
    return this.queryPlayerParty();
  }

  override getDialogueToken(_pokemon?: PlayerPokemon): [string, string] {
    return ["type", PokemonType[PokemonType.FIRE]];
  }

  private queryPlayerParty(): PlayerPokemon[] {
    const party =
      globalScene.twoPlayerMode && this.playerIndex != null
        ? globalScene.getPlayerParty(this.playerIndex)
        : globalScene.getPlayerParty();

    return this.requirement.queryParty(party);
  }
}

function createFireResistantRequirement(): CombinationPokemonRequirement {
  return CombinationPokemonRequirement.Some(
    new TypeRequirement(PokemonType.FIRE, true, 1),
    new AbilityRequirement(FIRE_RESISTANT_ABILITIES, true),
  );
}

function getFieryFalloutData(): FieryFalloutData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      selectingPlayerIndex: 0,
    } satisfies FieryFalloutData;
  }

  return encounter.misc as FieryFalloutData;
}

function getFireResistantPokemon(playerIndex: PlayerIndex): PlayerPokemon | undefined {
  return createFireResistantRequirement().queryParty(globalScene.getPlayerParty(playerIndex))[0];
}

function getChoiceHelperPokemon(
  playerIndex: PlayerIndex,
  optionIndex: FieryFalloutOptionIndex,
): PlayerPokemon | undefined {
  return optionIndex === 3 ? getFireResistantPokemon(playerIndex) : undefined;
}

function storeFieryFalloutChoice(optionIndex: FieryFalloutOptionIndex, playerIndex: PlayerIndex = 0): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const data = getFieryFalloutData();
  const helperPokemon = getChoiceHelperPokemon(playerIndex, optionIndex);
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({
    playerIndex,
    optionIndex,
    ...(helperPokemon ? { helperPokemon } : {}),
  });

  if (playerIndex === 0) {
    data.selectingPlayerIndex = 1;
    showFieryFalloutPlayerMenu(1, optionIndex - 1);
    return false;
  }

  delete data.selectingPlayerIndex;
  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function showFieryFalloutPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  const overrideOptions = buildFieryFalloutPlayerOptions(playerIndex);
  setFieryFalloutPlayerOptionTokens(playerIndex);
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: "What will you do?",
      overrideOptions,
      startingCursorIndex,
    });
  });
}

function setFieryFalloutPlayerOptionTokens(playerIndex: PlayerIndex): void {
  const helperPokemon = getFireResistantPokemon(playerIndex);
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("option3PrimaryName", helperPokemon?.getNameToRender() ?? "");
}

function buildFieryFalloutPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildFindSourceOption(playerIndex),
    buildHunkerDownOption(playerIndex),
    buildFireResistantHelpOption(playerIndex),
  ];
}

function buildFindSourceOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeFieryFalloutChoice(1, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerFieryFalloutChoices() : runOnePlayerFindSource(),
    )
    .build();
}

function buildHunkerDownOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeFieryFalloutChoice(2, playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerFieryFalloutChoices() : runOnePlayerHunkerDown(),
    )
    .build();
}

function buildFireResistantHelpOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerFireResistantRequirement(playerIndex))
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
    .withPreOptionPhase(async () => {
      if (!globalScene.twoPlayerMode) {
        transitionMysteryEncounterIntroVisuals(false, false, 2000);
      }
      return storeFieryFalloutChoice(3, playerIndex);
    })
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerFieryFalloutChoices() : runOnePlayerFireResistantHelp(),
    )
    .build();
}

/**
 * Fiery Fallout encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3814 | GitHub Issue #3814}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const FieryFalloutEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.FIERY_FALLOUT,
)
  .withEncounterTier(MysteryEncounterTier.COMMON)
  .withSceneWaveRangeRequirement(40, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withCatchAllowed(true)
  .withIntroSpriteConfigs([]) // Set in onInit()
  .withAnimations(EncounterAnim.MAGMA_BG, EncounterAnim.MAGMA_SPOUT)
  .withAutoHideIntroVisuals(false)
  .withFleeAllowed(false)
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    encounter.enemyPartyConfigs = [createVolcaronaEnemyPartyConfig(2)];
    if (globalScene.twoPlayerMode) {
      encounter.misc = {
        ...(encounter.misc ?? {}),
        choices: [],
        selectingPlayerIndex: 0,
      } satisfies FieryFalloutData;
    }

    // Load hidden Volcarona sprites
    encounter.spriteConfigs = [
      {
        spriteKey: "",
        fileRoot: "",
        species: SpeciesId.VOLCARONA,
        repeat: true,
        hidden: true,
        hasShadow: true,
        x: -20,
        startFrame: 20,
      },
      {
        spriteKey: "",
        fileRoot: "",
        species: SpeciesId.VOLCARONA,
        repeat: true,
        hidden: true,
        hasShadow: true,
        x: 20,
      },
    ];

    // Load animations/sfx for Volcarona moves
    loadCustomMovesForEncounter([MoveId.FIRE_SPIN, MoveId.QUIVER_DANCE]);

    const pokemon = globalScene.getEnemyPokemon();
    globalScene.arena.trySetWeather(WeatherType.SUNNY, pokemon);

    encounter.setDialogueToken("volcaronaName", getPokemonSpecies(SpeciesId.VOLCARONA).getName());

    return true;
  })
  .withOnVisualsStart(() => {
    // Play animations
    const background = new EncounterBattleAnim(
      EncounterAnim.MAGMA_BG,
      globalScene.getPlayerPokemon()!,
      globalScene.getPlayerPokemon(),
    );
    background.playWithoutTargets(200, 70, 2, 3);
    const animation = new EncounterBattleAnim(
      EncounterAnim.MAGMA_SPOUT,
      globalScene.getPlayerPokemon()!,
      globalScene.getPlayerPokemon(),
    );
    animation.playWithoutTargets(80, 100, 2);
    globalScene.time.delayedCall(600, () => {
      animation.playWithoutTargets(-20, 100, 2);
    });
    globalScene.time.delayedCall(1200, () => {
      animation.playWithoutTargets(140, 150, 2);
    });

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildFindSourceOption(0))
  .withOption(buildHunkerDownOption(0))
  .withOption(buildFireResistantHelpOption(0))
  .build();

function createVolcaronaPokemonConfig(gender: Gender): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(SpeciesId.VOLCARONA),
    isBoss: false,
    gender,
    tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
    mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
        battlerIndex: pokemon.getBattlerIndex(),
        changes: ([Stat.SPDEF, Stat.SPD] as BattleStat[]).map(stat => ({ stat, stages: 1 })),
        sourcePokemon: pokemon,
      });
    },
  };
}

function createVolcaronaEnemyPartyConfig(volcaronaCount: 1 | 2): EnemyPartyConfig {
  const pokemonConfigs = [
    createVolcaronaPokemonConfig(Gender.MALE),
    ...(volcaronaCount > 1 ? [createVolcaronaPokemonConfig(Gender.FEMALE)] : []),
  ];

  return {
    pokemonConfigs,
    doubleBattle: volcaronaCount > 1,
    disableSwitch: true,
  };
}

async function runOnePlayerFindSource(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  setEncounterRewards({ fillRemaining: true }, undefined, () => giveLeadPokemonAttackTypeBoostItem());
  queueVolcaronaStartOfBattleEffects([0], 2);
  await initBattleWithEnemyConfig(encounter.enemyPartyConfigs[0]);
}

async function runOnePlayerHunkerDown(): Promise<void> {
  applyHunkerDownForPlayer(0);
  leaveEncounterWithoutBattle(true);
}

async function runOnePlayerFireResistantHelp(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  await transitionMysteryEncounterIntroVisuals();
  setEncounterRewards({ fillRemaining: true }, undefined, () => giveLeadPokemonAttackTypeBoostItem());

  const primary = encounter.options[2].primaryPokemon!;
  setEncounterExp([primary.id], getPokemonSpecies(SpeciesId.VOLCARONA).baseExp * 2);
  leaveEncounterWithoutBattle();
}

async function runTwoPlayerFieryFalloutChoices(): Promise<void> {
  const choices = getFieryFalloutData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const sourceChoices = choices.filter(choice => choice.optionIndex === 1);
  const hunkerChoices = choices.filter(choice => choice.optionIndex === 2);
  const helperChoices = choices.filter(choice => choice.optionIndex === 3);

  for (const choice of choices) {
    await showFieryFalloutSelectedMessage(choice);
  }

  for (const choice of helperChoices) {
    applyFieryFalloutHelperReward(choice);
  }

  const helperSoftensHeat = helperChoices.length > 0;
  for (const choice of hunkerChoices) {
    applyHunkerDownForPlayer(choice.playerIndex, helperSoftensHeat ? 0.5 : 1, !helperSoftensHeat);
  }

  if (sourceChoices.length === 0) {
    leaveEncounterWithoutBattle(hunkerChoices.length > 0 && helperChoices.length === 0);
    return;
  }

  const sourcePlayers = sourceChoices.map(choice => choice.playerIndex);
  const volcaronaCount = sourceChoices.length > 1 || (helperChoices.length === 0 && choices.length > 1) ? 2 : 1;

  for (const choice of sourceChoices) {
    setEncounterRewards(
      { fillRemaining: true },
      undefined,
      () => giveLeadPokemonAttackTypeBoostItem(choice.playerIndex),
      choice.playerIndex,
    );
  }

  globalScene.setMysteryEncounterBattlePlayerFieldOwners(sourcePlayers);
  queueVolcaronaStartOfBattleEffects(sourcePlayers, volcaronaCount);
  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await initBattleWithEnemyConfig(createVolcaronaEnemyPartyConfig(volcaronaCount));
}

async function showFieryFalloutSelectedMessage(choice: FieryFalloutChoice): Promise<void> {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);

  if (choice.optionIndex === 3) {
    globalScene.currentBattle.mysteryEncounter!.setDialogueToken(
      "option3PrimaryName",
      choice.helperPokemon?.getNameToRender() ?? "",
    );
  }

  await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
}

function applyFieryFalloutHelperReward(choice: FieryFalloutChoice): void {
  if (!choice.helperPokemon) {
    return;
  }

  setEncounterRewards(
    { fillRemaining: true },
    undefined,
    () => giveLeadPokemonAttackTypeBoostItem(choice.playerIndex),
    choice.playerIndex,
  );
  setEncounterExp(
    [choice.helperPokemon.id],
    getPokemonSpecies(SpeciesId.VOLCARONA).baseExp * 2,
    true,
    choice.playerIndex,
  );
}

function applyHunkerDownForPlayer(playerIndex: PlayerIndex, damageMultiplier = 1, allowBurn = true): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const nonFireTypes = globalScene
    .getPlayerParty(playerIndex)
    .filter(p => p.isAllowedInBattle() && !p.isOfType(PokemonType.FIRE, { includeTeraType: false }));

  for (const pkm of nonFireTypes) {
    const percentage = (DAMAGE_PERCENTAGE / 100) * damageMultiplier;
    const damage = Math.floor(pkm.getMaxHp() * percentage);
    applyDamageToPokemon(pkm, damage);
  }

  if (!allowBurn) {
    return;
  }

  const burnable = nonFireTypes.filter(
    p => p.status == null || p.status.effect == null || p.status.effect === StatusEffect.NONE,
  );
  if (burnable.length === 0) {
    return;
  }

  const chosenPokemon = burnable[randSeedInt(burnable.length)];
  if (!chosenPokemon.canSetStatus(StatusEffect.BURN, true)) {
    return;
  }

  chosenPokemon.doSetStatus(StatusEffect.BURN);
  encounter.setDialogueToken("burnedPokemon", chosenPokemon.getNameToRender());
  encounter.setDialogueToken("abilityName", allAbilities[AbilityId.HEATPROOF].name);
  queueEncounterMessage(`${namespace}:option.2.targetBurned`);
  applyAbilityOverrideToPokemon(chosenPokemon, AbilityId.HEATPROOF);
}

function queueVolcaronaStartOfBattleEffects(playerIndexes: PlayerIndex[], volcaronaCount: 1 | 2): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const secondTarget =
    globalScene.twoPlayerMode && playerIndexes.length === 1 ? BattlerIndex.PLAYER : BattlerIndex.PLAYER_2;
  encounter.startOfBattleEffects.push(
    {
      sourceBattlerIndex: BattlerIndex.ENEMY,
      targets: [BattlerIndex.PLAYER],
      move: new PokemonMove(MoveId.FIRE_SPIN),
      useMode: MoveUseMode.IGNORE_PP,
    },
    ...(volcaronaCount > 1
      ? [
          {
            sourceBattlerIndex: BattlerIndex.ENEMY_2,
            targets: [secondTarget],
            move: new PokemonMove(MoveId.FIRE_SPIN),
            useMode: MoveUseMode.IGNORE_PP,
          },
        ]
      : []),
  );
}

function giveLeadPokemonAttackTypeBoostItem(playerIndex: PlayerIndex = globalScene.activePlayerIndex) {
  globalScene.setActivePlayerIndex(playerIndex);

  // Give first party pokemon attack type boost item for free at end of battle
  const leadPokemon = globalScene.getPlayerParty(playerIndex)?.[0];
  if (leadPokemon) {
    // Generate type booster held item, default to Charcoal if item fails to generate
    let boosterModifierType = generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER) as AttackTypeBoosterModifierType;
    if (!boosterModifierType) {
      boosterModifierType = generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [
        PokemonType.FIRE,
      ]) as AttackTypeBoosterModifierType;
    }
    applyModifierTypeToPlayerPokemon(leadPokemon, boosterModifierType);

    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken("itemName", boosterModifierType.name);
    encounter.setDialogueToken("leadPokemon", leadPokemon.getNameToRender());
    queueEncounterMessage(`${namespace}:foundItem`);
  }
}
