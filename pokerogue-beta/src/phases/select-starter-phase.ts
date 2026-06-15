import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { Phase } from "#app/phase";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { ChallengeType } from "#enums/challenge-type";
import { UiMode } from "#enums/ui-mode";
import { overrideHeldItems, overrideModifiers } from "#modifiers/modifier";
import type { Starter } from "#types/save-data";
import { SaveSlotUiMode } from "#ui/handlers/save-slot-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";

export class SelectStarterPhase extends Phase {
  public readonly phaseName = "SelectStarterPhase";
  start() {
    super.start();

    audioManager.playBgm("menu");
    globalScene.setActivePlayerIndex(0);

    this.selectStartersForPlayer(0);
  }

  private selectStartersForPlayer(playerIndex: 0 | 1): void {
    globalScene.setActivePlayerIndex(playerIndex);
    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      globalScene.ui.clearText();
      if (globalScene.twoPlayerMode) {
        this.initPlayerStarters(starters, playerIndex).then(() => {
          if (playerIndex === 0) {
            globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
              globalScene.ui.showText("Player 2, choose your starters.", null, () => this.selectStartersForPlayer(1));
            });
            return;
          }

          globalScene.setActivePlayerIndex(0);
          this.selectSaveSlot(() => this.beginBattle());
        });
        return;
      }

      this.selectSaveSlot(() => this.initPlayerStarters(starters, 0).then(() => this.beginBattle()));
    });
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
  initPlayerStarters(starters: Starter[], playerIndex: 0 | 1): Promise<void> {
    globalScene.setActivePlayerIndex(playerIndex);
    const party = globalScene.getPlayerParty(playerIndex);
    party.splice(0, party.length);
    const loadPokemonAssets: Promise<void>[] = [];
    starters.forEach((starter: Starter, i: number) => {
      if (!i && activeOverrides.STARTER_SPECIES_OVERRIDE) {
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
    overrideHeldItems(party[0]);
    return Promise.all(loadPokemonAssets).then(() => undefined);
  }

  private beginBattle(): void {
    globalScene.setActivePlayerIndex(0);
    audioManager.playBgm(undefined, true);
    if (globalScene.gameMode.isClassic) {
      globalScene.gameData.gameStats.classicSessionsPlayed++;
    } else {
      globalScene.gameData.gameStats.endlessSessionsPlayed++;
    }
    globalScene.newBattle();
    globalScene.arena.init();
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
