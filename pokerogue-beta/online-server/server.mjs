import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { WebSocket, WebSocketServer } from "ws";

const GAME_PROTOCOL = "pokerogue-2p-local-input";
const CONTROL_PROTOCOL = "pokerogue-online-v1";
// Includes JSON escaping around the up-to-3-MiB saved-run string.
const MAX_PAYLOAD = 8 * 1024 * 1024;
const SEATS = ["p1", "p2", "p3", "ep"];
const seatIndex = seat => (seat === "ep" ? "ep" : SEATS.indexOf(seat));
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const normalizeName = value =>
  typeof value === "string"
    ? Array.from(
        value
          .normalize("NFC")
          .replace(/[^\p{L}\p{M}\p{N} ._'’-]/gu, "")
          .replace(/\s+/g, " ")
          .trim(),
      )
        .slice(0, 20)
        .join("")
        .trim()
    : "";

/** In-memory directory and authenticated, room-scoped relay. No game saves are persisted. */
export function createOnlineServer({
  buildId = process.env.ONLINE_BUILD_ID || "local-dev-v5",
  origins = (process.env.ONLINE_ORIGINS || "http://localhost:8000,http://127.0.0.1:8000").split(","),
  reservationMs = 120_000,
  heartbeatMs = 15_000,
  maxRooms = 100,
  loadTimeoutMs = 120_000,
} = {}) {
  const rooms = new Map();
  const tickets = new Map();
  const allowedOrigins = new Set(origins);
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
  const requiredSeats = room =>
    SEATS.filter((seat, index) => (seat === "ep" ? room.setup.enemyPlayer : index < room.setup.playerCount));
  const summary = room => ({
    id: room.id,
    hostDisplayName: room.members.get("p1").displayName,
    hostSeat: "p1",
    setup: room.setup,
    partySize: room.partySize,
    buildId,
    status: room.status,
    ...(room.runMode ? { runMode: room.runMode } : {}),
    hostAtMainMenu: room.hostAtMainMenu,
    seats: Object.fromEntries([...room.members].map(([seat, member]) => [seat, { displayName: member.displayName }])),
  });
  const send = (ws, value) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_PAYLOAD * 2) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(value));
  };
  const publish = room => {
    if (!rooms.has(room.id)) return;
    const roster = requiredSeats(room)
      .map(seat => `${seat.toUpperCase()}: ${room.members.get(seat)?.displayName || "Open"}`)
      .join(" · ");
    for (const member of room.members.values())
      send(member.ws, {
        protocol: CONTROL_PROTOCOL,
        type: "status",
        ready: room.ready,
        lobby: summary(room),
        message: room.load
          ? `Loading the host's saved run · ${roster}`
          : room.ready
            ? roster
            : `Waiting for players to reach the title screen · ${roster}`,
      });
  };
  const closeRoom = (room, reason) => {
    if (!rooms.delete(room.id)) return;
    clearTimeout(room.load?.timeout);
    clearTimeout(room.start?.timeout);
    for (const member of room.members.values()) {
      tickets.delete(member.token);
      send(member.ws, { protocol: CONTROL_PROTOCOL, type: "closed", message: reason });
      member.ws?.close(4000, "Lobby closed");
    }
  };
  const reserve = (room, seat, displayName) => {
    const member = {
      room,
      seat,
      displayName,
      token: randomBytes(32).toString("base64url"),
      id: randomUUID(),
      expires: Date.now() + reservationMs,
      ws: undefined,
      atTitle: false,
    };
    room.members.set(seat, member);
    tickets.set(member.token, member);
    publish(room);
    return { lobby: summary(room), seat, token: member.token, expiresAt: member.expires };
  };
  const json = (res, status, value) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(value));
  };
  const readBody = async req => {
    let body = "";
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 8192) fail(413, "Request too large");
    }
    try {
      return JSON.parse(body);
    } catch {
      fail(400, "Invalid JSON");
    }
  };
  const server = createServer(async (req, res) => {
    try {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) fail(403, "Origin not allowed");
      if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }
      const path = new URL(req.url, "http://localhost").pathname;
      if (req.method === "GET" && path === "/health")
        return json(res, 200, { ok: true, protocol: CONTROL_PROTOCOL, buildId });
      if (req.method === "GET" && path === "/lobbies")
        return json(res, 200, { lobbies: [...rooms.values()].map(summary), buildId });
      if (req.method === "DELETE" && path === "/membership") {
        const member = tickets.get(req.headers.authorization?.replace(/^Bearer /, ""));
        if (!member) fail(401, "Membership expired");
        if (member.seat === "p1" || member.ws || member.room.ready)
          closeRoom(member.room, "A player left. Create a new lobby to play again.");
        else {
          tickets.delete(member.token);
          member.room.members.delete(member.seat);
          publish(member.room);
        }
        return json(res, 200, { ok: true });
      }
      if (req.method !== "POST") fail(404, "Not found");
      const data = await readBody(req);
      if (!data || typeof data !== "object") fail(400, "Invalid request");
      if (data.buildId !== buildId) fail(409, "Game build differs from the lobby service. Use the same build.");
      const displayName = normalizeName(data.displayName);
      if (!displayName) fail(400, "Set a player name first");
      if (path === "/lobbies") {
        if (rooms.size >= maxRooms) fail(503, "Lobby service is full");
        const { playerCount, enemyPlayer, computerPartner } = data.setup || {};
        if (
          ![1, 2, 3].includes(playerCount)
          || typeof enemyPlayer !== "boolean"
          || (playerCount === 1 && !enemyPlayer)
          || computerPartner
        )
          fail(400, "Unsupported lobby mode");
        if (![3, 6].includes(data.partySize) || (enemyPlayer && data.partySize !== 6)) fail(400, "Invalid team size");
        const room = {
          id: randomUUID(),
          setup: { label: `${playerCount}P${enemyPlayer ? " + EP" : ""}`, playerCount, enemyPlayer },
          partySize: data.partySize,
          members: new Map(),
          status: "starting",
          hostAtMainMenu: false,
          ready: false,
          started: false,
        };
        rooms.set(room.id, room);
        return json(res, 201, reserve(room, "p1", displayName));
      }
      const match = path.match(/^\/lobbies\/([^/]+)\/join$/);
      if (!match) fail(404, "Not found");
      const room = rooms.get(match[1]);
      if (!room) fail(404, "This lobby has closed");
      if (room.started || !room.hostAtMainMenu || room.status !== "waiting")
        fail(409, "This lobby is no longer accepting players");
      if (data.seat === "p1" || !requiredSeats(room).includes(data.seat))
        fail(400, "That seat is not available in this mode");
      if (room.members.has(data.seat)) fail(409, "That seat was just taken. Choose another seat.");
      // No await between checking and reserving: concurrent requests cannot claim the same seat.
      return json(res, 201, reserve(room, data.seat, displayName));
    } catch (error) {
      json(res, error.status || 500, { error: error.status ? error.message : "Lobby service error" });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on("upgrade", (req, socket, head) => {
    if (
      req.url !== "/relay"
      || (req.headers.origin && !allowedOrigins.has(req.headers.origin))
      || wss.clients.size >= maxRooms * 5
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit("connection", ws));
  });
  wss.on("connection", ws => {
    let member;
    let alive = true;
    let windowStart = Date.now();
    let frameCount = 0;
    let byteCount = 0;
    const authTimeout = setTimeout(() => ws.close(4001, "Authentication required"), 5000);
    ws.on("error", () => {});
    ws.on("pong", () => {
      alive = true;
    });
    ws.checkHeartbeat = () => {
      if (!alive) ws.terminate();
      else {
        alive = false;
        ws.ping();
      }
    };
    ws.on("message", (raw, binary) => {
      if (Date.now() - windowStart > 1000) {
        windowStart = Date.now();
        frameCount = 0;
        byteCount = 0;
      }
      byteCount += raw.length;
      if (binary || ++frameCount > 120 || byteCount > MAX_PAYLOAD * 4) {
        ws.close(1008, "Message limit exceeded");
        return;
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.close(1008, "Invalid JSON");
        return;
      }
      if (!msg || typeof msg !== "object") {
        ws.close(1008, "Invalid message");
        return;
      }
      if (!member) {
        const candidate = tickets.get(msg.token);
        if (
          msg.protocol !== CONTROL_PROTOCOL
          || msg.type !== "authenticate"
          || msg.buildId !== buildId
          || !candidate
          || candidate.ws
          || candidate.expires <= Date.now()
        ) {
          ws.close(4001, "Invalid or expired membership");
          return;
        }
        member = candidate;
        member.ws = ws;
        clearTimeout(authTimeout);
        send(ws, { protocol: CONTROL_PROTOCOL, type: "authenticated" });
        publish(member.room);
        // Existing clients announce their profiles/settings to a newly attached member (including EP).
        for (const peer of member.room.members.values())
          if (peer !== member) send(peer.ws, { protocol: CONTROL_PROTOCOL, type: "peer-joined" });
        return;
      }
      const room = member.room;
      if (!rooms.has(room.id)) return;
      const host = member.seat === "p1";
      if (msg.protocol === CONTROL_PROTOCOL) {
        if (msg.type === "start-wait") {
          const start = room.start;
          if (!start || start.committed || msg.seed !== start.seed || room.load || room.resumed) return;
          if (!start.timeout) {
            start.timeout = setTimeout(
              () => closeRoom(room, "New-run startup timed out. Leave and create a new lobby."),
              loadTimeoutMs,
            );
          }
          start.waiting.add(member.seat);
          room.ready = false;
          publish(room);
          send(ws, { protocol: CONTROL_PROTOCOL, type: "start-prepare", startId: start.id });
          return;
        }
        if (msg.type === "start-ready" || msg.type === "start-cancel") {
          const start = room.start;
          if (!start || start.committed || msg.startId !== start.id) return;
          if (msg.type === "start-cancel") {
            if (!host) {
              ws.close(1008, "Only the host can cancel startup");
              return;
            }
            clearTimeout(start.timeout);
            room.start = undefined;
            room.runMode = undefined;
            room.ready = false;
            room.status = "starting";
            for (const peer of room.members.values()) {
              peer.atTitle = false;
              send(peer.ws, { protocol: CONTROL_PROTOCOL, type: "start-cancel", startId: start.id, seed: start.seed });
            }
            publish(room);
            return;
          }
          if (!start.waiting.has(member.seat)) return;
          start.acknowledgements.add(member.seat);
          if (requiredSeats(room).every(seat => start.acknowledgements.has(seat))) {
            clearTimeout(start.timeout);
            start.committed = true;
            room.ready = true;
            room.status = "in-progress";
            for (const peer of room.members.values())
              send(peer.ws, { protocol: CONTROL_PROTOCOL, type: "start-commit", startId: start.id });
            publish(room);
          }
          return;
        }
        if (
          msg.type === "title-reset"
          && host
          && !room.load
          && [...room.members.values()].every(peer => peer.phase === "TitlePhase")
        ) {
          for (const peer of room.members.values()) send(peer.ws, { protocol: CONTROL_PROTOCOL, type: "title-reset" });
          return;
        }
        if (msg.type === "load-request" && host) {
          const reject = message => send(ws, { protocol: CONTROL_PROTOCOL, type: "load-error", message });
          if (
            room.load
            || room.resumed
            || room.runMode
            || !room.ready
            || ![...room.members.values()].every(peer => peer.phase === "TitlePhase")
          ) {
            reject("The lobby is not ready to load a saved run.");
            return;
          }
          let save;
          try {
            if (typeof msg.snapshot !== "string" || Buffer.byteLength(msg.snapshot) > 3 * 1024 * 1024)
              throw new Error();
            save = JSON.parse(msg.snapshot);
            if (!save || typeof save !== "object") throw new Error();
          } catch {
            reject("Invalid or oversized saved run.");
            return;
          }
          const count = save.multiplayerPlayerCount ?? (save.players?.[2]?.party?.length ? 3 : 2);
          if (
            (!save.twoPlayerMode && !save.players?.length && !save.twoPlayerEnemyPlayerMode)
            || count !== room.setup.playerCount
            || !!save.twoPlayerEnemyPlayerMode !== room.setup.enemyPlayer
            || (save.twoPlayerPartySize ?? 6) !== room.partySize
            || (save.twoPlayerVsMode && (room.setup.enemyPlayer || count < 2))
            || save.twoPlayerComputerPartner
            || save.computerPartnerKey
            || save.computerPartnerPlayerIndexes?.length
            || Object.values(save.computerPartnerKeys ?? {}).some(Boolean)
            || typeof save.seed !== "string"
            || !save.seed
            || !Number.isInteger(save.waveIndex)
            || save.waveIndex < 1
            || !save.arena
            || !Array.isArray(save.enemyParty)
            || !Array.isArray(save.players)
            || save.players.slice(0, count).length !== count
            || save.players.slice(0, count).some(player => !Array.isArray(player?.party) || !player.party.length)
            || save.players
              .slice(1)
              .some(player => Array.isArray(player?.party) && player.party.some(pokemon => pokemon?.computerPartnerAce))
          ) {
            reject("The saved run does not match this lobby or is missing multiplayer data.");
            return;
          }
          const loadId = randomUUID();
          const snapshotHash = createHash("sha256").update(msg.snapshot).digest("hex");
          room.load = {
            id: loadId,
            snapshotHash,
            acknowledgements: new Map(),
            timeout: setTimeout(
              () => closeRoom(room, "Saved-run loading timed out. Leave and create a new lobby."),
              loadTimeoutMs,
            ),
          };
          room.ready = false;
          room.runMode = room.setup.enemyPlayer ? "ep" : save.twoPlayerVsMode ? "vs" : "coop";
          room.started = true;
          room.hostAtMainMenu = false;
          room.status = "starting";
          publish(room);
          for (const peer of room.members.values())
            send(peer.ws, {
              protocol: CONTROL_PROTOCOL,
              type: "load-prepare",
              loadId,
              snapshotHash,
              snapshot: msg.snapshot,
            });
          return;
        }
        if ((msg.type === "load-ready" || msg.type === "load-failed") && room.load) {
          const load = room.load;
          if (msg.loadId !== load.id) return; // Ignore acknowledgements from an earlier transaction.
          if (msg.type === "load-failed") {
            const detail = typeof msg.message === "string" ? msg.message.slice(0, 240) : "Could not restore the run.";
            closeRoom(room, `${member.seat.toUpperCase()} failed to load: ${detail}`);
            return;
          }
          if (msg.snapshotHash !== load.snapshotHash || !/^[a-f0-9]{64}$/.test(msg.stateHash || "")) {
            closeRoom(room, "Saved-run verification failed. Leave and create a new lobby.");
            return;
          }
          load.acknowledgements.set(member.seat, msg.stateHash);
          if (requiredSeats(room).every(seat => load.acknowledgements.has(seat))) {
            if (new Set(load.acknowledgements.values()).size !== 1) {
              closeRoom(
                room,
                "Players restored different run states. Check game versions and overrides before retrying.",
              );
              return;
            }
            clearTimeout(load.timeout);
            room.load = undefined;
            room.resumed = true;
            room.ready = true;
            room.status = "in-progress";
            for (const peer of room.members.values())
              send(peer.ws, { protocol: CONTROL_PROTOCOL, type: "load-commit", loadId: load.id });
            publish(room);
          }
          return;
        }
        // Late duplicate acknowledgements are harmless; guest requests cannot initiate a transfer.
        if (msg.type === "load-ready" || msg.type === "load-failed") return;
        ws.close(1008, "Unauthorized lobby control");
        return;
      }
      const ownIndex = seatIndex(member.seat);
      const sharedKinds = ["state-checkpoint", "profile-snapshot"];
      const kinds = host
        ? [...sharedKinds, "input-accepted", "run-bootstrap", "title-start", "settings-sync"]
        : [...sharedKinds, "input-request"];
      if (
        msg.protocol !== GAME_PROTOCOL
        || msg.version !== 1
        || msg.sessionId !== room.id
        || !kinds.includes(msg.kind)
        || !Number.isSafeInteger(msg.sequence)
        || msg.sequence < 0
        || (msg.kind !== "input-accepted" && msg.playerIndex !== ownIndex)
        || (msg.kind === "input-accepted" && !requiredSeats(room).some(seat => seatIndex(seat) === msg.playerIndex))
        || (msg.kind === "profile-snapshot"
          && (msg.profileSnapshot?.playerIndex !== ownIndex
            || (ownIndex === "ep"
              ? typeof msg.profileSnapshot?.identity?.name !== "string"
                || msg.profileSnapshot.identity.name.length > 40
                || typeof msg.profileSnapshot.identity.characterId !== "string"
                || msg.profileSnapshot.identity.characterId.length > 80
                || msg.profileSnapshot.systemSave !== undefined
                || msg.profileSnapshot.starterPreferences !== undefined
              : typeof msg.profileSnapshot?.systemSave !== "string")))
      ) {
        ws.close(1008, "Message does not match reserved seat");
        return;
      }
      if (["input-accepted", "input-request", "title-start", "run-bootstrap"].includes(msg.kind) && !room.ready) return;
      if (msg.kind === "title-start" && msg.titleStart?.action === "load-session") {
        ws.close(1008, "Saved runs require the shared load protocol");
        return;
      }
      if (msg.kind === "title-start") {
        const start = msg.titleStart;
        if (
          start?.action !== "new-run"
          || start.playerCount !== room.setup.playerCount
          || start.partySize !== room.partySize
          || typeof start.vsMode !== "boolean"
          || start.enemyPlayerMode !== room.setup.enemyPlayer
          || (start.vsMode && (room.setup.enemyPlayer || room.setup.playerCount < 2))
          || !Array.isArray(start.computerPartnerPlayerIndexes)
          || start.computerPartnerPlayerIndexes.length
          || Object.keys(start.computerPartnerKeys ?? {}).length
          || room.resumed
        ) {
          ws.close(1008, "Run settings do not match the lobby");
          return;
        }
        const runMode = room.setup.enemyPlayer ? "ep" : start.vsMode ? "vs" : "coop";
        if (room.runMode && room.runMode !== runMode) {
          ws.close(1008, "Run mode is already selected");
          return;
        }
        if (!room.runMode) {
          room.runMode = runMode;
          room.start = { id: randomUUID(), seed: start.seed, waiting: new Set(), acknowledgements: new Set(), committed: false };
          publish(room);
        }
      }
      if (msg.kind === "state-checkpoint") {
        const state = msg.checkpoint?.summary;
        member.phase = state?.phase;
        member.atTitle = state?.phase === "TitlePhase" && state?.uiModeName === "TITLE";
        if (host) {
          room.hostAtMainMenu = member.atTitle && !room.started;
          if (!room.started) room.status = member.atTitle ? "waiting" : "starting";
          else if (state?.phase && state.phase !== "TitlePhase") room.status = "in-progress";
        }
        if (
          !room.ready
          && !room.load
          && !room.start?.waiting.size
          && requiredSeats(room).every(
            seat => room.members.get(seat)?.atTitle && room.members.get(seat)?.ws?.readyState === WebSocket.OPEN,
          )
        )
          room.ready = true;
        publish(room);
      }
      if (host && ["input-accepted", "title-start"].includes(msg.kind) && !room.started) {
        room.started = true;
        room.hostAtMainMenu = false;
        room.status = "starting";
        publish(room);
      }
      // Identity and role come from the reservation, never from the incoming JSON.
      const forwarded = { ...msg, senderId: member.id, senderRole: host ? "host" : "guest" };
      for (const peer of room.members.values()) if (peer !== member) send(peer.ws, forwarded);
    });
    ws.on("close", () => {
      clearTimeout(authTimeout);
      if (member) closeRoom(member.room, "A player disconnected. Create a new lobby to play again.");
    });
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) ws.checkHeartbeat();
    for (const room of rooms.values())
      for (const member of room.members.values()) {
        if (!member.ws && member.expires <= Date.now()) {
          if (member.seat === "p1") {
            closeRoom(room, "Host connection timed out");
            break;
          }
          room.members.delete(member.seat);
          tickets.delete(member.token);
          publish(room);
        }
      }
  }, heartbeatMs);
  heartbeat.unref();
  return {
    server,
    listen: (port = 8788, host = "127.0.0.1") =>
      new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve(server.address());
        });
      }),
    close: async () => {
      clearInterval(heartbeat);
      for (const room of rooms.values()) closeRoom(room, "Lobby service stopped");
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = createOnlineServer();
  const address = await app.listen(Number(process.env.ONLINE_PORT || 8788), process.env.ONLINE_HOST || "127.0.0.1");
  console.log(
    `Online lobby service: http://${address.address}:${address.port} (build: ${process.env.ONLINE_BUILD_ID || "local-dev-v5"})`,
  );
  for (const signal of ["SIGINT", "SIGTERM"])
    process.once(signal, () => {
      void app.close();
    });
}
