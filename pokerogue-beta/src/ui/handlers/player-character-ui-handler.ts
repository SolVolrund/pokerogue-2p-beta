import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { PlayerGender } from "#enums/player-gender";
import {
  getPlayerTrainerSpriteBackTextureKey,
  getPlayerTrainerSpriteFrontTextureKey,
  PLAYER_TRAINER_SPRITE_OPTIONS,
} from "#enums/player-trainer-sprite";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

export interface PlayerCharacterSelectConfig {
  characterId: string;
  onConfirm: (characterId: string) => void;
  onCancel: () => void;
}

const ROW_Y = 36;
const ROW_HEIGHT = 15;

export class PlayerCharacterUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private config: PlayerCharacterSelectConfig | undefined;
  private rows: Phaser.GameObjects.Text[] = [];
  private highlight: Phaser.GameObjects.NineSlice;
  private front: Phaser.GameObjects.Sprite;
  private back: Phaser.GameObjects.Sprite;
  private nameText: Phaser.GameObjects.Text;
  private genderText: Phaser.GameObjects.Text;
  private sourceText: Phaser.GameObjects.Text;
  private pageText: Phaser.GameObjects.Text;
  private selectedText: Phaser.GameObjects.Text;
  private scrollOffset = 0;
  private listWidth: number;
  private rightWidth: number;

  constructor() {
    super(UiMode.PLAYER_CHARACTER);
  }

  override setup(): void {
    const { width, height } = globalScene.scaledCanvas;
    this.listWidth = Math.floor(width * 0.55);
    this.rightWidth = width - this.listWidth;
    this.container = globalScene.add.container(0, -height).setName("player-character-select").setVisible(false);
    this.getUi().add(this.container);
    this.container.add([
      addWindow(0, 0, width, 24).setOrigin(0),
      addWindow(0, 24, this.listWidth, height - 24).setOrigin(0),
      addWindow(this.listWidth, 24, this.rightWidth, height - 68).setOrigin(0),
      addWindow(this.listWidth, height - 44, this.rightWidth, 18).setOrigin(0),
      addWindow(this.listWidth, height - 26, 44, 26).setOrigin(0),
      addWindow(this.listWidth + 44, height - 26, this.rightWidth - 44, 26).setOrigin(0),
    ]);
    this.text(8, 4, "Character Select", 16);
    this.selectedText = this.text(width - 8, 8, "", 9).setOrigin(1, 0);
    this.pageText = this.text(8, height - 30, "", 9);
    this.command(8, height - 15, "Back", () => this.processInput(Button.CANCEL));
    this.command(this.listWidth - 8, height - 15, "Confirm", () => this.processInput(Button.ACTION)).setOrigin(1, 0);

    const rowCount = Math.floor((height - 34 - ROW_Y) / ROW_HEIGHT);
    for (let i = 0; i < rowCount; i++) {
      const y = ROW_Y + i * ROW_HEIGHT;
      this.rows.push(this.text(10, y, "", 12));
      const hit = globalScene.add
        .rectangle(4, y, this.listWidth - 8, ROW_HEIGHT, 0, 0)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        const index = this.scrollOffset + i;
        if (this.active && index < PLAYER_TRAINER_SPRITE_OPTIONS.length) {
          this.cursor = index;
          this.render();
          this.getUi().playSelect();
        }
      });
      hit.on("wheel", (_pointer: unknown, _dx: number, dy: number) => {
        if (this.active && dy) {
          this.processInput(dy > 0 ? Button.DOWN : Button.UP);
        }
      });
      this.container.add(hit);
    }
    this.highlight = globalScene.add
      .nineslice(4, ROW_Y, "summary_moves_cursor", undefined, this.listWidth - 8, ROW_HEIGHT, 1, 1, 1, 1)
      .setOrigin(0);
    this.front = globalScene.add.sprite(
      this.listWidth + this.rightWidth / 2,
      32 + (height - 84) / 4,
      getPlayerTrainerSpriteFrontTextureKey(PLAYER_TRAINER_SPRITE_OPTIONS[0].sprite),
    );
    this.back = globalScene.add.sprite(
      this.listWidth + this.rightWidth / 2,
      32 + (height - 84) * 0.75,
      "trainer_m_back_pb",
    );
    this.container.add([this.highlight, this.front, this.back]);
    this.nameText = this.text(this.listWidth + this.rightWidth / 2, height - 42, "", 12).setOrigin(0.5, 0);
    this.text(this.listWidth + 5, height - 24, "Gender", 7);
    this.genderText = this.text(this.listWidth + 5, height - 13, "", 9);
    this.text(this.listWidth + 49, height - 24, "Source / Artist", 7);
    this.sourceText = this.text(this.listWidth + 49, height - 13, "", 8);
  }

  private text(x: number, y: number, value: string, size: number): Phaser.GameObjects.Text {
    const text = addTextObject(x, y, value, TextStyle.SETTINGS_LABEL, { fontSize: size * 6 }).setOrigin(0);
    this.container.add(text);
    return text;
  }

  private command(x: number, y: number, label: string, action: () => void): Phaser.GameObjects.Text {
    const text = this.text(x, y, label, 10).setInteractive({ useHandCursor: true });
    text.on("pointerdown", () => this.active && action());
    return text;
  }

  private fit(text: Phaser.GameObjects.Text, value: string, width: number): void {
    text.setText(value).setScale(1 / 6);
    if (text.displayWidth > width) {
      text.setScale(((1 / 6) * width) / text.displayWidth);
    }
  }

  override show(args: any[]): boolean {
    if (!args[0]?.onConfirm || !args[0]?.onCancel) {
      return false;
    }
    super.show(args);
    this.config = args[0] as PlayerCharacterSelectConfig;
    this.cursor = Math.max(
      0,
      PLAYER_TRAINER_SPRITE_OPTIONS.findIndex(option => option.atlasKey === this.config!.characterId),
    );
    this.scrollOffset = 0;
    this.container.setVisible(true);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    this.render();
    return true;
  }

  private render(): void {
    this.scrollOffset = Math.max(Math.min(this.scrollOffset, this.cursor), this.cursor - this.rows.length + 1);
    this.rows.forEach((row, i) => {
      const option = PLAYER_TRAINER_SPRITE_OPTIONS[this.scrollOffset + i];
      this.fit(row, option?.label ?? "", this.listWidth - 20);
    });
    this.highlight.setY(ROW_Y + (this.cursor - this.scrollOffset) * ROW_HEIGHT);
    const selected = PLAYER_TRAINER_SPRITE_OPTIONS[this.cursor];
    this.selectedText.setText(selected.atlasKey === this.config?.characterId ? "Selected" : "");
    this.pageText.setText(`${this.cursor + 1} / ${PLAYER_TRAINER_SPRITE_OPTIONS.length}`);
    this.fit(this.nameText, selected.label, this.rightWidth - 14);
    this.genderText.setText(selected.gender === PlayerGender.FEMALE ? "Female" : "Male");
    this.fit(
      this.sourceText,
      [selected.source, selected.artist].filter(Boolean).join(" / ") || "-",
      this.rightWidth - 54,
    );
    this.preview(this.front, getPlayerTrainerSpriteFrontTextureKey(selected.sprite), false);
    this.preview(this.back, getPlayerTrainerSpriteBackTextureKey(selected.sprite, true), true);
  }

  private preview(sprite: Phaser.GameObjects.Sprite, key: string, throwing: boolean): void {
    sprite.stop();
    if (!globalScene.textures.exists(key)) {
      sprite.setVisible(false);
      return;
    }
    const texture = globalScene.textures.get(key);
    const frames = texture
      .getFrameNames()
      .filter(frame => (throwing ? /^\d+$/.test(frame) : /^\d+\.png$/.test(frame)))
      .sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
    sprite.setVisible(true).setTexture(key, frames[0]);
    const maxWidth = Math.max(...frames.map(frame => texture.get(frame).realWidth), sprite.width);
    const maxHeight = Math.max(...frames.map(frame => texture.get(frame).realHeight), sprite.height);
    const fitScale = Math.min(
      1, (this.rightWidth - 16) / maxWidth, ((globalScene.scaledCanvas.height - 84) / 2 - 4) / maxHeight,
    );
    // The UI is enlarged 6x; keep each source pixel a whole number of canvas pixels.
    sprite.setScale(Math.floor(fitScale * 6) / 6);
    if (frames.length > 1) {
      const animationKey = `player-card-${key}`;
      if (!globalScene.anims.exists(animationKey)) {
        globalScene.anims.create({
          key: animationKey,
          frames: frames.map((frame, index) => ({
            key,
            frame,
            ...(throwing ? { duration: index === 0 ? 560 : index === frames.length - 1 ? 850 : 64 } : {}),
          })),
          frameRate: throwing ? 1000 : 24,
          repeat: -1,
        });
      }
      sprite.play(animationKey);
    }
  }

  override processInput(button: Button): boolean {
    if (!this.active || !this.config) {
      return false;
    }
    switch (button) {
      case Button.UP:
      case Button.DOWN:
        this.cursor =
          (this.cursor + (button === Button.DOWN ? 1 : -1) + PLAYER_TRAINER_SPRITE_OPTIONS.length)
          % PLAYER_TRAINER_SPRITE_OPTIONS.length;
        this.render();
        break;
      case Button.ACTION: {
        const config = this.config;
        const id = PLAYER_TRAINER_SPRITE_OPTIONS[this.cursor].atlasKey;
        this.clear();
        config.onConfirm(id);
        break;
      }
      case Button.CANCEL: {
        const config = this.config;
        this.clear();
        config.onCancel();
        break;
      }
      default:
        return false;
    }
    this.getUi().playSelect();
    return true;
  }

  override clear(): void {
    super.clear();
    this.front.stop();
    this.back.stop();
    this.container.setVisible(false);
    this.config = undefined;
  }
}
