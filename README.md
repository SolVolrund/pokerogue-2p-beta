PokeRogue 2P LAN Setup
----------------------------------------------------
## Install
1. Unpack the folder into the desired location.
2. Install Node.js from nodejs.org.
3. Open PowerShell inside the pokerogue-beta folder.
----------------------------------------------------
## Run:
corepack enable
$env:COREPACK_HOME = "$PWD\.corepack"
corepack pnpm install
----------------------------------------------------
## Host Over LAN

Open two PowerShell windows inside pokerogue-beta.
----------------------------------------------------
## In the first window, run:
$env:COREPACK_HOME = "$PWD\.corepack"
corepack pnpm run start:dev:lan

Example:
  ➜  Local:   http://localhost:8000/
  ➜  Network: http://[HOST_IP]:8000/
----------------------------------------------------
##In the second window, run:
$env:COREPACK_HOME = "$PWD\.corepack"
corepack pnpm run start:2p-ws:lan

Example:
[relay] listening on ws://0.0.0.0:8787
----------------------------------------------------
## Open a third PowerShell window and run:

ipconfig

Find your local IPv4 address.
this will be used wherever you see [HOST_IP]

Example:
   IPv4 Address. . . . . . . . . . . : 001.002.003.004
----------------------------------------------------
## Host Player

Open the following page in a web browser:
http://localhost:8000
The port may be different. If so, check the other window for   ➜  Local:   http://localhost:XXXX/

Go to:
Multiplayer -> Host
When asked for a LAN address, enter the local IPv4 address from ipconfig.
Record the lobby code the game gives you.

Continue through the text windows until your page refreshes, do not take any further action until player 2 is connected.

-----------------------------------------------------
## Guest Player

Open this in a web browser:
http://[HOST_IP]:8000
Example:
http://192.168.1.45:8000
Go to:
Multiplayer -> Join
Enter the lobby code from the host.

Once your page has refreshed you should lose control of the main menu. at this time player 1 may navigate to new game
------------------------------------------------------

##Avoid Desync

During this process, expect the windows to refresh. Do not move the highlighted menu item until both are synced on the main menu.
