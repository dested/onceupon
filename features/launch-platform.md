# Launch platform: hosted studio, device ledger, packs, sharing, Expo shell

- **Status:** done, first cut (2026-09-22; phone and tablet layouts verified in the browser; not yet built on a device or deployed: see Open questions)
- **Owner files:** `packages/shared/src/*` (contracts), `src/backend/*` (studio hosted mode), `src/story/{storage,storage-backend,idb,voice,session}.ts`, `src/ui/{ParentGate,ParentArea,Paywall,ShareCard,MinutesChip,Offline,SharePlayer}.tsx`, `src/tutorial/*`, `apps/web/server/*`, `apps/web/src/app/*`, `apps/mobile/*`

## What it is

Everything between the bring-your-own-key studio and a Kids-category iPad app that sells story
minutes: a server that holds the model keys and the minutes ledger, an anonymous device account
per install, packs bought through StoreKit 2 or Stripe, gift codes, share links with the child's
voice, a first-launch tutorial, an admin portal, and an Expo shell that shows the hosted studio.

## Behavior spec

Studio (hosted mode, `VITE_HOSTED=1`; unchanged otherwise):
- On boot the studio registers the device (`installId` from the shell or localStorage) and receives an opaque token, its balance, the server config (model, ears vendor, URLs, silence timings) and extra mask words. Boot never waits more than 8 s on the network; offline, the bookshelf and replay work and the mic dock says the crayon needs the internet.
- The first mic tap on a device runs the grown-up gate (a spoken-number sum) before the microphone permission prompt. Every purchase, link-out and share also runs the gate.
- Tapping the mic opens a story session on the server; the server mints a short-lived ears token (Deepgram grant or OpenAI client secret) whose TTL never exceeds the balance, and the studio streams audio straight to the vendor. Drawing calls go through `POST /api/app/draw`, which relays Sonnet and logs every call.
- While the mic is open the studio sends a beat every 15 s with the mic-open milliseconds; the server debits whole seconds. Below 60 s left the crayon "gets sleepy" (chip turns coral, the end reminder shows the time left). At zero the server answers `exhausted`, the studio ends the story with the finale (reason `sleepy`) and the closing card becomes the paywall.
- Listening with no words for 90 s shows "say The End when you're done" and plays coach line 4; at 3.5 min the story ends itself (reason `silence`).
- The child's voice is recorded on the device for every listening span (MediaRecorder) and stored beside the record; replay and the mp4 play it in real time (no gap squeeze when a story has voice).
- The parent area (behind the gate) shows the balance, the next weekly top-up, buy (StoreKit 2 in the shell, the web shop on the web), restore, gift-code redeem, the 8-character family code for the web shop, the share-with-voice consent toggle (paying devices only, with the notice), the shares list with unpublish, the tutorial replay, mic and sound settings, and the privacy/terms/support/delete links.
- After The End the closing card offers "Send to grandma": optional first name, include voice when consented, a link at `/s/<id>` (90 days), the share sheet or clipboard, and the mp4 download (share sheet in the shell).
- First launch plays the tutorial: the bundled dragon story replayed through the real engine with four spoken coach lines; skippable; replayable from the parent area.

Server (`apps/web`):
- Free allowance: 120 s at registration (first story), then a weekly top-up to 60 s on the refill day; both are flags. A reinstall (same installId) rotates the token and keeps the balance.
- Purchases credit the ledger only from a verified StoreKit 2 JWS (dedup on transaction id), a paid Stripe Checkout session, or a redeemed gift code; App Store Server Notifications refunds debit and raise an alert. Every balance change is a ledger entry.
- Caps: sessions per device per day, a daily cost cap per device on the relay, daily spend alert, relay error-rate alert.
- Shares store a masked record (title, words, child name through the masker), an optional cover and one voice file; unlisted 12-char ids; a nightly-ish job deletes expired and unpublished shares and closes stale sessions.
- Admin at `/admin` (better-auth, allow-listed emails): overview, usage, ledger (search, adjust, block, reset free story), revenue, costs, shares, kid-safety (skips, mask words), settings (flags + kill switches), alerts, audit.

Website: landing with the tutorial story playing in the storybook frame, how it works, pricing, shop (pack checkout by family code), gift (code + printable card), redeem, FAQ, support, terms, privacy with a children's section, delete-my-data, share pages with OG tags.

Shell (`apps/mobile`): full-screen WebView on the hosted studio (`/app/?shell=native`), bundled copy offline with automatic fallback; the bridge implements storage, key-value, StoreKit 2 (expo-iap, JWS = `purchaseToken`), share sheet, open URL, haptics, AdServices attribution (local Swift module), network state. EAS project `@quickgame/squiggletale`; updates on the `production` channel.

## Design notes

- Contracts first: `api.ts` and `bridge.ts` are the only agreements between the three apps; both sides validate envelopes with zod at the boundary.
- The relay takes the prompt blocks the studio's dialect builds (system + cached story chunks), so prompt caching is org-wide and the server never has to know the DSL.
- Money never comes from the client: only verified receipts, webhooks and codes credit the ledger.

## Open questions

- Real-iPad mic spike inside WKWebView on the hosted origin (first `eas build --profile development`).
- Apple App Store Connect: app record, three consumables, notification URL, Kids questionnaire.
- Domain: squiggletale.app is unbought; `BRAND.origin` flips when it is pointed.
