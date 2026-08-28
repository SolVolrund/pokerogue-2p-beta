import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { MappingSettingName } from "#types/configs/inputs";
import type { InputsIcons } from "#ui/base-control-settings-ui-handler";
import { addTextObject, setTextStyle } from "#ui/text";
import { addWindow } from "#ui/ui-theme";
import i18next from "i18next";
import { specialIconKeys, specialIcons } from "./special-icons";

const LEFT = "LEFT";
const RIGHT = "RIGHT";
const LABEL_GAP = 6;
const LABEL_WINDOW_LEFT = 28;
const LABEL_WINDOW_RIGHT_PADDING = 28;

/**
 * Manages navigation and menus tabs within the setting menu.
 */
export class NavigationManager {
  private static instance: NavigationManager;
  public modes: UiMode[];
  public selectedMode: UiMode = UiMode.SETTINGS;
  public navigationMenus: NavigationMenu[] = [];
  public labels: string[];

  /**
   * Creates an instance of NavigationManager.
   * To create a new tab in the menu, add the mode to the modes array and the label to the labels array.
   * and instantiate a new NavigationMenu instance in your handler
   * like: this.navigationContainer = new NavigationMenu(0, 0);
   */
  constructor() {
    this.modes = [
      UiMode.SETTINGS,
      UiMode.SETTINGS_DISPLAY,
      UiMode.SETTINGS_AUDIO,
      UiMode.SETTINGS_EVENTS,
      UiMode.SETTINGS_ITEMS,
      UiMode.SETTINGS_GAMEPAD,
      UiMode.SETTINGS_KEYBOARD,
    ];
    this.labels = [
      i18next.t("settings:general"),
      i18next.t("settings:display"),
      i18next.t("settings:audio"),
      i18next.t("settings:events"),
      "Items",
      i18next.t("settings:gamepad"),
      i18next.t("settings:keyboard"),
    ];
  }

  public reset() {
    this.selectedMode = UiMode.SETTINGS;
    this.updateNavigationMenus();
  }

  /**
   * Gets the singleton instance of the NavigationManager.
   * @returns The singleton instance of NavigationManager.
   */
  public static getInstance(): NavigationManager {
    if (!NavigationManager.instance) {
      NavigationManager.instance = new NavigationManager();
    }
    return NavigationManager.instance;
  }

  /**
   * Navigates modes based on given direction
   * @param direction LEFT or RIGHT
   */
  public navigate(direction) {
    const pos = this.modes.indexOf(this.selectedMode);
    const maxPos = this.modes.length - 1;
    const increment = direction === LEFT ? -1 : 1;
    if (pos === 0 && direction === LEFT) {
      this.selectedMode = this.modes[maxPos];
    } else if (pos === maxPos && direction === RIGHT) {
      this.selectedMode = this.modes[0];
    } else {
      this.selectedMode = this.modes[pos + increment];
    }
    globalScene.ui.setMode(this.selectedMode);
    this.updateNavigationMenus();
  }

  /**
   * Updates all navigation menus.
   */
  public updateNavigationMenus() {
    for (const instance of this.navigationMenus) {
      instance.update();
    }
  }

  /**
   * Updates icons for all navigation menus.
   */
  public updateIcons() {
    for (const instance of this.navigationMenus) {
      instance.updateIcons();
    }
  }

  /**
   * Removes menus from the manager in preparation for reset
   */
  public clearNavigationMenus() {
    this.navigationMenus.length = 0;
  }
}

export class NavigationMenu extends Phaser.GameObjects.Container {
  private navigationIcons: InputsIcons;
  protected headerTitles: Phaser.GameObjects.Text[] = [];
  private headerWidth = 0;

  /**
   * Creates an instance of NavigationMenu.
   * @param x The x position of the NavigationMenu.
   * @param y The y position of the NavigationMenu.
   */
  constructor(x: number, y: number) {
    super(globalScene, x, y);

    this.setup();
  }

  /**
   * Sets up the NavigationMenu by adding windows, icons, and labels.
   */
  setup() {
    const navigationManager = NavigationManager.getInstance();
    const headerBg = addWindow(0, 0, globalScene.scaledCanvas.width - 2, 24);
    headerBg.setOrigin(0, 0);
    this.add(headerBg);
    this.width = headerBg.width;
    this.height = headerBg.height;
    this.headerWidth = headerBg.width;

    this.navigationIcons = {};

    const iconPreviousTab = globalScene.add.sprite(8, 4, "keyboard");
    iconPreviousTab.setOrigin(0, -0.1);
    iconPreviousTab.setPositionRelative(headerBg, 8, 4);
    this.navigationIcons["BUTTON_CYCLE_FORM"] = iconPreviousTab;

    const iconNextTab = globalScene.add.sprite(0, 0, "keyboard");
    iconNextTab.setOrigin(0, -0.1);
    iconNextTab.setPositionRelative(headerBg, headerBg.width - 20, 4);
    this.navigationIcons["BUTTON_CYCLE_SHINY"] = iconNextTab;

    for (const label of navigationManager.labels) {
      const labelText = addTextObject(0, 0, label, TextStyle.SETTINGS_LABEL_NAVBAR);
      labelText.setOrigin(0, 0);
      this.add(labelText);
      this.headerTitles.push(labelText);
    }

    this.add(iconPreviousTab);
    this.add(iconNextTab);
    navigationManager.navigationMenus.push(this);
    navigationManager.updateNavigationMenus();
  }

  /**
   * Updates the NavigationMenu's header titles based on the selected mode.
   */
  update() {
    const navigationManager = NavigationManager.getInstance();
    const posSelected = navigationManager.modes.indexOf(navigationManager.selectedMode);
    const [windowStart, windowEnd] = this.getVisibleTitleWindow(posSelected);
    let x = LABEL_WINDOW_LEFT;

    for (const [index, title] of this.headerTitles.entries()) {
      const visible = index >= windowStart && index <= windowEnd;
      title.setVisible(visible);
      if (visible) {
        title.setPosition(x, 4);
        x += this.getTitleWidth(title) + LABEL_GAP;
      }
      setTextStyle(title, index === posSelected ? TextStyle.SETTINGS_SELECTED : TextStyle.SETTINGS_LABEL);
    }
  }

  private getVisibleTitleWindow(posSelected: number): [number, number] {
    const availableWidth = this.headerWidth - LABEL_WINDOW_LEFT - LABEL_WINDOW_RIGHT_PADDING;
    let windowStart = posSelected;
    let windowEnd = posSelected;
    let usedWidth = this.getTitleWidth(this.headerTitles[posSelected]);

    while (true) {
      const leftCount = posSelected - windowStart;
      const rightCount = windowEnd - posSelected;
      const canGrowLeft =
        windowStart > 0
        && usedWidth + LABEL_GAP + this.getTitleWidth(this.headerTitles[windowStart - 1]) <= availableWidth;
      const canGrowRight =
        windowEnd < this.headerTitles.length - 1
        && usedWidth + LABEL_GAP + this.getTitleWidth(this.headerTitles[windowEnd + 1]) <= availableWidth;

      if (canGrowLeft && (!canGrowRight || leftCount <= rightCount)) {
        windowStart--;
        usedWidth += LABEL_GAP + this.getTitleWidth(this.headerTitles[windowStart]);
      } else if (canGrowRight) {
        windowEnd++;
        usedWidth += LABEL_GAP + this.getTitleWidth(this.headerTitles[windowEnd]);
      } else {
        break;
      }
    }

    return [windowStart, windowEnd];
  }

  private getTitleWidth(title: Phaser.GameObjects.Text): number {
    return title.width / 6;
  }

  /**
   * Updates the icons in the NavigationMenu based on the latest input recorded.
   */
  updateIcons() {
    for (const settingName of Object.keys(this.navigationIcons)) {
      if (specialIconKeys.includes(settingName)) {
        this.navigationIcons[settingName].setTexture("keyboard").setFrame(specialIcons[settingName]).setAlpha(1);
        continue;
      }
      const inputController = globalScene.inputController;
      const icon = inputController?.getIconForLatestInputRecorded(settingName as MappingSettingName);
      const type = inputController?.getLastSourceType();
      if (icon != null && type != null) {
        this.navigationIcons[settingName].setTexture(type).setFrame(icon).setAlpha(1);
      } else {
        this.navigationIcons[settingName].alpha = 0;
      }
    }
  }

  /**
   * Handles navigation based on the button pressed.
   * @param button The button pressed for navigation.
   * @returns A boolean indicating if the navigation was handled.
   */
  navigate(button: Button): boolean {
    const navigationManager = NavigationManager.getInstance();
    switch (button) {
      case Button.CYCLE_FORM:
        navigationManager.navigate(LEFT);
        return true;
      case Button.CYCLE_SHINY:
        navigationManager.navigate(RIGHT);
        return true;
    }
    return false;
  }
}
