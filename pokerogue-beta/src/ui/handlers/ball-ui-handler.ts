import type { PokeballCounts } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { getPokeballAtlasKey, getPokeballDisplayName } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { PartyUiMode } from "#enums/party-ui-mode";
import type { PokeballType } from "#enums/pokeball";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import type { PlayerPokemon } from "#field/pokemon";
import { PokemonPpRestoreModifierType } from "#modifiers/modifier-type";
import { getBattleMenuPhase } from "#ui/battle-menu-phase";
import type { BagMedicineData } from "#types/save-data";
import { getModifierIconTexture } from "#ui/modifier-icon";
import { PartyOption, PartyUiHandler } from "#ui/party-ui-handler";
import { shouldRedactCombatInputOwner } from "#ui/private-input-display";
import { ScrollBar } from "#ui/scroll-bar";
import { addTextObject, getTextStyleOptions } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getAvailableBattleMedicineCount } from "#utils/battle-medicine";
import { fixedInt } from "#utils/common";
import { getAvailableTrainerMedicine } from "#utils/enemy-trainer-medicine";
import { canUseBagMedicine, getBagMedicineType } from "#utils/item-bag";
import i18next from "i18next";

const VISIBLE_BALL_ROWS = 4;
const POCKET_HEADER_HEIGHT = 22;

export class BallUiHandler extends UiHandler {
  private pokeballSelectContainer: Phaser.GameObjects.Container;
  private pokeballSelectBg: Phaser.GameObjects.NineSlice;
  private pocketHeader: Phaser.GameObjects.NineSlice;
  private pocketText: Phaser.GameObjects.Text;
  private pocketLeft: Phaser.GameObjects.Text;
  private pocketRight: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private scrollBar: ScrollBar;
  private optionsText: Phaser.GameObjects.Text;
  private cancelText: Phaser.GameObjects.Text;
  private countsText: Phaser.GameObjects.Text;
  private readonly pokeballImages: Phaser.GameObjects.Image[] = [];
  private pokeballTypes: PokeballType[] = [];
  private ballDesign?: import("#data/ball-design").BallDesign | undefined;
  private pokeballCounts: PokeballCounts | undefined;
  private enemyMedicineOnly = false;
  private pocket: "ball" | "medicine" = "ball";
  private ballCursor = 0;
  private medicineCursor = 0;
  private medicines: BagMedicineData[] = [];
  private readonly medicineImages: Phaser.GameObjects.Image[] = [];
  private scrollOffset = 0;
  private restoreSharedCursor: (() => void) | undefined;

  private cursorObj: Phaser.GameObjects.Image | null;
  private pokeballWiggleTween: Phaser.Tweens.TweenChain | null = null;

  private scale = 0.1666666667;

  constructor() {
    super(UiMode.BALL);
  }

  private getCommandPhase = getBattleMenuPhase;

  private getPokeballCounts() {
    if (this.enemyMedicineOnly) return undefined;
    const commandPhase = this.getCommandPhase();
    const playerIndex = globalScene.getPlayerIndexForFieldSlot(commandPhase.getFieldIndex());
    return globalScene.getPlayerPokeballCounts(playerIndex);
  }

  private getPokeballTypes(pokeballCounts?: PokeballCounts): PokeballType[] {
    return Object.keys(pokeballCounts ?? {})
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
    this.pocketHeader = addWindow(0, 0, 114, POCKET_HEADER_HEIGHT).setOrigin(0, 1);
    this.pocketText = addTextObject(0, 0, "", TextStyle.WINDOW).setOrigin(0.5, 0);
    this.pocketLeft = this.createPocketArrow("<", Button.LEFT);
    this.pocketRight = this.createPocketArrow(">", Button.RIGHT);
    this.emptyText = addTextObject(0, 0, i18next.t("commandUiHandler:emptyPocket"), TextStyle.WINDOW).setOrigin(0.5);
    this.scrollBar = new ScrollBar(0, 0, 4, VISIBLE_BALL_ROWS * 96 * this.scale - 2, VISIBLE_BALL_ROWS);
    this.pokeballSelectContainer.add([
      this.pokeballSelectBg,
      this.pocketHeader,
      this.pocketText,
      this.pocketLeft,
      this.pocketRight,
      this.optionsText,
      this.cancelText,
      this.countsText,
      this.emptyText,
      this.scrollBar,
    ]);
    this.updateLayout(globalScene.pokeballCounts);
    this.setCursor(0);
  }

  show(args: any[]): boolean {
    super.show(args);

    const phase = this.getCommandPhase();
    this.enemyMedicineOnly = phase.is("EnemyCommandPhase") || (phase.is("PrivateFightPhase") && phase.getPokemon().isEnemy());
    if (phase.is("PrivateFightPhase") && !this.restoreSharedCursor) {
      const { ballCursor, medicineCursor, scrollOffset, pocket } = this;
      this.restoreSharedCursor = () => {
        phase.bagCursors.ball = this.ballCursor;
        phase.bagCursors.medicine = this.medicineCursor;
        Object.assign(this, { ballCursor, medicineCursor, scrollOffset, pocket });
      };
      this.ballCursor = phase.bagCursors.ball;
      this.medicineCursor = phase.bagCursors.medicine;
      this.scrollOffset = 0;
    }
    this.pocket = this.enemyMedicineOnly || args[0] === true ? "medicine" : "ball";
    this.cursor = this.pocket === "ball" ? this.ballCursor : this.medicineCursor;
    this.updateCounts();
    this.pokeballSelectContainer.setVisible(!this.enemyMedicineOnly || !shouldRedactCombatInputOwner());
    this.getUi().bringToTop(this.pokeballSelectContainer);
    this.setCursor(this.cursor);

    return true;
  }

  private createPocketArrow(label: string, button: Button): Phaser.GameObjects.Text {
    const arrow = addTextObject(0, 0, label, TextStyle.WINDOW)
      .setOrigin(0.5, 0)
      .setInteractive({ useHandCursor: true });
    arrow.on("pointerdown", () => {
      if (this.active && this.getUi().getHandler() === this) {
        globalScene.uiInputs.submitUiButton(button);
      }
    });
    return arrow;
  }

  processInput(button: Button): boolean {
    const ui = this.getUi();

    let success = false;

    const pokeballCounts = this.getPokeballCounts();
    const pokeballTypes = this.getPokeballTypes(pokeballCounts);
    const pokeballTypeCount = this.pocket === "ball" ? pokeballTypes.length : this.medicines.length;

    if (button === Button.ACTION || button === Button.CANCEL) {
      const commandPhase = this.getCommandPhase();
      success = true;
      if (button === Button.ACTION && this.cursor < pokeballTypeCount) {
        if (this.pocket === "medicine") {
          this.openMedicineTargets(this.medicines[this.cursor]);
          return true;
        }
        const pokeballType = pokeballTypes[this.cursor];
        if (pokeballCounts?.[pokeballType]) {
          if (commandPhase.is("PrivateFightPhase")) return commandPhase.chooseBall(pokeballType);
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
        case Button.LEFT:
        case Button.RIGHT:
          if (this.enemyMedicineOnly) return false;
          this.pocket = this.pocket === "ball" ? "medicine" : "ball";
          this.updateLayout(pokeballCounts, this.ballDesign);
          this.setCursor(this.pocket === "ball" ? this.ballCursor : this.medicineCursor);
          success = true;
          break;
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
    const command = this.getCommandPhase();
    let design: typeof this.ballDesign;
    const actor = this.enemyMedicineOnly ? command.getPokemon() : undefined;
    if (actor?.isEnemy()) {
      const counts = new Map<string, number>();
      for (const id of getAvailableTrainerMedicine(actor)) counts.set(id, (counts.get(id) ?? 0) + 1);
      this.medicines = Array.from(counts, ([typeId, quantity]) => ({ typeId, quantity })).filter(item => getBagMedicineType(item));
    } else {
      const owner = globalScene.getPlayerIndexForFieldSlot(command.getFieldIndex());
      this.medicines = globalScene.getPlayerBagMedicines(owner).filter(item => item.quantity > 0 && getBagMedicineType(item));
      design = globalScene.getPlayerState(owner).ballDesign;
    }
    this.medicineImages.splice(0).forEach(image => image.destroy());
    for (const item of this.medicines) {
      const image = globalScene.add
        .image(0, 0, ...getModifierIconTexture(getBagMedicineType(item)!.iconImage))
        .setScale(this.scale * 3);
      this.medicineImages.push(image);
      this.pokeballSelectContainer.add(image);
    }
    this.updateLayout(this.getPokeballCounts(), design);
  }

  private getMedicineCount(item: BagMedicineData): number {
    if (this.enemyMedicineOnly) return item.quantity;
    const fieldIndex = this.getCommandPhase().getFieldIndex();
    return getAvailableBattleMedicineCount(
      globalScene.getPlayerIndexForFieldSlot(fieldIndex),
      item.typeId,
      globalScene.getPlayerBattlerIndex(fieldIndex),
    );
  }

  private openMedicineTargets(item: BagMedicineData): void {
    const type = getBagMedicineType(item);
    if (!type || this.getMedicineCount(item) < 1) {
      this.getUi().playError();
      return;
    }
    const command = this.getCommandPhase();
    const fieldIndex = command.getFieldIndex();
    const returnToMedicine = () => {
      void this.getUi()
        .setMode(UiMode.COMMAND, fieldIndex)
        .then(() => this.getUi().setModeWithoutClear(UiMode.BALL, true));
    };
    if (command.is("EnemyCommandPhase") || (command.is("PrivateFightPhase") && this.enemyMedicineOnly)) {
      void this.getUi().setMode(UiMode.PARTY, PartyUiMode.ENEMY_MEDICINE, fieldIndex,
        (index: number, option: PartyOption) => {
          const target = globalScene.getEnemyParty()[index];
          if (option !== PartyOption.APPLY || !target || !command.handleMedicineCommand(item.typeId, target.id)) {
            returnToMedicine();
          }
        }, item.typeId);
      return;
    }
    const owner = globalScene.getPlayerIndexForFieldSlot(fieldIndex);
    const party = globalScene.getPlayerParty(owner);
    const isEther = type instanceof PokemonPpRestoreModifierType;
    void this.getUi().setMode(
      UiMode.PARTY,
      isEther ? PartyUiMode.MOVE_MODIFIER : PartyUiMode.MODIFIER,
      fieldIndex,
      (slot: number, option: PartyOption) => {
        const target = slot < 6 ? party[slot] : undefined;
        if (
          !target
          || !command.handleMedicineCommand(item.typeId, target.id, isEther ? option - PartyOption.MOVE_1 : undefined)
        ) {
          returnToMedicine();
        }
      },
      (pokemon: PlayerPokemon) => (canUseBagMedicine(owner, pokemon, item) ? null : PartyUiHandler.NoEffectMessage),
      isEther ? type.moveSelectFilter : undefined,
      undefined,
      isEther,
    );
  }

  private updateLayout(pokeballCounts: PokeballCounts | undefined, design?: import("#data/ball-design").BallDesign) {
    this.stopPokeballWiggle();
    this.pokeballCounts = pokeballCounts;
    const types = this.getPokeballTypes(pokeballCounts);
    if (design !== this.ballDesign || types.length !== this.pokeballTypes.length || types.some((type, i) => type !== this.pokeballTypes[i])) {
      this.stopPokeballWiggle();
      this.pokeballImages.splice(0).forEach(image => image.destroy());
      this.ballDesign = design;
      this.pokeballTypes = types;
      for (const type of types) {
        const image = globalScene.add.image(0, 0, "pb", getPokeballAtlasKey(type, design)).setScale(this.scale * 6);
        this.pokeballImages.push(image);
        this.pokeballSelectContainer.add(image);
      }
    }
    const showBalls = shouldRedactCombatInputOwner() || this.pocket === "ball";
    this.optionsText.setText(
      showBalls
        ? types.map(type => getPokeballDisplayName(type, this.ballDesign)).join("\n")
        : this.medicines.map(item => getBagMedicineType(item)!.name).join("\n"),
    );
    this.countsText.setText(
      showBalls
        ? types.map(type => `×${pokeballCounts?.[type]}`).join("\n")
        : this.medicines.map(item => `×${this.getMedicineCount(item)}`).join("\n"),
    );
    const contentWidth = Math.max(
      64,
      this.optionsText.displayWidth + 4 + this.countsText.displayWidth,
      this.cancelText.displayWidth,
    );
    const width = 58 + contentWidth;
    const height = 32 + VISIBLE_BALL_ROWS * 96 * this.scale;
    this.pokeballSelectBg.setSize(width, height);
    this.pocketHeader.setSize(width, POCKET_HEADER_HEIGHT).setY(-height);
    this.pokeballSelectContainer.setX(globalScene.scaledCanvas.width - width - 1);
    this.pocketText.setPositionRelative(this.pocketHeader, width / 2, 3);
    this.pocketLeft.setPositionRelative(this.pocketHeader, 12, 3);
    this.pocketRight.setPositionRelative(this.pocketHeader, width - 12, 3);
    this.pocketLeft.setVisible(!this.enemyMedicineOnly);
    this.pocketRight.setVisible(!this.enemyMedicineOnly);
    this.optionsText.setPositionRelative(this.pokeballSelectBg, 36, 9);
    this.countsText.setPositionRelative(this.pokeballSelectBg, 36 + this.optionsText.displayWidth + 4, 9);
    this.cancelText.setPositionRelative(this.pokeballSelectBg, 18, 9 + VISIBLE_BALL_ROWS * 96 * this.scale);
    this.emptyText.setPositionRelative(this.pokeballSelectBg, width / 2, 9 + (VISIBLE_BALL_ROWS * 96 * this.scale) / 2);
    this.scrollBar.setPositionRelative(this.pokeballSelectBg, width - 10, 10);
    this.renderRows();
  }

  private renderRows(): void {
    // Keep an observer's visible list fixed so scrolling cannot reveal a private selection.
    const redacted = shouldRedactCombatInputOwner();
    const showBalls = redacted || this.pocket === "ball";
    const offset = redacted ? 0 : this.scrollOffset;
    const visibleTypes = this.pokeballTypes.slice(offset, offset + VISIBLE_BALL_ROWS);
    const visibleMedicines = this.medicines.slice(offset, offset + VISIBLE_BALL_ROWS);
    const count = showBalls ? this.pokeballTypes.length : this.medicines.length;
    this.pocketText.setText(i18next.t(showBalls ? "commandUiHandler:ball" : "commandUiHandler:medicine"));
    this.optionsText
      .setText(
        showBalls
          ? visibleTypes.map(type => getPokeballDisplayName(type, this.ballDesign)).join("\n")
          : visibleMedicines.map(item => getBagMedicineType(item)!.name).join("\n"),
      )
      .setVisible(count > 0);
    this.countsText
      .setText(
        showBalls
          ? visibleTypes.map(type => `×${this.pokeballCounts?.[type]}`).join("\n")
          : visibleMedicines.map(item => `×${this.getMedicineCount(item)}`).join("\n"),
      )
      .setVisible(count > 0);
    this.emptyText.setVisible(count === 0);
    this.scrollBar.setTotalRows(Math.max(1, count));
    this.scrollBar.setScrollCursor(offset);
    this.scrollBar.setVisible(count > VISIBLE_BALL_ROWS);
    this.pokeballImages.forEach((image, i) => {
      image.setVisible(showBalls && i >= offset && i < offset + VISIBLE_BALL_ROWS);
      image.setPositionRelative(this.pokeballSelectBg, 24, 7 + (48 + (i - offset) * 96) * this.scale);
    });
    this.medicineImages.forEach((image, i) => {
      image.setVisible(!showBalls && i >= offset && i < offset + VISIBLE_BALL_ROWS);
      image.setPositionRelative(this.pokeballSelectBg, 24, 7 + (48 + (i - offset) * 96) * this.scale);
    });
  }

  setCursor(cursor: number): boolean {
    this.stopPokeballWiggle();
    const count = this.pocket === "ball" ? this.pokeballTypes.length : this.medicines.length;
    const ret = super.setCursor(Math.max(0, Math.min(cursor, count)));
    if (this.pocket === "ball") {
      this.ballCursor = this.cursor;
    } else {
      this.medicineCursor = this.cursor;
    }
    if (this.cursor < count) {
      this.scrollOffset = Math.min(this.scrollOffset, this.cursor);
      this.scrollOffset = Math.max(this.scrollOffset, this.cursor - VISIBLE_BALL_ROWS + 1);
    }
    this.scrollOffset = Math.min(this.scrollOffset, Math.max(0, count - VISIBLE_BALL_ROWS));
    this.renderRows();

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.pokeballSelectContainer.add(this.cursorObj);
    }

    this.cursorObj.setScale(this.scale * 6);
    const row = this.cursor < count ? this.cursor - this.scrollOffset : VISIBLE_BALL_ROWS;
    this.cursorObj.setPositionRelative(this.pokeballSelectBg, 12, 15 + (6 + row * 96) * this.scale);
    this.cursorObj.setVisible(!shouldRedactCombatInputOwner());

    if (this.active && this.pocket === "ball" && !shouldRedactCombatInputOwner() && this.cursor < count) {
      this.startPokeballWiggle(this.pokeballImages[this.cursor]);
    }

    return ret;
  }

  getTwoPlayerInputContextState(): Record<string, unknown> {
    return {
      pocket: this.pocket,
      ballCursor: this.ballCursor,
      medicineCursor: this.medicineCursor,
      scrollOffset: this.scrollOffset,
    };
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
    this.restoreSharedCursor?.();
    this.restoreSharedCursor = undefined;
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
