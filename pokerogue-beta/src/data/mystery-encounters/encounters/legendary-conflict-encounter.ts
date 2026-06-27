import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { AiType } from "#enums/ai-type";
import { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { updateWindowType } from "#ui/ui-theme";
import type { FieldBlessing } from "#utils/field-blessings";
import { getFieldBlessingName, setPersistentFieldBlessing } from "#utils/field-blessings";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const namespace = "mysteryEncounters/legendaryConflict";

interface LegendaryConflictMember {
  speciesId: SpeciesId;
  blessing: FieldBlessing;
  moves: MoveId[];
  phaseFormKey?: string;
}

interface LegendaryConflictPair {
  members: [LegendaryConflictMember, LegendaryConflictMember];
}

type LegendaryConflictOptionIndex = 1 | 2 | 3;

interface LegendaryConflictChoice {
  playerIndex: PlayerIndex;
  optionIndex: LegendaryConflictOptionIndex;
}

interface LegendaryConflictData {
  pair: LegendaryConflictPair;
  choices?: LegendaryConflictChoice[];
  helpedIndex?: 0 | 1;
  phaseTwoIndex?: 0 | 1;
  phaseTwoUsed?: boolean;
  blessingEligible?: boolean;
  rewardBlessing?: FieldBlessing;
  declined?: boolean;
  legendaryConflictDuelActive?: boolean;
  legendaryConflictPokemonIds?: number[];
  skipSelectedDialogueOnce?: boolean;
}

const LEGENDARY_CONFLICT_PAIRS: LegendaryConflictPair[] = [
  {
    members: [
      {
        speciesId: SpeciesId.GROUDON,
        blessing: "sun",
        moves: [MoveId.PRECIPICE_BLADES, MoveId.LAVA_PLUME, MoveId.HAMMER_ARM, MoveId.EARTH_POWER],
        phaseFormKey: "primal",
      },
      {
        speciesId: SpeciesId.KYOGRE,
        blessing: "rain",
        moves: [MoveId.ORIGIN_PULSE, MoveId.SURF, MoveId.ICE_BEAM, MoveId.THUNDER],
        phaseFormKey: "primal",
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.DIALGA,
        blessing: "trick_room",
        moves: [MoveId.ROAR_OF_TIME, MoveId.FLASH_CANNON, MoveId.AURA_SPHERE, MoveId.EARTH_POWER],
        phaseFormKey: "origin",
      },
      {
        speciesId: SpeciesId.PALKIA,
        blessing: "gravity",
        moves: [MoveId.SPACIAL_REND, MoveId.HYDRO_PUMP, MoveId.AURA_SPHERE, MoveId.POWER_GEM],
        phaseFormKey: "origin",
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.XERNEAS,
        blessing: "misty_terrain",
        moves: [MoveId.MOONBLAST, MoveId.GEOMANCY, MoveId.PSYCHIC, MoveId.MEGAHORN],
      },
      {
        speciesId: SpeciesId.YVELTAL,
        blessing: "shadowy_aura",
        moves: [MoveId.OBLIVION_WING, MoveId.DARK_PULSE, MoveId.AIR_SLASH, MoveId.PSYCHIC],
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.MEW,
        blessing: "light_screen",
        moves: [MoveId.PSYCHIC, MoveId.AURA_SPHERE, MoveId.SHADOW_BALL, MoveId.LIGHT_SCREEN],
      },
      {
        speciesId: SpeciesId.MEWTWO,
        blessing: "reflect",
        moves: [MoveId.PSYSTRIKE, MoveId.AURA_SPHERE, MoveId.SHADOW_BALL, MoveId.REFLECT],
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.RESHIRAM,
        blessing: "sun",
        moves: [MoveId.BLUE_FLARE, MoveId.FUSION_FLARE, MoveId.DRAGON_PULSE, MoveId.EARTH_POWER],
      },
      {
        speciesId: SpeciesId.ZEKROM,
        blessing: "electric_terrain",
        moves: [MoveId.BOLT_STRIKE, MoveId.FUSION_BOLT, MoveId.DRAGON_CLAW, MoveId.CRUNCH],
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.OGERPON,
        blessing: "grassy_terrain",
        moves: [MoveId.IVY_CUDGEL, MoveId.POWER_WHIP, MoveId.KNOCK_OFF, MoveId.GRASSY_TERRAIN],
      },
      {
        speciesId: SpeciesId.PECHARUNT,
        blessing: "fog",
        moves: [MoveId.MALIGNANT_CHAIN, MoveId.SLUDGE_BOMB, MoveId.SHADOW_BALL, MoveId.TOXIC],
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.DEOXYS,
        blessing: "psychic_terrain",
        moves: [MoveId.PSYCHO_BOOST, MoveId.PSYCHIC, MoveId.THUNDERBOLT, MoveId.ICE_BEAM],
      },
      {
        speciesId: SpeciesId.RAYQUAZA,
        blessing: "strong_winds",
        moves: [MoveId.DRAGON_ASCENT, MoveId.DRAGON_CLAW, MoveId.EXTREME_SPEED, MoveId.EARTHQUAKE],
      },
    ],
  },
  {
    members: [
      {
        speciesId: SpeciesId.TING_LU,
        blessing: "sandstorm",
        moves: [MoveId.RUINATION, MoveId.HIGH_HORSEPOWER, MoveId.STOMPING_TANTRUM, MoveId.SANDSTORM],
      },
      {
        speciesId: SpeciesId.GLASTRIER,
        blessing: "snow",
        moves: [MoveId.GLACIAL_LANCE, MoveId.ICICLE_CRASH, MoveId.HIGH_HORSEPOWER, MoveId.SNOWSCAPE],
      },
    ],
  },
];

export const LegendaryConflictEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.LEGENDARY_CONFLICT,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withMaxAllowedEncounters(1)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const pair = randSeedItem(LEGENDARY_CONFLICT_PAIRS);
    encounter.misc = {
      pair,
      choices: [],
      phaseTwoUsed: false,
      blessingEligible: false,
      legendaryConflictDuelActive: false,
    } satisfies LegendaryConflictData;
    encounter.onPokemonFaint = handleLegendaryConflictFaint;
    encounter.onRewards = awardLegendaryConflictBlessing;
    setPairDialogueTokens(pair);
    encounter.spriteConfigs = pair.members.map((member, index) => ({
      spriteKey: "",
      fileRoot: "pokemon",
      species: member.speciesId,
      hasShadow: true,
      x: index === 0 ? -28 : 28,
      y: 4,
      yShadow: 4,
      isPokemon: true,
    }));
    return true;
  })
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildLegendaryConflictOption(1))
  .withOption(buildLegendaryConflictOption(2))
  .withOption(buildLegendaryConflictOption(3))
  .build();

function getLegendaryConflictData(): LegendaryConflictData {
  return globalScene.currentBattle.mysteryEncounter!.misc as LegendaryConflictData;
}

function getLegendaryConflictVotingPlayerIndexes(): PlayerIndex[] {
  const playerIndexes = getMysteryEncounterPlayerIndexes();
  const humanPlayerIndexes = playerIndexes.filter(playerIndex => !globalScene.isComputerPartnerPlayer(playerIndex));
  return humanPlayerIndexes.length > 0 ? humanPlayerIndexes : playerIndexes;
}

function buildLegendaryConflictOption(optionIndex: LegendaryConflictOptionIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
      selected: [
        {
          text: `${namespace}:option.${optionIndex}.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeLegendaryConflictChoice(optionIndex, 0))
    .withOptionPhase(runLegendaryConflictChoices)
    .build();
}

function buildLegendaryConflictPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [
    buildLegendaryConflictOptionForPlayer(1, playerIndex),
    buildLegendaryConflictOptionForPlayer(2, playerIndex),
    buildLegendaryConflictOptionForPlayer(3, playerIndex),
  ];
}

function buildLegendaryConflictOptionForPlayer(
  optionIndex: LegendaryConflictOptionIndex,
  playerIndex: PlayerIndex,
): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${optionIndex}.label`,
      buttonTooltip: `${namespace}:option.${optionIndex}.tooltip`,
      selected: [
        {
          text: `${namespace}:option.${optionIndex}.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeLegendaryConflictChoice(optionIndex, playerIndex))
    .withOptionPhase(runLegendaryConflictChoices)
    .build();
}

async function storeLegendaryConflictChoice(
  optionIndex: LegendaryConflictOptionIndex,
  playerIndex: PlayerIndex,
): Promise<boolean> {
  const data = getLegendaryConflictData();
  data.choices = (data.choices ?? []).filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex, getLegendaryConflictVotingPlayerIndexes());
  if (nextPlayerIndex != null) {
    const result = await showMysteryEncounterPlayerMenu({
      playerIndex: nextPlayerIndex,
      slideInDescription: false,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildLegendaryConflictPlayerOptions(nextPlayerIndex),
      startingCursorIndex: optionIndex - 1,
    });
    return result ?? false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function runLegendaryConflictChoices(): Promise<boolean> {
  const data = getLegendaryConflictData();
  const votingPlayerIndexes = getLegendaryConflictVotingPlayerIndexes();
  const choices = (data.choices ?? [])
    .filter(choice => votingPlayerIndexes.includes(choice.playerIndex))
    .toSorted((a, b) => a.playerIndex - b.playerIndex);

  if (globalScene.twoPlayerMode) {
    for (const choice of choices) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
    }
  }

  const winningOption = await getWinningLegendaryConflictOption(choices);
  if (winningOption === 3) {
    data.declined = true;
    leaveEncounterWithoutBattle(false);
    return true;
  }

  await startLegendaryConflictBattle((winningOption - 1) as 0 | 1, getMysteryEncounterPlayerIndexes());
  return true;
}

async function getWinningLegendaryConflictOption(
  choices: LegendaryConflictChoice[],
): Promise<LegendaryConflictOptionIndex> {
  if (choices.length <= 1) {
    return choices[0]?.optionIndex ?? 3;
  }

  const optionCounts = new Map<LegendaryConflictOptionIndex, number>();
  for (const choice of choices) {
    optionCounts.set(choice.optionIndex, (optionCounts.get(choice.optionIndex) ?? 0) + 1);
  }

  const highestCount = Math.max(...optionCounts.values());
  const tiedOptions = [...optionCounts.entries()]
    .filter(([, count]) => count === highestCount)
    .map(([optionIndex]) => optionIndex);
  if (tiedOptions.length === 1) {
    return tiedOptions[0];
  }

  const tiedChoices = choices.filter(choice => tiedOptions.includes(choice.optionIndex));
  const winningPlayerIndex = globalScene.resolvePlayerTieBreak(tiedChoices.map(choice => choice.playerIndex));
  await showEncounterText(`Player ${winningPlayerIndex + 1}'s choice wins this time.`);
  return tiedChoices.find(choice => choice.playerIndex === winningPlayerIndex)?.optionIndex ?? tiedChoices[0].optionIndex;
}

async function startLegendaryConflictBattle(
  helpedIndex: 0 | 1,
  playerIndexes: PlayerIndex[] = getMysteryEncounterPlayerIndexes(),
): Promise<void> {
  const data = getLegendaryConflictData();
  const phaseTwoIndex = (helpedIndex === 0 ? 1 : 0) as 0 | 1;
  data.helpedIndex = helpedIndex;
  data.phaseTwoIndex = phaseTwoIndex;
  data.phaseTwoUsed = false;
  data.blessingEligible = true;
  delete data.rewardBlessing;

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(playerIndexes);
  alignLegendaryConflictPlayerField(playerIndexes);
  globalScene.setActivePlayerIndex(playerIndexes[0]);
  updateWindowType(playerIndexes[0] + 1);
  await initBattleWithEnemyConfig(createLegendaryConflictBattleConfig(data.pair, phaseTwoIndex, playerIndexes.length));

  data.legendaryConflictDuelActive = true;
  data.legendaryConflictPokemonIds = globalScene.getEnemyField().map(pokemon => pokemon.id);
}

function createLegendaryConflictBattleConfig(
  pair: LegendaryConflictPair,
  hostileIndex: 0 | 1,
  playerCount: number,
): EnemyPartyConfig {
  return {
    doubleBattle: true,
    disableSwitch: false,
    pokemonConfigs: pair.members.map((member, index) =>
      createLegendaryPokemonConfig(member, index as 0 | 1, hostileIndex, playerCount),
    ),
  };
}

function createLegendaryPokemonConfig(
  member: LegendaryConflictMember,
  index: 0 | 1,
  hostileIndex: 0 | 1,
  playerCount: number,
): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(member.speciesId),
    isBoss: false,
    moveSet: member.moves,
    aiType: AiType.SMART,
    fieldPosition: playerCount > 2 && index === hostileIndex ? FieldPosition.CENTER : undefined,
  };
}

function alignLegendaryConflictPlayerField(playerIndexes: PlayerIndex[]): void {
  const fieldPositions = getLegendaryConflictPlayerFieldPositions(playerIndexes.length);
  playerIndexes.forEach((playerIndex, fieldIndex) => {
    const pokemon = globalScene.getPlayerParty(playerIndex)[0];
    if (!pokemon?.isOnField()) {
      return;
    }

    const fieldPosition = fieldPositions[fieldIndex] ?? FieldPosition.CENTER;
    pokemon.setFieldPosition(fieldPosition, 0);
    const [offsetX, offsetY] = pokemon.getFieldPositionOffset();
    pokemon.setPosition(106 + offsetX, 148 + offsetY);
  });
}

function getLegendaryConflictPlayerFieldPositions(playerCount: number): FieldPosition[] {
  return playerCount > 2
    ? [FieldPosition.LEFT, FieldPosition.RIGHT, FieldPosition.CENTER]
    : playerCount > 1
      ? [FieldPosition.LEFT, FieldPosition.RIGHT]
      : [FieldPosition.CENTER];
}

function handleLegendaryConflictFaint(pokemon: Pokemon): boolean {
  if (!pokemon.isEnemy()) {
    return false;
  }

  const data = getLegendaryConflictData();
  const enemyIndex = (pokemon.getBattlerIndex() - BattlerIndex.ENEMY) as 0 | 1;
  if (enemyIndex === data.helpedIndex) {
    data.blessingEligible = false;
    data.legendaryConflictDuelActive = false;
    return false;
  }

  if (enemyIndex !== data.phaseTwoIndex) {
    return false;
  }

  if (!data.phaseTwoUsed) {
    startPhaseTwo(pokemon, data.pair.members[enemyIndex]);
    data.phaseTwoUsed = true;
    return true;
  }

  data.legendaryConflictDuelActive = false;
  if (data.blessingEligible && helpedLegendarySurvived(data)) {
    data.rewardBlessing = data.pair.members[data.helpedIndex!].blessing;
    markLegendaryConflictBattleWon(data);
  }

  return false;
}

function startPhaseTwo(pokemon: Pokemon, member: LegendaryConflictMember): void {
  const formChange = member.phaseFormKey ? getFormChange(pokemon, member.phaseFormKey) : undefined;

  pokemon.hp = Math.max(pokemon.hp, 1);
  pokemon.status = null;
  pokemon.updateInfo();
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s power surged!`);

  if (!formChange) {
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", {
      battlerIndex: pokemon.getBattlerIndex(),
      changes: BATTLE_STATS.map(stat => ({ stat, stages: 1 })),
      sourcePokemon: pokemon,
      ignoreAbilities: true,
    });
  }

  globalScene.phaseManager.unshiftNew(
    "PokemonHealPhase",
    pokemon.getBattlerIndex(),
    pokemon.getMaxHp(),
    null,
    false,
    false,
    true,
    true,
  );

  if (formChange) {
    globalScene.phaseManager.unshiftNew("QuietFormChangePhase", pokemon, formChange);
  }
}

function getFormChange(pokemon: Pokemon, formKey: string): SpeciesFormChange | undefined {
  if (!pokemon.species.forms.some(form => form.formKey === formKey)) {
    return undefined;
  }

  return new SpeciesFormChange({
    speciesId: pokemon.species.speciesId,
    preFormKey: pokemon.getFormKey(),
    evoFormKey: formKey,
    trigger: new SpeciesFormChangeManualTrigger(),
    conditions: [],
  });
}

function helpedLegendarySurvived(data: LegendaryConflictData): boolean {
  const helpedPokemon = getHelpedLegendary(data);
  return !!helpedPokemon?.isOnField() && !helpedPokemon.isFainted(true);
}

function getHelpedLegendary(data: LegendaryConflictData): Pokemon | undefined {
  if (data.helpedIndex == null) {
    return undefined;
  }

  return globalScene.getEnemyParty()[data.helpedIndex];
}

function markLegendaryConflictBattleWon(data: LegendaryConflictData): void {
  data.legendaryConflictDuelActive = false;
}

async function awardLegendaryConflictBlessing(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getLegendaryConflictData();
  data.legendaryConflictDuelActive = false;
  delete data.legendaryConflictPokemonIds;

  if (data.declined) {
    encounter.dialogue.outro = [];
    return;
  }

  if (!data.rewardBlessing) {
    encounter.dialogue.outro = [
      {
        text: `${namespace}:outro.failed`,
      },
    ];
    return;
  }

  setPersistentFieldBlessing(data.rewardBlessing);
  encounter.setDialogueToken("blessing", getFieldBlessingName(data.rewardBlessing));
  encounter.dialogue.outro = [
    {
      text: `${namespace}:outro.success`,
    },
  ];
}

function setPairDialogueTokens(pair: LegendaryConflictPair): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  pair.members.forEach((member, index) => {
    const pokemonName = getPokemonSpecies(member.speciesId).getName();
    encounter.setDialogueToken(`pokemon${index + 1}`, pokemonName);
    encounter.setDialogueToken(`blessing${index + 1}`, getFieldBlessingName(member.blessing));
  });
}
