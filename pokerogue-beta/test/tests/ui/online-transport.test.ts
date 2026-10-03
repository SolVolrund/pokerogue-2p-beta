import { TwoPlayerInputTransport } from "#app/two-player-input-transport";
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
  const create = () =>
    TwoPlayerInputTransport.create(
      0,
      () => true,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      () => checkpoint,
      undefined,
      () => profile,
    )!;

  it("authenticates before sending profiles and blocks input until the service says all players are ready", () => {
    const transport = create();
    const socket = TestSocket.latest;
    socket.open();
    expect(socket.sent).toEqual([
      { protocol: ONLINE_PROTOCOL, type: "authenticate", token: "local-test-token", buildId: ONLINE_BUILD_ID },
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
});
