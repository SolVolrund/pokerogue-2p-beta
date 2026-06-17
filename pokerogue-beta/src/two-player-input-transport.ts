import type { InputOwner, LocalInputSeat, PlayerIndex } from "#app/battle-scene";
import { Button } from "#enums/buttons";

const LOCAL_INPUT_PROTOCOL = "pokerogue-2p-local-input";
const LOCAL_INPUT_PROTOCOL_VERSION = 1;

interface TwoPlayerInputMessage {
  protocol: typeof LOCAL_INPUT_PROTOCOL;
  version: typeof LOCAL_INPUT_PROTOCOL_VERSION;
  sessionId: string;
  senderId: string;
  sequence: number;
  playerIndex: PlayerIndex;
  button: Button;
  pressed: boolean;
}

export interface TwoPlayerInputTransportStatus {
  enabled: boolean;
  mode?: "local" | "websocket";
  channelName?: string;
  webSocketUrl?: string;
  webSocketState?: number;
  localSeat: LocalInputSeat;
  sequence: number;
}

export type RemoteInputHandler = (playerIndex: PlayerIndex, button: Button, pressed: boolean) => boolean;
export type TwoPlayerInputDebugAction =
  | "accepted"
  | "rejected"
  | "sent"
  | "received"
  | "ignored"
  | "connected"
  | "disconnected"
  | "error";

export interface TwoPlayerInputDebugEvent {
  at: string;
  action: TwoPlayerInputDebugAction;
  source: "local" | "remote" | "transport";
  reason?: string;
  sessionId?: string;
  channelName?: string;
  webSocketUrl?: string;
  senderId?: string;
  sequence?: number;
  localSeat?: LocalInputSeat;
  inputOwner?: InputOwner;
  playerIndex?: PlayerIndex;
  button?: Button;
  buttonName?: keyof typeof Button;
  pressed?: boolean;
}

export type TwoPlayerInputDebugLogger = (event: Omit<TwoPlayerInputDebugEvent, "at">) => void;

function getLocalTransportMode(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URLSearchParams(window.location.search).get("twoPlayerInputTransport")?.toLowerCase();
}

function getWebSocketUrl(): string {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:8787";
  }

  return new URLSearchParams(window.location.search).get("twoPlayerWsUrl") || "ws://127.0.0.1:8787";
}

function getLocalTransportSessionId(): string {
  if (typeof window === "undefined") {
    return "default";
  }

  return new URLSearchParams(window.location.search).get("twoPlayerSession") || "default";
}

export function isTwoPlayerInputDebugEnabled(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const debugValue = new URLSearchParams(window.location.search).get("twoPlayerInputDebug")?.toLowerCase();
  return debugValue === "1" || debugValue === "true";
}

function isValidPlayerIndex(playerIndex: unknown): playerIndex is PlayerIndex {
  return playerIndex === 0 || playerIndex === 1;
}

function isValidButton(button: unknown): button is Button {
  return typeof button === "number" && Button[button] !== undefined;
}

function isTwoPlayerInputMessage(value: unknown): value is TwoPlayerInputMessage {
  if (!value || typeof value !== "object") {
    return false;
  }

  const message = value as Partial<TwoPlayerInputMessage>;
  return (
    message.protocol === LOCAL_INPUT_PROTOCOL
    && message.version === LOCAL_INPUT_PROTOCOL_VERSION
    && typeof message.sessionId === "string"
    && typeof message.senderId === "string"
    && typeof message.sequence === "number"
    && isValidPlayerIndex(message.playerIndex)
    && isValidButton(message.button)
    && typeof message.pressed === "boolean"
  );
}

export class TwoPlayerInputTransport {
  private readonly mode: "local" | "websocket";
  private readonly sessionId = getLocalTransportSessionId();
  private readonly senderId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private readonly channelName = `pokerogue-2p-input:${this.sessionId}`;
  private readonly webSocketUrl = getWebSocketUrl();
  private channel: BroadcastChannel | undefined;
  private webSocket: WebSocket | undefined;
  private sequence = 0;

  private constructor(
    mode: "local" | "websocket",
    private readonly localSeat: PlayerIndex,
    private readonly onRemoteInput: RemoteInputHandler,
    private readonly logDebug?: TwoPlayerInputDebugLogger,
  ) {
    this.mode = mode;
  }

  public static create(
    localSeat: LocalInputSeat,
    onRemoteInput: RemoteInputHandler,
    logDebug?: TwoPlayerInputDebugLogger,
  ): TwoPlayerInputTransport | undefined {
    const mode = getLocalTransportMode();
    if (localSeat === "both") {
      return undefined;
    }

    if (mode === "local" || mode === "broadcast" || mode === "loopback") {
      if (typeof BroadcastChannel === "undefined") {
        return undefined;
      }

      const transport = new TwoPlayerInputTransport("local", localSeat, onRemoteInput, logDebug);
      transport.startLocal();
      return transport;
    }

    if (mode === "websocket" || mode === "ws") {
      if (typeof WebSocket === "undefined") {
        return undefined;
      }

      const transport = new TwoPlayerInputTransport("websocket", localSeat, onRemoteInput, logDebug);
      transport.startWebSocket();
      return transport;
    }

    return undefined;
  }

  public send(button: Button, pressed: boolean): void {
    const message: TwoPlayerInputMessage = {
      protocol: LOCAL_INPUT_PROTOCOL,
      version: LOCAL_INPUT_PROTOCOL_VERSION,
      sessionId: this.sessionId,
      senderId: this.senderId,
      sequence: ++this.sequence,
      playerIndex: this.localSeat,
      button,
      pressed,
    };

    const sent = this.sendMessage(message);
    this.logDebug?.({
      action: sent ? "sent" : "rejected",
      source: "transport",
      ...(sent ? {} : { reason: "transport-not-open" }),
      sessionId: this.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: this.senderId,
      sequence: message.sequence,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
  }

  public getStatus(): TwoPlayerInputTransportStatus {
    return {
      enabled: !!this.channel || this.webSocket?.readyState === WebSocket.OPEN,
      mode: this.mode,
      ...(this.mode === "local" ? { channelName: this.channelName } : {}),
      ...(this.mode === "websocket"
        ? { webSocketUrl: this.webSocketUrl, ...(this.webSocket ? { webSocketState: this.webSocket.readyState } : {}) }
        : {}),
      localSeat: this.localSeat,
      sequence: this.sequence,
    };
  }

  private sendMessage(message: TwoPlayerInputMessage): boolean {
    if (this.mode === "local" && this.channel) {
      this.channel.postMessage(message);
      return true;
    }

    if (this.mode === "websocket" && this.webSocket?.readyState === WebSocket.OPEN) {
      this.webSocket.send(JSON.stringify(message));
      return true;
    }

    return false;
  }

  private startLocal(): void {
    this.channel = new BroadcastChannel(this.channelName);
    this.channel.addEventListener("message", this.onMessage);
  }

  private startWebSocket(): void {
    this.webSocket = new WebSocket(this.webSocketUrl);
    this.webSocket.addEventListener("open", () => {
      this.logDebug?.({
        action: "connected",
        source: "transport",
        sessionId: this.sessionId,
        webSocketUrl: this.webSocketUrl,
        localSeat: this.localSeat,
      });
    });
    this.webSocket.addEventListener("message", event => {
      this.onMessageData(event.data);
    });
    this.webSocket.addEventListener("close", () => {
      this.logDebug?.({
        action: "disconnected",
        source: "transport",
        sessionId: this.sessionId,
        webSocketUrl: this.webSocketUrl,
        localSeat: this.localSeat,
      });
    });
    this.webSocket.addEventListener("error", () => {
      this.logDebug?.({
        action: "error",
        source: "transport",
        reason: "websocket-error",
        sessionId: this.sessionId,
        webSocketUrl: this.webSocketUrl,
        localSeat: this.localSeat,
      });
    });
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    this.onMessageData(event.data);
  };

  private onMessageData(data: unknown): void {
    const message = this.parseMessageData(data);
    if (!isTwoPlayerInputMessage(message)) {
      this.logDebug?.({
        action: "ignored",
        source: "transport",
        reason: "invalid-message",
        sessionId: this.sessionId,
        channelName: this.channelName,
        ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
        localSeat: this.localSeat,
      });
      return;
    }

    if (message.sessionId !== this.sessionId || message.senderId === this.senderId) {
      this.logDebug?.({
        action: "ignored",
        source: "transport",
        reason: message.senderId === this.senderId ? "own-message" : "different-session",
        sessionId: message.sessionId,
        channelName: this.channelName,
        ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
        senderId: message.senderId,
        sequence: message.sequence,
        localSeat: this.localSeat,
        playerIndex: message.playerIndex,
        button: message.button,
        buttonName: Button[message.button] as keyof typeof Button,
        pressed: message.pressed,
      });
      return;
    }

    this.logDebug?.({
      action: "received",
      source: "transport",
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
    const accepted = this.onRemoteInput(message.playerIndex, message.button, message.pressed);
    this.logDebug?.({
      action: accepted ? "accepted" : "rejected",
      source: "remote",
      ...(accepted ? {} : { reason: "remote-input-rejected" }),
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
  }

  private parseMessageData(data: unknown): unknown {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return undefined;
      }
    }

    return data;
  }
}
