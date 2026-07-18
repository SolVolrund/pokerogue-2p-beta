import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import { modifierTypes } from "#data/data-lists";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { overrideHeldItems, overrideModifiers, PersistentModifier } from "#modifiers/modifier";
import type { Starter } from "#types/save-data";
import { SaveSlotUiMode } from "#ui/handlers/save-slot-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import {
  createComputerPartnerStarter,
  getComputerPartnerProfile,
  isComputerPartnerStarterAce,
} from "#utils/computer-partner-profile";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

export class SelectStarterPhase extends Phase {
  public readonly phaseName = "SelectStarterPhase";
  start() {
    super.start();

    audioManager.playBgm("menu");
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(0);
    } else {
      globalScene.setActivePlayerIndex(0);
    }

    this.selectStartersForPlayer(0);
  }

  private selectStartersForPlayer(playerIndex: PlayerIndex): void {
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(playerIndex);
    } else {
      globalScene.setActivePlayerIndex(playerIndex);
    }
    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      globalScene.ui.clearText();
      if (globalScene.twoPlayerMode) {
        this.initPlayerStarters(starters, playerIndex).then(() => {
          const playerIndexes = globalScene.getActivePlayerIndexes();
          const currentPlayerOffset = playerIndexes.indexOf(playerIndex);
          const nextPlayerIndex = playerIndexes[currentPlayerOffset + 1];
          if (nextPlayerIndex !== undefined) {
            this.waitForTwoPlayerProfilesBeforeAction(() => {
              const computerPartnerProfile = getComputerPartnerProfile(
                globalScene.getComputerPartnerKey(nextPlayerIndex),
              );
              if (
                globalScene.isComputerPartnerPlayer(nextPlayerIndex)
                && !computerPartnerProfile.usesPlayerSelectedStarters
              ) {
                this.initComputerPartnerStarters(nextPlayerIndex).then(() =>
                  this.advanceAfterStarterSelection(nextPlayerIndex),
                );
                return;
              }

              globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
                const starterPrompt = globalScene.isComputerPartnerPlayer(nextPlayerIndex)
                  ? i18next.t("menu:computerPartnerStarterPrompt")
                  : nextPlayerIndex === 1
                    ? i18next.t("menu:playerTwoStarterPrompt")
                    : "Player 3, choose your starters.";
                globalScene.ui.showText(starterPrompt, null, () => this.selectStartersForPlayer(nextPlayerIndex));
              });
            });
            return;
          }

          globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("starters-selected");
          globalScene.waitForSharedInput();
          this.selectSaveSlot(() => this.beginBattle());
        });
        return;
      }

      this.selectSaveSlot(() => this.initPlayerStarters(starters, 0).then(() => this.beginBattle()));
    });
  }

  private advanceAfterStarterSelection(playerIndex: PlayerIndex): void {
    const playerIndexes = globalScene.getActivePlayerIndexes();
    const currentPlayerOffset = playerIndexes.indexOf(playerIndex);
    const nextPlayerIndex = playerIndexes[currentPlayerOffset + 1];
    if (nextPlayerIndex !== undefined) {
      this.waitForTwoPlayerProfilesBeforeAction(() => {
        const computerPartnerProfile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(nextPlayerIndex));
        if (
          globalScene.isComputerPartnerPlayer(nextPlayerIndex)
          && !computerPartnerProfile.usesPlayerSelectedStarters
        ) {
          this.initComputerPartnerStarters(nextPlayerIndex).then(() =>
            this.advanceAfterStarterSelection(nextPlayerIndex),
          );
          return;
        }

        globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          const starterPrompt = globalScene.isComputerPartnerPlayer(nextPlayerIndex)
            ? i18next.t("menu:computerPartnerStarterPrompt")
            : nextPlayerIndex === 1
              ? i18next.t("menu:playerTwoStarterPrompt")
              : "Player 3, choose your starters.";
          globalScene.ui.showText(starterPrompt, null, () => this.selectStartersForPlayer(nextPlayerIndex));
        });
      });
      return;
    }

    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("starters-selected");
    globalScene.waitForSharedInput();
    this.selectSaveSlot(() => this.beginBattle());
  }

  private selectSaveSlot(onSlotSelected: () => void): void {
    globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
      // If clicking cancel, back out to title screen
      if (slotId === -1) {
        globalScene.phaseManager.toTitleScreen();
        this.end();
        return;
      }
      globalScene.sessionSlotId = slotId;

      onSlotSelected();
    });
  }

  /**
   * Compatibility entry point used by tests and helpers that bypass the starter UI.
   * @param starters - Array of {@linkcode Starter}s with which to start the battle
   */
  initBattle(starters: Starter[]): void {
    this.initPlayerStarters(starters, 0).then(() => this.beginBattle());
  }

  /**
   * Initialize starters for a player before starting the first battle.
   * @param starters - Array of {@linkcode Starter}s with which to start the battle
   */
  initPlayerStarters(starters: Starter[], playerIndex: PlayerIndex): Promise<void> {
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(playerIndex);
    } else {
      globalScene.setActivePlayerIndex(playerIndex);
    }
    const party = globalScene.getPlayerParty(playerIndex);
    party.splice(0, party.length);
    const loadPokemonAssets: Promise<void>[] = [];
    starters.forEach((starter: Starter, i: number) => {
      if (playerIndex === 0 && !i && activeOverrides.STARTER_SPECIES_OVERRIDE) {
        starter.speciesId = activeOverrides.STARTER_SPECIES_OVERRIDE;
      }
      const species = getPokemonSpecies(starter.speciesId);
      let starterFormIndex = starter.formIndex;
      if (
        starter.speciesId in activeOverrides.STARTER_FORM_OVERRIDES
        && activeOverrides.STARTER_FORM_OVERRIDES[starter.speciesId] != null
        && species.forms[activeOverrides.STARTER_FORM_OVERRIDES[starter.speciesId]!]
      ) {
        starterFormIndex = activeOverrides.STARTER_FORM_OVERRIDES[starter.speciesId]!;
      }

      let starterGender =
        species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
      if (activeOverrides.GENDER_OVERRIDE !== null) {
        starterGender = activeOverrides.GENDER_OVERRIDE;
      }
      const starterPokemon = globalScene.addPlayerPokemon(
        species,
        globalScene.gameMode.getStartingLevel(),
        starter.abilityIndex,
        starterFormIndex,
        starterGender,
        starter.shiny,
        starter.variant,
        starter.ivs,
        starter.nature,
      );
      if (globalScene.isComputerPartnerPlayer(playerIndex)) {
        const computerPartnerProfile = getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex));
        starterPokemon.computerPartnerAce = isComputerPartnerStarterAce(computerPartnerProfile, starter, i);
      }
      if (starter.moveset) {
        starterPokemon.tryPopulateMoveset(starter.moveset);
      }
      if (starter.passive) {
        starterPokemon.passive = true;
      }
      starterPokemon.luck = globalScene.gameData.getDexAttrLuck(
        globalScene.gameData.dexData[species.speciesId].caughtAttr,
      );
      if (starter.pokerus) {
        starterPokemon.pokerus = true;
      }

      if (starter.nickname) {
        starterPokemon.nickname = starter.nickname;
      }

      if (starter.teraType == null) {
        starterPokemon.teraType = starterPokemon.species.type1;
      } else {
        starterPokemon.teraType = starter.teraType;
      }

      if (globalScene.gameMode.isSplicedOnly || activeOverrides.STARTER_FUSION_OVERRIDE) {
        starterPokemon.generateFusionSpecies(true);
      }
      starterPokemon.setVisible(false);
      const chalApplied = applyChallenges(ChallengeType.STARTER_MODIFY, starterPokemon);
      party.push(starterPokemon);
      if (chalApplied) {
        // If any challenges modified the starter, it should update
        loadPokemonAssets.push(starterPokemon.updateInfo());
      }
      loadPokemonAssets.push(starterPokemon.loadAssets());
    });
    overrideModifiers();
    this.applyMultiplayerExpCharmBonus(playerIndex);
    overrideHeldItems(party[0]);
    return Promise.all(loadPokemonAssets).then(() => undefined);
  }

  private applyMultiplayerExpCharmBonus(playerIndex: PlayerIndex): void {
    if (!globalScene.twoPlayerMode) {
      return;
    }

    const expCharm = modifierTypes.EXP_CHARM().withIdFromFunc(modifierTypes.EXP_CHARM).newModifier();
    if (!(expCharm instanceof PersistentModifier)) {
      return;
    }

    expCharm.stackCount = globalScene.multiplayerPlayerCount >= 3 ? 2 : 1;
    globalScene.addModifier(expCharm, true, false, false, true, undefined, playerIndex);
  }

  private initComputerPartnerStarters(playerIndex: PlayerIndex): Promise<void> {
    const partnerKey = globalScene.getComputerPartnerKey(playerIndex);
    const profile = getComputerPartnerProfile(partnerKey);
    const hostGameData = globalScene.getPlayerGameData(0);
    const starters = createComputerPartnerStarter(profile, hostGameData.getComputerPartnerProgress(partnerKey));
    globalScene.savePlayerSystemSaveLocal(0);
    return this.initPlayerStarters(starters, playerIndex);
  }

  private waitForTwoPlayerProfilesBeforeAction(onReady: () => void): void {
    if (!globalScene.twoPlayerMode || globalScene.isTwoPlayerProfileExchangeComplete()) {
      onReady();
      return;
    }

    globalScene.waitForSharedInput();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      const waitingMessage =
        globalScene.multiplayerPlayerCount > 2
          ? "Waiting for all player profiles..."
          : "Waiting for both player profiles...";
      globalScene.ui.showText(waitingMessage, null, null, null, false);
      globalScene.uiInputs?.broadcastTwoPlayerProfileSnapshot();
      const profileRetryInterval = globalThis.setInterval(() => {
        if (globalScene.isTwoPlayerProfileExchangeComplete()) {
          globalThis.clearInterval(profileRetryInterval);
          return;
        }
        globalScene.uiInputs?.broadcastTwoPlayerProfileSnapshot();
      }, 1000);
      globalScene.waitForTwoPlayerProfileExchange().then(ready => {
        globalThis.clearInterval(profileRetryInterval);
        if (ready) {
          globalScene.ui.clearText();
          onReady();
          return;
        }

        const retryMessage =
          globalScene.multiplayerPlayerCount > 2
            ? "Still waiting for the other player profiles."
            : "Still waiting for the other player profile.";
        globalScene.ui.showText(retryMessage, null, () => this.waitForTwoPlayerProfilesBeforeAction(onReady));
      });
    });
  }

  private beginBattle(): void {
    if (globalScene.twoPlayerMode && !globalScene.isTwoPlayerProfileExchangeComplete()) {
      this.waitForTwoPlayerProfilesBeforeAction(() => this.beginBattle());
      return;
    }

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(0);
    } else {
      globalScene.setActivePlayerIndex(0);
    }
    audioManager.playBgm(undefined, true);
    if (globalScene.gameMode.isClassic) {
      globalScene.gameData.gameStats.classicSessionsPlayed++;
    } else {
      globalScene.gameData.gameStats.endlessSessionsPlayed++;
    }
    globalScene.newBattle();
    globalScene.arena.init();
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("new-battle-created");
    globalScene.sessionPlayTime = 0;
    globalScene.lastSavePlayTime = 0;

    const parties = globalScene.twoPlayerMode
      ? globalScene.players.flatMap(player => player.party)
      : globalScene.getPlayerParty();
    // Ensures Keldeo (or any future Pokemon that have this type of form change) starts in the correct form
    parties.forEach(p => {
      globalScene.triggerPokemonFormChange(p, SpeciesFormChangeMoveLearnedTrigger);
    });
    this.end();
  }
}
