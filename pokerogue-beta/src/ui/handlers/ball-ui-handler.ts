import type { PokeballCounts } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokeballAtlasKey, getPokeballName } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import type { PokeballType } from "#enums/pokeball";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { CommandPhase } from "#phases/command-phase";
import { shouldRedactCombatInputOwner } from "#ui/private-input-display";
import { addTextObject, getTextStyleOptions } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { fixedInt } from "#utils/common";
import i18next from "i18next";

export class BallUiHandler extends UiHandler {
  private pokeballSelectContainer: Phaser.GameObjects.Container;
  private pokeballSelectBg: Phaser.GameObjects.NineSlice;
  private optionsText: Phaser.GameObjects.Text;
  private cancelText: Phaser.GameObjects.Text;
  private countsText: Phaser.GameObjects.Text;
  private readonly pokeballImages: Phaser.GameObjects.Image[] = [];
  private pokeballTypes: PokeballType[] = [];

  private cursorObj: Phaser.GameObjects.Image | null;
  private pokeballWiggleTween: Phaser.Tweens.TweenChain | null = null;

  private scale = 0.1666666667;

  constructor() {
    super(UiMode.BALL);
  }

  private getCommandPhase(): CommandPhase {
    return globalScene.phaseManager.getCurrentPhase() as CommandPhase;
  }

  private getPokeballCounts() {
    const commandPhase = this.getCommandPhase();
    const playerIndex = globalScene.getPlayerIndexForFieldSlot(commandPhase.getFieldIndex());
    return globalScene.getPlayerPokeballCounts(playerIndex);
  }

  private getPokeballTypes(pokeballCounts: PokeballCounts): PokeballType[] {
    return Object.keys(pokeballCounts)
      .map(Number)
      .sort((a, b) => a - b) as PokeballType[];
  }

  setup() {
    const ui = this.getUi();

    this.scale = getTextStyleOptions(TextStyle.WINDOW).scale;

    this.optionsText = addTextObject(0, 0, "", TextStyle.WINDOW).setLineSpacing(this.scale * 72);
    this.cancelText = addTextObject(0, 0, i18next.t("commandUiHandler:ballCancel"), TextStyle.WINDOW);
    this.countsText = addTextObject(0, 0, "", TextStyle.WINDOW, { align: "right" }).setLineSpacing(this.scale * 72);
    this.pokeballSelectContainer = globalScene.add.container(0, -49).setVisible(false);
    ui.add(this.pokeballSelectContainer);

    this.pokeballSelectBg = addWindow(0, 0, 114, 32);
    this.pokeballSelectBg.setOrigin(0, 1);
    this.pokeballSelectContainer.add([this.pokeballSelectBg, this.optionsText, this.cancelText, this.countsText]);
    this.updateLayout(globalScene.pokeballCounts);
    this.setCursor(0);
  }

  show(args: any[]): boolean {
    super.show(args);

    this.updateCounts();
    this.pokeballSelectContainer.setVisible(true);
    this.getUi().bringToTop(this.pokeballSelectContainer);
    this.setCursor(this.cursor);

    return true;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    const pokeballCounts = this.getPokeballCounts();
    const pokeballTypes = this.getPokeballTypes(pokeballCounts);
    const pokeballTypeCount = pokeballTypes.length;

    if (button === Button.ACTION || button === Button.CANCEL) {
      const commandPhase = this.getCommandPhase();
      success = true;
      if (button === Button.ACTION && this.cursor < pokeballTypeCount) {
        const pokeballType = pokeballTypes[this.cursor];
        if (pokeballCounts[pokeballType]) {
          if (commandPhase.handleCommand(Command.BALL, pokeballType)) {
            globalScene.ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
            globalScene.ui.setMode(UiMode.MESSAGE);
            success = true;
          }
        } else {
          ui.playError();
        }
      } else {
        ui.setMode(UiMode.COMMAND, commandPhase.getFieldIndex());
        success = true;
      }
    } else {
      switch (button) {
        case Button.UP:
          success = this.setCursor(this.cursor ? this.cursor - 1 : pokeballTypeCount);
          break;
        case Button.DOWN:
          success = this.setCursor(this.cursor < pokeballTypeCount ? this.cursor + 1 : 0);
          break;
      }
    }

    if (success && !shouldRedactCombatInputOwner()) {
      ui.playSelect();
    }

    return success;
  }

  updateCounts() {
    this.updateLayout(this.getPokeballCounts());
  }

  private updateLayout(pokeballCounts: PokeballCounts) {
    const types = this.getPokeballTypes(pokeballCounts);
    if (types.length !== this.pokeballTypes.length || types.some((type, i) => type !== this.pokeballTypes[i])) {
      this.stopPokeballWiggle();
      this.pokeballImages.splice(0).forEach(image => image.destroy());
      this.pokeballTypes = types;
      for (const type of types) {
        const image = globalScene.add.image(0, 0, "pb", getPokeballAtlasKey(type)).setScale(this.scale * 6);
        this.pokeballImages.push(image);
        this.pokeballSelectContainer.add(image);
      }
    }
    this.optionsText.setText(types.map(getPokeballName).join("\n"));
    this.countsText.setText(types.map(type => `×${pokeballCounts[type]}`).join("\n"));
    const contentWidth = Math.max(
      64,
      this.optionsText.displayWidth + 4 + this.countsText.displayWidth,
      this.cancelText.displayWidth,
    );
    this.pokeballSelectBg.setSize(50 + contentWidth, 32 + types.length * 96 * this.scale);
    this.pokeballSelectContainer.setX(globalScene.scaledCanvas.width - 51 - contentWidth);
    this.optionsText.setPositionRelative(this.pokeballSelectBg, 36, 9);
    this.countsText.setPositionRelative(this.pokeballSelectBg, 36 + this.optionsText.displayWidth + 4, 9);
    this.cancelText.setPositionRelative(this.pokeballSelectBg, 18, 9 + types.length * 96 * this.scale);
    this.pokeballImages.forEach((image, i) => {
      image.setPositionRelative(this.pokeballSelectBg, 24, 7 + (48 + i * 96) * this.scale);
    });
  }

  setCursor(cursor: number): boolean {
    this.stopPokeballWiggle();
    const ret = super.setCursor(cursor);

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.pokeballSelectContainer.add(this.cursorObj);
    }

    this.cursorObj.setScale(this.scale * 6);
    this.cursorObj.setPositionRelative(this.pokeballSelectBg, 12, 15 + (6 + this.cursor * 96) * this.scale);
    this.cursorObj.setVisible(!shouldRedactCombatInputOwner());

    if (this.active && !shouldRedactCombatInputOwner() && this.pokeballImages[this.cursor]) {
      this.startPokeballWiggle(this.pokeballImages[this.cursor]);
    }

    return ret;
  }

  private startPokeballWiggle(pokeball: Phaser.GameObjects.Image) {
    const originalX = pokeball.x;
    this.pokeballWiggleTween = globalScene.tweens.chain({
      targets: pokeball,
      loop: -1,
      loopDelay: fixedInt(1000),
      onStop: () => pokeball.setX(originalX).setAngle(0),
      tweens: [
        { x: "+=4", angle: 27.5, duration: fixedInt(150), ease: "Cubic.easeOut", yoyo: true },
        { x: "-=4", angle: -27.5, duration: fixedInt(150), delay: fixedInt(250), ease: "Cubic.easeOut", yoyo: true },
      ],
    });
  }

  private stopPokeballWiggle() {
    this.pokeballWiggleTween?.stop().destroy();
    this.pokeballWiggleTween = null;
  }

  clear() {
    super.clear();
    this.stopPokeballWiggle();
    this.pokeballSelectContainer.setVisible(false);
    this.eraseCursor();
  }

  eraseCursor() {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = null;
  }
}
