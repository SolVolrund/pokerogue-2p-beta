import { audioManager } from "#app/global-audio-manager";
import type { PlayerIndex, TwoPlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { speciesDataRegistry } from "#app/global-species-data-registry";
import { modifierTypes } from "#data/data-lists";
import type { IEggOptions } from "#data/egg";
import { getPokeballTintColor } from "#data/pokeball";
import { BiomeId } from "#enums/biome-id";
import { Challenges } from "#enums/challenges";
import { EggSourceType } from "#enums/egg-source-types";
import { EggTier } from "#enums/egg-type";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import type { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { getEncounterText, showEncounterDialogue } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  handleMysteryEncounterBattleFailed,
  initBattleWithEnemyConfig,
  setEncounterRewards,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { updateWindowType } from "#ui/ui-theme";
import { randSeedShuffle } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/theExpertPokemonBreeder";

const trainerNameKey = "trainerNames:expertPokemonBreeder";

const FIRST_STAGE_EVOLUTION_WAVE = 45;
const SECOND_STAGE_EVOLUTION_WAVE = 60;
const FINAL_STAGE_EVOLUTION_WAVE = 75;

const FRIENDSHIP_ADDED = 20;
const MIN_LEGAL_POKEMON_FOR_BREEDER = 4;

interface ExpertBreederCandidate {
  pokemon: PlayerPokemon;
  commonEggs: number;
  rareEggs: number;
  tooltip: string;
}

interface ExpertBreederChoice extends ExpertBreederCandidate {
  playerIndex: PlayerIndex;
  candidateIndex: number;
}

interface ExpertBreederPartyBackup {
  originalParty: PlayerPokemon[];
  originalPartyHeldItems: PokemonHeldItemModifier[][];
}

interface ExpertBreederData {
  candidatesByPlayer: Record<TwoPlayerIndex, ExpertBreederCandidate[]>;
  choices: ExpertBreederChoice[];
  partyBackupsByPlayer?: Partial<Record<PlayerIndex, ExpertBreederPartyBackup>>;
  chosenPokemon?: PlayerPokemon;
  encounterFailed?: boolean;
  skipSelectedDialogueOnce?: boolean;
}

class ExpertBreederSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return globalScene.getPokemonAllowedInBattle().length >= MIN_LEGAL_POKEMON_FOR_BREEDER;
    }

    return ([0, 1] as PlayerIndex[]).every(
      playerIndex => globalScene.getPokemonAllowedInBattle(playerIndex).length >= MIN_LEGAL_POKEMON_FOR_BREEDER,
    );
  }

  override getDialogueToken(): [string, string] {
    return ["partySize", MIN_LEGAL_POKEMON_FOR_BREEDER.toString()];
  }
}

class BreederSpeciesEvolution {
  species: SpeciesId;
  evolution: number;

  constructor(species: SpeciesId, evolution: number) {
    this.species = species;
    this.evolution = evolution;
  }
}

const POOL_1_POKEMON: (SpeciesId | BreederSpeciesEvolution)[][] = [
  [
    SpeciesId.PICHU,
    new BreederSpeciesEvolution(SpeciesId.PIKACHU, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.RAICHU, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [
    SpeciesId.PICHU,
    new BreederSpeciesEvolution(SpeciesId.PIKACHU, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.ALOLA_RAICHU, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [
    SpeciesId.IGGLYBUFF,
    new BreederSpeciesEvolution(SpeciesId.JIGGLYPUFF, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.WIGGLYTUFF, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [
    SpeciesId.TOGEPI,
    new BreederSpeciesEvolution(SpeciesId.TOGETIC, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.TOGEKISS, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [SpeciesId.TYROGUE, new BreederSpeciesEvolution(SpeciesId.HITMONLEE, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.TYROGUE, new BreederSpeciesEvolution(SpeciesId.HITMONCHAN, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.TYROGUE, new BreederSpeciesEvolution(SpeciesId.HITMONTOP, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.SMOOCHUM, new BreederSpeciesEvolution(SpeciesId.JYNX, FIRST_STAGE_EVOLUTION_WAVE)],
  [
    SpeciesId.AZURILL,
    new BreederSpeciesEvolution(SpeciesId.MARILL, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.AZUMARILL, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [
    SpeciesId.BUDEW,
    new BreederSpeciesEvolution(SpeciesId.ROSELIA, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.ROSERADE, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [SpeciesId.CHINGLING, new BreederSpeciesEvolution(SpeciesId.CHIMECHO, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.BONSLY, new BreederSpeciesEvolution(SpeciesId.SUDOWOODO, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.MIME_JR, new BreederSpeciesEvolution(SpeciesId.MR_MIME, SECOND_STAGE_EVOLUTION_WAVE)],
  [
    SpeciesId.MIME_JR,
    new BreederSpeciesEvolution(SpeciesId.GALAR_MR_MIME, SECOND_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.MR_RIME, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [
    SpeciesId.HAPPINY,
    new BreederSpeciesEvolution(SpeciesId.CHANSEY, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.BLISSEY, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [SpeciesId.MANTYKE, new BreederSpeciesEvolution(SpeciesId.MANTINE, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.TOXEL, new BreederSpeciesEvolution(SpeciesId.TOXTRICITY, SECOND_STAGE_EVOLUTION_WAVE)],
];

const POOL_2_POKEMON: (SpeciesId | BreederSpeciesEvolution)[][] = [
  [SpeciesId.DITTO],
  [
    SpeciesId.ELEKID,
    new BreederSpeciesEvolution(SpeciesId.ELECTABUZZ, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.ELECTIVIRE, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [
    SpeciesId.MAGBY,
    new BreederSpeciesEvolution(SpeciesId.MAGMAR, FIRST_STAGE_EVOLUTION_WAVE),
    new BreederSpeciesEvolution(SpeciesId.MAGMORTAR, FINAL_STAGE_EVOLUTION_WAVE),
  ],
  [SpeciesId.WYNAUT, new BreederSpeciesEvolution(SpeciesId.WOBBUFFET, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.MUNCHLAX, new BreederSpeciesEvolution(SpeciesId.SNORLAX, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.RIOLU, new BreederSpeciesEvolution(SpeciesId.LUCARIO, SECOND_STAGE_EVOLUTION_WAVE)],
  [SpeciesId.AUDINO],
];

function getExpertBreederData(): ExpertBreederData {
  return globalScene.currentBattle.mysteryEncounter!.misc as ExpertBreederData;
}

function getBreederCandidates(playerIndex: PlayerIndex): ExpertBreederCandidate[] {
  return globalScene
    .getPlayerParty(playerIndex)
    .slice(0)
    .filter(p => p.isAllowedInBattle())
    .sort((a, b) => a.friendship - b.friendship)
    .slice(0, 3)
    .map((pokemon, index) => {
      const [commonEggs, rareEggs] = calculateEggRewardsForPokemon(pokemon);
      return {
        pokemon,
        commonEggs,
        rareEggs,
        tooltip: getBreederCandidateTooltipText(pokemon, commonEggs, rareEggs, index),
      };
    });
}

function getBreederCandidateTooltipText(
  pokemon: PlayerPokemon,
  commonEggs: number,
  rareEggs: number,
  candidateIndex: number,
): string {
  let tooltip = getEncounterText(`${namespace}:option.${candidateIndex + 1}.tooltipBase`) ?? "";
  if (rareEggs > 0) {
    tooltip += i18next.t(`${namespace}:eggsTooltip`, {
      eggs: i18next.t(`${namespace}:numEggs`, {
        count: rareEggs,
        rarity: i18next.t("egg:greatTier"),
      }),
    });
  }
  if (commonEggs > 0) {
    tooltip += i18next.t(`${namespace}:eggsTooltip`, {
      eggs: i18next.t(`${namespace}:numEggs`, {
        count: commonEggs,
        rarity: i18next.t("egg:defaultTier"),
      }),
    });
  }

  return tooltip
    .replaceAll(`{{pokemon${candidateIndex + 1}Name}}`, pokemon.getNameToRender())
    .replaceAll("{{chosenPokemon}}", pokemon.getNameToRender());
}

function setBreederCandidateTokens(playerIndex: PlayerIndex): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const candidates = getExpertBreederData().candidatesByPlayer[playerIndex];
  candidates.forEach((candidate, index) => {
    encounter.setDialogueToken(`pokemon${index + 1}Name`, candidate.pokemon.getNameToRender());
  });
}

function getBreederCandidate(playerIndex: PlayerIndex, candidateIndex: number): ExpertBreederCandidate {
  return getExpertBreederData().candidatesByPlayer[playerIndex][candidateIndex];
}

function showBreederPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);
  setBreederCandidateTokens(playerIndex);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildBreederOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function storeBreederChoice(playerIndex: PlayerIndex, candidateIndex: number): boolean {
  const data = getExpertBreederData();
  const candidate = getBreederCandidate(playerIndex, candidateIndex);
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, candidateIndex, ...candidate });

  if (!globalScene.twoPlayerMode) {
    return true;
  }

  if (playerIndex === 0) {
    showBreederPlayerMenu(1, candidateIndex);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function buildBreederOption(playerIndex: PlayerIndex, candidateIndex: number): MysteryEncounterOption {
  let tooltip = `${namespace}:option.${candidateIndex + 1}.tooltipBase`;
  try {
    tooltip = getBreederCandidate(playerIndex, candidateIndex).tooltip;
  } catch (_err) {
    // The initial options are built before onInit has generated candidates.
  }

  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.${candidateIndex + 1}.label`,
      buttonTooltip: tooltip,
      selected: [
        {
          speaker: trainerNameKey,
          text: `${namespace}:option.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeBreederChoice(playerIndex, candidateIndex))
    .withOptionPhase(async () => {
      if (globalScene.twoPlayerMode) {
        return runTwoPlayerBreederBattle();
      }

      await runSinglePlayerBreederBattle(candidateIndex);
      return true;
    })
    .build();
}

function buildBreederOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [0, 1, 2].map(candidateIndex => buildBreederOption(playerIndex, candidateIndex));
}

function getEggRewardLines(playerLabel: string, commonEggs: number, rareEggs: number): string[] {
  const lines: string[] = [];
  if (commonEggs > 0) {
    lines.push(
      `@s{item_fanfare}${playerLabel} received ${i18next.t(`${namespace}:numEggs`, {
        count: commonEggs,
        rarity: i18next.t("egg:defaultTier"),
      })}!`,
    );
  }
  if (rareEggs > 0) {
    lines.push(
      `@s{item_fanfare}${playerLabel} received ${i18next.t(`${namespace}:numEggs`, {
        count: rareEggs,
        rarity: i18next.t("egg:greatTier"),
      })}!`,
    );
  }
  return lines;
}

function configureBreederOutro(choices: ExpertBreederChoice[]): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (globalScene.twoPlayerMode) {
    encounter.dialogue.outro = [
      {
        speaker: trainerNameKey,
        text: "Look how happy your Pokemon are now!$Here, you can have these as well.",
      },
    ];

    for (const choice of choices) {
      for (const text of getEggRewardLines(
        `Player ${choice.playerIndex + 1}`,
        choice.commonEggs,
        choice.rareEggs,
      )) {
        encounter.dialogue.outro.push({ text });
      }
    }
    return;
  }

  const choice = choices[0];
  encounter.dialogue.outro = [
    {
      speaker: trainerNameKey,
      text: `${namespace}:outro`,
    },
  ];
  for (const text of getEggRewardLines("", choice.commonEggs, choice.rareEggs)) {
    encounter.dialogue.outro.push({ text: text.replace("@s{item_fanfare} received", "@s{item_fanfare}You received") });
  }
}

async function runSinglePlayerBreederBattle(candidateIndex: number): Promise<void> {
  const choice = getExpertBreederData().choices[0] ?? {
    playerIndex: 0 as PlayerIndex,
    candidateIndex,
    ...getBreederCandidate(0, candidateIndex),
  };
  await startBreederBattle([choice], globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs[0]);
}

async function runTwoPlayerBreederBattle(): Promise<boolean> {
  const choices = getExpertBreederData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  await showEncounterDialogue(`${namespace}:option.selected`, trainerNameKey);
  await startBreederBattle(choices, createTwoPlayerBreederPartyConfig());
  return true;
}

async function startBreederBattle(choices: ExpertBreederChoice[], config: EnemyPartyConfig): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc.chosenPokemon = choices[0].pokemon;

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    setBreederCandidateTokens(choice.playerIndex);
    encounter.setDialogueToken("chosenPokemon", choice.pokemon.getNameToRender());
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.SOOTHE_BELL],
        fillRemaining: true,
      },
      getEggOptions(choice.commonEggs, choice.rareEggs),
      choice.playerIndex === choices[0].playerIndex ? () => doPostEncounterCleanup() : undefined,
      choice.playerIndex,
    );
    isolateBreederParty(choice.playerIndex, choice.pokemon);
  }

  configureBreederOutro(choices);
  encounter.onGameOver = onGameOver;

  if (globalScene.twoPlayerMode) {
    globalScene.setMysteryEncounterBattlePlayerFieldOwners(choices.map(choice => choice.playerIndex));
  }
  globalScene.setActivePlayerIndex(choices[0].playerIndex);
  updateWindowType(choices[0].playerIndex + 1);
  await initBattleWithEnemyConfig(config);
}

/**
 * The Expert Pokémon Breeder encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3818 | GitHub Issue #3818}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TheExpertPokemonBreederEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.THE_EXPERT_POKEMON_BREEDER,
)
  .withEncounterTier(MysteryEncounterTier.ULTRA)
  .withDisallowedChallenges(Challenges.HARDCORE)
  .withSceneWaveRangeRequirement(25, 180)
  .withSceneRequirement(new ExpertBreederSpawnRequirement()) // Both 2P players must have at least 4 legal Pokemon
  .withIntroSpriteConfigs([]) // These are set in onInit()
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: trainerNameKey,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const waveIndex = globalScene.currentBattle.waveIndex;
    // Calculates what trainers are available for battle in the encounter

    // If player is in space biome, uses special "Space" version of the trainer
    encounter.enemyPartyConfigs = [getPartyConfig()];

    const cleffaSpecies =
      waveIndex < FIRST_STAGE_EVOLUTION_WAVE
        ? SpeciesId.CLEFFA
        : waveIndex < FINAL_STAGE_EVOLUTION_WAVE
          ? SpeciesId.CLEFAIRY
          : SpeciesId.CLEFABLE;
    encounter.spriteConfigs = [
      {
        species: cleffaSpecies,
        spriteKey: "",
        fileRoot: "",
        hasShadow: true,
        repeat: true,
        x: 14,
        y: -2,
        yShadow: -2,
      },
      {
        spriteKey: "expert_pokemon_breeder",
        fileRoot: "trainer",
        hasShadow: true,
        x: -14,
        y: 4,
        yShadow: 2,
      },
    ];

    encounter.misc = {
      candidatesByPlayer: {
        0: getBreederCandidates(0),
        1: globalScene.twoPlayerMode ? getBreederCandidates(1) : getBreederCandidates(0),
      },
      choices: [],
    } satisfies ExpertBreederData;

    setBreederCandidateTokens(0);
    getExpertBreederData().candidatesByPlayer[0].forEach((candidate, index) => {
      encounter.options[index].dialogue!.buttonTooltip = candidate.tooltip;
    });

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildBreederOption(0, 0))
  .withOption(buildBreederOption(0, 1))
  .withOption(buildBreederOption(0, 2))
  .withOutroDialogue([
    {
      speaker: trainerNameKey,
      text: `${namespace}:outro`,
    },
  ])
  .build();

function getPartyConfig(): EnemyPartyConfig {
  // Bug type superfan trainer config
  const waveIndex = globalScene.currentBattle.waveIndex;
  const breederConfig = trainerConfigs[TrainerType.EXPERT_POKEMON_BREEDER].clone();
  breederConfig.name = i18next.t(trainerNameKey);

  // First mon is *always* this special cleffa
  const cleffaSpecies =
    waveIndex < FIRST_STAGE_EVOLUTION_WAVE
      ? SpeciesId.CLEFFA
      : waveIndex < FINAL_STAGE_EVOLUTION_WAVE
        ? SpeciesId.CLEFAIRY
        : SpeciesId.CLEFABLE;
  const baseConfig: EnemyPartyConfig = {
    trainerConfig: breederConfig,
    pokemonConfigs: [
      {
        nickname: i18next.t(`${namespace}:cleffa1Nickname`, {
          speciesName: getPokemonSpecies(cleffaSpecies).getName(),
        }),
        species: getPokemonSpecies(cleffaSpecies),
        isBoss: false,
        abilityIndex: 1, // Magic Guard
        shiny: false,
        nature: Nature.ADAMANT,
        moveSet: [MoveId.FIRE_PUNCH, MoveId.ICE_PUNCH, MoveId.THUNDER_PUNCH, MoveId.METEOR_MASH],
        ivs: [31, 31, 31, 31, 31, 31],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
            stackCount: 3,
          },
        ],
        tera: PokemonType.FAIRY,
        friendship: 255,
      },
    ],
  };

  if (globalScene.arena.biomeId === BiomeId.SPACE) {
    // All 3 members always Cleffa line, but different configs
    baseConfig.pokemonConfigs!.push(
      {
        nickname: i18next.t(`${namespace}:cleffa2Nickname`, {
          speciesName: getPokemonSpecies(cleffaSpecies).getName(),
        }),
        species: getPokemonSpecies(cleffaSpecies),
        isBoss: false,
        abilityIndex: 1, // Magic Guard
        shiny: true,
        variant: 1,
        nature: Nature.MODEST,
        moveSet: [MoveId.DAZZLING_GLEAM, MoveId.MYSTICAL_FIRE, MoveId.ICE_BEAM, MoveId.THUNDERBOLT], // Make this one have an item gimmick when we have more items/finish implementations
        ivs: [31, 31, 31, 31, 31, 31],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
            stackCount: 3,
          },
        ],
        friendship: 255,
      },
      {
        nickname: i18next.t(`${namespace}:cleffa3Nickname`, {
          speciesName: getPokemonSpecies(cleffaSpecies).getName(),
        }),
        species: getPokemonSpecies(cleffaSpecies),
        isBoss: false,
        abilityIndex: 2, // Friend Guard / Unaware
        shiny: true,
        variant: 2,
        nature: Nature.BOLD,
        moveSet: [MoveId.TRI_ATTACK, MoveId.STORED_POWER, MoveId.CALM_MIND, MoveId.MOONLIGHT],
        ivs: [31, 31, 31, 31, 31, 31],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
            stackCount: 3,
          },
        ],
        friendship: 255,
      },
    );
  } else {
    // Second member from pool 1
    const pool1Species = getSpeciesFromPool(POOL_1_POKEMON, waveIndex);
    // Third member from pool 2
    const pool2Species = getSpeciesFromPool(POOL_2_POKEMON, waveIndex);

    baseConfig.pokemonConfigs!.push(
      {
        species: getPokemonSpecies(pool1Species),
        isBoss: false,
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
            stackCount: 3,
          },
        ],
      },
      {
        species: getPokemonSpecies(pool2Species),
        isBoss: false,
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
            stackCount: 3,
          },
        ],
      },
    );
  }

  return baseConfig;
}

function createTwoPlayerBreederPartyConfig(): EnemyPartyConfig {
  const config = getPartyConfig();
  config.doubleBattle = true;
  config.forceDoubleBattle = true;
  config.trainerConfig?.setPartyTemplates(new TrainerPartyTemplate(4, PartyMemberStrength.WEAK));

  if ((config.pokemonConfigs?.length ?? 0) < 4) {
    const waveIndex = globalScene.currentBattle.waveIndex;
    const speciesPool = randSeedShuffle([POOL_1_POKEMON, POOL_2_POKEMON])[0];
    const extraSpecies = getSpeciesFromPool(speciesPool, waveIndex);
    config.pokemonConfigs!.push({
      species: getPokemonSpecies(extraSpecies),
      isBoss: false,
      modifierConfigs: [
        {
          modifier: generateModifierType(modifierTypes.SOOTHE_BELL) as PokemonHeldItemModifierType,
          stackCount: 3,
        },
      ],
    });
  }

  return config;
}

function getSpeciesFromPool(speciesPool: (SpeciesId | BreederSpeciesEvolution)[][], waveIndex: number): SpeciesId {
  const poolCopy = randSeedShuffle(speciesPool.slice(0));
  const speciesEvolutions = poolCopy.pop()!.slice(0);
  let speciesObject = speciesEvolutions.pop()!;
  while (speciesObject instanceof BreederSpeciesEvolution && speciesObject.evolution > waveIndex) {
    speciesObject = speciesEvolutions.pop()!;
  }
  return speciesObject instanceof BreederSpeciesEvolution ? speciesObject.species : speciesObject;
}

function calculateEggRewardsForPokemon(pokemon: PlayerPokemon): [number, number] {
  const bst = pokemon.getSpeciesForm().getBaseStatTotal();
  // 1 point for every 20 points below 680 BST the pokemon is, (max 18, min 1)
  const pointsFromBst = Math.min(Math.max(Math.floor((680 - bst) / 20), 1), 18);

  const rootSpecies = pokemon.species.getRootSpeciesId();
  let pointsFromStarterTier = 0;
  // 2 points for every 1 below 7 that the pokemon's starter tier is (max 12, min 0)
  const starterCost = speciesDataRegistry.getStarterCost(rootSpecies);
  if (starterCost !== undefined) {
    pointsFromStarterTier = Math.min(Math.max(Math.floor(7 - starterCost) * 2, 0), 12);
  }

  // Maximum of 30 points
  let totalPoints = Math.min(pointsFromStarterTier + pointsFromBst, 30);

  // First 5 points go to Common eggs
  let numCommons = Math.min(totalPoints, 5);
  totalPoints -= numCommons;

  // Then, 1 Rare egg for every 4 points
  const numRares = Math.floor(totalPoints / 4);
  // 1 Common egg for every point leftover
  numCommons += totalPoints % 4;

  return [numCommons, numRares];
}

function getEggOptions(commonEggs: number, rareEggs: number) {
  const eggDescription = i18next.t(`${namespace}:title`);
  const eggOptions: IEggOptions[] = [];

  if (commonEggs > 0) {
    for (let i = 0; i < commonEggs; i++) {
      eggOptions.push({
        pulled: false,
        sourceType: EggSourceType.EVENT,
        eggDescriptor: eggDescription,
        tier: EggTier.COMMON,
      });
    }
  }
  if (rareEggs > 0) {
    for (let i = 0; i < rareEggs; i++) {
      eggOptions.push({
        pulled: false,
        sourceType: EggSourceType.EVENT,
        eggDescriptor: eggDescription,
        tier: EggTier.RARE,
      });
    }
  }

  return eggOptions;
}

function isolateBreederParty(playerIndex: PlayerIndex, chosenPokemon: PlayerPokemon) {
  const data = getExpertBreederData();
  data.partyBackupsByPlayer ??= {};

  const party = globalScene.getPlayerParty(playerIndex);
  const chosenIndex = party.indexOf(chosenPokemon);
  if (chosenIndex === -1) {
    return;
  }

  const originalParty = party.slice();
  data.partyBackupsByPlayer[playerIndex] = {
    originalParty,
    originalPartyHeldItems: originalParty.filter(p => p !== chosenPokemon).map(p => p.getHeldItems()),
  };

  party.length = 0;
  party.push(chosenPokemon);
  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene["party"] = party;
  }
}

function restoreBreederParty(playerIndex: PlayerIndex) {
  const backup = getExpertBreederData().partyBackupsByPlayer?.[playerIndex];
  if (!backup) {
    return;
  }

  const party = globalScene.getPlayerParty(playerIndex);
  party.length = 0;
  party.push(...backup.originalParty);
  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene["party"] = party;
  }

  const originalHeldItems = backup.originalPartyHeldItems;
  for (const pokemonHeldItemsList of originalHeldItems) {
    for (const heldItem of pokemonHeldItemsList) {
      globalScene.addModifier(heldItem, true, false, false, true, undefined, playerIndex);
    }
  }
  globalScene.updateModifiers(true, undefined, playerIndex);
}

function restoreBreederParties() {
  const playerIndexes = Object.keys(getExpertBreederData().partyBackupsByPlayer ?? {}).map(Number) as PlayerIndex[];
  for (const playerIndex of playerIndexes) {
    restoreBreederParty(playerIndex);
  }
}

function onGameOver() {
  const encounter = globalScene.currentBattle.mysteryEncounter!;

  encounter.dialogue.outro = [
    {
      speaker: trainerNameKey,
      text: `${namespace}:outroFailed`,
    },
  ];

  // Restore original party, player loses all friendship with chosen mon (it remains fainted)
  restoreBreederParties();
  for (const choice of (encounter.misc as ExpertBreederData).choices ?? []) {
    choice.pokemon.friendship = 0;
  }

  // Clear all rewards that would have been earned
  encounter.doEncounterRewards = undefined;

  // Set flag that encounter was failed
  encounter.misc.encounterFailed = true;

  // Revert BGM
  audioManager.playBgm(globalScene.arena.bgm);

  // Clear any leftover battle phases
  globalScene.phaseManager.clearPhaseQueue();

  // Return enemy Pokemon
  const pokemon = globalScene.getEnemyPokemon();
  if (pokemon) {
    audioManager.playSound("se/pb_rel");
    pokemon.hideInfo();
    pokemon.tint(getPokeballTintColor(pokemon.pokeball), 1, 250, "Sine.easeIn");
    globalScene.tweens.add({
      targets: pokemon,
      duration: 250,
      ease: "Sine.easeIn",
      scale: 0.5,
      onComplete: () => {
        pokemon.leaveField(true, true, true);
      },
    });
  }

  // Show the enemy trainer
  globalScene.time.delayedCall(250, () => {
    const sprites = globalScene.currentBattle.trainer?.getSprites();
    const tintSprites = globalScene.currentBattle.trainer?.getTintSprites();
    if (sprites && tintSprites) {
      for (let i = 0; i < sprites.length; i++) {
        sprites[i].setVisible(true);
        tintSprites[i].setVisible(true);
        sprites[i].clearTint();
        tintSprites[i].clearTint();
      }
    }
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "-=16",
      y: "+=16",
      alpha: 1,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  });

  handleMysteryEncounterBattleFailed(true);

  return false;
}

function doPostEncounterCleanup() {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc.encounterFailed) {
    for (const choice of (encounter.misc as ExpertBreederData).choices ?? []) {
      choice.pokemon.addFriendship(FRIENDSHIP_ADDED);
    }
    restoreBreederParties();
  }
}
