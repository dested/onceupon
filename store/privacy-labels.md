# Squiggletale 1.0.0: App Privacy answers

Status: draft (store lane, 2026-11-04). The API has no endpoint for these, so Sal clicks them in App Store Connect
→ Squiggletale → App Privacy. Derived from what the code sends: `packages/shared/src/api.ts` (every studio → server
call), `apps/web/prisma/schema.prisma` (what the server keeps), `apps/web/server/**`, `apps/mobile/app.config.ts`
and the privacy page `apps/web/src/app/privacy.tsx` (updated 2026-11-04).

## The click list

1. **Privacy Policy URL**: `https://onceupon.dested.com/privacy` (the store lane sets it through the API; check it shows).
2. **Data Collection** → "Do you or your third-party partners collect data from this app?" → **Yes**.
3. Tick exactly these five data types, then Save:
   - Identifiers → **Device ID**
   - Purchases → **Purchase History**
   - User Content → **Audio Data**
   - User Content → **Other User Content**
   - Usage Data → **Product Interaction**
4. For each one, answer as below. Every type: **Tracking: No**.

| Data type | Purposes (tick only these) | Linked to the user? | Used for tracking? |
| --- | --- | --- | --- |
| Device ID | App Functionality | Yes | No |
| Purchase History | App Functionality | Yes | No |
| Audio Data | App Functionality | Yes | No |
| Other User Content | App Functionality | Yes | No |
| Product Interaction | App Functionality, Analytics | Yes | No |

5. Leave every other type unticked: Contact Info, Health and Fitness, Financial Info, Location, Sensitive Info,
   Contacts, Browsing History, Search History, Identifiers → User ID, Usage Data → Advertising Data and Other Usage
   Data, Diagnostics (all three), Surroundings, Body, Other Data.
6. Publish.

The card then reads: Data Linked to You: Identifiers, Purchases, User Content, Usage Data. Data Used to Track You:
none.

## Why each answer

- **Device ID.** The app makes a random install id and gets a device token at `device.register`; the server keeps
  the device row (balance, minutes history, consent, platform, app version, App Store storefront). It is the
  device's account, so it is linked. Not the advertising identifier: no IDFA, no ATT, no AdServices token in 1.0
  (`src/boot.ts`, decisions 2026-11-04).
- **Purchase History.** `iap.verify` / `iap.restore` send Apple's signed transaction; the server keeps pack,
  amount and Apple transaction ids per device (`Purchase`), kept for accounting.
- **Audio Data.** Only when a grown-up shares a story with voice (`share.create` with `voice`, which needs the
  share-with-voice consent and a paying device). The recording sits on our server with the share for 90 days, or
  until the grown-up takes the link down. Live speech never leaves the device (on-device SpeechAnalyzer /
  SFSpeechRecognizer).
- **Other User Content.** The story's words, as text, go to our server and on to Anthropic to draw
  (`/api/app/draw`, `session.typed`). Our server does not keep them, except words the crayon refused to draw,
  kept masked for 30 days with the device id (`CallLog.skipWords`); Anthropic deletes them within 30 days. A shared
  story's drawing and masked words stay with the share. Both outlive the request, so this counts as collected.
- **Product Interaction.** Story sessions (start, end, reason, seconds charged) and a row per drawing request
  (time, tokens, cost, latency, no words), kept 180 days per device. They meter minutes (App Functionality) and
  feed the admin cost and usage dashboards (Analytics, first-party only).

## Not collected, and why

- **Location.** No location API. The App Store storefront (country code) is stored with the device for pricing;
  it is not location. IP addresses are used in memory for rate limits and not stored.
- **Contact Info.** The app asks for no name, email or phone. Gift codes bought with an email are on the website
  (Stripe), not in the app; the app hides gift codes in 1.0.
- **Diagnostics.** No crash reporter or analytics SDK. Request timings are measured on our server.
- **User ID.** No accounts.
- **Photos or Videos.** "Save video" writes to Photos with add-only access; nothing is read or uploaded.

## What the privacy page must keep saying (it does today)

- Speech stays on the device; the recording leaves only when a grown-up shares with voice.
- Words go as text through our server to Anthropic, after a grown-up's yes; no audio, name, account, device
  identifier or location with them; Anthropic doesn't train on them and deletes them in 30 days.
- Refused words kept masked 30 days; drawing-request records 180 days; device row until 18 months idle with a
  zero balance; purchases for accounting; shares 90 days; backups 30 days.
- No accounts, no advertising, no third-party analytics.

## Expo

EAS Update is off from 8912f86 (build 2), so nothing goes to Expo at launch: no Expo line on the privacy page or
in the labels (lead, 2026-11-04).
