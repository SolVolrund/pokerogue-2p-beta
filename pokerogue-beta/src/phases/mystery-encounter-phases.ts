import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { getCharVariantFromDialogue } from "#data/dialogue";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { IvScannerModifier } from "#modifiers/modifier";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import {
  getMysteryEncounterPlayerIndexes,
  getMysteryEncounterPlayerTitle,
  getNextMysteryEncounterPlayerIndex,
} from "#mystery-encounters/encounter-player-utils";
import type { OptionSelectSettings } from "#mystery-encounters/encounter-phase-utils";
import {
  handleMysteryEncounterBattleFailed,
  transitionMysteryEncounterIntroVisuals,
} from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounterOption, OptionPhaseCallback } from "#mystery-encounters/mystery-encounter-option";
import { SeenEncounterData } from "#mystery-encounters/mystery-encounter-save-data";
import { randSeedItem } from "#utils/common";
import { inSpeedOrder } from "#utils/speed-order-generator";
import i18next from "i18next";

/**
 * Will handle (in order):
 * - Clearing of phase queues to enter the Mystery Encounter game state
 * - Management of session data related to MEs
 * - Initialization of ME option select menu and UI
 * - Execute {@linkcode MysteryEncounter.onPreOptionPhase} logic if it exists for the selected option
 * - Display any `OptionTextDisplay.selected` type dialogue that is set in the {@linkcode MysteryEncounterDialogue} dialogue tree for selected option
 * - Queuing of the {@linkcode MysteryEncounterOptionSelectedPhase}
 */
export class MysteryEncounterPhase extends Phase {
  public readonly phaseName = "MysteryEncounterPhase";
  private readonly FIRST_DIALOGUE_PROMPT_DELAY = 300;
  optionSelectSettings?: OptionSelectSettings | undefined;
  private twoPlayerDecisionIndexes: Partial<Record<PlayerIndex, number>> = {};
  private twoPlayerDecisionMessage: string | undefined;

  /**
   * Mostly useful for having repeated queries during a single encounter, where the queries and options may differ each time
   * @param optionSelectSettings allows overriding the typical options of an encounter with new ones
   */
  constructor(optionSelectSettings?: OptionSelectSettings) {
    super();
    this.optionSelectSettings = optionSelectSettings;
  }

  /**
   * Updates seed offset, sets seen encounter session data, sets UI mode
   */
  start() {
    super.start();

    // Clears out queued phases that are part of standard battle
    globalScene.phaseManager.clearPhaseQueue();

    const encounter = globalScene.currentBattle.mysteryEncounter!;
    encounter.updateSeedOffset();
    this.normalizeTwoPlayerTrainerSprites();

    if (!this.optionSelectSettings) {
      // Sets flag that ME was encountered, only if this is not a followup option select phase
      // Can be used in later MEs to check for requirements to spawn, run history, etc.
      globalScene.mysteryEncounterSaveData.encounteredEvents.push(
        new SeenEncounterData(encounter.encounterType, encounter.encounterTier, globalScene.currentBattle.waveIndex),
      );
    }

    if (globalScene.twoPlayerMode && !this.optionSelectSettings) {
      globalScene.waitForPlayerInput(0);
    }

    // Initiates encounter dialogue window and option select
    globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, this.optionSelectSettings);
  }

  private normalizeTwoPlayerTrainerSprites(): void {
    if (!globalScene.twoPlayerMode || this.optionSelectSettings) {
      return;
    }

    const playerIndexes = getMysteryEncounterPlayerIndexes();
    const hasPartnerTrainer = playerIndexes.length > 1;

    ([0, 1, 2] as PlayerIndex[]).forEach(playerIndex => {
      const trainerSprite = globalScene.getPlayerTrainerBackSprite(playerIndex);
      globalScene.tweens.killTweensOf(trainerSprite);
      trainerSprite
        .setVisible(playerIndexes.includes(playerIndex))
        .setTexture(globalScene.getTrainerBackTextureKey(playerIndex))
        .setFrame(0)
        .setPosition(
          globalScene.getTrainerBackSpriteX(playerIndex, hasPartnerTrainer),
          globalScene.getTrainerBackSpriteY(playerIndex),
        );
    });
  }

  /**
   * Triggers after a player selects an option for the encounter
   * @param option
   * @param index
   */
  handleOptionSelect(option: MysteryEncounterOption, index: number): boolean {
    const encounter = globalScene.currentBattle.mysteryEncounter!;
    const shouldCollectSharedDecision =
      globalScene.twoPlayerMode && encounter.twoPlayerSharedDecision && !this.optionSelectSettings;

    if (shouldCollectSharedDecision) {
      const playerIndexes = getMysteryEncounterPlayerIndexes();
      const currentPlayerIndex = globalScene.activePlayerIndex;
      this.twoPlayerDecisionIndexes[currentPlayerIndex] = index;

      const nextPlayerIndex = getNextMysteryEncounterPlayerIndex(currentPlayerIndex, playerIndexes);
      if (nextPlayerIndex != null) {
        globalScene.waitForPlayerInput(nextPlayerIndex);
        globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, {
          slideInDescription: false,
          overrideTitle: getMysteryEncounterPlayerTitle(nextPlayerIndex),
          overrideQuery: "What will you do?",
          startingCursorIndex: index,
        });
        return true;
      }

      const selectedIndexes = playerIndexes.map(playerIndex => this.twoPlayerDecisionIndexes[playerIndex] ?? index);
      const firstIndex = selectedIndexes[0] ?? index;
      const hasDisagreement = selectedIndexes.some(selectedIndex => selectedIndex !== firstIndex);
      if (hasDisagreement) {
        const winningPlayerIndex = globalScene.resolvePlayerTieBreak(playerIndexes);
        index = this.twoPlayerDecisionIndexes[winningPlayerIndex] ?? index;
        option = encounter.options[index];
        this.twoPlayerDecisionMessage = `Player ${winningPlayerIndex + 1}'s choice wins this time.`;
      } else {
        index = firstIndex;
        option = encounter.options[index];
      }

      this.twoPlayerDecisionIndexes = {};
    }

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(0);
    } else {
      globalScene.setActivePlayerIndex(0);
    }

    // Set option selected flag
    encounter.selectedOption = option;

    if (!this.optionSelectSettings) {
      // Saves the selected option in the ME save data, only if this is not a followup option select phase
      // Can be used for analytics purposes to track what options are popular on certain encounters
      const encounterSaveData = globalScene.mysteryEncounterSaveData.encounteredEvents.at(-1)!;
      if (encounterSaveData.type === encounter.encounterType) {
        encounterSaveData.selectedOption = index;
      }
    }

    if (!option.onOptionPhase) {
      return false;
    }

    // Populate dialogue tokens for option requirements
    encounter.populateDialogueTokensFromRequirements();

    if (option.onPreOptionPhase) {
      globalScene.executeWithSeedOffset(async () => {
        return await option.onPreOptionPhase!().then(result => {
          if (result == null || result) {
            this.continueEncounter();
          }
        });
      }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset());
    } else {
      this.continueEncounter();
    }

    return true;
  }

  /**
   * Queues {@linkcode MysteryEncounterOptionSelectedPhase}, displays option.selected dialogue and ends phase
   */
  continueEncounter() {
    const endDialogueAndContinueEncounter = () => {
      globalScene.phaseManager.pushNew("MysteryEncounterOptionSelectedPhase");
      this.end();
    };

    const showSelectedDialogue = () => {
      if (globalScene.currentBattle?.mysteryEncounter?.misc?.skipSelectedDialogueOnce) {
        globalScene.currentBattle.mysteryEncounter.misc.skipSelectedDialogueOnce = false;
        endDialogueAndContinueEncounter();
        return;
      }

      const optionSelectDialogue = globalScene.currentBattle?.mysteryEncounter?.selectedOption?.dialogue;
      if (optionSelectDialogue?.selected && optionSelectDialogue.selected.length > 0) {
        // Handle intermediate dialogue (between player selection event and the onOptionSelect logic)
        globalScene.ui.setMode(UiMode.MESSAGE);
        const selectedDialogue = optionSelectDialogue.selected;
        let i = 0;
        const showNextDialogue = () => {
          const nextAction = i === selectedDialogue.length - 1 ? endDialogueAndContinueEncounter : showNextDialogue;
          const dialogue = selectedDialogue[i];
          let title: string | null = null;
          const text: string | null = getEncounterText(dialogue.text);
          if (dialogue.speaker) {
            title = getEncounterText(dialogue.speaker);
          }

          i++;
          if (title) {
            globalScene.ui.showDialogue(
              text ?? "",
              title,
              null,
              nextAction,
              0,
              i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0,
            );
          } else {
            globalScene.ui.showText(text ?? "", null, nextAction, i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
          }
        };

        showNextDialogue();
      } else {
        endDialogueAndContinueEncounter();
      }
    };

    if (this.twoPlayerDecisionMessage) {
      const decisionMessage = this.twoPlayerDecisionMessage;
      this.twoPlayerDecisionMessage = undefined;
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.showText(decisionMessage, null, showSelectedDialogue, 0, true);
      return;
    }

    showSelectedDialogue();
  }

  /**
   * Ends phase
   */
  end() {
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
  }
}

/**
 * Will handle (in order):
 * - Execute {@linkcode MysteryEncounter.onOptionSelect} logic if it exists for the selected option
 *
 * It is important to point out that no phases are directly queued by any logic within this phase
 * Any phase that is meant to follow this one MUST be queued via the onOptionSelect() logic of the selected option
 */
export class MysteryEncounterOptionSelectedPhase extends Phase {
  public readonly phaseName = "MysteryEncounterOptionSelectedPhase";
  onOptionSelect: OptionPhaseCallback;

  constructor() {
    super();
    this.onOptionSelect = globalScene.currentBattle.mysteryEncounter!.selectedOption!.onOptionPhase;
  }

  /**
   * Will handle (in order):
   * - Execute {@linkcode MysteryEncounter.onOptionSelect} logic if it exists for the selected option
   *
   * It is important to point out that no phases are directly queued by any logic within this phase.
   * Any phase that is meant to follow this one MUST be queued via the {@linkcode MysteryEncounter.onOptionSelect} logic of the selected option.
   */
  start() {
    super.start();
    if (globalScene.currentBattle.mysteryEncounter?.autoHideIntroVisuals) {
      transitionMysteryEncounterIntroVisuals().then(() => {
        globalScene.executeWithSeedOffset(() => {
          this.onOptionSelect().finally(() => {
            this.end();
          });
        }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset() * 500);
      });
    } else {
      globalScene.executeWithSeedOffset(() => {
        this.onOptionSelect().finally(() => {
          this.end();
        });
      }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset() * 500);
    }
  }
}

/**
 * Runs at the beginning of an Encounter's battle
 * Will clean up any residual flinches, Endure, etc. that are left over from {@linkcode MysteryEncounter.startOfBattleEffects}
 * Will also handle Game Overs, switches, etc. that could happen from {@linkcode handleMysteryEncounterBattleStartEffects}
 * See {@linkcode TurnEndPhase} for more details
 */
export class MysteryEncounterBattleStartCleanupPhase extends Phase {
  public readonly phaseName = "MysteryEncounterBattleStartCleanupPhase";
  /**
   * Cleans up `TURN_END` tags, any {@linkcode PostTurnStatusEffectPhase}s, checks for Pokemon switches, then continues
   */
  start() {
    super.start();

    // Lapse any residual flinches/endures but ignore all other turn-end battle tags
    const includedLapseTags = [BattlerTagType.FLINCHED, BattlerTagType.ENDURING];
    for (const pokemon of inSpeedOrder(ArenaTagSide.BOTH)) {
      const tags = pokemon.summonData.tags;
      tags
        .filter(
          t =>
            includedLapseTags.includes(t.tagType)
            && t.lapseTypes.includes(BattlerTagLapseType.TURN_END)
            && !t.lapse(pokemon, BattlerTagLapseType.TURN_END),
        )
        .forEach(t => {
          t.onRemove(pokemon);
          tags.splice(tags.indexOf(t), 1);
        });
    }

    // Remove any status tick phases
    globalScene.phaseManager.removeAllPhasesOfType("PostTurnStatusEffectPhase");

    if (globalScene.areAllActivePlayersOutOfUsablePokemon()) {
      globalScene.phaseManager.unshiftNew("GameOverPhase");
      return this.end();
    }
    if (globalScene.areAllPlayerFieldOwnersOutOfUsablePokemon()) {
      globalScene.phaseManager.clearPhaseQueue(true);
      handleMysteryEncounterBattleFailed();
      return this.end();
    }

    // Check for any KOd player mons and switch
    // For each fainted mon on the field, if there is a legal replacement, summon it
    const playerField = globalScene.getPlayerField();
    playerField.forEach((pokemon, i) => {
      const playerIndex = globalScene.getPlayerIndexForPokemon(pokemon) ?? globalScene.getPlayerIndexForFieldSlot(i);
      const legalPlayerPartyPokemon = globalScene
        .getPokemonAllowedInBattle(playerIndex)
        .filter(p => !p.isActive(true));
      if (!pokemon.isAllowedInBattle() && legalPlayerPartyPokemon.length > 0) {
        globalScene.phaseManager.unshiftNew("SwitchPhase", SwitchType.SWITCH, i, true, false);
      }
    });

    // THEN, if is a double battle, and player only has 1 summoned pokemon, center pokemon on field
    if (
      !globalScene.twoPlayerMode
      && globalScene.currentBattle.double
      && globalScene.getPokemonAllowedInBattle().length === 1
      && globalScene.getPokemonAllowedInBattle().filter(p => !p.isActive(true)).length === 0
    ) {
      globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
    }

    for (const pokemon of globalScene.getField(true)) {
      pokemon.resetTurnData();
    }

    this.end();
  }
}

/**
 * Will handle (in order):
 * - Setting BGM
 * - Showing intro dialogue for an enemy trainer or wild Pokemon
 * - Sliding in the visuals for enemy trainer or wild Pokemon, as well as handling summoning animations
 * - Queue the {@linkcode SummonPhase}s, {@linkcode PostSummonPhase}s, etc., required to initialize the phase queue for a battle
 */
export class MysteryEncounterBattlePhase extends Phase {
  public readonly phaseName = "MysteryEncounterBattlePhase";
  disableSwitch: boolean;

  constructor(disableSwitch = false) {
    super();
    this.disableSwitch = disableSwitch;
  }

  /**
   * Sets up a ME battle
   */
  start() {
    super.start();

    this.doMysteryEncounterBattle();
  }

  /** Get intro battle message for new battle */
  private getBattleMessage(): string {
    const enemyField = globalScene.getEnemyField();
    const encounterMode = globalScene.currentBattle.mysteryEncounter!.encounterMode;

    if (globalScene.currentBattle.isClassicFinalBoss) {
      return i18next.t("battle:bossAppeared", { bossName: enemyField[0].name });
    }

    if (encounterMode === MysteryEncounterMode.TRAINER_BATTLE) {
      if (globalScene.currentBattle.double) {
        return i18next.t("battle:trainerAppearedDouble", {
          trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
        });
      }
      return i18next.t("battle:trainerAppeared", {
        trainerName: globalScene.currentBattle.trainer?.getName(TrainerSlot.NONE, true),
      });
    }

    return enemyField.length === 1
      ? i18next.t("battle:singleWildAppeared", {
          pokemonName: enemyField[0].name,
        })
      : enemyField.length > 1
      ? i18next.t("battle:multiWildAppeared", {
          pokemonName1: enemyField[0].name,
          pokemonName2: enemyField[1].name,
        })
      : "";
  }

  /**
   * Queue {@linkcode SummonPhase}s for the new battle and handle trainer animations/dialogue for Trainer battles
   */
  private doMysteryEncounterBattle() {
    const encounterMode = globalScene.currentBattle.mysteryEncounter!.encounterMode;
    const queueEnemySummonPhases = (availablePartyMembers: number) => {
      const summonCount = Math.min(availablePartyMembers, globalScene.currentBattle.getBattlerCount());
      for (let fieldIndex = 0; fieldIndex < summonCount; fieldIndex++) {
        globalScene.phaseManager.unshiftNew("SummonPhase", fieldIndex, false);
      }
    };

    if (encounterMode === MysteryEncounterMode.WILD_BATTLE || encounterMode === MysteryEncounterMode.BOSS_BATTLE) {
      // Summons the wild/boss Pokemon
      if (encounterMode === MysteryEncounterMode.BOSS_BATTLE) {
        audioManager.playBgm();
      }
      const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
      queueEnemySummonPhases(availablePartyMembers);

      if (globalScene.currentBattle.mysteryEncounter?.hideBattleIntroMessage || availablePartyMembers === 0) {
        this.endBattleSetup();
      } else {
        globalScene.ui.showText(this.getBattleMessage(), null, () => this.endBattleSetup(), 0);
      }
    } else if (encounterMode === MysteryEncounterMode.TRAINER_BATTLE) {
      this.showEnemyTrainer();
      const doSummon = () => {
        globalScene.currentBattle.started = true;
        audioManager.playBgm();
        globalScene.pbTray.showPbTray(globalScene.getPlayerParty());
        globalScene.pbTrayEnemy.showPbTray(globalScene.getEnemyParty());
        const doTrainerSummon = () => {
          this.hideEnemyTrainer();
          const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
          queueEnemySummonPhases(availablePartyMembers);
          this.endBattleSetup();
        };
        if (globalScene.currentBattle.mysteryEncounter?.hideBattleIntroMessage) {
          doTrainerSummon();
        } else {
          globalScene.ui.showText(this.getBattleMessage(), null, doTrainerSummon, 1000, true);
        }
      };

      const encounterMessages = globalScene.currentBattle.trainer?.getEncounterMessages();

      if (!encounterMessages || encounterMessages.length === 0) {
        doSummon();
      } else {
        const trainer = globalScene.currentBattle.trainer;
        let message: string;
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(encounterMessages)),
          globalScene.currentBattle.mysteryEncounter?.getSeedOffset(),
        );
        message = message!; // tell TS compiler it's defined now
        const showDialogueAndSummon = () => {
          globalScene.ui.showDialogue(message, trainer?.getName(TrainerSlot.NONE, true), null, () => {
            globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => doSummon()));
          });
        };
        if (globalScene.currentBattle.trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
          globalScene
            .showFieldOverlay(500)
            .then(() =>
              globalScene.charSprite
                .showCharacter(trainer?.getKey()!, getCharVariantFromDialogue(encounterMessages[0]))
                .then(() => showDialogueAndSummon()),
            ); // TODO: is this bang correct?
        } else {
          showDialogueAndSummon();
        }
      }
    }
  }

  /**
   * Initiate {@linkcode SummonPhase}s, {@linkcode ScanIvsPhase}, {@linkcode PostSummonPhase}s, etc.
   */
  private endBattleSetup() {
    const enemyField = globalScene.getEnemyField();
    const encounterMode = globalScene.currentBattle.mysteryEncounter!.encounterMode;

    // PostSummon and ShinySparkle phases are handled by SummonPhase

    if (encounterMode !== MysteryEncounterMode.TRAINER_BATTLE) {
      enemyField.forEach((pokemon, index) => {
        const ivScannerModifier = globalScene.twoPlayerMode
          ? globalScene.findModifierForPlayer(m => m instanceof IvScannerModifier, (index % 2) as PlayerIndex)
          : globalScene.findModifier(m => m instanceof IvScannerModifier);
        if (ivScannerModifier) {
          globalScene.phaseManager.pushNew("ScanIvsPhase", pokemon.getBattlerIndex());
        }
      });
    }

    const playerFieldOwners = globalScene.getPlayerFieldOwners();
    const availablePartyMemberEntries = globalScene.twoPlayerMode
      ? playerFieldOwners
          .map((playerIndex, fieldIndex) => ({ fieldIndex, pokemon: globalScene.getPlayerParty(playerIndex)[0] }))
          .filter((entry): entry is { fieldIndex: number; pokemon: PlayerPokemon } => !!entry.pokemon?.isAllowedInBattle())
      : globalScene
          .getPlayerParty()
          .filter(p => p.isAllowedInBattle())
          .map((pokemon, fieldIndex) => ({ fieldIndex, pokemon }));
    const availablePartyMembers = availablePartyMemberEntries.map(entry => entry.pokemon);

    if (availablePartyMemberEntries[0] && !availablePartyMemberEntries[0].pokemon.isOnField()) {
      globalScene.phaseManager.pushNew("SummonPhase", availablePartyMemberEntries[0].fieldIndex);
    }

    if (globalScene.currentBattle.double) {
      if (availablePartyMembers.length > 1) {
        globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", true);
        for (const entry of availablePartyMemberEntries.slice(1)) {
          if (!entry.pokemon.isOnField()) {
            globalScene.phaseManager.pushNew("SummonPhase", entry.fieldIndex);
          }
        }
      }
    } else {
      const extraFieldEntries = availablePartyMemberEntries.slice(1).filter(entry => entry.pokemon.isOnField());
      if (extraFieldEntries.length > 0) {
        for (const pokemon of inSpeedOrder(ArenaTagSide.PLAYER)) {
          pokemon.lapseTag(BattlerTagType.COMMANDED);
        }
        for (const entry of extraFieldEntries) {
          globalScene.phaseManager.pushNew("ReturnPhase", entry.fieldIndex);
        }
      }
      globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", false);
    }

    if (encounterMode !== MysteryEncounterMode.TRAINER_BATTLE && !this.disableSwitch) {
      const minPartySize = globalScene.twoPlayerMode
        ? playerFieldOwners.length
        : globalScene.currentBattle.double
          ? 2
          : 1;
      if (availablePartyMembers.length > minPartySize) {
        globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, globalScene.currentBattle.double);
        if (globalScene.currentBattle.double) {
          playerFieldOwners.slice(1).forEach((_playerIndex, fieldIndex) => {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", fieldIndex + 1, globalScene.currentBattle.double);
          });
        }
      }
    }

    globalScene.phaseManager.pushNew("InitEncounterPhase");
    this.end();
  }

  /** Ease in enemy trainer */
  private showEnemyTrainer(): void {
    // Show enemy trainer
    const trainer = globalScene.currentBattle.trainer;
    if (!trainer) {
      return;
    }
    trainer.alpha = 0;
    trainer.x += 16;
    trainer.y -= 16;
    trainer.setVisible(true);
    globalScene.tweens.add({
      targets: trainer,
      x: "-=16",
      y: "+=16",
      alpha: 1,
      ease: "Sine.easeInOut",
      duration: 750,
      onComplete: () => {
        trainer.untint(100, "Sine.easeOut");
        trainer.playAnim();
      },
    });
  }

  private hideEnemyTrainer(): void {
    globalScene.tweens.add({
      targets: globalScene.currentBattle.trainer,
      x: "+=16",
      y: "-=16",
      alpha: 0,
      ease: "Sine.easeInOut",
      duration: 750,
    });
  }
}

/**
 * Will handle (in order):
 * - doContinueEncounter() callback for continuous encounters with back-to-back battles (this should push/shift its own phases as needed)
 *
 * OR
 *
 * - Any encounter reward logic that is set within {@linkcode MysteryEncounter.doEncounterExp}
 * - Any encounter reward logic that is set within {@linkcode MysteryEncounter.doEncounterRewards}
 * - Otherwise, can add a no-reward-item shop with only Potions, etc. if addHealPhase is true
 * - Queuing of the {@linkcode PostMysteryEncounterPhase}
 */
export class MysteryEncounterRewardsPhase extends Phase {
  public readonly phaseName = "MysteryEncounterRewardsPhase";
  addHealPhase: boolean;

  constructor(addHealPhase = false) {
    super();
    this.addHealPhase = addHealPhase;
  }

  /**
   * Runs {@linkcode MysteryEncounter.doContinueEncounter} and ends phase, OR {@linkcode MysteryEncounter.onRewards} then continues encounter
   */
  start() {
    super.start();
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    if (encounter.doContinueEncounter) {
      encounter.doContinueEncounter().then(() => {
        this.end();
      });
    } else {
      globalScene.executeWithSeedOffset(() => {
        if (encounter.onRewards) {
          encounter.onRewards().then(() => {
            this.doEncounterRewardsAndContinue();
          });
        } else {
          this.doEncounterRewardsAndContinue();
        }
        // Do not use ME's seedOffset for rewards, these should always be consistent with waveIndex (once per wave)
      }, globalScene.currentBattle.waveIndex * 1000);
    }
  }

  /**
   * Queues encounter EXP and rewards phases, {@linkcode PostMysteryEncounterPhase}, and ends phase
   */
  doEncounterRewardsAndContinue() {
    const encounter = globalScene.currentBattle.mysteryEncounter!;

    if (encounter.doEncounterExp) {
      encounter.doEncounterExp();
    }

    if (encounter.doEncounterRewards) {
      encounter.doEncounterRewards();
    } else if (this.addHealPhase) {
      globalScene.phaseManager.removeAllPhasesOfType("SelectModifierPhase");
      globalScene.phaseManager.unshiftNew("SelectModifierPhase", 0, undefined, {
        fillRemaining: false,
        rerollMultiplier: -1,
      });
    }

    globalScene.phaseManager.pushNew("PostMysteryEncounterPhase");
    this.end();
  }
}

/**
 * Will handle (in order):
 * - {@linkcode MysteryEncounter.onPostOptionSelect} logic (based on an option that was selected)
 * - Showing any outro dialogue messages
 * - Cleanup of any leftover intro visuals
 * - Queuing of the next wave
 */
export class PostMysteryEncounterPhase extends Phase {
  public readonly phaseName = "PostMysteryEncounterPhase";
  private readonly FIRST_DIALOGUE_PROMPT_DELAY = 750;
  onPostOptionSelect?: OptionPhaseCallback | undefined;

  constructor() {
    super();
    this.onPostOptionSelect = globalScene.currentBattle.mysteryEncounter?.selectedOption?.onPostOptionPhase;
  }

  /**
   * Runs {@linkcode MysteryEncounter.onPostOptionSelect} then continues encounter
   */
  start() {
    super.start();

    if (this.onPostOptionSelect) {
      globalScene.executeWithSeedOffset(async () => {
        return await this.onPostOptionSelect!().then(result => {
          if (result == null || result) {
            this.continueEncounter();
          }
        });
      }, globalScene.currentBattle.mysteryEncounter?.getSeedOffset() * 2000);
    } else {
      this.continueEncounter();
    }
  }

  /**
   * Queues {@linkcode NewBattlePhase}, plays outro dialogue and ends phase
   */
  continueEncounter() {
    const endPhase = () => {
      globalScene.clearMysteryEncounterBattlePlayerFieldOwners();

      if (globalScene.gameMode.hasRandomBiomes || globalScene.isNewBiome()) {
        globalScene.phaseManager.pushNew("SelectBiomePhase");
      }

      globalScene.phaseManager.pushNew("NewBattlePhase");
      this.end();
    };

    const outroDialogue = globalScene.currentBattle?.mysteryEncounter?.dialogue?.outro;
    if (outroDialogue && outroDialogue.length > 0) {
      let i = 0;
      const showNextDialogue = () => {
        const nextAction = i === outroDialogue.length - 1 ? endPhase : showNextDialogue;
        const dialogue = outroDialogue[i];
        let title: string | null = null;
        const text: string | null = getEncounterText(dialogue.text);
        if (dialogue.speaker) {
          title = getEncounterText(dialogue.speaker);
        }

        i++;
        globalScene.ui.setMode(UiMode.MESSAGE);
        if (title) {
          globalScene.ui.showDialogue(
            text ?? "",
            title,
            null,
            nextAction,
            0,
            i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0,
          );
        } else {
          globalScene.ui.showText(text ?? "", null, nextAction, i === 1 ? this.FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
        }
      };

      showNextDialogue();
    } else {
      endPhase();
    }
  }
}
