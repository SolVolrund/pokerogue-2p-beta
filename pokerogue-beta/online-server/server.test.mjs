import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { WebSocket } from "ws";
import { createOnlineServer } from "./server.mjs";

const protocol = "pokerogue-online-v1";
const buildId = "test-build";

test("EP can share its Player Card but cannot send a progression profile", async t => {
  const f = await fixture(t);
  const { member, client: host } = await f.host(1, true);
  const epMember = await f.request(`/lobbies/${member.lobby.id}/join`, { seat: "ep" });
  const ep = await f.connect(epMember);
  await ep.next(m => m.type === "authenticated");
  const identity = { name: "Opponent", characterId: "sabrina_back" };
  ep.send("profile-snapshot", { profileSnapshot: { playerIndex: "ep", identity } });
  const message = await host.next(m => m.kind === "profile-snapshot");
  assert.deepEqual(message.profileSnapshot, { playerIndex: "ep", identity });
  const closed = once(ep.socket, "close");
  ep.send("profile-snapshot", { profileSnapshot: { playerIndex: "ep", identity, systemSave: "not-an-EP-profile" } });
  const [code] = await closed;
  assert.equal(code, 1008);
});
async function fixture(t, options = {}) {
  const app = createOnlineServer({ buildId, ...options });
  const address = await app.listen(0);
  const base = `http://127.0.0.1:${address.port}`;
  t.after(() => app.close());
  const request = async (path, body, extra = {}) => {
    const response = await fetch(base + path, {
      method: body ? "POST" : "GET",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify({ buildId, displayName: "Tester", ...body }) } : {}),
      ...extra,
    });
    return { status: response.status, ...(await response.json()) };
  };
  const create = (playerCount = 2, enemyPlayer = false) =>
    request("/lobbies", { setup: { playerCount, enemyPlayer }, partySize: 6 });
  const connect = async (member, overrides = {}) => {
    const socket = new WebSocket(base.replace("http:", "ws:") + "/relay");
    const messages = [];
    const waiters = new Set();
    socket.on("error", () => {});
    socket.on("message", raw => {
      const value = JSON.parse(raw);
      messages.push(value);
      for (const waiter of waiters) waiter();
    });
    const next = (predicate, timeout = 1500) =>
      new Promise((resolve, reject) => {
        const check = () => {
          const index = messages.findIndex(predicate);
          if (index >= 0) {
            clearTimeout(timer);
            waiters.delete(check);
            resolve(messages.splice(index, 1)[0]);
          }
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("Expected socket message was not received"));
        }, timeout);
        waiters.add(check);
        check();
      });
    await once(socket, "open");
    socket.send(JSON.stringify({ protocol, type: "authenticate", token: member.token, buildId, ...overrides }));
    let sequence = 0;
    const send = (kind, extra = {}) =>
      socket.send(
        JSON.stringify({
          protocol: "pokerogue-2p-local-input",
          version: 1,
          sessionId: member.lobby.id,
          senderId: "untrusted-client-id",
          senderRole: "host",
          sequence: ++sequence,
          playerIndex: member.seat === "ep" ? "ep" : Number(member.seat.slice(1)) - 1,
          kind,
          button: 0,
          pressed: true,
          ...extra,
        }),
      );
    const title = () =>
      send("state-checkpoint", {
        checkpoint: { fingerprint: "title", summary: { phase: "TitlePhase", uiModeName: "TITLE" } },
      });
    const control = (type, extra = {}) => socket.send(JSON.stringify({ protocol, type, ...extra }));
    return { socket, messages, next, send, title, control };
  };
  const host = async (count = 2, ep = false, capabilities = {}) => {
    const member = await create(count, ep);
    assert.equal(member.status, 201);
    const client = await connect(member, capabilities);
    await client.next(m => m.type === "authenticated");
    client.title();
    await client.next(m => m.type === "status" && m.lobby.hostAtMainMenu);
    return { member, client };
  };
  return { request, create, connect, host };
}

test("private fights wait for both seats and publish one ordered batch without revealing drafts", async t => {
  const f = await fixture(t);
  const cap = { privateTurnV7: true, privateTrainerFightV1: true };
  const { member, client: host } = await f.host(2, false, cap);
  const guest = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat: "p2" }), cap);
  guest.title();
  assert.equal((await host.next(m => m.type === "status" && m.ready && m.privateTurnV7)).privateTrainerFightV1, true);
  host.send("input-accepted", { authoritySequence: 1 });
  await guest.next(m => m.kind === "input-accepted");
  const a = { actor: 12, slot: 0, move: 4, target: 1 };
  const b = { kind: "switch", actor: 34, reserve: 78, baton: false };
  const result = m => m.type === "private-fight-result";
  const begin = key => { for (const client of [host, guest]) client.control("private-draft", { key }); };
  begin("turn1");
  guest.control("private-fight", { key: "turn1", pick: b });
  guest.control("private-fight", { key: "turn1", pick: a });
  guest.send("state-checkpoint", { checkpoint: { fingerprint: "locked", summary: {} } });
  await host.next(m => m.kind === "state-checkpoint" && m.checkpoint?.fingerprint === "locked");
  assert.ok(!host.messages.some(m => result(m) || m.type === "private-fight"));
  host.control("private-fight", { key: "turn1", pick: a });
  assert.deepEqual((await host.next(result)).picks, [a, b]);
  assert.deepEqual((await guest.next(result)).picks, [a, b]);
  for (const [client, pick] of [[host, a], [guest, b]]) client.control("private-fight", { key: "turn1:review", pick });
  for (const client of [host, guest]) assert.deepEqual((await client.next(result)).picks, [a, b]);
  guest.control("private-pause", { key: "turn1" }); // Already committed.
  host.control("private-fight", { key: "turn1", pick: a });
  begin("turn2");
  host.control("private-fight", { key: "turn2", pick: null });
  guest.control("private-fight", { key: "turn2", pick: b });
  for (const client of [host, guest]) {
    assert.deepEqual(await client.next(result), { protocol, type: "private-fight-result", key: "turn2", picks: null });
  }
  const medicine = { kind: "medicine", actor: 12, typeId: "ETHER", targetId: 15, moveIndex: 0 };
  const ball = { kind: "ball", actor: 34, ball: 7, targetId: 12 };
  begin("turn3");
  host.control("private-fight", { key: "turn3", pick: medicine });
  guest.control("private-fight", { key: "turn3", pick: ball });
  for (const client of [host, guest]) assert.deepEqual((await client.next(result)).picks, [medicine, ball]);
  host.control("private-fight", { key: "turn3:review", pick: medicine });
  guest.control("private-pause", { key: "turn3" });
  const paused = m => m.type === "private-paused";
  const firstPause = await host.next(paused);
  assert.ok(Number.isSafeInteger(firstPause.openedAt));
  assert.deepEqual(firstPause, { protocol, type: "private-paused", openedAt: firstPause.openedAt, key: "turn3", owner: 1 });
  assert.deepEqual(await guest.next(paused), firstPause);
  host.control("private-pause", { key: "turn3" });
  guest.control("private-fight", { key: "turn3:review", pick: ball });
  host.control("private-draft", { key: "retry" });
  host.control("private-pause", { key: "retry" }); // Other client is still entering its draft.
  guest.control("private-draft", { key: "retry" });
  guest.control("private-pause", { key: "retry" });
  for (const client of [host, guest]) {
    const { openedAt, ...rest } = await client.next(paused);
    assert.ok(Number.isSafeInteger(openedAt));
    assert.deepEqual(rest, { protocol, type: "private-paused", key: "retry", owner: 0 });
    assert.ok(!client.messages.some(m => result(m) || paused(m)));
  }
});

for (const count of [1, 2, 3]) test(`EP and ${count} player seats exchange grouped commands and EP owns its pause`, async t => {
  const f = await fixture(t);
  const cap = { privateEpFightV1: true };
  const { member, client: host } = await f.host(count, true, cap);
  const peers = [host];
  for (const seat of [...["p2", "p3"].slice(0, count - 1), "ep"]) {
    const peer = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat }), cap);
    peer.title();
    peers.push(peer);
  }
  const ep = peers.at(-1);
  const status = await host.next(m => m.type === "status" && m.ready);
  assert.equal(status.privateEpSeats, peers.length);
  assert.equal(status.privateTurnV7, false);
  host.send("input-accepted", { authoritySequence: 1 });
  await ep.next(m => m.kind === "input-accepted");
  const picks = peers.map((_, i) => [{ actor: i, move: 1, slot: 0, target: 0 }]);
  picks.at(-1).push({ actor: 41, kind: "medicine", targetId: 41, typeId: "POTION" });
  for (const peer of peers) peer.control("private-draft", { key: "ep:1" });
  for (const key of ["ep:1", "ep:1:review"]) {
    for (let i = peers.length - 1; i >= 0; i--) peers[i].control("private-fight", { key, pick: picks[i] });
    for (const peer of peers) assert.deepEqual((await peer.next(m => m.type === "private-fight-result" && m.key === key)).picks, picks);
  }
  for (const peer of peers) peer.control("private-draft", { key: "ep:2" });
  ep.control("private-pause", { key: "ep:2" });
  for (const peer of peers) assert.equal((await peer.next(m => m.type === "private-paused")).owner, "ep");
});

test("three private battle picks stay hidden until complete and a P3 rejection discards the turn", async t => {
  const f = await fixture(t);
  const cap = { privateTurnV7: true, privateTripleFightV1: true, privateTrainerFightV1: true, privateFieldActionsV1: true };
  const { member, client: host } = await f.host(3, false, cap);
  const peers = [host];
  for (const seat of ["p2", "p3"]) {
    const client = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat }), cap);
    client.title();
    peers.push(client);
  }
  const status = await host.next(m => m.type === "status" && m.ready);
  assert.equal(status.privateTripleFightV1, true);
  assert.equal(status.privateFieldActionsV1, true);
  assert.equal(status.privateTrainerFightV1, true);
  assert.equal(status.privateTurnV7, false);
  host.send("input-accepted", { authoritySequence: 1 });
  await peers[2].next(m => m.kind === "input-accepted");
  const picks = [
    { actor: 1, move: 33, slot: 0, target: 2 },
    { kind: "ball", actor: 2, ball: 0, targetId: 20 },
    { kind: "switch", actor: 3, reserve: 13, baton: false },
  ];
  for (const key of ["first", "second"]) {
    if (key === "second") {
      picks[1] = { kind: "pass", actor: 2 };
      picks[2] = { kind: "reposition", actor: 3, position: 0 };
    }
    for (const peer of peers) peer.control("private-draft", { key });
    for (const i of [2, 1]) peers[i].control("private-fight", { key, pick: picks[i] });
    peers[1].send("state-checkpoint", { checkpoint: { fingerprint: key, summary: {} } });
    await host.next(m => m.kind === "state-checkpoint" && m.checkpoint?.fingerprint === key);
    assert.ok(!host.messages.some(m => m.type === "private-fight-result"));
    host.control("private-fight", { key, pick: picks[0] });
    for (const peer of peers) assert.deepEqual((await peer.next(m => m.key === key)).picks, picks);
    const review = key + ":review";
    for (const i of [1, 0, 2]) peers[i].control("private-fight", { key: review, pick: i === 2 && key === "second" ? null : picks[i] });
    for (const peer of peers) assert.deepEqual((await peer.next(m => m.key === review)).picks, key === "second" ? null : picks);
  }
  const key = "third";
  for (const peer of peers) peer.control("private-draft", { key });
  for (const i of [0, 1]) peers[i].control("private-fight", { key, pick: picks[i] });
  peers[2].control("private-pause", { key });
  for (const peer of peers) {
    assert.equal((await peer.next(m => m.type === "private-paused" && m.key === key)).owner, 2);
    assert.ok(!peer.messages.some(m => m.type === "private-fight-result" && m.key === key));
  }
});

test("three contest seats reveal only complete ordered ballots; P3 can interrupt the next ballot", async t => {
  const f = await fixture(t);
  const cap = { privateContestV1: true, privateOpeningSwitchV1: true, privateEventVotesV1: true, privateEventVotesV2: true };
  const { member, client: host } = await f.host(3, false, cap);
  const peers = [host];
  for (const seat of ["p2", "p3"]) {
    const peer = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat }), cap);
    peer.title();
    peers.push(peer);
  }
  const status = await host.next(m => m.type === "status" && m.ready);
  assert.equal(status.privateContestSeats, 3);
  assert.equal(status.privateOpeningSwitchV1, true);
  assert.equal(status.privateEventVotesV2, true);
  assert.equal(status.privateTripleFightV1, false);
  assert.equal(status.privateTurnV7, false);
  host.send("input-accepted", { authoritySequence: 1 });
  await peers[2].next(m => m.kind === "input-accepted");
  const key = "contest:category";
  for (const peer of peers) peer.control("private-draft", { key });
  for (const i of [2, 1]) peers[i].control("private-fight", { key, pick: i });
  peers[1].send("state-checkpoint", { checkpoint: { fingerprint: "waiting", summary: {} } });
  await host.next(m => m.kind === "state-checkpoint" && m.checkpoint?.fingerprint === "waiting");
  assert.ok(!host.messages.some(m => m.type === "private-fight-result"));
  host.control("private-fight", { key, pick: 0 });
  for (const peer of peers) assert.deepEqual((await peer.next(m => m.key === key)).picks, [0, 1, 2]);
  for (const [i, peer] of peers.entries()) peer.control("private-fight", { key: key + ":review", pick: i });
  for (const peer of peers) assert.deepEqual((await peer.next(m => m.key === key + ":review")).picks, [0, 1, 2]);
  const next = "contest:entrant";
  for (const peer of peers) peer.control("private-draft", { key: next });
  host.control("private-fight", { key: next, pick: -1 });
  peers[2].control("private-pause", { key: next });
  for (const peer of peers) assert.equal((await peer.next(m => m.type === "private-paused")).owner, 2);
});

test("one invitation veto ends the ballot once every menu is open, without waiting for other votes", async t => {
  const f = await fixture(t);
  const cap = { privateContestV1: true, privateEventVotesV1: true };
  const { member, client: host } = await f.host(3, false, { ...cap, privateEventVotesV2: true });
  const peers = [host];
  for (const seat of ["p2", "p3"]) {
    const peer = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat }), cap);
    peer.title();
    peers.push(peer);
  }
  const status = await host.next(m => m.type === "status" && m.ready);
  assert.equal(status.privateEventVotesV1, true);
  assert.equal(status.privateEventVotesV2, false);
  host.send("input-accepted", { authoritySequence: 1 });
  await peers[1].next(m => m.kind === "input-accepted");
  const key = "contest:unanimous:invitation";
  host.control("private-draft", { key });
  peers[1].control("private-draft", { key });
  peers[1].control("private-fight", { key, pick: 1 });
  peers[1].send("state-checkpoint", { checkpoint: { fingerprint: "voted", summary: {} } });
  await host.next(m => m.kind === "state-checkpoint" && m.checkpoint?.fingerprint === "voted");
  assert.ok(!host.messages.some(m => m.type === "private-vetoed"));
  peers[2].control("private-draft", { key });
  for (const peer of peers) assert.deepEqual(await peer.next(m => m.type === "private-vetoed"), {
    protocol, type: "private-vetoed", key,
  });
});

test("one experimental client cannot enable private fights in a mixed room", async t => {
  const f = await fixture(t);
  const { member, client: host } = await f.host(2, false, { privateTurnV7: true });
  const guest = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat: "p2" }), { privateTurnV6: true });
  guest.title();
  assert.equal((await host.next(m => m.type === "status" && m.ready)).privateTurnV7, false);
});

test("a wild-only guest keeps trainer turns sequential without disabling private wild turns", async t => {
  const f = await fixture(t);
  const { member, client: host } = await f.host(2, false, { privateTurnV7: true, privateTrainerFightV1: true });
  const guest = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat: "p2" }), { privateTurnV7: true });
  guest.title();
  const status = await host.next(m => m.type === "status" && m.ready);
  assert.equal(status.privateTurnV7, true);
  assert.equal(status.privateTrainerFightV1, false);
});

test("a three-human room with a doubles-only guest cannot enable private battles", async t => {
  const f = await fixture(t);
  const cap = { privateTurnV7: true, privateTripleFightV1: true, privateContestV1: true, privateOpeningSwitchV1: true };
  const { member, client: host } = await f.host(3, false, cap);
  for (const seat of ["p2", "p3"]) {
    const guest = await f.connect(await f.request(`/lobbies/${member.lobby.id}/join`, { seat }), seat === "p2" ? cap : { privateTurnV7: true, privateContestV1: true });
    guest.title();
  }
  const status = await host.next(m => m.type === "status" && m.ready);
  assert.equal(status.privateContestSeats, 3);
  assert.equal(status.privateOpeningSwitchV1, false);
  assert.equal(status.privateTripleFightV1, false);
  assert.equal(status.privateTurnV7, false);
});

test("health, build compatibility, modes, sanitized names, and private membership tickets", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/health")).ok, true);
  assert.equal((await f.request("/lobbies", { buildId: "wrong" })).status, 409);
  assert.equal(
    (
      await f.request("/lobbies", {
        setup: { playerCount: 3, enemyPlayer: false, computerPartner: true },
        partySize: 6,
      })
    ).status,
    400,
  );
  assert.equal((await f.create(1, false)).status, 400);
  for (const [count, ep] of [
    [2, false],
    [3, false],
    [1, true],
    [2, true],
    [3, true],
  ]) {
    assert.equal((await f.create(count, ep)).status, 201);
  }
  const member = await f.request("/lobbies", {
    displayName: "<Daniel>\n",
    setup: { playerCount: 2, enemyPlayer: false },
    partySize: 3,
  });
  assert.equal(member.lobby.hostDisplayName, "Daniel");
  assert.equal(member.lobby.partySize, 3);
  const listing = await f.request("/lobbies");
  assert.equal(JSON.stringify(listing).includes(member.token), false);
  assert.equal(
    (await f.request("/lobbies", undefined, { headers: { Origin: "https://unrelated.example" } })).status,
    403,
  );
});

test("joining waits for the host's initial menu and reservations are atomic", async t => {
  const f = await fixture(t);
  const cold = await f.create();
  assert.equal((await f.request(`/lobbies/${cold.lobby.id}/join`, { seat: "p2" })).status, 409);
  const { member } = await f.host();
  const path = `/lobbies/${member.lobby.id}/join`;
  for (const seat of ["p1", "p3", "ep", "unknown"]) assert.equal((await f.request(path, { seat })).status, 400);
  const race = await Promise.all([f.request(path, { seat: "p2" }), f.request(path, { seat: "p2" })]);
  assert.deepEqual(race.map(r => r.status).sort(), [201, 409]);
});

test("rooms isolate traffic, overwrite guest identity, and wait for every seat before gameplay", async t => {
  const f = await fixture(t);
  const a = await f.host(2, true);
  const b = await f.host();
  const guestMember = await f.request(`/lobbies/${a.member.lobby.id}/join`, { seat: "p2" });
  const guest = await f.connect(guestMember);
  await guest.next(m => m.type === "authenticated");
  guest.title();
  await a.client.next(m => m.kind === "state-checkpoint" && m.playerIndex === 1);
  assert.equal((await a.client.next(m => m.type === "status" && m.lobby.seats.p2)).ready, false);
  a.client.send("input-accepted", { authoritySequence: 1 });
  const epMember = await f.request(`/lobbies/${a.member.lobby.id}/join`, { seat: "ep" });
  const ep = await f.connect(epMember);
  await ep.next(m => m.type === "authenticated");
  ep.title();
  await a.client.next(m => m.type === "status" && m.ready);
  assert.equal(
    guest.messages.some(m => m.kind === "input-accepted"),
    false,
  );
  guest.send("input-request");
  const input = await a.client.next(m => m.kind === "input-request");
  assert.equal(input.senderRole, "guest");
  assert.notEqual(input.senderId, "untrusted-client-id");
  a.client.send("input-accepted", { authoritySequence: 2 });
  await guest.next(m => m.kind === "input-accepted");
  assert.equal(
    b.client.messages.some(m => m.protocol === "pokerogue-2p-local-input"),
    false,
  );
  assert.equal((await f.request(`/lobbies/${a.member.lobby.id}/join`, { seat: "p2" })).status, 409);
  a.client.send("state-checkpoint", { checkpoint: { fingerprint: "run", summary: { phase: "CommandPhase" } } });
  await a.client.next(m => m.type === "status" && m.lobby.status === "in-progress");
});

test("invalid, reused, and forged memberships cannot take over a seat", async t => {
  const f = await fixture(t);
  const a = await f.host();
  const duplicate = await f.connect(a.member);
  assert.equal((await once(duplicate.socket, "close"))[0], 4001);
  const invalid = await f.connect(a.member, { token: "not-a-ticket" });
  assert.equal((await once(invalid.socket, "close"))[0], 4001);
  const guestMember = await f.request(`/lobbies/${a.member.lobby.id}/join`, { seat: "p2" });
  const guest = await f.connect(guestMember);
  await guest.next(m => m.type === "authenticated");
  guest.send("profile-snapshot", { profileSnapshot: { playerIndex: 0, systemSave: "stolen-seat" } });
  assert.equal((await once(guest.socket, "close"))[0], 1008);
  assert.equal((await f.request("/lobbies")).lobbies.length, 0);
});

test("host and guest disconnects remove the lobby and close peers", async t => {
  for (const who of ["host", "guest"]) {
    const f = await fixture(t);
    const a = await f.host();
    const member = await f.request(`/lobbies/${a.member.lobby.id}/join`, { seat: "p2" });
    const guest = await f.connect(member);
    await guest.next(m => m.type === "authenticated");
    const closed = once((who === "host" ? guest : a.client).socket, "close");
    (who === "host" ? a.client : guest).socket.close();
    await closed;
    assert.deepEqual((await f.request("/lobbies")).lobbies, []);
  }
});

test("abandoned reservations expire, freeing guest seats and removing absent hosts", async t => {
  const f = await fixture(t, { reservationMs: 100, heartbeatMs: 25 });
  const a = await f.host();
  await f.request(`/lobbies/${a.member.lobby.id}/join`, { seat: "p2" });
  await f.create();
  await delay(200);
  const listing = (await f.request("/lobbies")).lobbies;
  assert.equal(listing.length, 1);
  assert.equal(listing[0].seats.p2, undefined);
});

function savedRun(count = 2, ep = false) {
  return {
    twoPlayerMode: true,
    multiplayerPlayerCount: count,
    twoPlayerPartySize: 6,
    twoPlayerEnemyPlayerMode: ep,
    seed: "saved-seed",
    waveIndex: 23,
    arena: { biome: 0 },
    enemyParty: [],
    players: Array.from({ length: count }, () => ({ party: [{ species: 1 }] })),
  };
}

async function readyLobby(f, count = 2, ep = false) {
  const { member, client } = await f.host(count, ep);
  const clients = [client];
  const seats = [...Array.from({ length: count - 1 }, (_, i) => `p${i + 2}`), ...(ep ? ["ep"] : [])];
  for (const seat of seats) {
    const ticket = await f.request(`/lobbies/${member.lobby.id}/join`, { seat });
    const guest = await f.connect(ticket);
    await guest.next(m => m.type === "authenticated");
    guest.title();
    clients.push(guest);
  }
  await client.next(m => m.type === "status" && m.ready);
  return { clients, member };
}

async function startSelection(clients, count = 2, ep = false, seed = "new-run-seed") {
  clients[0].send("title-start", { titleStart: {
    action: "new-run", playerCount: count, partySize: 6, vsMode: false,
    enemyPlayerMode: ep, computerPartnerPlayerIndexes: [], seed,
  } });
  await clients[1].next(m => m.kind === "title-start");
  for (const client of clients) client.control("start-wait", { seed });
  const prepares = await Promise.all(clients.map(c => c.next(m => m.type === "start-prepare")));
  assert.ok(prepares.every(m => m.startId === prepares[0].startId));
  return prepares[0].startId;
}

test("new runs wait for host slot confirmation and every guest including EP, once per transaction", async t => {
  for (const last of [0, 3]) {
    const f = await fixture(t);
    const { clients } = await readyLobby(f, 3, true);
    const startId = await startSelection(clients, 3, true);
    clients[last].control("start-ready", { startId: "stale" });
    for (const [index, client] of clients.entries()) {
      if (index !== last) {
        client.control("start-ready", { startId });
        client.control("start-ready", { startId });
      }
    }
    clients[0].send("input-accepted", { authoritySequence: 1 });
    await delay(30);
    assert.ok(clients.every(c => !c.messages.some(m => m.type === "start-commit" || m.kind === "input-accepted")));
    clients[last].control("start-ready", { startId });
    await Promise.all(clients.map(c => c.next(m => m.type === "start-commit" && m.startId === startId)));
    clients[last].control("start-ready", { startId });
    await delay(20);
    assert.ok(clients.every(c => !c.messages.some(m => m.type === "start-commit")));
    clients[0].send("input-accepted", { authoritySequence: 2 });
    await clients[1].next(m => m.kind === "input-accepted" && m.authoritySequence === 2);
  }
});

test("host startup cancellation resets everyone and stale acknowledgements cannot start the next run", async t => {
  const f = await fixture(t);
  const { clients } = await readyLobby(f);
  const startId = await startSelection(clients);
  clients[1].control("start-ready", { startId });
  clients[0].control("start-cancel", { startId });
  await Promise.all(clients.map(c => c.next(m => m.type === "start-cancel" && m.seed === "new-run-seed")));
  for (const client of clients) {
    client.messages.length = 0;
    client.title();
  }
  await clients[0].next(m => m.type === "status" && m.ready);
  const nextId = await startSelection(clients, 2, false, "next-run-seed");
  assert.notEqual(startId, nextId);
  clients[0].control("start-ready", { startId });
  clients[1].control("start-ready", { startId: nextId });
  await delay(20);
  assert.ok(clients.every(c => !c.messages.some(m => m.type === "start-commit")));
  clients[0].control("start-ready", { startId: nextId });
  await Promise.all(clients.map(c => c.next(m => m.type === "start-commit" && m.startId === nextId)));
});

test("startup timeout, disconnect, or a guest cancellation never releases the run", async t => {
  for (const failure of ["timeout", "disconnect", "guest-cancel"]) {
    const f = await fixture(t, { loadTimeoutMs: failure === "timeout" ? 100 : 3000 });
    const { clients } = await readyLobby(f);
    const startId = await startSelection(clients);
    clients[0].control("start-ready", { startId });
    if (failure === "disconnect") clients[1].socket.close();
    if (failure === "guest-cancel") clients[1].control("start-cancel", { startId });
    await clients[0].next(m => m.type === "closed");
    assert.ok(clients.every(c => !c.messages.some(m => m.type === "start-commit")));
    assert.equal((await f.request("/lobbies")).lobbies.length, 0);
  }
});

test("saved runs transfer identically and wait for every seat, including EP, before resuming", async t => {
  const f = await fixture(t);
  const { clients } = await readyLobby(f, 3, true);
  const other = await f.host();
  const snapshot = JSON.stringify(savedRun(3, true));
  clients[0].control("load-request", { snapshot });
  const prepare = await Promise.all(clients.map(c => c.next(m => m.type === "load-prepare")));
  assert.ok(prepare.every(m => m.snapshot === snapshot && m.loadId === prepare[0].loadId));
  assert.equal(
    other.client.messages.some(m => m.type === "load-prepare"),
    false,
  );
  const ack = { loadId: prepare[0].loadId, snapshotHash: prepare[0].snapshotHash, stateHash: "a".repeat(64) };
  clients[0].control("load-ready", { ...ack, loadId: "stale" });
  for (const c of clients.slice(0, -1)) c.control("load-ready", ack);
  clients[0].control("load-ready", ack); // Duplicate must not count as another seat.
  clients[0].send("input-accepted", { authoritySequence: 1 });
  clients[0].title(); // Presence cannot reopen the readiness gate during restoration.
  await clients[0].next(m => m.type === "status" && !m.ready && m.lobby.status === "starting");
  await delay(30);
  assert.ok(clients.every(c => !c.messages.some(m => m.type === "load-commit" || m.kind === "input-accepted")));
  clients.at(-1).control("load-ready", ack);
  await Promise.all(clients.map(c => c.next(m => m.type === "load-commit" && m.loadId === ack.loadId)));
  await clients[0].next(m => m.type === "status" && m.ready && m.lobby.status === "in-progress");
  clients[0].send("input-accepted", { authoritySequence: 2 });
  await clients[1].next(m => m.kind === "input-accepted" && m.authoritySequence === 2);
});

test("incompatible saves are rejected without closing the ready lobby", async t => {
  const f = await fixture(t);
  const { clients } = await readyLobby(f);
  for (const mismatch of [
    { multiplayerPlayerCount: 3 },
    { twoPlayerEnemyPlayerMode: true },
    { twoPlayerPartySize: 3 },
    { twoPlayerComputerPartner: true },
    { computerPartnerKeys: { 1: "alex" } },
    { computerPartnerPlayerIndexes: [1] },
    { players: [{ party: [{}] }, { party: [{ computerPartnerAce: true }] }] },
    { waveIndex: 0 },
    { players: [] },
  ]) {
    clients[0].control("load-request", { snapshot: JSON.stringify({ ...savedRun(), ...mismatch }) });
    await clients[0].next(m => m.type === "load-error");
  }
  clients[0].control("title-reset");
  await Promise.all(clients.map(c => c.next(m => m.type === "title-reset")));
  assert.equal((await f.request("/lobbies")).lobbies.length, 1);
  assert.ok(clients.every(c => !c.messages.some(m => m.type === "load-prepare")));
});

test("failed restoration, corrupt acknowledgement, divergent state, and timeout never commit", async t => {
  for (const failure of ["client", "snapshot", "state", "timeout"]) {
    const f = await fixture(t, { loadTimeoutMs: failure === "timeout" ? 100 : 3000 });
    const { clients } = await readyLobby(f);
    clients[0].control("load-request", { snapshot: JSON.stringify(savedRun()) });
    const prepare = await clients[0].next(m => m.type === "load-prepare");
    const ack = { loadId: prepare.loadId, snapshotHash: prepare.snapshotHash, stateHash: "a".repeat(64) };
    clients[0].control("load-ready", ack);
    if (failure === "client") clients[1].control("load-failed", { loadId: ack.loadId, message: "No empty save slot" });
    if (failure === "snapshot") clients[1].control("load-ready", { ...ack, snapshotHash: "wrong" });
    if (failure === "state") clients[1].control("load-ready", { ...ack, stateHash: "b".repeat(64) });
    const closed = await clients[0].next(m => m.type === "closed");
    assert.ok(closed.message);
    assert.ok(clients.every(c => !c.messages.some(m => m.type === "load-commit")));
    assert.equal((await f.request("/lobbies")).lobbies.length, 0);
  }
});

test("guests cannot initiate loading and the old slot-number load cannot bypass verification", async t => {
  for (const legacy of [false, true]) {
    const f = await fixture(t);
    const { clients } = await readyLobby(f);
    const socket = clients[legacy ? 0 : 1].socket;
    const closed = once(socket, "close");
    if (legacy) clients[0].send("title-start", { titleStart: { action: "load-session", slotId: 0 } });
    else clients[1].control("load-request", { snapshot: JSON.stringify(savedRun()) });
    assert.equal((await closed)[0], 1008);
  }
});

test("hosts select compatible Co-op, Vs, or EP modes and repeated announcements preserve that choice", async t => {
  for (const [count, ep, vs] of [
    [2, false, false],
    [2, false, true],
    [3, false, false],
    [3, false, true],
    [1, true, false],
    [2, true, false],
    [3, true, false],
  ]) {
    const f = await fixture(t);
    const { clients, member } = await readyLobby(f, count, ep);
    const titleStart = {
      action: "new-run",
      playerCount: count,
      partySize: 6,
      vsMode: vs,
      enemyPlayerMode: ep,
      computerPartnerPlayerIndexes: [],
    };
    clients[0].send("title-start", { titleStart });
    const received = await clients[1].next(m => m.kind === "title-start");
    assert.deepEqual(received.titleStart, titleStart);
    const runMode = ep ? "ep" : vs ? "vs" : "coop";
    const lobby = (await f.request("/lobbies")).lobbies.find(l => l.id === member.lobby.id);
    assert.equal(lobby.runMode, runMode);
    assert.equal(lobby.hostAtMainMenu, false);
    clients[0].send("title-start", { titleStart });
    await clients[1].next(m => m.kind === "title-start");
  }
});

test("run starts cannot change reserved seats, add CPUs, or combine Vs with EP", async t => {
  for (const [count, ep, extra] of [
    [2, false, { playerCount: 3 }],
    [3, false, { playerCount: 2 }],
    [2, false, { enemyPlayerMode: true }],
    [1, true, { vsMode: true }],
    [3, true, { vsMode: true }],
    [2, false, { computerPartnerPlayerIndexes: [1] }],
    [2, false, { computerPartnerKeys: { 1: "alex" } }],
    [2, false, { partySize: 3 }],
  ]) {
    const f = await fixture(t);
    const { clients } = await readyLobby(f, count, ep);
    const closed = once(clients[0].socket, "close");
    clients[0].send("title-start", {
      titleStart: {
        action: "new-run",
        playerCount: count,
        partySize: 6,
        vsMode: false,
        enemyPlayerMode: ep,
        computerPartnerPlayerIndexes: [],
        ...extra,
      },
    });
    assert.equal((await closed)[0], 1008);
    assert.equal(
      clients[1].messages.some(m => m.kind === "title-start"),
      false,
    );
  }
});

test("Vs saves resume in matching human lobbies, but EP lobbies reject them", async t => {
  for (const count of [2, 3]) {
    const f = await fixture(t);
    const { clients } = await readyLobby(f, count);
    const snapshot = JSON.stringify({ ...savedRun(count), twoPlayerVsMode: true });
    clients[0].control("load-request", { snapshot });
    const prepare = await Promise.all(clients.map(c => c.next(m => m.type === "load-prepare")));
    assert.ok(prepare.every(m => JSON.parse(m.snapshot).twoPlayerVsMode));
    for (const client of clients)
      client.control("load-ready", {
        loadId: prepare[0].loadId,
        snapshotHash: prepare[0].snapshotHash,
        stateHash: "a".repeat(64),
      });
    await Promise.all(clients.map(c => c.next(m => m.type === "load-commit")));
    assert.equal((await f.request("/lobbies")).lobbies[0].runMode, "vs");
  }
  const f = await fixture(t);
  const { clients } = await readyLobby(f, 1, true);
  clients[0].control("load-request", { snapshot: JSON.stringify({ ...savedRun(1, true), twoPlayerVsMode: true }) });
  await clients[0].next(m => m.type === "load-error");
  assert.equal(
    clients[1].messages.some(m => m.type === "load-prepare"),
    false,
  );
});
