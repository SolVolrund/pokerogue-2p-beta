# Pokemon Sprite Viewer

This is a local preview helper for PokeRogue-style TexturePacker sprite atlases.

Run it from the repository root:

```powershell
node sprite-work/sprite-viewer/server.mjs
```

Then open:

```text
http://127.0.0.1:8787
```

The default folders are:

```text
pokerogue-beta/assets/images/pokemon
pokerogue-beta/assets/images/pokemon/back
```

The viewer reads the atlas JSON, loads the PNG named by that JSON, and animates
numbered frames in the same 1-400 order the game requests. The default speed is
10 FPS, matching the Pokemon sprite animation setup in the game code.

Use **Export GIF** to save the currently selected sprite animation as a GIF. It
uses the current FPS and scale controls. The ghost previous-frame overlay is
preview-only and is not included in the exported GIF.

Optional startup arguments:

```powershell
node sprite-work/sprite-viewer/server.mjs --port 8790 --front "C:\path\to\front" --back "C:\path\to\back"
```
