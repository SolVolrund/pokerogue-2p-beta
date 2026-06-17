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
  type TwoPlayerRunBootstrap,
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
import Phaser from "phaser";

type ActionKeys = Record<Button, () => void>;
type RemoteButtonInput = Button | keyof typeof Button;
type RemoteDebugPlayer = 1 | 2 | "1" | "2" | "p1" | "p2" | "player1" | "player2" | "host" | "guest";

declare global {
  interface Window {
    pokerogueTwoPlayerInput?: {
      press(player: RemoteDebugPlayer, button: RemoteButtonInput): boolean;
      release(player: RemoteDebugPlayer, button: RemoteButtonInput): boolean;
      checkpoint(): TwoPlayerDebugStateCheckpoint | undefined;
      sendRunBootstrap(seed?: string): boolean;
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
      event => this.recordInputDebugEvent(event),
      this.twoPlayerInputDebugEnabled ? () => globalScene.getTwoPlayerDebugStateCheckpoint() : undefined,
    );
    this.exposeDebugRemoteInput();
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

  private applyRunBootstrap(runBootstrap: TwoPlayerRunBootstrap): void {
    globalScene.applyTwoPlayerRunBootstrap(runBootstrap);
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
    if (this.twoPlayerInputTransport?.shouldRequestHostAuthority()) {
      const requested = this.twoPlayerInputTransport.requestInput(button, pressed);
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
      this.twoPlayerInputTransport?.send(button, pressed);
    }

    return processed;
  }

  private recordInputDebugEvent(event: Omit<TwoPlayerInputDebugEvent, "at">): void {
    if (!this.twoPlayerInputDebugEnabled) {
      return;
    }

    const debugEvent = { at: new Date().toISOString(), ...event };
    this.twoPlayerInputDebugEvents.push(debugEvent);
    if (this.twoPlayerInputDebugEvents.length > 100) {
      this.twoPlayerInputDebugEvents.shift();
    }

    console.debug("[PokeRogue 2P input]", debugEvent);
  }

  private exposeDebugRemoteInput(): void {
    if (typeof window === "undefined") {
      return;
    }

    window.pokerogueTwoPlayerInput = {
      press: (player, button) => this.processDebugRemoteInput(player, button, true),
      release: (player, button) => this.processDebugRemoteInput(player, button, false),
      checkpoint: () => globalScene.getTwoPlayerDebugStateCheckpoint(),
      sendRunBootstrap: seed => this.broadcastTwoPlayerRunBootstrap(seed ?? globalScene.seed),
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
    const whitelist = [StarterSelectUiHandler, PokedexUiHandler, PokedexPageUiHandler];
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
