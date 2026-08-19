# NEW INSTRUCTIONS

---

### Install

1. Acquire the latest exe build.
2. Acquire 7zip
3. Acquire Hamachi
4. Right click the PokeRogue2P.exe file, select 7Zip -> open archive
5. Open $PLUGINSDIR
6. Open app-64.7z
7. Create a desktop folder for Pokerogue2P (or wherever you wish to place it)
8. Extract all files within app-64.7z into this new directory.

NOTE: Steps 4 through 8 will bypass long load times caused by using the outer exe. The purpose of the outer exe was to save permanent disk space by instead unpacking into temp memory each launch, but it ended up being too slow.
---

### Hosting

1. Obtain your IPv4 Address
2. Create a hamachi network
3. Obtain your Hamachi network IPv4
4. Launch the game
5. Navigate to [Multiplayer]
6. Select your preferred game mode (Host 2p+1c currently nonfunctional)
7. Enter your IPv4 when prompted
8. Record your Lobby ID
9. Enter the lobby
10. Send P2 and P3 the Lobby Id and your host/hamachi IP (if on local lan, local IP, if on hamachi, hamachi IP)
11. Wait for connections. You will lose control of your game until all players have connected.

---

### Joining

1. Determine if you are P2 or P3
2. Navigate to [Multiplayer]
3. If you are player 2 select Join as 2p, if you are player 3. (do not both join as the same player, it will not work)
4. Enter the Lobby ID and host/hamachi IPv4 which the host should have given you.
5. wait for your game to refresh and for all players to be connected.

---

### Starting a Run

1. After all players are connected, the host should regain control. Navigate to New game.
2. Select your game mode, classic or daily
3. Select player count. 

---

### Desync Protection

This game contains a fingerprint lockout feature.
If the game detects desync it will lock all input out to prevent further drift. This lockout can be navigated using the ~ key.
Pressing ~ will bring up the desync menu. From here any key input you make will force through the fingerprint lockout system. Do your best to advance each player to the next resynced menu.
This most often occurs when one client skips past dialogue faster than the other clients.

If the run becomes desynced in a way which the menu cannot rectify, exit the run, go to Save Data, [Export Run] on the hosts machine.
You can then send the run file to the other players, then navigate everyone to [Import Run] and have everyone import it. This should resync the run.






OLD INSTRUCTIONS

# PokeRogue 2P LAN Setup

---

## Install

1. Unpack the folder into the desired location.
2. Install Node.js from nodejs.org.
3. Open PowerShell inside the `pokerogue-beta` folder.

---

## Run

```powershell
corepack enable
$env:COREPACK_HOME = "$PWD\.corepack"
corepack pnpm install
```

---

## Host Over LAN

Open two PowerShell windows inside `pokerogue-beta`.

---

## In the First Window, Run

```powershell
$env:COREPACK_HOME = "$PWD\.corepack"
corepack pnpm run start:dev:lan
```

Example:

```text
➜  Local:   http://localhost:8000/
➜  Network: http://[HOST_IP]:8000/
```

---

## In the Second Window, Run

```powershell
$env:COREPACK_HOME = "$PWD\.corepack"
corepack pnpm run start:2p-ws:lan
```

Example:

```text
[relay] listening on ws://0.0.0.0:8787
```

---

## Find Your Host IP Address

Open a third PowerShell window and run:

```powershell
ipconfig
```

Find your local IPv4 address.

This will be used wherever you see `[HOST_IP]`.

Example:

```text
IPv4 Address. . . . . . . . . . . : 001.002.003.004
```

---

## Host Player

Open the following page in a web browser:

```text
http://localhost:8000
```

The port may be different. If so, check the other PowerShell window for:

```text
➜  Local:   http://localhost:XXXX/
```

Go to:

```text
Multiplayer -> Host
```

When asked for a LAN address, enter the local IPv4 address from `ipconfig`.

Record the lobby code the game gives you.

Continue through the text windows until your page refreshes. Do not take any further action until Player 2 is connected.

---

## Guest Player

Open this in a web browser:

```text
http://[HOST_IP]:8000
```

Example:

```text
http://192.168.1.45:8000
```

Go to:

```text
Multiplayer -> Join
```

Enter the lobby code from the host.

Once your page has refreshed, you should lose control of the main menu. At this time, Player 1 may navigate to New Game.

---

## Avoid Desync

During this process, expect the windows to refresh.

Do not move the highlighted menu item until both players are synced on the main menu.
