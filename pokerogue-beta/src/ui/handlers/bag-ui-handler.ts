import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { getPokeballDescription, getPokeballDisplayName } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { PlayerGender } from "#enums/player-gender";
import type { PokeballType } from "#enums/pokeball";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { BerryModifier, PokemonHeldItemModifier } from "#modifiers/modifier";
import { PokemonPpRestoreModifierType } from "#modifiers/modifier-type";
import type { BagMedicineData, BagTmData } from "#types/save-data";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { addBagTextureFrames } from "#ui/bag-textures";
import type { BattleMessageUiHandler } from "#ui/battle-message-ui-handler";
import { getModifierIconTexture } from "#ui/modifier-icon";
import { ScrollBar } from "#ui/scroll-bar";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import {
  canUseBagMedicine,
  canUseBagTm,
  depositBagItem,
  getBagMedicineType,
  getBagTmType,
  getBagWithdrawCapacity,
  isBagStorable,
  useBagMedicine,
  useBagTm,
  withdrawBagItem,
} from "#utils/item-bag";
import i18next from "i18next";

const POCKETS = ["balls", "held", "berries", "key", "medicine", "tms"] as const;
type BagPocket = (typeof POCKETS)[number];
const ROWS = 5;
const ROW_HEIGHT = 17;
const BAG_COLUMN_X = 124;
const COLUMN_WIDTH = 98;
const HEADER_HEIGHT = 22;
const FOOTER_Y = 132;
const FOOTER_HEIGHT = 48;
const WINDOW_PADDING = 8;
// A flattened oval with the largest bag in front and smaller bags behind it.
const POSITIONS = [
  { x: 62, y: 92, scale: 0.55, state: 3 },
  { x: 100, y: 80, scale: 0.43, state: 2 },
  { x: 100, y: 56, scale: 0.32, state: 1 },
  { x: 62, y: 44, scale: 0.3, state: 1 },
  { x: 24, y: 56, scale: 0.32, state: 1 },
  { x: 24, y: 80, scale: 0.43, state: 2 },
] as const;

interface BagRow {
  name: string;
  icon: string;
  description: string;
  quantity: number;
  maximum?: number;
  item?: PokemonHeldItemModifier;
  medicine?: BagMedicineData;
  tm?: BagTmData;
  enabled: boolean;
}

interface ItemRowView {
  icon: Phaser.GameObjects.Sprite;
  name: Phaser.GameObjects.Text;
  quantity: Phaser.GameObjects.Text;
}

export class BagUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private carousel: Phaser.GameObjects.Container;
  private bags: Phaser.GameObjects.Sprite[] = [];
  private readonly headings: Phaser.GameObjects.Text[] = [];
  private readonly views: ItemRowView[][] = [[], []];
  private readonly emptyLabels: Phaser.GameObjects.Text[] = [];
  private readonly cancelLabels: Phaser.GameObjects.Text[] = [];
  private readonly scrollBars: ScrollBar[] = [];
  private cursorObj: Phaser.GameObjects.Image;
  private descriptionWindow: Phaser.GameObjects.NineSlice;
  private description: Phaser.GameObjects.Text;
  private controls: Phaser.GameObjects.Text;
  private pocketLabel: Phaser.GameObjects.Text;
  private quantityWindow: Phaser.GameObjects.Container;
  private quantityLabel: Phaser.GameObjects.Text;
  private quantityValue: Phaser.GameObjects.Text;
  private playerIndex: PlayerIndex = 0;
  private pokemon: PlayerPokemon;
  private onClose: (() => void) | undefined;
  private pocket = 1;
  private column = 0;
  private selections = [0, 0];
  private scrollOffsets = [0, 0];
  private pending: { item: PokemonHeldItemModifier; quantity: number; maximum: number; column: number } | undefined;

  constructor() {
    super(UiMode.BAG);
  }

  setup(): void {
    addBagTextureFrames();
    this.container = globalScene.add.container(0, -180).setName("item-bag").setVisible(false);
    this.getUi().add(this.container);
    this.container.add(globalScene.add.rectangle(0, 0, 320, 180, 0x10191f).setOrigin(0));
    this.container.add(globalScene.add.image(0, 0, "bag_menu_bg").setOrigin(0).setName("carousel-background"));
    this.carousel = globalScene.add.container(0, 0);
    this.container.add(this.carousel);
    this.bags = POCKETS.map(() => {
      const sprite = globalScene.add.sprite(62, 70, "bag_pockets");
      this.carousel.add(sprite);
      return sprite;
    });
    this.pocketLabel = this.text(62, 120, "", 9).setOrigin(0.5, 0);
    for (let column = 0; column < 2; column++) {
      const x = BAG_COLUMN_X + column * COLUMN_WIDTH;
      this.container.add([
        addWindow(x, 0, COLUMN_WIDTH, HEADER_HEIGHT).setName(`bag-header-${column}`),
        addWindow(x, HEADER_HEIGHT, COLUMN_WIDTH, FOOTER_Y - HEADER_HEIGHT).setName(`bag-list-${column}`),
      ]);
      this.headings[column] = this.text(x + COLUMN_WIDTH / 2, 6, "", 10).setOrigin(0.5, 0);
      for (let row = 0; row < ROWS; row++) {
        const y = HEADER_HEIGHT + 6 + row * ROW_HEIGHT;
        const icon = globalScene.add.sprite(x + 20, y + 8, "items").setScale(0.5);
        this.container.add(icon);
        const name = this.text(x + 31, y, "", 9);
        const quantity = this.text(x + 84, y + 9, "", 7).setOrigin(1, 0);
        this.views[column].push({ icon, name, quantity });
      }
      this.emptyLabels[column] = this.text(x + 49, 62, "", 9).setOrigin(0.5, 0);
      this.cancelLabels[column] = this.text(x + 49, FOOTER_Y - 15, "", 9).setOrigin(0.5, 0);
      const scroll = new ScrollBar(x + 88, HEADER_HEIGHT + 6, 4, ROWS * ROW_HEIGHT - 2, ROWS);
      this.container.add(scroll);
      this.scrollBars.push(scroll);
    }
    this.cursorObj = globalScene.add.image(0, 0, "cursor").setName("item-selection-cursor").setVisible(false);
    this.container.add(this.cursorObj);
    this.command(BAG_COLUMN_X + 9, 6, "<", Button.LEFT);
    this.command(BAG_COLUMN_X + COLUMN_WIDTH - 14, 6, ">", Button.RIGHT);
    this.container.add(addWindow(0, FOOTER_Y, BAG_COLUMN_X, FOOTER_HEIGHT).setName("bag-instructions"));
    this.descriptionWindow = addWindow(BAG_COLUMN_X, FOOTER_Y, COLUMN_WIDTH * 2, FOOTER_HEIGHT).setName(
      "bag-description",
    );
    this.container.add(this.descriptionWindow);
    this.controls = this.text(8, 139, "", 8);
    this.description = this.text(BAG_COLUMN_X + WINDOW_PADDING, 139, "", 9);
    this.quantityWindow = globalScene.add.container(BAG_COLUMN_X + COLUMN_WIDTH, FOOTER_Y).setVisible(false);
    this.quantityWindow.add(addWindow(0, 0, COLUMN_WIDTH, FOOTER_HEIGHT));
    this.quantityLabel = addTextObject(COLUMN_WIDTH / 2, 6, "", TextStyle.WINDOW, { fontSize: 54 }).setOrigin(0.5, 0);
    this.quantityValue = addTextObject(COLUMN_WIDTH / 2, 22, "", TextStyle.WINDOW, { fontSize: 66 }).setOrigin(0.5, 0);
    this.quantityWindow.add([this.quantityLabel, this.quantityValue]);
    this.container.add(this.quantityWindow);
  }

  private text(x: number, y: number, value: string, size: number): Phaser.GameObjects.Text {
    const text = addTextObject(x, y, value, TextStyle.WINDOW, { fontSize: size * 6 }).setOrigin(0);
    this.container.add(text);
    return text;
  }

  private command(x: number, y: number, label: string, button: Button): void {
    this.text(x, y, label, 10)
      .setInteractive({ useHandCursor: true })
      .on("pointerdown", () => {
        if (this.active) {
          globalScene.uiInputs.submitUiButton(button);
        }
      });
  }

  private fitText(text: Phaser.GameObjects.Text, value: string, width: number): void {
    text.setText(value).setScale(1 / 6);
    if (text.displayWidth > width) {
      text.setScale(width / text.width);
    }
  }

  show(args: any[]): boolean {
    const [owner, pokemon, onClose] = args as [PlayerIndex, PlayerPokemon, (() => void) | undefined];
    if (!globalScene.getActivePlayerIndexes().includes(owner) || !globalScene.getPlayerParty(owner).includes(pokemon)) {
      return false;
    }
    super.show(args);
    this.playerIndex = owner;
    this.pokemon = pokemon;
    this.onClose = onClose;
    this.pocket = 1;
    this.column = 0;
    this.selections = [0, 0];
    this.scrollOffsets = [0, 0];
    this.pending = undefined;
    this.container.setVisible(true);
    this.getUi().bringToTop(this.container);
    this.renderCarousel(false);
    this.render();
    return true;
  }

  private getRows(column: number): BagRow[] {
    if (column === 1) {
      return globalScene
        .getPlayerModifiers(this.playerIndex)
        .filter(
          (item): item is PokemonHeldItemModifier =>
            item instanceof PokemonHeldItemModifier && item.pokemonId === this.pokemon.id,
        )
        .map(item => ({
          name: item.type.name,
          icon: item.type.iconImage,
          description: item.type.getDescription(),
          quantity: item.stackCount,
          maximum: item.getMaxHeldItemCount(this.pokemon),
          item,
          enabled: isBagStorable(item) && !item.recoverableBattleTransfer,
        }));
    }
    const pocket: BagPocket = POCKETS[this.pocket];
    if (pocket === "balls") {
      const icons = ["pb", "gb", "ub", "rb", "mb", "kurt_luxury_ball", "glass_ball", "cb", "kurt_safari_ball"];
      const design = globalScene.getPlayerState(this.playerIndex).ballDesign;
      return Object.entries(globalScene.getPlayerPokeballCounts(this.playerIndex))
        .filter(([, count]) => count > 0)
        .map(([id, count]) => ({
          name: getPokeballDisplayName(Number(id) as PokeballType, design),
          icon: icons[Number(id)],
          description: getPokeballDescription(Number(id) as PokeballType, design),
          quantity: count,
          enabled: false,
        }));
    }
    if (pocket === "key") {
      return globalScene
        .getPlayerModifiers(this.playerIndex)
        .filter(item => !(item instanceof PokemonHeldItemModifier))
        .map(item => ({
          name: item.type.name,
          icon: item.type.iconImage,
          description: item.type.getDescription(),
          quantity: item.stackCount,
          enabled: false,
        }));
    }
    if (pocket === "medicine") {
      return globalScene.getPlayerBagMedicines(this.playerIndex).flatMap(medicine => {
        const type = getBagMedicineType(medicine);
        return type
          ? [
              {
                name: type.name,
                icon: type.iconImage,
                description: type.getDescription(),
                quantity: medicine.quantity,
                medicine,
                enabled: canUseBagMedicine(this.playerIndex, this.pokemon, medicine),
              },
            ]
          : [];
      });
    }
    if (pocket === "tms") {
      return globalScene.getPlayerBagTms(this.playerIndex).flatMap(tm => {
        const type = getBagTmType(tm);
        return type
          ? [
              {
                name: type.name,
                icon: type.iconImage,
                description: i18next.t("modifierType:ModifierType.TmModifierType.description", {
                  moveName: allMoves[tm.moveId].name,
                }),
                quantity: tm.quantity,
                tm,
                enabled: canUseBagTm(this.playerIndex, this.pokemon, tm),
              },
            ]
          : [];
      });
    }
    return globalScene
      .getPlayerBag(this.playerIndex)
      .filter(item => item instanceof BerryModifier === (pocket === "berries"))
      .map(item => ({
        name: item.type.name,
        icon: item.type.iconImage,
        description: item.type.getDescription(),
        quantity: item.stackCount,
        item,
        enabled: getBagWithdrawCapacity(this.playerIndex, this.pokemon, item) > 0,
      }));
  }

  private renderCarousel(animate: boolean): void {
    const theme = globalScene.getTrainerGender(this.playerIndex) === PlayerGender.FEMALE ? 0 : 1;
    this.bags.forEach((sprite, index) => {
      const position = (index - this.pocket + POCKETS.length) % POCKETS.length;
      const { x, y, scale, state } = POSITIONS[position];
      sprite.setFrame(`${theme}-${index}-${state}`);
      globalScene.tweens.killTweensOf(sprite);
      if (animate) {
        globalScene.tweens.add({
          targets: sprite,
          x,
          y,
          scaleX: scale,
          scaleY: scale,
          duration: 160,
          ease: "Sine.easeOut",
        });
      } else {
        sprite.setPosition(x, y).setScale(scale);
      }
    });
    // Painter's order stays deterministic even while the carousel is moving.
    for (const position of [3, 4, 2, 5, 1, 0]) {
      this.carousel.bringToTop(this.bags[(position + this.pocket) % POCKETS.length]);
    }
  }

  private render(): void {
    const pocketName = i18next.t(`partyUiHandler:bagPockets.${POCKETS[this.pocket]}`);
    this.fitText(this.headings[0], pocketName, 64);
    this.fitText(this.headings[1], this.pokemon.getNameToRender(), COLUMN_WIDTH - WINDOW_PADDING * 2);
    this.fitText(this.pocketLabel, pocketName, 112);
    for (let column = 0; column < 2; column++) {
      const rows = this.getRows(column);
      this.selections[column] = Math.min(this.selections[column], rows.length);
      const selected = this.selections[column];
      this.scrollOffsets[column] = Math.max(0, Math.min(this.scrollOffsets[column], rows.length - ROWS));
      if (selected < rows.length) {
        this.scrollOffsets[column] = Math.max(Math.min(this.scrollOffsets[column], selected), selected - ROWS + 1);
      }
      this.headings[column].setColor(this.column === column ? "#f8e090" : "#b8ccd0");
      this.emptyLabels[column].setText(i18next.t("partyUiHandler:bagEmpty")).setVisible(rows.length === 0);
      this.cancelLabels[column]
        .setText(i18next.t("partyUiHandler:cancelButton"))
        .setColor(this.column === column && selected === rows.length ? "#f8f8f8" : "#b8ccd0");
      this.scrollBars[column].setTotalRows(Math.max(1, rows.length));
      this.scrollBars[column].setScrollCursor(this.scrollOffsets[column]);
      this.views[column].forEach((view, index) => {
        const rowIndex = this.scrollOffsets[column] + index;
        const row = rows[rowIndex];
        view.icon.setVisible(!!row);
        view.name.setVisible(!!row);
        view.quantity.setVisible(!!row);
        if (!row) {
          return;
        }
        view.icon.setTexture(...getModifierIconTexture(row.icon, this.playerIndex));
        this.fitText(view.name, row.name, 55);
        view.name.setColor(row.enabled ? "#f8f8f8" : "#969b9d");
        this.fitText(
          view.quantity,
          row.maximum === undefined ? `x${row.quantity}` : `${row.quantity}/${row.maximum}`,
          60,
        );
      });
    }
    this.cursor = this.selections[this.column];
    const selected = this.getRows(this.column)[this.cursor];
    const cancel = this.cancelLabels[this.column];
    this.cursorObj.setPosition(
      selected ? BAG_COLUMN_X + this.column * COLUMN_WIDTH + 8 : cancel.x - cancel.displayWidth / 2 - 6,
      selected ? HEADER_HEIGHT + 14 + (this.cursor - this.scrollOffsets[this.column]) * ROW_HEIGHT : cancel.y + 7,
    ).setVisible(true);
    const description = selected?.description ?? "";
    const descriptionWidth = this.pending ? COLUMN_WIDTH : COLUMN_WIDTH * 2;
    this.descriptionWindow.setSize(descriptionWidth, FOOTER_HEIGHT);
    const width = descriptionWidth - WINDOW_PADDING * 2;
    this.description
      .setFontSize(54)
      .setScale(1 / 6)
      .setWordWrapWidth(width * 6)
      .setText(description);
    if (this.description.displayHeight > 34) {
      this.description.setFontSize(42);
    }
    // Long descriptions remain contained even in the narrow quantity-confirmation layout.
    if (this.description.displayHeight > 34) {
      this.description.setFontSize((42 * 34) / this.description.displayHeight);
    }
    this.controls.setText(
      i18next.t(this.pending ? "partyUiHandler:bagQuantityControls" : "partyUiHandler:bagControls"),
    );
    this.quantityWindow.setVisible(!!this.pending);
    if (this.pending) {
      this.quantityLabel.setText(i18next.t(this.pending.column ? "partyUiHandler:bagTake" : "partyUiHandler:bagGive"));
      this.quantityValue.setText(`< ${this.pending.quantity} >`);
    }
  }

  processInput(button: Button): boolean {
    if (!this.active) {
      return false;
    }
    if (this.pending) {
      if (button === Button.CANCEL) {
        this.pending = undefined;
      } else if ([Button.LEFT, Button.RIGHT, Button.UP, Button.DOWN].includes(button)) {
        const delta = button === Button.LEFT ? -1 : button === Button.RIGHT ? 1 : button === Button.UP ? 10 : -10;
        this.pending.quantity = Math.max(1, Math.min(this.pending.maximum, this.pending.quantity + delta));
      } else if (button === Button.ACTION || button === Button.SUBMIT) {
        const { item, quantity, column } = this.pending;
        const success = column
          ? depositBagItem(this.playerIndex, this.pokemon, item, quantity)
          : withdrawBagItem(this.playerIndex, this.pokemon, item, quantity);
        if (!success) {
          this.getUi().playError();
        }
        this.pending = undefined;
      } else {
        return false;
      }
    } else if (button === Button.CANCEL) {
      this.close();
      return true;
    } else if (button === Button.STATS) {
      this.column = 1 - this.column;
    } else if (button === Button.LEFT || button === Button.RIGHT) {
      this.pocket = (this.pocket + (button === Button.RIGHT ? 1 : 5)) % POCKETS.length;
      this.selections[0] = 0;
      this.scrollOffsets[0] = 0;
      this.renderCarousel(true);
    } else if (button === Button.UP || button === Button.DOWN) {
      const count = this.getRows(this.column).length + 1;
      this.selections[this.column] = (this.selections[this.column] + (button === Button.DOWN ? 1 : count - 1)) % count;
    } else if (button === Button.ACTION || button === Button.SUBMIT) {
      const row = this.getRows(this.column)[this.selections[this.column]];
      if (!row) {
        this.close();
        return true;
      }
      if (!row.enabled) {
        this.getUi().playError();
        return false;
      }
      if (row.medicine) {
        this.openMedicineMenu(row.medicine);
        return true;
      }
      if (row.tm) {
        this.openTmMenu(row.tm);
        return true;
      }
      if (!row.item) {
        return false;
      }
      const maximum = this.column ? row.quantity : getBagWithdrawCapacity(this.playerIndex, this.pokemon, row.item);
      this.pending = { item: row.item, quantity: 1, maximum, column: this.column };
    } else {
      return false;
    }
    this.getUi().playSelect();
    this.render();
    return true;
  }

  private openMedicineMenu(medicine: BagMedicineData): void {
    const type = getBagMedicineType(medicine);
    if (!type) {
      return;
    }
    const close = () => {
      void this.getUi()
        .revertMode()
        .then(() => this.render());
      return true;
    };
    const apply = (moveIndex?: number) => {
      if (!useBagMedicine(this.playerIndex, this.pokemon, medicine, moveIndex)) {
        return false;
      }
      return close();
    };
    const options: OptionSelectItem[] =
      type instanceof PokemonPpRestoreModifierType
        ? this.pokemon.getMoveset().map((move, index) => ({
            label: `${move.getName()}  ${move.getMovePp() - move.ppUsed}/${move.getMovePp()}`,
            disabled: !canUseBagMedicine(this.playerIndex, this.pokemon, medicine, index),
            style: canUseBagMedicine(this.playerIndex, this.pokemon, medicine, index)
              ? TextStyle.WINDOW
              : TextStyle.SHADOW_TEXT,
            handler: () => apply(index),
          }))
        : [{ label: i18next.t("partyUiHandler:bagUse", { itemName: type.name }), handler: () => apply() }];
    options.push({ label: i18next.t("partyUiHandler:cancelButton"), handler: close });
    this.getUi().playSelect();
    void this.getUi().setOverlayMode(UiMode.OPTION_SELECT, { options });
  }

  private openTmMenu(tm: BagTmData): void {
    const type = getBagTmType(tm);
    if (!type) {
      return;
    }
    const ui = this.getUi();
    const cancel = () => {
      void ui.revertMode().then(() => this.render());
      return true;
    };
    const apply = () => {
      if (!canUseBagTm(this.playerIndex, this.pokemon, tm)) {
        return false;
      }
      void ui.revertMode().then(async () => {
        await ui.setOverlayMode(UiMode.MESSAGE);
        const message = ui.handlers[UiMode.MESSAGE] as BattleMessageUiHandler;
        message.bringMessageToTop();
        const restore = () => {
          void ui.revertMode().then(() => {
            message.restoreBattleUiLayering();
            ui.bringToTop(this.container);
            this.render();
          });
        };
        if (!useBagTm(this.playerIndex, this.pokemon, tm, restore)) {
          ui.playError();
          restore();
        }
      });
      return true;
    };
    ui.playSelect();
    void ui.setOverlayMode(UiMode.OPTION_SELECT, {
      options: [
        { label: i18next.t("partyUiHandler:bagUse", { itemName: type.name }), handler: apply },
        { label: i18next.t("partyUiHandler:cancelButton"), handler: cancel },
      ],
    });
  }

  getTwoPlayerInputContextState(): Record<string, unknown> {
    return {
      playerIndex: this.playerIndex,
      pokemonId: this.pokemon?.id,
      pocket: this.pocket,
      column: this.column,
      selections: [...this.selections],
      quantity: this.pending?.quantity ?? null,
      item: this.pending ? [this.pending.item.type.id, this.pending.item.getArgs()] : null,
    };
  }

  getTwoPlayerInputContextPromptState(): Record<string, unknown> {
    return { playerIndex: this.playerIndex, pokemonId: this.pokemon?.id };
  }

  private close(): void {
    const callback = this.onClose;
    this.getUi().playSelect();
    void this.getUi()
      .revertMode()
      .then(() => callback?.());
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.cursorObj.setVisible(false);
    this.pending = undefined;
    this.onClose = undefined;
    this.bags.forEach(sprite => globalScene.tweens.killTweensOf(sprite));
  }
}
