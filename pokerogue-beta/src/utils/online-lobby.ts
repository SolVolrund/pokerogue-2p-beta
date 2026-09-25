import { getPlayerDisplayName } from "#utils/player-display-name";

export type OnlineLobbySeat = "p1" | "p2" | "p3" | "ep";
export type OnlineRunMode = "coop" | "vs" | "ep";

export interface OnlineLobbySetup {
  label: string;
  playerCount: 1 | 2 | 3;
  enemyPlayer: boolean;
  computerPartner?: boolean;
}

export const ONLINE_LOBBY_SETUPS: readonly OnlineLobbySetup[] = [
  { label: "2P", playerCount: 2, enemyPlayer: false },
  { label: "3P", playerCount: 3, enemyPlayer: false },
  { label: "2P + CPU (Unavailable)", playerCount: 3, enemyPlayer: false, computerPartner: true },
  { label: "1P + EP", playerCount: 1, enemyPlayer: true },
  { label: "2P + EP", playerCount: 2, enemyPlayer: true },
  { label: "3P + EP", playerCount: 3, enemyPlayer: true },
];

/** Public directory record. Membership credentials are never included. */
export interface OnlineLobbySummary {
  id: string;
  /** Host identity is independent of the role they play. Older previews default to P1. */
  hostDisplayName?: string;
  hostSeat?: OnlineLobbySeat;
  setup: OnlineLobbySetup;
  hostAtMainMenu: boolean;
  status: "waiting" | "starting" | "in-progress";
  /** Chosen when the host starts or loads a run; seats are fixed at lobby creation. */
  runMode?: OnlineRunMode;
  seats: Partial<Record<OnlineLobbySeat, { displayName: string }>>;
}

export function getOnlineRunOptions(setup: OnlineLobbySetup): { label: string; vsMode: boolean }[] {
  if (setup.computerPartner) {
    return [];
  }
  if (setup.enemyPlayer) {
    return [{ label: `${setup.playerCount === 1 ? "P" : `${setup.playerCount}P`}.Vs.EP`, vsMode: false }];
  }
  if (setup.playerCount < 2) {
    return [];
  }
  return [
    { label: `${setup.playerCount}P`, vsMode: false },
    { label: setup.playerCount === 2 ? "P.Vs.P" : "P.Vs.P.Vs.P", vsMode: true },
  ];
}

export function getOnlineLobbyModeLabel(lobby: OnlineLobbySummary): string {
  return lobby.runMode
    ? (getOnlineRunOptions(lobby.setup).find(option => option.vsMode === (lobby.runMode === "vs"))?.label
        ?? lobby.setup.label)
    : lobby.setup.label;
}

export interface OnlineLobbySeatOption {
  seat: OnlineLobbySeat;
  label: string;
  name: string;
  status: "Host" | "Occupied" | "Open" | "Unavailable" | "CPU";
  available: boolean;
}

export function getOnlineLobbySeats(lobby: OnlineLobbySummary): OnlineLobbySeatOption[] {
  return (["p1", "p2", "p3", "ep"] as const).map((seat, index) => {
    const exists = seat === "ep" ? lobby.setup.enemyPlayer : index < lobby.setup.playerCount;
    const cpu = seat === "p3" && lobby.setup.computerPartner;
    const occupant = lobby.seats[seat];
    const host = seat === (lobby.hostSeat ?? "p1");
    const name = occupant ? getPlayerDisplayName(occupant.displayName, index) : host ? "Host" : "Open";
    const description = exists ? (cpu ? "CPU" : name) : "Not available";
    return {
      seat,
      label: `${seat.toUpperCase()} - ${description}${exists && occupant ? (host ? " (Host)" : " (Occupied)") : ""}`,
      name: description,
      status: exists ? (cpu ? "CPU" : occupant ? (host ? "Host" : "Occupied") : "Open") : "Unavailable",
      available:
        exists
        && !cpu
        && !occupant
        && seat !== "p1"
        && !host
        && lobby.hostAtMainMenu
        && lobby.status === "waiting"
        && !lobby.setup.computerPartner,
    };
  });
}

export function isOnlineLobbyJoinable(lobby: OnlineLobbySummary): boolean {
  return getOnlineLobbySeats(lobby).some(seat => seat.available);
}

export function getOnlineLobbyHostName(lobby: OnlineLobbySummary): string {
  return getPlayerDisplayName(lobby.hostDisplayName ?? lobby.seats[lobby.hostSeat ?? "p1"]?.displayName);
}

export function getOnlineLobbySeatCount(lobby: OnlineLobbySummary): string {
  const playerSeats = (["p1", "p2", "p3"] as const).slice(0, lobby.setup.playerCount);
  const occupied = playerSeats.filter(
    seat => !!lobby.seats[seat] || (seat === "p3" && lobby.setup.computerPartner),
  ).length;
  return `${occupied}/${lobby.setup.playerCount} + ${lobby.setup.enemyPlayer && lobby.seats.ep ? 1 : 0}/${lobby.setup.enemyPlayer ? 1 : 0}`;
}

export function getOnlineLobbyStatus(lobby: OnlineLobbySummary): string {
  return lobby.setup.computerPartner
    ? "Unavailable"
    : lobby.status === "starting"
      ? "Starting"
      : lobby.status === "in-progress" || !lobby.hostAtMainMenu
        ? "In progress"
        : isOnlineLobbyJoinable(lobby)
          ? "Waiting"
          : "Full";
}

export function getOnlineLobbyLabel(lobby: OnlineLobbySummary): string {
  return `${getOnlineLobbyHostName(lobby)} | ${getOnlineLobbySeatCount(lobby)} EP | ${getOnlineLobbyStatus(lobby)}`;
}

/** Local fixture only. Never advertised to a server or used to launch a run. */
export function createDemoOnlineLobby(): OnlineLobbySummary {
  return {
    id: "demo-lobby",
    hostDisplayName: "Daniel",
    hostSeat: "p1",
    setup: { label: "3P + EP", playerCount: 3, enemyPlayer: true },
    hostAtMainMenu: true,
    status: "waiting",
    seats: { p1: { displayName: "Daniel" }, p3: { displayName: "Alex" } },
  };
}
