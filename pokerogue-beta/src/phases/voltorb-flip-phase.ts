import type { PlayerIndex } from "#app/battle-scene";
import { globalScene } from "#app/global-scene";
import { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import { showEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import { restoreGameCornerBgm } from "#mystery-encounters/game-corner-music";
import { clearVoltorbFlipInputMode, setVoltorbFlipInputMode } from "#ui/voltorb-flip-input-ui-handler";
import { randSeedInt } from "#utils/common";
import { getCachedUrl } from "#utils/fetch-utils";
import i18next from "i18next";

const namespace = "mysteryEncounters/gameCorner";

const BG_KEY = "voltorb_flip_bg";
const CARD_KEY = "voltorb_flip_cards";
const BG_PATH = "images/game_corner/voltorb_flip/voltorb_flip_bg.png";
const CARD_PATH = "images/game_corner/voltorb_flip/voltorb_flip_cards.png";

const CARD_ROWS = 4;
const CARD_COLS = 8;
const CARD_FRAME_SIZE = 49;
const CARD_START_X = 24;
const CARD_START_Y = 19;
const CARD_STEP_X = 68;
const CARD_STEP_Y = 68;
const CURSOR_PADDING = 4;
const ESC_ROW = CARD_ROWS;
const ESC_COL = CARD_COLS;
const VOLTORB_COUNT = 8;
const NUGGET_TOTAL = 32;
const MAX_VOLTORB_STRIKES = 3;

type VoltorbCardFace = "one" | "two" | "three" | "voltorb";

interface VoltorbFlipCard {
  face: VoltorbCardFace;
  revealed: boolean;
  sprite?: Phaser.GameObjects.Sprite;
}

const CARD_FRAMES: Record<VoltorbCardFace | "back", number> = {
  back: 0,
  one: 1,
  two: 2,
  three: 3,
  voltorb: 4,
};

export class VoltorbFlipPhase extends Phase {
  public readonly phaseName = "VoltorbFlipPhase";
  private readonly playerIndex: PlayerIndex;
  private readonly queuePostEncounterPhase: boolean;
  private container: Phaser.GameObjects.Container | undefined;
  private cursor: Phaser.GameObjects.Rectangle | undefined;
  private totalText: Phaser.GameObjects.Text | undefined;
  private board: VoltorbFlipCard[][] = [];
  private cursorRow = 0;
  private cursorCol = 0;
  private revealedNuggies = 0;
  private voltorbStrikes = 0;
  private complete = false;
  private animating = false;

  constructor(playerIndex: PlayerIndex = globalScene.activePlayerIndex, queuePostEncounterPhase = true) {
    super();
    this.playerIndex = playerIndex;
    this.queuePostEncounterPhase = queuePostEncounterPhase;
  }

  start(): void {
    super.start();

    if (globalScene.twoPlayerMode) {
      globalScene.waitForPlayerInput(this.playerIndex);
    } else {
      globalScene.setActivePlayerIndex(this.playerIndex);
    }

    globalScene.ui.clearText();
    this.hideMessageWindow();
    void this.startVoltorbFlip();
  }

  override end(): void {
    clearVoltorbFlipInputMode();
    this.container?.destroy(true);
    this.container = undefined;
    super.end();
  }

  private async startVoltorbFlip(): Promise<void> {
    await this.loadAssets();
    this.generateBoard();
    this.createUi();
    this.render();
    await this.showVoltorbText(`${namespace}:voltorbFlip.start`);
    this.enableInput(150);
  }

  private enableInput(inputDelayMs = 0): void {
    setVoltorbFlipInputMode({
      inputDelayMs,
      onMove: (dx, dy) => this.moveCursor(dx, dy),
      onConfirm: () => this.confirmSelection(),
      onCancel: () => this.cashOut(),
    });
    this.hideMessageWindow();
  }

  private async loadAssets(): Promise<void> {
    const needsBg = !globalScene.textures.exists(BG_KEY);
    const needsCards = !globalScene.textures.exists(CARD_KEY);
    if (!needsBg && !needsCards) {
      return;
    }

    await new Promise<void>(resolve => {
      globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => resolve());
      if (needsBg) {
        globalScene.load.image(BG_KEY, getCachedUrl(BG_PATH));
      }
      if (needsCards) {
        globalScene.load.spritesheet(CARD_KEY, getCachedUrl(CARD_PATH), {
          frameWidth: CARD_FRAME_SIZE,
          frameHeight: CARD_FRAME_SIZE,
        });
      }
      globalScene.load.start();
    });
  }

  private generateBoard(): void {
    const safeCardCount = CARD_ROWS * CARD_COLS - VOLTORB_COUNT;
    const safeValues = Array.from({ length: safeCardCount }, () => 1);
    let remainingBonus = NUGGET_TOTAL - safeCardCount;

    while (remainingBonus > 0) {
      const index = this.randInt(safeValues.length);
      if (safeValues[index] >= 3) {
        continue;
      }
      safeValues[index]++;
      remainingBonus--;
    }

    const faces: VoltorbCardFace[] = [
      ...Array.from({ length: VOLTORB_COUNT }, () => "voltorb" as const),
      ...safeValues.map(value => this.valueToFace(value)),
    ];
    this.shuffle(faces);

    this.board = Array.from({ length: CARD_ROWS }, (_, row) =>
      Array.from({ length: CARD_COLS }, (_, col) => ({
        face: faces[row * CARD_COLS + col],
        revealed: false,
      })),
    );

    this.cursorRow = 0;
    this.cursorCol = 0;
    this.revealedNuggies = 0;
    this.voltorbStrikes = 0;
    this.complete = false;
    this.animating = false;
  }

  private createUi(): void {
    this.container?.destroy(true);
    this.container = globalScene.add.container(0, 0);
    this.container.setName("voltorb-flip-phase-ui");
    this.container.setScale(0.5);
    globalScene.uiContainer.addAt(this.container, 0);

    const bg = globalScene.add.image(0, 0, BG_KEY);
    bg.setOrigin(0);
    this.container.add(bg);

    for (let row = 0; row < CARD_ROWS; row++) {
      for (let col = 0; col < CARD_COLS; col++) {
        const sprite = globalScene.add.sprite(
          this.getCardX(col) + CARD_FRAME_SIZE / 2,
          this.getCardY(row) + CARD_FRAME_SIZE / 2,
          CARD_KEY,
          CARD_FRAMES.back,
        );
        sprite.setOrigin(0.5);
        this.board[row][col].sprite = sprite;
        this.container.add(sprite);
      }
    }

    this.renderCountText();

    this.cursor = globalScene.add.rectangle(0, 0, CARD_FRAME_SIZE + 8, CARD_FRAME_SIZE + 8);
    this.cursor.setOrigin(0);
    this.cursor.setStrokeStyle(4, 0xfff06a, 1);
    this.container.add(this.cursor);
  }

  private render(): void {
    for (let row = 0; row < CARD_ROWS; row++) {
      for (let col = 0; col < CARD_COLS; col++) {
        const card = this.board[row][col];
        card.sprite?.setFrame(CARD_FRAMES[card.revealed ? card.face : "back"]);
      }
    }

    this.totalText?.setText(`:${this.revealedNuggies}/${this.getTotalNuggies()}`);
    this.renderCursor();
  }

  private renderCountText(): void {
    if (!this.container) {
      return;
    }

    const rowCounts = this.getRowCounts();
    const colCounts = this.getColumnCounts();

    for (let row = 0; row < CARD_ROWS; row++) {
      const y = this.getCardY(row);
      this.addCountText(585, y + 4, `: x${rowCounts[row].nuggies}`);
      this.addCountText(585, y + 32, `: x${rowCounts[row].voltorbs}`);
    }

    for (let col = 0; col < CARD_COLS; col++) {
      const x = this.getCardX(col) + 10;
      this.addCountText(x+10, 295, `: x${colCounts[col].nuggies}`);
      this.addCountText(x+10, 323, `: x${colCounts[col].voltorbs}`);
    }

    this.totalText = this.addCountText(584, 295, `:0/${this.getTotalNuggies()}`);
    this.addCountText(585, 323, "ESC");
  }

  private addCountText(x: number, y: number, text: string): Phaser.GameObjects.Text {
    const textObject = globalScene.add.text(x, y, text, {
      fontFamily: "emerald",
      fontSize: "16px",
      color: "#303030",
    });
    textObject.setShadow(1, 1, "#cfc7ab");
    this.container?.add(textObject);
    return textObject;
  }

  private renderCursor(): void {
    if (!this.cursor) {
      return;
    }

    if (this.isEscapeSelected()) {
      this.cursor.setPosition(this.getCardX(ESC_COL) - CURSOR_PADDING, this.getCardY(ESC_ROW) - CURSOR_PADDING);
      this.cursor.setSize(CARD_FRAME_SIZE + CURSOR_PADDING * 2, CARD_FRAME_SIZE + CURSOR_PADDING * 2);
      return;
    }

    this.cursor.setPosition(
      this.getCardX(this.cursorCol) - CURSOR_PADDING,
      this.getCardY(this.cursorRow) - CURSOR_PADDING,
    );
    this.cursor.setSize(CARD_FRAME_SIZE + CURSOR_PADDING * 2, CARD_FRAME_SIZE + CURSOR_PADDING * 2);
  }

  private moveCursor(dx: number, dy: number): boolean {
    if (this.complete || this.animating) {
      return false;
    }

    if (this.isEscapeSelected()) {
      if (dx < 0 || dy < 0) {
        this.cursorRow = CARD_ROWS - 1;
        this.cursorCol = CARD_COLS - 1;
        this.renderCursor();
        return true;
      }
      return false;
    }

    const nextRow = this.cursorRow + dy;
    const nextCol = this.cursorCol + dx;
    if (nextRow >= CARD_ROWS || nextCol >= CARD_COLS) {
      this.cursorRow = ESC_ROW;
      this.cursorCol = ESC_COL;
      this.renderCursor();
      return true;
    }

    if (nextRow < 0 || nextCol < 0) {
      return false;
    }

    this.cursorRow = nextRow;
    this.cursorCol = nextCol;
    this.renderCursor();
    return true;
  }

  private confirmSelection(): boolean {
    if (this.complete || this.animating) {
      return false;
    }

    if (this.isEscapeSelected()) {
      return this.cashOut();
    }

    const card = this.board[this.cursorRow][this.cursorCol];
    if (card.revealed || !card.sprite) {
      return false;
    }

    void this.flipCard(this.cursorRow, this.cursorCol);
    return true;
  }

  private async flipCard(row: number, col: number): Promise<void> {
    const card = this.board[row][col];
    const sprite = card.sprite;
    if (!sprite) {
      return;
    }

    this.animating = true;
    await this.tweenScaleX(sprite, 0.04, 120);
    card.revealed = true;
    sprite.setFrame(CARD_FRAMES[card.face]);
    await this.tweenScaleX(sprite, 1, 120);

    this.animating = false;
    this.applyReveal(card);
  }

  private tweenScaleX(sprite: Phaser.GameObjects.Sprite, scaleX: number, duration: number): Promise<void> {
    return new Promise(resolve => {
      globalScene.tweens.add({
        targets: sprite,
        scaleX,
        duration,
        ease: "Sine.easeInOut",
        onComplete: () => resolve(),
      });
    });
  }

  private applyReveal(card: VoltorbFlipCard): void {
    if (card.face === "voltorb") {
      this.voltorbStrikes++;
      this.render();

      if (this.voltorbStrikes >= MAX_VOLTORB_STRIKES) {
        void this.finish("lost");
        return;
      }

      void this.showVoltorbText(
        `${namespace}:voltorbFlip.${this.voltorbStrikes === 1 ? "firstVoltorb" : "secondVoltorb"}`,
      ).then(() => this.enableInput(100));
      return;
    }

    this.revealedNuggies += this.getCardValue(card.face);
    this.render();

    if (this.revealedNuggies >= this.getTotalNuggies()) {
      void this.finish("perfect");
    }
  }

  private cashOut(): boolean {
    if (this.complete || this.animating) {
      return false;
    }

    void this.finish("cashOut");
    return true;
  }

  private async finish(result: "cashOut" | "perfect" | "lost"): Promise<void> {
    if (this.complete) {
      return;
    }

    this.complete = true;
    clearVoltorbFlipInputMode();

    if (result === "lost") {
      await this.showVoltorbText(`${namespace}:voltorbFlip.thirdVoltorb`);
    } else {
      await this.showVoltorbText(`${namespace}:voltorbFlip.${result === "perfect" ? "perfectClear" : "cashOut"}`);
      await this.showVoltorbText(`${namespace}:voltorbFlip.reward`);
    }

    this.container?.destroy(true);
    this.container = undefined;
    if (this.queuePostEncounterPhase) {
      if (result === "lost") {
        restoreGameCornerBgm();
        globalScene.phaseManager.pushNew("PostMysteryEncounterPhase");
      } else {
        globalScene.phaseManager.pushNew("GameCornerRewardPhase", this.revealedNuggies, this.playerIndex, true);
      }
    }
    this.end();
  }

  private showVoltorbText(textKey: string, tokens?: Record<string, string | number>): Promise<void> {
    return new Promise(resolve => {
      if (globalScene.twoPlayerMode) {
        globalScene.waitForSharedInput();
      } else {
        globalScene.setActivePlayerIndex(this.playerIndex);
      }

      void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
        globalScene.ui.getMessageHandler().setMessageWindowVisible(true);
        showEncounterText(i18next.t(textKey, tokens), 0, 0, true).then(() => {
          this.hideMessageWindow();
          resolve();
        });
      });
    });
  }

  private hideMessageWindow(): void {
    globalScene.ui.clearText();
    globalScene.ui.getMessageHandler().setMessageWindowVisible(false);
  }

  private getCardX(col: number): number {
    return CARD_START_X + col * CARD_STEP_X;
  }

  private getCardY(row: number): number {
    return CARD_START_Y + row * CARD_STEP_Y;
  }

  private isEscapeSelected(): boolean {
    return this.cursorRow === ESC_ROW && this.cursorCol === ESC_COL;
  }

  private getTotalNuggies(): number {
    return this.board.flat().reduce((total, card) => total + this.getCardValue(card.face), 0);
  }

  private getRowCounts(): { nuggies: number; voltorbs: number }[] {
    return this.board.map(row =>
      row.reduce(
        (counts, card) => ({
          nuggies: counts.nuggies + this.getCardValue(card.face),
          voltorbs: counts.voltorbs + (card.face === "voltorb" ? 1 : 0),
        }),
        { nuggies: 0, voltorbs: 0 },
      ),
    );
  }

  private getColumnCounts(): { nuggies: number; voltorbs: number }[] {
    return Array.from({ length: CARD_COLS }, (_, col) =>
      this.board.reduce(
        (counts, row) => ({
          nuggies: counts.nuggies + this.getCardValue(row[col].face),
          voltorbs: counts.voltorbs + (row[col].face === "voltorb" ? 1 : 0),
        }),
        { nuggies: 0, voltorbs: 0 },
      ),
    );
  }

  private getCardValue(face: VoltorbCardFace): number {
    if (face === "two") {
      return 2;
    }
    if (face === "three") {
      return 3;
    }
    return face === "one" ? 1 : 0;
  }

  private valueToFace(value: number): VoltorbCardFace {
    if (value === 2) {
      return "two";
    }
    if (value >= 3) {
      return "three";
    }
    return "one";
  }

  private shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.randInt(i + 1);
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  private randInt(max: number): number {
    return randSeedInt(Math.max(1, max));
  }
}
