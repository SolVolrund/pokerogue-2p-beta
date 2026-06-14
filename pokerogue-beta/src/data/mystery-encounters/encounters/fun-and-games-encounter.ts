import { CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES } from "#app/constants";
import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeActiveTrigger } from "#data/form-change-triggers";
import { getPokeballAtlasKey, getPokeballTintColor } from "#data/pokeball";
import { FieldPosition } from "#enums/field-position";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { Nature } from "#enums/nature";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon, Pokemon } from "#field/pokemon";
import type { EnemyPokemon } from "#field/pokemon";
import { queueEncounterMessage, showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  leaveEncounterWithoutBattle,
  selectPokemonForOption,
  setEncounterRewards,
  transitionMysteryEncounterIntroVisuals,
  updatePlayerMoney,
} from "#mystery-encounters/encounter-phase-utils";
import { isPokemonValidForEncounterOptionSelection } from "#mystery-encounters/encounter-pokemon-utils";
import type { MysteryEncounter } from "#mystery-encounters/mystery-encounter";
import { MysteryEncounterBuilder } from "#mystery-encounters/mystery-encounter";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { MysteryEncounterOptionBuilder } from "#mystery-encounters/mystery-encounter-option";
import { MoneyRequirement } from "#mystery-encounters/mystery-encounter-requirements";
import { updateWindowType } from "#ui/ui-theme";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** the i18n namespace for the encounter */
const namespace = "mysteryEncounters/funAndGames";

type FunAndGamesOptionIndex = 1 | 2;

interface FunAndGamesChoice {
  playerIndex: PlayerIndex;
  optionIndex: FunAndGamesOptionIndex;
  playerPokemon?: PlayerPokemon;
  enemyIndex?: number;
}

interface FunAndGamesData {
  choices: FunAndGamesChoice[];
  turnsRemaining?: number;
  skipSelectedDialogueOnce?: boolean;
}

class TwoPlayerAnyPlayerFunAndGamesMoneyRequirement extends MoneyRequirement {
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

class FunAndGamesPlayerMoneyRequirement extends MoneyRequirement {
  constructor(private readonly playerIndex: PlayerIndex) {
    super(0);
  }

  override meetsRequirement(): boolean {
    this.requiredMoney = getFunAndGamesPlayCost();
    return globalScene.getPlayerMoney(this.playerIndex) >= this.requiredMoney;
  }

  override getDialogueToken(): [string, string] {
    return ["money", getFunAndGamesPlayCost().toString()];
  }
}

function getFunAndGamesData(): FunAndGamesData {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  if (!encounter.misc || !Array.isArray(encounter.misc.choices)) {
    encounter.misc = {
      ...(encounter.misc ?? {}),
      choices: [],
    } satisfies FunAndGamesData;
  }

  return encounter.misc as FunAndGamesData;
}

function getFunAndGamesPlayCost(): number {
  return globalScene.getWaveMoneyAmount(1.5);
}

function spendFunAndGamesMoney(playerIndex: PlayerIndex): void {
  const moneyCost = getFunAndGamesPlayCost();
  globalScene.setPlayerMoney(Math.max(globalScene.getPlayerMoney(playerIndex) - moneyCost, 0), playerIndex);

  if (!globalScene.twoPlayerMode || playerIndex === globalScene.activePlayerIndex) {
    globalScene.updateMoneyText();
    globalScene.animateMoneyChanged(false);
  }
}

async function storeFunAndGamesPlayChoice(playerIndex: PlayerIndex): Promise<boolean> {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  let selectedPokemon: PlayerPokemon | undefined;
  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    selectedPokemon = pokemon;
  };

  const selectableFilter = (pokemon: Pokemon) => {
    return isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
  };

  const selected = await selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
  if (!selected || !selectedPokemon) {
    return false;
  }

  return storeFunAndGamesChoice(
    {
      playerIndex,
      optionIndex: 1,
      playerPokemon: selectedPokemon,
    },
    0,
  );
}

function storeFunAndGamesLeaveChoice(playerIndex: PlayerIndex): boolean {
  return storeFunAndGamesChoice(
    {
      playerIndex,
      optionIndex: 2,
    },
    1,
  );
}

function storeFunAndGamesChoice(choice: FunAndGamesChoice, startingCursorIndex: number): boolean {
  if (!globalScene.twoPlayerMode) {
    return true;
  }

  const data = getFunAndGamesData();
  data.choices = data.choices.filter(existing => existing.playerIndex !== choice.playerIndex);
  data.choices.push(choice);

  if (choice.playerIndex === 0) {
    showFunAndGamesPlayerMenu(1, startingCursorIndex);
    return false;
  }

  data.skipSelectedDialogueOnce = true;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  return true;
}

function showFunAndGamesPlayerMenu(playerIndex: PlayerIndex, startingCursorIndex = 0): void {
  globalScene.setActivePlayerIndex(playerIndex);
  updateWindowType(playerIndex + 1);

  globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
      slideInDescription: false,
      overrideTitle: `Player ${playerIndex + 1}`,
      overrideQuery: i18next.t(`${namespace}:query`),
      overrideOptions: buildFunAndGamesPlayerOptions(playerIndex),
      startingCursorIndex,
    });
  });
}

async function showFunAndGamesSelectedDialogue(choice: FunAndGamesChoice): Promise<void> {
  globalScene.setActivePlayerIndex(choice.playerIndex);
  updateWindowType(choice.playerIndex + 1);
  await showEncounterText(`${namespace}:option.${choice.optionIndex}.selected`);
}

function getFunAndGamesTrainerSprite(playerIndex: PlayerIndex): Phaser.GameObjects.Sprite {
  return playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
}

async function hideFunAndGamesNonPlayingTrainers(battlePlayers: PlayerIndex[]): Promise<void> {
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
            const trainerSprite = getFunAndGamesTrainerSprite(playerIndex);
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

function buildPlayGameOption(playerIndex: PlayerIndex): MysteryEncounterOption {
  return MysteryEncounterOptionBuilder.newOptionWithMode(MysteryEncounterOptionMode.DISABLED_OR_DEFAULT)
    .withSceneRequirement(new FunAndGamesPlayerMoneyRequirement(playerIndex))
    .withDialogue({
      buttonLabel: `${namespace}:option.1.label`,
      buttonTooltip: `${namespace}:option.1.tooltip`,
      selected: [
        {
          text: `${namespace}:option.1.selected`,
        },
      ],
    })
    .withPreOptionPhase(async () =>
      globalScene.twoPlayerMode ? storeFunAndGamesPlayChoice(playerIndex) : runOnePlayerPlayPreOption(),
    )
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerFunAndGamesChoices() : runOnePlayerPlayGame(),
    )
    .build();
}

function buildLeaveOption(playerIndex: PlayerIndex): MysteryEncounterOption {
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
    .withPreOptionPhase(async () => storeFunAndGamesLeaveChoice(playerIndex))
    .withOptionPhase(async () =>
      globalScene.twoPlayerMode ? runTwoPlayerFunAndGamesChoices() : runOnePlayerLeaveGame(),
    )
    .build();
}

function buildFunAndGamesPlayerOptions(playerIndex: PlayerIndex): MysteryEncounterOption[] {
  return [buildPlayGameOption(playerIndex), buildLeaveOption(playerIndex)];
}

/**
 * Fun and Games! encounter.
 * @see {@link https://github.com/pagefaultgames/pokerogue/issues/3819 | GitHub Issue #3819}
 * @see For biome requirements check {@linkcode mysteryEncountersByBiome}
 */
export const FunAndGamesEncounter: MysteryEncounter = MysteryEncounterBuilder.withEncounterType(
  MysteryEncounterType.FUN_AND_GAMES,
)
  .withEncounterTier(MysteryEncounterTier.GREAT)
  .withSceneWaveRangeRequirement(...CLASSIC_MODE_MYSTERY_ENCOUNTER_WAVES)
  .withSceneRequirement(new TwoPlayerAnyPlayerFunAndGamesMoneyRequirement(0, 1.5)) // Cost equal to 1 Max Potion to play
  .withAutoHideIntroVisuals(false)
  // The Wobbuffet won't use moves
  .withSkipEnemyBattleTurns(true)
  // Will skip COMMAND selection menu and go straight to FIGHT (move select) menu
  .withSkipToFightInput(true)
  .withFleeAllowed(false)
  .withIntroSpriteConfigs([
    {
      spriteKey: "fun_and_games_game",
      fileRoot: "mystery-encounters",
      hasShadow: false,
      x: 0,
      y: 6,
    },
    {
      spriteKey: "fun_and_games_wobbuffet",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      x: -28,
      y: 6,
      yShadow: 6,
    },
    {
      spriteKey: "fun_and_games_man",
      fileRoot: "mystery-encounters",
      hasShadow: true,
      x: 40,
      y: 6,
      yShadow: 6,
    },
  ])
  .withIntroDialogue([
    {
      speaker: `${namespace}:speaker`,
      text: `${namespace}:introDialogue`,
    },
  ])
  .setLocalizationKey(`${namespace}`)
  .withTitle(`${namespace}:title`)
  .withDescription(`${namespace}:description`)
  .withQuery(`${namespace}:query`)
  .withOnInit(() => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.setDialogueToken("wobbuffetName", getPokemonSpecies(SpeciesId.WOBBUFFET).getName());
    return true;
  })
  .withOnVisualsStart(() => {
    audioManager.playBgm("mystery_encounter_fun_and_games", true);
    return true;
  })
  .withOption(buildPlayGameOption(0))
  .withOption(buildLeaveOption(0))
  .build();

async function runOnePlayerPlayPreOption(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const onPokemonSelected = (pokemon: PlayerPokemon) => {
    encounter.misc = {
      playerPokemon: pokemon,
    };
  };

  const selectableFilter = (pokemon: Pokemon) => {
    return isPokemonValidForEncounterOptionSelection(pokemon, `${namespace}:invalidSelection`);
  };

  return selectPokemonForOption(onPokemonSelected, undefined, selectableFilter);
}

async function runOnePlayerPlayGame(): Promise<boolean> {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.misc.turnsRemaining = 3;

  const moneyCost = (encounter.options[0].requirements[0] as MoneyRequirement).requiredMoney;
  updatePlayerMoney(-moneyCost, true, false);
  await showEncounterText(
    i18next.t("mysteryEncounterMessages:paidMoney", {
      amount: moneyCost,
    }),
  );

  encounter.onTurnStart = handleNextTurn;
  encounter.doContinueEncounter = handleLoseMinigame;

  hideShowmanIntroSprite();
  await summonPlayerPokemon();
  await showWobbuffetHealthBar();

  return true;
}

async function runOnePlayerLeaveGame(): Promise<boolean> {
  await transitionMysteryEncounterIntroVisuals(true, true);
  leaveEncounterWithoutBattle(true);
  return true;
}

async function runTwoPlayerFunAndGamesChoices(): Promise<boolean> {
  const choices = getFunAndGamesData().choices.toSorted((a, b) => a.playerIndex - b.playerIndex);
  const playChoices = choices.filter(
    (choice): choice is FunAndGamesChoice & { playerPokemon: PlayerPokemon } =>
      choice.optionIndex === 1 && !!choice.playerPokemon,
  );

  for (const choice of choices) {
    await showFunAndGamesSelectedDialogue(choice);
  }

  if (playChoices.length === 0) {
    globalScene.setActivePlayerIndex(0);
    updateWindowType(1);
    await transitionMysteryEncounterIntroVisuals(true, true);
    leaveEncounterWithoutBattle(true);
    return true;
  }

  const data = getFunAndGamesData();
  data.turnsRemaining = 3;
  for (const choice of playChoices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
    spendFunAndGamesMoney(choice.playerIndex);
    await showEncounterText(
      i18next.t("mysteryEncounterMessages:paidMoney", {
        amount: getFunAndGamesPlayCost(),
      }),
    );
  }

  const battlePlayers = playChoices.map(choice => choice.playerIndex);
  globalScene.setMysteryEncounterBattlePlayerFieldOwners(battlePlayers);
  globalScene.currentBattle.double = playChoices.length > 1;
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  encounter.onTurnStart = handleNextTurnTwoPlayer;
  encounter.doContinueEncounter = handleLoseMinigameTwoPlayer;

  hideShowmanIntroSprite();
  await hideFunAndGamesNonPlayingTrainers(battlePlayers);
  await summonFunAndGamesPlayerPokemon(playChoices);
  await setupFunAndGamesWobbuffet(playChoices);

  globalScene.setActivePlayerIndex(battlePlayers[0]);
  updateWindowType(battlePlayers[0] + 1);
  return true;
}

async function summonFunAndGamesPlayerPokemon(
  playChoices: (FunAndGamesChoice & { playerPokemon: PlayerPokemon })[],
): Promise<void> {
  await Promise.all(
    playChoices.map(async (choice, fieldIndex) => {
      const party = globalScene.getPlayerParty(choice.playerIndex);
      const chosenIndex = party.indexOf(choice.playerPokemon);
      if (chosenIndex !== 0) {
        const leadPokemon = party[0];
        party[0] = choice.playerPokemon;
        party[chosenIndex] = leadPokemon;
      }

      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      globalScene.ui.showText(
        i18next.t("battle:playerGo", {
          pokemonName: getPokemonNameWithAffix(choice.playerPokemon),
        }),
      );

      const trainerSprite = choice.playerIndex === 1 ? globalScene.trainerPartner : globalScene.trainer;
      globalScene.pbTray.hide();
      trainerSprite.setTexture(globalScene.getTrainerBackTextureKey(choice.playerIndex, true));
      globalScene.time.delayedCall(562, () => {
        trainerSprite.setFrame("2");
        globalScene.time.delayedCall(64, () => {
          trainerSprite.setFrame("3");
        });
      });
      globalScene.tweens.add({
        targets: trainerSprite,
        x: -36,
        duration: 1000,
        onComplete: () => trainerSprite.setVisible(false),
      });

      await new Promise<void>(resolve => {
        globalScene.time.delayedCall(750, () => {
          const fieldPosition =
            playChoices.length > 1 ? (fieldIndex === 0 ? FieldPosition.LEFT : FieldPosition.RIGHT) : FieldPosition.CENTER;
          summonPlayerPokemonAnimation(choice.playerPokemon, choice.playerIndex, fieldPosition).then(resolve);
        });
      });
    }),
  );
}

async function setupFunAndGamesWobbuffet(
  playChoices: (FunAndGamesChoice & { playerPokemon: PlayerPokemon })[],
): Promise<void> {
  const enemySpecies = getPokemonSpecies(SpeciesId.WOBBUFFET);
  globalScene.currentBattle.enemyParty = [];

  const wobbuffet = globalScene.addEnemyPokemon(
    enemySpecies,
    Math.max(...playChoices.map(choice => choice.playerPokemon.level)),
    TrainerSlot.NONE,
    false,
    true,
  );
  wobbuffet.ivs.fill(0);
  wobbuffet.setNature(Nature.MILD);
  wobbuffet.setAlpha(0);
  wobbuffet.setVisible(false);
  wobbuffet.calculateStats();
  wobbuffet.setFieldPosition(FieldPosition.CENTER, 0);
  wobbuffet.setPosition(236, 84);
  globalScene.currentBattle.enemyParty[0] = wobbuffet;
  globalScene.gameData.setPokemonSeen(wobbuffet, true);
  await wobbuffet.loadAssets();

  for (const choice of playChoices) {
    choice.enemyIndex = 0;
  }

  globalScene.add.existing(wobbuffet);
  globalScene.field.add(wobbuffet);
  const playerPokemon: Pokemon | undefined = playChoices.find(choice => choice.playerPokemon.isOnField())?.playerPokemon;
  if (playerPokemon) {
    globalScene.field.moveBelow(wobbuffet, playerPokemon);
  }
  wobbuffet.showInfo();
  globalScene.time.delayedCall(1000, () => {
    wobbuffet.cry();
  });
  wobbuffet.resetSummonData();
}

function getFunAndGamesPlayChoices(): FunAndGamesChoice[] {
  return getFunAndGamesData()
    .choices.filter(choice => choice.optionIndex === 1 && choice.enemyIndex != null)
    .toSorted((a, b) => (a.enemyIndex ?? 0) - (b.enemyIndex ?? 0));
}

function getFunAndGamesWobbuffet(): EnemyPokemon | undefined {
  return globalScene.getEnemyParty()[0];
}

async function handleLoseMinigameTwoPlayer(): Promise<void> {
  await transitionMysteryEncounterIntroVisuals(true, true);
  completeTwoPlayerFunAndGames(false);
}

function handleNextTurnTwoPlayer(): boolean {
  const data = getFunAndGamesData();
  const wobbuffet = getFunAndGamesWobbuffet();
  const activeWobbuffet = !!wobbuffet && !wobbuffet.isFainted(true) && wobbuffet.hp > 0;

  if (!activeWobbuffet) {
    completeTwoPlayerFunAndGames(false);
    return true;
  }

  if ((data.turnsRemaining ?? 0) <= 0) {
    completeTwoPlayerFunAndGames(true);
    return true;
  }

  if ((data.turnsRemaining ?? 0) < 3) {
    queueEncounterMessage(`${namespace}:chargingContinue`);
  }
  queueEncounterMessage(`${namespace}:turnRemaining${data.turnsRemaining}`);
  data.turnsRemaining = (data.turnsRemaining ?? 0) - 1;

  return false;
}

function completeTwoPlayerFunAndGames(includeEndGameMessage: boolean): void {
  const encounter = globalScene.currentBattle.mysteryEncounter!;
  const playChoices = getFunAndGamesPlayChoices();
  const wobbuffet = getFunAndGamesWobbuffet();
  const queuedMessages: string[] = [];
  let addHealPhase = false;

  if (includeEndGameMessage) {
    queuedMessages.push(`${namespace}:endGame`);
  }

  if (!wobbuffet || wobbuffet.isFainted(true) || wobbuffet.hp === 0) {
    queuedMessages.push(`${namespace}:ko`);

    for (const choice of playChoices) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      spendFunAndGamesMoney(choice.playerIndex);
    }
    addHealPhase = true;
  } else {
    const healthRatio = wobbuffet.hp / wobbuffet.getMaxHp();
    let resultMessageKey: string | undefined;
    for (const choice of playChoices) {
      globalScene.setActivePlayerIndex(choice.playerIndex);
      updateWindowType(choice.playerIndex + 1);
      resultMessageKey = setFunAndGamesResultRewards(choice.playerIndex, healthRatio);
      addHealPhase ||= resultMessageKey === `${namespace}:badResult`;
    }

    if (resultMessageKey) {
      queuedMessages.push(resultMessageKey);
    }
  }

  if (wobbuffet) {
    wobbuffet.hideInfo();
    wobbuffet.leaveField();
  }

  for (const choice of playChoices) {
    globalScene.setActivePlayerIndex(choice.playerIndex);
    updateWindowType(choice.playerIndex + 1);
  }

  globalScene.currentBattle.enemyParty = [];
  encounter.doContinueEncounter = undefined;
  encounter.onTurnStart = undefined;
  globalScene.setActivePlayerIndex(0);
  updateWindowType(1);
  leaveEncounterWithoutBattle(addHealPhase);

  for (const message of queuedMessages) {
    queueEncounterMessage(message);
  }
}

function setFunAndGamesResultRewards(playerIndex: PlayerIndex, healthRatio: number): string {
  if (healthRatio < 0.03) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.MULTI_LENS],
        fillRemaining: false,
      },
      undefined,
      undefined,
      playerIndex,
    );
    return `${namespace}:bestResult`;
  }

  if (healthRatio < 0.15) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.SCOPE_LENS],
        fillRemaining: false,
      },
      undefined,
      undefined,
      playerIndex,
    );
    return `${namespace}:greatResult`;
  }

  if (healthRatio < 0.33) {
    setEncounterRewards(
      {
        guaranteedModifierTypeFuncs: [modifierTypes.WIDE_LENS],
        fillRemaining: false,
      },
      undefined,
      undefined,
      playerIndex,
    );
    return `${namespace}:goodResult`;
  }

  return `${namespace}:badResult`;
}

async function summonPlayerPokemon() {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: TODO: Consider refactoring to avoid async promise executor
  return new Promise<void>(async resolve => {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    const playerPokemon = encounter.misc.playerPokemon;
    // Swaps the chosen Pokemon and the first player's lead Pokemon in the party
    const party = globalScene.getPlayerParty();
    const chosenIndex = party.indexOf(playerPokemon);
    if (chosenIndex !== 0) {
      const leadPokemon = party[0];
      party[0] = playerPokemon;
      party[chosenIndex] = leadPokemon;
    }

    // Do trainer summon animation
    let playerAnimationPromise: Promise<void> | undefined;
    globalScene.ui.showText(
      i18next.t("battle:playerGo", {
        pokemonName: getPokemonNameWithAffix(playerPokemon),
      }),
    );
    globalScene.pbTray.hide();
    globalScene.trainer.setTexture(globalScene.getTrainerBackTextureKey(0, true));
    globalScene.time.delayedCall(562, () => {
      globalScene.trainer.setFrame("2");
      globalScene.time.delayedCall(64, () => {
        globalScene.trainer.setFrame("3");
      });
    });
    globalScene.tweens.add({
      targets: globalScene.trainer,
      x: -36,
      duration: 1000,
      onComplete: () => globalScene.trainer.setVisible(false),
    });
    globalScene.time.delayedCall(750, () => {
      playerAnimationPromise = summonPlayerPokemonAnimation(playerPokemon);
    });

    // Also loads Wobbuffet data (cannot be shiny)
    const enemySpecies = getPokemonSpecies(SpeciesId.WOBBUFFET);
    globalScene.currentBattle.enemyParty = [];
    const wobbuffet = globalScene.addEnemyPokemon(
      enemySpecies,
      encounter.misc.playerPokemon.level,
      TrainerSlot.NONE,
      false,
      true,
    );
    wobbuffet.ivs.fill(0);
    wobbuffet.setNature(Nature.MILD);
    wobbuffet.setAlpha(0);
    wobbuffet.setVisible(false);
    wobbuffet.calculateStats();
    globalScene.currentBattle.enemyParty[0] = wobbuffet;
    globalScene.gameData.setPokemonSeen(wobbuffet, true);
    await wobbuffet.loadAssets();
    const id = setInterval(checkPlayerAnimationPromise, 500);
    async function checkPlayerAnimationPromise() {
      if (playerAnimationPromise) {
        clearInterval(id);
        await playerAnimationPromise;
        resolve();
      }
    }
  });
}

function handleLoseMinigame() {
  // biome-ignore lint/suspicious/noAsyncPromiseExecutor: TODO: Consider refactoring to avoid async promise executor
  return new Promise<void>(async resolve => {
    // Check Wobbuffet is still alive
    const wobbuffet = globalScene.getEnemyPokemon();
    if (!wobbuffet || wobbuffet.isFainted(true) || wobbuffet.hp === 0) {
      // Player loses
      // End the battle
      if (wobbuffet) {
        wobbuffet.hideInfo();
        wobbuffet.leaveField();
      }
      transitionMysteryEncounterIntroVisuals(true, true);
      globalScene.currentBattle.enemyParty = [];
      globalScene.currentBattle.mysteryEncounter!.doContinueEncounter = undefined;
      leaveEncounterWithoutBattle(true);
      await showEncounterText(`${namespace}:ko`);
      const reviveCost = globalScene.getWaveMoneyAmount(1.5);
      updatePlayerMoney(-reviveCost, true, false);
    }

    resolve();
  });
}

function handleNextTurn() {
  const encounter = globalScene.currentBattle.mysteryEncounter!;

  const wobbuffet = globalScene.getEnemyPokemon();
  if (!wobbuffet) {
    // Should never be triggered, just handling the edge case
    handleLoseMinigame();
    return true;
  }
  if (encounter.misc.turnsRemaining <= 0) {
    // Check Wobbuffet's health for the actual result
    const healthRatio = wobbuffet.hp / wobbuffet.getMaxHp();
    let resultMessageKey: string;
    let isHealPhase = false;
    if (healthRatio < 0.03) {
      // Grand prize
      setEncounterRewards({
        guaranteedModifierTypeFuncs: [modifierTypes.MULTI_LENS],
        fillRemaining: false,
      });
      resultMessageKey = `${namespace}:bestResult`;
    } else if (healthRatio < 0.15) {
      // 2nd prize
      setEncounterRewards({
        guaranteedModifierTypeFuncs: [modifierTypes.SCOPE_LENS],
        fillRemaining: false,
      });
      resultMessageKey = `${namespace}:greatResult`;
    } else if (healthRatio < 0.33) {
      // 3rd prize
      setEncounterRewards({
        guaranteedModifierTypeFuncs: [modifierTypes.WIDE_LENS],
        fillRemaining: false,
      });
      resultMessageKey = `${namespace}:goodResult`;
    } else {
      // No prize
      isHealPhase = true;
      resultMessageKey = `${namespace}:badResult`;
    }

    // End the battle
    wobbuffet.hideInfo();
    wobbuffet.leaveField();
    globalScene.currentBattle.enemyParty = [];
    globalScene.currentBattle.mysteryEncounter!.doContinueEncounter = undefined;
    leaveEncounterWithoutBattle(isHealPhase);
    // Must end the TurnInit phase prematurely so battle phases aren't added to queue
    queueEncounterMessage(`${namespace}:endGame`);
    queueEncounterMessage(resultMessageKey);

    // Skip remainder of TurnInitPhase
    return true;
  }
  if (encounter.misc.turnsRemaining < 3) {
    // Display charging messages on turns that aren't the initial turn
    queueEncounterMessage(`${namespace}:chargingContinue`);
  }
  queueEncounterMessage(`${namespace}:turnRemaining${encounter.misc.turnsRemaining}`);
  encounter.misc.turnsRemaining--;

  // Don't skip remainder of TurnInitPhase
  return false;
}

async function showWobbuffetHealthBar() {
  const wobbuffet = globalScene.getEnemyPokemon()!;

  globalScene.add.existing(wobbuffet);
  globalScene.field.add(wobbuffet);

  const playerPokemon = globalScene.getPlayerPokemon() as Pokemon;
  if (playerPokemon?.isOnField()) {
    globalScene.field.moveBelow(wobbuffet, playerPokemon);
  }
  // Show health bar and trigger cry
  wobbuffet.showInfo();
  globalScene.time.delayedCall(1000, () => {
    wobbuffet.cry();
  });
  wobbuffet.resetSummonData();

  // Track the HP change across turns
  globalScene.currentBattle.mysteryEncounter!.misc.wobbuffetHealth = wobbuffet.hp;
}

function summonPlayerPokemonAnimation(
  pokemon: PlayerPokemon,
  playerIndex: PlayerIndex = 0,
  fieldPosition: FieldPosition = FieldPosition.CENTER,
): Promise<void> {
  return new Promise<void>(resolve => {
    const pokeball = globalScene.addFieldSprite(36, 80, "pb", getPokeballAtlasKey(pokemon.pokeball));
    pokeball.setVisible(false);
    pokeball.setOrigin(0.5, 0.625);
    globalScene.field.add(pokeball);

    pokemon.setFieldPosition(fieldPosition, 0);

    const fpOffset = pokemon.getFieldPositionOffset();

    pokeball.setVisible(true);

    globalScene.tweens.add({
      targets: pokeball,
      duration: 650,
      x: 100 + fpOffset[0],
    });

    globalScene.tweens.add({
      targets: pokeball,
      duration: 150,
      ease: "Cubic.easeOut",
      y: 70 + fpOffset[1],
      onComplete: () => {
        globalScene.tweens.add({
          targets: pokeball,
          duration: 500,
          ease: "Cubic.easeIn",
          angle: 1440,
          y: 132 + fpOffset[1],
          onComplete: () => {
            audioManager.playSound("se/pb_rel");
            pokeball.destroy();
            globalScene.add.existing(pokemon);
            globalScene.field.add(pokemon);
            globalScene.animations.addPokeballOpenParticles(pokemon.x, pokemon.y - 16, pokemon.pokeball);
            globalScene.updateModifiers(true, undefined, playerIndex);
            globalScene.updateFieldScale();
            pokemon.showInfo();
            pokemon.playAnim();
            pokemon.setVisible(true);
            pokemon.getSprite().setVisible(true);
            pokemon.setScale(0.5);
            pokemon.tint(getPokeballTintColor(pokemon.pokeball));
            pokemon.untint(250, "Sine.easeIn");
            globalScene.updateFieldScale();
            globalScene.tweens.add({
              targets: pokemon,
              duration: 250,
              ease: "Sine.easeIn",
              scale: pokemon.getSpriteScale(),
              onComplete: () => {
                pokemon.cry(pokemon.getHpRatio() > 0.25 ? undefined : { rate: 0.85 });
                pokemon.getSprite().clearTint();
                pokemon.fieldSetup(true);
                globalScene.time.delayedCall(1000, () => {
                  if (pokemon.isShiny()) {
                    globalScene.phaseManager.unshiftNew("ShinySparklePhase", pokemon.getBattlerIndex());
                  }

                  pokemon.resetTurnData();

                  globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeActiveTrigger, true);
                  globalScene.phaseManager.unshiftNew("PostSummonPhase", pokemon.getBattlerIndex());
                  resolve();
                });
              },
            });
          },
        });
      },
    });
  });
}

function hideShowmanIntroSprite() {
  const carnivalGame = globalScene.currentBattle.mysteryEncounter!.introVisuals?.getSpriteAtIndex(0)[0];
  const wobbuffet = globalScene.currentBattle.mysteryEncounter!.introVisuals?.getSpriteAtIndex(1)[0];
  const showMan = globalScene.currentBattle.mysteryEncounter!.introVisuals?.getSpriteAtIndex(2)[0];

  // Hide the showman
  globalScene.tweens.add({
    targets: showMan,
    x: "+=16",
    y: "-=16",
    alpha: 0,
    ease: "Sine.easeInOut",
    duration: 750,
  });

  // Slide the Wobbuffet and Game over slightly
  globalScene.tweens.add({
    targets: [wobbuffet, carnivalGame],
    x: "+=16",
    ease: "Sine.easeInOut",
    duration: 750,
  });
}
