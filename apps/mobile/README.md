# Squiggletale — Expo shell

The iOS-first (iPad) native shell. It is a full-screen WebView that hosts the studio: the hosted
build at `${BRAND.origin}/app/` when online, a bundled single-file copy when offline. All native
capabilities the studio needs (storage, keychain, StoreKit 2 purchases, share sheet, haptics,
AdServices attribution, network state) are implemented behind the shared bridge contract
(`packages/shared/src/bridge.ts`).

Brand values (name, bundle id, scheme, domain, origin) come from `packages/shared/src/brand.ts` —
never hardcode them.

## Layout

```
app.config.ts            Expo config (imports BRAND; Kids category + age band are set in App Store Connect)
eas.json                 EAS Build profiles + submit config
metro.config.js          watches ../../packages/shared, bundles .html
index.ts                 registers the root component
src/App.tsx              picks the studio source, holds the splash
src/StudioWebView.tsx    the WebView host + bridge wiring, remote↔local fallback
src/studio-source.ts     remote vs bundled-offline source selection
src/bridge/host.ts       the bridge dispatcher (unit-tested; handlers injected)
src/bridge/handlers/     one file per capability group (real Expo module wiring)
modules/apple-attribution local Expo module: AAAttribution.attributionToken()
assets/                  icon.png (1024², GPT Image, the crayon-drawing-a-dragon sticker), splash.png (2048², the icon centered on cream), studio.html (synced hosted build)
```

## Install

```sh
cd apps/mobile
bun install
bunx expo install --fix   # aligns native deps to the installed Expo SDK
```

Bun is the package manager for this app; there are no root workspaces. `packages/shared` is imported
by relative path and watched by Metro.

## The offline studio copy

`assets/studio.html` ships as the offline fallback. Refresh it from the latest hosted build:

```sh
# from the repo root: build the single-file hosted studio, then sync it in
bun run build:hosted
cd apps/mobile && bun run sync-studio
```

Until you sync a real build, the placeholder page just shows a crayon and "Loading the storybook".

## Build & release

First-time setup (run once by the architect, not committed here):

```sh
cd apps/mobile
eas init                 # writes extra.eas.projectId; also flows into updates.url
```

Then:

```sh
# development client on a real iPad (there is no simulator profile — StoreKit needs a device)
eas build --profile development --platform ios

# TestFlight / App Store build
eas build --profile production --platform ios

# ship a shell-only JS update to the production channel (no App Store review)
eas update --channel production
```

Studio (web) changes ship with the website deploy. Native shell changes ship with `eas update`
(runtime version policy is `appVersion`, so a native change needs a new build + version bump).

### App Store Connect (Sal / manual)

- Bundle id: `BRAND.bundleId`. Create the app and three consumables
  (`packs.ts` → `appleProductId`s) under it.
- **Kids category** and the age band are set in App Store Connect, not in `app.config.ts`.
- Fill `eas.json` → `submit.production.ios.ascAppId` and `appleTeamId` before `eas submit`.
- App Store Server Notifications URL points at the server's Apple webhook.

## Verify (no Xcode / iOS needed here)

```sh
bunx tsc --noEmit
bunx expo config --type public      # or --type prebuild
bunx expo-doctor
bun test                            # src/bridge/host.test.ts
```
