# Once Upon as a free iPad app with minute packs

- **Date:** 2026-09-22
- **Status:** active
- **Type:** analysis
- **What:** the economics of selling story minutes, the shell to ship it in, and everything between the current keyless static build and an App Store listing. Interactive calculator: https://claude.ai/artifact/UsDKjgAu58zZDE4L7BUjAx

## What a minute costs (locked 2026-09-22)

Calculator: `plans/2026-09-22-pricing-model.html` (open in a browser; the artifact link above is the same page). Locked inputs: Sonnet 5, ops dialect, 8 beats a mic minute, 470 output tokens a beat (measured: 942 for two sentences), 300-token scene snapshot, 30% early restarts, 8-minute sessions, Deepgram Nova-3 streaming ears at $0.0077, 40-minute pack at $9.99, Apple 15%, free tier 10 s/day with 1,000 daily free users of whom 30% use it all, 980 packs a month, 65% of bought minutes used.

| Line                                                   | $ / min    |
| ------------------------------------------------------ | ---------- |
| Drawing output tokens (Sonnet $10/MTok)                | ~0.040     |
| Drawing input (cached system + scene snapshot + story) | ~0.028     |
| Ears, Deepgram Nova-3 streaming                        | 0.0077     |
| **All in**                                             | **~0.075** |

| Unit economics                          | $         |
| --------------------------------------- | --------- |
| 40-minute pack, cost to serve in full   | 3.02      |
| Same pack at 65% of minutes used        | 1.96      |
| Net of $9.99 after Apple's 15%          | 8.49      |
| Margin per pack (served in full)        | 5.47      |
| Free tier per month (10 s/day, 1,000 DAU, 30% use it) | 113 |

A month at 980 packs: revenue $9,790, Apple $1,469, serving sold minutes $1,922, free tier $113, gross profit ~$6,290 before Apple's $99, the server, RevenueCat or receipt validation, support and refunds.

- Output tokens are about half the bill. JSON ops (~1,580 tokens/beat measured on Sonnet) would double the crayon line; Lines (~220) halves it again at a worse picture.
- Ears: Deepgram Nova-3 streaming $0.0077 list ($0.0048 promo); OpenAI gpt-live-transcribe is $0.017 (the app's old flat $0.006 was wrong for it); AssemblyAI $0.0025; Apple on-device free but native only. Deepgram is in behind a flag (plans/2026-09-22-deepgram-ears.md) for the kid-speech A/B.
- The free tier at 10 s/day is a demo, not a story; at these inputs it is a rounding error, so the free experience can be more generous than the ledger suggests. Size it from expected free DAU.

## Shell: Expo app, the crayon in a WebView

Recommended. The engine is Canvas 2D + Web Audio + WebSocket + fetch streaming, all of which WKWebView runs; rewriting it in Skia buys nothing. Bundle the Vite build into the app (not a remote URL: review dislikes wrappers around a website, and offline start matters), load it through the WebView, and talk to native over the bridge for purchases, balance and the parental gate.

Day-one spike, before anything else: on a real iPad build (not Simulator, not Expo Go), does `getUserMedia` + `AudioWorklet` + a `wss://` socket work from the bundled origin? WKWebView needs `NSMicrophoneUsageDescription`, `mediaCapturePermissionGrantType="grant"`, and a secure-context origin (a `file://` load may leave `navigator.mediaDevices` undefined; serve from a custom scheme or Expo's DOM-component loader if so). If the mic inside the WebView is flaky, move ears native: capture PCM with expo-audio, open the STT socket from native, post transcript results into the WebView; the Director and Stage do not change. Native ears also unlock Apple's free on-device recognizer.

## The backend (the keyless static build cannot ship)

New `server/` on the sal-starter stack (Bun, tRPC, Postgres + Prisma):

- **Keys move server-side.** The Anthropic call becomes a streaming tRPC route (or a plain streamed fetch) that takes the user blocks the Director already builds and relays Sonnet's stream. Prompt caching gets better, not worse: the cache is org-scoped, so every user shares the system-prompt cache entry.
- **Ears stay a direct socket, with minted tokens.** OpenAI Realtime issues ephemeral client secrets; Deepgram has short-lived grant tokens (`/v1/auth/grant`). The server mints one per listening session with a TTL no longer than the remaining balance, so audio never flows through your box and a leaked token is worth minutes, not a key.
- **The server is the ledger.** Anonymous device account (no sign-in for a kids app; device token + App Attest to deter abuse; restore via StoreKit on reinstall). Balance in seconds. A listening session opens with a start event, heartbeats every 15 s, closes on stop/background; the server debits wall-clock mic time and refuses to mint tokens or stream drawings when the balance is gone. Client shows a soft "the crayon is getting sleepy" at one minute left.
- **Free allowance** is a server-side grant per device: the first story free (up to 3 min, once), then 60 seconds a week refilled on a fixed weekday; never enforced client-side.
- **Purchases**: three consumable products (`minutes_40`, `minutes_120`, `minutes_400`), no subscription. Receipt validation server-side via the App Store Server API (JWS transactions, `@apple/app-store-server-library`) or RevenueCat, whose virtual-currency feature is literally a minutes balance and handles refunds/restores. RevenueCat is the faster path; own validation is one fewer vendor. Either way credit the balance from the server, never from the client.
- Spend alerts on Anthropic and the STT vendor; per-device daily caps; Sentry without PII (allowed in Kids apps only if no identifiers leave the device).

## App Store, Kids category

- **Made for Kids** (age band 5 and under, or 6-8) means guideline 1.3: no third-party ads or analytics, a **parental gate** before any purchase, link-out, or permission request (the mic prompt included), and nothing identifying a child leaves the device. Privacy policy URL, support URL, privacy nutrition labels (Audio: app functionality, not linked to identity, no tracking).
- **COPPA**: a child's voice is personal information. The audio-file exception covers audio used only for transcription and deleted right away, with nothing else collected, so: no server-side audio storage, zero-data-retention settings at OpenAI/Deepgram, the debug clip ring off in production, stories stay on the device (no cloud sync until there is a parent account).
- Kid-safety: `skip` + the word masker stay; the "moderation off" toggle and the debug panel are dev-only builds.
- Small Business Program enrollment before the first sale (it is not automatic).

## iPad and product work

- Landscape-first layout, safe areas, hardware keyboard for the typed fallback, a parent settings area behind the gate (balance, buy, restore, privacy).
- Interruptions: phone calls, Siri, backgrounding close the socket and pause the meter; resume cleanly.
- Performance on the cheapest iPad you will support (A13-class): 4096-px layers and three reveal lanes need a real test.
- Pack shape (decided 2026-09-22, packs only, no subscription ever): 40 min $9.99, 120 min $19.99, 400 min $39.99, never expiring; the first story free once (about 2 min, Sal to tweak), then 60 s a week. Gifting is core: gift codes sold on the website (Stripe), redeemed in the app behind the parental gate; road trip = the 400 pack plus offline replay (live drawing needs the network). See plans/2026-09-22-go-to-market.md.
- Build/ship: EAS Build + Submit, TestFlight with actual children, App Store screenshots and a preview video from the replay screen.

## Tutorial playback (first launch, replayable from the parent area)

The replay system already plays a `StoryRecord` deterministically with narration captions, so the tutorial is a canned record plus timed coach moments, not a new engine feature.

- Author one short story record once (dragon, castle, page turn, an effect, a bubble) and bundle it. Replay it through the `Replayer` with the real Stage so what the kid sees is exactly what the app does.
- Four beats, each a short narrator voice line (pre-rendered TTS, bundled audio; a five-year-old does not read) with a matching on-canvas cue:
  1. "Tell your story like you're telling a friend" while the mic sticker pulses and the caption shows words arriving.
  2. "When the crayon starts drawing, watch your creation" as the first strokes land; the caption highlights the yellow drawing state.
  3. "When it stops, tell more of your story" on the idle pause; the record continues with the next chunk.
  4. "When you're finished, say The End" and the finale plays (below).
- Parent skip button behind nothing (a tap on the corner), kid-facing controls none. Runs once on first launch, again from the parent area, and is the App Store preview video source.

## The End

Saying "the end" is the story's close and the moment the app gets to be delightful.

- Detection is client-side on final transcript text (`the end`, `and that's the end`, `the end!` as the last words of a chunk), never a model round trip: zero latency and works with any ears. The words are dropped from the story tail; the Director is not called for them. The prompt is told the story may end so it never draws a literal "the end".
- Finale is engine-side and deterministic (replays identically): mic stops and the meter stops first; the stage stamps a hand-scrawled "The End" title (the engine already has `title` and text stamping), a stars/sparkle burst, the crayon cursor draws a closing swirl, the page-flip sound; a canned narrator "The End!" if a voice pack exists.
- Then the closing card: play it again, share it (parental gate, see below), a new story. Autosave already happens; the closing card also sets the story's cover from the finale frame.
- Long silence (say 90 s of mic-open with no words) prompts "say The End when you're done" instead of burning minutes; two minutes more and the app ends the story itself with the same finale.

## Public sharing, so grandma can watch

A story record is tiny (words plus DSL lines) and replay needs no keys, no mic and no model, so a shared story costs nothing to serve.

- Share = upload the `StoryRecord` to the server, get `https://<site>/s/<random id>`, open the native share sheet. Unlisted by default (unguessable id), no listing page, no search.
- Parental gate before sharing: it is a link-out and it publishes a child's words. The word masker output is what gets uploaded, never raw audio, never a name field. The parent can unpublish from the app (delete on the server) and the link dies.
- The share page renders the replay in the browser with the same engine and the same seeded determinism, plus play/again, the narration captions, the cover as the OG image so iMessage and WhatsApp show a picture, a "download video" button, and a "made with Once Upon" link to the store. Works on any phone with no app installed.
- Links expire 90 days after upload (a nightly job deletes the record and its cached video); the page says so, and the app can re-share to mint a fresh link.

## MP4 export, from the app and from the website

Both, because a link is what you text and a file is what gets kept. The engine is deterministic and time-driven, so a video is the replay stepped frame by frame, not a screen recording.

- One entry point on the Stage: render the record at time t into an offscreen canvas (`setInstant` is already most of this; the replay scrubber already rebuilds a page to an event index). The exporter steps t in 1/30 s increments, so a 4-minute story is 7,200 frames rendered as fast as the machine can go, at 1280x800 with the crayon audio and page flips mixed in from the same seeded audio engine. Words go in as burned-in captions, the way the replay shows them.
- In the app: encode on the device with WebCodecs (Safari 16.4+, so every iPad this ships on) and mux with Mediabunny (already in the Remotion toolbox); the mp4 lands in the share sheet or Photos. No server, no cost, no upload.
- On the website: the share page renders the same stepper in headless Chrome once on first request, caches the mp4 next to the record for the link's 90 days, and serves it. Rendering is cheap enough (a few seconds of CPU per minute of story) not to need Remotion Lambda.
- The kid's voice (decided 2026-09-22): an opt-in in the parent area keeps each story's mic audio on the device only, never uploaded, never on the share page, and the local mp4 export muxes it in. The recognizer already has the PCM frames; the session writes them to a per-story file on device alongside the record, timestamped against the same clock as the events so the voice lines up with the drawing. Local-only keeps it out of COPPA's collection rules; the moment the voice leaves the device it needs verifiable parental consent, which a parental gate is not. Deleting the story deletes the audio.

## The website, on sal-starter

Not optional: the App Store needs a privacy policy URL and a support URL before submission, the share links need a home, and the ledger and key-holding server has to live somewhere. One sal-starter repo (tRPC + Vite, Bun, Postgres + Prisma) carries all of it; this repo's `src/engine`, `src/story` and `src/ui` become the shared engine package the website's share pages and the iPad WebView bundle both build from. Layout follows sal-starter's conventions; the Expo app is its own package beside it.

Pages: landing (an embedded live replay is the hero, the pitch is the product), how it works (the tutorial story), pricing (packs and the free allowance in plain words), FAQ, support/contact, terms of service, privacy policy with a children's privacy section (what the mic audio is used for, that it is not stored, which vendors process it, how to delete a story or a device's data), account and data deletion request page (Apple requires one when any data is held), and the `/s/<id>` share pages. Plus the API: Sonnet stream relay, STT token minting, ledger and free grants, IAP validation, story upload and unpublish.

## Open questions for Sal

1. Free tier: a one-time first story plus a small daily allowance, or daily only? What daily-active free count are you planning for?
2. RevenueCat or own receipt validation?
3. Ears vendor for launch: decide after the Deepgram A/B on a real kid.
4. Narrator voice for the tutorial and The End: there is none today. Recorded human, TTS rendered once and bundled, or no voice (captions and a parent beside them)?
   Settled: share links expire after 90 days; mp4 download exists in both the app and the website; the child's audio is kept on-device (opt-in) and muxed into the local mp4 only.
