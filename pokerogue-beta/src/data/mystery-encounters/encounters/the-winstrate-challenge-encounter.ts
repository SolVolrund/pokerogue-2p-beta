import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { TrainerType } from "#enums/trainer-type";
import type { PokemonHeldItemModifierType } from "#modifiers/modifier-type";
import { showEncounterDialogue, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig } from "#mystery-encounters/encounter-phase-utils";
import {
  generateModifierType,
  generateModifierTypeOption,
  initBattleWithEnemyConfig,
  leaveEncounterWithoutBattle,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { EncounterSceneRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import { updateWindowType } from "#ui/ui-theme";
import { UiMode } from "#enums/ui-mode";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/theWinstrateChallenge";

const MIN_PARTY_SIZE_FOR_WINSTRATE = 3;

type WinstrateOptionIndex = 1 | 2;

interface WinstrateChoice {
  playerIndex: PlayerIndex;
  optionIndex: WinstrateOptionIndex;
}

interface WinstrateData {
  choices: WinstrateChoice[];
  battlePlayers: PlayerIndex[];
  skipSelectedDialogueOnce?: boolean;
}

class WinstrateSpawnRequirement extends EncounterSceneRequirement {
  override meetsRequirement(): boolean {
    if (!globalScene.twoPlayerMode) {
      return globalScene.getPlayerParty().length >= MIN_PARTY_SIZE_FOR_WINSTRATE;
    }

    return ([0, 1] as PlayerIndex[]).every(
      playerIndex => globalScene.getPlayerParty(playerIndex).length >= MIN_PARTY_SIZE_FOR_WINSTRATE,
    );
  }

  override getDialogueToken(): [string, string] {
    return ["partySize", MIN_PARTY_SIZE_FOR_WINSTRATE.toString()];
  }
}

function getWinstrateData(): WinstrateData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
      battlePlayers: [],
    } satisfies WinstrateData;
  }

  return encounter.misc as WinstrateData;
}

function showWinstratePlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildWinstratePlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

function storeWinstrateChoice(optionIndex: WinstrateOptionIndex, playerIndex: PlayerIndex): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  const data = getWinstrateData();
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (playerIndex === 0) {
    showWinstratePlayerMenu(1, optionIndex - 1);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function healWinstratePlayerParty(playerIndex: PlayerIndex): void {
  for (const pokemon of globalScene.getPlayerParty(playerIndex)) {
    pokemon.hp = pokemon.getMaxHp();
    pokemon.resetStatus(true, false, false, true);
    for (const move of pokemon.moveset) {
      move.ppUsed = 0;
    }
    pokemon.updateInfo(true);
  }
}

function getWinstrateTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

async function hideWinstrateNonBattleTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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
            const trainerSprite = getWinstrateTrainerSprite(playerIndex);
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

function setWinstrateRefuseReward(playerIndex: PlayerIndex): void {
  setEncounterRewards(
    {
      guaranteedModifierTypeFuncs: [modifierTypes.RARER_CANDY],
      fillRemaining: false,
    },
    undefined,
    () => healWinstratePlayerParty(playerIndex),
    playerIndex,
  );
}

function setWinstrateVictoryRewards(playerIndexes: PlayerIndex[]): void {
  for (const playerIndex of playerIndexes) {
    const newModifier = modifierTypes.VOUCHER_PREMIUM().newModifier();
    globalScene.addModifier(newModifier, false, true, false, true, undefined, playerIndex);
    const machoBrace = generateModifierTypeOption(modifierTypes.MYSTERY_ENCOUNTER_MACHO_BRACE)!;
    machoBrace.type.tier = ModifierTier.MASTER;
    setEncounterRewards(
      {
        guaranteedModifierTypeOptions: [machoBrace],
        fillRemaining: false,
      },
      undefined,
      undefined,
      playerIndex,
    );
  }
}

function cloneWinstrateTrainerConfig(trainerType: TrainerType, partySize: number) {
  return trainerConfigs[trainerType]
    .clone()
    .setPartyTemplates(new TrainerPartyTemplate(partySize, PartyMemberStrength.STRONG));
}

function getTrainerTypeForConfig(config: EnemyPartyConfig): TrainerType {
  return config.trainerType ?? config.trainerConfig!.trainerType;
}

function createSoloDoubleTrainerConfig(config: EnemyPartyConfig): EnemyPartyConfig {
  const trainerType = getTrainerTypeForConfig(config);
  const ret: EnemyPartyConfig = {
    trainerConfig: cloneWinstrateTrainerConfig(trainerType, config.pokemonConfigs?.length ?? 2),
    doubleBattle: true,
    forceDoubleBattle: true,
  };

  if (config.pokemonConfigs) {
    ret.pokemonConfigs = config.pokemonConfigs;
  }

  return ret;
}

function createPairedTrainerConfig(mainConfig: EnemyPartyConfig, partnerConfig: EnemyPartyConfig): EnemyPartyConfig {
  const mainPokemonConfigs = mainConfig.pokemonConfigs ?? [];
  const partnerPokemonConfigs = partnerConfig.pokemonConfigs ?? [];
  const pokemonConfigs: NonNullable<EnemyPartyConfig["pokemonConfigs"]> = [];
  const mainTrainerType = getTrainerTypeForConfig(mainConfig);
  const partnerTrainerType = getTrainerTypeForConfig(partnerConfig);
  const maxPartySize = Math.max(mainPokemonConfigs.length, partnerPokemonConfigs.length);
  for (let i = 0; i < maxPartySize; i++) {
    if (i < mainPokemonConfigs.length) {
      pokemonConfigs.push(mainPokemonConfigs[i]);
    }
    if (i < partnerPokemonConfigs.length) {
      pokemonConfigs.push(partnerPokemonConfigs[i]);
    }
  }

  return {
    trainerConfig: cloneWinstrateTrainerConfig(mainTrainerType, mainPokemonConfigs.length),
    partnerTrainerConfig: cloneWinstrateTrainerConfig(partnerTrainerType, partnerPokemonConfigs.length),
    pokemonConfigs,
    doubleBattle: true,
  };
}

function loadSinglePlayerWinstrateConfigs(): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.enemyPartyConfigs = [];
  encounter.enemyPartyConfigs.push(getVitoTrainerConfig());
  encounter.enemyPartyConfigs.push(getVickyTrainerConfig());
  encounter.enemyPartyConfigs.push(getViviTrainerConfig());
  encounter.enemyPartyConfigs.push(getVictoriaTrainerConfig());
  encounter.enemyPartyConfigs.push(getVictorTrainerConfig());
}

function loadTwoPlayerWinstrateConfigs(battlePlayers: PlayerIndex[]): void {
  if (battlePlayers.length < 2) {
    loadSinglePlayerWinstrateConfigs();
    return;
  }

  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const victor = getVictorTrainerConfig();
  const victoria = getVictoriaTrainerConfig();
  const vivi = getViviTrainerConfig();
  const vicky = getVickyTrainerConfig();
  const vito = getVitoTrainerConfig();

  encounter.enemyPartyConfigs = [];
  encounter.enemyPartyConfigs.push(createPairedTrainerConfig(vito, vicky));
  encounter.enemyPartyConfigs.push(createPairedTrainerConfig(vicky, vivi));
  encounter.enemyPartyConfigs.push(createPairedTrainerConfig(vivi, victoria));
  encounter.enemyPartyConfigs.push(createPairedTrainerConfig(victoria, victor));
  encounter.enemyPartyConfigs.push(createSoloDoubleTrainerConfig(victor));
}

async function runTwoPlayerWinstrateChoices(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getWinstrateData();
  const choices = data.choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const battlePlayers = choices.filter(choice => choice.optionIndex === 1).map(choice => choice.playerIndex);
  const refusePlayers = choices.filter(choice => choice.optionIndex === 2).map(choice => choice.playerIndex);

  for (const choice of choices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    await showEncounterDialogue(`${namespace}:option.${choice.optionIndex}.selected`, `${namespace}:speaker`);
  }

  for (const playerIndex of refusePlayers) {
    setWinstrateRefuseReward(playerIndex);
  }

  if (battlePlayers.length === 0) {
    leaveEncounterWithoutBattle();
    return true;
  }

  data.battlePlayers = battlePlayers;
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  loadTwoPlayerWinstrateConfigs(battlePlayers);

  encounter.doContinueEncounter = async () => {
    await endTrainerBattleAndShowDialogue();
  };
  await transitionMysteryEncounterIntroVisuals(true, false);
  await hideWinstrateNonBattleTrainers(battlePlayers);
  await spawnNextTrainerOrEndEncounter();
  return true;
}

function buildWinstrateAcceptOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeWinstrateChoice(1, playerIndex))
    .withOptionPhase(async () => (globalScene.twoPlayerMode ? runTwoPlayerWinstrateChoices() : runOnePlayerWinstrateAccept()))
    .build();
}

function buildWinstrateRefuseOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DEFAULT)
    .withDialogue({
      buttonLabel: `${namespace}:option.2.label`,
      buttonTooltip: `${namespace}:option.2.tooltip`,
      selected: [
        {
          speaker: `${namespace}:speaker`,
          text: `${namespace}:option.2.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () => storeWinstrateChoice(2, playerIndex))
    .withOptionPhase(async () => (globalScene.twoPlayerMode ? runTwoPlayerWinstrateChoices() : runOnePlayerWinstrateRefuse()))
    .build();
}

function buildWinstratePlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildWinstrateAcceptOption(playerIndex), buildWinstrateRefuseOption(playerIndex)];
}

async function runOnePlayerWinstrateAccept(): Promise<void> {
  globalScene.currentBattle.mysteryEncounter!.doContinueEncounter = async () => {
    await endTrainerBattleAndShowDialogue();
  };
  await transitionMysteryEncounterIntroVisuals(true, false);
  await spawnNextTrainerOrEndEncounter();
}

async function runOnePlayerWinstrateRefuse(): Promise<void> {
  globalScene.phaseManager.unshiftNew("PartyHealPhase", true);
  setEncounterRewards({
    guaranteedModifierTypeFuncs: [modifierTypes.RARER_CANDY],
    fillRemaining: false,
  });
  leaveEncounterWithoutBattle();
}

/**
 * The Winstrate Challenge encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3821 | GitHub Issue #3821}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const TheWinstrateChallengeEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.THE_WINSTRATE_CHALLENGE,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(100, CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES[1])
  .withSceneRequirement(new WinstrateSpawnRequirement())
  .withMaxAllowedEncounters(1)
  .withIntroSpriteConfigs([
    {
      spriteKey: "vito",
      fileRoot: "trainer",
      hasShadow: false,
      x: 16,
      y: -4,
    },
    {
      spriteKey: "vivi",
      fileRoot: "trainer",
      hasShadow: false,
      x: -14,
      y: -4,
    },
    {
      spriteKey: "victor",
      fileRoot: "trainer",
      hasShadow: true,
      x: -32,
    },
    {
      spriteKey: "victoria",
      fileRoot: "trainer",
      hasShadow: true,
      x: 40,
    },
    {
      spriteKey: "vicky",
      fileRoot: "trainer",
      hasShadow: true,
      x: 3,
      y: 5,
      yShadow: 5,
    },
  ])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .withAutoHideIntroVisuals(false)
  .withOnInit(() => {
    loadSinglePlayerWinstrateConfigs();
    globalScene.currentBattle.mysteryEncounter!.misc = {
      choices: [],
      battlePlayers: [],
    } satisfies WinstrateData;

    return true;
  })
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildWinstrateAcceptOption(0))
  .withOption(buildWinstrateRefuseOption(0))
  .build();

async function spawnNextTrainerOrEndEncounter() {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const nextConfig = encounter.enemyPartyConfigs.pop();
  if (nextConfig) {
    const battlePlayers = (getWinstrateData().battlePlayers.length
      ? getWinstrateData().battlePlayers
      : [globalScene.activePlayerIndex]) as PlayerIndex[];
    globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
    await initBattleWithEnemyConfig(nextConfig);
  } else {
    await transitionMysteryEncounterIntroVisuals(false, false);
    await showEncounterDialogue(`${namespace}:victory`, `${namespace}:speaker`);

    const battlePlayers = (getWinstrateData().battlePlayers.length
      ? getWinstrateData().battlePlayers
      : [globalScene.activePlayerIndex]) as PlayerIndex[];
    setWinstrateVictoryRewards(battlePlayers);
    audioManager.playSound("se/item_fanfare");
    await showEncounterText(i18next.t("battle:rewardGain", { modifierName: modifierTypes.VOUCHER_PREMIUM().name }));

    await showEncounterDialogue(`${namespace}:victory2`, `${namespace}:speaker`);
    globalScene.ui.clearText(); // Clears "Winstrate" title from screen as rewards get animated in
    encounter.doContinueEncounter = undefined;
    leaveEncounterWithoutBattle(false, MysteryEncounterMode.NO_BATTLE);
  }
}

function endTrainerBattleAndShowDialogue(): Promise<void> {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: TODO: Consider refactoring to avoid async promise executor
  return new Promise(async resolve => {
    if (globalScene.currentBattle.mysteryEncounter!.enemyPartyConfigs.length === 0) {
      // Battle is over
      const trainer = globalScene.currentBattle.trainer;
      if (trainer) {
        globalScene.tweens.add({
          targets: trainer,
          x: "+=16",
          y: "-=16",
          alpha: 0,
          ease: "Sine.easeInOut",
          duration: 750,
          onComplete: () => {
            globalScene.field.remove(trainer, true);
          },
        });
      }

      await spawnNextTrainerOrEndEncounter();
      resolve(); // Wait for all dialogue/post battle stuff to complete before resolving
    } else {
      globalScene.arena.resetArenaEffects();
      const playerField = globalScene.getPlayerField();
      for (const pokemon of playerField) {
        pokemon.lapseTag(BattlerTagType.COMMANDED);
      }
      playerField.forEach((_, p) => globalScene.phaseManager.unshiftNew("ReturnPhase", p));

      const battlePlayers = (getWinstrateData().battlePlayers.length
        ? getWinstrateData().battlePlayers
        : [globalScene.activePlayerIndex]) as PlayerIndex[];
      for (const playerIndex of battlePlayers) {
        for (const pokemon of globalScene.getPlayerParty(playerIndex)) {
          // Only trigger form change when Eiscue is in Noice form
          // Hardcoded Eiscue for now in case it is fused with another pokemon
          if (
            pokemon.species.speciesId === SpeciesId.EISCUE
            && pokemon.hasAbility(AbilityId.ICE_FACE)
            && pokemon.formIndex === 1
          ) {
            globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeAbilityTrigger);
          }

          // Each trainer battle is supposed to be a new fight, so reset all per-battle activation effects
          pokemon.resetBattleAndWaveData();
          applyAbAttrs("PostBattleInitAbAttr", { pokemon });
        }
      }

      globalScene.phaseManager.unshiftNew("ShowTrainerPhase");
      // Hide the trainer and init next battle
      const trainer = globalScene.currentBattle.trainer;
      // Unassign previous trainer from battle so it isn't destroyed before animation completes
      globalScene.currentBattle.trainer = null;
      await spawnNextTrainerOrEndEncounter();
      if (trainer) {
        globalScene.tweens.add({
          targets: trainer,
          x: "+=16",
          y: "-=16",
          alpha: 0,
          ease: "Sine.easeInOut",
          duration: 750,
          onComplete: () => {
            globalScene.field.remove(trainer, true);
            resolve();
          },
        });
      }
    }
  });
}

function getVictorTrainerConfig(): EnemyPartyConfig {
  return {
    trainerType: TrainerType.VICTOR,
    pokemonConfigs: [
      {
        species: getPokemonSpecies(SpeciesId.SWELLOW),
        isBoss: false,
        abilityIndex: 0, // Guts
        nature: Nature.ADAMANT,
        moveSet: [MoveId.FACADE, MoveId.BRAVE_BIRD, MoveId.PROTECT, MoveId.QUICK_ATTACK],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.FLAME_ORB) as PokemonHeldItemModifierType,
            isTransferable: false,
          },
          {
            modifier: generateModifierType(modifierTypes.FOCUS_BAND) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.OBSTAGOON),
        isBoss: false,
        abilityIndex: 1, // Guts
        nature: Nature.ADAMANT,
        moveSet: [MoveId.FACADE, MoveId.OBSTRUCT, MoveId.NIGHT_SLASH, MoveId.FIRE_PUNCH],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.FLAME_ORB) as PokemonHeldItemModifierType,
            isTransferable: false,
          },
          {
            modifier: generateModifierType(modifierTypes.LEFTOVERS) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
    ],
  };
}

function getVictoriaTrainerConfig(): EnemyPartyConfig {
  return {
    trainerType: TrainerType.VICTORIA,
    pokemonConfigs: [
      {
        species: getPokemonSpecies(SpeciesId.ROSERADE),
        isBoss: false,
        abilityIndex: 0, // Natural Cure
        nature: Nature.CALM,
        moveSet: [MoveId.SYNTHESIS, MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.SLEEP_POWDER],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SOUL_DEW) as PokemonHeldItemModifierType,
            isTransferable: false,
          },
          {
            modifier: generateModifierType(modifierTypes.QUICK_CLAW) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.GARDEVOIR),
        isBoss: false,
        formIndex: 1,
        nature: Nature.TIMID,
        moveSet: [MoveId.PSYSHOCK, MoveId.MOONBLAST, MoveId.SHADOW_BALL, MoveId.WILL_O_WISP],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [
              PokemonType.PSYCHIC,
            ]) as PokemonHeldItemModifierType,
            stackCount: 1,
            isTransferable: false,
          },
          {
            modifier: generateModifierType(modifierTypes.ATTACK_TYPE_BOOSTER, [
              PokemonType.FAIRY,
            ]) as PokemonHeldItemModifierType,
            stackCount: 1,
            isTransferable: false,
          },
        ],
      },
    ],
  };
}

function getViviTrainerConfig(): EnemyPartyConfig {
  return {
    trainerType: TrainerType.VIVI,
    pokemonConfigs: [
      {
        species: getPokemonSpecies(SpeciesId.SEAKING),
        isBoss: false,
        abilityIndex: 3, // Lightning Rod
        nature: Nature.ADAMANT,
        moveSet: [MoveId.WATERFALL, MoveId.MEGAHORN, MoveId.KNOCK_OFF, MoveId.REST],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.LUM]) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
          {
            modifier: generateModifierType(modifierTypes.BASE_STAT_BOOSTER, [Stat.HP]) as PokemonHeldItemModifierType,
            stackCount: 4,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.BRELOOM),
        isBoss: false,
        abilityIndex: 1, // Poison Heal
        nature: Nature.JOLLY,
        moveSet: [MoveId.SPORE, MoveId.SWORDS_DANCE, MoveId.SEED_BOMB, MoveId.DRAIN_PUNCH],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.BASE_STAT_BOOSTER, [Stat.HP]) as PokemonHeldItemModifierType,
            stackCount: 4,
            isTransferable: false,
          },
          {
            modifier: generateModifierType(modifierTypes.TOXIC_ORB) as PokemonHeldItemModifierType,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.CAMERUPT),
        isBoss: false,
        formIndex: 1,
        nature: Nature.CALM,
        moveSet: [MoveId.EARTH_POWER, MoveId.FIRE_BLAST, MoveId.YAWN, MoveId.PROTECT],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.QUICK_CLAW) as PokemonHeldItemModifierType,
            stackCount: 3,
            isTransferable: false,
          },
        ],
      },
    ],
  };
}

function getVickyTrainerConfig(): EnemyPartyConfig {
  return {
    trainerType: TrainerType.VICKY,
    pokemonConfigs: [
      {
        species: getPokemonSpecies(SpeciesId.MEDICHAM),
        isBoss: false,
        formIndex: 1,
        nature: Nature.IMPISH,
        moveSet: [MoveId.AXE_KICK, MoveId.ICE_PUNCH, MoveId.ZEN_HEADBUTT, MoveId.BULLET_PUNCH],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.SHELL_BELL) as PokemonHeldItemModifierType,
            isTransferable: false,
          },
        ],
      },
    ],
  };
}

function getVitoTrainerConfig(): EnemyPartyConfig {
  return {
    trainerType: TrainerType.VITO,
    pokemonConfigs: [
      {
        species: getPokemonSpecies(SpeciesId.HISUI_ELECTRODE),
        isBoss: false,
        abilityIndex: 0, // Soundproof
        nature: Nature.MODEST,
        moveSet: [MoveId.THUNDERBOLT, MoveId.GIGA_DRAIN, MoveId.FOUL_PLAY, MoveId.THUNDER_WAVE],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.BASE_STAT_BOOSTER, [Stat.SPD]) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.SWALOT),
        isBoss: false,
        abilityIndex: 2, // Gluttony
        nature: Nature.QUIET,
        moveSet: [MoveId.SLUDGE_BOMB, MoveId.GIGA_DRAIN, MoveId.ICE_BEAM, MoveId.EARTHQUAKE],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.SITRUS]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.APICOT]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.GANLON]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.STARF]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.SALAC]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.LUM]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.LANSAT]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.LIECHI]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.PETAYA]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.ENIGMA]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
          {
            modifier: generateModifierType(modifierTypes.BERRY, [BerryType.LEPPA]) as PokemonHeldItemModifierType,
            stackCount: 2,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.DODRIO),
        isBoss: false,
        abilityIndex: 2, // Tangled Feet
        nature: Nature.JOLLY,
        moveSet: [MoveId.DRILL_PECK, MoveId.QUICK_ATTACK, MoveId.THRASH, MoveId.KNOCK_OFF],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.KINGS_ROCK) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.ALAKAZAM),
        isBoss: false,
        formIndex: 1,
        nature: Nature.BOLD,
        moveSet: [MoveId.PSYCHIC, MoveId.SHADOW_BALL, MoveId.FOCUS_BLAST, MoveId.THUNDERBOLT],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.WIDE_LENS) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
      {
        species: getPokemonSpecies(SpeciesId.DARMANITAN),
        isBoss: false,
        abilityIndex: 0, // Sheer Force
        nature: Nature.IMPISH,
        moveSet: [MoveId.EARTHQUAKE, MoveId.U_TURN, MoveId.FLARE_BLITZ, MoveId.ROCK_SLIDE],
        modifierConfigs: [
          {
            modifier: generateModifierType(modifierTypes.QUICK_CLAW) as PokemonHeldItemModifierType,
            stackCount: 2,
            isTransferable: false,
          },
        ],
      },
    ],
  };
}
