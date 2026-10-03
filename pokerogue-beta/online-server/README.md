# Local Online multiplayer implementation

This first version runs on your Windows computer. No SSH connection, Debian installation, DNS change, or firewall change is needed for this stage.

## 1. Install the service dependency

In PowerShell, from the game folder:

```powershell
cd "C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta"
npm.cmd ci --prefix online-server --ignore-scripts
```

Node must satisfy the project's requirement (24.9 or newer). The service uses the maintained [`ws` WebSocket library](https://github.com/websockets/ws), with a separate package lock so deployment does not require the game's asset folder or development dependencies.

## 2. Start the lobby service

```powershell
npm.cmd run start:online
```

Leave that terminal open. It should print `Online lobby service: http://127.0.0.1:8788`. This listens only on this computer. Ctrl+C stops it and clears its temporary lobbies.

In another PowerShell window, check it:

```powershell
curl.exe --noproxy "*" http://127.0.0.1:8788/health
```

Expected: `ok: true`, protocol `pokerogue-online-v1`, build ID `local-dev-v4`.

## 3. Start the game

In a second terminal, from the same game folder:

```powershell
npm.cmd run start:dev:large
```

If your usual development server is already running on port 8000, use that instead. Open `http://127.0.0.1:8000/`. Development defaults to the local service above. Public builds have no service address until explicitly configured.

## 4. Try a two-player lobby

1. Set a name through **Player Name** on the title screen.
2. Choose **Multiplayer → Online → Host Game → 2P → Create Lobby**.
3. The game reloads into the host seat. The status bar lists required seats; controls wait for the other player.
4. Open another game tab at the clean address `http://127.0.0.1:8000/` (do not copy the host's URL or duplicate its tab).
5. Choose **Multiplayer → Online → Join Game**, select the host, and confirm **P2**.
6. Once both games reach the title screen, the host can choose **New Game → Classic → 2P** (Co-op) or **P.Vs.P**. The selected lobby determines player count, EP availability, and team size; the host chooses the compatible run mode at this step.
7. Use **Leave lobby** in the status bar to return that tab to ordinary play. The remaining player is told that the connection ended.

After starter selection, only the host selects a personal save slot and confirms any overwrite. Guests, including EP, use a reserved local guest autosave outside the five personal slots. They wait until the host confirms and every seat is ready; no client enters the battle early. Host slot navigation is private and cancellation returns everyone to the title screen. The old host save is retained until the new run actually autosaves. Startup times out after two minutes of waiting for slot confirmation/readiness; a disconnect also closes the lobby.

Tabs at the same origin share the saved local profile/name. For distinct names and independent saves, use two browser profiles or a private window. Membership credentials are tab-specific. All players should use the same game files. Online does not require port 8787 or the old LAN relay.

Repeat with 3P, 1P + EP, 2P + EP, or 3P + EP as needed. Every configured human seat must connect before title controls unlock. P1 belongs to the host; 2P + CPU remains unavailable. EP does not upload its own player profile, matching the existing game transport.

| Lobby seats | Available run modes |
| --- | --- |
| P1 + P2 | `2P` (Co-op), `P.Vs.P` |
| P1 + P2 + P3 | `3P` (Co-op), `P.Vs.P.Vs.P` |
| P1 + EP | `P.Vs.EP` |
| P1 + P2 + EP | `2P.Vs.EP` |
| P1 + P2 + P3 + EP | `3P.Vs.EP` |

The service records the chosen mode and the directory displays it once the run starts. Seats cannot change when selecting a mode. CPU vs EP remains a solo mode, and Online Daily runs remain unavailable.

## 5. Continue or load an existing run

Update `server.mjs`, restart the lobby service, and refresh/rebuild every client after this update. The default build ID is now `local-dev-v4`; older clients/services cannot join the updated ones. If your service or build environment explicitly sets `ONLINE_BUILD_ID` / `VITE_ONLINE_BUILD_ID`, update both to the same new ID too. Create a fresh lobby. The new-run ready/commit messages require the updated service; updating only the game is insufficient.

1. The host must have the saved run. Create a lobby matching its player count, EP setting, and team size (3 or 6). A human-only 2P/3P lobby can resume either Co-op or Vs; the saved run determines the mode.
2. Connect every required seat and wait for the title controls to unlock.
3. On the host, choose **Continue** for the last saved slot, or **Load Game** to pick another. If no last slot is known, Continue opens the slot browser.
4. Only the host browses slots. The service sends the host's actual saved run to everyone; guests do not need a matching local save or slot number.
5. Guests, including EP, do not need any empty personal slots. The host keeps the selected slot; guests use the reserved local guest autosave for subsequent autosaves. The five personal slots are never overwritten by joining a run. Independent browser profiles are best for testing separate players' saves.
6. The game refreshes player profiles, restores the shared save, and verifies the transferred bytes and restored gameplay summaries. Play resumes only after every seat acknowledges the same state. Local progression profiles are not replaced with the host's profile.

A mismatched save is rejected before restoration; dismiss the message to return everyone to the title menu. CPU saves, Vs saves in EP lobbies, and older saves missing per-player parties are not supported. If a player cannot restore the save, disconnects, or times out, the lobby closes without starting the run. The status bar retains the reason; use **Leave lobby**, resolve it, and create another lobby. Shared saves are limited to 3 MiB and are relayed in memory, not stored on the service.

The guest autosave uses the local `guestSessionData_<profile>` key (internal slot ID 5), is excluded from ordinary Continue/Load, and is never sent to the account session-slot API. Permanent Pokédex/profile progress still saves independently. A failed/cancelled startup leaves the previous guest autosave intact; successful gameplay replaces it on autosave. Leaving/disconnecting retains the copy, while normal run completion clears it. To resume, rejoin a host who has the run in a personal slot. There is no guest recovery/export menu yet. Existing multiplayer saves in personal slots are left untouched; this update does not migrate or delete them.

## 6. Verify failures

- Two clients claiming the same seat: exactly one succeeds; the other refreshes and chooses another seat.
- Two separate lobbies: their gameplay messages stay separate.
- Host still loading: lobby is greyed out until its initial title menu is ready.
- Host starts navigating after everyone connects: lobby locks; no late joins.
- Service unavailable: directory clears stale listings, reports unavailable, and Back still works. LAN remains available independently.
- Player disconnects: the entire lobby closes. There is no mid-run reconnection/state recovery yet.
- Reserved guest never connects: its seat becomes available after two minutes. An absent host removes the lobby.

Automated checks:

```powershell
npm.cmd run test:online
```

Focused automated tests cover lobby operations, compatible Co-op/Vs/EP choices, shared-save transactions, actual game save restoration (including Vs token purchase state), private host slot navigation, and failure reporting. The original two-tab browser check covered creating a 2P lobby, finding it in the directory, joining P2, both clients reaching starter selection, relaying a selection movement, and leaving/closing the lobby. Continue/Load have also been confirmed working through manual testing. The new Online Vs flow, full battles, EP gameplay, and connections over the internet still need playtesting.

## How the pieces fit

- `server.mjs`: HTTP directory/create/join endpoints, seat reservations, build checks, WebSocket authentication, heartbeat, cleanup, and per-room relay.
- `src/utils/online-lobby-client.ts`: requests, tab membership storage, launch URLs, and local connection/leave controls.
- `src/ui/handlers/online-lobby-ui-handler.ts`: refreshes listings every two seconds and submits the selected seat.
- `src/phases/title-phase.ts`: creates lobbies, keeps new-run settings consistent, and coordinates shared saved-run restoration.
- `src/utils/online-save-session.ts`: saved-run compatibility, hashing, and the per-tab bridge between the title menu and its authenticated socket.
- `src/two-player-input-transport.ts`: authenticates before exchanging existing multiplayer messages and waits for all seats to reach the title screen.

The service validates each reserved seat and assigns sender identity/role. It is not an authoritative game simulation or an account/login service. Profiles and input messages are relayed but not stored on disk. Names are display names, not unique authenticated accounts.

## Current limits and the next server stage

This is a local development milestone. Online Continue/Load use the host's save and require matching lobby settings. Lobby state exists only in memory; restarting the service closes rooms. Disconnecting or refreshing a connected game requires a new lobby. Saved-run verification and the initial title screen check do not replace the game's existing synchronization checks during a run.

The default `local-dev-v4` build ID is an explicit development label, not an automatic source/assets fingerprint. Before distributing builds, set **the same unique release ID** in `VITE_ONLINE_BUILD_ID` (game build) and `ONLINE_BUILD_ID` (service); change it whenever synchronization-relevant game content changes. If you configured a custom ID for the previous version, change it for this update as well.

Later Debian deployment needs only this service folder, Node, a dedicated service user, systemd, and an HTTPS/WSS reverse proxy. Configure a game service domain independently of the Proxmox management address. Keep the Node listener on loopback behind the proxy, set `ONLINE_ORIGINS` to the approved game origins, add public-facing request limits, and set `VITE_ONLINE_SERVICE_URL` to the HTTPS service address when building the game. Then test from two different internet connections. No deployment or public exposure is performed by these local steps.

Configuration:

| Setting | Default | Purpose |
| --- | --- | --- |
| `ONLINE_HOST` | `127.0.0.1` | Service bind address |
| `ONLINE_PORT` | `8788` | Service port |
| `ONLINE_ORIGINS` | `http://localhost:8000,http://127.0.0.1:8000` | Comma-separated allowed browser origins |
| `ONLINE_BUILD_ID` | `local-dev-v4` | Accepted game release ID |
| `VITE_ONLINE_SERVICE_URL` | Local URL in development; absent otherwise | Game's service address |
| `VITE_ONLINE_BUILD_ID` | `local-dev-v4` | Game release ID, compiled by Vite |

Restart the relevant process after changing environment variables. Use no server passwords or SSH credentials in game configuration.
