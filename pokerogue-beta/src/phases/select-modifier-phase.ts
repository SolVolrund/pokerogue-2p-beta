import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { activeOverrides } from "#app/overrides";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { ModifierTier } from "#enums/modifier-tier";
import { UiMode } from "#enums/ui-mode";
import type { Modifier } from "#modifiers/modifier";
import {
  ExtraModifierModifier,
  HealShopCostModifier,
  LinkingCordGoldModifier,
  PokemonHeldItemModifier,
  TempExtraModifierModifier,
} from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierType, ModifierTypeOption } from "#modifiers/modifier-type";
import {
  FusePokemonModifierType,
  getPlayerModifierTypeOptions,
  getPlayerShopModifierTypeOptionsForWave,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  RememberMoveModifierType,
  regenerateModifierPoolThresholds,
  TmModifierType,
} from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { SHOP_OPTIONS_ROW_LIMIT } from "#ui/modifier-select-ui-handler";
import { PartyOption, PartyUiHandler, PartyUiMode, type PokemonSelectFilter } from "#ui/party-ui-handler";
import { NumberHolder } from "#utils/common";
import i18next from "i18next";

export type ModifierSelectCallback = (rowCursor: number, cursor: number) => boolean;

export class SelectModifierPhase extends BattlePhase {
  public readonly phaseName = "SelectModifierPhase";
  private rerollCount: number;
  private modifierTiers?: ModifierTier[] | undefined;
  private customModifierSettings?: CustomModifierSettings | undefined;
  private isCopy: boolean;
  private playerIndex: PlayerIndex;

  private typeOptions: ModifierTypeOption[];

  constructor(
    rerollCount = 0,
    modifierTiers?: ModifierTier[],
    customModifierSettings?: CustomModifierSettings,
    isCopy = false,
    playerIndex: PlayerIndex = globalScene.activePlayerIndex,
  ) {
    super();

    this.rerollCount = rerollCount;
    this.modifierTiers = modifierTiers;
    this.customModifierSettings = customModifierSettings;
    this.isCopy = isCopy;
    this.playerIndex = playerIndex;
  }

  start() {
    super.start();

    this.setActiveRewardPlayer();

    if (!this.isPlayer()) {
      return false;
    }

    if (!this.rerollCount && !this.isCopy) {
      this.updateSeed();
    } else if (this.rerollCount) {
      globalScene.reroll = false;
    }

    const party = globalScene.getPlayerParty(this.playerIndex);
    if (!this.isCopy) {
      regenerateModifierPoolThresholds(party, this.getPoolType(), this.rerollCount);
    }
    const modifierCount = this.getModifierCount();

    this.typeOptions = this.getModifierTypeOptions(modifierCount);
    globalScene.recordTwoPlayerRewardDebugState(
      this.playerIndex,
      this.rerollCount,
      this.getRewardSeedOffset(),
      this.typeOptions.map(option => option.type.id),
    );

    const modifierSelectCallback = (rowCursor: number, cursor: number) => {
      if (rowCursor < 0 || cursor < 0) {
        globalScene.ui.showText(i18next.t("battle:skipItemQuestion"), null, () => {
          globalScene.ui.setOverlayMode(
            UiMode.CONFIRM,
            () => {
              globalScene.ui.revertMode();
              globalScene.ui.setMode(UiMode.MESSAGE);
              globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("reward-skipped");
              super.end();
            },
            () => this.resetModifierSelect(modifierSelectCallback),
          );
        });
        return false;
      }

      switch (rowCursor) {
        // Execute one of the options from the bottom row
        case 0:
          switch (cursor) {
            case 0:
              return this.rerollModifiers();
            case 1:
              return this.openModifierTransferScreen(modifierSelectCallback);
            case 2:
              return this.openTradeScreen(modifierSelectCallback);
            // Check the party, pass a callback to restore the modifier select screen.
            case 3:
              globalScene.ui.setModeWithoutClear(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
                this.resetModifierSelect(modifierSelectCallback);
              });
              return true;
            case 4:
              return this.toggleRerollLock();
            default:
              return false;
          }
        // Pick an option from the rewards
        case 1:
          return this.selectRewardModifierOption(cursor, modifierSelectCallback);
        // Pick an option from the shop
        default: {
          return this.selectShopModifierOption(rowCursor, cursor, modifierSelectCallback);
        }
      }
    };

    this.resetModifierSelect(modifierSelectCallback);
  }

  private setActiveRewardPlayer(): void {
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(this.playerIndex);
    } else {
      globalScene.setActivePlayerIndex(this.playerIndex);
    }
  }

  // Pick a modifier from among the rewards and apply it
  private selectRewardModifierOption(cursor: number, modifierSelectCallback: ModifierSelectCallback): boolean {
    if (this.typeOptions.length === 0) {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("reward-empty");
      super.end();
      return true;
    }
    const modifierType = this.typeOptions[cursor].type;
    return this.applyChosenModifier(modifierType, -1, modifierSelectCallback);
  }

  // Pick a modifier from the shop and apply it
  private selectShopModifierOption(
    rowCursor: number,
    cursor: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): boolean {
    const shopOptions = getPlayerShopModifierTypeOptionsForWave(
      globalScene.currentBattle.waveIndex,
      globalScene.getWaveMoneyAmount(1),
    );
    const shopOption =
      shopOptions[
        rowCursor > 2 || shopOptions.length <= SHOP_OPTIONS_ROW_LIMIT ? cursor : cursor + SHOP_OPTIONS_ROW_LIMIT
      ];
    const modifierType = shopOption.type;
    // Apply Black Sludge to healing item cost
    const healingItemCost = new NumberHolder(shopOption.cost);
    globalScene.applyModifierForPlayer(HealShopCostModifier, this.playerIndex, healingItemCost);
    const cost = healingItemCost.value;

    if (globalScene.getPlayerMoney(this.playerIndex) < cost && !activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
      globalScene.ui.playError();
      return false;
    }

    return this.applyChosenModifier(modifierType, cost, modifierSelectCallback);
  }

  // Apply a chosen modifier: do an effect or open the party menu
  private applyChosenModifier(
    modifierType: ModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): boolean {
    if (modifierType instanceof PokemonModifierType) {
      if (modifierType instanceof FusePokemonModifierType) {
        this.openFusionMenu(modifierType, cost, modifierSelectCallback);
      } else {
        this.openModifierMenu(modifierType, cost, modifierSelectCallback);
      }
    } else {
      this.applyModifier(modifierType.newModifier()!, cost);
    }
    return cost === -1;
  }

  // Reroll rewards
  private rerollModifiers() {
    const rerollCost = this.getRerollCost(globalScene.lockModifierTiers);
    if (rerollCost < 0 || globalScene.getPlayerMoney(this.playerIndex) < rerollCost) {
      globalScene.ui.playError();
      return false;
    }
    globalScene.reroll = true;
    globalScene.phaseManager.unshiftNew(
      "SelectModifierPhase",
      this.rerollCount + 1,
      this.typeOptions.map(o => o.type?.tier).filter(t => t !== undefined) as ModifierTier[],
      undefined,
      false,
      this.playerIndex,
    );
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.MESSAGE).then(() => super.end());
    if (!activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
      globalScene.setPlayerMoney(globalScene.getPlayerMoney(this.playerIndex) - rerollCost, this.playerIndex);
      globalScene.updateMoneyText();
      globalScene.animateMoneyChanged(false);
    }
    audioManager.playSound("se/buy");
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("reward-rerolled");
    return true;
  }

  // Transfer modifiers among party pokemon
  private openModifierTransferScreen(modifierSelectCallback: ModifierSelectCallback) {
    const party = globalScene.getPlayerParty(this.playerIndex);
    globalScene.ui.setModeWithoutClear(
      UiMode.PARTY,
      PartyUiMode.MODIFIER_TRANSFER,
      -1,
      (fromSlotIndex: number, itemIndex: number, itemQuantity: number, toSlotIndex: number) => {
        if (
          toSlotIndex !== undefined
          && fromSlotIndex < 6
          && toSlotIndex < 6
          && fromSlotIndex !== toSlotIndex
          && itemIndex > -1
        ) {
          const itemModifiers = globalScene.findModifiersForPlayer(
            m => m instanceof PokemonHeldItemModifier && m.isTransferable && m.pokemonId === party[fromSlotIndex].id,
            this.playerIndex,
          ) as PokemonHeldItemModifier[];
          const itemModifier = itemModifiers[itemIndex];
          globalScene.tryTransferHeldItemModifier(
            itemModifier,
            party[toSlotIndex],
            true,
            itemQuantity,
            undefined,
            undefined,
            false,
          );
        } else {
          this.resetModifierSelect(modifierSelectCallback);
        }
      },
      PartyUiHandler.FilterItemMaxStacks,
    );
    return true;
  }

  private openTradeScreen(modifierSelectCallback: ModifierSelectCallback): boolean {
    if (!globalScene.twoPlayerMode || !this.hasLinkingCordGold(this.playerIndex)) {
      globalScene.ui.playError();
      return false;
    }

    const sourcePlayerIndex = this.playerIndex;
    const targetPlayerIndex = (sourcePlayerIndex === 0 ? 1 : 0) as PlayerIndex;
    const restoreRewardScreen = () => this.resetModifierSelect(modifierSelectCallback);
    const filterActivePokemon: PokemonSelectFilter = pokemon =>
      pokemon.isOnField() ? "Pokemon currently in battle cannot be traded." : null;
    const openPartySelect = (
      playerIndex: PlayerIndex,
      callback: (partyIndex: number, option: PartyOption) => void,
      inputPlayerIndex = playerIndex,
    ) => {
      const showPartySelect = () => {
        globalScene.ui
          .setModeWithoutClear(
            UiMode.PARTY,
            PartyUiMode.SELECT,
            this.getFieldSlotForPlayer(playerIndex),
            callback,
            filterActivePokemon,
          )
          .then(() => globalScene.waitForPlayerInput(inputPlayerIndex));
      };

      if (globalScene.ui.getMode() === UiMode.PARTY) {
        globalScene.ui.setMode(UiMode.MESSAGE).then(showPartySelect);
      } else {
        showPartySelect();
      }
    };

    openPartySelect(sourcePlayerIndex, (sourcePartyIndex: number, sourceOption: PartyOption) => {
      if (sourceOption === PartyOption.CANCEL) {
        restoreRewardScreen();
        return;
      }
      if (sourceOption !== PartyOption.SELECT || !this.isValidPartyIndex(sourcePlayerIndex, sourcePartyIndex)) {
        globalScene.ui.playError();
        restoreRewardScreen();
        return;
      }

      openPartySelect(
        targetPlayerIndex,
        (targetPartyIndex: number, targetOption: PartyOption) => {
          if (targetOption === PartyOption.CANCEL) {
            restoreRewardScreen();
            return;
          }
          if (targetOption !== PartyOption.SELECT || !this.isValidPartyIndex(targetPlayerIndex, targetPartyIndex)) {
            globalScene.ui.playError();
            restoreRewardScreen();
            return;
          }

          this.tradePlayerPokemon(sourcePlayerIndex, sourcePartyIndex, targetPlayerIndex, targetPartyIndex);
          restoreRewardScreen();
        },
        sourcePlayerIndex,
      );
    });

    return true;
  }

  private hasLinkingCordGold(playerIndex: PlayerIndex): boolean {
    return globalScene
      .findModifiersForPlayer(modifier => modifier instanceof LinkingCordGoldModifier, playerIndex)
      .some(Boolean);
  }

  private getFieldSlotForPlayer(playerIndex: PlayerIndex): number {
    const fieldSlot = globalScene.getPlayerFieldOwners().indexOf(playerIndex);
    return fieldSlot > -1 ? fieldSlot : playerIndex;
  }

  private isValidPartyIndex(playerIndex: PlayerIndex, partyIndex: number): boolean {
    return partyIndex >= 0 && partyIndex < globalScene.getPlayerParty(playerIndex).length;
  }

  private getPlayerHeldItemModifiers(pokemonId: number, playerIndex: PlayerIndex): PokemonHeldItemModifier[] {
    return globalScene.findModifiersForPlayer(
      modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === pokemonId,
      playerIndex,
    ) as PokemonHeldItemModifier[];
  }

  private moveHeldItemModifiers(
    modifiers: PokemonHeldItemModifier[],
    fromPlayer: PlayerIndex,
    toPlayer: PlayerIndex,
  ): void {
    const sourceModifiers = globalScene.getPlayerModifiers(fromPlayer);
    const targetModifiers = globalScene.getPlayerModifiers(toPlayer);

    for (const modifier of modifiers) {
      const sourceIndex = sourceModifiers.indexOf(modifier);
      if (sourceIndex > -1) {
        sourceModifiers.splice(sourceIndex, 1);
        targetModifiers.push(modifier);
      }
    }
  }

  private tradePlayerPokemon(
    firstPlayerIndex: PlayerIndex,
    firstPartyIndex: number,
    secondPlayerIndex: PlayerIndex,
    secondPartyIndex: number,
  ): void {
    const firstParty = globalScene.getPlayerParty(firstPlayerIndex);
    const secondParty = globalScene.getPlayerParty(secondPlayerIndex);
    const firstPokemon = firstParty[firstPartyIndex];
    const secondPokemon = secondParty[secondPartyIndex];

    if (!firstPokemon || !secondPokemon) {
      return;
    }

    const firstPokemonHeldItems = this.getPlayerHeldItemModifiers(firstPokemon.id, firstPlayerIndex);
    const secondPokemonHeldItems = this.getPlayerHeldItemModifiers(secondPokemon.id, secondPlayerIndex);

    firstParty[firstPartyIndex] = secondPokemon;
    secondParty[secondPartyIndex] = firstPokemon;

    this.moveHeldItemModifiers(firstPokemonHeldItems, firstPlayerIndex, secondPlayerIndex);
    this.moveHeldItemModifiers(secondPokemonHeldItems, secondPlayerIndex, firstPlayerIndex);

    for (const playerIndex of [firstPlayerIndex, secondPlayerIndex]) {
      globalScene.updateModifiers(true, true, playerIndex);
    }
  }

  // Toggle reroll lock
  private toggleRerollLock() {
    const rerollCost = this.getRerollCost(globalScene.lockModifierTiers);
    if (rerollCost < 0) {
      // Reroll lock button is also disabled when reroll is disabled
      globalScene.ui.playError();
      return false;
    }
    globalScene.lockModifierTiers = !globalScene.lockModifierTiers;
    const uiHandler = globalScene.ui.getHandler() as ModifierSelectUiHandler;
    uiHandler.setRerollCost(this.getRerollCost(globalScene.lockModifierTiers));
    uiHandler.updateLockRaritiesText();
    uiHandler.updateRerollCostText();
    return false;
  }

  /**
   * Apply the effects of the chosen modifier
   * @param modifier - The modifier to apply
   * @param cost - The cost of the modifier if it was purchased, or -1 if selected as the modifier reward
   * @param playSound - Whether the 'obtain modifier' sound should be played when adding the modifier.
   */
  private applyModifier(modifier: Modifier, cost = -1, playSound = false): void {
    const result = globalScene.addModifier(modifier, false, playSound, undefined, undefined, cost, this.playerIndex);
    // Queue a copy of this phase when applying a TM or Memory Mushroom.
    // If the player selects either of these, then escapes out of consuming them,
    // they are returned to a shop in the same state.
    if (modifier.type instanceof RememberMoveModifierType || modifier.type instanceof TmModifierType) {
      globalScene.phaseManager.unshiftPhase(this.copy());
    }

    if (cost !== -1 && !(modifier.type instanceof RememberMoveModifierType)) {
      if (result) {
        if (!activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
          globalScene.setPlayerMoney(globalScene.getPlayerMoney(this.playerIndex) - cost, this.playerIndex);
          globalScene.updateMoneyText();
          globalScene.animateMoneyChanged(false);
        }
        audioManager.playSound("se/buy");
        (globalScene.ui.getHandler() as ModifierSelectUiHandler).updateCostText();
        globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("shop-purchased");
      } else {
        globalScene.ui.playError();
      }
    } else {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("reward-picked");
      super.end();
    }
  }

  // Opens the party menu specifically for fusions
  private openFusionMenu(
    modifierType: PokemonModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    globalScene.ui.setModeWithoutClear(
      UiMode.PARTY,
      PartyUiMode.SPLICE,
      -1,
      (fromSlotIndex: number, spliceSlotIndex: number) => {
        if (
          spliceSlotIndex !== undefined
          && fromSlotIndex < 6
          && spliceSlotIndex < 6
          && fromSlotIndex !== spliceSlotIndex
        ) {
          globalScene.ui.setMode(UiMode.MODIFIER_SELECT, this.isPlayer()).then(() => {
            const modifier = modifierType.newModifier(party[fromSlotIndex], party[spliceSlotIndex])!; //TODO: is the bang correct?
            this.applyModifier(modifier, cost, true);
          });
        } else {
          this.resetModifierSelect(modifierSelectCallback);
        }
      },
      modifierType.selectFilter,
    );
  }

  // Opens the party menu to apply one of various modifiers
  private openModifierMenu(
    modifierType: PokemonModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const pokemonModifierType = modifierType as PokemonModifierType;
    const isMoveModifier = modifierType instanceof PokemonMoveModifierType;
    const isTmModifier = modifierType instanceof TmModifierType;
    const isRememberMoveModifier = modifierType instanceof RememberMoveModifierType;
    const isPpRestoreModifier =
      modifierType instanceof PokemonPpRestoreModifierType || modifierType instanceof PokemonPpUpModifierType;
    const partyUiMode = isMoveModifier
      ? PartyUiMode.MOVE_MODIFIER
      : isTmModifier
        ? PartyUiMode.TM_MODIFIER
        : isRememberMoveModifier
          ? PartyUiMode.REMEMBER_MOVE_MODIFIER
          : PartyUiMode.MODIFIER;
    const tmMoveId = isTmModifier ? (modifierType as TmModifierType).moveId : undefined;
    globalScene.ui.setModeWithoutClear(
      UiMode.PARTY,
      partyUiMode,
      -1,
      (slotIndex: number, option: PartyOption) => {
        if (slotIndex < 6) {
          globalScene.ui.setMode(UiMode.MODIFIER_SELECT, this.isPlayer()).then(() => {
            const modifier = isMoveModifier
              ? modifierType.newModifier(party[slotIndex], option - PartyOption.MOVE_1)
              : isRememberMoveModifier
                ? modifierType.newModifier(party[slotIndex], option as number)
                : modifierType.newModifier(party[slotIndex]);
            this.applyModifier(modifier!, cost, true); // TODO: is the bang correct?
          });
        } else {
          this.resetModifierSelect(modifierSelectCallback);
        }
      },
      pokemonModifierType.selectFilter,
      modifierType instanceof PokemonMoveModifierType
        ? (modifierType as PokemonMoveModifierType).moveSelectFilter
        : undefined,
      tmMoveId,
      isPpRestoreModifier,
    );
  }

  // Function that determines how many reward slots are available
  private getModifierCount(): number {
    const modifierCountHolder = new NumberHolder(3);
    globalScene.applyModifiersForPlayer(ExtraModifierModifier, this.playerIndex, modifierCountHolder);
    globalScene.applyModifiersForPlayer(TempExtraModifierModifier, this.playerIndex, modifierCountHolder);

    // If custom modifiers are specified, overrides default item count
    if (this.customModifierSettings) {
      const newItemCount =
        (this.customModifierSettings.guaranteedModifierTiers?.length ?? 0)
        + (this.customModifierSettings.guaranteedModifierTypeOptions?.length ?? 0)
        + (this.customModifierSettings.guaranteedModifierTypeFuncs?.length ?? 0);
      if (this.customModifierSettings.fillRemaining) {
        const originalCount = modifierCountHolder.value;
        modifierCountHolder.value = originalCount > newItemCount ? originalCount : newItemCount;
      } else {
        modifierCountHolder.value = newItemCount;
      }
    }

    return modifierCountHolder.value;
  }

  // Function that resets the reward selection screen,
  // e.g. after pressing cancel in the party ui or while learning a move
  private resetModifierSelect(modifierSelectCallback: ModifierSelectCallback) {
    this.setActiveRewardPlayer();
    globalScene.ui.setMode(
      UiMode.MODIFIER_SELECT,
      this.isPlayer(),
      this.typeOptions,
      modifierSelectCallback,
      this.getRerollCost(globalScene.lockModifierTiers),
      globalScene.twoPlayerMode && this.hasLinkingCordGold(this.playerIndex),
    );
  }

  updateSeed(): void {
    globalScene.resetSeed(this.getRewardSeedOffset());
  }

  private getRewardSeedOffset(): number {
    const waveIndex = globalScene.currentBattle?.waveIndex ?? 0;
    return globalScene.twoPlayerMode ? waveIndex + this.playerIndex * 10000 : waveIndex;
  }

  isPlayer(): boolean {
    return true;
  }

  getRerollCost(lockRarities: boolean): number {
    let baseValue = 0;
    if (activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
      return baseValue;
    }
    if (lockRarities) {
      const tierValues = [50, 125, 300, 750, 2000];
      for (const opt of this.typeOptions) {
        baseValue += tierValues[opt.type.tier ?? 0];
      }
    } else {
      baseValue = 250;
    }

    let multiplier = 1;
    if (this.customModifierSettings?.rerollMultiplier != null) {
      if (this.customModifierSettings.rerollMultiplier < 0) {
        // Completely overrides reroll cost to -1 and early exits
        return -1;
      }

      // Otherwise, continue with custom multiplier
      multiplier = this.customModifierSettings.rerollMultiplier;
    }

    const baseMultiplier = Math.min(
      Math.ceil(globalScene.currentBattle.waveIndex / 10) * baseValue * 2 ** this.rerollCount * multiplier,
      Number.MAX_SAFE_INTEGER,
    );

    // Apply Black Sludge to reroll cost
    const modifiedRerollCost = new NumberHolder(baseMultiplier);
    globalScene.applyModifierForPlayer(HealShopCostModifier, this.playerIndex, modifiedRerollCost);
    return modifiedRerollCost.value;
  }

  getPoolType(): ModifierPoolType {
    return ModifierPoolType.PLAYER;
  }

  getModifierTypeOptions(modifierCount: number): ModifierTypeOption[] {
    return getPlayerModifierTypeOptions(
      modifierCount,
      globalScene.getPlayerParty(this.playerIndex),
      globalScene.lockModifierTiers ? this.modifierTiers : undefined,
      this.customModifierSettings,
    );
  }

  copy(): SelectModifierPhase {
    return globalScene.phaseManager.create(
      "SelectModifierPhase",
      this.rerollCount,
      this.modifierTiers,
      {
        guaranteedModifierTypeOptions: this.typeOptions,
        rerollMultiplier: this.customModifierSettings?.rerollMultiplier,
        allowLuckUpgrades: false,
      },
      true,
      this.playerIndex,
    );
  }

  addModifier(modifier: Modifier): boolean {
    return globalScene.addModifier(modifier, false, true);
  }
}
