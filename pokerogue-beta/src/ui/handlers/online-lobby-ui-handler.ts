import { globalScene } from "#app/global-scene";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import {
  getOnlineLobbyHostName,
  getOnlineLobbyModeLabel,
  getOnlineLobbySeatCount,
  getOnlineLobbySeats,
  getOnlineLobbyStatus,
  isOnlineLobbyJoinable,
  type OnlineLobbySeat,
  type OnlineLobbySummary,
} from "#utils/online-lobby";
import { onlineErrorMessage } from "#utils/online-lobby-client";

export interface OnlineLobbyBrowserConfig {
  lobbies: readonly OnlineLobbySummary[];
  demo?: boolean;
  onCancel: () => void;
  loadLobbies?: () => Promise<OnlineLobbySummary[]>;
  onJoin?: (lobby: OnlineLobbySummary, seat: OnlineLobbySeat) => Promise<void>;
}

const VISIBLE_ROWS = 7;
const ROW_Y = 44;
const ROW_HEIGHT = 15;

/** Directory and roster view, with an optional offline fixture for layout previews. */
export class OnlineLobbyUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private config: OnlineLobbyBrowserConfig | undefined;
  private lobbies: readonly OnlineLobbySummary[] = [];
  private scrollOffset = 0;
  private seatCursor = -1;
  private listWidth: number;
  private rightWidth: number;
  private seatY: number;
  private listCursor: Phaser.GameObjects.NineSlice;
  private seatHighlight: Phaser.GameObjects.NineSlice;
  private headerStatus: Phaser.GameObjects.Text;
  private hostText: Phaser.GameObjects.Text;
  private setupText: Phaser.GameObjects.Text;
  private statusText: Phaser.GameObjects.Text;
  private feedbackText: Phaser.GameObjects.Text;
  private pageText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private rows: { host: Phaser.GameObjects.Text; count: Phaser.GameObjects.Text }[] = [];
  private roster: { name: Phaser.GameObjects.Text; status: Phaser.GameObjects.Text }[] = [];
  private seatLabels: Phaser.GameObjects.Text[] = [];
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private joining = false;

  constructor() {
    super(UiMode.ONLINE_LOBBY);
  }

  override setup(): void {
    const { width, height } = globalScene.scaledCanvas;
    this.listWidth = Math.floor(width * 0.55);
    this.rightWidth = width - this.listWidth;
    this.seatY = height - 26;
    this.container = globalScene.add.container(0, -height).setName("online-lobbies").setVisible(false);
    this.getUi().add(this.container);
    this.container.add([
      addWindow(0, 0, width, 24).setOrigin(0),
      addWindow(0, 24, this.listWidth, height - 24).setOrigin(0),
      addWindow(this.listWidth, 24, this.rightWidth, height - 68).setOrigin(0),
      addWindow(this.listWidth, height - 44, this.rightWidth, 18).setOrigin(0),
    ]);
    this.text(8, 4, "Lobbies", 16);
    this.headerStatus = this.text(width - 8, 8, "", 10).setOrigin(1, 0);
    this.text(8, 29, "Host", 9);
    this.text(this.listWidth - 8, 29, "Players + EP", 9).setOrigin(1, 0);
    this.pageText = this.text(8, height - 28, "", 9);
    const back = this.text(8, height - 15, "Back", 10).setInteractive({ useHandCursor: true });
    back.on("pointerdown", () => this.active && this.processInput(Button.CANCEL));
    this.hintText = this.text(this.listWidth - 8, height - 15, "", 9).setOrigin(1, 0);
    this.emptyText = this.text(8, ROW_Y, "No lobbies available", 11);

    for (let i = 0; i < VISIBLE_ROWS; i++) {
      const y = ROW_Y + i * ROW_HEIGHT;
      this.rows.push({
        host: this.text(8, y, "", 12),
        count: this.text(this.listWidth - 8, y + 1, "", 11).setOrigin(1, 0),
      });
      const hit = globalScene.add
        .rectangle(4, y, this.listWidth - 8, ROW_HEIGHT, 0, 0)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      hit.on("pointerdown", () => {
        const index = this.scrollOffset + i;
        if (!this.active || index >= this.lobbies.length) {
          return;
        }
        this.cursor = index;
        this.seatCursor = -1;
        this.feedbackText.setText("");
        this.render();
        this.processInput(Button.ACTION);
      });
      hit.on("wheel", (_pointer: unknown, _dx: number, dy: number) => {
        if (this.active && dy) {
          this.seatCursor = -1;
          this.processInput(dy > 0 ? Button.DOWN : Button.UP);
        }
      });
      this.container.add(hit);
    }
    this.listCursor = globalScene.add
      .nineslice(4, ROW_Y, "summary_moves_cursor", undefined, this.listWidth - 8, ROW_HEIGHT, 1, 1, 1, 1)
      .setOrigin(0);
    this.container.add(this.listCursor);

    this.hostText = this.text(this.listWidth + 7, 29, "", 13);
    this.setupText = this.text(this.listWidth + 7, 46, "", 10);
    for (const [i, seat] of ["P1", "P2", "P3", "EP"].entries()) {
      const y = 62 + i * 15;
      this.text(this.listWidth + 7, y, seat, 10);
      this.roster.push({
        name: this.text(this.listWidth + 26, y, "", 10),
        status: this.text(width - 7, y + 1, "", 8).setOrigin(1, 0),
      });
      const x = this.listWidth + (i * this.rightWidth) / 4;
      const bg = addWindow(x, this.seatY, this.rightWidth / 4, 26)
        .setOrigin(0)
        .setInteractive({ useHandCursor: true });
      bg.on("pointerdown", () => {
        if (!this.active || !this.availableSeats().includes(i)) {
          return;
        }
        if (this.seatCursor === i) {
          this.processInput(Button.ACTION);
        } else {
          this.seatCursor = i;
          this.feedbackText.setText("");
          this.render();
          this.getUi().playSelect();
        }
      });
      this.container.add(bg);
      this.seatLabels.push(this.text(x + this.rightWidth / 8, this.seatY + 5, seat, 13).setOrigin(0.5, 0));
    }
    this.statusText = this.text(this.listWidth + 7, 123, "", 9);
    this.text(this.listWidth + this.rightWidth / 2, height - 42, "Join As", 12).setOrigin(0.5, 0);
    this.feedbackText = this.text(8, ROW_Y + 28, "", 11);
    this.feedbackText.setWordWrapWidth((this.listWidth - 16) * 6);
    this.seatHighlight = globalScene.add
      .nineslice(0, this.seatY + 3, "summary_moves_cursor", undefined, this.rightWidth / 4 - 6, 20, 1, 1, 1, 1)
      .setOrigin(0)
      .setVisible(false);
    this.container.add(this.seatHighlight);
  }

  private text(x: number, y: number, value: string, size: number): Phaser.GameObjects.Text {
    const text = addTextObject(x, y, value, TextStyle.SETTINGS_LABEL, { fontSize: size * 6 }).setOrigin(0);
    this.container.add(text);
    return text;
  }

  /** Truncate names by rendered width so long names cannot overlap counts or seat status. */
  private fit(text: Phaser.GameObjects.Text, value: string, width: number): void {
    text.setText(value);
    const chars = Array.from(value);
    while (text.displayWidth > width && chars.length > 0) {
      chars.pop();
      text.setText(`${chars.join("")}...`);
    }
  }

  override show(args: any[]): boolean {
    super.show(args);
    this.config = args[0] as OnlineLobbyBrowserConfig;
    this.cursor = 0;
    this.scrollOffset = 0;
    this.seatCursor = -1;
    this.lobbies = [];
    this.joining = false;
    this.headerStatus.setText(this.config.demo ? "Offline demo" : "Connecting...");
    this.emptyText.setText("No lobbies available");
    this.container.setVisible(true);
    this.updateLobbies(this.config.lobbies);
    this.getUi().moveTo(this.container, this.getUi().length - 1);
    this.getUi().hideTooltip();
    if (this.config.loadLobbies) {
      void this.refreshDirectory(this.config);
    }
    return true;
  }

  private async refreshDirectory(config: OnlineLobbyBrowserConfig): Promise<void> {
    try {
      const lobbies = await config.loadLobbies!();
      if (this.config !== config) {
        return;
      }
      this.updateLobbies(lobbies);
      this.headerStatus.setText(this.joining ? "Joining..." : "Online");
      this.emptyText.setText("No lobbies available");
    } catch {
      if (this.config !== config) {
        return;
      }
      // Stale listings must never continue to look joinable after losing the directory.
      this.updateLobbies([]);
      this.headerStatus.setText("Service unavailable");
      this.emptyText.setText("Cannot reach service");
    }
    if (this.config === config) {
      this.refreshTimer = setTimeout(() => void this.refreshDirectory(config), 2000);
    }
  }

  private async joinSelected(lobby: OnlineLobbySummary, seat: OnlineLobbySeat): Promise<void> {
    const config = this.config;
    if (!config?.onJoin || this.joining) {
      return;
    }
    this.joining = true;
    this.headerStatus.setText("Joining...");
    try {
      await config.onJoin(lobby, seat);
    } catch (error) {
      if (this.config === config) {
        this.headerStatus.setText("Join failed");
        this.fit(this.statusText, onlineErrorMessage(error), this.rightWidth - 14);
      }
    } finally {
      this.joining = false;
    }
  }

  /** Preserve selection by lobby ID when a future directory refreshes or reorders its results. */
  public updateLobbies(lobbies: readonly OnlineLobbySummary[]): void {
    const selectedId = this.lobbies[this.cursor]?.id;
    this.lobbies = [...lobbies];
    const index = this.lobbies.findIndex(lobby => lobby.id === selectedId);
    this.cursor = index >= 0 ? index : Math.max(0, Math.min(this.cursor, lobbies.length - 1));
    if (index < 0 || !this.availableSeats().includes(this.seatCursor)) {
      this.seatCursor = -1;
    }
    this.feedbackText.setText("");
    this.render();
  }

  private availableSeats(): number[] {
    const lobby = this.lobbies[this.cursor];
    return lobby ? getOnlineLobbySeats(lobby).flatMap((seat, index) => (seat.available ? [index] : [])) : [];
  }

  private render(): void {
    this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, this.lobbies.length - VISIBLE_ROWS)));
    if (this.cursor < this.scrollOffset) {
      this.scrollOffset = this.cursor;
    } else if (this.cursor >= this.scrollOffset + VISIBLE_ROWS) {
      this.scrollOffset = this.cursor - VISIBLE_ROWS + 1;
    }
    this.rows.forEach((row, index) => {
      const lobby = this.lobbies[this.scrollOffset + index];
      row.host.setVisible(!!lobby);
      row.count.setVisible(!!lobby);
      if (lobby) {
        row.count.setText(getOnlineLobbySeatCount(lobby));
        this.fit(row.host, getOnlineLobbyHostName(lobby), this.listWidth - row.count.displayWidth - 24);
        const alpha = isOnlineLobbyJoinable(lobby) ? 1 : 0.45;
        row.host.setAlpha(alpha);
        row.count.setAlpha(alpha);
      }
    });
    const lobby = this.lobbies[this.cursor];
    this.emptyText.setVisible(!lobby);
    this.pageText.setText(lobby ? `${this.cursor + 1} / ${this.lobbies.length} lobbies` : "0 lobbies");
    this.hintText.setText(
      this.seatCursor < 0 ? "Confirm: seats" : this.config?.demo ? "Confirm: preview" : "Confirm: join",
    );
    this.listCursor
      .setVisible(!!lobby)
      .setAlpha(this.seatCursor < 0 ? 1 : 0.35)
      .setY(ROW_Y + (this.cursor - this.scrollOffset) * ROW_HEIGHT);
    this.fit(this.hostText, lobby ? getOnlineLobbyHostName(lobby) : "No lobby selected", this.rightWidth - 14);
    this.setupText.setText(lobby ? `${getOnlineLobbyModeLabel(lobby)}${this.config?.demo ? " - Demo" : ""}` : "");
    this.statusText.setText(lobby ? getOnlineLobbyStatus(lobby) : "");
    const seats = lobby ? getOnlineLobbySeats(lobby) : [];
    this.roster.forEach((row, index) => {
      const seat = seats[index];
      row.status.setText(seat && seat.status !== "Open" ? `[${seat.status}]` : "");
      this.fit(row.name, seat?.name ?? "-", this.rightWidth - 38 - row.status.displayWidth);
      row.name.setAlpha(seat?.status === "Unavailable" ? 0.45 : 1);
      row.status.setAlpha(seat?.status === "Unavailable" ? 0.45 : 1);
      this.seatLabels[index].setAlpha(seat?.available ? 1 : 0.35);
    });
    this.seatHighlight
      .setVisible(this.seatCursor >= 0)
      .setX(this.listWidth + (this.seatCursor * this.rightWidth) / 4 + 3);
  }

  override processInput(button: Button): boolean {
    if (!this.active || this.joining) {
      return false;
    }
    const available = this.availableSeats();
    if (button === Button.CANCEL) {
      if (this.seatCursor >= 0) {
        this.seatCursor = -1;
        this.feedbackText.setText("");
      } else {
        this.config?.onCancel();
        return true;
      }
    } else if (button === Button.ACTION || button === Button.SUBMIT) {
      if (available.length === 0) {
        return false;
      }
      if (this.seatCursor < 0) {
        this.seatCursor = available[0];
      } else if (available.includes(this.seatCursor)) {
        if (this.config?.onJoin && !this.config.demo) {
          const lobby = this.lobbies[this.cursor];
          void this.joinSelected(lobby, getOnlineLobbySeats(lobby)[this.seatCursor].seat);
          return true;
        }
        const seat = getOnlineLobbySeats(this.lobbies[this.cursor])[this.seatCursor].seat.toUpperCase();
        // Deliberately no transport, profile mutation, or phase transition in this preview.
        this.feedbackText.setText(
          this.config?.demo
            ? `Demo: ${seat} selected.\nNo connection was made.`
            : "Online joining is not available yet.",
        );
        // Feedback occupies the empty space below the demo row, not populated directory rows.
        this.feedbackText.setVisible(this.lobbies.length <= 1);
        this.statusText.setText(`Preview: ${seat} selected`);
        this.getUi().playSelect();
        return true;
      } else {
        this.seatCursor = -1;
      }
    } else if (this.seatCursor >= 0 && (button === Button.LEFT || button === Button.RIGHT)) {
      const index = available.indexOf(this.seatCursor);
      this.seatCursor =
        available[(index + (button === Button.RIGHT ? 1 : -1) + available.length) % available.length] ?? -1;
      this.feedbackText.setText("");
    } else if (this.seatCursor < 0 && this.lobbies.length > 0 && (button === Button.UP || button === Button.DOWN)) {
      this.cursor = (this.cursor + (button === Button.DOWN ? 1 : -1) + this.lobbies.length) % this.lobbies.length;
      this.feedbackText.setText("");
    } else {
      return false;
    }
    this.render();
    this.getUi().playSelect();
    return true;
  }

  override clear(): void {
    super.clear();
    clearTimeout(this.refreshTimer);
    this.container.setVisible(false);
    this.config = undefined;
    this.lobbies = [];
  }
}
