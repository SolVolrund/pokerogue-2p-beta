import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import type { FusionOptions } from "#data/fusion-options";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { UiMode } from "#enums/ui-mode";
import type { Modifier } from "#modifiers/modifier";
import {
  FusePokemonModifierType,
  getPlayerModifierTypeOptions,
  type ModifierType,
  PokemonModifierType,
  PokemonMoveModifierType,
  PokemonPpRestoreModifierType,
  PokemonPpUpModifierType,
  RememberMoveModifierType,
  regenerateModifierPoolThresholds,
  TmModifierType,
} from "#modifiers/modifier-type";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { updatePlayerMoney } from "#mystery-encounters/encounter-phase-utils";
import { restoreGameCornerBgm } from "#mystery-encounters/game-corner-music";
import { PartyOption, PartyUiMode } from "#ui/party-ui-handler";
import type {
  GameCornerRewardSlot,
  GameCornerRewardUiConfig,
  GameCornerRewardUiHandler,
} from "#ui/game-corner-reward-ui-handler";
import i18next from "i18next";

const namespace = "mysteryEncounters/gameCorner";

const PRIZE_TIERS: ModifierTier[] = [
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.COMMON,
  ModifierTier.GREAT,
  ModifierTier.GREAT,
  ModifierTier.GREAT,
  ModifierTier.GREAT,
  ModifierTier.ULTRA,
  ModifierTier.ULTRA,
  ModifierTier.ULTRA,
  ModifierTier.ROGUE,
  ModifierTier.ROGUE,
  ModifierTier.MASTER,
];

const PRIZE_COSTS: Partial<Record<ModifierTier, number>> = {
  [ModifierTier.COMMON]: 10,
  [ModifierTier.GREAT]: 15,
  [ModifierTier.ULTRA]: 20,
  [ModifierTier.ROGUE]: 25,
  [ModifierTier.MASTER]: 30,
};

export class GameCornerRewardPhase extends Phase {
  public readonly phaseName = "GameCornerRewardPhase";
  private readonly playerIndex: PlayerIndex;
  private readonly queuePostEncounterPhase: boolean;
  private slots: GameCornerRewardSlot[] = [];
  private nuggies: number;
  private complete = false;

  constructor(
    nuggies: number,
    playerIndex: PlayerIndex = globalScene.activePlayerIndex,
    queuePostEncounterPhase = true,
  ) {
    super();
    this.nuggies = nuggies;
    this.playerIndex = playerIndex;
    this.queuePostEncounterPhase = queuePostEncounterPhase;
  }

  start(): void {
    super.start();
    this.setActiveRewardPlayer();
    this.generatePrizes();
    this.showRewardCounter();
  }

  private generatePrizes(): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    regenerateModifierPoolThresholds(party, ModifierPoolType.PLAYER, 0, this.playerIndex);
    const options = getPlayerModifierTypeOptions(PRIZE_TIERS.length, party, undefined, {
      guaranteedModifierTiers: PRIZE_TIERS,
      fillRemaining: false,
      allowLuckUpgrades: false,
      rerollMultiplier: -1,
    });

    this.slots = options.map((option, index) => ({
      option,
      tier: PRIZE_TIERS[index],
      cost: PRIZE_COSTS[PRIZE_TIERS[index]] ?? 10,
      purchased: false,
    }));
  }

  private showRewardCounter(): void {
    if (this.complete) {
      return;
    }

    this.setActiveRewardPlayer();
    void globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig());
  }

  private getUiConfig(): GameCornerRewardUiConfig {
    return {
      slots: this.slots,
      nuggies: this.nuggies,
      cashOutAmount: this.getCashOutPayout(),
      onSelectPrize: slotIndex => this.selectPrize(slotIndex),
      onCashOut: () => this.cashOut(),
    };
  }

  private selectPrize(slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot || slot.purchased) {
      globalScene.ui.playError();
      return false;
    }

    if (this.nuggies < slot.cost) {
      globalScene.ui.showText(i18next.t(`${namespace}:rewardCounter.notEnough`));
      globalScene.ui.playError();
      return false;
    }

    return this.applyChosenModifier(slot.option.type, slotIndex);
  }

  private applyChosenModifier(modifierType: ModifierType, slotIndex: number): boolean {
    if (modifierType instanceof PokemonModifierType) {
      if (modifierType instanceof FusePokemonModifierType) {
        this.openFusionMenu(modifierType, slotIndex);
      } else {
        this.openModifierMenu(modifierType, slotIndex);
      }
      return true;
    }

    return this.applyModifier(modifierType.newModifier(), slotIndex);
  }

  private applyModifier(modifier: Modifier | null, slotIndex: number): boolean {
    const slot = this.slots[slotIndex];
    if (!slot || !modifier) {
      globalScene.ui.playError();
      return false;
    }

    const result = globalScene.addModifier(modifier, false, true, undefined, undefined, undefined, this.playerIndex);
    if (!result) {
      globalScene.ui.playError();
      return false;
    }

    globalScene.dismissEonFluteGuestIfOwnerRevived(this.playerIndex);
    this.nuggies -= slot.cost;
    slot.purchased = true;
    this.refreshRewardCounter();
    globalScene.ui.showText(
      i18next.t(`${namespace}:rewardCounter.purchased`, {
        itemName: slot.option.type.name,
        nuggies: this.nuggies,
      }),
    );
    globalScene.uiInputs?.broadcastTwoPlayerCheckpoint("game-corner-prize-purchased");
    return true;
  }

  private openFusionMenu(modifierType: PokemonModifierType, slotIndex: number): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
    const restoreRewardScreen = () => this.showRewardCounter();
    globalScene.ui
      .setModeWithoutClear(
        UiMode.FUSION_SUMMARY,
        party,
        (fromSlotIndex?: number, spliceSlotIndex?: number, fusionOptions?: FusionOptions) => {
          if (
            spliceSlotIndex !== undefined
            && fromSlotIndex !== undefined
            && fromSlotIndex < 6
            && spliceSlotIndex < 6
            && fromSlotIndex !== spliceSlotIndex
          ) {
            globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig()).then(() => {
              const modifier = modifierType.newModifier(party[fromSlotIndex], party[spliceSlotIndex], fusionOptions);
              this.applyModifier(modifier, slotIndex);
            });
          } else {
            restoreRewardScreen();
          }
        },
        modifierType.selectFilter,
      )
      .then(() => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(this.playerIndex);
        }
      });
  }

  private openModifierMenu(modifierType: PokemonModifierType, slotIndex: number): void {
    const party = globalScene.getPlayerParty(this.playerIndex);
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
    const tmMoveId = isTmModifier ? modifierType.moveId : undefined;

    globalScene.ui
      .setModeWithoutClear(
        UiMode.PARTY,
        partyUiMode,
        this.getFieldSlotForPlayer(this.playerIndex),
        (partyIndex: number, option: PartyOption) => {
          if (partyIndex < 6) {
            globalScene.ui.setMode(UiMode.GAME_CORNER_REWARD, this.getUiConfig()).then(() => {
              const modifier = isMoveModifier
                ? modifierType.newModifier(party[partyIndex], option - PartyOption.MOVE_1)
                : isRememberMoveModifier
                  ? modifierType.newModifier(party[partyIndex], option as number)
                  : modifierType.newModifier(party[partyIndex]);
              this.applyModifier(modifier, slotIndex);
            });
          } else {
            this.showRewardCounter();
          }
        },
        modifierType.selectFilter,
        modifierType instanceof PokemonMoveModifierType ? modifierType.moveSelectFilter : undefined,
        tmMoveId,
        isPpRestoreModifier,
      )
      .then(() => {
        if (globalScene.twoPlayerMode) {
          globalScene.waitForPlayerInput(this.playerIndex);
        }
      });
  }

  private cashOut(): boolean {
    if (this.complete) {
      return false;
    }

    this.complete = true;
    const remainingNuggies = this.nuggies;
    const payout = this.getCashOutPayout();
    this.nuggies = 0;

    if (payout > 0) {
      updatePlayerMoney(payout, true, false);
    }

    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
      showEncounterText(i18next.t(`${namespace}:rewardCounter.cashOutComplete`, {
        amount: payout,
        nuggies: remainingNuggies,
      })).then(() => this.finish());
    });
    return true;
  }

  private finish(): void {
    restoreGameCornerBgm();
    if (this.queuePostEncounterPhase) {
      globalScene.phaseManager.pushNew("PostMysteryEncounterPhase");
    }
    this.end();
  }

  private refreshRewardCounter(): void {
    const handler = globalScene.ui.getHandler<GameCornerRewardUiHandler>();
    handler.refresh(this.nuggies, this.getCashOutPayout());
  }

  private getCashOutPayout(): number {
    if (this.nuggies <= 0) {
      return 0;
    }

    return globalScene.getWaveMoneyAmount(this.nuggies / 64);
  }

  private getFieldSlotForPlayer(playerIndex: PlayerIndex): number {
    const fieldSlot = globalScene.getPlayerFieldOwners().indexOf(playerIndex);
    return fieldSlot > -1 ? fieldSlot : playerIndex;
  }

  private setActiveRewardPlayer(): void {
    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(this.playerIndex);
    } else {
      globalScene.setActivePlayerIndex(this.playerIndex);
    }
  }
}
