# Online connectivity baseline

Investigated 2026-09-23 against the current working tree (HEAD `5b41e079ce39`, with existing uncommitted changes). This is a source inspection, not a live connection test. No networking or gameplay implementation was changed.

## Current connection methods

| Method | Implementation | Scope |
| --- | --- | --- |
| One game instance with local players | Local input ownership; transport factory returns no transport for seat `both` | No network connection |
| Separate local browser contexts | `BroadcastChannel`, selected by `twoPlayerInputTransport=local`, `broadcast`, or `loopback` | Local browser channel, not a cross-machine connection |
| LAN | Browser WebSocket clients connect to the host's Node relay | Current cross-machine transport |
| Hamachi | Same WebSocket flow using the host's Hamachi address | Documented online route; no Hamachi SDK or integration in the game |
| Explicit relay endpoint | `twoPlayerWsUrl` query parameter | Existing configuration hook; not a separate transport or a complete hosted service |

No WebRTC, signaling service, STUN/TURN configuration, matchmaking service, or automatic NAT traversal was found in the inspected active networking code.

## Process and address layout

The desktop build stages `pokerogue-beta/desktop/electron/main.cjs` and `scripts/two-player-ws-relay.mjs`. On launch, Electron starts both a static game server and the relay, even before the user chooses Host or Join.

- Desktop game server: defaults to `0.0.0.0:8000`; the window opens `http://127.0.0.1:8000/`. If occupied, the game server tries subsequent ports through 8020.
- Desktop relay: defaults to `0.0.0.0:8787`. There is no equivalent relay port fallback.
- Standalone relay: defaults to `127.0.0.1:8787`; `start:2p-ws:lan` changes its bind address to `0.0.0.0`.
- Development game server: `start:dev:lan` runs Vite on `0.0.0.0:8000`.
- Server configuration: `POKEROGUE_2P_APP_HOST`, `POKEROGUE_2P_APP_PORT`, `POKEROGUE_2P_WS_HOST`, and `POKEROGUE_2P_WS_PORT`; the standalone relay also accepts `--host` and `--port`.
- Client endpoint: `twoPlayerWsUrl`, otherwise `ws://<page-hostname>:8787` or `wss://<page-hostname>:8787` when the page uses HTTPS. The bundled relay itself is plain HTTP/WebSocket and does not terminate TLS.

The normal Join flow navigates the guest to the host's game-page address as well as connecting its WebSocket. Consequently, that flow depends on reachability of both the game HTTP port and the relay port. The transport can use a separately specified relay URL, but the lobby interface does not offer separate game-server and relay-server fields.

## Lobby and startup flow

`src/phases/title-phase.ts` creates a random six-character lobby code locally. It is a `twoPlayerSession` tag, not a server-side room reservation or lookup key.

Host/Join URLs set the transport, network role, local seat, player count, party size, session tag, and relay URL. Host is P1; guests manually select P2, P3, or the enemy-player seat (`ep`). CPU seats are represented in run configuration. The transport still uses its historical `TwoPlayer` name despite supporting these additional seats.

On connection, clients announce profile data and checkpoints; the host also sends synchronized settings. Profile exchange includes serialized system/profile saves and starter preferences. On run start, the host broadcasts run configuration and a shared RNG seed. Startup repeats profile announcements, and the run waits for required player profiles, with a 15-second wait and retry flow. This is application-level startup coordination, not a relay membership handshake.

Loading a saved run broadcasts a slot ID and seed; each client loads its own corresponding local session. There is no full run-state snapshot transfer in the inspected transport protocol.

## Synchronization contract

`src/two-player-input-transport.ts` combines connection handling with the gameplay protocol:

- Protocol: `pokerogue-2p-local-input`, version `1`.
- Envelope: session ID, sender ID, claimed role, sequence, input seat, button, pressed state, and optional payload/checkpoint.
- Messages: `input`, `input-request`, `input-accepted`, `run-bootstrap`, `title-start`, `settings-sync`, `state-checkpoint`, and `profile-snapshot`.
- Guests request an input; the host validates context and applies it, then broadcasts accepted input. Each client runs its own game simulation. The relay only forwards messages.
- Checkpoints include phase/UI context and a fingerprint of selected shared state: seeds, wave, parties, money, inventory, modifiers, and enemies. They are emitted on connection, phase/input readiness changes, startup, and after inputs (including a 50 ms delayed check).
- Readiness gates compare phase, UI mode, and strict input context; default context grace is 100 ms. Full fingerprint differences are logged as desyncs. The README's description of a universal fingerprint lockout is broader than the current checks.
- The backquote/tilde repair overlay can force local actions. It does not implement automatic state reconciliation.

The current design depends on compatible builds/content, matching initial state, and consistent ordered input delivery. Sequence fields exist, but there is no general acknowledgement, replay, or sequence-gap recovery mechanism. A replacement transport must preserve these assumptions or explicitly add the missing recovery behavior.

## Constraints relevant to additional methods

1. **Shared relay isolation:** `broadcast()` sends every message to every other connected socket. Session IDs are logged by the server but filtered only by clients. A shared public relay would therefore expose profile and gameplay payloads across sessions at the wire level unless server-side routing is added.
2. **Identity and seats:** the relay has no authenticated room membership, host identity, or seat reservation. Roles and seats are client supplied. A lobby code is not access control, and duplicate-seat selection is not rejected by the relay.
3. **Disconnect recovery:** socket close/error clears that client's cached remote checkpoints and logs an event. There is no automatic reconnect, host migration, durable room state, or catch-up replay. The relay does not announce peer departures; other clients can retain old peer checkpoint entries.
4. **Endpoint coupling:** lobby URLs force WebSocket mode and derive the default relay from the page hostname with port 8787. An existing `twoPlayerWsUrl` is preserved even when a host address changes, so an old endpoint can survive into a new lobby link. Changing the server's port environment variable does not automatically change the client URL.
5. **Address handling:** lobby UI labels are IPv4/Hamachi oriented. Address parsing changes hostname and optional port but does not adopt a supplied address's protocol or path. New HTTPS, domain/path-based, or independently hosted endpoint flows need explicit URL handling checks.
6. **Relay robustness:** the relay implements WebSocket framing directly, including fragmented text messages and ping responses. It has no practical configured message-size cap, rate limiting, origin allowlist, or server-initiated heartbeat. Large profile payloads and checkpoint traffic matter when evaluating another carrier.
7. **Recovery versus routing:** making the relay reachable through another route does not by itself add reconnection or resolve simulation desyncs.

## Where future methods would fit

These are code integration boundaries, not evaluated provider recommendations:

| Proposed change | Primary affected area |
| --- | --- |
| Another network route to the existing relay | Address configuration, connection instructions, endpoint reachability |
| Separately hosted/shared WebSocket relay | Lobby URL handling, TLS deployment, server-side rooms and membership, disconnect reporting |
| A different transport | Extract connection/send/receive/status lifecycle from `TwoPlayerInputTransport`; preserve protocol callbacks and input ordering |
| Join by code without entering an address | Add a service or mechanism resolving a code to a session endpoint and seat |
| Reconnect or late join | Add authoritative state transfer or replay, sequence recovery, and peer lifecycle handling |

For each upcoming method, establish its target platforms, endpoint discovery, hosting location, identity/seat model, delivery guarantees, payload limits, and disconnect behavior. Also decide whether guests load assets from the host or retain a locally installed game.

## Source map and diagnostics

All paths below are relative to `pokerogue-beta/` unless stated otherwise.

- `src/phases/title-phase.ts`: lobby creation/join/address helpers around lines 497–885; run startup/load and profile coordination around 1579–1890.
- `src/two-player-input-transport.ts`: protocol types at the top; factory at 420; readiness at 491; send and connection lifecycle at 963; receive/authority handling from 1039 onward.
- `src/ui-inputs.ts`: transport wiring at 104, input routing at 266, debug API at 395, repair hotkey at 480.
- `src/battle-scene.ts`: profile snapshot production/application at 1369/1484, profile waits at 1563, checkpoint summary at 1983. Line numbers reflect the inspected working tree.
- `src/phase-manager.ts`: phase-start checkpoint emission around 418.
- `scripts/two-player-ws-relay.mjs`: entire relay; broadcast routing at 150.
- `desktop/electron/main.cjs`, `scripts/build-desktop-windows.mjs`, `package.json`: runtime startup and packaging.
- `src/ui/handlers/lobby-{ip,join,info}-form-ui-handler.ts`: connection forms.
- Workspace-root `README.md` and `How To Run.txt`: LAN/Hamachi operating instructions; some mode/desync descriptions lag the source.

Use `twoPlayerInputDebug=1` for detailed console logging. `window.pokerogueTwoPlayerInput` exposes `transportStatus()`, `syncStatus()`, `debugEvents()`, `checkpoint()`, `profileReady()`, and manual announcement helpers. Debug events retain the latest 100 entries; relay logs show connected sockets and forwarding counts.

No dedicated relay/transport/lobby-URL tests were found in the test search; title game-mode tests reference the title-start type. Before shipping an added method, validate two/three-player startup, required enemy-player seats, separate profiles, duplicate seats, independent sessions on one relay, relay loss, peer loss, and matching saved-session loading. Live behavior, latency, network/firewall configuration, and the exact distributed executable were not verified in this investigation.
