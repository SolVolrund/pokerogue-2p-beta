import type { InputOwner, LocalInputSeat, PlayerIndex } from "#app/battle-scene";
import { Button } from "#enums/buttons";
import type { ComputerPartnerKey, ComputerPartnerRolePreferences } from "#utils/computer-partner-profile";

const LOCAL_INPUT_PROTOCOL = "pokerogue-2p-local-input";
const LOCAL_INPUT_PROTOCOL_VERSION = 1;
const DEFAULT_STRICT_INPUT_CONTEXT_GRACE_MS = 100;
const POST_INPUT_CHECKPOINT_DELAY_MS = 50;

type TwoPlayerInputMessageKind =
  | "input"
  | "input-request"
  | "input-accepted"
  | "run-bootstrap"
  | "title-start"
  | "settings-sync"
  | "state-checkpoint"
  | "profile-snapshot";

export type TwoPlayerNetworkRole = "peer" | "host" | "guest";

export interface TwoPlayerInputContext {
  id: string;
  promptId?: string;
  strict: boolean;
  key: Record<string, unknown>;
}

export interface TwoPlayerStateCheckpoint {
  fingerprint: string;
  summary: Record<string, unknown>;
  inputContext?: TwoPlayerInputContext;
}

export interface TwoPlayerRunBootstrap {
  seed: string;
}

export interface TwoPlayerTitleStart {
  action: "new-run" | "load-session";
  gameMode?: number;
  partySize?: 3 | 6;
  playerCount?: 2 | 3;
  computerPartnerPlayerIndexes?: PlayerIndex[];
  computerPartnerKeys?: Partial<Record<PlayerIndex, ComputerPartnerKey>>;
  computerPartnerRolePreferences?: Partial<Record<PlayerIndex, ComputerPartnerRolePreferences>>;
  slotId?: number;
  seed?: string;
}

export interface TwoPlayerProfileSnapshot {
  playerIndex: PlayerIndex;
  systemSave: string;
}

export interface TwoPlayerSettingsSnapshot {
  settings: Record<string, number>;
}

interface TwoPlayerInputMessage {
  protocol: typeof LOCAL_INPUT_PROTOCOL;
  version: typeof LOCAL_INPUT_PROTOCOL_VERSION;
  kind: TwoPlayerInputMessageKind;
  sessionId: string;
  senderId: string;
  senderRole?: TwoPlayerNetworkRole;
  sequence: number;
  authoritySequence?: number;
  playerIndex: PlayerIndex;
  button: Button;
  pressed: boolean;
  runBootstrap?: TwoPlayerRunBootstrap;
  titleStart?: TwoPlayerTitleStart;
  settingsSnapshot?: TwoPlayerSettingsSnapshot;
  checkpoint?: TwoPlayerStateCheckpoint;
  profileSnapshot?: TwoPlayerProfileSnapshot;
}

type RawTwoPlayerInputMessage = Omit<TwoPlayerInputMessage, "kind"> & { kind?: TwoPlayerInputMessageKind };

export interface TwoPlayerInputTransportStatus {
  enabled: boolean;
  mode?: "local" | "websocket";
  networkRole: TwoPlayerNetworkRole;
  channelName?: string;
  webSocketUrl?: string;
  webSocketState?: number;
  localSeat: LocalInputSeat;
  sequence: number;
  authoritySequence: number;
}

export type RemoteInputHandler = (playerIndex: PlayerIndex, button: Button, pressed: boolean) => boolean;
export type TwoPlayerRunBootstrapHandler = (bootstrap: TwoPlayerRunBootstrap) => void;
export type TwoPlayerTitleStartHandler = (titleStart: TwoPlayerTitleStart) => void;
export type TwoPlayerSettingsSnapshotHandler = (settingsSnapshot: TwoPlayerSettingsSnapshot) => boolean;
export type TwoPlayerSettingsSnapshotProvider = () => TwoPlayerSettingsSnapshot | undefined;
export type TwoPlayerProfileSnapshotHandler = (profileSnapshot: TwoPlayerProfileSnapshot) => boolean;
export type TwoPlayerProfileSnapshotProvider = () => TwoPlayerProfileSnapshot | undefined;
export type TwoPlayerStateCheckpointProvider = () => TwoPlayerStateCheckpoint | undefined;
export type TwoPlayerInputLockoutMsProvider = () => number;
export type TwoPlayerInputDebugAction =
  | "accepted"
  | "rejected"
  | "sent"
  | "received"
  | "ignored"
  | "connected"
  | "disconnected"
  | "error"
  | "checkpoint"
  | "desync";

export interface TwoPlayerInputDebugEvent {
  at: string;
  action: TwoPlayerInputDebugAction;
  source: "local" | "remote" | "transport";
  reason?: string;
  sessionId?: string;
  channelName?: string;
  webSocketUrl?: string;
  senderId?: string;
  senderRole?: TwoPlayerNetworkRole;
  sequence?: number;
  authoritySequence?: number;
  messageKind?: TwoPlayerInputMessageKind;
  localSeat?: LocalInputSeat;
  inputOwner?: InputOwner;
  playerIndex?: PlayerIndex;
  button?: Button;
  buttonName?: keyof typeof Button;
  pressed?: boolean;
  checkpointFingerprint?: string;
  localFingerprint?: string;
  remoteFingerprint?: string;
  localInputContextId?: string;
  remoteInputContextId?: string;
  checkpointSummary?: Record<string, unknown>;
  profilePlayerIndex?: PlayerIndex;
  settingsKeys?: string[];
}

export type TwoPlayerInputDebugLogger = (event: Omit<TwoPlayerInputDebugEvent, "at">) => void;

interface RemoteCheckpointEntry {
  playerIndex: PlayerIndex;
  label: string;
  sequence: number;
  checkpoint: TwoPlayerStateCheckpoint;
  inputContextPromptId?: string;
  inputContextPromptSeenAt: number;
}

function getLocalTransportMode(): string | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  return new URLSearchParams(window.location.search).get("twoPlayerInputTransport")?.toLowerCase();
}

function getNetworkRole(): TwoPlayerNetworkRole {
  if (typeof window === "undefined") {
    return "peer";
  }

  const role = new URLSearchParams(window.location.search).get("twoPlayerNetworkRole")?.toLowerCase();
  switch (role) {
    case "host":
      return "host";
    case "guest":
    case "client":
      return "guest";
    default:
      return "peer";
  }
}

function getWebSocketUrl(): string {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:8787";
  }

  const configuredUrl = new URLSearchParams(window.location.search).get("twoPlayerWsUrl");
  if (configuredUrl) {
    return configuredUrl;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.hostname || "127.0.0.1"}:8787`;
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
  return playerIndex === 0 || playerIndex === 1 || playerIndex === 2;
}

function isValidButton(button: unknown): button is Button {
  return typeof button === "number" && Button[button] !== undefined;
}

function isValidMessageKind(kind: unknown): kind is TwoPlayerInputMessageKind {
  return kind === undefined
    || kind === "input"
    || kind === "input-request"
    || kind === "input-accepted"
    || kind === "run-bootstrap"
    || kind === "title-start"
    || kind === "settings-sync"
    || kind === "state-checkpoint"
    || kind === "profile-snapshot";
}

function isValidNetworkRole(role: unknown): role is TwoPlayerNetworkRole | undefined {
  return role === undefined || role === "peer" || role === "host" || role === "guest";
}

function isValidRunBootstrap(runBootstrap: unknown): runBootstrap is TwoPlayerRunBootstrap {
  return !!runBootstrap
    && typeof runBootstrap === "object"
    && typeof (runBootstrap as Partial<TwoPlayerRunBootstrap>).seed === "string"
    && (runBootstrap as Partial<TwoPlayerRunBootstrap>).seed!.length > 0;
}

function isValidTitleStart(titleStart: unknown): titleStart is TwoPlayerTitleStart {
  if (!titleStart || typeof titleStart !== "object") {
    return false;
  }

  const data = titleStart as Partial<TwoPlayerTitleStart>;
  return (data.action === "new-run" || data.action === "load-session")
    && (data.gameMode === undefined || typeof data.gameMode === "number")
    && (data.partySize === undefined || data.partySize === 3 || data.partySize === 6)
    && (data.playerCount === undefined || data.playerCount === 2 || data.playerCount === 3)
    && (data.slotId === undefined || typeof data.slotId === "number")
    && (data.seed === undefined || (typeof data.seed === "string" && data.seed.length > 0));
}

function isValidCheckpoint(checkpoint: unknown): checkpoint is TwoPlayerStateCheckpoint {
  return !!checkpoint
    && typeof checkpoint === "object"
    && typeof (checkpoint as Partial<TwoPlayerStateCheckpoint>).fingerprint === "string"
    && !!(checkpoint as Partial<TwoPlayerStateCheckpoint>).summary
    && typeof (checkpoint as Partial<TwoPlayerStateCheckpoint>).summary === "object";
}

function getStrictInputContext(checkpoint: TwoPlayerStateCheckpoint | undefined): TwoPlayerInputContext | undefined {
  const inputContext = checkpoint?.inputContext;
  if (
    !inputContext
    || !inputContext.strict
    || typeof inputContext.id !== "string"
    || (inputContext.promptId !== undefined && typeof inputContext.promptId !== "string")
    || !inputContext.key
    || typeof inputContext.key !== "object"
  ) {
    return undefined;
  }

  return inputContext;
}

function getInputContextPromptId(inputContext: TwoPlayerInputContext): string {
  return inputContext.promptId ?? inputContext.id;
}

function isTitlePhaseCheckpoint(checkpoint: TwoPlayerStateCheckpoint | undefined): boolean {
  return checkpoint?.summary?.phase === "TitlePhase";
}

function isValidProfileSnapshot(profileSnapshot: unknown): profileSnapshot is TwoPlayerProfileSnapshot {
  return !!profileSnapshot
    && typeof profileSnapshot === "object"
    && isValidPlayerIndex((profileSnapshot as Partial<TwoPlayerProfileSnapshot>).playerIndex)
    && typeof (profileSnapshot as Partial<TwoPlayerProfileSnapshot>).systemSave === "string"
    && (profileSnapshot as Partial<TwoPlayerProfileSnapshot>).systemSave!.length > 0;
}

function isValidSettingsSnapshot(settingsSnapshot: unknown): settingsSnapshot is TwoPlayerSettingsSnapshot {
  if (!settingsSnapshot || typeof settingsSnapshot !== "object") {
    return false;
  }

  const settings = (settingsSnapshot as Partial<TwoPlayerSettingsSnapshot>).settings;
  return !!settings
    && typeof settings === "object"
    && Object.values(settings).every(value => Number.isInteger(value));
}

function parseTwoPlayerInputMessage(value: unknown): TwoPlayerInputMessage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const message = value as Partial<RawTwoPlayerInputMessage>;
  const kind = message.kind ?? "input";
  if (
    message.protocol !== LOCAL_INPUT_PROTOCOL
    || message.version !== LOCAL_INPUT_PROTOCOL_VERSION
    || !isValidMessageKind(kind)
    || typeof message.sessionId !== "string"
    || typeof message.senderId !== "string"
    || !isValidNetworkRole(message.senderRole)
    || typeof message.sequence !== "number"
    || (message.authoritySequence !== undefined && typeof message.authoritySequence !== "number")
    || !isValidPlayerIndex(message.playerIndex)
    || !isValidButton(message.button)
    || typeof message.pressed !== "boolean"
    || (kind === "run-bootstrap" && !isValidRunBootstrap(message.runBootstrap))
    || (kind === "title-start" && !isValidTitleStart(message.titleStart))
    || (kind === "settings-sync" && !isValidSettingsSnapshot(message.settingsSnapshot))
    || (message.checkpoint !== undefined && !isValidCheckpoint(message.checkpoint))
    || (kind === "profile-snapshot" && !isValidProfileSnapshot(message.profileSnapshot))
  ) {
    return undefined;
  }

  return {
    protocol: message.protocol,
    version: message.version,
    kind,
    sessionId: message.sessionId,
    senderId: message.senderId,
    ...(message.senderRole === undefined ? {} : { senderRole: message.senderRole }),
    sequence: message.sequence,
    ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
    playerIndex: message.playerIndex,
    button: message.button,
    pressed: message.pressed,
    ...(kind === "run-bootstrap" ? { runBootstrap: message.runBootstrap } : {}),
    ...(kind === "title-start" ? { titleStart: message.titleStart } : {}),
    ...(kind === "settings-sync" ? { settingsSnapshot: message.settingsSnapshot } : {}),
    ...(message.checkpoint === undefined ? {} : { checkpoint: message.checkpoint }),
    ...(kind === "profile-snapshot" ? { profileSnapshot: message.profileSnapshot } : {}),
  };
}

export class TwoPlayerInputTransport {
  private readonly mode: "local" | "websocket";
  private readonly networkRole = getNetworkRole();
  private readonly sessionId = getLocalTransportSessionId();
  private readonly senderId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private readonly channelName = `pokerogue-2p-input:${this.sessionId}`;
  private readonly webSocketUrl = getWebSocketUrl();
  private channel: BroadcastChannel | undefined;
  private webSocket: WebSocket | undefined;
  private sequence = 0;
  private authoritySequence = 0;
  private latestRemoteCheckpoint: TwoPlayerStateCheckpoint | undefined;
  private latestHostCheckpoint: TwoPlayerStateCheckpoint | undefined;
  private readonly latestRemoteCheckpointsByPlayerIndex = new Map<PlayerIndex, RemoteCheckpointEntry>();
  private latestHostCheckpointEntry: RemoteCheckpointEntry | undefined;
  private localInputContextId: string | undefined;
  private localInputContextEnteredAt = 0;
  private pendingRunBootstrap: TwoPlayerRunBootstrap | undefined;
  private pendingTitleStart: TwoPlayerTitleStart | undefined;
  private pendingSettingsSnapshot: TwoPlayerSettingsSnapshot | undefined;
  private pendingProfileSnapshot: TwoPlayerProfileSnapshot | undefined;
  private readonly profileSnapshotResponseSenderIds = new Set<string>();

  private constructor(
    mode: "local" | "websocket",
    private readonly localSeat: PlayerIndex,
    private readonly onRemoteInput: RemoteInputHandler,
    private readonly onRunBootstrap?: TwoPlayerRunBootstrapHandler,
    private readonly onTitleStart?: TwoPlayerTitleStartHandler,
    private readonly onSettingsSnapshot?: TwoPlayerSettingsSnapshotHandler,
    private readonly getSettingsSnapshot?: TwoPlayerSettingsSnapshotProvider,
    private readonly logDebug?: TwoPlayerInputDebugLogger,
    private readonly getCheckpoint?: TwoPlayerStateCheckpointProvider,
    private readonly onProfileSnapshot?: TwoPlayerProfileSnapshotHandler,
    private readonly getProfileSnapshot?: TwoPlayerProfileSnapshotProvider,
    private readonly getInputLockoutMs?: TwoPlayerInputLockoutMsProvider,
  ) {
    this.mode = mode;
  }

  public static create(
    localSeat: LocalInputSeat,
    onRemoteInput: RemoteInputHandler,
    onRunBootstrap?: TwoPlayerRunBootstrapHandler,
    onTitleStart?: TwoPlayerTitleStartHandler,
    onSettingsSnapshot?: TwoPlayerSettingsSnapshotHandler,
    getSettingsSnapshot?: TwoPlayerSettingsSnapshotProvider,
    logDebug?: TwoPlayerInputDebugLogger,
    getCheckpoint?: TwoPlayerStateCheckpointProvider,
    onProfileSnapshot?: TwoPlayerProfileSnapshotHandler,
    getProfileSnapshot?: TwoPlayerProfileSnapshotProvider,
    getInputLockoutMs?: TwoPlayerInputLockoutMsProvider,
  ): TwoPlayerInputTransport | undefined {
    const mode = getLocalTransportMode();
    if (localSeat === "both") {
      return undefined;
    }

    if (mode === "local" || mode === "broadcast" || mode === "loopback") {
      if (typeof BroadcastChannel === "undefined") {
        return undefined;
      }

      const transport = new TwoPlayerInputTransport(
        "local",
        localSeat,
        onRemoteInput,
        onRunBootstrap,
        onTitleStart,
        onSettingsSnapshot,
        getSettingsSnapshot,
        logDebug,
        getCheckpoint,
        onProfileSnapshot,
        getProfileSnapshot,
        getInputLockoutMs,
      );
      transport.startLocal();
      return transport;
    }

    if (mode === "websocket" || mode === "ws") {
      if (typeof WebSocket === "undefined") {
        return undefined;
      }

      const transport = new TwoPlayerInputTransport(
        "websocket",
        localSeat,
        onRemoteInput,
        onRunBootstrap,
        onTitleStart,
        onSettingsSnapshot,
        getSettingsSnapshot,
        logDebug,
        getCheckpoint,
        onProfileSnapshot,
        getProfileSnapshot,
        getInputLockoutMs,
      );
      transport.startWebSocket();
      return transport;
    }

    return undefined;
  }

  public shouldRequestHostAuthority(): boolean {
    return this.networkRole === "guest";
  }

  public getInputReadinessBlockReason(checkpoint = this.getInputCheckpoint()): string | undefined {
    if (!checkpoint) {
      return "local-checkpoint-unavailable";
    }

    const localContextBlockedReason = this.getLocalInputContextGraceBlockReason(checkpoint);
    if (localContextBlockedReason) {
      return localContextBlockedReason;
    }

    if (isTitlePhaseCheckpoint(checkpoint)) {
      return undefined;
    }

    const readinessEntries = this.getReadinessCheckpointEntries(checkpoint);
    if (typeof readinessEntries === "string") {
      return readinessEntries;
    }

    for (const entry of readinessEntries) {
      if (checkpoint.summary.phase !== entry.checkpoint.summary.phase) {
        return `${entry.label}-checkpoint-phase-mismatch`;
      }

      if (checkpoint.summary.uiMode !== entry.checkpoint.summary.uiMode) {
        return `${entry.label}-checkpoint-ui-mode-mismatch`;
      }

      const inputContextMismatchReason = this.getInputContextMismatchReason(checkpoint, entry.checkpoint, entry.label);
      if (inputContextMismatchReason) {
        return inputContextMismatchReason;
      }

      const remoteContextBlockedReason = this.getRemoteInputContextGraceBlockReason(entry);
      if (remoteContextBlockedReason) {
        return remoteContextBlockedReason;
      }
    }

    return undefined;
  }

  private getReadinessCheckpointEntries(
    localCheckpoint: TwoPlayerStateCheckpoint,
  ): RemoteCheckpointEntry[] | string {
    if (this.networkRole === "guest") {
      return this.latestHostCheckpointEntry ? [this.latestHostCheckpointEntry] : "remote-checkpoint-unavailable";
    }

    const remotePlayerIndexes = this.getRemotePlayerIndexesForCheckpoint(localCheckpoint);
    if (remotePlayerIndexes.length === 0) {
      return this.latestRemoteCheckpoint
        ? [...this.latestRemoteCheckpointsByPlayerIndex.values()].slice(-1)
        : "remote-checkpoint-unavailable";
    }

    const entries: RemoteCheckpointEntry[] = [];
    for (const playerIndex of remotePlayerIndexes) {
      const entry = this.latestRemoteCheckpointsByPlayerIndex.get(playerIndex);
      if (!entry) {
        return `remote-p${playerIndex + 1}-checkpoint-unavailable`;
      }
      entries.push(entry);
    }

    return entries;
  }

  private getRemotePlayerIndexesForCheckpoint(checkpoint: TwoPlayerStateCheckpoint): PlayerIndex[] {
    const players = checkpoint.summary.players;
    if (!Array.isArray(players)) {
      return [];
    }

    return players
      .map(player => {
        if (!player || typeof player !== "object") {
          return undefined;
        }

        const playerSummary = player as { computerPartner?: unknown; playerIndex?: unknown };
        if (playerSummary.computerPartner === true) {
          return undefined;
        }

        return playerSummary.playerIndex;
      })
      .filter(isValidPlayerIndex)
      .filter(playerIndex => playerIndex !== this.localSeat);
  }

  private getLocalInputContextGraceBlockReason(checkpoint: TwoPlayerStateCheckpoint): string | undefined {
    const inputContext = getStrictInputContext(checkpoint);
    if (!inputContext) {
      this.localInputContextId = undefined;
      this.localInputContextEnteredAt = 0;
      return undefined;
    }

    this.noteLocalInputContext(checkpoint);

    const graceMs = this.getStrictInputContextGraceMs();
    return graceMs > 0 && Date.now() - this.localInputContextEnteredAt < graceMs
      ? "local-input-context-grace-period"
      : undefined;
  }

  private getStrictInputContextGraceMs(): number {
    const configuredValue = this.getInputLockoutMs?.() ?? DEFAULT_STRICT_INPUT_CONTEXT_GRACE_MS;
    return Number.isFinite(configuredValue)
      ? Math.max(0, configuredValue)
      : DEFAULT_STRICT_INPUT_CONTEXT_GRACE_MS;
  }

  private noteLocalInputContext(checkpoint: TwoPlayerStateCheckpoint | undefined): void {
    const inputContext = getStrictInputContext(checkpoint);
    if (!inputContext) {
      this.localInputContextId = undefined;
      this.localInputContextEnteredAt = 0;
      return;
    }

    const promptId = getInputContextPromptId(inputContext);
    if (this.localInputContextId !== promptId) {
      this.localInputContextId = promptId;
      this.localInputContextEnteredAt = Date.now();
    }
  }

  private getRemoteInputContextGraceBlockReason(entry: RemoteCheckpointEntry): string | undefined {
    const inputContext = getStrictInputContext(entry.checkpoint);
    if (!inputContext) {
      return undefined;
    }

    const receivedAt = entry.inputContextPromptSeenAt;
    const graceMs = this.getStrictInputContextGraceMs();
    return graceMs > 0 && receivedAt > 0 && Date.now() - receivedAt < graceMs
      ? `${entry.label}-input-context-grace-period`
      : undefined;
  }

  private createRemoteCheckpointEntry(
    playerIndex: PlayerIndex,
    label: string,
    sequence: number,
    checkpoint: TwoPlayerStateCheckpoint,
    receivedAt: number,
    previousEntry?: RemoteCheckpointEntry,
  ): RemoteCheckpointEntry {
    const inputContext = getStrictInputContext(checkpoint);
    const promptId = inputContext ? getInputContextPromptId(inputContext) : undefined;
    const inputContextPromptSeenAt = previousEntry && previousEntry.inputContextPromptId === promptId
      ? previousEntry.inputContextPromptSeenAt
      : promptId
        ? receivedAt
        : 0;

    return {
      playerIndex,
      label,
      sequence,
      checkpoint,
      ...(promptId ? { inputContextPromptId: promptId } : {}),
      inputContextPromptSeenAt,
    };
  }

  private getInputContextMismatchReason(
    localCheckpoint: TwoPlayerStateCheckpoint,
    remoteCheckpoint: TwoPlayerStateCheckpoint,
    remoteLabel = "remote",
  ): string | undefined {
    const localInputContext = getStrictInputContext(localCheckpoint);
    const remoteInputContext = getStrictInputContext(remoteCheckpoint);
    if (!localInputContext && !remoteInputContext) {
      return undefined;
    }

    if (localInputContext && !remoteInputContext) {
      return `${remoteLabel}-input-context-unavailable`;
    }

    if (!localInputContext && remoteInputContext) {
      return "local-input-context-unavailable";
    }

    return localInputContext!.id === remoteInputContext!.id ? undefined : `${remoteLabel}-input-context-mismatch`;
  }

  public requestInput(button: Button, pressed: boolean, checkpoint = this.getInputCheckpoint()): boolean {
    const message = this.createMessage("input-request", this.localSeat, button, pressed, checkpoint);
    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? undefined : "transport-not-open");
    return sent;
  }

  public sendRunBootstrap(runBootstrap: TwoPlayerRunBootstrap): boolean {
    if (this.networkRole !== "host") {
      return false;
    }

    this.pendingRunBootstrap = runBootstrap;
    return this.flushPendingRunBootstrap();
  }

  public sendTitleStart(titleStart: TwoPlayerTitleStart): boolean {
    if (this.networkRole !== "host") {
      return false;
    }

    this.pendingTitleStart = titleStart;
    return this.flushPendingTitleStart();
  }

  public sendSettingsSnapshot(settingsSnapshot = this.getSettingsSnapshot?.()): boolean {
    if (this.networkRole !== "host" || !settingsSnapshot) {
      return false;
    }

    this.pendingSettingsSnapshot = settingsSnapshot;
    return this.flushPendingSettingsSnapshot();
  }

  public sendProfileSnapshot(profileSnapshot = this.getProfileSnapshot?.()): boolean {
    if (!profileSnapshot) {
      return false;
    }

    this.pendingProfileSnapshot = profileSnapshot;
    return this.flushPendingProfileSnapshot();
  }

  private flushPendingRunBootstrap(): boolean {
    if (!this.pendingRunBootstrap) {
      return false;
    }

    const message = {
      ...this.createMessage("run-bootstrap", this.localSeat, Button.ACTION, true),
      runBootstrap: this.pendingRunBootstrap,
    };
    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? "run-bootstrap" : "transport-not-open");
    if (sent) {
      this.pendingRunBootstrap = undefined;
    }

    return sent;
  }

  private flushPendingTitleStart(): boolean {
    if (!this.pendingTitleStart) {
      return false;
    }

    const message = {
      ...this.createMessage("title-start", this.localSeat, Button.ACTION, true),
      titleStart: this.pendingTitleStart,
    };
    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? "title-start" : "transport-not-open");
    if (sent) {
      this.pendingTitleStart = undefined;
    }

    return sent;
  }

  private flushPendingSettingsSnapshot(): boolean {
    if (!this.pendingSettingsSnapshot) {
      return false;
    }

    const message = {
      ...this.createMessage("settings-sync", this.localSeat, Button.ACTION, true),
      settingsSnapshot: this.pendingSettingsSnapshot,
    };
    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? "settings-sync" : "transport-not-open");
    if (sent) {
      this.pendingSettingsSnapshot = undefined;
    }

    return sent;
  }

  private flushPendingProfileSnapshot(): boolean {
    if (!this.pendingProfileSnapshot) {
      return false;
    }

    const message = {
      ...this.createMessage("profile-snapshot", this.pendingProfileSnapshot.playerIndex, Button.ACTION, true),
      profileSnapshot: this.pendingProfileSnapshot,
    };
    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? "profile-snapshot" : "transport-not-open");
    if (sent) {
      this.pendingProfileSnapshot = undefined;
    }

    return sent;
  }

  public send(button: Button, pressed: boolean, checkpoint = this.getInputCheckpoint()): void {
    const message = this.createMessage(
      this.networkRole === "host" ? "input-accepted" : "input",
      this.localSeat,
      button,
      pressed,
      checkpoint,
    );

    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? undefined : "transport-not-open");
    if (sent) {
      this.sendCheckpointForMessageAfterStateSettles(message);
    }
  }

  private createMessage(
    kind: TwoPlayerInputMessageKind,
    playerIndex: PlayerIndex,
    button: Button,
    pressed: boolean,
    checkpoint?: TwoPlayerStateCheckpoint,
  ): TwoPlayerInputMessage {
    return {
      protocol: LOCAL_INPUT_PROTOCOL,
      version: LOCAL_INPUT_PROTOCOL_VERSION,
      kind,
      sessionId: this.sessionId,
      senderId: this.senderId,
      senderRole: this.networkRole,
      sequence: ++this.sequence,
      ...(kind === "input-accepted" ? { authoritySequence: ++this.authoritySequence } : {}),
      playerIndex,
      button,
      pressed,
      ...(checkpoint ? { checkpoint } : {}),
    };
  }

  private getInputCheckpoint(): TwoPlayerStateCheckpoint | undefined {
    return this.getCheckpoint?.();
  }

  private isStaleRemoteTitleCheckpoint(checkpoint: TwoPlayerStateCheckpoint): boolean {
    const localCheckpoint = this.getInputCheckpoint();
    return isTitlePhaseCheckpoint(checkpoint) && !!localCheckpoint && !isTitlePhaseCheckpoint(localCheckpoint);
  }

  private logMessageSend(sent: boolean, message: TwoPlayerInputMessage, reason?: string): void {
    this.logDebug?.({
      action: sent ? "sent" : "rejected",
      source: "transport",
      ...(reason ? { reason } : {}),
      sessionId: this.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: this.senderId,
      senderRole: this.networkRole,
      sequence: message.sequence,
      ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
      ...(message.checkpoint
        ? {
            checkpointFingerprint: message.checkpoint.fingerprint,
            checkpointSummary: message.checkpoint.summary,
            ...(getStrictInputContext(message.checkpoint)
              ? { localInputContextId: getStrictInputContext(message.checkpoint)!.id }
              : {}),
          }
        : {}),
      ...(message.profileSnapshot ? { profilePlayerIndex: message.profileSnapshot.playerIndex } : {}),
      ...(message.settingsSnapshot ? { settingsKeys: [...Object.keys(message.settingsSnapshot.settings)] } : {}),
    });
  }

  private createCheckpointMessage(triggerMessage: TwoPlayerInputMessage): TwoPlayerInputMessage | undefined {
    const checkpoint = this.getCheckpoint?.();
    if (!checkpoint) {
      return undefined;
    }
    this.noteLocalInputContext(checkpoint);

    return {
      protocol: LOCAL_INPUT_PROTOCOL,
      version: LOCAL_INPUT_PROTOCOL_VERSION,
      kind: "state-checkpoint",
      sessionId: this.sessionId,
      senderId: this.senderId,
      senderRole: this.networkRole,
      sequence: ++this.sequence,
      ...(triggerMessage.authoritySequence === undefined
        ? {}
        : { authoritySequence: triggerMessage.authoritySequence }),
      playerIndex: this.localSeat,
      button: triggerMessage.button,
      pressed: triggerMessage.pressed,
      checkpoint,
    };
  }

  private sendCheckpointForMessage(triggerMessage: TwoPlayerInputMessage): void {
    const checkpointMessage = this.createCheckpointMessage(triggerMessage);
    if (!checkpointMessage) {
      return;
    }

    const sent = this.sendMessage(checkpointMessage);
    this.logMessageSend(sent, checkpointMessage, sent ? undefined : "transport-not-open");
  }

  private sendCheckpointForMessageAfterStateSettles(triggerMessage: TwoPlayerInputMessage): void {
    const sendCheckpoint = () => this.sendCheckpointForMessage(triggerMessage);
    if (typeof window !== "undefined") {
      window.setTimeout(sendCheckpoint, POST_INPUT_CHECKPOINT_DELAY_MS);
      return;
    }

    setTimeout(sendCheckpoint, POST_INPUT_CHECKPOINT_DELAY_MS);
  }

  public sendCheckpoint(reason = "manual-checkpoint"): boolean {
    const checkpoint = this.getCheckpoint?.();
    if (!checkpoint) {
      return false;
    }
    this.noteLocalInputContext(checkpoint);

    const message = {
      ...this.createMessage("state-checkpoint", this.localSeat, Button.ACTION, true),
      checkpoint,
    };
    const sent = this.sendMessage(message);
    this.logMessageSend(sent, message, sent ? reason : "transport-not-open");
    return sent;
  }

  public getStatus(): TwoPlayerInputTransportStatus {
    return {
      enabled: !!this.channel || this.webSocket?.readyState === WebSocket.OPEN,
      mode: this.mode,
      networkRole: this.networkRole,
      ...(this.mode === "local" ? { channelName: this.channelName } : {}),
      ...(this.mode === "websocket"
        ? { webSocketUrl: this.webSocketUrl, ...(this.webSocket ? { webSocketState: this.webSocket.readyState } : {}) }
        : {}),
      localSeat: this.localSeat,
      sequence: this.sequence,
      authoritySequence: this.authoritySequence,
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
    this.sendProfileSnapshot();
    this.sendSettingsSnapshot();
    this.flushPendingRunBootstrap();
    this.flushPendingTitleStart();
    setTimeout(() => this.sendCheckpoint("transport-connected"), 0);
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
      this.sendProfileSnapshot();
      this.sendSettingsSnapshot();
      this.flushPendingRunBootstrap();
      this.flushPendingTitleStart();
      setTimeout(() => this.sendCheckpoint("transport-connected"), 0);
    });
    this.webSocket.addEventListener("message", event => {
      this.onMessageData(event.data);
    });
    this.webSocket.addEventListener("close", () => {
      this.latestRemoteCheckpoint = undefined;
      this.latestHostCheckpoint = undefined;
      this.latestRemoteCheckpointsByPlayerIndex.clear();
      this.latestHostCheckpointEntry = undefined;
      this.logDebug?.({
        action: "disconnected",
        source: "transport",
        sessionId: this.sessionId,
        webSocketUrl: this.webSocketUrl,
        localSeat: this.localSeat,
      });
    });
    this.webSocket.addEventListener("error", () => {
      this.latestRemoteCheckpoint = undefined;
      this.latestHostCheckpoint = undefined;
      this.latestRemoteCheckpointsByPlayerIndex.clear();
      this.latestHostCheckpointEntry = undefined;
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
    const message = parseTwoPlayerInputMessage(this.parseMessageData(data));
    if (!message) {
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
        ...(message.senderRole === undefined ? {} : { senderRole: message.senderRole }),
        sequence: message.sequence,
        ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
        messageKind: message.kind,
        localSeat: this.localSeat,
        playerIndex: message.playerIndex,
        button: message.button,
        buttonName: Button[message.button] as keyof typeof Button,
        pressed: message.pressed,
      });
      return;
    }

    if (
      message.kind === "state-checkpoint"
      && message.checkpoint
      && !this.isStaleRemoteTitleCheckpoint(message.checkpoint)
    ) {
      const receivedAt = Date.now();
      const previousEntry = this.latestRemoteCheckpointsByPlayerIndex.get(message.playerIndex);
      if (!previousEntry || message.sequence >= previousEntry.sequence) {
        this.latestRemoteCheckpoint = message.checkpoint;
        this.latestRemoteCheckpointsByPlayerIndex.set(
          message.playerIndex,
          this.createRemoteCheckpointEntry(
            message.playerIndex,
            `remote-p${message.playerIndex + 1}`,
            message.sequence,
            message.checkpoint,
            receivedAt,
            previousEntry,
          ),
        );
      }
      if (message.senderRole === "host") {
        if (!this.latestHostCheckpointEntry || message.sequence >= this.latestHostCheckpointEntry.sequence) {
          this.latestHostCheckpoint = message.checkpoint;
          this.latestHostCheckpointEntry = this.createRemoteCheckpointEntry(
            message.playerIndex,
            "host",
            message.sequence,
            message.checkpoint,
            receivedAt,
            this.latestHostCheckpointEntry,
          );
        }
      }
    }

    if (message.kind === "input-request") {
      this.handleInputRequest(message);
      return;
    }

    if (message.kind === "run-bootstrap") {
      this.handleRunBootstrap(message);
      return;
    }

    if (message.kind === "title-start") {
      this.handleTitleStart(message);
      return;
    }

    if (message.kind === "settings-sync") {
      this.handleSettingsSnapshot(message);
      return;
    }

    if (message.kind === "state-checkpoint") {
      this.handleStateCheckpoint(message);
      return;
    }

    if (message.kind === "profile-snapshot") {
      this.handleProfileSnapshot(message);
      return;
    }

    if (this.shouldIgnoreDuplicateHostAcceptedInput(message)) {
      this.logIgnoredMessage(message, "duplicate-host-input-accepted");
      return;
    }

    if (message.kind === "input" && this.networkRole !== "peer") {
      this.logIgnoredMessage(message, "direct-input-in-authority-mode");
      return;
    }

    const checkpointMismatchReason = this.getInputCheckpointMismatchReason(message);
    if (checkpointMismatchReason) {
      this.logIgnoredMessage(message, checkpointMismatchReason);
      return;
    }

    this.logDebug?.({
      action: "received",
      source: "transport",
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      ...(message.senderRole === undefined ? {} : { senderRole: message.senderRole }),
      sequence: message.sequence,
      ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
      messageKind: message.kind,
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
      ...(message.senderRole === undefined ? {} : { senderRole: message.senderRole }),
      sequence: message.sequence,
      ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
    if (accepted) {
      this.sendCheckpointForMessageAfterStateSettles(message);
    }
  }

  private handleInputRequest(message: TwoPlayerInputMessage): void {
    if (this.networkRole !== "host") {
      this.logIgnoredMessage(message, "input-request-received-by-non-host");
      return;
    }

    const acceptedCheckpoint = this.getInputCheckpoint();
    const checkpointMismatchReason = this.getInputCheckpointMismatchReason(message, acceptedCheckpoint);
    if (checkpointMismatchReason) {
      this.logIgnoredMessage(message, checkpointMismatchReason);
      return;
    }

    const inputReadinessBlockReason = this.getInputReadinessBlockReason(acceptedCheckpoint);
    if (inputReadinessBlockReason) {
      this.logIgnoredMessage(message, inputReadinessBlockReason);
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
      messageKind: message.kind,
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
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });

    if (accepted) {
      const acceptedMessage = this.createMessage(
        "input-accepted",
        message.playerIndex,
        message.button,
        message.pressed,
        acceptedCheckpoint,
      );
      const sent = this.sendMessage(acceptedMessage);
      this.logMessageSend(sent, acceptedMessage, sent ? undefined : "transport-not-open");
      if (sent) {
        this.sendCheckpointForMessageAfterStateSettles(acceptedMessage);
      }
    }
  }

  private shouldIgnoreDuplicateHostAcceptedInput(message: TwoPlayerInputMessage): boolean {
    return message.kind === "input-accepted"
      && this.networkRole === "host"
      && message.senderRole === "host"
      && message.playerIndex === this.localSeat;
  }

  private getInputCheckpointMismatchReason(
    message: TwoPlayerInputMessage,
    localCheckpoint = this.getInputCheckpoint(),
  ): string | undefined {
    if (message.kind !== "input" && message.kind !== "input-request" && message.kind !== "input-accepted") {
      return undefined;
    }

    if (!message.checkpoint) {
      return undefined;
    }

    if (!localCheckpoint) {
      return "local-checkpoint-unavailable";
    }

    if (isTitlePhaseCheckpoint(message.checkpoint) && isTitlePhaseCheckpoint(localCheckpoint)) {
      return undefined;
    }

    const remotePhase = message.checkpoint.summary.phase;
    const localPhase = localCheckpoint.summary.phase;
    if (remotePhase !== localPhase) {
      return "checkpoint-phase-mismatch";
    }

    const remoteUiMode = message.checkpoint.summary.uiMode;
    const localUiMode = localCheckpoint.summary.uiMode;
    if (remoteUiMode !== localUiMode) {
      return "checkpoint-ui-mode-mismatch";
    }

    const inputContextMismatchReason = this.getInputContextMismatchReason(
      localCheckpoint,
      message.checkpoint,
      "checkpoint",
    );
    if (inputContextMismatchReason) {
      return inputContextMismatchReason;
    }

    const localContextBlockedReason = this.getLocalInputContextGraceBlockReason(localCheckpoint);
    if (localContextBlockedReason) {
      return localContextBlockedReason;
    }

    return undefined;
  }

  private handleRunBootstrap(message: TwoPlayerInputMessage): void {
    if (!message.runBootstrap) {
      this.logIgnoredMessage(message, "missing-run-bootstrap");
      return;
    }

    if (this.networkRole === "host") {
      this.logIgnoredMessage(message, "run-bootstrap-received-by-host");
      return;
    }

    this.onRunBootstrap?.(message.runBootstrap);
    this.logDebug?.({
      action: "received",
      source: "transport",
      reason: "run-bootstrap",
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
  }

  private handleTitleStart(message: TwoPlayerInputMessage): void {
    if (!message.titleStart) {
      this.logIgnoredMessage(message, "missing-title-start");
      return;
    }

    if (this.networkRole === "host") {
      this.logIgnoredMessage(message, "title-start-received-by-host");
      return;
    }

    this.onTitleStart?.(message.titleStart);
    this.logDebug?.({
      action: "received",
      source: "transport",
      reason: "title-start",
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
  }

  private handleSettingsSnapshot(message: TwoPlayerInputMessage): void {
    const settingsSnapshot = message.settingsSnapshot;
    if (!settingsSnapshot) {
      this.logIgnoredMessage(message, "missing-settings-snapshot");
      return;
    }

    if (this.networkRole === "host") {
      this.logIgnoredMessage(message, "settings-sync-received-by-host");
      return;
    }

    const accepted = this.onSettingsSnapshot?.(settingsSnapshot) ?? false;
    this.logDebug?.({
      action: accepted ? "accepted" : "rejected",
      source: "transport",
      reason: accepted ? "settings-sync" : "settings-sync-rejected",
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
      settingsKeys: [...Object.keys(settingsSnapshot.settings)],
    });
  }

  private handleStateCheckpoint(message: TwoPlayerInputMessage): void {
    const remoteCheckpoint = message.checkpoint;
    const localCheckpoint = this.getCheckpoint?.();
    const remoteFingerprint = remoteCheckpoint?.fingerprint;
    const localFingerprint = localCheckpoint?.fingerprint;
    const isStaleTitleCheckpoint = !!remoteCheckpoint && this.isStaleRemoteTitleCheckpoint(remoteCheckpoint);
    const isDesynced = !isStaleTitleCheckpoint
      && !!localFingerprint
      && !!remoteFingerprint
      && localFingerprint !== remoteFingerprint;
    const reason = !localCheckpoint
      ? "checkpoint-unavailable"
      : isStaleTitleCheckpoint
        ? "stale-title-checkpoint"
        : undefined;

    this.logDebug?.({
      action: isDesynced ? "desync" : "checkpoint",
      source: "transport",
      ...(reason ? { reason } : {}),
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
      ...(remoteFingerprint ? { checkpointFingerprint: remoteFingerprint, remoteFingerprint } : {}),
      ...(remoteCheckpoint && getStrictInputContext(remoteCheckpoint)
        ? { remoteInputContextId: getStrictInputContext(remoteCheckpoint)!.id }
        : {}),
      ...(localFingerprint ? { localFingerprint } : {}),
      ...(localCheckpoint && getStrictInputContext(localCheckpoint)
        ? { localInputContextId: getStrictInputContext(localCheckpoint)!.id }
        : {}),
      ...(remoteCheckpoint ? { checkpointSummary: remoteCheckpoint.summary } : {}),
    });
  }

  private handleProfileSnapshot(message: TwoPlayerInputMessage): void {
    const profileSnapshot = message.profileSnapshot;
    if (!profileSnapshot) {
      this.logIgnoredMessage(message, "missing-profile-snapshot");
      return;
    }

    const accepted = this.onProfileSnapshot?.(profileSnapshot) ?? false;
    if (!this.profileSnapshotResponseSenderIds.has(message.senderId)) {
      this.profileSnapshotResponseSenderIds.add(message.senderId);
      this.sendProfileSnapshot();
      this.sendSettingsSnapshot();
    }

    this.logDebug?.({
      action: accepted ? "accepted" : "rejected",
      source: "transport",
      ...(accepted ? { reason: "profile-snapshot" } : { reason: "profile-snapshot-rejected" }),
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      profilePlayerIndex: profileSnapshot.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
    });
  }

  private logIgnoredMessage(message: TwoPlayerInputMessage, reason: string): void {
    const localCheckpoint = this.getCheckpoint?.();
    this.logDebug?.({
      action: "ignored",
      source: "transport",
      reason,
      sessionId: message.sessionId,
      channelName: this.channelName,
      ...(this.mode === "websocket" ? { webSocketUrl: this.webSocketUrl } : {}),
      senderId: message.senderId,
      sequence: message.sequence,
      ...(message.authoritySequence === undefined ? {} : { authoritySequence: message.authoritySequence }),
      messageKind: message.kind,
      localSeat: this.localSeat,
      playerIndex: message.playerIndex,
      button: message.button,
      buttonName: Button[message.button] as keyof typeof Button,
      pressed: message.pressed,
      ...(message.checkpoint
        ? {
            checkpointFingerprint: message.checkpoint.fingerprint,
            remoteFingerprint: message.checkpoint.fingerprint,
            ...(getStrictInputContext(message.checkpoint)
              ? { remoteInputContextId: getStrictInputContext(message.checkpoint)!.id }
              : {}),
            checkpointSummary: message.checkpoint.summary,
          }
        : {}),
      ...(localCheckpoint
        ? {
            localFingerprint: localCheckpoint.fingerprint,
            ...(getStrictInputContext(localCheckpoint)
              ? { localInputContextId: getStrictInputContext(localCheckpoint)!.id }
              : {}),
          }
        : {}),
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
