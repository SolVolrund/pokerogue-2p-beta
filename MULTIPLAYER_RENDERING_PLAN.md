# Multiplayer Rendering Plan

## Goal

Prefer local rendering on both machines:

- Host and guest both run the PokeRogue client.
- Each machine renders its own scene locally.
- Player input is accepted only from the player currently in control.
- The host remains authoritative for game state.

Fallback option:

- Host renders the game.
- Guest receives a streamed view of the host canvas.
- Guest sends input back to the host.

## First Scaffold

Implemented first local-render hook:

- `?twoPlayerLocalPlayer=1` makes the browser accept only Player 1-owned local input.
- `?twoPlayerLocalPlayer=2` makes the browser accept only Player 2-owned local input.
- Omitting the flag keeps current local testing behavior, where one browser can control both players.
- `globalScene.uiInputs.processRemoteInput(playerIndex, button)` injects a host-approved remote button into the same normalized UI path used by keyboard/gamepad/touch.
- `?twoPlayerInputTransport=local` enables same-browser tab-to-tab input messages through `BroadcastChannel`.
- `?twoPlayerInputTransport=websocket` enables browser-to-browser input messages through the local/LAN WebSocket relay.
- `?twoPlayerWsUrl=ws://127.0.0.1:8787` selects the relay URL for WebSocket mode.
- `?twoPlayerInputDebug=1` enables console/debug-history logging for accepted, rejected, sent, received, and ignored input messages.

This uses the existing `inputOwner` state:

- `0` means Player 1 is in control.
- `1` means Player 2 is in control.
- `"both"` means shared input is allowed.
- `"none"` means no ownership has been assigned, so local input is allowed.

## Local Rendering Architecture

### Host

- Owns the authoritative run state.
- Loads local Player 1 system save.
- Receives guest Player 2 system save during connection.
- Accepts P1 input locally.
- Accepts P2 input from the guest only when `inputOwner === 1` or shared input is allowed.
- Broadcasts accepted inputs and/or state checkpoints.

### Guest

- Loads local Player 2 system save.
- Sends that save to the host during connection.
- Accepts local controls only when `inputOwner === 1` or shared input is allowed.
- Sends normalized button inputs to the host.
- Renders locally from host-approved state.

## Input Shape

Do not send raw keyboard or gamepad keys over the network.

The existing input layer already normalizes devices into `Button` values:

- `UP`
- `DOWN`
- `LEFT`
- `RIGHT`
- `ACTION`
- `CANCEL`
- etc.

Network input should send those normalized buttons plus ownership context:

```ts
interface MultiplayerInputMessage {
  playerIndex: 0 | 1;
  button: Button;
  inputOwner: 0 | 1 | "both" | "none";
  sequence: number;
}
```

The host should reject messages where `playerIndex` does not match the current accepted owner.

## Current Debug Hook

For local testing before a network transport exists, the browser exposes:

```ts
window.pokerogueTwoPlayerInput.press("p2", "ACTION");
window.pokerogueTwoPlayerInput.press("p2", "DOWN");
window.pokerogueTwoPlayerInput.release("p2", "STATS");
window.pokerogueTwoPlayerInput.transportStatus();
window.pokerogueTwoPlayerInput.debugEvents();
window.pokerogueTwoPlayerInput.clearDebugEvents();
```

Accepted player labels:

- `"p1"`, `"player1"`, `"host"`, `1`
- `"p2"`, `"player2"`, `"guest"`, `2`

The debug hook still obeys `inputOwner`, so a P2 injected input will be ignored when Player 1 owns the prompt.

## Current Local Transport

For two local windows/tabs in the same browser profile:

```text
http://127.0.0.1:5173/?twoPlayer=1&twoPlayerLocalPlayer=1&twoPlayerInputTransport=local&twoPlayerSession=test&twoPlayerInputDebug=1
http://127.0.0.1:5173/?twoPlayer=1&twoPlayerLocalPlayer=2&twoPlayerInputTransport=local&twoPlayerSession=test&twoPlayerInputDebug=1
```

Both pages must use the same `twoPlayerSession` value.

Behavior:

- P1-local accepted buttons broadcast as P1 remote input to the P2 tab.
- P2-local accepted buttons broadcast as P2 remote input to the P1 tab.
- Inputs from the wrong owner are ignored before broadcast.
- Received inputs still pass through `processRemoteInput(...)`, so ownership is validated again on receipt.
- When debug is enabled, each tab keeps the last 100 input debug events.

## Current WebSocket Transport

Start the relay in a separate terminal:

```powershell
cd "C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta"
corepack pnpm run start:2p-ws -- --host 127.0.0.1 --port 8787
```

Same-machine test URLs:

```text
http://127.0.0.1:5173/?twoPlayer=1&twoPlayerLocalPlayer=1&twoPlayerInputTransport=websocket&twoPlayerWsUrl=ws://127.0.0.1:8787&twoPlayerSession=test&twoPlayerInputDebug=1
http://127.0.0.1:5173/?twoPlayer=1&twoPlayerLocalPlayer=2&twoPlayerInputTransport=websocket&twoPlayerWsUrl=ws://127.0.0.1:8787&twoPlayerSession=test&twoPlayerInputDebug=1
```

LAN test shape:

```powershell
corepack pnpm run start:2p-ws -- --host 0.0.0.0 --port 8787
corepack pnpm exec vite --mode development --host 0.0.0.0 --port 5173
```

Then use the host computer's LAN IP in both URLs:

```text
http://HOST_LAN_IP:5173/?twoPlayer=1&twoPlayerLocalPlayer=1&twoPlayerInputTransport=websocket&twoPlayerWsUrl=ws://HOST_LAN_IP:8787&twoPlayerSession=test&twoPlayerInputDebug=1
http://HOST_LAN_IP:5173/?twoPlayer=1&twoPlayerLocalPlayer=2&twoPlayerInputTransport=websocket&twoPlayerWsUrl=ws://HOST_LAN_IP:8787&twoPlayerSession=test&twoPlayerInputDebug=1
```

The relay only forwards input messages. It is not authoritative yet, and it does not sync game state.

## Why Local Rendering Is Harder Than Streaming

PokeRogue currently mutates game state while it animates phases. That means local rendering cannot simply say "guest clicked Tackle" and let both clients free-run forever unless they stay perfectly deterministic.

To keep local rendering stable, we likely need one of these:

1. Host-authoritative input replay:
   - Host accepts valid input.
   - Host broadcasts the accepted input with a sequence number.
   - Both clients apply the same accepted input.

2. Host-authoritative state checkpoints:
   - Host accepts valid input.
   - Host advances the game.
   - Host sends state snapshots at safe phase boundaries.
   - Guest applies snapshots and renders from there.

The practical version is probably a hybrid:

- Replay accepted inputs for normal menu movement and choices.
- Send checkpoints after major choices, wave changes, battle starts/ends, captures, rewards, and mystery encounter branches.

## Streaming Fallback

If local rendering becomes too brittle, streaming is simpler:

- Host captures the canvas with `HTMLCanvasElement.captureStream()`.
- WebRTC sends the canvas stream to the guest.
- Guest sends normalized button input back to the host.
- Only the host runs the game simulation.

This avoids desync entirely, but has higher latency and gives the guest a streamed image rather than a true local render.

## Suggested Next Steps

1. Add a debug page/session mode for `host` and `guest` roles.
2. Add a transport-neutral multiplayer session object.
3. Add a local loopback transport for testing without networking.
4. Add remote button injection through the existing normalized `Button` path.
5. Add sequence numbers and owner validation.
6. Add state checkpoint messages at safe boundaries.
7. Only then add WebSocket or WebRTC transport.
