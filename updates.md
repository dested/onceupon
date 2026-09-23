# Updates

## 2026-09-22 — Phone layout pass (studio hosted surfaces + website at 390x844 / 844x390)
Sal: "it has to work on phone too, not just tablet." Audited every hosted studio surface and site page through an iframe phone harness in bx. Fixed: finale/sleepy action rows wrapped off-screen (now two rows, 48 px targets, auto footer row), share-player title clipped (class + phone size + auto header), embed player rendered blank (wrapper is flex so the paper fills), bookshelf horizontal scroll from tilted cards, parent area/settings modals now 92dvh with 16 px gutters. Everything else already fit. Hosted build rebuilt and synced into the app.
Touched: src/styles/app.css, src/ui/{SharePlayer,Bookshelf,ParentArea,SettingsPanel}.tsx

## 2026-09-22 — App icon and splash (GPT Image)
Sal: "generate me an app icon using OpenAI image gen." Two low drafts (crayon squiggle mascot; crayon drawing a dragon sticker); Sal picked the dragon. High-quality render installed as apps/mobile/assets/icon.png (1024²), a 2048² splash rendered in headless Chrome with the icon centered on its own sampled paper tone (#f9f0d0, also the splash plugin background so nothing letterboxes visibly), and the same PNG as favicon/apple-touch-icon for the website and studio. SVG placeholders removed.
Touched: apps/mobile/{assets/icon.png,assets/splash.png,app.config.ts,README.md}, apps/web/{public/icon.png,index.html}, public/icon.png, index.html

## 2026-09-22 — Launch platform: Expo shell, website + API + admin, billing, hosted studio

Sal: "build out the mobile app, expo on quickgame; sal-starter for the website; wire billing; fully featured, whole website, everything; eas codepush too; iframe the drawing so we can iterate without deploying." Plan: plans/2026-09-22-launch-build.md (done); spec: features/launch-platform.md. Decided with Sal: monorepo in place (root = studio, apps/web, apps/mobile, packages/shared; no workspaces), domain onceupon.dested.com, WebView loads the hosted studio first with a bundled single-file copy offline, site straight from ui.md. Built by six Opus agents from Fable specs: (server) env, allow-listed better-auth admin, HMAC device tokens, minutes ledger with first-story and weekly grants, metered story sessions, Deepgram/OpenAI ears token minting, Anthropic relay streaming NDJSON with CallLog + daily cost cap, flags, mask words, AdServices attribution, StoreKit 2 JWS verify + App Store notifications, Stripe pack/gift checkout + webhook, gift codes, shares (masked, cover, voice, 90-day expiry), alerts/email, jobs; (admin) 10 pages with inline SVG charts and real Prisma queries; (site) landing with the embedded tutorial player, how, pricing, shop, gift + printable card, redeem, FAQ, support, terms, privacy, delete-my-data, /s/:id with OG tags; (studio) VITE_HOSTED mode: typed api client, device init, StoryMeter beats, relay provider, native/local storage backends with voice clips, grown-up gate, parent area, sleepy paywall, share card, minutes chip, offline state, silence nudge/end, first-launch tutorial (Sonnet-authored dragon record + TTS coach lines), public SharePlayer (embed mode for the site), voice recorded per story and played in replay + mixed into the mp4; (mobile) Expo SDK 57 shell with remote/local studio source, full bridge (files, kv, expo-iap StoreKit 2, share sheet, haptics, Swift AdServices module, net), EAS build profiles + Update channels, icon/splash placeholders, EAS project @quickgame/squiggletale created. Root Dockerfile + drydock.yaml switched to ssr + Postgres. Verified: typecheck green in all three apps; smoke-api (register→meter→draw stream) and smoke-money (gift→share→unpublish) pass on a local Postgres; admin, site and studio surfaces screenshotted in bx; mobile tsc + bun test + expo-doctor green. Not done (Sal): eas build on a real iPad (mic-in-WebView spike), App Store Connect app + consumables + notification URL, Stripe keys/webhook, Drydock project switch, squiggletale.app domain.
Touched: packages/shared/**, apps/web/**, apps/mobile/**, src/backend/**, src/tutorial/**, src/story/{voice,idb,storage-backend,storage,session,store,replay,clean}.ts, src/speech/{pcm-mic,deepgram}.ts, src/export/{mp4,frame}.ts, src/ui/{ParentGate,ParentArea,Paywall,ShareCard,MinutesChip,Offline,SharePlayer,StoryScreen,ReplayScreen,Bookshelf,SettingsPanel,KeyGate,VideoExport}.tsx, src/{boot,main,app}.tsx, vite.config.ts, index.html, scripts/{author-tutorial,render-coach,sync-studio}.ts, Dockerfile, drydock.yaml, cliffnotes.md, decisions.md, verify.md, features/launch-platform.md.

## 2026-09-22 — Lab run 1: agent mode, 135 pictures, v3 → v5
Sal: "run a bunch until it's perfect, spend $10"; then the API account ran out of credits mid-run; then "use the Claude Code session tokens". API rounds: r000 v1 60.8, r001 v3 65.2 (kept), r002 v4 incomplete (10/45 judged, $6.25 total). Built agent mode: Sonnet subagents draw from the versioned prompt with the exact app user message, `window.__lab.renderFromFile` renders ops to jpg in the lab page, Sonnet subagents name pictures blind, Opus subagents judge from the jpg + ops + expectations, `scripts/lab-agent.ts` (plan/record-draw/record-judge/finish/save-prompt/apply-patch/worst) writes the same lab/ shapes as the browser campaign; `lab-render-round.sh` and `lab-record-judges.sh` drive it. Agent-judged rounds: r003 v3 70.9 (baseline; the agent judge reads ~5.7 above the API judge), r004 v4 75.8 (kept; bird 10→80, horse 42→74, major issues 20→11), r005 v5 (Fable's patch: lone-subject scale for any single thing from recipe height, frog/ghost/airplane recipes, mane fringe, pirate hat, restored recipes) 77.5 (kept +1.8, marginal: targeted cases up, e.g. flower 58→79, ghost 68→80, frog 69→80; recognizable 4.6→4.4). Campaign gained judged-ratio and repeated-failure guards, `rejudge`, and a "judge missing" button. Full report: plans/2026-09-22-lab-run-1.md. v5 promoted into ops-prompt.ts (Sal: "i like round 5, ship it").
Touched: scripts/lab-agent.ts (new), scripts/lab-render-round.sh (new), scripts/lab-record-judges.sh (new), src/lab/{prompt-text.ts (new), prompt-tools.ts, render.ts, main.tsx, types.ts, campaign.ts, editor.ts, ui/Campaign.tsx}, lab/ (prompts v003-v005, runs r003-r005 data), .gitignore, plans/2026-09-22-lab-run-1.md (new), cliffnotes.md.

## 2026-09-22 — App name and domain research
Sal: "Once Upon" misses drawing / storybook / custom; find a name and a buyable domain. Swept the App Store kids story+drawing space and trademarks (Opus agent), RDAP-checked ~100 .com/.app domains, ranked candidates. "Once Upon" is a registered mark (photo-book co.) plus a live storybook app, so it is out. Recommendation: Squiggletale (both domains free, clear), then Crayon Tales (.app), then Speakadoodle. Sal locked Squiggletale the same evening: decision recorded, brand seam + wordmark + end card + titles renamed, listing copy and kit docs updated, launch-build sessions notified. Domain not yet registered; `BRAND.origin` stays on onceupon.dested.com until it is.
Touched: plans/2026-09-22-app-name.md (new, done), decisions.md, packages/shared/src/brand.ts, src/export/frame.ts, src/ui/StoryScreen.tsx, src/ui/KeyGate.tsx, src/story/debug-report.ts, src/llm/{providers,json-dsl}.ts, index.html, cliffnotes.md, ui.md, verify.md, features/mp4-export.md, plans/2026-09-22-{go-to-market,ipad-app-production}.md, updates.md.

## 2026-09-22 — MP4 export (download video), storybook border, crayon audio, corner logo

Spec: plans/2026-09-22-mp4-export.md (done), features/mp4-export.md. "Download video" on the replay toolbar and the closing card renders a saved story to 1280x800 30fps H.264 + AAC in the browser: the live Stage/Director/dialect stepped on a new `VirtualClock` (`engine/clock.ts`; Stage `clock`/`size`/`software`/`cursorRest` options, `renderAt`, `settled`, `pageNumber`; dialect timers on the clock), events at `replaySchedule()` times, framed in the home screen's storybook (`export/frame.ts`) with caption pill, tags, placeholder logo bottom-right on every frame, 2 s "Made with Once Upon" end card. Crayon scratch + page flips recorded as cues and rendered through the same `CrayonAudio` (now seeded, attachable) on an OfflineAudioContext; `VoiceTrack` seam for the child's voice. PaperCard progress + cancel (`ui/VideoExport.tsx`). Deterministic: frames pixel-identical across runs, files differ only in ~10 bytes of creation time (CPU canvases, hardware encoder, AudioEncoder + fixed interleave; see decisions.md). Verified with `scripts/export-check.mjs` + ffprobe (h264 High 1280x800 30/1, aac 48k stereo, 14.8 s / 33.6 s stories, page turns, cancel). Also: Stage `showCursor` for the lab session. typecheck green for this work (src/lab errors belong to the parallel lab session).
Touched: src/engine/{clock.ts (new),stage.ts,audio.ts,paper.ts}, src/llm/{dialect,json-dsl}.ts, src/story/replay.ts, src/export/{mp4,frame}.ts (new), src/ui/{VideoExport.tsx (new),ReplayScreen.tsx,StoryScreen.tsx}, scripts/export-check.mjs (new), package.json (+mediabunny), docs.

## 2026-09-22 — Drawing lab: word → picture → critique → prompt hill-climb
Sal: "send it a word, generate, save, analyze what it did wrong, update the system prompt; generic; results on disk over time; a page I can play with." Built `lab.html` (second Vite entry) with a dev-server file API confined to `lab/`, a test set of ~45 subjects + 15 action phrases with judge expectations, a batch/live draw path through the real OpsDialect + Stage, a Sonnet 5 blind guess + Opus 5.5 structured critique (issues carry general rules), an Opus 5.5 prompt editor emitting find/replace edits validated against the frozen grammar and the parseable example, a resumable campaign with keep/revert on mean score + token and blind-recognition guards, and a five-tab page (Playground, Campaign, Results, Prompts, Cases) with inline SVG trends and a manual Promote into `ops-prompt.ts`. First Playground draw of "horse" worked end to end (9 ops, 3.8 s, $0.018; judge scored 34, blind guess "llama", four issues incl. the side-view `mirror` ear flung to x=-115); judge parsing hardened after the first run tripped on an enum. Stage got a `showCursor` toggle (other session) so the crayon is not in judged snapshots. First campaign (3 food cases, 2 rounds, $0.69): baseline 67.3 → v1 "lone subject centered at x=600, 280-350 tall" kept at 80.0 (+12.7), v2 reverted (-2.0). Found and fixed: Vite full-reloaded the page on every non-module root file change (parallel session's .md edits, lab data), killing the page-side campaign; `vite.config.ts` now watches only source dirs, and a persisted `running` campaign loads as `paused` for resume. typecheck green.
Touched: lab.html, scripts/lab-plugin.ts, vite.config.ts, src/lab/**, src/llm/models.ts (Opus 5.5 price), .gitignore, lab/ (data), plans/2026-09-22-drawing-lab.md, cliffnotes.md, decisions.md, verify.md.

## 2026-09-22 — iPad drawing screen
Built the approved picture-book screen: stitched coral binding, illustrated welcome, mic dock, optional typing and page trays, quieter options, new-story confirmation, and finale/replay actions. Added safe areas, compact/portrait layouts, reduced motion, and pause/save on backgrounding. Typecheck/build passed; browser flow exercised with partial automation (runner stalled).
Touched: src/ui/{StoryScreen,StoryWelcome,Filmstrip}.tsx, src/styles/app.css, index.html, cliffnotes.md, ui.md, features/story-loop.md, verify.md.

## 2026-09-22 — plans updated after the viability review (packs only, gifting, web checkout) Then: admin portal section added to the production plan (overview, usage, ledger, revenue, costs, shares, kid-safety, feature flags incl. the free-story-seconds knob, alerts); week 2 of the launch sequence carries it. Then: no RevenueCat (own StoreKit 2 JWS validation + server notifications); the kid is the narrator: voice recorded on device for every story, in replay and mp4, on the share page only for paying accounts after a consent notice (a purchase is COPPA-accepted parental consent). Tutorial coach lines: TTS rendered once, bundled.

Sal: "packs only, ONLY"; 60 s/week free; "road trip and gifting are core, maybe two minutes up front, not locked into anything; update all the notes and plans." GTM and production plans now decide: free first story ~2 min with the sleepy-crayon paywall, packs 40/120/400, gift codes sold on the website via Stripe and redeemed behind the gate, US web checkout link-out, a finale-style rebuy screen, Apple featuring + share loop as the growth engine with Apple Ads as a capped seed, road trip = 400 pack + offline replay. No code.
Touched: plans/2026-09-22-go-to-market.md, plans/2026-09-22-ipad-app-production.md

## 2026-09-22 — The End finale + tracker content-dedupe and corrections

Spec: plans/2026-09-22-the-end-and-tracker.md (four fixes from Sal's Sep 22 Deepgram session).
(1) `TranscriptTracker` now dedupes released words by content (rolling normalized `releasedTail`), so a Deepgram `speech_final` that re-segments an interim into a shorter final at a new index no longer sends the overlap twice; a final that disagrees with a released interim fires a `correct` callback and `LiveSession.correct` rewrites the record/transcript (not the Director). `DEEPGRAM_TRACKER.minWords` → 2 (no one-word beats). New `scripts/tracker-check.ts` (no framework) covers the dup, correction and normal cases; all pass.
(2) Saying "The End" ends the story: new `story/the-end.ts` (`THE_END` regex + `splitTheEnd`), `LiveSession.endStory`/`playFinale` (stop listening, wait for the director to idle, record an `end` event, `stage.finale`, page-flip, closing card). `Stage.finale(seed)` reveals a "The End" title on a deterministic top layer + star/sparkle bursts; `StoryEvent` gains `end`; replay and scrub draw the same finale; `store.ending`/`ended` gate the card and hide the mic + typed input. `StoryScreen` shows the `the-end-card` (play it again / new story).
(3) Deepgram trace no longer logs empty deltas during silence.
Prompts (`prompt.ts`, `ops-prompt.ts`, `json-prompt.ts`) gained one story-beat line telling the model the app ends the story and never to write "The End". typecheck green; tracker-check green.
Touched: src/story/{the-end.ts (new),session.ts,storage.ts,replay.ts,store.ts,debug-report.ts}, src/speech/{recognition,deepgram}.ts, src/engine/stage.ts, src/ui/StoryScreen.tsx, src/llm/{prompt,ops-prompt,json-prompt}.ts, scripts/tracker-check.ts (new), docs.

## 2026-09-22 — copyable debug report with timings

Sal: a full debug output he can copy and paste back for analysis, with timings. New `story/debug-report.ts` `buildDebugReport()` and a "copy report" button in the debug panel (clipboard; falls back to a .txt download). Report: settings (model, dialect, ears, tracker rules, voice hold), spend and averages, every call (sent / first token / done / lines / tokens incl. cache / cost / error), what is in flight or queued, a merged timeline on one clock (ms since session start) of the child's words, call milestones, every DSL line with parse errors, and the ears trace, then the transcript, the scene snapshot and warnings. `LineLog` gained `t`; the debug handle gained `story()`, `t0`, `listenT0()` and `report()`; tracker selection and the voice-hold constants moved to `speech/beat-rules.ts` (imported by session and the report). Verified in bx: button reads "copied", `window.__onceupon.report()` shows a full beat with per-line arrival times.
Touched: src/story/debug-report.ts (new), src/speech/beat-rules.ts (new), src/debug-handle.ts, src/story/store.ts, src/story/session.ts, src/ui/DebugPanel.tsx, cliffnotes.md, verify.md

## 2026-09-22 — Deepgram: wait for the end of speech before sending a beat

Sal: Deepgram sends text in chunks, fine, but the crayon started (words went yellow) while he was still talking. Cause: Deepgram's `is_final` segments land mid-sentence and the tracker released any final at once. Now `deepgram.ts` folds settled segments into one live result and commits a final only on `speech_final` (endpointing 300 → 700ms) or `UtteranceEnd` (1000ms); `TranscriptTracker.tick(now, talking)` skips the quiet-window release while the mic is loud (`VOICE_LEVEL` 0.2 within `VOICE_HOLD_MS` 400 in `session.ts`), max-words still releases. Tracker simulation (hold, quiet release, no double release on commit, commit release, max-words) passes; typecheck green. Live mic is Sal's to confirm.
Touched: src/speech/deepgram.ts, src/speech/recognition.ts, src/story/session.ts, scripts/probe-deepgram.ts, cliffnotes.md, decisions.md, verify.md

## 2026-09-22 — iPad app economics + production plan, tutorial, The End, sharing, website

Sal: free iPad app with a daily free sliver and minute packs (20 min / $9.99), Sonnet + streaming STT, do the math, interactive artifact, what does production take, RN webview? Then: tutorial playback, spoken "The End" finale, share-to-grandma links (90-day expiry) + mp4 export from app and website (child audio kept on-device, opt-in), marketing/legal site on sal-starter. Calculator: https://claude.ai/artifact/UsDKjgAu58zZDE4L7BUjAx (~10¢ per mic minute all-in on Sonnet 5 + JSON ops; a 20-min pack ~$2 to serve, ~$6.50 margin after Apple's 15%). Found the live OpenAI transcriber bills $0.017/min, not the $0.006 the chip assumed (fixed by the Deepgram task's vendor-default rate). Analysis in plans/2026-09-22-ipad-app-production.md. Small fix after the Deepgram build: `micSupported` and `warmMic` in session.ts now treat any non-browser ears as mic-capable, not only OpenAI.
Touched: plans/2026-09-22-ipad-app-production.md (new), plans/2026-09-22-pricing-model.html (new, locked inputs), src/story/session.ts, cliffnotes.md

## 2026-09-22 — ops dialect (v3): the JSON ops contract as terse lines, now the default

Sal: "we're using jsonops. Can we turn it into more of a DSL? And make the operations way terser without losing any fidelity?" New `ops` dialect: one short line per op (`ent`, `draw <ent>.<shape> <outline> [<fill>] [mirror] <geometry>`, `face`, `move`, `pose`, `recolor`, `fx`, `rm`, `say`, `scene`, `skip`), parsed into the same untyped operation the JSON zod schema validates, so every range/default/behavior is shared (`OpsDialect` composes `JsonDialect`). Additive quality wins in the shared schema: `circle`/`oval`/`rect`/`poly`/`stamp` geometry next to `path`, a `mirror` flag for pairs, crayon color names, four more effects (hearts, fire, stars, poof). Scene snapshot goes back to the model in the same terse syntax (`describeScene`). Prompt rewritten with the cookbook in ops syntax; every example line is checked by a parser harness (34/34). Measured on Sonnet 5, same two sentences: json 3164 output tokens / $0.052 / 17.7s + 8.9s vs ops 942 tokens / $0.013 / 7.4s + 3.6s, picture equal or better. Default flipped json → ops in `store.ts` (see decisions.md). typecheck green.
Touched: src/llm/ops-dsl.ts (new), src/llm/ops-prompt.ts (new), src/llm/json-dsl.ts, src/llm/dialect.ts, src/story/store.ts, cliffnotes.md, decisions.md, verify.md

## 2026-09-22 — Deepgram ears behind a flag

Spec: plans/2026-09-22-deepgram-ears.md. Added Deepgram Nova-3 streaming as a third transcriber, selectable in Settings → Ears, same `Recognizer`/`RecResult` shape, cost metering and voice-lab trace as the OpenAI path. Pulled the 24k PCM16 mic pipeline out of `openai-realtime.ts` into a shared `speech/pcm-mic.ts` (`openPcmMic`, `warmMic`, `listMics`, `lastClip`, `pcmToWav`, `rms`, ring); the OpenAI socket path is behaviorally unchanged. New `speech/deepgram.ts` (subprotocol auth, binary PCM16 frames, KeepAlive, finals+interim → RecResult, `DEEPGRAM_TRACKER`). `ApiKeys` gains `deepgram`; store `resolveStt` is three-way, ears cost moved to `effectiveSttRate`/`sttRateFor` + `sttRateOverride` (old flat $0.006 migrates to no-override, real $0.017 for OpenAI live). `scripts/probe-deepgram.ts` streams a WAV to Deepgram for Sal to test with a key. Deviation from the spec: `Metadata` arrives at stream end (verified live), not on open, so readiness fires on socket `open`. typecheck green; typed-story path and the Ears UI verified in the browser.
Touched: src/speech/{pcm-mic,deepgram,openai-realtime,recognition,clip-lab}.ts, src/story/{store,session}.ts, src/llm/providers.ts, src/ui/{SettingsPanel,SpendChip,DebugPanel}.tsx, scripts/probe-deepgram.ts, docs.

## 2026-09-21 — deployed to onceupon.dested.com + BYO-key defaults

Sal: deploy via Drydock, keyless, others use their own keys; default to JSON ops + Sonnet, add a paste-your-key modal. Created a Drydock `static` project (no server/DB, dist/, domain onceupon.dested.com, no env vars — keyless). Defaults flipped: DEFAULT_MODEL → Sonnet 5 (`models.ts`), dialect default → json (`store.ts`). New `KeyGate` modal (`src/ui/KeyGate.tsx`) prompts for Anthropic (required) + OpenAI (optional voice) when missing, persisted to localStorage; `keyGateDismissed` in the store stops it nagging. Settings footer no longer says "localhost only". See decisions.md.
Touched: src/llm/models.ts, src/story/store.ts, src/ui/KeyGate.tsx, src/ui/StoryScreen.tsx, src/ui/SettingsPanel.tsx

## 2026-09-21 — merged json-dsl into master (for Drydock deploy)

Sal: merge json-dsl into main and push. Branches had diverged — master carried faithful "(ported from json-dsl)" commits, so json-dsl was a strict superset (all of master's features plus the switchable JSON ops dialect). Resolved the merge to json-dsl's tree; conflicts were only ports-vs-originals of the same lines. Verified moderation is not regressed (json-dsl moved the moderated/unmoderated prompt choice into `makeDialect`/the dialects, still threaded from `settings.moderation`). typecheck green. master → 448407d, pushed.
Touched: merge only (no new code); resolved src/llm/director.ts, src/story/session.ts, src/story/store.ts, src/ui/SettingsPanel.tsx, docs.

## 2026-09-20 — tighter quiet window now that restarts are cheap

Sal: tighten the quiet-time requirement. Live transcriber quiet window 1100ms → 700ms; restart cap 2 → 3 per beat. See decisions.md.
Touched: src/speech/recognition.ts, src/llm/director.ts

## 2026-09-20 — no error boxes on the story screen; our own aborts are not errors

Sal: "request was aborted" showed as an error; stop showing errors outside debug. The director now treats any abort it asked for as a non-error (the SDK throws its own type, so it checks the signal). The red warning box is gone; a red dot on the bug icon says the debug panel has something.
Touched: src/llm/director.ts, src/ui/StoryScreen.tsx

## 2026-09-20 — Anthropic pricing table refreshed

Sal pasted the current table. PRICING now covers Fable/Mythos 5.1 (cache hits $0.25), Fable/Mythos 5, Opus 5/4.8/4.7/4.6/4.5, Opus 4.1/4, Sonnet 5, Sonnet 4.6/4.5/4, Haiku 4.5, Haiku 3.5; 5-minute write prices (the TTL we use). Fable 5.1 added to the model picker with thinking off.
Touched: src/llm/models.ts, src/llm/providers.ts

## 2026-09-20 — get the most out of Anthropic prompt caching

Sal: make sure we get the most out of caching. Found Haiku 4.5 caches nothing under a 4096-token prefix; both prompts were under. Added a shape cookbook + story-beat recipes to both system prompts (now ~4.2k / ~5.3k tokens), and the user message is now blocks: story chunks as separate blocks with a breakpoint on the last, so the story-so-far reads from cache too. Probed with real calls: system writes once then reads; each story call reads everything but the new chunk.
Touched: src/llm/{providers,prompt,json-prompt,dialect,json-dsl,director}.ts

## 2026-09-20 — restart an early call when the sentence continues

Sal: a pause mid-sentence splits the beat and the rest waits for the next call. Now words arriving while a call has drawn fewer than 3 lines abort it and re-send with the whole text (max twice per beat); aborted calls are marked "restarted" in the debug panel and not counted as spend; a "hold on... drawing all of that" note tells the kid to wait.
Touched: src/llm/director.ts, src/story/session.ts

## 2026-09-20 — delete stories

Sal: give me a way to delete a story. The shelf already had a per-card two-tap trash; added a trash on the replay screen (two-tap, returns to the shelf), a "clear N empty" button on the shelf for 0-word stories, and stories with no words are no longer autosaved.
Touched: src/ui/{ReplayScreen,Bookshelf}.tsx, src/story/session.ts

## 2026-09-20 — moderation behind a flag

Sal: give me a way to disable the moderation. Settings → "Kid-safe moderation" checkbox (default on). Off removes the safety section from both prompts (next new story) and turns the word masker into a pass-through (live).
Touched: src/story/{clean,store,session}.ts, src/llm/{prompt,json-prompt,dialect,json-dsl}.ts, src/ui/SettingsPanel.tsx

## 2026-09-20 — faster catch-up, calmer background, better page turns, relaxed pause

Sal (on v2): too slow with lots queued; doesn't clear when they go inside (table drawn over the house); background moves too much; pause detection too aggressive. Done: reveal lanes (2 or 3 objects drawn at once past ~1s/~2s of backlog); base breathing halved and off for the sky/ground, half again for scenery; both prompts now say every place change (inside, home, bed, school...) is a page turn, with an "inside the house" example in the JSON prompt; live transcriber no longer treats punctuation as done and waits 1100ms of quiet.
Touched: src/engine/stage.ts, src/llm/json-prompt.ts, src/llm/prompt.ts, src/speech/{openai-realtime,recognition}.ts

## 2026-09-20 — voice lab: clip save fixed, mic picker, level meter, model comparison

Sal: "save mic clip" did nothing (lastClip was never assigned); the voice still isn't great and he wants to test it. Fixed the clip; added a mic device picker (Settings → Ears), a live level meter (under the mic and in the debug panel), a transcriber trace with timestamps, and "compare models on clip" (gpt-live-transcribe via socket, gpt-4o-transcribe + whisper-1 via REST) on the last 30s of audio.
Touched: src/speech/{openai-realtime,recognition,clip-lab}.ts, src/story/{store,session}.ts, src/ui/{DebugPanel,SettingsPanel,StoryScreen}.tsx

## 2026-09-20 — replay scrubber

Sal: let me scrub around in playback. Added a slider + play/pause on the replay screen. Seek rebuilds the page through event i with a fresh scene/director in instant mode, then `Stage.settle()` finishes strokes, snaps tweens, drops effects; playback continues from there.
Touched: src/story/session.ts, src/story/replay.ts, src/story/store.ts, src/engine/stage.ts, src/engine/fx.ts, src/ui/ReplayScreen.tsx

## 2026-09-20 — always two eyes

Sal: characters often get one eye. The face helper followed the spec's one-eye-in-profile rule and models nearly always face left/right. Now two eyes always, shifted toward the facing side; the line DSL example and rule say two eyes too.
Touched: src/engine/face.ts, src/llm/json-prompt.ts, src/llm/prompt.ts

## 2026-09-20 — transcript no longer stops one word early

Sal: drawing frequently lags one word. Cause: tracker rules written for Chrome (hold back the last interim word, need 5+ words) applied to the OpenAI live model, whose deltas are append-only and whose finals need sentence punctuation. Now each recognizer configures the tracker: live = release everything after 600ms of quiet.
Touched: src/speech/recognition.ts, src/story/session.ts

## 2026-09-20 — JSON ops dialect (branch json-dsl)

Sal: try a new NDJSON drawing DSL (1200x620 paper, Bezier paths, face helper, poses, recolor, scene keep). Built as a switchable Dialect behind the Director on the existing engine: zod schema + translator + JSON scene snapshot + its own prompt; engine gained layers (z-order), shape reset that keeps the drawn prefix, recall of kept characters after a page turn, face helper. Settings → Drawing language; story records remember their dialect for replay. Verified with Haiku: first token ~500ms both ways, JSON ~5x output tokens per beat.
Touched: src/llm/{dialect,json-dsl,json-prompt,director}.ts, src/engine/{face,types,scene,stage}.ts, src/story/{store,storage,session}.ts, src/ui/SettingsPanel.tsx

## 2026-09-20 — ears cost, replay narration, kid-safety, subtitle states

Sal: include transcription cost; replay must show what we heard; filter inappropriate content contextually ("they can't go to the bathroom together"); unclear which words are drawn/waiting. Done: audio-ms metering priced at an editable per-minute rate (chip + debug + Settings); replay caption per heard chunk; `skip` verb the model answers for not-for-kids meaning (words scrubbed from record/transcript, marker left, note shown) plus a word masker; three-state subtitle (ink / yellow drawing / grey waiting) and clearer mic status; stamp-in-obj page-coordinate tolerance; play-again moved above the subtitle.
Touched: src/story/clean.ts (new), src/llm/prompt.ts, src/llm/director.ts, src/engine/{types,dsl,scene}.ts, src/speech/{recognition,openai-realtime}.ts, src/story/{store,session,replay}.ts, src/ui/{Subtitles,SpendChip,SettingsPanel,DebugPanel,ReplayScreen,StoryScreen}.tsx

## 2026-09-20 — no more lost first words

Sal: clip started ~2s after the click. Audio before the socket was ready was dropped and the UI said listening too early. Now: mic + socket open in parallel, pre-ready audio is buffered and flushed, listening state waits for onReady, mic pre-warmed on load when permitted.
Touched: src/speech/openai-realtime.ts, src/speech/recognition.ts, src/story/session.ts, src/story/store.ts, src/ui/StoryScreen.tsx

## 2026-09-20 — switch ears to gpt-live-transcribe

Sal: OpenAI STT "terrible" and slow. Cause: pause-gated models. Found gpt-live-transcribe on the account: continuous word deltas, no VAD. Live-mode intake (sentence punctuation = final), model default switched, mid-speech commits kept only for pause-gated models, energy-aware commit points, and a "save mic clip" WAV export in the debug panel for diagnosis.
Touched: src/speech/openai-realtime.ts, src/story/store.ts, src/story/session.ts, src/ui/SettingsPanel.tsx, src/ui/DebugPanel.tsx

## 2026-09-20 — phantom dragon: transcription prompt hallucination

OpenAI transcriber was fed a story-word vocabulary prompt and hallucinated it as speech ("keeps adding a dragon"); removed the prompt. Added forced commits every 2.5s of continuous speech so words appear before the pause, and worklet-side resampling to 24k instead of forcing the AudioContext rate. Moved Realtime to the GA session shape (beta retired).
Touched: src/speech/openai-realtime.ts, src/story/session.ts

## 2026-09-20 — bubbles, scratch-out, and better ears

Fixed inflated object bounds (each shape re-padded the layer box): speech bubbles now sit on the head or beside it near the top edge, tail always points at the character, held until the character is drawn; spin uses the sweep circle; scratch-out matches the real box. Added OpenAI Realtime speech-to-text (Settings → Ears, auto when an OpenAI key is set) with Chrome as fallback; all three key fields in Settings; window.__onceupon debug handle.
Touched: src/engine/stage.ts, src/speech/openai-realtime.ts, src/story/session.ts, src/story/store.ts, src/ui/SettingsPanel.tsx, src/debug-handle.ts

## 2026-09-20 — build Once Upon from scratch: voice story → live crayon drawing

Scaffolded Vite/React/TS/Tailwind app (no server, port 7710). Crayon DSL + parser, scene model, canvas renderer with progressive dab-stamped reveal, effects, idle motion, page turns, audio; Web Speech intake; streaming Director over Anthropic/OpenRouter/OpenAI; settings, subtitles, filmstrip, bookshelf, replay. Verified typed path on Haiku 4.5. Then: caption moved to one clipped bottom line (mic bottom-left) after Sal's live mic test showed overlap; added per-call token usage and a running cost chip.
Touched: everything under src/, cliffnotes kit
