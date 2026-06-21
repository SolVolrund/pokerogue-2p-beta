import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { EncounterBattleAnim } from "#data/battle-anims";
import { modifierTypes } from "#data/data-lists";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BiomeId } from "#enums/biome-id";
import { EncounterAnim } from "#enums/encounter-anims";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import { EnemyPokemon } from "#field/pokemon";
import { PokemonMove } from "#moves/pokemon-move";
import { getEncounterText, queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import {
  catchPokemon,
  getEncounterPokemonLevelForWave,
  STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER,
} from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterPokemonRequirement, MoveRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { DANCING_MOVES } from "#mystery-encounters/requirement-groups";
import { PokemonData } from "#system/pokemon-data";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedInt } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for this encounter */
const namespace = "mysteryEncounters/dancingLessons";

// Fire form
const BAILE_STYLE_BIOMES: readonly BiomeId[] = [
  BiomeId.VOLCANO,
  BiomeId.BEACH,
  BiomeId.ISLAND,
  BiomeId.WASTELAND,
  BiomeId.MOUNTAIN,
  BiomeId.BADLANDS,
  BiomeId.DESERT,
];

// Electric form
const POM_POM_STYLE_BIOMES: readonly BiomeId[] = [
  BiomeId.CONSTRUCTION_SITE,
  BiomeId.POWER_PLANT,
  BiomeId.FACTORY,
  BiomeId.LABORATORY,
  BiomeId.SLUM,
  BiomeId.METROPOLIS,
  BiomeId.DOJO,
];

// Psychic form
const PAU_STYLE_BIOMES: readonly BiomeId[] = [
  BiomeId.JUNGLE,
  BiomeId.FAIRY_CAVE,
  BiomeId.MEADOW,
  BiomeId.PLAINS,
  BiomeId.GRASS,
  BiomeId.TALL_GRASS,
  BiomeId.FOREST,
];

// Ghost form
const SENSU_STYLE_BIOMES: readonly BiomeId[] = [
  BiomeId.RUINS,
  BiomeId.SWAMP,
  BiomeId.CAVE,
  BiomeId.ABYSS,
  BiomeId.GRAVEYARD,
  BiomeId.LAKE,
  BiomeId.TEMPLE,
];

type DancingLessonsOptionIndex = 1 | 2 | 3;

interface DancingLessonsChoice {
  playerIndex: PlayerIndex;
  optionIndex: DancingLessonsOptionIndex;
  selectedPokemon?: PlayerPokemon;
  selectedMove?: PokemonMove;
}

interface DancingLessonsData {
  choices: DancingLessonsChoice[];
  oricorioDataByPlayer: Record<PlayerIndex, PokemonData>;
  skipSelectedDialogueOnce?: boolean;
}

class PlayerMoveRequirement extends EncounterPokemonRequirement {
  private readonly moveRequirement: MoveRequirement;
  private readonly playerIndex: PlayerIndex | undefined;

  constructor(playerIndex?: PlayerIndex) {
    super();
    this.playerIndex = playerIndex;
    this.moveRequirement = new MoveRequirement(DANCING_MOVES, true);
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
    const party =
      globalScene.twoPlayerMode && this.playerIndex != null
        ? globalScene.getPlayerParty(this.playerIndex)
        : globalScene.getPlayerParty();

    return this.moveRequirement.queryParty(party);
  }
}

function getDancingLessonsData(): DancingLessonsData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      oricorioDataByPlayer: encounter.misc?.oricorioDataByPlayer ?? {
        0: encounter.misc?.oricorioData,
        1: encounter.misc?.oricorioData,
      },
    } satisfies DancingLessonsData;
  }

  return encounter.misc as DancingLessonsData;
}

function getBiomeOricorioFormIndex(): number {
  const currentBiome = globalScene.arena.biomeId;
  if (BAILE_STYLE_BIOMES.includes(currentBiome)) {
    return 0;
  }
  if (POM_POM_STYLE_BIOMES.includes(currentBiome)) {
    return 1;
  }
  if (PAU_STYLE_BIOMES.includes(currentBiome)) {
    return 2;
  }
  if (SENSU_STYLE_BIOMES.includes(currentBiome)) {
    return 3;
  }
  return 0;
}

function getAlternateOricorioFormIndex(primaryFormIndex: number): number {
  const alternateForms = [0, 1, 2, 3].filter(formIndex => formIndex !== primaryFormIndex);
  return alternateForms[randSeedInt(alternateForms.length)];
}

function ensureRevelationDance(pokemon: EnemyPokemon): void {
  if (!pokemon.moveset.some(m => m && m.getMove().id === MoveId.REVELATION_DANCE)) {
    if (pokemon.moveset.length < 4) {
      pokemon.moveset.push(new PokemonMove(MoveId.REVELATION_DANCE));
    } else {
      pokemon.moveset[0] = new PokemonMove(MoveId.REVELATION_DANCE);
    }
  }
}

function createOricorioData(formIndex: number): PokemonData {
  const species = getPokemonSpecies(SpeciesId.ORICORIO);
  const level = getEncounterPokemonLevelForWave(STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER);
  const enemyPokemon = new EnemyPokemon(species, level, TrainerSlot.NONE, false);
  enemyPokemon.formIndex = formIndex;
  ensureRevelationDance(enemyPokemon);
  return new PokemonData(enemyPokemon);
}

function addVisualOricorio(data: PokemonData, slotIndex: number, totalSlots: number): EnemyPokemon {
  const species = getPokemonSpecies(SpeciesId.ORICORIO);
  const level = getEncounterPokemonLevelForWave(STANDARD_ENCOUNTER_BOOSTED_LEVEL_MODIFIER);
  const oricorio = globalScene.addEnemyPokemon(species, level, TrainerSlot.NONE, false, false, data);
  oricorio.setFieldPosition(
    totalSlots > 1 ? (slotIndex === 0 ? FieldPosition.LEFT : FieldPosition.RIGHT) : FieldPosition.CENTER,
    0,
  );
  const [fieldOffsetX, fieldOffsetY] = oricorio.getFieldPositionOffset();
  oricorio.setPosition(236 + fieldOffsetX - 300, 84 + fieldOffsetY);
  globalScene.field.add(oricorio);
  globalScene.currentBattle.mysteryEncounter!.loadAssets.push(oricorio.loadAssets());
  return oricorio;
}

function setDancingLessonsChoice(choice: DancingLessonsChoice): void {
  const data = getDancingLessonsData();
  data.choices = data.choices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.choices.push(choice);
  setDancingLessonsChoiceTokens(choice);
}

function setDancingLessonsChoiceTokens(choice: DancingLessonsChoice): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (choice.selectedPokemon) {
    encounter.setDialogueToken("selectedPokemon", choice.selectedPokemon.getNameToRender());
  }
  if (choice.selectedMove) {
    encounter.setDialogueToken("selectedMove", choice.selectedMove.getName());
  }
}

function focusDancingLessonsPlayer(playerIndex: PlayerIndex): void {
  if (globalScene.twoPlayerMode) {
    globalScene.waitForPlayerInput(playerIndex);
    return;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
}

function setDancingLessonsPlayerOptionTokens(playerIndex: PlayerIndex): void {
  const pokemon = new MoveRequirement(DANCING_MOVES, true).queryParty(globalScene.getPlayerParty(playerIndex))[0];
  const move = pokemon?.moveset.find(move => move && DANCING_MOVES.includes(move.getMove().id));
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.setDialogueToken("option3PrimaryName", pokemon?.getNameToRender() ?? "");
  encounter.setDialogueToken("option3PrimaryMove", move?.getName() ?? "");
}

function showDancingLessonsPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.waitForPlayerInput(playerIndex);
  setDancingLessonsPlayerOptionTokens(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildDancingLessonsPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function finishDancingLessonsChoiceCollection(playerIndex: PlayerIndex, startingCursorIndex: number): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  if (playerIndex === 0) {
    showDancingLessonsPlayerMenu(1, startingCursorIndex);
    return false;
  }

  const data = getDancingLessonsData();
  data.skipSelectedDialogueOnce = true;
  globalScene.waitForPlayerInput(0);
  return true;
}

function getDancingLessonsOricorioConfig(playerIndex: PlayerIndex): EnemyPokemonConfig {
  const data = getDancingLessonsData();
  return {
    species: getPokemonSpecies(SpeciesId.ORICORIO),
    dataSource: data.oricorioDataByPlayer[playerIndex],
    isBoss: true,
    tags: [BattlerTagType.MYSTERY_ENCOUNTER_POST_SUMMON],
    mysteryEncounterBattleEffects: (pokemon: Pokemon) => {
      queueEncounterMessage(`${namespace}:option.1.bossEnraged`);
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF],
        1,
      );
    },
  };
}

function buildDancingLessonsBattleConfig(enemyOwnerIndexes: PlayerIndex[]): EnemyPartyConfig {
  return {
    doubleBattle: enemyOwnerIndexes.length > 1,
    pokemonConfigs: enemyOwnerIndexes.map(playerIndex => getDancingLessonsOricorioConfig(playerIndex)),
  };
}

function queueDancingLessonsStartOfBattleEffects(
  battlePlayers: PlayerIndex[],
  enemyOwnerIndexes: PlayerIndex[],
): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  for (const [enemyIndex] of enemyOwnerIndexes.entries()) {
    encounter.startOfBattleEffects.push({
      sourceBattlerIndex: enemyIndex === 0 ? BattlerIndex.ENEMY : BattlerIndex.ENEMY_2,
      targets: [
        battlePlayers.length > 1 && enemyIndex === 1
          ? BattlerIndex.PLAYER_2
          : BattlerIndex.PLAYER,
      ],
      move: new PokemonMove(MoveId.REVELATION_DANCE),
      useMode: MoveUseMode.IGNORE_PP,
    });
  }
}

function playDancingLessonsAnim(source: Pokemon | undefined, target: Pokemon | undefined): Promise<void> {
  const sourceSprite = source?.getSprite();
  const targetSprite = target?.getSprite();
  if (!source?.isOnField() || !target?.isOnField() || !sourceSprite?.displayHeight || !targetSprite?.displayHeight) {
    return Promise.resolve();
  }

  return new Promise(resolve => {
    new EncounterBattleAnim(EncounterAnim.DANCE, source, target).play(false, resolve);
  });
}

async function resolveDancingLessonsLearnChoice(choice: DancingLessonsChoice): Promise<void> {
  if (!choice.selectedPokemon) {
    return;
  }

  focusDancingLessonsPlayer(choice.playerIndex);
  setDancingLessonsChoiceTokens(choice);

  globalScene.phaseManager.unshiftNew(
    "LearnMovePhase",
    globalScene.getPlayerParty(choice.playerIndex).indexOf(choice.selectedPokemon),
    MoveId.REVELATION_DANCE,
    undefined,
    undefined,
    choice.playerIndex,
  );

  await playDancingLessonsAnim(
    globalScene.getEnemyParty()[choice.playerIndex] ?? globalScene.getEnemyPokemon(false),
    globalScene.getPlayerParty(choice.playerIndex).find(pokemon => pokemon.isOnField()),
  );
}

async function resolveDancingLessonsRecruitChoice(choice: DancingLessonsChoice): Promise<void> {
  if (!choice.selectedMove) {
    return;
  }

  focusDancingLessonsPlayer(choice.playerIndex);
  setDancingLessonsChoiceTokens(choice);

  const data = getDancingLessonsData();
  const oricorio = data.oricorioDataByPlayer[choice.playerIndex].toPokemon() as EnemyPokemon;
  oricorio.passive = true;

  const move = choice.selectedMove.getMove().id;
  if (!oricorio.moveset.some(m => m.getMove().id === move)) {
    if (oricorio.moveset.length < 4) {
      oricorio.moveset.push(new PokemonMove(move));
    } else {
      oricorio.moveset[3] = new PokemonMove(move);
    }
  }

  await hideOricorioPokemon([choice.playerIndex]);
  await catchPokemon(oricorio, null, PokeballType.POKEBALL, false, false, choice.playerIndex);
}

async function runDancingLessonsChoices(): Promise<boolean> {
  const choices = getDancingLessonsData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battleChoices = choices.filter(choice => choice.optionIndex === 1);
  const recruitChoices = choices.filter(choice => choice.optionIndex === 3);
  const battlePlayers = battleChoices.map(choice => choice.playerIndex);

  for (const choice of choices) {
    focusDancingLessonsPlayer(choice.playerIndex);
    setDancingLessonsChoiceTokens(choice);

    if (globalScene.twoPlayerMode) {
      await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
    }

    if (choice.optionIndex === 2) {
      await resolveDancingLessonsLearnChoice(choice);
    } else if (choice.optionIndex === 3) {
      await resolveDancingLessonsRecruitChoice(choice);
    }
  }

  if (battleChoices.length === 0) {
    await hideOricorioPokemon(
      choices.filter(choice => choice.optionIndex !== 3).map(choice => choice.playerIndex),
    );
    focusDancingLessonsPlayer(0);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const recruitedPlayerSet = new Set(recruitChoices.map(choice => choice.playerIndex));
  const enemyOwnerIndexes = ([0, 1] as PlayerIndex[]).filter(playerIndex => !recruitedPlayerSet.has(playerIndex));
  for (const playerIndex of battlePlayers) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.BATON],
        fillRemaining: true,
      },
      undefined,
      undefined,
      playerIndex,
    );
  }

  focusDancingLessonsPlayer(battlePlayers[0]);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  queueDancingLessonsStartOfBattleEffects(battlePlayers, enemyOwnerIndexes);
  await hideOricorioPokemon(enemyOwnerIndexes);
  await initBattleWithEnemyConfig(buildDancingLessonsBattleConfig(enemyOwnerIndexes));
  return true;
}

function buildDancingLessonsBattleOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => {
      setDancingLessonsChoice({ playerIndex, optionIndex: 1 });
      return finishDancingLessonsChoiceCollection(playerIndex, 0);
    })
    .withOptionPhase(runDancingLessonsChoices)
    .build();
}

function buildDancingLessonsLearnOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => {
      focusDancingLessonsPlayer(playerIndex);
      let selectedPokemon: PlayerPokemon | undefined;
      const selected = await selectPokemonForOption(pokemon => {
        selectedPokemon = pokemon;
        setDancingLessonsChoice({ playerIndex, optionIndex: 2, selectedPokemon });
      });

      if (!selected || !selectedPokemon) {
        return false;
      }

      return finishDancingLessonsChoiceCollection(playerIndex, 1);
    })
    .withOptionPhase(runDancingLessonsChoices)
    .build();
}

function buildDancingLessonsRecruitOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
    .withPrimaryPokemonRequirement(new PlayerMoveRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      disabledButtonTooltip: `${namespace}:option.3.disabledTooltip`,
      secondOptionPrompt: `${namespace}:option.3.selectPrompt`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => {
      focusDancingLessonsPlayer(playerIndex);
      const encounter = globalScene.currentBattle.mysteryEncounter!;
      let selectedPokemon: PlayerPokemon | undefined;
      let selectedMove: PokemonMove | undefined;

      const onPokemonSelected = (pokemon: PlayerPokemon) => {
        return pokemon.moveset
          .filter(move => move && DANCING_MOVES.includes(move.getMove().id))
          .map((move: PokemonMove) => {
            const option: OptionSelectItem = {
              label: move.getName(),
              handler: () => {
                selectedPokemon = pokemon;
                selectedMove = move;
                setDancingLessonsChoice({ playerIndex, optionIndex: 3, selectedPokemon, selectedMove });
                return true;
              },
            };
            return option;
          });
      };

      const selectableFilter = (pokemon: Pokemon) => {
        if (!pokemon.isAllowedInBattle()) {
          return (
            i18next.t("partyUiHandler:cantBeUsed", {
              pokemonName: pokemon.getNameToRender(),
            }) ?? null
          );
        }
        const meetsReqs = encounter.options[2].pokemonMeetsPrimaryRequirements(pokemon);
        if (!meetsReqs) {
          return getEncounterText(`${namespace}:invalidSelection`) ?? null;
        }

        return null;
      };

      const selected = await selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
      if (!selected || !selectedPokemon || !selectedMove) {
        return false;
      }

      return finishDancingLessonsChoiceCollection(playerIndex, 2);
    })
    .withOptionPhase(runDancingLessonsChoices)
    .build();
}

function buildDancingLessonsPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildDancingLessonsBattleOption(playerIndex),
    buildDancingLessonsLearnOption(playerIndex),
    buildDancingLessonsRecruitOption(playerIndex),
  ];
}

/**
 * Dancing Lessons encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3823 | GitHub Issue #3823}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const DancingLessonsEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DANCING_LESSONS,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withIntroSpriteConfigs([]) // Uses a real Pokemon sprite instead of ME Intro Visuals
  .withAnimations(EncounterAnim.DANCE)
  .withHideWildIntroMessage(true)
  .withAutoHideIntroVisuals(false)
  .withCatchAllowed(true)
  .withFleeAllowed(false)
  .withOnVisualsStart(() => {
    for (const oricorio of globalScene.getEnemyParty()) {
      const danceAnim = new EncounterBattleAnim(EncounterAnim.DANCE, oricorio, globalScene.getPlayerPokemon()!);
      danceAnim.play(false, () => {
        if (oricorio.shiny) {
          oricorio.sparkle();
        }
      });
    }
    return true;
  })
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
    const species = getPokemonSpecies(SpeciesId.ORICORIO);
    const primaryFormIndex = getBiomeOricorioFormIndex();
    const secondaryFormIndex = getAlternateOricorioFormIndex(primaryFormIndex);
    const oricorioDataByPlayer: Record<PlayerIndex, PokemonData> = {
      0: createOricorioData(primaryFormIndex),
      1: createOricorioData(secondaryFormIndex),
    };
    const visualPlayerIndexes = globalScene.twoPlayerMode ? ([0, 1] as PlayerIndex[]) : ([0] as PlayerIndex[]);

    encounter.dialogue.intro = [
      {
        text: globalScene.twoPlayerMode ? `${namespace}:intro2p` : `${namespace}:intro`,
      },
    ];
    encounter.dialogue.encounterOptionsDialogue!.description = globalScene.twoPlayerMode
      ? `${namespace}:description2p`
      : `${namespace}:description`;

    for (const enemy of globalScene.getEnemyParty()) {
      enemy.leaveField(true, true, true);
    }
    globalScene.currentBattle.double = visualPlayerIndexes.length > 1;
    globalScene.currentBattle.enemyParty = visualPlayerIndexes.map((playerIndex, slotIndex) =>
      addVisualOricorio(oricorioDataByPlayer[playerIndex], slotIndex, visualPlayerIndexes.length),
    );

    encounter.misc = {
      choices: [],
      oricorioData: oricorioDataByPlayer[0],
      oricorioDataByPlayer,
    } satisfies DancingLessonsData & { oricorioData: PokemonData };
    encounter.enemyPartyConfigs = [buildDancingLessonsBattleConfig([0])];

    encounter.setDialogueToken("oricorioName", species.getName());

    if (globalScene.twoPlayerMode) {
      setDancingLessonsPlayerOptionTokens(0);
    }

    return true;
  })
  .withOption(buildDancingLessonsBattleOption(0))
  .withOption(buildDancingLessonsLearnOption(0))
  .withOption(buildDancingLessonsRecruitOption(0))
  .build();

function hideOricorioPokemon(playerIndexes?: PlayerIndex[]) {
  const visualOricorio = (playerIndexes ?? ([0, 1] as PlayerIndex[]))
    .map(playerIndex => globalScene.getEnemyParty()[playerIndex])
    .filter((pokemon): pokemon is EnemyPokemon => !!pokemon);

  return Promise.all(
    visualOricorio.map(
      oricorioSprite =>
        new Promise<void>(resolve => {
          globalScene.tweens.killTweensOf(oricorioSprite);
          if (!oricorioSprite.visible) {
            resolve();
            return;
          }

          globalScene.tweens.add({
            targets: oricorioSprite,
            x: "+=16",
            y: "-=16",
            alpha: 0,
            ease: "Sine.easeInOut",
            duration: 750,
            onComplete: () => {
              globalScene.field.remove(oricorioSprite, true);
              resolve();
            },
          });
        }),
    ),
  ).then(() => undefined);
}
