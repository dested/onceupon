# Decisions

## 2026-09-22 — MP4 export: the live engine on a virtual clock, hardware H.264, CPU canvases

**Why:** the video must match replay and be reproducible, so it is the real Stage/Director/dialect stepped on a `VirtualClock` (no second renderer, no screen recording). Measured: GPU canvases vary by a few pixels between runs, so export canvases are CPU; Chrome's software H.264 (OpenH264) varies byte-wise for identical frames while the hardware encoder does not, so hardware is preferred; Mediabunny's `AudioBufferSource` varied the chunk layout, so audio is encoded with `AudioEncoder` up front and both tracks are muxed in a fixed order. Result: two exports differ only in the container creation times.
**Rejected:** MediaRecorder on a live canvas (real time, frame drops, not deterministic); a separate export renderer (drifts from replay); Remotion (server/React render path for something the engine already draws); software-first encoding (non-deterministic).

## 2026-09-22 — Prompt tuning is a measured hill-climb, promoted by hand

**Why:** the prompt is the product's picture quality and its latency (every token is read on every
call). Editing it by eye from one bad horse does not generalize. The lab (`lab.html`) draws a fixed
test set through the real engine, has a vision judge score each picture and file every fault as a
general rule, aggregates a whole round before an editor model proposes one patch, and keeps a
version only if the mean score rises without output tokens or blind recognizability getting worse.
Opus 5.5 judges and edits (sharper critique, better generalizing patches); Sonnet 5 draws because it
is the production model. Versions live in `lab/prompts/`, the app keeps `src/llm/ops-prompt.ts`
until Promote rewrites it: the campaign can run unattended without changing what the app does.
The `# Ops` grammar section is frozen (the parser is fixed); edits may only touch guidance, cookbook,
beats and the example, and every example line must still parse.
**Rejected:** auto write-back on every kept round (a parallel session edits `src/llm`, and a bad
judge round would ship); per-word critiques driving per-word rules (overfits; the editor sees a
round, not a case); a headless Bun renderer (the engine is canvas code; the browser is the truth).

## 2026-09-22 — The End is detected on the client, not by the model

**Why:** the child says "The End" and the story should stop drawing, play a finale and stop the meter.
Doing this on the client (`src/story/the-end.ts`, a regex on every chunk before it is recorded or
sent) is zero-latency, works with any ears, and never spends a call; the model never sees the words.
The app plays a "The End" title on a top stage layer and fires star/sparkle bursts, records an `end`
event so replay ends the same way, and shows a closing card (play it again / new story).
**Rejected:** teaching the model an `end` op (a round-trip of latency and cost, and the model would
have to recognize the intent as reliably as a regex does the phrase).

## 2026-09-22 — Tracker dedupes released words by content, not index

**Why:** Deepgram commits a `speech_final` that re-segments an already-released interim into a shorter
final at a NEW result index, so position-based consumption cannot survive the shift and the overlap
("hung out with") went out twice. `TranscriptTracker` now keeps a rolling memory of released words
and drops any leading chunk words that repeat the tail of that memory. A final whose leading words
disagree with what was released (Deepgram rewrote "Please" to "The") fires a `correct` callback; the
session rewrites the record and transcript but not the Director (the model already drew from the old
words, which is fine). `DEEPGRAM_TRACKER.minWords` is 2 so a one-word interim beat never releases.
**Rejected:** `holdBack: 1` on Deepgram (slower first stroke); making the recognizer hide segment
boundaries (it already folds settled segments into one live result; the index shift is inherent to a
`speech_final`).

## 2026-09-22 — Deepgram streaming as a flagged third transcriber

**Why:** OpenAI `gpt-live-transcribe` bills $0.017 per mic minute; Deepgram Nova-3 streaming is
$0.0077 list. Before an iPad launch we want to A/B kid-speech accuracy and latency against the OpenAI
path from the same Settings → Ears panel. It is a flag, not a replacement: OpenAI stays the default
when its key is present, and all three recognizers share one mic pipeline (`speech/pcm-mic.ts`) and
the same `Recognizer`/`RecResult` shape, so the tracker, cost metering and voice lab are unchanged.
Readiness for Deepgram is the socket `open` event (verified against the live API: `Metadata` arrives
at stream end, not on open). Cost is now per-vendor (`sttRateFor`) with a user override.
**Rejected:** replacing OpenAI outright (kid-speech data not gathered yet); AssemblyAI first (cheapest
at $0.0025 but no kid-speech data); Deepgram Flux (v2 endpoint, a later look).

## 2026-09-21 — Public deploy defaults: Sonnet 5 + JSON dialect, bring-your-own-key gate

**Why:** Once Upon is now deployed at onceupon.dested.com as a keyless static build (Drydock) that
strangers try with their own keys. For a first impression the picture quality matters more than the
half-second of first-token latency that drove the Haiku default, so the shared build defaults to
**Sonnet 5** (cleaner two-tone outlines, consistent faces) and the **JSON ops dialect**. A
`KeyGate` modal (`src/ui/KeyGate.tsx`) blocks on a missing Anthropic key (required to draw) and
optionally collects an OpenAI key (better voice), stored in localStorage like the Settings panel.
**Supersedes:** "Haiku 4.5 default" and the `lines` dialect default (both still one click away in
Settings). On localhost with a personal Haiku key nothing stops you switching back.
**Rejected:** baking any `VITE_*` key into the build (Vite inlines it into the public bundle = Sal's
key and bill exposed); keeping Haiku default (Sonnet's picture is the thing worth showing off).

## 2026-09-20 — Line-based text DSL instead of JSON or tool calls

**Why:** each line executes the moment it streams in; a dragon is ~120 output tokens; no braces or quotes to waste tokens on; partial output is still valid.
**Rejected:** JSON arrays (unparseable until complete, 2-3x tokens), tool calls (buffered per call, slower first stroke).

## 2026-09-20 — No server; API keys used from the browser

**Why:** the app is localhost-only for now and Sal asked for no server. Anthropic SDK with `dangerouslyAllowBrowser`, OpenRouter/OpenAI via fetch.
**Rejected:** a thin proxy. Revisit before any deploy; the swap is contained in `src/llm/providers.ts`.

## 2026-09-20 — Chrome Web Speech API for speech to text

**Why:** free, streaming interim results, zero setup. Good enough for a first cut.
**Rejected:** Deepgram / OpenAI Realtime (better with kid speech, but keys, cost, and more code). Swappable behind `speech/recognition.ts`.

## 2026-09-20 — Haiku 4.5 default, model picker for A/B

**Why:** first-token latency dominates the felt experience; Haiku measured 0.6-1.1s to first token. Sonnet 5 / Opus 5 stay one click away with thinking disabled.
**Rejected:** Opus 5 default (the skill's usual default) because speed matters more than composition quality here.

## 2026-09-20 — One model call in flight; words accumulate

**Why:** parallel calls would draw the same beat twice and fight over scene state. Backlog goes out as one bigger chunk, which the model handles fine.

## 2026-09-20 — World 160x100, ground y=80, anchor at bottom-center

**Why:** small integers are cheap tokens and easy for the model to reason about; a fixed ground line gives it a spatial convention. Uniform anchor rule so the same shapes survive a page turn.

## 2026-09-20 — Kid-crayon aesthetic as the target

**Why:** crude geometry from an LLM is charming when it looks like a five-year-old drew it; this is what makes the whole approach work.

## 2026-09-20 — Dab-stamped strokes on per-object layers, seeded RNG

**Why:** stamping textured dabs along arc length gives wax grain and incremental reveal for free; per-object layers let objects move/scale/flip cheaply; seeding makes replay pixel-identical.
**Rejected:** rough.js (pen-sketch look, no progressive reveal), SVG (too many nodes).

## 2026-09-20 — Grow the system prompts past Haiku's 4096-token cache minimum with real content

**Why:** measured: Haiku 4.5 caches nothing below 4096 prefix tokens (our prompts were 1920 / 3238), so every call paid full input price. A cookbook of shapes and story-beat recipes makes the prompts genuinely better and crosses the bar; reads then cost 10%.
**Rejected:** junk padding (works, but the tokens buy nothing), Sonnet/Opus by default (their minimums are lower but they are slower and dearer per token).

## 2026-09-20 — JSON ops dialect as a switchable second language, same engine (experiment)

**Why:** Sal proposed an NDJSON operations contract (1200x620 paper, Bezier-only paths, face helper, poses, recolor, scene keep). Built as a `Dialect` behind the Director so both languages share the renderer, replay, safety and cost plumbing, and can be A/B'd from Settings. Paper coordinates are mapped into the 160x100 world (uniform scale, ground aligned) instead of making the world size configurable, because stroke widths, dab sizes and wobble are tuned in world units.
**Rejected:** a second renderer (`CrayonRenderer`) per the proposal (duplicates the crayon look and the replay pipeline); a configurable world size (every brush constant would need rescaling).

## 2026-09-20 — The drawing model is the content filter (`skip`), no separate classifier

**Why:** Sal: "it has to be contextual, they can't go to the bathroom together". Only a model can judge meaning, and the drawing model already sees every chunk with the story context. Teaching it to answer `skip` costs no extra call and no latency; a word masker (`story/clean.ts`) stays as a blunt second layer for on-screen text.
**Rejected:** a parallel Haiku judge per chunk (adds 300-500ms before the first stroke or races the drawing call), a client-side phrase list (cannot judge meaning).

## 2026-09-20 — Skipped words leave the story entirely, with a visible marker

**Why:** the replay is meant to show what the app heard; scrubbing the words but leaving `(the crayon skipped a part)` keeps it honest without preserving the content. The marker is excluded from titles.

## 2026-09-20 — OpenAI Realtime transcription as the primary ears (supersedes the Web Speech decision above)

**Why:** Sal's live test: Chrome's recognizer is "terrible" with a child's voice. OpenAI Realtime streams partial words over a WebSocket straight from the browser (subprotocol auth), no server, and handles kid speech far better. Chrome stays as the free fallback when no OpenAI key is set.
**Rejected:** Deepgram (excellent, but another vendor/key), in-browser Whisper (too slow to be live).

## 2026-09-20 — Quiet window 700ms for the live transcriber, now that restarts are cheap

**Why:** the early restart (a call with fewer than 3 lines drawn is thrown away and re-sent with the whole sentence) makes a false "done talking" nearly free, so the window that decides it can be quick. 1100ms felt sluggish; 700ms starts the crayon sooner and a continued sentence just restarts the call.
**Rejected:** staying at 1100ms (safe but slow); dropping below ~600ms (the model's own ~1s lag plus breath gaps would restart nearly every beat). Restart cap raised 2 → 3 per beat to cover a long sentence with two breaths.

## 2026-09-22 — ops dialect (v3) as the default drawing language

**Why:** Sal asked for the JSON ops to become "more of a DSL, way terser, without losing any fidelity". The wire form was the cost: brackets, quotes and keys made a `draw` ~80 tokens and a beat ~1100, and output tokens are time to picture. `ops` keeps the JSON contract as the single source of semantics (the ops parser emits untyped operations into the same zod schema and `JsonDialect.applyRaw`), and only changes the syntax: one line per op, positional required fields, `k=v` optionals, `ent.shape` targets, crayon color names. Measured on Sonnet 5 (the only model in use), same two sentences: 3164 → 942 output tokens, $0.052 → $0.013, 17.7s+8.9s → 7.4s+3.6s, picture equal or better.
**Also decided:** primitives (`circle`/`oval`/`rect`/`poly`), `stamp` and a `mirror` flag are additive geometry in the shared schema, not a fork: the model draws true circles in 6 tokens instead of two Bezier curves in 30, and pairs come out symmetric. The JSON dialect gains them for free but its prompt does not teach them.
**Rejected:** replacing `json` in place (saved stories remember their dialect and must replay); implicit "current entity" for `draw` (hidden state across a restarted call); single-letter verbs (words are one token each anyway; the numbers dominate); a fourth renderer or a world-size change (see 2026-09-20).
**Supersedes:** the `json` default from 2026-09-21. `json` and `lines` stay selectable in Settings.

## 2026-09-22 — A beat waits for the end of speech: recognizer endpoint or quiet mic, never a mid-sentence final

**Why:** Sal, on Deepgram: "it should know that I am still talking so don't run the processor for a bit". Deepgram finalizes segments (`is_final`) every few seconds while the child is still speaking; treating those as releasable finals sent half-sentences to the model. The end-of-speech signals are the recognizer's own VAD (`speech_final` after `endpointing=700`, `UtteranceEnd` after 1000ms of no words) and, universally, the mic itself: while the level reads as a voice, the tracker's quiet-window release is held. The max-words cap (14) still releases so a breathless story keeps drawing, and the director's early restart stays as the safety net for a wrong guess.
**Rejected:** raising the quiet window (a slow beat for everyone, and it does not fix mid-sentence finals); dropping `is_final` on the floor (loses settled text on a socket close); a separate VAD library in the browser (the streaming recognizers already report level per frame).

## 2026-09-22 — The app is Squiggletale (squiggletale.com + squiggletale.app)

**Why:** "Once Upon" is a registered mark (Intl. Reg. 1603797, class 42, the Swedish photo-book company at onceupon.photo) and "Once Upon – A Storybook App" already sells personalized kids' stories, so the brand search could never be ours; Sal also felt it said nothing about drawing, the storybook, or the child being the author. Squiggletale is a coined word a four-year-old can say and a grandparent can spell, carries drawing (squiggle) and story (tale), had no app, company or mark in the sweep, and both domains were unregistered on 2026-09-22. The voice mechanic lives in the subtitle ("Say a story, the crayon draws") and `crayon` is a near-uncontested App Store term. Analysis: plans/2026-09-22-app-name.md. Sal: "Squiggletale is a lock."
**Rejected:** Once Upon a Crayon (inherits the mark and the storybook-app collision), Crayon Tales (warmer but unownable, .com taken), Speakadoodle (says the mechanic, but four syllables and "Doodle" names get policed), Story Crayon (keywords, not a brand), Tellatale / Doodletale / Story Doodle / Tell and Draw / Magic Crayon / Talkatale (live apps or marks).
**Rename rule:** `packages/shared/src/brand.ts` is the single seam; `origin`/`domain` stay on the Drydock deploy until squiggletale.app is registered and pointed.

## 2026-09-22 — Launch shape: monorepo in place, hosted studio in a WebView, our own ledger, packs via StoreKit 2 + Stripe

**Why:** Sal: "expo on quickgame, sal-starter for the website, wire billing, everything; iframe the drawing so we can iterate without deploying; eas codepush too". Decided: (1) **monorepo in this repo, no workspaces**: root stays the studio (a lab session runs here), `apps/web` is the sal-starter site + API + admin, `apps/mobile` the Expo shell, `packages/shared` dependency-free TS contracts imported by relative path; each app installs its own deps. (2) **The studio is one file** (`vite-plugin-singlefile`, `bun run build:hosted`), served by the website at `/app/` and bundled into the app as the offline copy; the **WebView loads the hosted URL first** (https = secure context, so the mic works in WKWebView; a studio change is a web deploy, not an app build) and falls back to the bundled file offline; shell changes ship with EAS Update. (3) **Studio ↔ server is a small typed JSON API** (`packages/shared/src/api.ts`, `POST /api/app/<name>`, HMAC device token) rather than tRPC across apps: the studio has no tRPC client and the contract must stay readable from both sides; the drawing relay streams NDJSON. (4) **Studio ↔ shell is a request/response bridge** over postMessage (`packages/shared/src/bridge.ts`): stories, voice clips and the device token live in native storage; purchases, share sheet and attribution are native. (5) **Hosted mode is a build flag** (`VITE_HOSTED=1`): the BYO-key app and the lab are unchanged without it. (6) **Domain onceupon.dested.com** for now (Drydock ssr + Postgres); `BRAND` is the one place the name and origin live. (7) **The website wears the app's paper language** (root ui.md), no separate design pass.
**Rejected:** a second repo (two trees to keep in sync for one engine); bun workspaces (would have moved the studio under a running lab session and re-rooted node_modules); bundled-only WebView updated by EAS (every drawing tweak becomes an app update and `file://` is not a secure context for the mic); RevenueCat (already rejected 2026-09-22 in the plan); Skia/native rewrite of the engine.
