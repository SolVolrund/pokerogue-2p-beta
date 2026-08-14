# Building the Android App

These steps build the Android shell for PokeRogue 2P. The Android app packages the same Vite-built game used by the desktop app, so single-device play and the existing touch overlay are the first milestone.

## One-time Setup

From `C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta`:

```powershell
corepack pnpm install
corepack pnpm exec cap add android
```

The Android project is created in:

```text
C:\Users\Daniel\Documents\PokeRogue 2P\pokerogue-beta\android
```

## Build and Sync Web Assets

Run this after game, asset, locale, or Android wrapper changes:

```powershell
corepack pnpm build:android
```

This runs the app-mode Vite build, then copies the built `dist` output into the Android project.

## Open in Android Studio

```powershell
corepack pnpm open:android
```

From Android Studio, build or run the app on an emulator or connected Android device.

## Current Scope

The initial Android build targets single-machine modes first:

- single-player
- local two-player/three-player on one device
- CPU partner modes
- touch overlay controls
- local saves/import/export

LAN multiplayer will need a native Android relay and LAN address helper. Online multiplayer should use a hosted secure WebSocket relay rather than a phone-hosted relay.

## Local Tooling Notes

Building the native APK requires a JDK and the Android SDK. Android Studio's bundled JDK is fine as long as `JAVA_HOME` points to it, or `java` is available on `PATH`.

The first Android milestone intentionally keeps multiplayer networking out of the native shell. The only Android network permissions currently added are `INTERNET` and `ACCESS_NETWORK_STATE`; LAN hosting will add the native relay and any cleartext LAN WebSocket configuration in a later pass.
