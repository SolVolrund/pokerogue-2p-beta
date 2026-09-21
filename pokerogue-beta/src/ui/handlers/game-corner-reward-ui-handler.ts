import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import type { ModifierTier } from "#enums/modifier-tier";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { ModifierTypeOption } from "#modifiers/modifier-type";
import type { PokemonData } from "#system/pokemon-data";
import { addModifierIconSprite } from "#ui/modifier-icon";
import { addTextObject, getModifierTierTextTint, getTextColor, getTextWithColors } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { formatMoney } from "#utils/common";
import i18next from "i18next";

interface GameCornerRewardSlotBase {
  tier: ModifierTier;
  cost: number;
  purchased: boolean;
  layout?: { col: number; row: number };
}

export interface GameCornerItemRewardSlot extends GameCornerRewardSlotBase {
  kind: "item";
  option: ModifierTypeOption;
}

export interface GameCornerPokemonRewardSlot extends GameCornerRewardSlotBase {
  kind: "pokemon";
  pokemon: PokemonData;
  pokemonName: string;
  iconAtlas: string;
  iconFrame: string;
  fallbackIconAtlas: string;
  fallbackIconFrame: string;
  minStarterCost: number;
  maxStarterCost: number;
  jackpot: boolean;
}

export type GameCornerRewardSlot = GameCornerItemRewardSlot | GameCornerPokemonRewardSlot;

export interface GameCornerRewardUiConfig {
  slots: GameCornerRewardSlot[];
  nuggies: number;
  cashOutAmount: number;
  onSelectPrize: (slotIndex: number) => boolean;
  onCashOut: () => boolean;
}

interface PrizeCell {
  container: Phaser.GameObjects.Container;
  costText: Phaser.GameObjects.Text;
  nameText: Phaser.GameObjects.Text;
  soldText: Phaser.GameObjects.Text;
  slotIndex: number;
}

interface NavPoint {
  col: number;
  row: number;
  cursorX: number;
  cursorY: number;
  cursorScale: number;
  kind: "prize" | "cashOut";
  slotIndex?: number;
}

const PRIZE_COLUMNS = 5;
const PRIZE_ROWS_BY_COLUMN = [5, 4, 3, 2, 1];
const PRIZE_ROW_Y = [-150, -129, -108, -87, -66];
const PRIZE_CLUSTER_SCALE = 0.47;
const PRIZE_ICON_SCALE = 0.8;
const PRIZE_POKEMON_ICON_SCALE = 1.05;
const PRIZE_TEXT_FONT_SIZE = "54px";
const PRIZE_TEXT_Y = 8;
const PRIZE_TEXT_GAP = 5;
const PRIZE_NAME_MAX_LENGTH = 11;
const CASH_OUT_Y = -66;

export class GameCornerRewardUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container | undefined;
  private cursorObj: Phaser.GameObjects.Image | undefined;
  private config: GameCornerRewardUiConfig | undefined;
  private prizeCells: PrizeCell[] = [];
  private navPoints: NavPoint[] = [];
  private cursorIndex = 0;
  private nuggiesText: Phaser.GameObjects.Text | undefined;
  private cashOutText: Phaser.GameObjects.Text | undefined;

  constructor() {
    super(UiMode.GAME_CORNER_REWARD);
  }

  setup(): void {}

  show(args: any[]): boolean {
    this.clear();
    super.show(args);

    this.config = args[0] as GameCornerRewardUiConfig | undefined;
    if (!this.config) {
      return false;
    }

    this.buildUi();
    this.showMessageWindow();
    globalScene.showShopOverlay(750 * globalScene.gameSpeed);
    globalScene.updateAndShowText(750);
    globalScene.updateBiomeWaveText();
    globalScene.updateMoneyText();
    this.refresh(this.config.nuggies, this.config.cashOutAmount);
    return true;
  }

  processInput(button: Button): boolean {
    if (!this.active || !this.config || this.navPoints.length === 0) {
      return false;
    }

    let success = false;
    switch (button) {
      case Button.UP:
        success = this.moveCursor(0, -1);
        break;
      case Button.DOWN:
        success = this.moveCursor(0, 1);
        break;
      case Button.LEFT:
        success = this.moveCursor(-1, 0);
        break;
      case Button.RIGHT:
        success = this.moveCursor(1, 0);
        break;
      case Button.ACTION:
        success = this.activateSelection();
        break;
      case Button.CANCEL:
        success = this.config.onCashOut();
        break;
    }

    if (success) {
      this.getUi().playSelect();
    }

    return success;
  }

  refresh(nuggies: number, cashOutAmount: number): void {
    if (!this.config) {
      return;
    }

    this.config.nuggies = nuggies;
    this.config.cashOutAmount = cashOutAmount;
    this.nuggiesText?.setText(i18next.t("mysteryEncounters/gameCorner:rewardCounter.nuggies", { amount: nuggies }));
    this.cashOutText?.setText(
      i18next.t("mysteryEncounters/gameCorner:rewardCounter.cashOutValue", {
        amount: formatMoney(globalScene.moneyFormat, cashOutAmount),
      }),
    );

    this.prizeCells.forEach(cell => {
      const slot = this.config!.slots[cell.slotIndex];
      const canAfford = nuggies >= slot.cost;
      cell.container.setAlpha(slot.purchased ? 0.35 : 1);
      cell.soldText.setVisible(slot.purchased);
      cell.nameText.setVisible(!slot.purchased);
      cell.costText.setVisible(!slot.purchased);
      cell.costText.setColor(getTextColor(canAfford ? TextStyle.MONEY : TextStyle.PARTY_RED));
      cell.costText.setShadowColor(getTextColor(canAfford ? TextStyle.MONEY : TextStyle.PARTY_RED, true));
    });

    this.navPoints = this.buildNavPoints();
    this.cursorIndex = Math.min(this.cursorIndex, Math.max(0, this.navPoints.length - 1));
    this.setPrizeCursor(this.cursorIndex);
  }

  clear(): void {
    super.clear();
    this.container?.destroy(true);
    this.container = undefined;
    this.cursorObj = undefined;
    this.config = undefined;
    this.prizeCells = [];
    this.navPoints = [];
    this.cursorIndex = 0;
    this.nuggiesText = undefined;
    this.cashOutText = undefined;
    this.getUi().getMessageHandler().restoreBattleUiLayering();
    this.getUi().clearText();
    globalScene.hideShopOverlay(750 * globalScene.gameSpeed);
    globalScene.hideLuckText(250);
  }

  private buildUi(): void {
    if (!this.config) {
      return;
    }

    this.container = globalScene.add.container(0, 0);
    this.getUi().add(this.container);

    const title = addTextObject(8, -176, i18next.t("mysteryEncounters/gameCorner:rewardCounter.title"), TextStyle.WINDOW);
    this.container.add(title);

    this.nuggiesText = addTextObject(170, -176, "", TextStyle.MONEY);
    this.container.add(this.nuggiesText);

    this.buildPrizeCells();
    this.buildCashOutCell();

    this.cursorObj = globalScene.add.image(0, 0, "cursor");
    this.container.add(this.cursorObj);
  }

  private buildPrizeCells(): void {
    this.config?.slots.forEach((slot, slotIndex) => {
      const { x, y } = this.getSlotPosition(slotIndex);

      const cell = globalScene.add.container(x, y);
      cell.setScale(PRIZE_CLUSTER_SCALE);

      cell.add(this.createPrizeIcon(slot));

      const costText = addTextObject(0, PRIZE_TEXT_Y, `x${slot.cost}`, TextStyle.MONEY, {
        fontSize: PRIZE_TEXT_FONT_SIZE,
      });
      costText.setOrigin(0, 0);
      cell.add(costText);

      const nameText = addTextObject(0, PRIZE_TEXT_Y, this.formatPrizeName(this.getPrizeName(slot)), TextStyle.PARTY, {
        fontSize: PRIZE_TEXT_FONT_SIZE,
      });
      nameText.setOrigin(0, 0);
      nameText.setTint(getModifierTierTextTint(slot.tier));
      cell.add(nameText);
      this.positionInlinePrizeText(costText, nameText);

      const soldText = addTextObject(0, PRIZE_TEXT_Y, i18next.t("mysteryEncounters/gameCorner:rewardCounter.sold"), TextStyle.PARTY_RED, {
        align: "center",
        fontSize: PRIZE_TEXT_FONT_SIZE,
      });
      soldText.setOrigin(0.5, 0);
      soldText.setVisible(false);
      cell.add(soldText);

      this.container?.add(cell);
      this.prizeCells.push({
        container: cell,
        costText,
        nameText,
        soldText,
        slotIndex,
      });
    });
  }

  private createPrizeIcon(slot: GameCornerRewardSlot): Phaser.GameObjects.GameObject {
    if (slot.kind === "item") {
      const icon = addModifierIconSprite(0, -6, slot.option.type.iconImage);
      icon.setScale(PRIZE_ICON_SCALE);
      return icon;
    }

    const icon = globalScene.add.sprite(0, -8, slot.iconAtlas, slot.iconFrame);
    if (icon.frame.name !== slot.iconFrame) {
      icon.setTexture(slot.fallbackIconAtlas, slot.fallbackIconFrame);
      icon.setFrame(slot.fallbackIconFrame);
    }
    icon.setOrigin(0.5, 0.5);
    icon.setScale(PRIZE_POKEMON_ICON_SCALE);
    return icon;
  }

  private buildCashOutCell(): void {
    const x = globalScene.scaledCanvas.width - 8;
    const cashOutCell = globalScene.add.container(x, CASH_OUT_Y);

    const cashOutLabel = addTextObject(
      0,
      -1,
      i18next.t("mysteryEncounters/gameCorner:rewardCounter.cashOut"),
      TextStyle.WINDOW,
      {
        fontSize: "64px",
      },
    );
    cashOutLabel.setOrigin(1, 0);
    cashOutCell.add(cashOutLabel);

    this.cashOutText = addTextObject(0, 10, "", TextStyle.MONEY, {
      align: "right",
      fontSize: "56px",
    });
    this.cashOutText.setOrigin(1, 0);
    cashOutCell.add(this.cashOutText);

    this.container?.add(cashOutCell);
  }

  private buildNavPoints(): NavPoint[] {
    const points: NavPoint[] = [];
    this.config?.slots.forEach((slot, slotIndex) => {
      if (slot.purchased) {
        return;
      }
      const { col, row, x, y } = this.getSlotPosition(slotIndex);
      points.push({
        col,
        row,
        cursorX: x - 20,
        cursorY: y + 4,
        cursorScale: 1,
        kind: "prize",
        slotIndex,
      });
    });

    points.push({
      col: 4,
      row: PRIZE_ROW_Y.length,
      cursorX: globalScene.scaledCanvas.width - 75,
      cursorY: CASH_OUT_Y + 6,
      cursorScale: 1.25,
      kind: "cashOut",
    });

    return points;
  }

  private moveCursor(dx: number, dy: number): boolean {
    const current = this.navPoints[this.cursorIndex];
    if (!current) {
      return false;
    }

    let candidates = this.navPoints.filter(point => {
      if (dx < 0) {
        return point.row === current.row && point.col < current.col;
      }
      if (dx > 0) {
        return point.row === current.row && point.col > current.col;
      }
      if (dy < 0) {
        return point.col === current.col && point.row < current.row;
      }
      if (dy > 0) {
        return point.col === current.col && point.row > current.row;
      }
      return false;
    });

    if (candidates.length === 0 && dy > 0 && current.kind === "prize") {
      candidates = this.navPoints.filter(point => point.kind === "cashOut");
    }

    if (candidates.length === 0) {
      return false;
    }

    candidates.sort((a, b) =>
      Math.abs(a.col - current.col) + Math.abs(a.row - current.row)
      - (Math.abs(b.col - current.col) + Math.abs(b.row - current.row)),
    );

    return this.setPrizeCursor(this.navPoints.indexOf(candidates[0]));
  }

  private setPrizeCursor(cursor: number): boolean {
    const point = this.navPoints[cursor];
    if (!point || !this.cursorObj) {
      return false;
    }

    const changed = this.cursorIndex !== cursor;
    this.cursorIndex = cursor;
    this.cursorObj.setPosition(point.cursorX, point.cursorY);
    this.cursorObj.setScale(point.cursorScale);

    this.showSelectionText(point);
    return changed;
  }

  private showSelectionText(point: NavPoint): void {
    if (!this.config) {
      return;
    }

    this.showMessageWindow();

    if (point.kind === "cashOut") {
      this.getUi().showText(i18next.t("mysteryEncounters/gameCorner:rewardCounter.cashOutDesc"));
      return;
    }

    const slot = this.config.slots[point.slotIndex!];
    const canAfford = this.config.nuggies >= slot.cost;
    if (slot.kind === "item") {
      this.getUi().showText(
        i18next.t("mysteryEncounters/gameCorner:rewardCounter.prizeDesc", {
          description: slot.option.type.getDescription(),
        }),
      );

      this.getUi().getMessageHandler().showNameTextWithIconPair(
        getTextWithColors(`@[${canAfford ? "MONEY" : "PARTY_RED"}]{x${slot.cost}} =`, TextStyle.MESSAGE, true),
        "nugget",
        slot.option.type.name,
        slot.option.type.iconImage,
      );
      return;
    }

    this.getUi().showText(
      i18next.t(
        `mysteryEncounters/gameCorner:rewardCounter.${slot.jackpot ? "jackpotShadowPrizeDesc" : "shadowPrizeDesc"}`,
        {
          pokemonName: slot.pokemonName,
          minStarterCost: slot.minStarterCost,
          maxStarterCost: slot.maxStarterCost,
        },
      ),
    );

    this.getUi().getMessageHandler().showNameText(
      getTextWithColors(
        `@[${canAfford ? "MONEY" : "PARTY_RED"}]{x${slot.cost}} = ${slot.pokemonName}`,
        TextStyle.MESSAGE,
        true,
      ),
      "nugget",
    );
  }

  private activateSelection(): boolean {
    const point = this.navPoints[this.cursorIndex];
    if (!point || !this.config) {
      return false;
    }

    if (point.kind === "cashOut") {
      return this.config.onCashOut();
    }

    return this.config.onSelectPrize(point.slotIndex!);
  }

  private getSlotPosition(slotIndex: number): { col: number; row: number; x: number; y: number } {
    const configuredLayout = this.config?.slots[slotIndex]?.layout;
    if (configuredLayout) {
      return {
        ...configuredLayout,
        x: this.getColumnX(configuredLayout.col),
        y: PRIZE_ROW_Y[configuredLayout.row] ?? PRIZE_ROW_Y[PRIZE_ROW_Y.length - 1],
      };
    }

    let col = 0;
    let row = slotIndex;

    while (col < PRIZE_ROWS_BY_COLUMN.length - 1 && row >= PRIZE_ROWS_BY_COLUMN[col]) {
      row -= PRIZE_ROWS_BY_COLUMN[col];
      col++;
    }

    return {
      col,
      row,
      x: this.getColumnX(col),
      y: PRIZE_ROW_Y[row] ?? PRIZE_ROW_Y[PRIZE_ROW_Y.length - 1],
    };
  }

  private getColumnX(col: number): number {
    if (col >= PRIZE_COLUMNS) {
      return globalScene.scaledCanvas.width - 22;
    }

    const sliceWidth = globalScene.scaledCanvas.width / (PRIZE_COLUMNS + 2);
    return sliceWidth * (col + 1) + sliceWidth * 0.5;
  }

  private formatPrizeName(name: string): string {
    return name.length <= PRIZE_NAME_MAX_LENGTH ? name : `${name.slice(0, PRIZE_NAME_MAX_LENGTH - 3)}...`;
  }

  private getPrizeName(slot: GameCornerRewardSlot): string {
    return slot.kind === "item" ? slot.option.type.name : slot.pokemonName;
  }

  private positionInlinePrizeText(costText: Phaser.GameObjects.Text, nameText: Phaser.GameObjects.Text): void {
    const totalWidth = costText.displayWidth + PRIZE_TEXT_GAP + nameText.displayWidth;
    costText.setPosition(-totalWidth / 2, PRIZE_TEXT_Y);
    nameText.setPosition(costText.x + costText.displayWidth + PRIZE_TEXT_GAP, PRIZE_TEXT_Y);
  }

  private showMessageWindow(): void {
    const messageHandler = this.getUi().getMessageHandler();
    messageHandler.setMessageWindowVisible(true);
    messageHandler.bringMessageToTop();
  }
}
