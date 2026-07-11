import { audioManager } from "#app/global-audio-manager";
import { globalScene } from "#app/global-scene";
import type { InputsController } from "#app/inputs-controller";
import type { PlayerIndex, TwoPlayerDebugStateCheckpoint } from "#app/battle-scene";
import { isDev } from "#constants/app-constants";
import { Button } from "#enums/buttons";
import { UiMode } from "#enums/ui-mode";
import { Setting, SettingKeys, settingIndex } from "#system/settings";
import {
  isTwoPlayerInputDebugEnabled,
  TwoPlayerInputTransport,
  type TwoPlayerInputDebugEvent,
  type TwoPlayerProfileSnapshot,
  type TwoPlayerRunBootstrap,
  type TwoPlayerSettingsSnapshot,
  type TwoPlayerStateCheckpoint,
  type TwoPlayerTitleStart,
  type TwoPlayerInputTransportStatus,
} from "#app/two-player-input-transport";
import type { MessageUiHandler } from "#ui/message-ui-handler";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PokedexUiHandler } from "#ui/pokedex-ui-handler";
import { RunInfoUiHandler } from "#ui/run-info-ui-handler";
import { SettingsAudioUiHandler } from "#ui/settings-audio-ui-handler";
import { SettingsDisplayUiHandler } from "#ui/settings-display-ui-handler";
import { SettingsEventsUiHandler } from "#ui/settings-events-ui-handler";
import { SettingsGamepadUiHandler } from "#ui/settings-gamepad-ui-handler";
import { SettingsKeyboardUiHandler } from "#ui/settings-keyboard-ui-handler";
import { SettingsUiHandler } from "#ui/settings-ui-handler";
import { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { SummaryUiHandler } from "#ui/summary-ui-handler";
import Phaser from "phaser";

type ActionKeys = Record<Button, () => void>;
type RemoteButtonInput = Button | keyof typeof Button;
type RemoteDebugPlayer =
  | 1
  | 2
  | 3
  | "1"
  | "2"
  | "3"
  | "p1"
  | "p2"
  | "p3"
  | "player1"
  | "player2"
  | "player3"
  | "host"
  | "guest"
  | "guest2"
  | "guest-2"
  | "guest_2";

declare global {
  interface Window {
    pokerogueTwoPlayerInput?: {
      press(player: RemoteDebugPlayer, button: RemoteButtonInput): boolean;
      release(player: RemoteDebugPlayer, button: RemoteButtonInput): boolean;
      force(player: RemoteDebugPlayer, button: RemoteButtonInput): boolean;
      forceRelease(player: RemoteDebugPlayer, button: RemoteButtonInput): boolean;
      checkpoint(): TwoPlayerDebugStateCheckpoint | undefined;
      sendRunBootstrap(seed?: string): boolean;
      sendTitleStart(titleStart: TwoPlayerTitleStart): boolean;
      sendProfileSnapshot(): boolean;
      sendSettingsSnapshot(): boolean;
      sendCheckpoint(reason?: string): boolean;
      profileReady(): boolean;
      profileSlotsReady(): [boolean, boolean, boolean];
      syncStatus(): Record<string, unknown>;
      transportStatus(): TwoPlayerInputTransportStatus | undefined;
      debugEvents(): TwoPlayerInputDebugEvent[];
      clearDebugEvents(): void;
    };
  }
}

export class UiInputs {
  private events: Phaser.Events.EventEmitter;
  private inputsController: InputsController;
  private twoPlayerInputTransport: TwoPlayerInputTransport | undefined;
  private readonly twoPlayerInputDebugEnabled = isTwoPlayerInputDebugEnabled();
  private readonly twoPlayerInputDebugEvents: TwoPlayerInputDebugEvent[] = [];
  private syncRepairOverlay: HTMLDivElement | undefined;
  private syncRepairStatusText: HTMLPreElement | undefined;
  private syncRepairLogText: HTMLPreElement | undefined;
  private selectedSyncRepairPlayer: PlayerIndex = 0;

  constructor(inputsController: InputsController) {
    this.inputsController = inputsController;
    this.init();
  }

  init(): void {
    this.events = this.inputsController.events;
    this.listenInputs();
    this.twoPlayerInputTransport = TwoPlayerInputTransport.create(
      globalScene.twoPlayerLocalInputSeat,
      (playerIndex, button, pressed) => this.processRemoteInput(playerIndex, button, pressed),
      runBootstrap => this.applyRunBootstrap(runBootstrap),
      titleStart => this.applyTitleStart(titleStart),
      settingsSnapshot => this.applySettingsSnapshot(settingsSnapshot),
      () => globalScene.getTwoPlayerSettingsSnapshot(),
      event => this.recordInputDebugEvent(event),
      () => globalScene.getTwoPlayerDebugStateCheckpoint(),
      profileSnapshot => this.applyProfileSnapshot(profileSnapshot),
      () => globalScene.getLocalTwoPlayerProfileSnapshot(),
    );
    this.exposeDebugRemoteInput();
    this.listenSyncRepairHotkey();
  }

  detectInputMethod(evt): void {
    if (evt.controller_type === "keyboard") {
      //if the touch property is present and defined, then this is a simulated keyboard event from the touch screen
      if (Object.hasOwn(evt, "isTouch") && evt.isTouch) {
        globalScene.inputMethod = "touch";
      } else {
        globalScene.inputMethod = "keyboard";
      }
    } else if (evt.controller_type === "gamepad") {
      globalScene.inputMethod = "gamepad";
    }
  }

  listenInputs(): void {
    this.events.on(
      "input_down",
      event => {
        if (!globalScene.canAcceptLocalInput()) {
          this.recordInputDebugEvent({
            action: "rejected",
            source: "local",
            reason: "local-seat-mismatch",
            localSeat: globalScene.twoPlayerLocalInputSeat,
            inputOwner: globalScene.inputOwner,
            button: event.button,
            buttonName: Button[event.button] as keyof typeof Button,
            pressed: true,
          });
          return;
        }

        this.detectInputMethod(event);
        this.processLocalButtonInput(event.button, true);
      },
      this,
    );

    this.events.on(
      "input_up",
      event => {
        if (!globalScene.canAcceptLocalInput()) {
          this.recordInputDebugEvent({
            action: "rejected",
            source: "local",
            reason: "local-seat-mismatch",
            localSeat: globalScene.twoPlayerLocalInputSeat,
            inputOwner: globalScene.inputOwner,
            button: event.button,
            buttonName: Button[event.button] as keyof typeof Button,
            pressed: false,
          });
          return;
        }

        this.processLocalButtonInput(event.button, false);
      },
      this,
    );
  }

  public processRemoteInput(playerIndex: PlayerIndex, button: Button, pressed = true): boolean {
    if (!globalScene.canAcceptRemoteInput(playerIndex)) {
      this.recordInputDebugEvent({
        action: "rejected",
        source: "remote",
        reason: "remote-owner-mismatch",
        localSeat: globalScene.twoPlayerLocalInputSeat,
        inputOwner: globalScene.inputOwner,
        playerIndex,
        button,
        buttonName: Button[button] as keyof typeof Button,
        pressed,
      });
      return false;
    }

    if (globalScene.inputOwner === playerIndex) {
      globalScene.setActivePlayerIndex(playerIndex);
    }

    const processed = this.processButtonInput(button, pressed);
    this.recordInputDebugEvent({
      action: processed ? "accepted" : "rejected",
      source: "remote",
      ...(processed ? {} : { reason: "unknown-button" }),
      localSeat: globalScene.twoPlayerLocalInputSeat,
      inputOwner: globalScene.inputOwner,
      playerIndex,
      button,
      buttonName: Button[button] as keyof typeof Button,
      pressed,
    });
    return processed;
  }

  public broadcastTwoPlayerRunBootstrap(seed = globalScene.seed): boolean {
    if (!seed) {
      return false;
    }

    return this.twoPlayerInputTransport?.sendRunBootstrap({ seed }) ?? false;
  }

  public broadcastTwoPlayerTitleStart(titleStart: TwoPlayerTitleStart): boolean {
    return this.twoPlayerInputTransport?.sendTitleStart(titleStart) ?? false;
  }

  public broadcastTwoPlayerProfileSnapshot(): boolean {
    return this.twoPlayerInputTransport?.sendProfileSnapshot(globalScene.getLocalTwoPlayerProfileSnapshot()) ?? false;
  }

  public broadcastTwoPlayerSettingsSnapshot(): boolean {
    return this.twoPlayerInputTransport?.sendSettingsSnapshot(globalScene.getTwoPlayerSettingsSnapshot()) ?? false;
  }

  public broadcastTwoPlayerCheckpoint(reason?: string): boolean {
    return this.twoPlayerInputTransport?.sendCheckpoint(reason) ?? false;
  }

  private applyRunBootstrap(runBootstrap: TwoPlayerRunBootstrap): void {
    globalScene.applyTwoPlayerRunBootstrap(runBootstrap);
  }

  private applyTitleStart(titleStart: TwoPlayerTitleStart): void {
    globalScene.applyTwoPlayerTitleStart(titleStart);
  }

  private applySettingsSnapshot(settingsSnapshot: TwoPlayerSettingsSnapshot): boolean {
    return globalScene.applyTwoPlayerSettingsSnapshot(settingsSnapshot);
  }

  private applyProfileSnapshot(profileSnapshot: TwoPlayerProfileSnapshot): boolean {
    return globalScene.applyTwoPlayerProfileSnapshot(profileSnapshot);
  }

  private processButtonInput(button: Button, pressed: boolean): boolean {
    const actions = pressed ? this.getActionsKeyDown() : this.getActionsKeyUp();
    if (!Object.hasOwn(actions, button)) {
      return false;
    }

    actions[button]();
    return true;
  }

  private processLocalButtonInput(button: Button, pressed: boolean): boolean {
    const inputCheckpoint = this.getInputCheckpoint();
    const inputReadinessBlockReason = this.twoPlayerInputTransport?.getInputReadinessBlockReason(inputCheckpoint);
    if (inputReadinessBlockReason) {
      this.recordInputDebugEvent({
        action: "rejected",
        source: "local",
        reason: inputReadinessBlockReason,
        localSeat: globalScene.twoPlayerLocalInputSeat,
        inputOwner: globalScene.inputOwner,
        button,
        buttonName: Button[button] as keyof typeof Button,
        pressed,
        ...(inputCheckpoint
          ? {
              checkpointFingerprint: inputCheckpoint.fingerprint,
              checkpointSummary: inputCheckpoint.summary,
            }
          : {}),
      });
      return false;
    }

    if (this.twoPlayerInputTransport?.shouldRequestHostAuthority()) {
      const requested = this.twoPlayerInputTransport.requestInput(button, pressed, inputCheckpoint);
      this.recordInputDebugEvent({
        action: requested ? "sent" : "rejected",
        source: "local",
        ...(requested ? { reason: "awaiting-host-authority" } : { reason: "authority-request-failed" }),
        localSeat: globalScene.twoPlayerLocalInputSeat,
        inputOwner: globalScene.inputOwner,
        button,
        buttonName: Button[button] as keyof typeof Button,
        pressed,
      });
      return requested;
    }

    const processed = this.processButtonInput(button, pressed);
    this.recordInputDebugEvent({
      action: processed ? "accepted" : "rejected",
      source: "local",
      ...(processed ? {} : { reason: "unknown-button" }),
      localSeat: globalScene.twoPlayerLocalInputSeat,
      inputOwner: globalScene.inputOwner,
      button,
      buttonName: Button[button] as keyof typeof Button,
      pressed,
    });

    if (processed) {
      this.twoPlayerInputTransport?.send(button, pressed, inputCheckpoint);
    }

    return processed;
  }

  public forceLocalTwoPlayerInput(playerIndex: PlayerIndex, button: Button, pressed = true): boolean {
    if (!globalScene.twoPlayerMode || !globalScene.getActivePlayerIndexes().includes(playerIndex)) {
      return false;
    }

    globalScene.setActivePlayerIndex(playerIndex);
    const processed = this.processButtonInput(button, pressed);
    const checkpoint = this.getInputCheckpoint();
    this.recordInputDebugEvent({
      action: processed ? "accepted" : "rejected",
      source: "local",
      reason: processed ? "sync-repair-force" : "sync-repair-force-unknown-button",
      localSeat: globalScene.twoPlayerLocalInputSeat,
      inputOwner: globalScene.inputOwner,
      playerIndex,
      button,
      buttonName: Button[button] as keyof typeof Button,
      pressed,
      ...(checkpoint
        ? {
            checkpointFingerprint: checkpoint.fingerprint,
            checkpointSummary: checkpoint.summary,
          }
        : {}),
    });
    this.updateSyncRepairOverlay();
    return processed;
  }

  private getInputCheckpoint(): TwoPlayerStateCheckpoint | undefined {
    return globalScene.getTwoPlayerDebugStateCheckpoint();
  }

  private recordInputDebugEvent(event: Omit<TwoPlayerInputDebugEvent, "at">): void {
    const debugEvent = { at: new Date().toISOString(), ...event };
    this.twoPlayerInputDebugEvents.push(debugEvent);
    if (this.twoPlayerInputDebugEvents.length > 100) {
      this.twoPlayerInputDebugEvents.shift();
    }

    if (debugEvent.action === "desync") {
      console.warn("[PokeRogue 2P desync]", debugEvent);
    }
    if (this.twoPlayerInputDebugEnabled || debugEvent.action === "desync") {
      console.debug("[PokeRogue 2P input]", debugEvent);
    }
  }

  private getTwoPlayerSyncStatus(): Record<string, unknown> {
    const checkpoint = globalScene.getTwoPlayerDebugStateCheckpoint();
    const lastDesync = [...this.twoPlayerInputDebugEvents].reverse().find(event => event.action === "desync");

    return {
      profileReady: globalScene.isTwoPlayerProfileExchangeComplete(),
      profileSlotsReady: [...globalScene.twoPlayerProfileSlotsReady],
      localSeat: globalScene.twoPlayerLocalInputSeat,
      inputOwner: globalScene.inputOwner,
      activePlayerIndex: globalScene.activePlayerIndex,
      phase: globalScene.phaseManager.getCurrentPhase()?.phaseName ?? null,
      transport: this.twoPlayerInputTransport?.getStatus(),
      checkpointFingerprint: checkpoint?.fingerprint,
      summary: checkpoint?.summary,
      lastDesync,
    };
  }

  private exposeDebugRemoteInput(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.pokerogueTwoPlayerInput = {
      press: (player, button) => this.processDebugRemoteInput(player, button, true),
      release: (player, button) => this.processDebugRemoteInput(player, button, false),
      force: (player, button) => this.processDebugForcedInput(player, button, true),
      forceRelease: (player, button) => this.processDebugForcedInput(player, button, false),
      checkpoint: () => globalScene.getTwoPlayerDebugStateCheckpoint(),
      sendRunBootstrap: seed => this.broadcastTwoPlayerRunBootstrap(seed ?? globalScene.seed),
      sendTitleStart: titleStart => this.broadcastTwoPlayerTitleStart(titleStart),
      sendProfileSnapshot: () => this.broadcastTwoPlayerProfileSnapshot(),
      sendSettingsSnapshot: () => this.broadcastTwoPlayerSettingsSnapshot(),
      sendCheckpoint: reason => this.broadcastTwoPlayerCheckpoint(reason),
      profileReady: () => globalScene.isTwoPlayerProfileExchangeComplete(),
      profileSlotsReady: () => [...globalScene.twoPlayerProfileSlotsReady] as [boolean, boolean, boolean],
      syncStatus: () => this.getTwoPlayerSyncStatus(),
      transportStatus: () => this.twoPlayerInputTransport?.getStatus(),
      debugEvents: () => [...this.twoPlayerInputDebugEvents],
      clearDebugEvents: () => {
        this.twoPlayerInputDebugEvents.length = 0;
      },
    };
  }

  private processDebugRemoteInput(player: RemoteDebugPlayer, button: RemoteButtonInput, pressed: boolean): boolean {
    const playerIndex = this.parseDebugRemotePlayer(player);
    const parsedButton = this.parseRemoteButton(button);

    return playerIndex !== undefined && parsedButton !== undefined
      ? this.processRemoteInput(playerIndex, parsedButton, pressed)
      : false;
  }

  private processDebugForcedInput(player: RemoteDebugPlayer, button: RemoteButtonInput, pressed: boolean): boolean {
    const playerIndex = this.parseDebugRemotePlayer(player);
    const parsedButton = this.parseRemoteButton(button);

    return playerIndex !== undefined && parsedButton !== undefined
      ? this.forceLocalTwoPlayerInput(playerIndex, parsedButton, pressed)
      : false;
  }

  private parseDebugRemotePlayer(player: RemoteDebugPlayer): PlayerIndex | undefined {
    const normalizedPlayer = `${player}`.toLowerCase();
    switch (normalizedPlayer) {
      case "1":
      case "p1":
      case "player1":
      case "host":
        return 0;
      case "2":
      case "p2":
      case "player2":
      case "guest":
        return 1;
      case "3":
      case "p3":
      case "player3":
      case "guest2":
      case "guest-2":
      case "guest_2":
        return 2;
      default:
        return undefined;
    }
  }

  private parseRemoteButton(button: RemoteButtonInput): Button | undefined {
    if (typeof button === "number") {
      return Button[button] !== undefined ? button : undefined;
    }

    const parsedButton = Button[button.toUpperCase() as keyof typeof Button];
    return typeof parsedButton === "number" ? parsedButton : undefined;
  }

  private listenSyncRepairHotkey(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.addEventListener(
      "keydown",
      event => {
        if (!globalScene.twoPlayerMode) {
          return;
        }

        if (this.isSyncRepairHotkey(event)) {
          event.preventDefault();
          event.stopImmediatePropagation();
          this.toggleSyncRepairOverlay();
          return;
        }

        if (!this.isSyncRepairOverlayVisible()) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        this.handleSyncRepairOverlayKey(event);
      },
      true,
    );
  }

  private isSyncRepairHotkey(event: KeyboardEvent): boolean {
    return event.code === "Backquote" || event.key === "`" || event.key === "~";
  }

  private isSyncRepairOverlayVisible(): boolean {
    return !!this.syncRepairOverlay && this.syncRepairOverlay.style.display !== "none";
  }

  private toggleSyncRepairOverlay(): void {
    if (this.isSyncRepairOverlayVisible()) {
      this.hideSyncRepairOverlay();
    } else {
      this.showSyncRepairOverlay();
    }
  }

  private showSyncRepairOverlay(): void {
    if (!this.syncRepairOverlay) {
      this.createSyncRepairOverlay();
    }

    if (!globalScene.getActivePlayerIndexes().includes(this.selectedSyncRepairPlayer)) {
      this.selectedSyncRepairPlayer = 0;
    }

    this.syncRepairOverlay!.style.display = "flex";
    this.updateSyncRepairOverlay();
  }

  private hideSyncRepairOverlay(): void {
    if (this.syncRepairOverlay) {
      this.syncRepairOverlay.style.display = "none";
    }
  }

  private handleSyncRepairOverlayKey(event: KeyboardEvent): void {
    switch (event.code) {
      case "Escape":
        this.hideSyncRepairOverlay();
        return;
      case "Digit1":
      case "Numpad1":
        this.setSelectedSyncRepairPlayer(0);
        return;
      case "Digit2":
      case "Numpad2":
        this.setSelectedSyncRepairPlayer(1);
        return;
      case "Digit3":
      case "Numpad3":
        this.setSelectedSyncRepairPlayer(2);
        return;
      case "ArrowUp":
      case "KeyW":
        this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, Button.UP);
        return;
      case "ArrowDown":
      case "KeyS":
        this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, Button.DOWN);
        return;
      case "ArrowLeft":
      case "KeyA":
        this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, Button.LEFT);
        return;
      case "ArrowRight":
      case "KeyD":
        this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, Button.RIGHT);
        return;
      case "Enter":
      case "Space":
      case "KeyZ":
        this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, Button.ACTION);
        return;
      case "Backspace":
      case "KeyX":
        this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, Button.CANCEL);
        return;
      case "KeyR":
        this.updateSyncRepairOverlay();
        return;
    }
  }

  private createSyncRepairOverlay(): void {
    const overlay = document.createElement("div");
    overlay.id = "pokerogue-sync-repair-overlay";
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483647",
      "display: none",
      "align-items: center",
      "justify-content: center",
      "background: rgba(0, 0, 0, 0.42)",
      "font-family: monospace",
      "color: #f5f5f5",
      "pointer-events: auto",
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "width: min(720px, calc(100vw - 32px))",
      "max-height: calc(100vh - 32px)",
      "overflow: auto",
      "background: #30283d",
      "border: 4px solid #d63b2d",
      "box-shadow: 0 0 0 4px #19151f, 0 12px 48px rgba(0, 0, 0, 0.5)",
      "padding: 14px",
      "box-sizing: border-box",
    ].join(";");

    const title = document.createElement("div");
    title.textContent = "Sync Repair";
    title.style.cssText = "font-size: 22px; margin-bottom: 8px; color: #ffe66d;";
    panel.append(title);

    const hint = document.createElement("div");
    hint.textContent = "Local-only emergency input. ` or Esc closes. 1/2/3 selects player.";
    hint.style.cssText = "font-size: 13px; margin-bottom: 12px; color: #d8d8d8;";
    panel.append(hint);

    const playerRow = document.createElement("div");
    playerRow.style.cssText = "display: flex; gap: 8px; align-items: center; margin-bottom: 12px;";
    const playerLabel = document.createElement("span");
    playerLabel.textContent = "Simulate:";
    playerRow.append(playerLabel);
    for (const playerIndex of [0, 1, 2] as PlayerIndex[]) {
      const button = this.createSyncRepairButton(`P${playerIndex + 1}`, () =>
        this.setSelectedSyncRepairPlayer(playerIndex),
      );
      button.dataset.syncRepairPlayer = `${playerIndex}`;
      playerRow.append(button);
    }
    panel.append(playerRow);

    const controls = document.createElement("div");
    controls.style.cssText =
      "display: grid; grid-template-columns: repeat(5, minmax(64px, 1fr)); gap: 8px; margin-bottom: 12px;";
    controls.append(document.createElement("div"));
    controls.append(this.createSyncRepairInputButton("UP", Button.UP));
    controls.append(document.createElement("div"));
    controls.append(this.createSyncRepairInputButton("ACTION", Button.ACTION));
    controls.append(this.createSyncRepairInputButton("CANCEL", Button.CANCEL));
    controls.append(this.createSyncRepairInputButton("LEFT", Button.LEFT));
    controls.append(document.createElement("div"));
    controls.append(this.createSyncRepairInputButton("RIGHT", Button.RIGHT));
    controls.append(this.createSyncRepairInputButton("MENU", Button.MENU));
    controls.append(
      this.createSyncRepairButton("Exit", () => {
        this.hideSyncRepairOverlay();
      }),
    );
    controls.append(document.createElement("div"));
    controls.append(this.createSyncRepairInputButton("DOWN", Button.DOWN));
    controls.append(document.createElement("div"));
    controls.append(this.createSyncRepairInputButton("STATS", Button.STATS));
    controls.append(
      this.createSyncRepairButton("Refresh", () => {
        this.updateSyncRepairOverlay();
      }),
    );
    panel.append(controls);

    const statusTitle = document.createElement("div");
    statusTitle.textContent = "Sync Status";
    statusTitle.style.cssText = "font-size: 15px; color: #9fe870; margin: 10px 0 4px;";
    panel.append(statusTitle);

    this.syncRepairStatusText = document.createElement("pre");
    this.syncRepairStatusText.style.cssText = [
      "white-space: pre-wrap",
      "margin: 0",
      "padding: 8px",
      "background: rgba(0, 0, 0, 0.22)",
      "font-size: 12px",
      "line-height: 1.35",
    ].join(";");
    panel.append(this.syncRepairStatusText);

    const logTitle = document.createElement("div");
    logTitle.textContent = "Recent Input Events";
    logTitle.style.cssText = "font-size: 15px; color: #9fe870; margin: 10px 0 4px;";
    panel.append(logTitle);

    this.syncRepairLogText = document.createElement("pre");
    this.syncRepairLogText.style.cssText = this.syncRepairStatusText.style.cssText;
    panel.append(this.syncRepairLogText);

    overlay.append(panel);
    document.body.append(overlay);
    this.syncRepairOverlay = overlay;
  }

  private createSyncRepairInputButton(label: string, button: Button): HTMLButtonElement {
    return this.createSyncRepairButton(label, () => {
      this.forceLocalTwoPlayerInput(this.selectedSyncRepairPlayer, button);
    });
  }

  private createSyncRepairButton(label: string, action: () => void): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.style.cssText = [
      "min-height: 34px",
      "background: #4b405f",
      "border: 2px solid #9488a8",
      "color: #fff",
      "font: inherit",
      "cursor: pointer",
    ].join(";");
    button.addEventListener("click", event => {
      event.preventDefault();
      event.stopPropagation();
      action();
      this.updateSyncRepairOverlay();
    });
    return button;
  }

  private setSelectedSyncRepairPlayer(playerIndex: PlayerIndex): void {
    if (!globalScene.getActivePlayerIndexes().includes(playerIndex)) {
      return;
    }

    this.selectedSyncRepairPlayer = playerIndex;
    this.updateSyncRepairOverlay();
  }

  private updateSyncRepairOverlay(): void {
    if (!this.syncRepairOverlay) {
      return;
    }

    for (const button of this.syncRepairOverlay.querySelectorAll<HTMLButtonElement>("[data-sync-repair-player]")) {
      const playerIndex = Number(button.dataset.syncRepairPlayer) as PlayerIndex;
      const active = globalScene.getActivePlayerIndexes().includes(playerIndex);
      button.disabled = !active;
      button.style.opacity = active ? "1" : "0.45";
      button.style.borderColor = playerIndex === this.selectedSyncRepairPlayer ? "#ffe66d" : "#9488a8";
      button.style.background = playerIndex === this.selectedSyncRepairPlayer ? "#6b5530" : "#4b405f";
    }

    if (this.syncRepairStatusText) {
      this.syncRepairStatusText.textContent = this.formatSyncRepairStatus();
    }
    if (this.syncRepairLogText) {
      this.syncRepairLogText.textContent = this.formatSyncRepairLog();
    }
  }

  private formatSyncRepairStatus(): string {
    const status = this.getTwoPlayerSyncStatus();
    const transport = status.transport as TwoPlayerInputTransportStatus | undefined;
    const summary = status.summary as Record<string, unknown> | undefined;
    const fingerprint = typeof status.checkpointFingerprint === "string" ? status.checkpointFingerprint.slice(0, 12) : "none";
    const profileReady = globalScene.twoPlayerProfileSlotsReady
      .map((ready, index) => `P${index + 1}:${ready ? "ready" : "waiting"}`)
      .join("  ");

    return [
      `Selected: P${this.selectedSyncRepairPlayer + 1}`,
      `Local seat: ${String(status.localSeat)}   Input owner: ${String(status.inputOwner)}   Active: P${Number(status.activePlayerIndex) + 1}`,
      `Phase: ${String(status.phase)}   UI: ${summary?.uiMode ?? "unknown"}   Fingerprint: ${fingerprint}`,
      `Profiles: ${profileReady}`,
      `Transport: ${transport?.networkRole ?? "unknown"} ${transport?.mode ?? ""} ${transport?.enabled ? "open" : "closed"}`,
      status.lastDesync ? `Last desync: ${(status.lastDesync as TwoPlayerInputDebugEvent).reason ?? "desync"}` : "Last desync: none recorded",
    ].join("\n");
  }

  private formatSyncRepairLog(): string {
    const events = this.twoPlayerInputDebugEvents.slice(-5);
    if (events.length === 0) {
      return "No input events recorded yet.";
    }

    return events
      .map(event => {
        const player = event.playerIndex === undefined ? "-" : `P${event.playerIndex + 1}`;
        const button = event.buttonName ?? (event.button !== undefined ? Button[event.button] : "-");
        const reason = event.reason ? ` (${event.reason})` : "";
        return `${event.at.slice(11, 19)} ${event.action} ${event.source} ${player} ${button}${reason}`;
      })
      .join("\n");
  }

  doVibration(inputSuccess: boolean, vibrationLength: number): void {
    if (inputSuccess && globalScene.enableVibration && typeof navigator.vibrate !== "undefined") {
      navigator.vibrate(vibrationLength);
    }
  }

  getActionsKeyDown(): ActionKeys {
    const actions: ActionKeys = {
      [Button.UP]: () => this.buttonDirection(Button.UP),
      [Button.DOWN]: () => this.buttonDirection(Button.DOWN),
      [Button.LEFT]: () => this.buttonDirection(Button.LEFT),
      [Button.RIGHT]: () => this.buttonDirection(Button.RIGHT),
      [Button.SUBMIT]: () => this.buttonTouch(),
      [Button.ACTION]: () => this.buttonAb(Button.ACTION),
      [Button.CANCEL]: () => this.buttonAb(Button.CANCEL),
      [Button.MENU]: () => this.buttonMenu(),
      [Button.STATS]: () => this.buttonGoToFilter(Button.STATS),
      [Button.CYCLE_SHINY]: () => this.buttonCycleOption(Button.CYCLE_SHINY),
      [Button.CYCLE_FORM]: () => this.buttonCycleOption(Button.CYCLE_FORM),
      [Button.CYCLE_GENDER]: () => this.buttonCycleOption(Button.CYCLE_GENDER),
      [Button.CYCLE_ABILITY]: () => this.buttonCycleOption(Button.CYCLE_ABILITY),
      [Button.CYCLE_NATURE]: () => this.buttonCycleOption(Button.CYCLE_NATURE),
      [Button.CYCLE_TERA]: () => this.buttonCycleOption(Button.CYCLE_TERA),
      [Button.SPEED_UP]: () => this.buttonSpeedChange(),
      [Button.SLOW_DOWN]: () => this.buttonSpeedChange(false),
      [Button.DEV_CUSTOM]: () => {
        if (isDev) {
          import("./dev-function").then(m => m.customDevFunction());
        }
      },
    };
    return actions;
  }

  getActionsKeyUp(): ActionKeys {
    const actions: ActionKeys = {
      [Button.UP]: () => {},
      [Button.DOWN]: () => {},
      [Button.LEFT]: () => {},
      [Button.RIGHT]: () => {},
      [Button.SUBMIT]: () => {},
      [Button.ACTION]: () => {},
      [Button.CANCEL]: () => {},
      [Button.MENU]: () => {},
      [Button.STATS]: () => this.buttonStats(false),
      [Button.CYCLE_SHINY]: () => {},
      [Button.CYCLE_FORM]: () => {},
      [Button.CYCLE_GENDER]: () => {},
      [Button.CYCLE_ABILITY]: () => {},
      [Button.CYCLE_NATURE]: () => {},
      [Button.CYCLE_TERA]: () => this.buttonInfo(false),
      [Button.SPEED_UP]: () => {},
      [Button.SLOW_DOWN]: () => {},
      [Button.DEV_CUSTOM]: () => {},
    };
    return actions;
  }

  buttonDirection(direction: Button): void {
    const inputSuccess = globalScene.ui.processInput(direction);
    const vibrationLength = 5;
    this.doVibration(inputSuccess, vibrationLength);
  }

  buttonAb(button: Button): void {
    globalScene.ui.processInput(button);
  }

  buttonTouch(): void {
    globalScene.ui.processInput(Button.SUBMIT) || globalScene.ui.processInput(Button.ACTION);
  }

  buttonStats(pressed = true): void {
    // allow access to Button.STATS as a toggle for other elements
    for (const t of globalScene.getInfoToggles(true)) {
      t.toggleInfo(pressed);
    }
    // handle normal pokemon battle ui
    for (const p of globalScene.getField().filter(p => p?.isActive(true))) {
      p.toggleStats(pressed);
    }
  }

  buttonGoToFilter(button: Button): void {
    const whitelist = [StarterSelectUiHandler, PokedexUiHandler, PokedexPageUiHandler, SummaryUiHandler];
    const uiHandler = globalScene.ui?.getHandler();
    if (whitelist.some(handler => uiHandler instanceof handler)) {
      globalScene.ui.processInput(button);
    } else {
      this.buttonStats(true);
    }
  }

  buttonInfo(pressed = true): void {
    if (globalScene.showMovesetFlyout) {
      for (const p of globalScene.getEnemyField().filter(p => p?.isActive(true))) {
        p.toggleFlyout(pressed);
      }
    }

    if (globalScene.showArenaFlyout) {
      globalScene.ui.processInfoButton(pressed);
    }
  }

  buttonMenu(): void {
    if (globalScene.disableMenu) {
      return;
    }
    switch (globalScene.ui?.getMode()) {
      // biome-ignore lint/suspicious/noFallthroughSwitchClause: falls through to show menu overlay
      case UiMode.MESSAGE: {
        const messageHandler = globalScene.ui.getHandler<MessageUiHandler>();
        if (!messageHandler.pendingPrompt || messageHandler.isTextAnimationInProgress()) {
          return;
        }
      }
      case UiMode.TITLE:
      case UiMode.COMMAND:
      case UiMode.MODIFIER_SELECT:
      case UiMode.MYSTERY_ENCOUNTER:
        globalScene.ui.setOverlayMode(UiMode.MENU);
        break;
      case UiMode.STARTER_SELECT:
      case UiMode.POKEDEX_PAGE:
        this.buttonTouch();
        break;
      case UiMode.MENU:
        globalScene.ui.revertMode();
        audioManager.playSound("ui/select");
        break;
      default:
        return;
    }
  }

  buttonCycleOption(button: Button): void {
    const whitelist = [
      StarterSelectUiHandler,
      PokedexUiHandler,
      PokedexPageUiHandler,
      SettingsUiHandler,
      RunInfoUiHandler,
      SettingsDisplayUiHandler,
      SettingsAudioUiHandler,
      SettingsEventsUiHandler,
      SettingsGamepadUiHandler,
      SettingsKeyboardUiHandler,
    ];
    const uiHandler = globalScene.ui?.getHandler();
    if (whitelist.some(handler => uiHandler instanceof handler)) {
      globalScene.ui.processInput(button);
    } else if (button === Button.CYCLE_TERA) {
      this.buttonInfo(true);
    }
  }

  buttonSpeedChange(up = true): void {
    const settingGameSpeed = settingIndex(SettingKeys.Game_Speed);
    const settingOptions = Setting[settingGameSpeed].options;
    let currentSetting = settingOptions.findIndex(item => item.value === globalScene.gameSpeed.toString());
    // if current setting is -1, then the current game speed is not a valid option, so default to index 1 (3x)
    if (currentSetting === -1) {
      currentSetting = 1;
    }
    let direction: number;
    if (up && globalScene.gameSpeed < 5) {
      direction = 1;
    } else if (!up && globalScene.gameSpeed > 2) {
      direction = -1;
    } else {
      return;
    }
    globalScene.gameData.saveSetting(
      SettingKeys.Game_Speed,
      Phaser.Math.Clamp(currentSetting + direction, 0, settingOptions.length - 1),
    );
    if (globalScene.ui?.getMode() === UiMode.SETTINGS) {
      (globalScene.ui.getHandler() as SettingsUiHandler).show([]);
    }
  }
}
