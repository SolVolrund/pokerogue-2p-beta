import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import { globalScene } from "#app/global-scene";
import { SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { AiType } from "#enums/ai-type";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { BATTLE_STATS } from "#enums/stat";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { FieldBlessing } from "#utils/field-blessings";
import { getFieldBlessingName, setPersistentFieldBlessing } from "#utils/field-blessings";
import { randSeedItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";

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

interface LegendaryConflictData {
  pair: LegendaryConflictPair;
  helpedIndex?: 0 | 1;
  phaseTwoIndex?: 0 | 1;
  phaseTwoUsed?: boolean;
  blessingEligible?: boolean;
  rewardBlessing?: FieldBlessing;
  declined?: boolean;
  legendaryConflictDuelActive?: boolean;
  legendaryConflictPokemonIds?: number[];
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
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    },
    async () => startLegendaryConflictBattle(0),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          text: `${namespace}:option.2.selected`,
        },
      ],
    },
    async () => startLegendaryConflictBattle(1),
  )
  .withSimpleOption(
    {
      buttonLabel: `${namespace}:option.3.label`,
      buttonTooltip: `${namespace}:option.3.tooltip`,
      selected: [
        {
          text: `${namespace}:option.3.selected`,
        },
      ],
    },
    async () => {
      getLegendaryConflictData().declined = true;
      leaveEncounterWithoutBattle(false);
    },
  )
  .build();

function getLegendaryConflictData(): LegendaryConflictData {
  return globalScene.currentBattle.mysteryEncounter!.misc as LegendaryConflictData;
}

async function startLegendaryConflictBattle(helpedIndex: 0 | 1): Promise<void> {
  const data = getLegendaryConflictData();
  const phaseTwoIndex = (helpedIndex === 0 ? 1 : 0) as 0 | 1;
  data.helpedIndex = helpedIndex;
  data.phaseTwoIndex = phaseTwoIndex;
  data.phaseTwoUsed = false;
  data.blessingEligible = true;
  delete data.rewardBlessing;

  await transitionMysteryEncounterIntroVisuals(true, true, 500);
  await initBattleWithEnemyConfig(createLegendaryConflictBattleConfig(data.pair));

  data.legendaryConflictDuelActive = true;
  data.legendaryConflictPokemonIds = globalScene.getEnemyField().map(pokemon => pokemon.id);
}

function createLegendaryConflictBattleConfig(pair: LegendaryConflictPair): EnemyPartyConfig {
  return {
    doubleBattle: true,
    disableSwitch: false,
    pokemonConfigs: pair.members.map(createLegendaryPokemonConfig),
  };
}

function createLegendaryPokemonConfig(member: LegendaryConflictMember): EnemyPokemonConfig {
  return {
    species: getPokemonSpecies(member.speciesId),
    isBoss: false,
    moveSet: member.moves,
    aiType: AiType.SMART,
  };
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
    removeHelpedLegendaryFromBattle(data, pokemon);
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

function removeHelpedLegendaryFromBattle(data: LegendaryConflictData, defeatedPokemon: Pokemon): void {
  const helpedPokemon = getHelpedLegendary(data);
  if (helpedPokemon?.isOnField()) {
    helpedPokemon.leaveField(true, true);
  }
  globalScene.currentBattle.enemyParty = [defeatedPokemon as EnemyPokemon];
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
