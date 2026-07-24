import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES, PLAYER_PARTY_MAX_SIZE } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { PartyMemberStrength } from "#enums/party-member-strength";
import { PlayerGender } from "#enums/player-gender";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import * as Modifier from "#modifiers/modifier";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { EnemyPartyConfig, EnemyPokemonConfig } from "#mystery-encounters/encounter-phase-utils";
import { initBattleWithEnemyConfig, leaveEncounterWithoutBattle } from "#mystery-encounters/encounter-phase-utils";
import {
  completeDueDejaVuSchedule,
  getDueDejaVuGhostContexts,
  type DejaVuGhostContext,
} from "#mystery-encounters/deja-vu-ghosts";
import {
  getNextMysteryEncounterPlayerIndex,
  showMysteryEncounterPlayerMenu,
} from "#mystery-encounters/encounter-player-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { PokemonData } from "#system/pokemon-data";
import { trainerConfigs } from "#trainers/trainer-config";
import { TrainerPartyTemplate } from "#trainers/trainer-party-template";
import type { HeldModifierConfig } from "#types/held-modifier-config";
import type { DejaVuGhostData, DejaVuGhostPokemonData } from "#types/save-data";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { PartyOption } from "#ui/party-ui-handler";
import { PartyUiMode } from "#ui/party-ui-handler";
import { updateWindowType } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const namespace = "mysteryEncounters/dejaVu";

type DejaVuOptionIndex = 1 | 2;

interface DejaVuChoice {
  playerIndex: PlayerIndex;
  optionIndex: DejaVuOptionIndex;
}

interface DejaVuData {
  choices: DejaVuChoice[];
  rewardPlayerIndexes: PlayerIndex[];
  skipSelectedDialogueOnce?: boolean;
}

export const DejaVuEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.DEJA_VU,
)
  .withEncounterTier(MysteryEncounterTier.ROGUE)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withCountsForEncounterPacing(false)
  .withCatchAllowed(false)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([])
  .withIntroDialogue([
    {
      text: `${namespace}:intro`,
    },
  ])
  .withOnInit(() => {
    const contexts = getGhostContexts();
    if (contexts.length === 0) {
      return false;
    }

    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.misc = {
      choices: [],
      rewardPlayerIndexes: [],
    } satisfies DejaVuData;
    encounter.onRewards = applyDejaVuRewards;
    return true;
  })
  .setLocalizationKey(namespace)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOption(buildDejaVuOption(1))
  .withOption(buildDejaVuOption(2))
  .build();

function getDejaVuData(): DejaVuData {
  return globalScene.currentBattle.mysteryEncounter!.misc as DejaVuData;
}

function getGhostContexts(): DejaVuGhostContext[] {
  return getDueDejaVuGhostContexts(globalScene);
}

function getVotingPlayerIndexes(): PlayerIndex[] {
  return getGhostContexts()
    .map(context => context.playerIndex)
    .filter(playerIndex => !globalScene.isComputerPartnerPlayer(playerIndex));
}

function getGhostForPlayer(playerIndex: PlayerIndex): DejaVuGhostData | undefined {
  return getGhostContexts().find(context => context.playerIndex === playerIndex)?.ghost;
}

function buildDejaVuOption(optionIndex: DejaVuOptionIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeDejaVuChoice(optionIndex, 0))
    .withOptionPhase(runDejaVuChoices)
    .build();
}

function buildDejaVuPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildDejaVuOptionForPlayer(1, playerIndex), buildDejaVuOptionForPlayer(2, playerIndex)];
}

function buildDejaVuOptionForPlayer(
  optionIndex: DejaVuOptionIndex,
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
    .withPreOptionPhase(async () => storeDejaVuChoice(optionIndex, playerIndex))
    .withOptionPhase(runDejaVuChoices)
    .build();
}

async function storeDejaVuChoice(optionIndex: DejaVuOptionIndex, playerIndex: PlayerIndex): Promise<boolean> {
  const data = getDejaVuData();
  globalScene.currentBattle.mysteryEncounter!.setDialogueToken("player", `${playerIndex + 1}`);
  data.choices = data.choices.filter(choice => choice.playerIndex !== playerIndex);
  data.choices.push({ playerIndex, optionIndex });

  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(playerIndex, getVotingPlayerIndexes());
  if (nextPlayerIndex != null) {
    const result = await showMysteryEncounterPlayerMenu({
      playerIndex: nextPlayerIndex,
      slideInDescription: false,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildDejaVuPlayerOptions(nextPlayerIndex),
      startingCursorIndex: optionIndex - 1,
    });
    return result ?? false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

async function runDejaVuChoices(): Promise<boolean> {
  const data = getDejaVuData();
  const votingPlayerIndexes = getVotingPlayerIndexes();
  const choices = data.choices
    .filter(choice => votingPlayerIndexes.includes(choice.playerIndex))
    .toSorted((a, b) => a.playerIndex - b.playerIndex);

  if (globalScene.twoPlayerMode) {
    for (const choice of choices) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      await showEncounterText(
        i18next.t(`${namespace}:option.${choice.optionIndex}.selected`, { player: choice.playerIndex + 1 }),
      );
    }
  }

  const fightPlayerIndexes = choices
    .filter(choice => choice.optionIndex === 1)
    .map(choice => choice.playerIndex)
    .filter(playerIndex => !!getGhostForPlayer(playerIndex));
  const leavePlayerIndexes = choices
    .filter(choice => choice.optionIndex === 2)
    .map(choice => choice.playerIndex);

  for (const playerIndex of leavePlayerIndexes) {
    clearDejaVuGhostForPlayer(playerIndex);
  }

  if (fightPlayerIndexes.length === 0) {
    completeDueDejaVuSchedule(globalScene);
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
    leaveEncounterWithoutBattle(false);
    return true;
  }

  data.rewardPlayerIndexes = fightPlayerIndexes;
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(fightPlayerIndexes);
  globalScene.setActivePlayerIndex(fightPlayerIndexes[0]);
  updateWindowType(fightPlayerIndexes[0] + 1);
  await showEncounterText(`${namespace}:battleStart`);
  await initBattleWithEnemyConfig(createDejaVuEnemyPartyConfig(fightPlayerIndexes));
  return true;
}

function cloneGhostPokemonData(entry: DejaVuGhostPokemonData, player: boolean): PokemonData {
  const dataSource = new PokemonData(entry.pokemon);
  dataSource.player = player;
  dataSource.hp = dataSource.stats?.[0] ?? dataSource.hp;
  dataSource.status = null;
  dataSource.boss = false;
  dataSource.bossSegments = 0;
  dataSource.trainerSlot = TrainerSlot.NONE;
  return dataSource;
}

function getGhostTrainerSlot(playerSlotIndex: number): TrainerSlot {
  switch (playerSlotIndex) {
    case 1:
      return TrainerSlot.TRAINER_PARTNER;
    case 2:
      return TrainerSlot.TRAINER_PARTNER_2;
    default:
      return TrainerSlot.TRAINER;
  }
}

function createDejaVuEnemyPokemonConfigs(playerIndexes: PlayerIndex[]): EnemyPokemonConfig[] {
  const contexts = getGhostContexts().filter(context => playerIndexes.includes(context.playerIndex));
  const maxPartySize = Math.max(...contexts.map(context => context.ghost.party.length));
  const pokemonConfigs: EnemyPokemonConfig[] = [];

  for (let partyIndex = 0; partyIndex < maxPartySize; partyIndex++) {
    contexts.forEach((context, contextIndex) => {
      const entry = context.ghost.party[partyIndex];
      if (!entry) {
        return;
      }

      const dataSource = cloneGhostPokemonData(entry, false);
      pokemonConfigs.push({
        species: getPokemonSpecies(dataSource.species),
        isBoss: false,
        level: dataSource.level,
        dataSource,
        modifierConfigs: createGhostHeldItemConfigs(entry),
        trainerSlot: getGhostTrainerSlot(contextIndex),
      });
    });
  }

  return pokemonConfigs;
}

function createGhostHeldItemConfigs(entry: DejaVuGhostPokemonData): HeldModifierConfig[] {
  return entry.heldItems
    .map(item => modifierDataToHeldModifier(item))
    .filter((modifier): modifier is PokemonHeldItemModifier => !!modifier)
    .map(modifier => ({
      modifier,
      stackCount: modifier.getStackCount(),
      isTransferable: false,
    }));
}

function createDejaVuEnemyPartyConfig(playerIndexes: PlayerIndex[]): EnemyPartyConfig {
  const contexts = getGhostContexts().filter(context => playerIndexes.includes(context.playerIndex));
  const pokemonConfigs = createDejaVuEnemyPokemonConfigs(playerIndexes);
  const trainerConfigsForGhosts = contexts.map(context =>
    getAlternateTrainerConfig(context.ghost, context.ghost.party.length),
  );

  return {
    trainerConfig: trainerConfigsForGhosts[0],
    partnerTrainerConfig: trainerConfigsForGhosts[1],
    partnerTrainerConfig2: trainerConfigsForGhosts[2],
    pokemonConfigs,
    female: contexts[0]?.ghost.playerGender === PlayerGender.FEMALE,
    partnerFemale: contexts[1]?.ghost.playerGender === PlayerGender.FEMALE,
    partnerFemale2: contexts[2]?.ghost.playerGender === PlayerGender.FEMALE,
    doubleBattle: playerIndexes.length > 1,
    forceDoubleBattle: playerIndexes.length > 1,
  };
}

function getAlternateTrainerConfig(ghost: DejaVuGhostData, partySize: number) {
  const trainerConfig =
    trainerConfigs[
      ghost.playerGender === PlayerGender.FEMALE ? TrainerType.PLAYER_F_ALTERNATE : TrainerType.PLAYER_M_ALTERNATE
    ].clone();

  trainerConfig.setPartyTemplates(new TrainerPartyTemplate(partySize, PartyMemberStrength.STRONG));
  return trainerConfig;
}

async function applyDejaVuRewards(): Promise<void> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const data = getDejaVuData();
  const rewardPlayerIndexes = data.rewardPlayerIndexes.filter(playerIndex => !!getGhostForPlayer(playerIndex));

  encounter.onRewards = undefined;
  for (const playerIndex of rewardPlayerIndexes) {
    globalScene.setActivePlayerIndex(playerIndex);
    updateWindowType(playerIndex + 1);
    const ghost = getGhostForPlayer(playerIndex);
    if (!ghost) {
      continue;
    }

    const selectedEntry = await promptGhostPokemonChoice(playerIndex, ghost);
    if (selectedEntry) {
      await addGhostPokemonReward(playerIndex, selectedEntry);
    } else {
      await showEncounterText(i18next.t(`${namespace}:skipReward`, { player: playerIndex + 1 }));
    }

    clearDejaVuGhostForPlayer(playerIndex);
  }

  completeDueDejaVuSchedule(globalScene);
  encounter.dialogue.outro = [
    {
      text: `${namespace}:outro`,
    },
  ];
}

function promptGhostPokemonChoice(
  playerIndex: PlayerIndex,
  ghost: DejaVuGhostData,
): Promise<DejaVuGhostPokemonData | undefined> {
  return new Promise(resolve => {
    globalScene.waitForPlayerInput(playerIndex);
    updateWindowType(playerIndex + 1);

    const options: OptionSelectItem[] = ghost.party.map(entry => ({
      label: getGhostPokemonLabel(entry),
      handler: () => {
        resolve(entry);
        return true;
      },
      onHover: () => {
        const species = getPokemonSpecies(entry.pokemon.species);
        const heldItemCount = entry.heldItems.reduce((total, item) => total + (item.stackCount ?? 1), 0);
        const heldItemLine = heldItemCount > 0 ? ` ${heldItemCount} held item${heldItemCount === 1 ? "" : "s"}.` : "";
        globalScene.ui.showText(
          i18next.t(`${namespace}:rewardHover`, {
            pokemonName: species.getName(),
            level: entry.pokemon.level,
            heldItemLine,
          }),
          0,
        );
      },
    }));

    options.push({
      label: i18next.t(`${namespace}:reward.skip`),
      handler: () => {
        resolve(undefined);
        return true;
      },
    });

    const config: OptionSelectConfig = {
      options,
      maxOptions: options.length,
      noCancel: true,
      supportHover: true,
    };

    globalScene.ui.showText(
      i18next.t(`${namespace}:rewardPrompt`, { player: playerIndex + 1 }),
      null,
      () => {
        globalScene.ui.setMode(UiMode.OPTION_SELECT, config);
      },
      0,
      true,
    );
  });
}

function getGhostPokemonLabel(entry: DejaVuGhostPokemonData): string {
  return `${getPokemonSpecies(entry.pokemon.species).getName()} Lv.${entry.pokemon.level}`;
}

async function addGhostPokemonReward(playerIndex: PlayerIndex, entry: DejaVuGhostPokemonData): Promise<void> {
  const addToParty = async (slotIndex?: number): Promise<void> => {
    const dataSource = cloneGhostPokemonData(entry, true);
    const newPokemon = globalScene.addPlayerPokemon(
      getPokemonSpecies(dataSource.species),
      dataSource.level,
      dataSource.abilityIndex,
      dataSource.formIndex,
      dataSource.gender,
      dataSource.shiny,
      dataSource.variant,
      dataSource.ivs,
      dataSource.nature,
      dataSource,
    );
    reviveGhostPokemon(newPokemon);

    const party = globalScene.getPlayerParty(playerIndex);
    if (slotIndex != null && slotIndex <= party.length) {
      party.splice(slotIndex, 0, newPokemon);
    } else {
      party.push(newPokemon);
    }

    await newPokemon.loadAssets();
    addHeldItemsToRewardPokemon(playerIndex, entry, newPokemon);
    await updateCaughtDataForReward(playerIndex, newPokemon);
    saveDejaVuGhostProfile(playerIndex);
    await showEncounterText(
      i18next.t(`${namespace}:obtainedPokemon`, { pokemonName: newPokemon.getNameToRender() }),
    );
  };

  if (globalScene.getPlayerParty(playerIndex).length >= PLAYER_PARTY_MAX_SIZE) {
    await promptReleaseForGhostReward(playerIndex, getGhostPokemonLabel(entry), addToParty);
  } else {
    await addToParty();
  }
}

function reviveGhostPokemon(pokemon: PlayerPokemon): void {
  pokemon.hp = pokemon.getMaxHp();
  pokemon.resetStatus(true, false, false, true);
  for (const move of pokemon.moveset) {
    move.ppUsed = 0;
  }
  pokemon.updateInfo(true);
}

function addHeldItemsToRewardPokemon(
  playerIndex: PlayerIndex,
  entry: DejaVuGhostPokemonData,
  pokemon: PlayerPokemon,
): void {
  for (const modifier of entry.heldItems
    .map(item => modifierDataToHeldModifier(item))
    .filter((mod): mod is PokemonHeldItemModifier => !!mod)) {
    modifier.pokemonId = pokemon.id;
    modifier.isTransferable = true;
    globalScene.addModifier(modifier, true, false, false, true, undefined, playerIndex);
  }

  globalScene.updateModifiers(true, true, playerIndex);
}

function modifierDataToHeldModifier(item: DejaVuGhostPokemonData["heldItems"][number]): PokemonHeldItemModifier | undefined {
  const modifierConstructor = (Modifier as Record<string, unknown>)[item.className];
  if (typeof modifierConstructor !== "function") {
    return undefined;
  }

  const modifier = item.toModifier(modifierConstructor);
  return modifier instanceof PokemonHeldItemModifier ? modifier : undefined;
}

async function updateCaughtDataForReward(playerIndex: PlayerIndex, pokemon: PlayerPokemon): Promise<void> {
  const gameData = globalScene.getPlayerGameData(playerIndex);
  gameData.updateSpeciesDexIvs(pokemon.species.getRootSpeciesId(true), pokemon.ivs, playerIndex);
  await gameData.setPokemonCaught(pokemon, true, false, false);
}

function promptReleaseForGhostReward(
  playerIndex: PlayerIndex,
  pokemonName: string,
  addToParty: (slotIndex?: number) => Promise<void>,
): Promise<void> {
  return new Promise(resolve => {
    const promptRelease = () => {
      globalScene.waitForPlayerInput(playerIndex);
      updateWindowType(playerIndex + 1);
      globalScene.ui.showText(
        i18next.t("battle:partyFull", { pokemonName }),
        null,
        () => {
          globalScene.ui.setMode(
            UiMode.PARTY,
            PartyUiMode.RELEASE,
            getPartyUiFieldSlotForPlayer(playerIndex),
            (slotIndex: number, _option: PartyOption) => {
              globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                if (slotIndex < PLAYER_PARTY_MAX_SIZE) {
                  addToParty(slotIndex).then(() => resolve());
                } else {
                  promptRelease();
                }
              });
            },
          );
        },
        0,
        true,
      );
    };

    promptRelease();
  });
}

function getPartyUiFieldSlotForPlayer(playerIndex: PlayerIndex): number {
  const fieldSlot = globalScene.getPlayerFieldOwners().indexOf(playerIndex);
  return fieldSlot > -1 ? fieldSlot : playerIndex;
}

function clearDejaVuGhostForPlayer(playerIndex: PlayerIndex): void {
  globalScene.getPlayerGameData(playerIndex).clearDejaVuGhost(globalScene.gameMode.modeId);
  saveDejaVuGhostProfile(playerIndex);
}

function saveDejaVuGhostProfile(playerIndex: PlayerIndex): void {
  if (globalScene.twoPlayerMode) {
    globalScene.savePlayerSystemSaveLocal(playerIndex);
  } else {
    globalScene.gameData.saveSystemLocal();
  }
}
