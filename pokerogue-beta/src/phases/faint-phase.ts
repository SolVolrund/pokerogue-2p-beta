import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import type { PlayerIndex } from "#app/battle-scene";
import { FRIENDSHIP_LOSS_FROM_FAINT } from "#balance/starters";
import { allMoves, modifierTypes } from "#data/data-lists";
import { getClassicFinalBossDialogue, getUnownRealFinalBossDialogue } from "#data/dialogue";
import { SpeciesFormChangeActiveTrigger, SpeciesFormChangeManualTrigger } from "#data/form-change-triggers";
import { SpeciesFormChange } from "#data/pokemon-forms";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import { DEFAULT_CRYSTAL_COLOR, type EnemyPokemon, type PlayerPokemon, type Pokemon } from "#field/pokemon";
import {
  BaseStatModifier,
  BerserkGeneModifier,
  PokemonHeldItemModifier,
  PokemonInstantReviveModifier,
  ShinyBadgeModifier,
} from "#modifiers/modifier";
import { ModifierTypeGenerator } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import { handleMysteryEncounterBattleFailed } from "#mystery-encounters/encounter-phase-utils";
import { PokemonPhase } from "#phases/pokemon-phase";
import {
  CLASSIC_FINAL_BOSS_MULTIPLAYER_SCALING_STATS,
  CLASSIC_FINAL_BOSS_VITAMIN_STACKS_PER_EXTRA_PLAYER,
  getMewtwoFinalBossLaneByPokemonId,
  getNextUnownFinalBossHelperSpeciesId,
  getUnownFinalBossHelperSlot,
  isClassicFinalBossPhaseTwo,
  type MewtwoFinalBossLaneState,
  isMewtwoFinalBossBoss,
  isUnownRealFinalBossWave,
} from "#utils/classic-final-boss-utils";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import { areHeldItemEffectsSuppressed } from "#utils/held-item-suppression-state";
import { inSpeedOrder } from "#utils/speed-order-generator";
import i18next from "i18next";

const MEWTWO_ARMORED_FORM_KEY = "armored";
type MewtwoFinalBossFinalFormKey =
  | SpeciesFormKey.MEGA_X
  | SpeciesFormKey.MEGA_Y
  | typeof MEWTWO_ARMORED_FORM_KEY;

export class FaintPhase extends PokemonPhase {
  public readonly phaseName = "FaintPhase";
  /**
   * Whether or not instant revive should be prevented
   */
  private readonly preventInstantRevive: boolean;

  /**
   * The source Pokemon that dealt fatal damage; only present for faints triggered by a move.
   */
  // TODO: This should be handled by a move in flight object/similar
  private readonly source?: Pokemon | undefined;

  constructor(battlerIndex: BattlerIndex, preventInstantRevive = false, source?: Pokemon) {
    super(battlerIndex);

    this.preventInstantRevive = preventInstantRevive;
    this.source = source;
  }

  public override start(): void {
    super.start();

    const faintPokemon = this.getFaintPokemon();
    if (!faintPokemon) {
      this.end();
      return;
    }
    // Failsafe: end early if the Pokemon is somehow not fainted at this point
    // (such as if the original faintee switched out via U-Turn/etc before this Phase had a chance to run).
    // TODO: This effectively bypasses the root phase ordering issue at play, and should be removed once force switching moves are fixed to work properly
    if (faintPokemon.hp > 0) {
      this.end();
      return;
    }
    if (this.source) {
      faintPokemon.getTag(BattlerTagType.DESTINY_BOND)?.lapse(this.source, BattlerTagLapseType.CUSTOM);
      faintPokemon.getTag(BattlerTagType.GRUDGE)?.lapse(faintPokemon, BattlerTagLapseType.CUSTOM, this.source);
    }

    if (globalScene.currentBattle.mysteryEncounter?.onPokemonFaint?.(faintPokemon, this.source)) {
      this.end();
      return;
    }

    const heldItemsSuppressed = areHeldItemEffectsSuppressed(faintPokemon);
    faintPokemon.resetSummonData();

    const shinyBadgeModifier =
      !heldItemsSuppressed
      && globalScene.applyModifierForPokemon(ShinyBadgeModifier, faintPokemon, faintPokemon, "revive");

    if (shinyBadgeModifier) {
      this.end();
      return;
    }

    if (!this.preventInstantRevive && !heldItemsSuppressed) {
      const instantReviveModifier = globalScene.applyModifier(
        PokemonInstantReviveModifier,
        this.player,
        faintPokemon,
      ) as PokemonInstantReviveModifier;

      if (instantReviveModifier) {
        faintPokemon.loseHeldItem(instantReviveModifier);
        globalScene.updateModifiers(this.player);
        this.end();
        return;
      }
    }

    /**
     * In case the current pokemon was just switched in, make sure it is counted as participating in the combat.
     * For EXP_SHARE purposes, if the current pokemon faints as the combat ends and it was the ONLY player pokemon
     * involved in combat, it needs to be counted as a participant so the other party pokemon can get their EXP,
     * so the fainted pokemon has been included.
     */
    for (const pokemon of globalScene.getPlayerField()) {
      if (pokemon?.isActive() || pokemon?.isFainted()) {
        globalScene.currentBattle.addParticipant(pokemon);
      }
    }

    if (globalScene.currentBattle.isClassicFinalBoss && !this.player) {
      this.handleFinalBossFaint();
    } else {
      this.doFaint();
    }
  }

  private doFaint(): void {
    const pokemon = this.getFaintPokemon();
    if (!pokemon) {
      this.end();
      return;
    }

    // Track total times pokemon have been KO'd for Last Respects/Supreme Overlord
    if (pokemon.isPlayer()) {
      globalScene.arena.playerFaints += 1;
      globalScene.currentBattle.playerFaintsHistory.push({
        pokemon,
        turn: globalScene.currentBattle.turn,
      });
    } else {
      globalScene.currentBattle.enemyFaints += 1;
      globalScene.currentBattle.enemyFaintsHistory.push({
        pokemon,
        turn: globalScene.currentBattle.turn,
      });
    }

    globalScene.phaseManager.queueMessage(
      i18next.t("battle:fainted", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
      }),
      null,
      true,
    );
    globalScene.triggerPokemonFormChange(pokemon, SpeciesFormChangeActiveTrigger, true);

    pokemon.resetTera();

    // TODO: this can be simplified by just checking whether lastAttack is defined
    if (pokemon.turnData.attacksReceived?.length > 0) {
      const lastAttack = pokemon.turnData.attacksReceived[0];
      applyAbAttrs("PostFaintAbAttr", {
        pokemon,
        // TODO: We should refactor lastAttack's sourceId to forbid null and just use undefined
        attacker: globalScene.getPokemonById(lastAttack.sourceId) ?? undefined,
        // TODO: improve the way that we provide the move that knocked out the pokemon...
        move: new PokemonMove(lastAttack.move).getMove(),
      }); // TODO: is this bang correct?
    } else {
      //If killed by indirect damage, apply post-faint abilities without providing a last move
      applyAbAttrs("PostFaintAbAttr", { pokemon });
    }

    for (const p of inSpeedOrder(ArenaTagSide.BOTH)) {
      applyAbAttrs("PostKnockOutAbAttr", { pokemon: p, victim: pokemon });
    }
    if (pokemon.turnData.attacksReceived?.length > 0) {
      const defeatSource = this.source;

      if (defeatSource?.isOnField()) {
        applyAbAttrs("PostVictoryAbAttr", { pokemon: defeatSource });
        const pvmove = allMoves[pokemon.turnData.attacksReceived[0].move];
        const pvattrs = pvmove.getAttrs("PostVictoryStatStageChangeAttr");
        if (pvattrs.length > 0) {
          for (const pvattr of pvattrs) {
            pvattr.applyPostVictory(defeatSource, defeatSource, pvmove);
          }
        }
      }
    }

    const eonFluteGuestOwner = pokemon.isPlayer() ? globalScene.getEonFluteGuestOwner(pokemon) : undefined;
    if (eonFluteGuestOwner !== undefined) {
      const lostMessageKey = globalScene.isLegendaryHelperGuest(pokemon)
        ? "battle:glassBallLost"
        : "battle:eonFluteLost";
      globalScene.consumeEonFlute(eonFluteGuestOwner);
      globalScene.phaseManager.queueMessage(i18next.t(lostMessageKey), null, true);
    }

    if (this.player) {
      const playerIndex =
        globalScene.getPlayerIndexForPokemon(pokemon) ?? globalScene.getPlayerIndexForFieldSlot(this.fieldIndex);
      /** The total number of Pokemon in the player's party that can legally fight */
      const legalPlayerPokemon = globalScene.getPokemonAllowedInBattle(playerIndex);
      /** The total number of legal player Pokemon that aren't currently on the field */
      const legalPlayerPartyPokemon = legalPlayerPokemon.filter(p => !p.isActive(true));
      if (legalPlayerPokemon.length === 0) {
        if (globalScene.hasEonFluteProtection(playerIndex)) {
          globalScene.phaseManager.pushNew("EonFluteSummonPhase", playerIndex);
        } else if (globalScene.queueVsModeVictoryIfDecided()) {
          // Let the faint animation and field cleanup below finish before the Vs win phase runs.
        } else if (globalScene.queueVsModeTrainerRoundEndIfPlayerDefeated(playerIndex)) {
          // In 3P Vs trainer battles, a defeated lane ends the current round so surviving players can reach rewards.
        } else if (globalScene.areAllActivePlayersOutOfUsablePokemon()) {
          /** If every active player is out of legal Pokemon, end the game. */
          globalScene.phaseManager.unshiftNew("GameOverPhase");
        } else if (
          globalScene.currentBattle.battleType === BattleType.MYSTERY_ENCOUNTER
          && globalScene.areAllPlayerFieldOwnersOutOfUsablePokemon()
        ) {
          globalScene.phaseManager.clearPhaseQueue(true);
          handleMysteryEncounterBattleFailed();
        }
      } else if (
        !globalScene.twoPlayerMode
        && globalScene.currentBattle.double
        && legalPlayerPokemon.length === 1
        && legalPlayerPartyPokemon.length === 0
      ) {
        /**
         * If the player has exactly one Pokemon in total at this point in a double battle, and that Pokemon
         * is already on the field, unshift a phase that moves that Pokemon to center position.
         */
        globalScene.phaseManager.unshiftNew("ToggleDoublePositionPhase", true);
      } else if (legalPlayerPartyPokemon.length > 0) {
        /**
         * If previous conditions weren't met, and the player has at least 1 legal Pokemon off the field,
         * push a phase that prompts the player to summon a Pokemon from their party.
         */
        globalScene.phaseManager.pushNew("SwitchPhase", SwitchType.SWITCH, this.fieldIndex, true, false);
      }
    } else {
      globalScene.phaseManager.unshiftNew("VictoryPhase", this.battlerIndex);
      if ([BattleType.TRAINER, BattleType.MYSTERY_ENCOUNTER].includes(globalScene.currentBattle.battleType)) {
        const hasReservePartyMember =
          globalScene
            .getEnemyParty()
            .filter(p => p.isActive() && !p.isOnField() && p.trainerSlot === (pokemon as EnemyPokemon).trainerSlot)
            .length > 0;
        if (hasReservePartyMember) {
          globalScene.phaseManager.pushNew("SwitchSummonPhase", SwitchType.SWITCH, this.fieldIndex, -1, false, false);
        }
      }
    }

    // in double battles redirect potential moves off fainted pokemon
    const allyPokemon = pokemon.getAlly();
    if (globalScene.currentBattle.double && allyPokemon != null) {
      globalScene.redirectPokemonMoves(pokemon, allyPokemon);
    }

    pokemon.faintCry(() => {
      if (pokemon.isPlayer()) {
        pokemon.addFriendship(-FRIENDSHIP_LOSS_FROM_FAINT);
      }
      pokemon.hideInfo();
      audioManager.playSound("se/faint");
      globalScene.tweens.add({
        targets: pokemon,
        duration: 500,
        y: pokemon.y + 150,
        ease: "Sine.easeIn",
        onComplete: () => {
          pokemon.lapseTags(BattlerTagLapseType.FAINT);

          pokemon.y -= 150;
          pokemon.doSetStatus(StatusEffect.FAINT);
          if (pokemon.isPlayer()) {
            globalScene.currentBattle.removeFaintedParticipant(pokemon as PlayerPokemon);
          } else {
            globalScene.addFaintedEnemyScore(pokemon as EnemyPokemon);
            globalScene.currentBattle.addPostBattleLoot(pokemon as EnemyPokemon);
          }
          pokemon.leaveField();
          if (eonFluteGuestOwner !== undefined) {
            globalScene.clearEonFluteGuest(eonFluteGuestOwner, true);
          }
          void Promise.all([
            this.queueMewtwoFinalBossReplacement(pokemon),
            this.queueUnownFinalBossHelperReplacement(pokemon),
          ]).then(() => this.end());
        },
      });
    });
  }

  private getMewtwoFinalBossFinalFormKey(): MewtwoFinalBossFinalFormKey {
    const livingPlayerPokemon = globalScene
      .getActivePlayerIndexes()
      .flatMap(playerIndex => globalScene.getPlayerParty(playerIndex))
      .filter(pokemon => !pokemon.isFainted());

    if (livingPlayerPokemon.length === 0) {
      return SpeciesFormKey.MEGA_X;
    }

    const offensiveScore = livingPlayerPokemon.reduce(
      (total, pokemon) => total + pokemon.stats[Stat.ATK] + pokemon.stats[Stat.SPATK],
      0,
    );
    const defensiveScore = livingPlayerPokemon.reduce(
      (total, pokemon) => total + pokemon.stats[Stat.DEF] + pokemon.stats[Stat.SPDEF],
      0,
    );
    if (offensiveScore >= defensiveScore * 1.25) {
      return MEWTWO_ARMORED_FORM_KEY;
    }

    const physicalBulk = livingPlayerPokemon.reduce(
      (total, pokemon) => total + pokemon.stats[Stat.HP] * pokemon.stats[Stat.DEF],
      0,
    );
    const specialBulk = livingPlayerPokemon.reduce(
      (total, pokemon) => total + pokemon.stats[Stat.HP] * pokemon.stats[Stat.SPDEF],
      0,
    );

    return physicalBulk <= specialBulk ? SpeciesFormKey.MEGA_X : SpeciesFormKey.MEGA_Y;
  }

  private applyMewtwoFinalBossScaling(pokemon: EnemyPokemon): void {
    if (!globalScene.twoPlayerMode) {
      return;
    }

    const extraPlayerCount = Math.max(0, globalScene.getPlayerFieldOwners().length - 1);
    const stackCount = extraPlayerCount * CLASSIC_FINAL_BOSS_VITAMIN_STACKS_PER_EXTRA_PLAYER;
    if (!stackCount) {
      return;
    }

    const vitaminTypeGenerator = getModifierType(modifierTypes.BASE_STAT_BOOSTER);
    if (!(vitaminTypeGenerator instanceof ModifierTypeGenerator)) {
      return;
    }

    for (const stat of CLASSIC_FINAL_BOSS_MULTIPLAYER_SCALING_STATS) {
      const vitaminType = vitaminTypeGenerator.generateType(globalScene.getEnemyParty(), [stat]);
      const vitamin = vitaminType?.newModifier(pokemon);
      if (vitamin instanceof BaseStatModifier) {
        vitamin.stackCount = stackCount;
        void globalScene.addEnemyModifier(vitamin, true, true);
      }
    }

    pokemon.calculateStats();
    pokemon.hp = pokemon.getMaxHp();
  }

  private getMewtwoFinalBossBossLanes(): MewtwoFinalBossLaneState[] {
    const state = globalScene.currentBattle.mewtwoFinalBossState;
    if (!state) {
      return [];
    }

    if (globalScene.twoPlayerVsMode) {
      return state.lanes;
    }

    const centerFieldIndex = Math.floor(state.lanes.length / 2);
    return [state.lanes.find(lane => lane.fieldIndex === centerFieldIndex) ?? state.lanes[0]].filter(
      (lane): lane is MewtwoFinalBossLaneState => !!lane,
    );
  }

  private copyMewtwoFinalBossItems(pokemon: EnemyPokemon, playerIndexes: PlayerIndex | PlayerIndex[]): void {
    const itemsByType = new Map<string, PokemonHeldItemModifier>();

    for (const playerIndex of Array.isArray(playerIndexes) ? playerIndexes : [playerIndexes]) {
      for (const playerPokemon of globalScene.getPlayerParty(playerIndex)) {
        for (const item of playerPokemon.getHeldItems()) {
          if (!item.isTransferable || item instanceof BerserkGeneModifier) {
            continue;
          }

          const existingItem = itemsByType.get(item.type.id);
          if (!existingItem || item.stackCount > existingItem.stackCount) {
            itemsByType.set(item.type.id, item);
          }
        }
      }
    }

    for (const item of itemsByType.values()) {
      const clonedItem = item.clone();
      if (clonedItem instanceof PokemonHeldItemModifier) {
        clonedItem.pokemonId = pokemon.id;
        clonedItem.isTransferable = false;
        void globalScene.addEnemyModifier(clonedItem, true, true);
      }
    }
  }

  private addBerserkGeneToMewtwo(pokemon: EnemyPokemon): void {
    const modifier = getModifierType(modifierTypes.BERSERK_GENE).newModifier(pokemon);
    if (modifier instanceof PokemonHeldItemModifier) {
      modifier.isTransferable = false;
      void globalScene.addEnemyModifier(modifier, true, true);
    }
  }

  private getMewtwoFinalBossCloneLane(pokemon: Pokemon): MewtwoFinalBossLaneState | undefined {
    const state = globalScene.currentBattle.mewtwoFinalBossState;
    if (!state || state.stage !== 1 || pokemon.isPlayer()) {
      return;
    }

    const trackedLane = getMewtwoFinalBossLaneByPokemonId(state, pokemon.id);
    if (trackedLane?.clonePokemonIds.includes(pokemon.id)) {
      return trackedLane;
    }

    if (pokemon.isBoss()) {
      return;
    }

    const trainerSlot = (pokemon as EnemyPokemon).trainerSlot;
    const fallbackLane = state.lanes.find(lane => lane.trainerSlot === trainerSlot);
    if (!fallbackLane) {
      return;
    }

    fallbackLane.clonePokemonIds.push(pokemon.id);
    return fallbackLane;
  }

  private async queueMewtwoFinalBossReplacement(pokemon: Pokemon): Promise<void> {
    const state = globalScene.currentBattle.mewtwoFinalBossState;
    if (pokemon.isPlayer() || !state || state.stage !== 1) {
      return;
    }

    const lane = this.getMewtwoFinalBossCloneLane(pokemon);
    if (!lane) {
      return;
    }

    const enemyParty = globalScene.getEnemyParty();
    const nextClonePartyIndex = enemyParty.findIndex(
      candidate =>
        candidate.id !== pokemon.id
        && lane.clonePokemonIds.includes(candidate.id)
        && !candidate.isFainted()
        && !candidate.isOnField(),
    );

    if (nextClonePartyIndex > -1) {
      const nextPokemon = enemyParty[nextClonePartyIndex];
      await nextPokemon.loadAssets();
      globalScene.phaseManager.pushNew(
        "SwitchSummonPhase",
        SwitchType.SWITCH,
        lane.fieldIndex,
        nextClonePartyIndex,
        false,
        false,
      );
      return;
    }

    const anyClonesStillFighting = state.lanes.some(otherLane =>
      otherLane.clonePokemonIds.some(cloneId => {
        const clone = globalScene.getPokemonById(cloneId);
        return clone?.isEnemy() && !clone.isFainted();
      }),
    );
    if (anyClonesStillFighting) {
      return;
    }

    state.stage = 2;
    globalScene.phaseManager.queueMessage(
      i18next.t(getClassicFinalBossDialogue(SpeciesId.MEWTWO).firstStageWin),
      null,
      true,
    );

    const bossLanes = this.getMewtwoFinalBossBossLanes();
    const sharedBossPlayerIndexes = globalScene.twoPlayerVsMode
      ? undefined
      : [...new Set(state.lanes.map(stateLane => stateLane.playerIndex))];
    for (const bossLane of bossLanes) {
      if (bossLane.bossPokemonId !== undefined) {
        continue;
      }

      const mewtwo = globalScene.addEnemyPokemon(
        getPokemonSpecies(SpeciesId.MEWTWO),
        globalScene.currentBattle.getLevelForWave(),
        bossLane.trainerSlot,
        true,
        false,
        undefined,
        undefined,
        false,
        true,
      );
      mewtwo.ivs.fill(31);
      mewtwo.generateAndPopulateMoveset(false, 0);
      mewtwo.setBoss();
      this.copyMewtwoFinalBossItems(mewtwo, sharedBossPlayerIndexes ?? bossLane.playerIndex);
      this.addBerserkGeneToMewtwo(mewtwo);
      this.applyMewtwoFinalBossScaling(mewtwo);

      const partyIndex = globalScene.currentBattle.enemyParty.length;
      globalScene.currentBattle.enemyParty.push(mewtwo);
      if (globalScene.twoPlayerVsMode) {
        bossLane.bossPokemonId = mewtwo.id;
      } else {
        state.lanes.forEach(stateLane => {
          stateLane.bossPokemonId = mewtwo.id;
        });
      }

      await mewtwo.loadAssets();
      globalScene.phaseManager.pushNew(
        "SwitchSummonPhase",
        SwitchType.SWITCH,
        bossLane.fieldIndex,
        partyIndex,
        false,
        false,
      );
    }
  }

  private async queueUnownFinalBossHelperReplacement(pokemon: Pokemon): Promise<void> {
    if (pokemon.isPlayer() || !isUnownRealFinalBossWave(globalScene.currentBattle.waveIndex, globalScene.gameMode.modeId)) {
      return;
    }

    const state = globalScene.currentBattle.unownFinalBossState;
    if (!state || state.bossPokemonId === pokemon.id) {
      return;
    }

    const helperSlot = getUnownFinalBossHelperSlot(state, this.fieldIndex);
    if (!helperSlot || helperSlot.pokemonId !== pokemon.id) {
      return;
    }

    const nextSpeciesId = getNextUnownFinalBossHelperSpeciesId(helperSlot);
    if (nextSpeciesId === undefined) {
      return;
    }

    const nextPokemon = globalScene.addEnemyPokemon(
      getPokemonSpecies(nextSpeciesId),
      globalScene.currentBattle.getLevelForWave(),
      (pokemon as EnemyPokemon).trainerSlot,
      false,
    );
    nextPokemon.ivs.fill(31);
    nextPokemon.setCrystalized(true, DEFAULT_CRYSTAL_COLOR);

    if (state.bossPokemonId !== undefined) {
      nextPokemon.addTag(BattlerTagType.CURSED, 0, MoveId.CURSE, state.bossPokemonId);
    }

    const nextPokemonPartyIndex = globalScene.currentBattle.enemyParty.length;
    globalScene.currentBattle.enemyParty.push(nextPokemon);
    helperSlot.pokemonId = nextPokemon.id;

    await nextPokemon.loadAssets();
    globalScene.phaseManager.pushNew(
      "SwitchSummonPhase",
      SwitchType.SWITCH,
      this.fieldIndex,
      nextPokemonPartyIndex,
      false,
      false,
    );
  }

  private handleFinalBossFaint(): void {
    const { phaseManager, ui } = globalScene;
    const enemy = this.getFaintPokemon();
    if (!enemy) {
      this.end();
      return;
    }

    const mewtwoFinalBossState = globalScene.currentBattle.mewtwoFinalBossState;
    if (mewtwoFinalBossState && this.getMewtwoFinalBossCloneLane(enemy)) {
      this.doFaint();
      return;
    }

    if (mewtwoFinalBossState && isMewtwoFinalBossBoss(mewtwoFinalBossState, enemy)) {
      const formKey = enemy.getFormKey();
      if (
        formKey === SpeciesFormKey.MEGA_X
        || formKey === SpeciesFormKey.MEGA_Y
        || formKey === MEWTWO_ARMORED_FORM_KEY
      ) {
        const otherLivingBoss = mewtwoFinalBossState.lanes.some(lane => {
          if (lane.bossPokemonId === undefined || lane.bossPokemonId === enemy.id) {
            return false;
          }
          return !globalScene.getPokemonById(lane.bossPokemonId)?.isFainted();
        });
        if (otherLivingBoss) {
          this.doFaint();
        } else {
          ui.showDialogue(
            getClassicFinalBossDialogue(SpeciesId.MEWTWO).secondStageWin,
            enemy.species.name,
            null,
            () => this.doFaint(),
          );
        }
        return;
      }

      const finalFormKey = this.getMewtwoFinalBossFinalFormKey();
      const finalFormIndex = enemy.species.forms.findIndex(form => form.formKey === finalFormKey);
      if (finalFormIndex < 0) {
        this.doFaint();
        return;
      }

      mewtwoFinalBossState.stage = 3;
      enemy.hp = 1;
      enemy.getStatStages().fill(0);
      enemy.findAndRemoveTags(() => true);
      enemy.resetStatus(false, true, false, false);
      phaseManager.unshiftNew(
        "QuietFormChangePhase",
        enemy,
        new SpeciesFormChange({
          speciesId: SpeciesId.MEWTWO,
          preFormKey: formKey,
          evoFormKey: finalFormKey,
          trigger: new SpeciesFormChangeManualTrigger(),
          quiet: true,
        }),
      );
      this.end();
      return;
    }

    const isUnownRealFinalBoss = isUnownRealFinalBossWave(
      globalScene.currentBattle.waveIndex,
      globalScene.gameMode.modeId,
    );
    const unownFinalBossState = globalScene.currentBattle.unownFinalBossState;
    if (isUnownRealFinalBoss && unownFinalBossState?.bossPokemonId !== enemy.id) {
      this.doFaint();
      return;
    }

    const unownTeaserState = globalScene.currentBattle.unownTeaserState;
    if (
      unownTeaserState?.pokemonId === enemy.id
      && unownTeaserState.glyphIndex >= unownTeaserState.formKeys.length - 1
    ) {
      ui.showDialogue(
        getClassicFinalBossDialogue(enemy.species.speciesId).secondStageWin,
        enemy.species.name,
        null,
        () => this.doFaint(),
      );
      return;
    }

    const mewGauntletState = globalScene.currentBattle.mewGauntletState;
    if (mewGauntletState?.pokemonId === enemy.id && mewGauntletState.phase >= 7) {
      ui.showDialogue(
        getClassicFinalBossDialogue(enemy.species.speciesId).secondStageWin,
        enemy.species.name,
        null,
        () => this.doFaint(),
      );
      return;
    }

    if (
      enemy.hasSpecies(SpeciesId.UNOWN)
      && globalScene.currentBattle.isClassicFinalBoss
      && isUnownRealFinalBoss
      && unownFinalBossState?.bossPokemonId === enemy.id
    ) {
      ui.showDialogue(
        getUnownRealFinalBossDialogue().secondStageWin,
        enemy.species.name,
        null,
        () => this.doFaint(),
      );
      return;
    }

    if (isClassicFinalBossPhaseTwo(enemy)) {
      ui.showDialogue(
        getClassicFinalBossDialogue(enemy.species.speciesId).secondStageWin,
        enemy.species.name,
        null,
        () => this.doFaint(),
      );
      return;
    }

    // Final boss' HP threshold has been bypassed; cancel faint and force check for 2nd phase
    enemy.hp++;
    phaseManager.unshiftNew("DamageAnimPhase", enemy.getBattlerIndex(), 0, HitResult.INDIRECT);
    this.end();
  }

  private getFaintPokemon(): Pokemon | undefined {
    if (this.battlerIndex > BattlerIndex.ENEMY_3) {
      return globalScene.getPokemonById(this.battlerIndex) ?? undefined;
    }

    return globalScene.getField()[this.battlerIndex] ?? undefined;
  }
}
