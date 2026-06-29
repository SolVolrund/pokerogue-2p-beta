import type { PlayerIndex } from "#app/battle-scene";
import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { activeOverrides } from "#app/overrides";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import type { ModifierTier } from "#enums/modifier-tier";
import { UiMode } from "#enums/ui-mode";
import type { Modifier } from "#modifiers/modifier";
import {
  ExtraModifierModifier,
  HealShopCostModifier,
  LinkingCordGoldModifier,
  LockModifierTiersModifier,
  PokemonHeldItemModifier,
  TempExtraModifierModifier,
} from "#modifiers/modifier";
import type { CustomModifierSettings, ModifierType } from "#modifiers/modifier-type";
import {
  FusePokemonModifierType,
  getPlayerModifierTypeOptions,
  getPlayerShopModifierTypeOptionsForWave,
  ModifierTypeOption,
  PartnerPokemonReviveModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  RememberMoveModifierType,
  regenerateModifierPoolThresholds,
  TmModifierType,
} from "#modifiers/modifier-type";
import { BattlePhase } from "#phases/battle-phase";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import type { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import { SHOP_OPTIONS_ROW_LIMIT } from "#ui/modifier-select-ui-handler";
import { PartyOption, PartyUiHandler, PartyUiMode, type PokemonSelectFilter } from "#ui/party-ui-handler";
import {
  chooseComputerPartnerRecoveryOption,
  chooseComputerPartnerRewardOption,
  type ComputerPartnerRecoveryChoice,
  type ComputerPartnerRewardChoice,
} from "#utils/computer-partner-reward-ai";
import { getComputerPartnerProfile, getComputerPartnerProfileWithRolePreferences } from "#utils/computer-partner-profile";
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

    if (this.tryAutoComputerPartnerShopPurchases()) {
      return;
    }

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
              return this.openCheckTeamScreen(modifierSelectCallback);
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

  private isComputerPartnerRewardPlayer(): boolean {
    return globalScene.isComputerPartnerPlayer(this.playerIndex);
  }

  private getComputerPartnerShopOptions(): ModifierTypeOption[] {
    return getPlayerShopModifierTypeOptionsForWave(
      globalScene.currentBattle.waveIndex,
      globalScene.getWaveMoneyAmount(1),
    ).map(option => {
      const healingItemCost = new NumberHolder(option.cost);
      globalScene.applyModifierForPlayer(HealShopCostModifier, this.playerIndex, healingItemCost);
      return new ModifierTypeOption(option.type, option.upgradeCount, healingItemCost.value);
    });
  }

  private tryAutoComputerPartnerShopPurchases(): boolean {
    if (!this.isComputerPartnerRewardPlayer()) {
      return false;
    }

    const messages: string[] = [];
    const maxPurchases = 6;
    let purchases = 0;
    while (purchases < maxPurchases) {
      const party = globalScene.getPlayerParty(this.playerIndex);
      const shopOptions = this.getComputerPartnerShopOptions();
      const choice = chooseComputerPartnerRecoveryOption(
        shopOptions,
        party,
        activeOverrides.WAIVE_ROLL_FEE_OVERRIDE ? Number.MAX_SAFE_INTEGER : globalScene.getPlayerMoney(this.playerIndex),
      );

      if (!choice) {
        break;
      }

      const message = this.applyComputerPartnerRecoveryChoice(choice);
      if (!message) {
        break;
      }
      messages.push(message);
      purchases++;
    }

    const rewardChoice = chooseComputerPartnerRewardOption(this.typeOptions, globalScene.getPlayerParty(this.playerIndex), {
      pokeballCounts: globalScene.getPlayerPokeballCounts(this.playerIndex),
      computerPartnerProfile: getComputerPartnerProfileWithRolePreferences(
        globalScene.getComputerPartnerKey(this.playerIndex),
        globalScene.getComputerPartnerRolePreferences(this.playerIndex),
      ),
    });
    const rewardModifier = rewardChoice ? this.createComputerPartnerChoiceModifier(rewardChoice) : null;
    if (rewardChoice && rewardModifier) {
      messages.push(this.getComputerPartnerChoiceMessage(rewardChoice, rewardModifier, false));
      this.queueComputerPartnerChoiceMessages(messages);
      this.applyComputerPartnerRewardModifier(rewardModifier);
      return true;
    }

    this.queueComputerPartnerChoiceMessages(messages);
    this.skipComputerPartnerReward();
    return true;
  }

  private skipComputerPartnerReward(): void {
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("reward-skipped");
    super.end();
  }

  private applyComputerPartnerRecoveryChoice(choice: ComputerPartnerRecoveryChoice): string | undefined {
    const modifier = this.createComputerPartnerChoiceModifier(choice);
    if (!modifier) {
      return undefined;
    }
    const result = globalScene.addModifier(modifier, false, true, undefined, undefined, choice.cost, this.playerIndex);
    if (!result) {
      return undefined;
    }

    if (!activeOverrides.WAIVE_ROLL_FEE_OVERRIDE) {
      globalScene.setPlayerMoney(globalScene.getPlayerMoney(this.playerIndex) - choice.cost, this.playerIndex);
      globalScene.updateMoneyText();
      globalScene.animateMoneyChanged(false);
    }
    audioManager.playSound("se/buy");
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("shop-purchased");
    return this.getComputerPartnerChoiceMessage(choice, modifier, true);
  }

  private applyComputerPartnerRewardModifier(modifier: Modifier): void {
    this.applyModifier(modifier, -1, true);
  }

  private createComputerPartnerChoiceModifier(
    choice: ComputerPartnerRecoveryChoice | ComputerPartnerRewardChoice,
  ): Modifier | null {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const targetPokemon =
      choice.targetPokemonIndex !== undefined ? party[choice.targetPokemonIndex] : undefined;
    return (
      targetPokemon && choice.targetMoveIndex !== undefined
        ? choice.option.type.newModifier(targetPokemon, choice.targetMoveIndex)
        : targetPokemon
          ? choice.option.type.newModifier(targetPokemon)
          : choice.option.type.newModifier()
    );
  }

  private getComputerPartnerChoiceMessage(
    choice: ComputerPartnerRecoveryChoice | ComputerPartnerRewardChoice,
    modifier: Modifier,
    isPurchase: boolean,
  ): string {
    const itemName = choice.option.type.name;
    const action = isPurchase ? "Purchased" : "Selected";
    const targetName = this.getComputerPartnerTargetPokemonName(choice);
    const partnerName = getComputerPartnerProfile(globalScene.getComputerPartnerKey(this.playerIndex)).name;

    if (this.isComputerPartnerTeamWideChoice(choice)) {
      return `${partnerName}: ${action} ${itemName} and used it on their team.`;
    }

    if (targetName) {
      const targetAction = !isPurchase && modifier instanceof PokemonHeldItemModifier ? "gave it to" : "used it on";
      return `${partnerName}: ${action} ${itemName} and ${targetAction} ${targetName}.`;
    }

    return `${partnerName}: ${action} ${itemName}.`;
  }

  private getComputerPartnerTargetPokemonName(
    choice: ComputerPartnerRecoveryChoice | ComputerPartnerRewardChoice,
  ): string | undefined {
    if (choice.targetPokemonIndex === undefined) {
      return undefined;
    }

    const targetPokemon = globalScene.getPlayerParty(this.playerIndex)[choice.targetPokemonIndex];
    return targetPokemon ? getPokemonNameWithAffix(targetPokemon) : undefined;
  }

  private isComputerPartnerTeamWideChoice(choice: ComputerPartnerRecoveryChoice | ComputerPartnerRewardChoice): boolean {
    return choice.itemId === "SACRED_ASH" || choice.itemId === "RARER_CANDY";
  }

  private queueComputerPartnerChoiceMessages(messages: string[]): void {
    if (!messages.length) {
      return;
    }
    globalScene.waitForPlayerInput(0);
    messages.forEach(message => globalScene.phaseManager.queueMessage(message, null, true));
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
      if (modifierType instanceof PartnerPokemonReviveModifierType) {
        return this.openPartnerReviveMenu(modifierType, cost, modifierSelectCallback);
      }
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
    const rerollCost = this.getRerollCost(this.shouldLockRarities());
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

  private openCheckTeamScreen(modifierSelectCallback: ModifierSelectCallback): boolean {
    const restoreRewardScreen = () => this.resetModifierSelect(modifierSelectCallback);
    const partnerPlayerIndexes = globalScene
      .getActivePlayerIndexes()
      .filter(playerIndex => playerIndex !== this.playerIndex && globalScene.isComputerPartnerPlayer(playerIndex));

    if (!globalScene.twoPlayerComputerPartner || partnerPlayerIndexes.length === 0) {
      this.openCheckTeamParty(this.playerIndex, restoreRewardScreen);
      return true;
    }

    const options: OptionSelectItem[] = [
      {
        label: "Check your Team",
        handler: () => {
          this.openCheckTeamParty(this.playerIndex, restoreRewardScreen);
          return true;
        },
      },
      ...partnerPlayerIndexes.map(partnerPlayerIndex => ({
        label: `Check ${this.getPlayerDisplayName(partnerPlayerIndex)}'s team`,
        handler: () => {
          this.openCheckTeamParty(partnerPlayerIndex, restoreRewardScreen, this.playerIndex);
          return true;
        },
      }) satisfies OptionSelectItem),
      {
        label: i18next.t("menu:cancel"),
        handler: () => {
          restoreRewardScreen();
          return true;
        },
      },
    ];

    this.showRewardOptionSelect({ options, noCancel: true });
    return true;
  }

  private openCheckTeamParty(
    playerIndex: PlayerIndex,
    onComplete: () => void,
    inputPlayerIndex = playerIndex,
  ): void {
    globalScene.ui
      .setModeWithoutClear(UiMode.PARTY, PartyUiMode.CHECK, this.getFieldSlotForPlayer(playerIndex), () => {
        onComplete();
      })
      .then(() => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(inputPlayerIndex);
        }
      });
  }

  private openTradeScreen(modifierSelectCallback: ModifierSelectCallback): boolean {
    if (!globalScene.twoPlayerMode || !this.hasAvailableTradeTarget(this.playerIndex)) {
      globalScene.ui.playError();
      return false;
    }

    const sourcePlayerIndex = this.playerIndex;
    const restoreRewardScreen = () => this.resetModifierSelect(modifierSelectCallback);
    const tradeTargets = this.getAvailableTradeTargetPlayerIndexes(sourcePlayerIndex);
    const options: OptionSelectItem[] = tradeTargets.map(targetPlayerIndex => ({
      label: `Trade with ${this.getPlayerDisplayName(targetPlayerIndex)}`,
      handler: () => {
        this.openTradeScreenWithTarget(sourcePlayerIndex, targetPlayerIndex, restoreRewardScreen);
        return true;
      },
    }) satisfies OptionSelectItem);
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        restoreRewardScreen();
        return true;
      },
    });

    this.showRewardOptionSelect({ options, noCancel: true });
    return true;
  }

  private openTradeScreenWithTarget(
    sourcePlayerIndex: PlayerIndex,
    targetPlayerIndex: PlayerIndex,
    restoreRewardScreen: () => void,
  ): void {
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
  }

  private openPartnerReviveMenu(
    modifierType: PartnerPokemonReviveModifierType,
    cost: number,
    modifierSelectCallback: ModifierSelectCallback,
  ): boolean {
    if (!globalScene.twoPlayerMode) {
      globalScene.ui.playError();
      return false;
    }

    const restoreRewardScreen = () => this.resetModifierSelect(modifierSelectCallback);
    const partnerPlayerIndexes = this.getAvailablePartnerReviveTargetPlayerIndexes(this.playerIndex, modifierType);
    if (partnerPlayerIndexes.length === 0) {
      globalScene.ui.playError();
      return false;
    }

    const options: OptionSelectItem[] = partnerPlayerIndexes.map(partnerPlayerIndex => ({
      label: `Use on ${this.getPlayerDisplayName(partnerPlayerIndex)}'s team`,
      handler: () => {
        this.openPartnerReviveParty(modifierType, cost, partnerPlayerIndex, restoreRewardScreen);
        return true;
      },
    }) satisfies OptionSelectItem);
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        restoreRewardScreen();
        return true;
      },
    });

    this.showRewardOptionSelect({ options, noCancel: true });
    return cost === -1;
  }

  private openPartnerReviveParty(
    modifierType: PartnerPokemonReviveModifierType,
    cost: number,
    targetPlayerIndex: PlayerIndex,
    restoreRewardScreen: () => void,
  ): void {
    const targetParty = globalScene.getPlayerParty(targetPlayerIndex);
    const showPartySelect = () => {
      globalScene.ui
        .setModeWithoutClear(
          UiMode.PARTY,
          PartyUiMode.MODIFIER,
          this.getFieldSlotForPlayer(targetPlayerIndex),
          (slotIndex: number, option: PartyOption) => {
            if (option === PartyOption.CANCEL) {
              restoreRewardScreen();
              return;
            }
            if (option !== PartyOption.APPLY || !this.isValidPartyIndex(targetPlayerIndex, slotIndex)) {
              globalScene.ui.playError();
              restoreRewardScreen();
              return;
            }

            globalScene.ui.setMode(UiMode.MODIFIER_SELECT, this.isPlayer()).then(() => {
              const modifier = modifierType.newModifier(targetParty[slotIndex]);
              this.applyPartnerModifier(modifier!, cost, targetPlayerIndex);
            });
          },
          modifierType.selectFilter,
        )
        .then(() => globalScene.waitForPlayerInput(this.playerIndex));
    };

    if (globalScene.ui.getMode() === UiMode.PARTY) {
      globalScene.ui.setMode(UiMode.MESSAGE).then(showPartySelect);
    } else {
      showPartySelect();
    }
  }

  private showRewardOptionSelect(config: OptionSelectConfig): void {
    globalScene.ui.setModeWithoutClear(UiMode.OPTION_SELECT, config, null, true);
  }

  private getAvailablePartnerReviveTargetPlayerIndexes(
    sourcePlayerIndex: PlayerIndex,
    modifierType: PartnerPokemonReviveModifierType,
  ): PlayerIndex[] {
    return globalScene
      .getActivePlayerIndexes()
      .filter(playerIndex => playerIndex !== sourcePlayerIndex)
      .filter(playerIndex =>
        globalScene.getPlayerParty(playerIndex).some(pokemon => (modifierType.selectFilter?.(pokemon) ?? null) === null),
      );
  }

  private getAvailableTradeTargetPlayerIndexes(sourcePlayerIndex: PlayerIndex): PlayerIndex[] {
    if (!this.hasLinkingCordGold(sourcePlayerIndex)) {
      return [];
    }

    return globalScene
      .getActivePlayerIndexes()
      .filter(playerIndex => playerIndex !== sourcePlayerIndex && this.hasLinkingCordGold(playerIndex));
  }

  private hasAvailableTradeTarget(sourcePlayerIndex: PlayerIndex): boolean {
    return this.getAvailableTradeTargetPlayerIndexes(sourcePlayerIndex).length > 0;
  }

  private getPlayerDisplayName(playerIndex: PlayerIndex): string {
    if (globalScene.isComputerPartnerPlayer(playerIndex)) {
      return getComputerPartnerProfile(globalScene.getComputerPartnerKey(playerIndex)).name;
    }

    return `Player ${playerIndex + 1}`;
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
    if (!this.hasLockCapsule()) {
      globalScene.ui.playError();
      return false;
    }

    const rerollCost = this.getRerollCost(this.shouldLockRarities());
    if (rerollCost < 0) {
      // Reroll lock button is also disabled when reroll is disabled
      globalScene.ui.playError();
      return false;
    }
    globalScene.lockModifierTiers = !globalScene.lockModifierTiers;
    const uiHandler = globalScene.ui.getHandler() as ModifierSelectUiHandler;
    uiHandler.setRerollCost(this.getRerollCost(this.shouldLockRarities()));
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

  private applyPartnerModifier(modifier: Modifier, cost: number, targetPlayerIndex: PlayerIndex): void {
    const result = globalScene.addModifier(modifier, false, true, undefined, undefined, cost, targetPlayerIndex);

    if (cost !== -1) {
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
      this.getRerollCost(this.shouldLockRarities()),
      globalScene.twoPlayerMode && this.hasAvailableTradeTarget(this.playerIndex),
      this.playerIndex,
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
      this.shouldLockRarities() ? this.modifierTiers : undefined,
      this.customModifierSettings,
    );
  }

  private hasLockCapsule(): boolean {
    return !!globalScene.findModifierForPlayer(m => m instanceof LockModifierTiersModifier, this.playerIndex);
  }

  private shouldLockRarities(): boolean {
    return globalScene.lockModifierTiers && this.hasLockCapsule();
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
