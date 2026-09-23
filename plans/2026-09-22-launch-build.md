# Launch build: Expo shell, website + API + admin, billing (app name: Squiggletale, bundle com.quickgame.squiggletale)

- **Date:** 2026-09-22
- **Status:** done
- **Type:** plan
- **What:** the decided architecture for shipping Squiggletale as an iPad app with a website, a server ledger and billing. Sal: "do everything ... fully featured ... with eas codepush too ... iframe the drawing so we can iterate on it without deploying". Product decisions come from plans/2026-09-22-ipad-app-production.md and plans/2026-09-22-go-to-market.md; this doc is the engineering shape.

## Decisions (settled 2026-09-22)

- **Monorepo, in this repo, no workspaces.** Root stays the studio package (a parallel lab session runs here, so nothing moved). `apps/web` (sal-starter: site, API, admin), `apps/mobile` (Expo), `packages/shared` (dependency-free TS contracts, imported by relative path). Each app installs its own deps.
- **Domain:** onceupon.dested.com (Drydock, kind ssr, Postgres). The studio is served by the website at `/app/`.
- **The studio is one file.** `vite-plugin-singlefile` builds `dist/index.html` (fonts self-hosted via @fontsource, inlined). The website serves it; the Expo app also bundles a copy (`apps/mobile/assets/studio.html`, refreshed by `bun run sync-studio`) for offline bookshelf/replay.
- **WebView, remote first.** The shell loads `https://onceupon.dested.com/app/?shell=native` when online (https = secure context, so the mic works in WKWebView), the bundled copy when offline. Studio changes ship with a web deploy; shell changes ship with EAS Update.
- **Studio <-> server**: `POST /api/app/<name>` JSON endpoints typed by `packages/shared/src/api.ts` (no tRPC across apps; the website's own pages and admin use tRPC). The drawing relay is `POST /api/app/draw` streaming NDJSON. Device auth is an opaque HMAC token in `x-device-token`.
- **Studio <-> shell**: `packages/shared/src/bridge.ts` request/response over `postMessage` / `injectJavaScript`. Stories and voice clips live in native storage through the bridge; on the plain web they stay in localStorage + IndexedDB.
- **Hosted mode** is a build flag (`VITE_HOSTED=1`): relay provider, meter, paywall, parent area. Without it the studio is today's bring-your-own-key app (the lab keeps working).
- **Brand is a placeholder.** `BRAND` in `packages/shared/src/brand.ts` is the only place the name lives (see plans/2026-09-22-app-name.md).
- **Voice**: recorded on the device for every story (MediaRecorder on the mic stream, clips per listening span, stored beside the record). With voice, replay runs in real time (no gap squeeze). Share page voice only for paying devices with consent.
- **Packs**: `packages/shared/src/packs.ts` (40/120/400, Apple product ids `com.quickgame.squiggletale.pack40|120|400`). Free: 120 s first story at registration, 60 s weekly top-up (flags).

## Layout

```
/                       studio (unchanged app) + root docs
  src/backend/          hosted-mode plumbing: bridge, api client, device, meter, relay provider, purchases, share
  src/tutorial/         canned record + coach audio + Tutorial screen
  src/story/voice.ts    VoiceRecorder / VoicePlayer
  src/ui/{ParentGate,ParentArea,Paywall,ShareCard,Offline,SharePlayer}.tsx
apps/web                sal-starter: server/ (api, ledger, relay, ears, apple, stripe, gifts, shares, flags, admin), src/app/ (site + admin pages)
apps/mobile             Expo shell: WebView host, bridge handlers, IAP, EAS config
packages/shared/src     brand, packs, api, bridge
```

## Ports

studio 7710 (lab session owns the running server; use 7711 for a second), web 7720.

## Waves

1. W1a server core · W1b money + shares · W3 admin portal · S1 studio backend plumbing · S3 voice/tutorial/player · M1 Expo shell
2. W2 website pages · S2 studio UI (paywall, gate, parent area, share)
3. root wiring (Dockerfile, drydock.yaml, build scripts), docs, QA gate

## Sal's checklist (things only he can do)

- `apps/web/.env`: DATABASE_URL (local Postgres password), ANTHROPIC/DEEPGRAM/OPENAI keys, Stripe test keys, ADMIN_EMAILS.
- App Store Connect: create the app (bundle id com.quickgame.squiggletale), three consumables, App Store Server Notifications URL, Apple root certs are fetched by the server; `APPLE_APP_APPLE_ID` env.
- `eas build` (development profile first, on a real iPad) and `eas update`.
- Drydock: switch the `onceupon` project from static to ssr with a database; secrets in the portal.
- Stripe webhook endpoint `/api/stripe/webhook`.
