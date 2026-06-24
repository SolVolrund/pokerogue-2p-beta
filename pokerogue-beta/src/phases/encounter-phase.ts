import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import type { PlayerIndex } from "#app/battle-scene";
import { PLAYER_PARTY_MAX_SIZE, WEIGHT_INCREMENT_ON_SPAWN_MISS } from "#app/constants";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { activeOverrides } from "#app/overrides";
import { handleTutorial, Tutorial } from "#app/tutorial";
import { initEncounterAnims, loadEncounterAnimAssets } from "#data/battle-anims";
import { getCharVariantFromDialogue, getClassicFinalBossDialogue } from "#data/dialogue";
import { getNatureName } from "#data/nature";
import { getTypeDamageMultiplier } from "#data/type";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BiomeId } from "#enums/biome-id";
import { FieldPosition } from "#enums/field-position";
import { MoveCategory } from "#enums/move-category";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { MysteryEncounterMode } from "#enums/mystery-encounter-mode";
import { PlayerGender } from "#enums/player-gender";
import { getPlayerTrainerSpriteName } from "#enums/player-trainer-sprite";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { EncounterPhaseEvent } from "#events/battle-scene";
import type { Pokemon } from "#field/pokemon";
import {
  BoostBugSpawnModifier,
  IvScannerModifier,
  overrideHeldItems,
  overrideModifiers,
  TurnHeldItemTransferModifier,
} from "#modifiers/modifier";
import { regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { doTrainerExclamation } from "#mystery-encounters/encounter-phase-utils";
import { getGoldenBugNetSpecies } from "#mystery-encounters/encounter-pokemon-utils";
import { BattlePhase } from "#phases/battle-phase";
import { achvs } from "#system/achv";
import { randSeedInt, randSeedItem } from "#utils/common";
import {
  getComputerPartnerCaptureDecisions,
  type ComputerPartnerCaptureDecision,
} from "#utils/computer-partner-capture-ai";
import { getComputerPartnerProfile } from "#utils/computer-partner-profile";
import { applyPersistentFieldBlessing } from "#utils/field-blessings";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import i18next from "i18next";

export class EncounterPhase extends BattlePhase {
  // Union type is necessary as this is subclassed, and typescript will otherwise complain
  public readonly phaseName: "EncounterPhase" | "NextEncounterPhase" | "NewBiomeEncounterPhase" = "EncounterPhase";

  private readonly loaded: boolean;

  constructor(loaded = false) {
    super();

    this.loaded = loaded;
  }

  private getClassicFinalBossArceusFormIndex(enemyPokemon: Pokemon): number {
    const playerParty = this.getLivingPlayerSidePokemon();
    const candidates = enemyPokemon.species.forms
      .map((form, formIndex) => ({ form, formIndex }))
      .filter(({ form }) => form.formKey !== "legend");

    if (!playerParty.length || !candidates.length) {
      return enemyPokemon.species.forms.findIndex(form => form.formKey === "normal");
    }

    const scoredCandidates = candidates.map(candidate => {
      const arceusType = candidate.form.type1;
      const weaknessCount = playerParty.filter(pokemon =>
        this.canPokemonHitSingleTypeSuperEffectively(pokemon, arceusType),
      ).length;
      const superEffectiveCount = playerParty.filter(pokemon =>
        this.canSingleTypeHitPokemonSuperEffectively(arceusType, pokemon),
      ).length;

      return { ...candidate, weaknessCount, superEffectiveCount };
    });

    const fewestWeaknesses = Math.min(...scoredCandidates.map(candidate => candidate.weaknessCount));
    const leastWeakCandidates = scoredCandidates.filter(candidate => candidate.weaknessCount === fewestWeaknesses);
    const mostSuperEffective = Math.max(...leastWeakCandidates.map(candidate => candidate.superEffectiveCount));
    const bestCandidates = leastWeakCandidates.filter(
      candidate => candidate.superEffectiveCount === mostSuperEffective,
    );

    return bestCandidates[randSeedInt(bestCandidates.length)].formIndex;
  }

  private getLivingPlayerSidePokemon(): Pokemon[] {
    const playerIndexes: PlayerIndex[] = globalScene.twoPlayerMode ? [0, 1] : [globalScene.activePlayerIndex];

    return playerIndexes
      .flatMap(playerIndex => globalScene.getPlayerParty(playerIndex))
      .filter(pokemon => !pokemon.isFainted());
  }

  private canPokemonHitSingleTypeSuperEffectively(pokemon: Pokemon, targetType: PokemonType): boolean {
    return pokemon.getMoveset().some(pokemonMove => {
      const move = pokemonMove.getMove();
      if (move.category === MoveCategory.STATUS) {
        return false;
      }

      const moveType = pokemon.getMoveType(move, true);
      return getTypeDamageMultiplier(moveType, targetType) > 1;
    });
  }

  private canSingleTypeHitPokemonSuperEffectively(attackType: PokemonType, pokemon: Pokemon): boolean {
    const multiplier = pokemon
      .getTypes({ includeTeraType: false, returnOriginalTypesIfStellar: true, ignoreThirdType: true })
      .reduce((total, type) => total * getTypeDamageMultiplier(attackType, type), 1);

    return multiplier > 1;
  }

  start() {
    super.start();

    globalScene.updateGameInfo();

    globalScene.initSession();

    globalScene.eventTarget.dispatchEvent(new EncounterPhaseEvent());

    // Failsafe if players somehow skip floor 200 in classic mode
    if (globalScene.gameMode.isClassic && globalScene.currentBattle.waveIndex > 200) {
      globalScene.phaseManager.unshiftNew("GameOverPhase");
    }

    const loadEnemyAssets: Promise<void>[] = [];

    const battle = globalScene.currentBattle;

    // Generate and Init Mystery Encounter
    if (battle.isBattleMysteryEncounter() && !battle.mysteryEncounter) {
      globalScene.executeWithSeedOffset(() => {
        const currentSessionEncounterType = battle.mysteryEncounterType;
        battle.mysteryEncounter = globalScene.getMysteryEncounter(currentSessionEncounterType);
      }, battle.waveIndex * 16);
    }
    const mysteryEncounter = battle.mysteryEncounter;
    if (mysteryEncounter) {
      // If ME has an onInit() function, call it
      // Usually used for calculating rand data before initializing anything visual
      // Also prepopulates any dialogue tokens from encounter/option requirements
      globalScene.executeWithSeedOffset(() => {
        if (mysteryEncounter.onInit) {
          mysteryEncounter.onInit();
        }
        mysteryEncounter.populateDialogueTokensFromRequirements();
      }, battle.waveIndex);

      // Add any special encounter animations to load
      if (mysteryEncounter.encounterAnimations && mysteryEncounter.encounterAnimations.length > 0) {
        loadEnemyAssets.push(
          initEncounterAnims(mysteryEncounter.encounterAnimations).then(() => loadEncounterAnimAssets(true)),
        );
      }

      // Add intro visuals for mystery encounter
      mysteryEncounter.initIntroVisuals();
      globalScene.field.add(mysteryEncounter.introVisuals!);
    }

    let totalBst = 0;

    battle.enemyLevels?.every((level, e) => {
      if (battle.isBattleMysteryEncounter()) {
        // Skip enemy loading for MEs, those are loaded elsewhere
        return false;
      }
      if (!this.loaded) {
        if (battle.battleType === BattleType.TRAINER) {
          battle.enemyParty[e] = battle.trainer?.genPartyMember(e)!; // TODO:: is the bang correct here?
        } else {
          let enemySpecies = globalScene.randomSpecies(battle.waveIndex, level, true);
          // If player has golden bug net, rolls 10% chance to replace non-boss wave wild species from the golden bug net bug pool
          if (
            globalScene.findModifier(m => m instanceof BoostBugSpawnModifier)
            && !globalScene.gameMode.isBoss(battle.waveIndex)
            && globalScene.arena.biomeId !== BiomeId.END
            && randSeedInt(10) === 0
          ) {
            enemySpecies = getGoldenBugNetSpecies(level);
          }
          battle.enemyParty[e] = globalScene.addEnemyPokemon(
            enemySpecies,
            level,
            TrainerSlot.NONE,
            !!globalScene.getEncounterBossSegments(battle.waveIndex, level, enemySpecies),
          );
          if (globalScene.currentBattle.isClassicFinalBoss) {
            battle.enemyParty[e].ivs.fill(31);
          }
          globalScene
            .getPlayerParty()
            .slice(0, battle.double ? 2 : 1)
            .reverse()
            .forEach(playerPokemon => {
              applyAbAttrs("SyncEncounterNatureAbAttr", { pokemon: playerPokemon, target: battle.enemyParty[e] });
            });
        }
      }
      const enemyPokemon = globalScene.getEnemyParty()[e];
      if (e < (battle.double ? 2 : 1)) {
        enemyPokemon.setX(-66 + enemyPokemon.getFieldPositionOffset()[0]);
        enemyPokemon.fieldSetup(true);
      }

      if (!this.loaded) {
        globalScene.gameData.setPokemonSeen(
          enemyPokemon,
          true,
          battle.battleType === BattleType.TRAINER
            || battle?.mysteryEncounter?.encounterMode === MysteryEncounterMode.TRAINER_BATTLE,
        );
      }

      if (enemyPokemon.species.speciesId === SpeciesId.ETERNATUS) {
        if (battle.isClassicFinalBoss) {
          enemyPokemon.setBoss();
        } else if (!(battle.waveIndex % 1000)) {
          enemyPokemon.formIndex = 1;
          enemyPokemon.updateScale();
        }
      }
      if (enemyPokemon.species.speciesId === SpeciesId.NECROZMA && battle.isClassicFinalBoss) {
        const phaseOneFormKey = randSeedInt(2) ? "dawn-wings" : "dusk-mane";
        const phaseOneFormIndex = enemyPokemon.species.forms.findIndex(form => form.formKey === phaseOneFormKey);
        if (phaseOneFormIndex > -1) {
          enemyPokemon.formIndex = phaseOneFormIndex;
          enemyPokemon.updateScale();
          enemyPokemon.generateAndPopulateMoveset(false, phaseOneFormIndex);
        }
        enemyPokemon.setBoss();
      }
      if (enemyPokemon.species.speciesId === SpeciesId.ARCEUS && battle.isClassicFinalBoss) {
        const phaseOneFormIndex = this.getClassicFinalBossArceusFormIndex(enemyPokemon);
        if (phaseOneFormIndex > -1) {
          enemyPokemon.formIndex = phaseOneFormIndex;
          enemyPokemon.updateScale();
          enemyPokemon.generateAndPopulateMoveset(false, phaseOneFormIndex);
        }
        enemyPokemon.setBoss();
      }

      totalBst += enemyPokemon.getSpeciesForm().baseTotal;

      loadEnemyAssets.push(enemyPokemon.loadAssets());

      const stats: string[] = [
        `HP: ${enemyPokemon.stats[0]} (${enemyPokemon.ivs[0]})`,
        ` Atk: ${enemyPokemon.stats[1]} (${enemyPokemon.ivs[1]})`,
        ` Def: ${enemyPokemon.stats[2]} (${enemyPokemon.ivs[2]})`,
        ` Spatk: ${enemyPokemon.stats[3]} (${enemyPokemon.ivs[3]})`,
        ` Spdef: ${enemyPokemon.stats[4]} (${enemyPokemon.ivs[4]})`,
        ` Spd: ${enemyPokemon.stats[5]} (${enemyPokemon.ivs[5]})`,
      ];
      const moveset: string[] = [];
      for (const move of enemyPokemon.getMoveset()) {
        moveset.push(move.getName());
      }

      console.log(
        `Pokemon: ${getPokemonNameWithAffix(enemyPokemon)}`,
        `| Species ID: ${enemyPokemon.species.speciesId}`,
        `| Level: ${enemyPokemon.level}`,
        `| Nature: ${getNatureName(enemyPokemon.nature, true, true, true)}`,
      );
      console.log(`Stats (IVs): ${stats}`);
      console.log(
        `Ability: ${enemyPokemon.getAbility().name}`,
        `| Passive Ability${enemyPokemon.hasPassive() ? "" : " (inactive)"}: ${enemyPokemon.getPassiveAbility().name}`,
        `${enemyPokemon.isBoss() ? `| Boss Bars: ${enemyPokemon.bossSegments}` : ""}`,
      );
      console.log("Moveset:", moveset);
      return true;
    });

    if (globalScene.getPlayerParty().filter(p => p.isShiny()).length === PLAYER_PARTY_MAX_SIZE) {
      globalScene.validateAchv(achvs.SHINY_PARTY);
    }

    if (battle.battleType === BattleType.TRAINER) {
      loadEnemyAssets.push(battle.trainer?.loadAssets().then(() => battle.trainer?.initSprite())!); // TODO: is this bang correct?
    } else if (battle.isBattleMysteryEncounter()) {
      if (battle.mysteryEncounter?.introVisuals) {
        loadEnemyAssets.push(
          battle.mysteryEncounter.introVisuals
            .loadAssets()
            .then(() => battle.mysteryEncounter!.introVisuals!.initSprite()),
        );
      }
      if (battle.mysteryEncounter?.loadAssets && battle.mysteryEncounter.loadAssets.length > 0) {
        loadEnemyAssets.push(...battle.mysteryEncounter.loadAssets);
      }
      // Load Mystery Encounter Exclamation bubble and sfx
      loadEnemyAssets.push(
        new Promise<void>(resolve => {
          globalScene
            .loadSe("GEN8- Exclaim", "battle_anims", "GEN8- Exclaim.wav")
            .loadImage("encounter_exclaim", "mystery-encounters");
          globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
          if (!globalScene.load.isLoading()) {
            globalScene.load.start();
          }
        }),
      );
    } else {
      const overridedBossSegments = activeOverrides.ENEMY_HEALTH_SEGMENTS_OVERRIDE > 1;
      // for double battles, reduce the health segments for boss Pokemon unless there is an override
      if (!overridedBossSegments && battle.enemyParty.filter(p => p.isBoss()).length > 1) {
        for (const enemyPokemon of battle.enemyParty) {
          // If the enemy pokemon is a boss and wasn't populated from data source, then update the number of segments
          if (enemyPokemon.isBoss() && !enemyPokemon.isPopulatedFromDataSource) {
            enemyPokemon.setBoss(
              true,
              Math.ceil(enemyPokemon.bossSegments * (enemyPokemon.getSpeciesForm().baseTotal / totalBst)),
            );
            enemyPokemon.initBattleInfo();
          }
        }
      }
    }

    Promise.all(loadEnemyAssets).then(() => {
      battle.enemyParty.every((enemyPokemon, e) => {
        if (battle.isBattleMysteryEncounter()) {
          return false;
        }
        if (e < (battle.double ? 2 : 1)) {
          if (battle.battleType === BattleType.WILD) {
            for (const pokemon of globalScene.getField()) {
              applyAbAttrs("PreSummonAbAttr", { pokemon });
            }
            globalScene.field.add(enemyPokemon);
            battle.seenEnemyPartyMemberIds.add(enemyPokemon.id);
            const playerPokemon = globalScene.getPlayerPokemon();
            if (playerPokemon?.isOnField()) {
              globalScene.field.moveBelow(enemyPokemon as Pokemon, playerPokemon);
            }
            enemyPokemon.tint(0, 0.5);
          } else if (battle.battleType === BattleType.TRAINER) {
            enemyPokemon.setVisible(false);
            globalScene.currentBattle.trainer?.tint(0, 0.5);
          }
          if (battle.double) {
            enemyPokemon.setFieldPosition(e ? FieldPosition.RIGHT : FieldPosition.LEFT);
          }
        }
        return true;
      });

      if (!this.loaded && battle.battleType !== BattleType.MYSTERY_ENCOUNTER) {
        // generate modifiers for MEs, overriding prior ones as applicable
        regenerateModifierPoolThresholds(
          globalScene.getEnemyField(),
          battle.battleType === BattleType.TRAINER ? ModifierPoolType.TRAINER : ModifierPoolType.WILD,
        );
        globalScene.generateEnemyModifiers();
        overrideModifiers(false);

        for (const enemy of globalScene.getEnemyField()) {
          overrideHeldItems(enemy, false);
        }
      }

      if (battle.battleType === BattleType.TRAINER && globalScene.currentBattle.trainer) {
        globalScene.currentBattle.trainer.genAI(globalScene.getEnemyParty());
      }

      globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        if (this.loaded) {
          this.doEncounter();
          globalScene.resetSeed();
        } else {
          // Set weather and terrain before session gets saved
          this.trySetWeatherIfNewBiome();
          this.trySetTerrainIfNewBiome();
          applyPersistentFieldBlessing();
          // Game syncs to server on waves X1 and X6 (As of 1.2.0)
          globalScene.gameData
            .saveAll(true, battle.waveIndex % 5 === 1 || (globalScene.lastSavePlayTime ?? 0) >= 300)
            .then(success => {
              globalScene.disableMenu = false;
              if (!success) {
                return globalScene.reset(true);
              }
              this.doEncounter();
              globalScene.resetSeed();
            });
        }
      });
    });
  }

  private incrementMysteryEncounterChance(): void {
    const { battleType, waveIndex } = globalScene.currentBattle;
    if (
      globalScene.isMysteryEncounterValidForWave(battleType, waveIndex)
      && !globalScene.currentBattle.isBattleMysteryEncounter()
    ) {
      // Increment ME spawn chance if an ME could have spawned but did not
      // Only do this AFTER session has been saved to avoid duplicating increments
      globalScene.mysteryEncounterSaveData.encounterSpawnChance += WEIGHT_INCREMENT_ON_SPAWN_MISS;
    }
  }

  protected doEncounter(): void {
    audioManager.playBgm(undefined, true);
    globalScene.updateModifiers(false);
    globalScene.setFieldScale(1);

    for (const pokemon of globalScene.getPlayerParty()) {
      // Currently, a new wave is not considered a new battle if there is no arena reset
      // Therefore, we only reset wave data here
      if (pokemon) {
        pokemon.resetWaveData();
      }
    }

    const enemyField = globalScene.getEnemyField();
    globalScene.tweens.add({
      targets: [
        globalScene.arenaEnemy,
        globalScene.currentBattle.trainer,
        enemyField,
        globalScene.arenaPlayer,
        globalScene.trainer,
      ].flat(),
      x: (_target, _key, value, fieldIndex: number) => (fieldIndex < 2 + enemyField.length ? value + 300 : value - 300),
      duration: 2000,
      onComplete: () => {
        if (globalScene.currentBattle.isClassicFinalBoss) {
          this.displayFinalBossDialogue();
        } else {
          this.doEncounterCommon();
        }
      },
    });

    const encounterIntroVisuals = globalScene.currentBattle?.mysteryEncounter?.introVisuals;
    if (encounterIntroVisuals) {
      const enterFromRight = encounterIntroVisuals.enterFromRight;
      if (enterFromRight) {
        encounterIntroVisuals.x += 500;
      }
      globalScene.tweens.add({
        targets: encounterIntroVisuals,
        x: enterFromRight ? "-=200" : "+=300",
        duration: 2000,
      });
    }
  }

  getEncounterMessage(): string {
    const enemyField = globalScene.getEnemyField();

    if (globalScene.currentBattle.isClassicFinalBoss) {
      return i18next.t("battle:bossAppeared", {
        bossName: getPokemonNameWithAffix(enemyField[0]),
      });
    }

    if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
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
          pokemonName: enemyField[0].getNameToRender(),
        })
      : i18next.t("battle:multiWildAppeared", {
          pokemonName1: enemyField[0].getNameToRender(),
          pokemonName2: enemyField[1].getNameToRender(),
        });
  }

  getComputerPartnerCaptureAnnouncement(): { message: string; decisions: ComputerPartnerCaptureDecision[] } | undefined {
    if (!globalScene.twoPlayerComputerPartner || globalScene.currentBattle.battleType !== BattleType.WILD) {
      return undefined;
    }

    const partnerPokemon = globalScene
      .getPlayerField(true)
      .find(pokemon => globalScene.getPlayerIndexForPokemon(pokemon) === 1);
    if (!partnerPokemon) {
      return undefined;
    }

    const captureDecisions = getComputerPartnerCaptureDecisions(
      globalScene.computerPartnerKey,
      globalScene.getPlayerParty(1),
      partnerPokemon,
      globalScene.getEnemyField(),
      globalScene.getPlayerPokeballCounts(1),
    );

    if (!captureDecisions.length) {
      return undefined;
    }

    const profile = getComputerPartnerProfile(globalScene.computerPartnerKey);
    const targetNames = captureDecisions.map(decision => decision.target.getNameToRender());
    const targetText =
      targetNames.length === 1
        ? targetNames[0]
        : `${targetNames.slice(0, -1).join(", ")} and ${targetNames[targetNames.length - 1]}`;
    return {
      message: `${profile.name} wants to capture ${targetText}.`,
      decisions: captureDecisions,
    };
  }

  showComputerPartnerCapturePrompt(
    announcement: { message: string; decisions: ComputerPartnerCaptureDecision[] },
    onComplete: () => void,
  ): void {
    const enemyField = globalScene.getEnemyField();
    const setReservedCaptureTarget = (targetId: number) => {
      globalScene.currentBattle.computerPartnerReservedCaptureTargetId = targetId;
      onComplete();
      return true;
    };
    const options: OptionSelectItem[] = announcement.decisions.map(decision => {
      const targetName = decision.target.getNameToRender();
      const sideLabel = enemyField.length > 1 ? `${decision.targetIndex === 0 ? "left" : "right"} ` : "";
      return {
        label: `Can I take ${sideLabel}${targetName}?`,
        handler: () => setReservedCaptureTarget(decision.target.id),
      };
    });
    const partnerTargetIds = new Set(announcement.decisions.map(decision => decision.target.id));
    if (enemyField.length > 1) {
      enemyField.forEach((pokemon, targetIndex) => {
        if (!pokemon.isActive(true) || pokemon.isFainted() || partnerTargetIds.has(pokemon.id)) {
          return;
        }

        const targetName = pokemon.getNameToRender();
        const sideLabel = targetIndex === 0 ? "left" : "right";
        options.push({
          label: `Okay, I'll take ${sideLabel} ${targetName}.`,
          handler: () => setReservedCaptureTarget(pokemon.id),
        });
      });
    }
    options.push({
      label: "Go for it",
      handler: () => {
        globalScene.currentBattle.computerPartnerReservedCaptureTargetId = undefined;
        onComplete();
        return true;
      },
    });

    const config: OptionSelectConfig = {
      options,
      noCancel: true,
    };

    globalScene.waitForPlayerInput(0);
    globalScene.ui.showText(announcement.message, null, () => {
      globalScene.ui.setMode(UiMode.OPTION_SELECT, config);
    }, 0, true);
  }

  doEncounterCommon(showEncounterMessage = true) {
    this.incrementMysteryEncounterChance();

    const enemyField = globalScene.getEnemyField();

    if (globalScene.currentBattle.battleType === BattleType.WILD) {
      for (const enemyPokemon of enemyField) {
        enemyPokemon.untint(100, "Sine.easeOut");
        enemyPokemon.cry();
        enemyPokemon.showInfo();
        if (enemyPokemon.isShiny()) {
          globalScene.validateAchv(achvs.SEE_SHINY);
        }
      }
      globalScene.updateFieldScale();
      const showPartnerCaptureAnnouncement = () => {
        const partnerCaptureAnnouncement = this.getComputerPartnerCaptureAnnouncement();
        if (partnerCaptureAnnouncement) {
          this.showComputerPartnerCapturePrompt(partnerCaptureAnnouncement, () => this.end());
        } else {
          this.end();
        }
      };
      if (showEncounterMessage) {
        globalScene.ui.showText(this.getEncounterMessage(), null, showPartnerCaptureAnnouncement, 1500);
      } else {
        showPartnerCaptureAnnouncement();
      }
    } else if (globalScene.currentBattle.battleType === BattleType.TRAINER) {
      const trainer = globalScene.currentBattle.trainer;
      trainer?.untint(100, "Sine.easeOut");
      trainer?.playAnim();

      const doSummon = () => {
        globalScene.currentBattle.started = true;
        audioManager.playBgm(undefined);
        globalScene.pbTray.showPbTray(globalScene.getPlayerParty());
        globalScene.pbTrayEnemy.showPbTray(globalScene.getEnemyParty());
        const doTrainerSummon = () => {
          this.hideEnemyTrainer();
          const availablePartyMembers = globalScene.getEnemyParty().filter(p => !p.isFainted()).length;
          globalScene.phaseManager.unshiftNew("SummonPhase", 0, false);
          if (globalScene.currentBattle.double && availablePartyMembers > 1) {
            globalScene.phaseManager.unshiftNew("SummonPhase", 1, false);
          }
          this.end();
        };
        if (showEncounterMessage) {
          globalScene.ui.showText(this.getEncounterMessage(), null, doTrainerSummon, 1500, true);
        } else {
          doTrainerSummon();
        }
      };

      const encounterMessages = trainer?.getEncounterMessages() ?? [];

      if (encounterMessages.length === 0) {
        doSummon();
      } else {
        let message = "";
        globalScene.executeWithSeedOffset(
          () => (message = randSeedItem(encounterMessages)),
          globalScene.currentBattle.waveIndex,
        );
        const showDialogueAndSummon = () => {
          globalScene.ui.showDialogue(message, trainer?.getName(TrainerSlot.NONE, true), null, () => {
            globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => doSummon()));
          });
        };
        if (trainer?.config.hasCharSprite && !globalScene.ui.shouldSkipDialogue(message)) {
          globalScene
            .showFieldOverlay(500)
            .then(() =>
              globalScene.charSprite
                .showCharacter(trainer.getKey()!, getCharVariantFromDialogue(encounterMessages[0]))
                .then(() => showDialogueAndSummon()),
            ); // TODO: is this bang correct?
        } else {
          showDialogueAndSummon();
        }
      }
    } else if (globalScene.currentBattle.isBattleMysteryEncounter() && globalScene.currentBattle.mysteryEncounter) {
      const encounter = globalScene.currentBattle.mysteryEncounter;
      const introVisuals = encounter.introVisuals;
      introVisuals?.playAnim();

      if (encounter.onVisualsStart) {
        encounter.onVisualsStart();
      } else if (encounter.spriteConfigs && introVisuals) {
        // If the encounter doesn't have any special visual intro, show sparkle for shiny Pokemon
        introVisuals.playShinySparkles();
      }

      const doEncounter = () => {
        const doShowEncounterOptions = () => {
          globalScene.ui.clearText();
          globalScene.ui.getMessageHandler().hideNameText();

          globalScene.phaseManager.unshiftNew("MysteryEncounterPhase");
          this.end();
        };

        const introDialogue = encounter.dialogue.intro;
        if (showEncounterMessage && introDialogue) {
          const FIRST_DIALOGUE_PROMPT_DELAY = 750;
          let i = 0;
          const showNextDialogue = () => {
            const nextAction = i === introDialogue.length - 1 ? doShowEncounterOptions : showNextDialogue;
            const dialogue = introDialogue[i];
            const title = getEncounterText(dialogue?.speaker);
            const text = getEncounterText(dialogue.text)!;
            i++;
            if (title) {
              globalScene.ui.showDialogue(text, title, null, nextAction, 0, i === 1 ? FIRST_DIALOGUE_PROMPT_DELAY : 0);
            } else {
              globalScene.ui.showText(text, null, nextAction, i === 1 ? FIRST_DIALOGUE_PROMPT_DELAY : 0, true);
            }
          };

          if (introDialogue.length > 0) {
            showNextDialogue();
          }
        } else {
          doShowEncounterOptions();
        }
      };

      const encounterMessage = i18next.t("battle:mysteryEncounterAppeared");

      if (encounterMessage) {
        doTrainerExclamation();
        globalScene.ui.showDialogue(encounterMessage, "???", null, () => {
          globalScene.charSprite.hide().then(() => globalScene.hideFieldOverlay(250).then(() => doEncounter()));
        });
      } else {
        doEncounter();
      }
    }
  }

  end() {
    const enemyField = globalScene.getEnemyField();

    enemyField.forEach((enemyPokemon, e) => {
      if (enemyPokemon.isShiny(true)) {
        globalScene.phaseManager.unshiftNew("ShinySparklePhase", BattlerIndex.ENEMY + e);
      }
      /** This sets Eternatus' held item to be untransferrable, preventing it from being stolen */
      if (
        enemyPokemon.species.speciesId === SpeciesId.ETERNATUS
        && (globalScene.gameMode.isBattleClassicFinalBoss(globalScene.currentBattle.waveIndex)
          || globalScene.gameMode.isEndlessMajorBoss(globalScene.currentBattle.waveIndex))
      ) {
        const enemyMBH = globalScene.findModifier(
          m => m instanceof TurnHeldItemTransferModifier,
          false,
        ) as TurnHeldItemTransferModifier;
        if (enemyMBH) {
          globalScene.removeModifier(enemyMBH, true);
          enemyMBH.setTransferrableFalse();
          globalScene.addEnemyModifier(enemyMBH);
        }
      }
    });

    if (![BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER].includes(globalScene.currentBattle.battleType)) {
      enemyField.forEach((pokemon, index) => {
        const ivScannerModifier = globalScene.twoPlayerMode
          ? globalScene.findModifierForPlayer(m => m instanceof IvScannerModifier, (index % 2) as PlayerIndex)
          : globalScene.findModifier(m => m instanceof IvScannerModifier);
        if (ivScannerModifier) {
          globalScene.phaseManager.pushNew("ScanIvsPhase", pokemon.getBattlerIndex());
        }
      });
    }

    if (!this.loaded) {
      if (globalScene.twoPlayerMode) {
        const p1AvailablePartyMembers = globalScene.getPokemonAllowedInBattle(0);
        const p2AvailablePartyMembers = globalScene.getPokemonAllowedInBattle(1);

        if (p1AvailablePartyMembers[0] && !p1AvailablePartyMembers[0].isOnField()) {
          globalScene.phaseManager.pushNew("SummonPhase", 0);
        }
        if (p2AvailablePartyMembers[0] && !p2AvailablePartyMembers[0].isOnField()) {
          globalScene.phaseManager.pushNew("SummonPhase", 1);
        }

        if (
          globalScene.currentBattle.battleType !== BattleType.TRAINER
          && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        ) {
          if (p1AvailablePartyMembers.length > 1) {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, true);
          }
          if (p2AvailablePartyMembers.length > 1) {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", 1, true);
          }
        }
      } else {
        const availablePartyMembers = globalScene.getPokemonAllowedInBattle();

        if (!availablePartyMembers[0].isOnField()) {
          globalScene.phaseManager.pushNew("SummonPhase", 0);
        }

        if (globalScene.currentBattle.double) {
          if (availablePartyMembers.length > 1) {
            globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", true);
            if (!availablePartyMembers[1].isOnField()) {
              globalScene.phaseManager.pushNew("SummonPhase", 1);
            }
          }
        } else {
          if (availablePartyMembers.length > 1 && availablePartyMembers[1].isOnField()) {
            globalScene.phaseManager.pushNew("ReturnPhase", 1);
          }
          globalScene.phaseManager.pushNew("ToggleDoublePositionPhase", false);
        }

        if (
          globalScene.currentBattle.battleType !== BattleType.TRAINER
          && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
        ) {
          const minPartySize = globalScene.currentBattle.double ? 2 : 1;
          if (availablePartyMembers.length > minPartySize) {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", 0, globalScene.currentBattle.double);
            if (globalScene.currentBattle.double) {
              globalScene.phaseManager.pushNew("CheckSwitchPhase", 1, globalScene.currentBattle.double);
            }
          }
        }
      }
    }
    handleTutorial(Tutorial.ACCESS_MENU).then(() => super.end());

    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("encounter-generated");
    globalScene.phaseManager.pushNew("InitEncounterPhase");
  }

  protected displayFinalBossDialogue(): void {
    const { gameData, ui } = globalScene;
    const enemy = globalScene.getEnemyPokemon();

    ui.showText(
      this.getEncounterMessage(),
      null,
      () => {
        const localizationKey = getClassicFinalBossDialogue(enemy?.species.speciesId).encounter;
        if (ui.shouldSkipDialogue(localizationKey)) {
          // Logging mirrors logging found in dialogue-ui-handler
          console.log(`Dialogue ${localizationKey} skipped`);
          this.doEncounterCommon(false);
        } else {
          const count = 5643853 + gameData.gameStats.classicSessionsPlayed;
          // The line below checks if an English ordinal is necessary or not based on whether an entry for encounterLocalizationKey exists in the language or not.
          const ordinalUsed =
            !i18next.exists(localizationKey, { fallbackLng: [] }) || i18next.resolvedLanguage === "en"
              ? i18next.t("battleSpecDialogue:key", {
                  count,
                  ordinal: true,
                })
              : "";
          const cycleCount = count.toLocaleString() + ordinalUsed;
          const cycleCountNoOrdinal = count.toLocaleString();
          const genderIndex = gameData.gender ?? PlayerGender.UNSET;
          const genderStr = PlayerGender[genderIndex].toLowerCase();
          const encounterDialogue = i18next.t(localizationKey, {
            context: genderStr,
            cycleCount,
            cycleCountNoOrdinal,
            playerName: getPlayerTrainerSpriteName(globalScene.getTrainerSprite(0)),
          });
          if (!gameData.getSeenDialogues()[localizationKey]) {
            gameData.saveSeenDialogue(localizationKey);
          }
          ui.showDialogue(encounterDialogue, enemy?.species.name, null, () => {
            this.doEncounterCommon(false);
          });
        }
      },
      1500,
      true,
    );
  }

  /**
   * Set biome weather if and only if this encounter is the start of a new biome.
   * @remarks
   * By using function overrides, this should happen if and only if this phase
   * is exactly a `NewBiomeEncounterPhase` or an `EncounterPhase` (to account for
   * Wave 1 of a Daily Run), but NOT `NextEncounterPhase` (which starts the next
   * wave in the same biome).
   */
  protected trySetWeatherIfNewBiome(): void {
    globalScene.arena.setBiomeWeather();
  }

  /**
   * Set biome terrain if and only if this encounter is the start of a new biome.
   * @remarks
   * By using function overrides, this should happen if and only if this phase
   * is exactly a `NewBiomeEncounterPhase` or an `EncounterPhase` (to account for
   * Wave 1 of a Daily Run), but NOT `NextEncounterPhase` (which starts the next
   * wave in the same biome).
   */
  protected trySetTerrainIfNewBiome(): void {
    globalScene.arena.setBiomeTerrain();
  }
}
