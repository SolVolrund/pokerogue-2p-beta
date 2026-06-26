# Building the Windows EXE

These steps build the portable Windows desktop version of PokeRogue 2P.

## One-time setup

From `C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta`:

```powershell
corepack pnpm install
```

If Electron or Electron Builder are missing, install them from the same folder:

```powershell
corepack pnpm add -D electron electron-builder
```

## Build the EXE

Run these commands from `C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta`:

```powershell
corepack pnpm build:app
corepack pnpm build:desktop:win
```

The finished portable EXE is copied here:

```text
C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta\desktop-release\PokeRogue2P.exe
```

Each desktop build also creates a timestamped folder under `desktop-release`, such as:

```text
desktop-release\build-1234567890\
```

Those timestamped folders are build output and can be deleted when you no longer need them.

## When to rebuild

Rebuild the EXE after major code, asset, locale, or multiplayer changes. The packaged EXE contains a built copy of the app, so it will not automatically pick up new source changes until you run the build commands again.

For quick browser testing, you can usually skip the EXE rebuild and run the normal dev server instead. For testing the packaged app behavior, rebuild and launch the new `PokeRogue2P.exe`.

## Troubleshooting

If `pnpm` is not recognized, use `corepack pnpm` as shown above.

If `vite` is not recognized during `build:app`, run:

```powershell
corepack pnpm install
```

Then try the build commands again.

If the desktop build appears to pause at `building target=portable`, give it a little time. Electron Builder can sit there while it finishes packaging the portable EXE.
