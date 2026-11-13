import { TwoPlayerInputTransport, type RemoteInputHandler, type TwoPlayerStateCheckpoint } from "#app/two-player-input-transport";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { UiMode } from "#enums/ui-mode";
import { ONLINE_BUILD_ID, ONLINE_PROTOCOL } from "#utils/online-lobby-client";
import { onlineSaveSession } from "#utils/online-save-session";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class TestSocket extends EventTarget {
  static OPEN = 1;
  static latest: TestSocket;
  readyState = 0;
  sent: any[] = [];
  constructor(_url: string) {
    super();
    TestSocket.latest = this;
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event("open"));
  }
  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
  }
  close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event("close"));
  }
}

describe("Online transport handshake", () => {
  const initialUrl = window.location.href;
  const checkpoint = { fingerprint: "title", summary: { phase: "TitlePhase", uiModeName: "TITLE" } };
  const profile = { playerIndex: 0 as const, systemSave: "profile" };
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("WebSocket", TestSocket);
    window.history.replaceState(
      {},
      "",
      "?twoPlayerInputTransport=websocket&twoPlayerNetworkRole=host&twoPlayerSession=test&onlineLobby=1",
    );
    sessionStorage.setItem(
      "pokerogue-online-membership-v1",
      JSON.stringify({ lobby: { id: "test" }, seat: "p1", token: "local-test-token" }),
    );
  });
  afterEach(() => {
    TestSocket.latest?.close();
    onlineSaveSession.loading = false;
    onlineSaveSession.localMenu = false;
    onlineSaveSession.receive = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.history.replaceState({}, "", initialUrl);
    sessionStorage.removeItem("pokerogue-online-membership-v1");
    document.getElementById("online-connection-status")?.remove();
  });
  const create = (
    onRemoteInput: RemoteInputHandler = () => true,
    getCheckpoint: () => TwoPlayerStateCheckpoint = () => checkpoint,
  ) =>
    TwoPlayerInputTransport.create(
      0,
      onRemoteInput,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      getCheckpoint,
      undefined,
      () => profile,
    )!;

  it("authenticates before sending profiles and blocks input until the service says all players are ready", () => {
    const transport = create();
    const socket = TestSocket.latest;
    socket.open();
    expect(socket.sent).toEqual([
      { protocol: ONLINE_PROTOCOL, type: "authenticate", token: "local-test-token", buildId: ONLINE_BUILD_ID, privateTurnV7: true, privateEpFightV1: true, privateTripleFightV1: true, privateTrainerFightV1: true, privateFieldActionsV1: true, privateContestV1: true, privateOpeningSwitchV1: true, privateEventVotesV1: true, privateEventVotesV2: true },
    ]);
    expect(transport.getInputReadinessBlockReason()).toBe("online-lobby-waiting-for-players");
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "authenticated" });
    expect(socket.sent.some(m => m.kind === "profile-snapshot")).toBe(true);
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", ready: true, message: "P1: Host · P2: Guest" });
    expect(transport.getInputReadinessBlockReason()).toBeUndefined();
    socket.close();
    expect(transport.getInputReadinessBlockReason()).toBe("online-lobby-waiting-for-players");
    expect(document.getElementById("online-connection-status")?.textContent).toContain("Disconnected");
  });

  it("re-announces the host profile when EP or another player attaches", () => {
    create();
    const socket = TestSocket.latest;
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "authenticated" });
    socket.sent = [];
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "peer-joined" });
    expect(socket.sent.some(m => m.kind === "profile-snapshot")).toBe(true);
    expect(socket.sent.some(m => m.kind === "state-checkpoint")).toBe(true);
  });

  it("allows only the host's private save menu while startup is waiting", () => {
    const transport = create();
    const socket = TestSocket.latest;
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "authenticated" });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", ready: false });
    onlineSaveSession.loading = true;
    expect(transport.getInputReadinessBlockReason()).toBe("online-save-loading");
    onlineSaveSession.localMenu = true;
    expect(transport.getInputReadinessBlockReason()).toBeUndefined();
    const receive = vi.fn();
    onlineSaveSession.receive = receive;
    const prepare = { protocol: ONLINE_PROTOCOL, type: "start-prepare", startId: "start-1" };
    socket.receive(prepare);
    expect(receive).toHaveBeenCalledWith(prepare);
    socket.close();
    expect(transport.getInputReadinessBlockReason()).toBeDefined();
  });

  it.each([2, 3])("delivers all %i private seats only to the matching turn and never as a remote button", async seats => {
    const input = vi.fn(() => true);
    const transport = create(input);
    const socket = TestSocket.latest;
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "authenticated" });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", ready: true, privateTurnV7: seats === 2, privateTripleFightV1: seats === 3 });
    const pick = { actor: 11, slot: 1, move: 33, target: 1 };
    const picks = [pick, { actor: 12, slot: 0, move: 21, target: 0 }];
    if (seats === 3) picks.push({ actor: 13, slot: 2, move: 33, target: 5 });
    const review = vi.fn(() => true);
    const result = transport.submitPrivateFight("wave2-turn2", pick, review);
    expect(socket.sent.at(-1)).toEqual({ protocol: ONLINE_PROTOCOL, type: "private-fight", key: "wave2-turn2", pick });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key: "wave2-turn1", picks: null });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key: "wave2-turn2", picks });
    await Promise.resolve();
    expect(review).toHaveBeenCalledWith(picks);
    expect(socket.sent.at(-1)).toMatchObject({ key: "wave2-turn2:review", pick });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key: "wave2-turn2:review", picks });
    await expect(result).resolves.toEqual(picks);
    for (const waitingForReview of [false, true]) {
      const key = "pause-" + waitingForReview;
      const pause = vi.fn();
      transport.beginPrivateDraft(key, pause);
      const pending = transport.submitPrivateFight(key, pick, review);
      if (waitingForReview) {
        socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key, picks });
        await Promise.resolve();
      }
      expect(transport.requestPrivatePause()).toBe(true);
      expect(socket.sent.at(-1)).toMatchObject({ type: "private-pause", key });
      socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-paused", key: "stale", owner: 0 });
      expect(pause).not.toHaveBeenCalled();
      socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-paused", key, owner: seats - 1, openedAt: 1800000000000 });
      await expect(pending).resolves.toBeNull();
      expect(pause).toHaveBeenCalledExactlyOnceWith(seats - 1, 1800000000000);
      expect(transport.requestPrivatePause()).toBe(false);
    }
    for (const localAccepts of [true, false]) {
      const key = "rejection-" + localAccepts;
      const result = transport.submitPrivateFight(key, pick, () => localAccepts);
      socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key, picks });
      await Promise.resolve();
      expect(socket.sent.at(-1)).toMatchObject({ key: key + ":review", pick: localAccepts ? pick : null });
      socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key: key + ":review", picks: null });
      await expect(result).resolves.toBeNull();
    }
    expect(input).not.toHaveBeenCalled();
  });

  it("cancels a pending invitation on a matching veto, but ignores late and duplicate vetoes", async () => {
    const transport = create();
    const socket = TestSocket.latest;
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", privateContestSeats: 3 });
    expect(transport.privateEventVotesEnabled).toBe(false);
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", privateContestSeats: 3, privateEventVotesV1: true });
    expect(transport.privateEventVotesEnabled).toBe(true);
    expect(transport.privateEventVotesV2Enabled).toBe(false);
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", privateContestSeats: 3, privateEventVotesV1: true, privateEventVotesV2: true });
    expect(transport.privateEventVotesV2Enabled).toBe(true);
    const key = "contest:unanimous:current";
    const veto = vi.fn();
    const review = vi.fn(() => true);
    transport.beginPrivateDraft(key, vi.fn(), veto);
    const pending = transport.submitPrivateContest(key, 0, review);
    const decline = (key: string) => socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-vetoed", key });
    decline("contest:unanimous:old");
    expect(veto).not.toHaveBeenCalled();
    decline(key);
    decline(key);
    expect(veto).toHaveBeenCalledOnce();
    await expect(pending).resolves.toBeNull();
    expect(review).not.toHaveBeenCalled();
  });

  it("validates all three contest choices and abandons a pending review on a P3 pause", async () => {
    const transport = create();
    const socket = TestSocket.latest;
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", ready: true, privateContestSeats: 3 });
    const key = "contest:entrant";
    const pause = vi.fn();
    const review = vi.fn(() => false);
    transport.beginPrivateDraft(key, pause);
    const pending = transport.submitPrivateContest(key, 0, review);
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-fight-result", key, picks: [0, 10, -1] });
    await Promise.resolve();
    expect(review).toHaveBeenCalledWith([0, 10, -1]);
    expect(socket.sent.at(-1)).toMatchObject({ key: key + ":review", pick: null });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "private-paused", key, owner: 2, openedAt: 1000 });
    await expect(pending).resolves.toBeNull();
    expect(pause).toHaveBeenCalledExactlyOnceWith(2, 1000);
  });

  it("routes saved-run controls through the authenticated socket and preserves load failure details", () => {
    const transport = create();
    const socket = TestSocket.latest;
    const receive = vi.fn();
    onlineSaveSession.receive = receive;
    expect(onlineSaveSession.send?.({ type: "load-request", snapshot: "save" })).toBe(false);
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "authenticated" });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", ready: true });
    expect(onlineSaveSession.send?.({ type: "load-request", snapshot: "save" })).toBe(true);
    expect(socket.sent.at(-1)).toEqual({ protocol: ONLINE_PROTOCOL, type: "load-request", snapshot: "save" });
    const prepare = { protocol: ONLINE_PROTOCOL, type: "load-prepare", loadId: "test" };
    socket.receive(prepare);
    expect(receive).toHaveBeenCalledWith(prepare);
    onlineSaveSession.loading = true;
    expect(transport.getInputReadinessBlockReason()).toBe("online-save-loading");
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "closed", message: "P2 has no empty save slot." });
    socket.close();
    expect(document.getElementById("online-connection-status")?.textContent).toContain("P2 has no empty save slot.");
    expect(receive).toHaveBeenCalledWith(expect.objectContaining({ type: "load-abort" }));
  });

  it("does not connect a copied lobby URL without its tab membership", () => {
    sessionStorage.removeItem("pokerogue-online-membership-v1");
    const transport = create();
    TestSocket.latest.open();
    expect(TestSocket.latest.sent).toEqual([]);
    expect(TestSocket.latest.readyState).toBe(3);
    expect(transport.getInputReadinessBlockReason()).toBe("online-lobby-waiting-for-players");
  });

  it("leaves the original LAN startup without the Online authentication gate", () => {
    window.history.replaceState(
      {},
      "",
      "?twoPlayerInputTransport=websocket&twoPlayerNetworkRole=host&twoPlayerSession=test",
    );
    const transport = create();
    TestSocket.latest.open();
    expect(TestSocket.latest.sent.some(m => m.type === "authenticate")).toBe(false);
    expect(TestSocket.latest.sent.some(m => m.kind === "profile-snapshot")).toBe(true);
    expect(transport.getInputReadinessBlockReason()).toBeUndefined();
  });

  const contestCheckpoint = (moveId: MoveId): TwoPlayerStateCheckpoint => ({
    fingerprint: String(moveId),
    summary: { phase: "ContestCommandPhase", uiMode: UiMode.CONTEST_INPUT },
    inputContext: { id: "round-1-player-2", promptId: "round-1-player-2", strict: true, key: {} },
    contestMoveSelection: { round: 1, contestantId: "player_2", moveId },
  });
  const remoteInput = (kind: string, checkpoint: TwoPlayerStateCheckpoint, senderRole = "guest") => ({
    protocol: "pokerogue-2p-local-input",
    version: 1,
    kind,
    sessionId: "test",
    senderId: "remote-test-player",
    senderRole,
    sequence: 1,
    playerIndex: 1,
    button: Button.ACTION,
    pressed: true,
    checkpoint,
  });

  it("echoes the guest's confirmed contest move, not the host's local cursor", () => {
    const receive = vi.fn(() => true);
    const hostCheckpoint = contestCheckpoint(MoveId.HARDEN);
    const guestCheckpoint = contestCheckpoint(MoveId.TACKLE);
    const transport = create(receive, () => hostCheckpoint);
    const socket = TestSocket.latest;
    socket.open();
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "authenticated" });
    socket.receive({ protocol: ONLINE_PROTOCOL, type: "status", ready: true });
    transport.sendCheckpoint();
    socket.receive(remoteInput("state-checkpoint", guestCheckpoint));
    vi.advanceTimersByTime(150);
    socket.receive({ ...remoteInput("input-request", guestCheckpoint), sequence: 2 });
    expect(receive).toHaveBeenCalledWith(1, Button.ACTION, true, guestCheckpoint);
    const accepted = socket.sent.find(m => m.kind === "input-accepted");
    expect(accepted?.checkpoint.contestMoveSelection).toEqual(guestCheckpoint.contestMoveSelection);
    expect(accepted?.checkpoint.inputContext).toEqual(hostCheckpoint.inputContext);
  });

  it.each(["guest", "peer"] as const)("delivers explicit contest moves to %s clients", role => {
    window.history.replaceState(
      {}, "", `?twoPlayerInputTransport=websocket&twoPlayerNetworkRole=${role}&twoPlayerSession=test`,
    );
    const receive = vi.fn(() => true);
    const local = contestCheckpoint(MoveId.HARDEN);
    const chosen = contestCheckpoint(MoveId.TACKLE);
    const transport = create(receive, () => local);
    TestSocket.latest.open();
    transport.sendCheckpoint();
    vi.advanceTimersByTime(150);
    TestSocket.latest.receive(remoteInput(role === "guest" ? "input-accepted" : "input", chosen, "host"));
    expect(receive).toHaveBeenCalledWith(1, Button.ACTION, true, chosen);
  });
});
