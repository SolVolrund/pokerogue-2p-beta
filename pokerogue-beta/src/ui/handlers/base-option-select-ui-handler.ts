import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { ScrollBar } from "#ui/scroll-bar";
import { addBBCodeTextObject, getTextColor, getTextStyleOptions } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { argbFromRgba, rgbHexToRgba } from "#utils/color-utils";
import { fixedInt } from "#utils/common";
import BBCodeText from "phaser3-rex-plugins/plugins/gameobjects/tagtext/bbcodetext/BBCodeText";

export interface OptionSelectConfig {
  xOffset?: number;
  yOffset?: number;
  options: OptionSelectItem[];
  maxOptions?: number;
  initialCursor?: number;
  delay?: number;
  noCancel?: boolean;
  supportHover?: boolean;
  gridLayout?: OptionSelectGridLayout;
}

export interface OptionSelectItem {
  label: string;
  handler: () => boolean;
  onHover?: () => void;
  skip?: boolean;
  disabled?: boolean;
  keepOpen?: boolean;
  overrideSound?: boolean;
  style?: TextStyle;
  item?: string;
  itemArgs?: any[];
}

export interface OptionSelectGridLayout {
  rows: number;
  columns?: number;
  slotCount?: number;
  minColumnWidth?: number;
  columnGap?: number;
  centerLastOption?: boolean;
}

export abstract class BaseOptionSelectUiHandler extends UiHandler {
  protected optionSelectContainer: Phaser.GameObjects.Container;
  protected optionSelectTextContainer: Phaser.GameObjects.Container;
  protected optionSelectBg: Phaser.GameObjects.NineSlice;
  protected optionSelectText: BBCodeText;
  protected optionSelectGridTexts: BBCodeText[] = [];
  protected optionSelectIcons: Phaser.GameObjects.Sprite[];

  protected config: OptionSelectConfig | null;

  protected blockInput: boolean;

  protected scrollCursor = 0;
  protected fullCursor = 0;

  protected scale = 0.1666666667;

  private scrollBar: ScrollBar | undefined;

  private get visibleRows(): number {
    const availableHeight = globalScene.scaledCanvas.height - 48 + (this.config?.yOffset ?? 0) - 2;
    const screenRows = Math.max(1, Math.floor(availableHeight / (96 * this.scale)) - 1);
    return Math.max(1, Math.min(this.config?.options.length ?? 1, this.config?.maxOptions ?? screenRows, screenRows));
  }

  private cursorObj: Phaser.GameObjects.Image | null;
  private optionSelectGridPositions = new Map<number, { x: number; y: number }>();

  protected unskippedIndices: number[] = [];

  protected defaultTextStyle: TextStyle = TextStyle.WINDOW;
  protected textContent: string;

  protected abstract getWindowWidth(): number;

  protected getWindowHeight(): number {
    if (this.config?.gridLayout) {
      const rowCount = this.config.gridLayout.rows + (this.config.gridLayout.centerLastOption ? 1 : 0);
      return (rowCount + 1) * 96 * this.scale;
    }

    return (this.visibleRows + 1) * 96 * this.scale;
  }

  public override setup(): void {
    const ui = this.getUi();

    this.optionSelectContainer = globalScene.add.container(globalScene.scaledCanvas.width - 1, -48);
    this.optionSelectContainer.setName(`option-select-${this.mode ? UiMode[this.mode] : "UNKNOWN"}`);
    this.optionSelectContainer.setVisible(false);
    ui.add(this.optionSelectContainer);

    this.optionSelectBg = addWindow(0, 0, this.getWindowWidth(), this.getWindowHeight());
    this.optionSelectBg.setName("option-select-bg");
    this.optionSelectBg.setOrigin(1, 1);
    this.optionSelectContainer.add(this.optionSelectBg);

    this.optionSelectTextContainer = globalScene.add.container(0, 0);
    this.optionSelectContainer.add(this.optionSelectTextContainer);

    this.optionSelectIcons = [];

    this.scale = getTextStyleOptions(TextStyle.WINDOW).scale;

    this.setCursor(0);
  }

  protected setupOptions(): void {
    const configOptions = this.config?.options ?? [];

    const options: OptionSelectItem[] = configOptions;

    this.unskippedIndices = this.getUnskippedIndices(configOptions);
    this.optionSelectGridPositions.clear();
    this.scrollBar?.destroy();
    this.scrollBar = undefined;

    if (this.optionSelectText) {
      if (this.optionSelectText instanceof BBCodeText) {
        try {
          this.optionSelectText.destroy();
        } catch (error) {
          console.error("Error while destroying optionSelectText:", error);
        }
      } else {
        console.warn("optionSelectText is not an instance of BBCodeText.");
      }
      this.optionSelectText = undefined as unknown as BBCodeText;
    }

    if (this.optionSelectIcons?.length > 0) {
      this.optionSelectIcons.forEach(i => i.destroy());
      this.optionSelectIcons.splice(0, this.optionSelectIcons.length);
    }

    if (this.optionSelectGridTexts.length > 0) {
      this.optionSelectGridTexts.forEach(t => t.destroy());
      this.optionSelectGridTexts.splice(0, this.optionSelectGridTexts.length);
    }

    if (this.config?.gridLayout) {
      this.setupGridOptions(options);
      return;
    }

    const optionsWithScroll = this.getOptionsWithScroll();
    const hasItem = options.some(option => !!option.item);

    // Setting the initial text to establish the width of the select object. We consider all options, even ones that are not displayed,
    // Except in the case of autocomplete, where we don't want to set up a text element with potentially hundreds of lines.
    const optionsForWidth = globalScene.ui.getMode() === UiMode.AUTO_COMPLETE ? optionsWithScroll : options;
    this.optionSelectText = addBBCodeTextObject(
      0,
      0,
      optionsForWidth
        .map(o =>
          hasItem
            ? `[shadow=${getTextColor(o.style ?? this.defaultTextStyle, true)}][color=${getTextColor(o.style ?? TextStyle.WINDOW, false)}]    ${o.label}[/color][/shadow]`
            : `[shadow=${getTextColor(o.style ?? this.defaultTextStyle, true)}][color=${getTextColor(o.style ?? TextStyle.WINDOW, false)}]${o.label}[/color][/shadow]`,
        )
        .join("\n"),
      TextStyle.WINDOW,
      { maxLines: options.length, lineSpacing: 12 },
    );
    this.optionSelectText.setOrigin(0, 0);
    this.optionSelectText.setName("text-option-select");
    this.optionSelectTextContainer.add(this.optionSelectText);
    this.optionSelectContainer.setPosition(
      globalScene.scaledCanvas.width - 1 - (this.config?.xOffset || 0),
      -48 + (this.config?.yOffset || 0),
    );
    const isScrollable = options.length > this.visibleRows;
    this.optionSelectBg.width = Math.max(
      this.optionSelectText.displayWidth + 24 + (isScrollable ? 8 : 0),
      this.getWindowWidth(),
    );
    this.optionSelectBg.height = this.getWindowHeight();
    this.optionSelectTextContainer.setPosition(
      this.optionSelectBg.x - this.optionSelectBg.width + 12 + 24 * this.scale,
      this.optionSelectBg.y - this.optionSelectBg.height + 2 + 42 * this.scale,
    );

    // Now that the container and background widths are established, we can set up the proper text restricted to visible options
    this.textContent = optionsWithScroll
      .map(o =>
        hasItem
          ? `[shadow=${getTextColor(o.style ?? this.defaultTextStyle, true)}][color=${getTextColor(o.style ?? TextStyle.WINDOW, false)}]    ${o.label}[/color][/shadow]`
          : `[shadow=${getTextColor(o.style ?? this.defaultTextStyle, true)}][color=${getTextColor(o.style ?? TextStyle.WINDOW, false)}]${o.label}[/color][/shadow]`,
      )
      .join("\n");
    this.optionSelectText.setText(this.textContent);

    if (isScrollable) {
      this.scrollBar = new ScrollBar(
        -10,
        -this.optionSelectBg.height + 6,
        4,
        this.optionSelectBg.height - 12,
        this.visibleRows,
      );
      this.optionSelectContainer.add(this.scrollBar);
      this.scrollBar.setTotalRows(options.length);
      this.scrollBar.setScrollCursor(this.scrollCursor);
    }

    optionsWithScroll.forEach((option: OptionSelectItem, i: number) => {
      if (option.item) {
        const itemIcon = globalScene.add.sprite(0, 0, "items", option.item);
        itemIcon.setScale(3 * this.scale);
        this.optionSelectIcons.push(itemIcon);

        this.optionSelectTextContainer.add(itemIcon);

        itemIcon.setPositionRelative(this.optionSelectText, 36 * this.scale, 7 + i * (114 * this.scale - 3));

        if (option.item === "candy") {
          const itemOverlayIcon = globalScene.add.sprite(0, 0, "items", "candy_overlay");
          itemOverlayIcon.setScale(3 * this.scale);
          this.optionSelectIcons.push(itemOverlayIcon);

          this.optionSelectTextContainer.add(itemOverlayIcon);

          itemOverlayIcon.setPositionRelative(this.optionSelectText, 36 * this.scale, 7 + i * (114 * this.scale - 3));

          if (option.itemArgs) {
            itemIcon.setTint(argbFromRgba(rgbHexToRgba(option.itemArgs[0])));
            itemOverlayIcon.setTint(argbFromRgba(rgbHexToRgba(option.itemArgs[1])));
          }
        }
      }
    });
  }

  private setupGridOptions(options: OptionSelectItem[]): void {
    const gridLayout = this.config!.gridLayout!;
    const rowCount = Math.max(1, gridLayout.rows);
    const centeredOptionCount = gridLayout.centerLastOption ? 1 : 0;
    const slotCount = gridLayout.slotCount ?? Math.max(0, options.length - centeredOptionCount);
    const columnCount = Math.max(1, gridLayout.columns ?? Math.ceil(slotCount / rowCount));
    const lineSpacing = 114 * this.scale - 3;
    const minColumnWidth = gridLayout.minColumnWidth ?? 20;
    const columnGap = gridLayout.columnGap ?? 8;
    const columnWidths = new Array(columnCount).fill(minColumnWidth);
    const slotEntries: Array<{
      optionIndex: number;
      option: OptionSelectItem;
      text: BBCodeText;
      column: number;
      row: number;
    }> = [];

    for (let optionIndex = 0; optionIndex < slotCount; optionIndex++) {
      const option = options[optionIndex];
      const column = Math.floor(optionIndex / rowCount);
      const row = optionIndex % rowCount;
      if (!option || column >= columnCount) {
        continue;
      }

      const optionText = this.createOptionText(option);
      optionText.setPosition(0, row * lineSpacing);
      this.optionSelectGridTexts.push(optionText);
      this.optionSelectTextContainer.add(optionText);
      slotEntries.push({ optionIndex, option, text: optionText, column, row });
      columnWidths[column] = Math.max(columnWidths[column], optionText.displayWidth + columnGap);
    }

    const columnXPositions = columnWidths.map((_, column) =>
      columnWidths.slice(0, column).reduce((totalWidth, columnWidth) => totalWidth + columnWidth, 0),
    );
    const gridWidth = columnWidths.reduce((totalWidth, columnWidth) => totalWidth + columnWidth, 0) - columnGap;

    slotEntries.forEach(entry => {
      const x = columnXPositions[entry.column];
      const y = entry.row * lineSpacing;
      entry.text.setPosition(x, y);
      this.createGridOptionIcons(entry.option, x, y);
      this.optionSelectGridPositions.set(entry.optionIndex, { x, y });
    });

    if (gridLayout.centerLastOption) {
      const optionIndex = options.length - 1;
      const option = options[optionIndex];
      if (option) {
        const optionText = this.createOptionText(option);
        const x = Math.max(0, Math.floor((gridWidth - optionText.displayWidth) / 2));
        const y = rowCount * lineSpacing;
        optionText.setPosition(x, y);
        this.optionSelectGridTexts.push(optionText);
        this.optionSelectTextContainer.add(optionText);
        this.createGridOptionIcons(option, x, y);
        this.optionSelectGridPositions.set(optionIndex, { x, y });
      }
    }

    this.optionSelectContainer.setPosition(
      globalScene.scaledCanvas.width - 1 - (this.config?.xOffset || 0),
      -48 + (this.config?.yOffset || 0),
    );
    this.optionSelectBg.width = Math.max(gridWidth + 24, this.getWindowWidth());
    this.optionSelectBg.height = this.getWindowHeight();
    this.optionSelectTextContainer.setPosition(
      this.optionSelectBg.x - this.optionSelectBg.width + 12 + 24 * this.scale,
      this.optionSelectBg.y - this.optionSelectBg.height + 2 + 42 * this.scale,
    );
  }

  private createOptionText(option: OptionSelectItem): BBCodeText {
    const style = option.style ?? this.defaultTextStyle;
    const label = option.item ? `    ${option.label}` : option.label;
    const optionText = addBBCodeTextObject(
      0,
      0,
      `[shadow=${getTextColor(style, true)}][color=${getTextColor(style, false)}]${label}[/color][/shadow]`,
      TextStyle.WINDOW,
      { maxLines: 1, lineSpacing: 12 },
    );
    optionText.setOrigin(0, 0);
    optionText.setName("text-option-select-grid");
    return optionText;
  }

  private createGridOptionIcons(option: OptionSelectItem, x: number, y: number): void {
    if (!option.item) {
      return;
    }

    const itemIcon = globalScene.add.sprite(x + 36 * this.scale, y + 7, "items", option.item);
    itemIcon.setScale(3 * this.scale);
    this.optionSelectIcons.push(itemIcon);
    this.optionSelectTextContainer.add(itemIcon);

    if (option.item !== "candy") {
      return;
    }

    const itemOverlayIcon = globalScene.add.sprite(x + 36 * this.scale, y + 7, "items", "candy_overlay");
    itemOverlayIcon.setScale(3 * this.scale);
    this.optionSelectIcons.push(itemOverlayIcon);
    this.optionSelectTextContainer.add(itemOverlayIcon);

    if (option.itemArgs) {
      itemIcon.setTint(argbFromRgba(rgbHexToRgba(option.itemArgs[0])));
      itemOverlayIcon.setTint(argbFromRgba(rgbHexToRgba(option.itemArgs[1])));
    }
  }

  public override show(args: any[]): boolean {
    if (args.length === 0 || !Object.hasOwn(args[0], "options") || args[0].options.length === 0) {
      return false;
    }

    super.show(args);

    this.config = args[0] as OptionSelectConfig;
    this.scrollCursor = 0;
    this.fullCursor = 0;
    this.blockInput = false;
    this.optionSelectTextContainer.setAlpha(1);
    this.setupOptions();

    globalScene.ui.bringToTop(this.optionSelectContainer);

    this.optionSelectContainer.setVisible(true);
    this.scrollCursor = 0;
    this.fullCursor = 0;
    const initialCursor = Math.max(
      0,
      Math.min(this.unskippedIndices.length - 1, Math.trunc(this.config.initialCursor ?? 0)),
    );
    this.setCursor(initialCursor);

    if (this.config.delay) {
      this.blockInput = true;
      this.optionSelectTextContainer.setAlpha(0.5);
      this.cursorObj?.setAlpha(0.8);
      globalScene.time.delayedCall(fixedInt(this.config.delay), () => this.unblockInput());
    }

    if (this.config?.supportHover) {
      // handle hover code if the element supports hover-handlers and the option has the optional hover-handler set.
      this.config?.options[this.unskippedIndices[this.fullCursor]]?.onHover?.();
    }

    return true;
  }

  public override processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    let playSound = true;

    if (button === Button.ACTION || button === Button.CANCEL) {
      if (this.blockInput) {
        ui.playError();
        return false;
      }

      success = true;
      if (button === Button.CANCEL) {
        if (this.config?.noCancel) {
          return false;
        }
        this.setCursor(this.unskippedIndices.length - 1);
      }
      const option = this.config?.options[this.unskippedIndices[this.fullCursor]];
      if (option && !option.disabled && !option.skip && option.handler()) {
        if (!option.keepOpen) {
          this.clear();
        }
        playSound = !option.overrideSound;
      } else {
        ui.playError();
      }
    } else if (button === Button.SUBMIT && ui.getMode() === UiMode.AUTO_COMPLETE) {
      // this is here to differentiate between a Button.SUBMIT vs Button.ACTION within the autocomplete handler
      // this is here because Button.ACTION is picked up as z on the keyboard, meaning if you're typing and hit z, it'll select the option you've chosen
      success = true;
      const option = this.config?.options[this.unskippedIndices[this.fullCursor]];
      if (option?.handler()) {
        if (!option.keepOpen) {
          this.clear();
        }
        playSound = !option.overrideSound;
      } else {
        ui.playError();
      }
    } else {
      success = this.config?.gridLayout ? this.processGridInput(button) : this.processListInput(button);
      if (this.config?.supportHover) {
        // handle hover code if the element supports hover-handlers and the option has the optional hover-handler set.
        this.config?.options[this.unskippedIndices[this.fullCursor]]?.onHover?.();
      }
    }

    if (success && playSound) {
      ui.playSelect();
    }

    return success;
  }

  private processListInput(button: Button): boolean {
    switch (button) {
      case Button.UP:
        if (this.fullCursor === 0) {
          return this.setCursor(this.unskippedIndices.length - 1);
        }
        if (this.fullCursor) {
          return this.setCursor(this.fullCursor - 1);
        }
        break;
      case Button.DOWN:
        if (this.fullCursor < this.unskippedIndices.length - 1) {
          return this.setCursor(this.fullCursor + 1);
        }
        return this.setCursor(0);
    }

    return false;
  }

  private processGridInput(button: Button): boolean {
    const optionIndex = this.unskippedIndices[this.fullCursor];
    const targetOptionIndex = this.getGridNavigationTarget(optionIndex, button);
    if (targetOptionIndex === null) {
      return false;
    }

    const targetCursor = this.unskippedIndices.indexOf(targetOptionIndex);
    return targetCursor > -1 ? this.setCursor(targetCursor) : false;
  }

  private getGridNavigationTarget(optionIndex: number, button: Button): number | null {
    const gridLayout = this.config!.gridLayout!;
    const rowCount = Math.max(1, gridLayout.rows);
    const centeredOptionCount = gridLayout.centerLastOption ? 1 : 0;
    const slotCount = gridLayout.slotCount ?? Math.max(0, this.config!.options.length - centeredOptionCount);
    const columnCount = Math.max(1, gridLayout.columns ?? Math.ceil(slotCount / rowCount));
    const centeredOptionIndex = gridLayout.centerLastOption ? this.config!.options.length - 1 : -1;

    if (optionIndex === centeredOptionIndex) {
      if (button === Button.UP) {
        return this.findLastSelectableSlot(slotCount);
      }
      return null;
    }

    const column = Math.floor(optionIndex / rowCount);
    const row = optionIndex % rowCount;

    switch (button) {
      case Button.UP:
        return this.findSelectableInColumn(column, row - 1, -1, rowCount) ?? centeredOptionIndex;
      case Button.DOWN:
        return this.findSelectableInColumn(column, row + 1, 1, rowCount) ?? centeredOptionIndex;
      case Button.LEFT:
        return this.findSelectableInNearestColumn(column - 1, -1, row, columnCount, rowCount, slotCount);
      case Button.RIGHT:
        return this.findSelectableInNearestColumn(column + 1, 1, row, columnCount, rowCount, slotCount);
    }

    return null;
  }

  private findSelectableInColumn(column: number, startRow: number, direction: 1 | -1, rowCount: number): number | null {
    for (let row = startRow; row >= 0 && row < rowCount; row += direction) {
      const optionIndex = column * rowCount + row;
      if (this.isSelectableOptionIndex(optionIndex)) {
        return optionIndex;
      }
    }

    return null;
  }

  private findSelectableInNearestColumn(
    startColumn: number,
    direction: 1 | -1,
    row: number,
    columnCount: number,
    rowCount: number,
    slotCount: number,
  ): number | null {
    for (let column = startColumn; column >= 0 && column < columnCount; column += direction) {
      const optionIndex = this.findNearestSelectableInColumn(column, row, rowCount, slotCount);
      if (optionIndex !== null) {
        return optionIndex;
      }
    }

    return null;
  }

  private findNearestSelectableInColumn(
    column: number,
    targetRow: number,
    rowCount: number,
    slotCount: number,
  ): number | null {
    for (let offset = 0; offset < rowCount; offset++) {
      const lowerRow = targetRow - offset;
      const upperRow = targetRow + offset;
      const candidateRows = lowerRow === upperRow ? [targetRow] : [lowerRow, upperRow];

      for (const row of candidateRows) {
        const optionIndex = column * rowCount + row;
        if (row >= 0 && row < rowCount && optionIndex < slotCount && this.isSelectableOptionIndex(optionIndex)) {
          return optionIndex;
        }
      }
    }

    return null;
  }

  private findLastSelectableSlot(slotCount: number): number | null {
    for (let optionIndex = slotCount - 1; optionIndex >= 0; optionIndex--) {
      if (this.isSelectableOptionIndex(optionIndex)) {
        return optionIndex;
      }
    }

    return null;
  }

  private isSelectableOptionIndex(optionIndex: number): boolean {
    const option = this.config?.options[optionIndex];
    return !!option && !option.skip && !option.disabled;
  }

  protected unblockInput(): void {
    if (!this.blockInput) {
      return;
    }

    this.blockInput = false;
    this.optionSelectTextContainer.setAlpha(1);
    this.cursorObj?.setAlpha(1);
  }

  public getOptionsWithScroll(): OptionSelectItem[] {
    return this.config?.options.slice(this.scrollCursor, this.scrollCursor + this.visibleRows) ?? [];
  }

  public getTwoPlayerInputContextState(): Record<string, unknown> {
    return {
      optionIndex: this.unskippedIndices[this.fullCursor] ?? null,
      scrollCursor: this.scrollCursor,
    };
  }

  private getUnskippedIndices(options: OptionSelectItem[]): number[] {
    const unskippedIndices = options
      .map((option, index) => (option.skip || option.disabled ? null : index)) // Map to index or null if skipped
      .filter(index => index !== null) as number[];
    return unskippedIndices;
  }

  public override setCursor(fullCursor: number): boolean {
    this.unskippedIndices = this.getUnskippedIndices(this.config?.options ?? []);
    fullCursor = Math.max(0, Math.min(fullCursor, this.unskippedIndices.length - 1));
    const changed = this.fullCursor !== fullCursor;
    this.fullCursor = fullCursor;
    const optionIndex = this.unskippedIndices[fullCursor] ?? 0;
    if (this.config?.gridLayout) {
      this.scrollCursor = 0;
      this.cursor = optionIndex;
    } else {
      const maxScroll = Math.max(0, (this.config?.options.length ?? 0) - this.visibleRows);
      this.scrollCursor = Math.max(0, Math.min(this.scrollCursor, maxScroll));
      if (optionIndex < this.scrollCursor) {
        this.scrollCursor = optionIndex;
      } else if (optionIndex >= this.scrollCursor + this.visibleRows) {
        this.scrollCursor = optionIndex - this.visibleRows + 1;
      }
      this.cursor = optionIndex - this.scrollCursor;
    }

    this.setupOptions();

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.optionSelectContainer.add(this.cursorObj);
    }

    this.cursorObj.setVisible(this.unskippedIndices.length > 0);
    this.cursorObj.setScale(this.scale * 6);
    if (this.config?.gridLayout) {
      const position = this.optionSelectGridPositions.get(this.unskippedIndices[this.fullCursor]);
      this.cursorObj.setPositionRelative(
        this.optionSelectBg,
        12 + (position?.x ?? 0),
        102 * this.scale + (position?.y ?? 0),
      );
    } else {
      this.cursorObj.setPositionRelative(
        this.optionSelectBg,
        12,
        102 * this.scale + this.cursor * (114 * this.scale - 3),
      );
    }

    return changed;
  }

  public override clear(): void {
    super.clear();
    this.config = null;
    this.optionSelectContainer.setVisible(false);
    this.fullCursor = 0;
    this.scrollCursor = 0;
    this.eraseCursor();
  }

  private eraseCursor(): void {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
