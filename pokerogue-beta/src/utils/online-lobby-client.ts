import type { OnlineLobbySeat, OnlineLobbySetup, OnlineLobbySummary } from "#utils/online-lobby";

export const ONLINE_PROTOCOL = "pokerogue-online-v1";
export const ONLINE_BUILD_ID = import.meta.env.VITE_ONLINE_BUILD_ID || "local-dev-v4";
const MEMBERSHIP_KEY = "pokerogue-online-membership-v1";

export interface OnlineMembership {
  lobby: OnlineLobbySummary & { partySize: 3 | 6 };
  seat: OnlineLobbySeat;
  token: string;
  expiresAt: number;
}

export function getOnlineServiceUrl(): string {
  // Public builds must opt in to a deployed service. Development stays on this computer.
  return import.meta.env.VITE_ONLINE_SERVICE_URL || (import.meta.env.DEV ? "http://127.0.0.1:8788" : "");
}

export function isOnlineSession(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("onlineLobby") === "1";
}

async function request<T>(path: string, method = "GET", body?: unknown, token?: string): Promise<T> {
  const base = getOnlineServiceUrl();
  if (!base) {
    throw new Error("Online service is not configured. LAN is still available.");
  }
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || "The lobby request failed.");
  }
  return result as T;
}

export async function listOnlineLobbies(): Promise<OnlineLobbySummary[]> {
  const result = await request<{ lobbies: OnlineLobbySummary[]; buildId: string }>("/lobbies");
  if (result.buildId !== ONLINE_BUILD_ID) {
    throw new Error("The game and lobby service use different builds.");
  }
  return result.lobbies;
}

export function createOnlineLobby(
  setup: OnlineLobbySetup,
  partySize: 3 | 6,
  displayName: string,
): Promise<OnlineMembership> {
  return request("/lobbies", "POST", { setup, partySize, displayName, buildId: ONLINE_BUILD_ID });
}

export function joinOnlineLobby(id: string, seat: OnlineLobbySeat, displayName: string): Promise<OnlineMembership> {
  return request(`/lobbies/${encodeURIComponent(id)}/join`, "POST", { seat, displayName, buildId: ONLINE_BUILD_ID });
}

export function getOnlineMembership(): OnlineMembership | undefined {
  if (!isOnlineSession()) {
    return;
  }
  try {
    const member = JSON.parse(sessionStorage.getItem(MEMBERSHIP_KEY) || "null") as OnlineMembership | null;
    if (member?.lobby?.id === new URLSearchParams(window.location.search).get("twoPlayerSession")) {
      return member;
    }
  } catch {
    /* Missing or inaccessible tab storage is handled as an expired membership. */
  }
}

export function launchOnlineLobby(member: OnlineMembership): void {
  const url = new URL(window.location.href);
  // Do not inherit old LAN seat, CPU, seed, or transport overrides.
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("twoPlayer") || key === "onlineLobby") {
      url.searchParams.delete(key);
    }
  }
  const wsUrl = new URL("relay", `${getOnlineServiceUrl().replace(/\/$/, "")}/`);
  wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
  const params = {
    onlineLobby: "1",
    twoPlayer: "1",
    twoPlayerInputTransport: "websocket",
    twoPlayerNetworkRole: member.seat === "p1" ? "host" : "guest",
    twoPlayerLocalPlayer: member.seat === "ep" ? "ep" : member.seat.slice(1),
    twoPlayerPlayerCount: String(member.lobby.setup.playerCount),
    twoPlayerPartySize: String(member.lobby.partySize),
    twoPlayerEnemyPlayerMode: member.lobby.setup.enemyPlayer ? "1" : "0",
    twoPlayerSession: member.lobby.id,
    twoPlayerWsUrl: wsUrl.toString(),
  };
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  // Seat credentials stay in this tab, never in shareable URLs or game saves.
  sessionStorage.setItem(MEMBERSHIP_KEY, JSON.stringify(member));
  window.location.assign(url.toString());
}

export function leaveOnlineLobby(): void {
  const member = getOnlineMembership();
  if (member) {
    void request("/membership", "DELETE", undefined, member.token).catch(() => {});
  }
  sessionStorage.removeItem(MEMBERSHIP_KEY);
  const url = new URL(window.location.href);
  for (const key of [...url.searchParams.keys()]) {
    if (key.startsWith("twoPlayer") || key === "onlineLobby") {
      url.searchParams.delete(key);
    }
  }
  window.location.assign(url.toString());
}

/** Local controls remain accessible while the synchronized game is waiting or disconnected. */
export function showOnlineConnectionStatus(message: string): void {
  let bar = document.getElementById("online-connection-status");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "online-connection-status";
    bar.style.cssText =
      "position:fixed;bottom:0;left:0;right:0;z-index:10000;background:#302b3b;color:#fff;padding:6px 10px;font:14px sans-serif;display:flex;align-items:center;gap:12px";
    const text = document.createElement("span");
    text.style.flex = "1";
    text.setAttribute("role", "status");
    bar.append(text);
    const leave = document.createElement("button");
    leave.textContent = "Leave lobby";
    leave.onclick = leaveOnlineLobby;
    leave.onkeydown = event => event.stopPropagation();
    leave.onkeyup = event => event.stopPropagation();
    bar.append(leave);
    document.body.append(bar);
  }
  bar.firstElementChild!.textContent = message;
}

export function onlineErrorMessage(error: unknown): string {
  return error instanceof TypeError || (error instanceof DOMException && error.name === "TimeoutError")
    ? "Cannot reach the lobby service. Check it is running, or use LAN."
    : error instanceof Error
      ? error.message
      : "The lobby request failed.";
}
