# Once Upon — cliffnotes

> Living map of the project. Read first, every task. Last updated: 2026-09-22 (mp4 export)

## What it is

A child tells a story out loud; a crayon draws it on the screen as they talk. Browser only,
no server: the mic feeds Chrome's Web Speech API, chunks of words go to a fast LLM which
streams back lines of a tiny drawing DSL, and a canvas renderer plays those lines as crayon
strokes with living idle motion. Stories are saved to localStorage and can be replayed.

## Run it

| Command             | What                                            |
| ------------------- | ----------------------------------------------- |
| `bun install`       | deps                                            |
| `bun run dev`       | Vite on **http://localhost:7710** (strict port) |
| `bun run typecheck` | `tsgo --noEmit`; must be green before done      |
| `bun run build`     | static build to `dist/`                         |

Keys: `.env.local` with `VITE_ANTHROPIC_API_KEY` / `VITE_OPENROUTER_API_KEY` / `VITE_OPENAI_API_KEY`,
or paste them in the in-app Settings (stored in localStorage). Keys are used **from the browser**.
Localhost only. Never deploy this as is.

## Directory tree

```
index.html                 fonts (Patrick Hand, Gloria Hallelujah), mounts #app
vite.config.ts             ~ alias, port 7710
src/
  main.tsx                 React root
  app.tsx                  screen switch: story | shelf | replay; backtick toggles debug
  styles/app.css           Tailwind v4 theme tokens (paper, ink, crayon colors, hand fonts)
  debug-handle.ts          window.__onceupon (scene, stage, director, story(), t0, listenT0(), report()) for bx and the debug report
  engine/                  pure drawing engine, no React
    types.ts               world constants (160x100, ground y=80), Shape + Command unions
    dsl.ts                 parseLine(): one DSL line -> Command | error
    colors.ts              the crayon box (named colors -> hex), resolveColor/colorName
    stamps.ts              prefab scenery (sun, house, tree...) -> Shape[]
    geometry.ts            Shape -> Stroke[] (wobbled outline + clipped hachure fill), SVG path parser, bounds
    brush.ts               CrayonBrush: cached wax dab sprites, stampRange along a stroke, text stamping
    paper.ts               cream paper texture canvas
    rng.ts                 mulberry32, hashString, noise1 (determinism for replay)
    scene.ts               Scene model: objects, pages, apply(Command) -> SceneEvent[], summary() for the prompt
    stage.ts               Stage renderer: per-object layers, reveal queue, tweens, idle motion, bubbles, page turn, crayon cursor
    fx.ts                  particle effects (explode, sparkle, hearts, rain, fire, smoke, stars, poof, scribble-out)
    face.ts                faceShapes(): eyes + mouth anchored to a head contour (json dialect's face op)
    audio.ts               synthesized crayon scratch + page flip (Web Audio, seeded noise); StageAudio, AudioCues + renderAudioCues() for offline export
    clock.ts               Clock seam: realClock (live) and VirtualClock (export steps time; timers fire in order at their due time)
  llm/
    models.ts              provider + preset model list, per-MTok pricing, estimateCost()
    providers.ts           LlmProvider: Anthropic SDK (browser-direct) and OpenAI-compatible SSE (OpenRouter, OpenAI)
    prompt.ts              SYSTEM_PROMPT (DSL spec, cookbook, story beats, example) and buildUserBlocks()/storyBlocks() (cached story chunks)
    director.ts            Director: words in -> one streaming call at a time -> execute lines as they land (through a Dialect)
    dialect.ts             Dialect interface, LinesDialect (v1 wrapper over dsl.ts), makeDialect()
    json-dsl.ts            JsonDialect: zod schema for the NDJSON ops contract + translation to engine Commands + JSON scene snapshot
    json-prompt.ts         JSON_SYSTEM_PROMPT and buildJsonUserMessage()
    ops-dsl.ts             OpsDialect (v3, default): terse one-line-per-op parser -> the same Operation objects, composes JsonDialect; describeScene() terse snapshot
    ops-prompt.ts          OPS_SYSTEM_PROMPT (ops grammar, cookbook in ops syntax, beats, example) and buildOpsUserBlocks()
  speech/
    recognition.ts         typed boundary over webkitSpeechRecognition + TranscriptTracker (when words are "ready"); per-recognizer TrackerOptions (CHROME/LIVE/DEEPGRAM/PHRASE)
    pcm-mic.ts             shared 24k PCM16 mic pipeline (AudioWorklet downsample, 30s clip ring + lastClip, warmMic/listMics, pcmToWav, rms); openPcmMic(onFrame) feeds both streaming recognizers
    openai-realtime.ts     OpenAI Realtime transcription over a browser WebSocket (PCM16 via openPcmMic), same Recognizer shape; server VAD + mid-speech commit, level + trace callbacks
    deepgram.ts            Deepgram Nova-3 streaming over a browser WebSocket (subprotocol auth, binary PCM16 frames, KeepAlive), same Recognizer shape; finals+interim mapped to RecResult[]
    clip-lab.ts            voice lab: run a saved clip through gpt-live-transcribe (socket), gpt-4o-transcribe and whisper-1 (REST) side by side
    beat-rules.ts          when a thought becomes a beat: trackerOptionsFor(settings) + the mic-energy hold constants (VOICE_LEVEL, VOICE_HOLD_MS)
  export/
    mp4.ts                 exportStoryVideo(): record -> VirtualClock replay -> 1280x800@30 H.264 (WebCodecs) + AAC -> Mediabunny mp4; VoiceTrack seam
    frame.ts               BookFrame: the home screen's storybook drawn on canvas around the stage, caption pill, tags, corner logo, end card
  story/
    store.ts               app state (useSyncExternalStore), settings load/persist, env keys via zod
    storage.ts             StoryRecord zod schema, localStorage list/get/save/delete
    the-end.ts             THE_END phrase regex + splitTheEnd(): the child saying "The End" ends the story (client-side, before the model)
    replay.ts              Replayer: plays a StoryRecord through a Director with gaps capped (replaySchedule(), shared with export); seek()/position for the scrubber
    session.ts             LiveSession (mic + director + stage + autosave) and ReplaySession
    debug-report.ts        buildDebugReport(): the pasteable text dump behind the debug panel's "copy report" (one clock, merged timeline)
  ui/
    StoryScreen.tsx        iPad picture-book layout, mic dock, options, expandable typing/page trays, new-story confirmation and ending actions
    StoryWelcome.tsx       decorative SVG crayon and empty-page invitation; never enters saved drawings
    Subtitles.tsx          one clipped line along the bottom; newest words stay visible (float-right trick)
    SpendChip.tsx          running $ / calls / time-to-first-stroke, visible with the development drawing lab
    Filmstrip.tsx          thumbnails of earlier pages, top-left
    SettingsPanel.tsx      provider/model picker + API key
    DebugPanel.tsx         latency stats + raw DSL stream (backtick key) + voice lab (level meter, save clip, compare models, transcriber trace)
    Bookshelf.tsx          saved stories grid, play, two-tap delete
    ReplayScreen.tsx       replay canvas + play again + download video
    VideoExport.tsx        VideoExportButton (replay toolbar icon / closing-card button) + progress PaperCard with cancel; blob -> browser download
    bits.tsx               StickerButton, IconButton, PaperCard
  lab/                     drawing lab (lab.html): word -> picture -> critique -> prompt hill-climb; spec plans/2026-09-22-drawing-lab.md
    types.ts               zod contracts for everything under lab/ (cases, prompt versions, draw results, critiques, rounds, campaign, patches)
    cases.ts               DEFAULT_CASES: ~45 subjects + 15 action phrases with judge expectations; seeds lab/cases.json
    draw.ts                drawPhrase(): one phrase through the real OpsDialect + Stage (batch: VirtualClock, detached 1280x800; live: visible canvas), settled JPEG
    judge.ts               blindGuess() (names the picture without the words) + judgeCase() (Opus 5.5 vision, structured JudgeOutput, JUDGE_SYSTEM)
    editor.ts              proposePatch(): Opus 5.5 turns a round's critiques into find/replace edits on the prompt (EDITOR_SYSTEM)
    prompt-tools.ts        applyPatch, validatePrompt (grammar section frozen, example lines must parse), diffLines, countPromptTokens
    campaign.ts            Campaign: rounds, worker pool, keep/revert rule, resume from lab/campaign.json; runOne() for the playground
    store.ts / api.ts      typed disk model over the dev-server file API (/__lab/*)
    App.tsx, ui/           the page: Playground, Campaign, Results, Prompts, Cases tabs, detail drawer, inline SVG charts
lab.html                   second Vite entry -> src/lab/main.tsx (http://localhost:7710/lab.html)
lab/                       lab data: cases.json, campaign.json, history.jsonl, prompts/vNNN.md+json (tracked); runs/rNNN/*.jpg|.ops.txt|.json (gitignored)
features/                  feature specs
plans/                     dated working docs; 2026-09-22-pricing-model.html is the interactive cost calculator (open in a browser)
scripts/                   one-off dev scripts (probe-deepgram.ts: stream a WAV to Deepgram with a key; tracker-check.ts: `bun scripts/tracker-check.ts`, tracker dedupe/correction regression, no framework; lab-plugin.ts: the Vite dev plugin behind /__lab/* (file API confined to lab/, promote rewrites OPS_SYSTEM_PROMPT); export-check.mjs: `node scripts/export-check.mjs <outDir> <storyId>`, headless mp4 export + determinism check, see verify.md)
```

## File map (concept -> where)

| Want to change...                    | Go to                                                                                                              |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| what the model is told / DSL wording | `src/llm/prompt.ts`                                                                                                |
| a DSL verb's syntax                  | `src/engine/dsl.ts` + `types.ts` + prompt                                                                          |
| the ops dialect (v3, default)        | grammar `src/llm/ops-dsl.ts` (`parseOpsLine`), wording `ops-prompt.ts`; semantics + schema live in `json-dsl.ts`   |
| the JSON ops dialect (v2)            | `src/llm/json-dsl.ts` (schema + translate), `json-prompt.ts`; pick it in Settings → Drawing language               |
| how strokes look (width, wobble)     | `src/engine/geometry.ts` consts, `brush.ts` dabs                                                                   |
| reveal speed / catch-up              | `src/engine/stage.ts` `OUTLINE_SPEED` etc                                                                          |
| idle motion / anim kinds             | `stage.ts` `objectTransform`                                                                                       |
| add a stamp                          | `src/engine/stamps.ts` (and STAMP_NAMES)                                                                           |
| add an effect                        | `src/engine/fx.ts` + FX_KINDS                                                                                      |
| when speech chunks are sent          | `src/speech/recognition.ts` `TranscriptTracker`                                                                    |
| which transcriber is used            | `src/story/store.ts` `resolveStt` (openai / deepgram / browser), `session.ts` `startListening`                     |
| call scheduling / prompt assembly    | `src/llm/director.ts`                                                                                              |
| model presets                        | `src/llm/models.ts`                                                                                                |
| save format                          | `src/story/storage.ts`                                                                                             |
| the "The End" phrase / finale        | `src/story/the-end.ts` (detect), `session.ts` `endStory`/`playFinale`, `engine/stage.ts` `finale()`               |
| what counts as not-for-kids          | `src/llm/prompt.ts` "For a small child" (the model judges, answers `skip`); `src/story/clean.ts` word masker       |
| what the debug report contains       | `src/story/debug-report.ts`; button in `DebugPanel.tsx` (`copy-report`), also `window.__onceupon.report()`                    |
| when a thought becomes a beat        | `src/speech/beat-rules.ts` (tracker options per recognizer, voice hold), `recognition.ts` `TranscriptTracker.tick`         |
| the mp4 export (look, timing, codecs) | `src/export/mp4.ts` (stepper, encoders, mux), `src/export/frame.ts` (book, overlays, logo, end card); spec `features/mp4-export.md` |
| ears cost / spend chip               | `src/story/store.ts` `Spend.audioMs`, `effectiveSttRate`/`sttRateFor`, `settings.sttRateOverride`; `SpendChip.tsx` |
| tune the drawing prompt with evidence | the lab: `lab.html` → Playground (one word), Campaign (hill-climb); judge rubric `src/lab/judge.ts`, editor rules `editor.ts`, test set `cases.ts` |

## Screens

| Screen | Component      | Notes                                                                                                                                                                              |
| ------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| story  | `StoryScreen`  | default; remounts on "New story" (storyNonce)                                                                                                                                      |
| shelf  | `Bookshelf`    | opens from the book icon; per-card two-tap trash; "clear N empty" removes 0-word stories                                                                                           |
| replay | `ReplayScreen` | keyed by story id; autoplays; trash = two-tap delete back to the shelf; play/pause + scrubber (`ReplaySession.seek` rebuilds the page instantly through event i, `Stage.settle()`) |

## The loop

1. `LiveSession.startListening` → OpenAI Realtime transcription when an OpenAI key is set (Settings → Ears auto), else Deepgram Nova-3 streaming when a Deepgram key is set, else `webkitSpeechRecognition`; `stt` can also pin any one of them. All three emit the same result list through the shared `pcm-mic.ts` mic. `TranscriptTracker` releases final results at once and interim words by per-recognizer rules (`CHROME_TRACKER`: stable 700ms, 5+ words, last word held back because Chrome rewrites the tail; `LIVE_TRACKER` for gpt-live-transcribe and `DEEPGRAM_TRACKER` for Deepgram: quiet 700ms, any count, nothing held back (a wrong guess is cheap: the director restarts an early call with the rest of the sentence); punctuation/rewritten tails are not treated as a final).
2. `Director.feed(words)` appends to `pending`; if no call is in flight, sends one: system prompt + user message (story tail, scene description, NEW WORDS). Words arriving while a call has drawn fewer than 3 lines abort it and re-send with the whole text (at most twice per beat; the session shows "hold on... drawing all of that"); deeper into a drawing they queue and go out together next.
3. Streamed text is split on newlines; each line → `parseLine` → `scene.apply` → `SceneEvent[]` → `stage.handle`. Nothing waits for the call to finish.
4. `Stage` converts shapes to strokes (outline, then hachure fill), queues them, and reveals along arc length each frame. Reveal speed rises with backlog, and past ~1s / ~2s of work at top speed a second / third lane draws another object at the same time (`LANE2_AT`, `LANE3_AT`; `stats.lanes`). The crayon cursor rides the stroke head; audio intensity follows.
5. Every emitted `words` chunk and every OK `cmd` line is recorded with a timestamp into the `StoryRecord`, autosaved 1.5s after the last event.
6. If the model answers `skip` (words not fit for a picture book, judged by meaning), the Director aborts the call, drops the words from its story tail, and the session pulls them out of the record and transcript, leaving a `(the crayon skipped a part)` marker. Nothing is drawn.
7. The subtitle shows three states: drawn words in ink, the in-flight call's words on a yellow highlight (`drawingWords`), words heard but not yet sent in grey (`queuedWords` + interim).
8. **The End.** Every chunk reaching `feed()` (speech and typed) runs through `splitTheEnd` (`story/the-end.ts`) before recording: words before the phrase are drawn as usual; if it ended, `endStory()` stops listening, waits for the director to go idle, records an `end` event, plays `stage.finale(seed)` (a "The End" title revealed on a top layer + star/sparkle bursts) with the page-flip sound, then shows the closing card (play it again / new story). Words after the end are ignored. Replay plays the same finale on the `end` event.

## Key types

- `Command` (`engine/types.ts`): obj, shape, stamp, end, mv, sc, flip, rm, anim, fx, say, bg, page, skip; engine-only (json dialect): layer, reset, recall, title.
- `Dialect` (`llm/dialect.ts`): system prompt + user message + `parse(line) -> Command[]`; a story record remembers its dialect so replay parses the same way.
- `SceneEvent` (`engine/scene.ts`): what the renderer consumes.
- `Stroke` (`engine/geometry.ts`): pts + cumulative lengths + clip polys; the unit of reveal.
- `StoryRecord` (`story/storage.ts`): `{ id, title, seed, cover, events: ({words}|{cmd}|{end})[] }`. The `end` event marks where the child said "The End"; replay draws the finale there.

## Gotchas

- **World is 160x100, ground at y=80.** Shapes inside an `obj` are relative to its anchor; negative y is up. The prompt and the engine must agree.
- **`page` wipes objects.** Characters from the previous page are kept in `Scene.carried`; a verb that references one recreates it on the new page (so `mv dragon` after `page` works even if the model forgot to redraw).
- **Three dialects, one engine.** `lines` (v1) is the original line DSL; `json` (v2) is NDJSON operations on a 1200x620 paper (ground y=525) with a `face` helper, poses, recolor, `scene` clear/keep; `ops` (v3, default) is the same operations as terse lines (`ent bunny 350 525 "white bunny" idle=breathe`, `draw bunny.head brown white circle 0 -170 48`, `face bunny head front`, `scene skyblue clear keep=bunny "the beach"`). `OpsDialect` parses a line into the untyped operation and hands it to `JsonDialect.applyRaw`, so ranges, defaults and behavior are one zod schema. The JSON dialect maps paper -> world with a uniform scale (x2/15) and a vertical offset that lands its ground on ours, keeps a side table of entity names and shape ids (shape replace by id, recolor), and describes the scene back (JSON, or ops lines via `describeScene`). Shape geometry is one of `path` (M/L/Q/C/Z, relative and H/V normalized by the ops parser), `circle`, `oval`, `rect`, `poly`, `stamp`; `mirror` also draws the x-mirror (pairs in one line). Colors accept crayon names or #hex, stored as hex. Part motion/pivot and `width` are accepted and ignored. `say` and `skip` are our extensions to that contract. Every example line in `ops-prompt.ts` must parse; a stray `.` or comma in a cookbook line becomes a model error.
- **Base breathing is tiny on purpose.** Every object gets a 0.6% breath/rotation; scenery (negative layer) half that; the sky/ground rect none. Sal asked for the background to move less.
- **`reset` keeps the drawn prefix.** Replacing a shape re-issues the whole shape list, but the stage keeps strokes of the leading unchanged shapes (per-shape stroke counts), so a face change or recolor only redraws the changed tail.
- **`s <fx-name>`** is accepted as an effect (models do this). A stamp as the first shape inside an `obj` whose relative position is off-page but whose absolute position fits is read as page coordinates (models write `obj house 40 80` / `s house 40 68`).
- **Determinism:** every stroke's wobble is seeded from `storySeed:objectId:strokeIndex` so replay looks identical. Do not use `Math.random()` in engine code.
- **Object bounds:** `contentBounds` is the unpadded union of shapes; `layerBounds` is the padded canvas. Never derive UI placement from `layerBounds`. Bubbles use `uprightBounds` (no rotation; the sweep circle for spin) and wait until the character is fully drawn.
- **Moderation is a flag.** Settings → "Kid-safe moderation" (`settings.moderation`, default on). Off: prompts lose the "For a small child" section (`*_UNMODERATED` constants) and `cleanText` passes text through (`setModeration`). Prompt side applies to the next new story; masking flips live.
- **Content filter is two layers.** The word masker (`story/clean.ts`) runs on the transcript before display/storage/model and on the model's `say`/`t` text. Contextual judgement (clean words, bad idea: "they went to the bathroom together") is the drawing model's job via `skip`; there is no separate classifier call, so it costs nothing extra. The kid's raw words are on screen for the ~0.5s before the model answers.
- **Transcription cost is an estimate, at the vendor's rate.** Audio ms actually sent over the socket are metered per recognizer (`onAudio`) and priced by `effectiveSttRate(settings)`: the user's `sttRateOverride` if set, else `sttRateFor(kind, model)` — OpenAI live $0.017/min, OpenAI pause-gated $0.006, Deepgram Nova-3 $0.0077, browser $0. Neither vendor reports transcription usage on the socket, so it stays an estimate; a stored old flat rate of exactly 0.006 migrates to "no override".
- **Deepgram ears.** `speech/deepgram.ts` is a flagged third transcriber (Settings → Ears → Deepgram, or auto with only a Deepgram key). Browser auth is the `['token', key]` subprotocol (no headers on a WebSocket; an empty key throws at construction, which surfaces as a `speech:` warning). Audio goes out as raw binary PCM16 frames (no base64); a KeepAlive every 5s after 4s of quiet stops Deepgram's ~10s idle close. `Results` messages carry `is_final` segments and interim text; `Metadata` arrives at stream END, not on open, so readiness is the socket's `open` event. **`is_final` is not "done talking":** Deepgram settles a segment every few seconds mid-sentence, so settled segments are folded into ONE live (non-final) result and only `speech_final` (`endpointing=700`) or `UtteranceEnd` (`utterance_end_ms=1000`) commit a real final. A beat therefore starts on Deepgram's end-of-speech, or on the tracker's 700ms quiet window when the mic is quiet, or at 14 words.
- **The tracker dedupes released words by content.** Deepgram's `speech_final` re-segments an already-released interim into a SHORTER final at a new result index, so position-based consumption cannot survive the shift and the overlap went out twice. `TranscriptTracker` keeps a rolling normalized `releasedTail` and drops any leading chunk words that repeat it. A final whose leading words disagree with what was released (Deepgram rewrote "Please" → "The") fires the `correct` callback; `LiveSession.correct` rewrites the record and transcript but NOT the Director (the model already drew from the old words, and that is fine). `DEEPGRAM_TRACKER.minWords` is 2 so a one-word interim beat never releases. Regression: `bun scripts/tracker-check.ts`.
- **The End is client-side.** `story/the-end.ts` matches the phrase on every chunk before it is recorded or sent; the model never sees "The End" (the prompts also tell it never to write those words). The finale is a stage-only top layer (`Stage.finale`), deterministic from the story seed; the `end` event replays it. `store.ended`/`store.ending` gate the closing card and hide the mic + typed input.
- **Mic energy holds a beat.** `session.ts` tracks `lastLoudAt` from the streaming recognizers' `onLevel` (`VOICE_LEVEL` 0.2 on the 0..1 level, `VOICE_HOLD_MS` 400, both in `speech/beat-rules.ts`) and passes `talking` into `tracker.tick`; while talking, the quiet-window early release is skipped (max-words and recognizer finals still fire). Chrome reports no level, so it is unaffected. If beats hold too long on a quiet mic, lower `VOICE_LEVEL`.
- **Vite full-reloads the page on any changed root file that is not a module** (a `.md` edit by a parallel session, `lab/` data the lab writes). `vite.config.ts` therefore watches only `src/`, `public/`, `scripts/`, the two html entries and `.env*` (`notSource`). Do not widen it: a running lab campaign lives in the page and dies on reload (it resumes from `lab/campaign.json`, a persisted `running` loads as `paused`).
- **The drawing lab is the way to change the prompt.** `lab.html` draws a phrase through the real dialect and stage, snapshots a 1280x800 JPEG (`Stage.showCursor = false` so the crayon is not in the judged image), has Sonnet 5 name it blind, has Opus 5.5 critique it against `cases.ts` expectations (every issue carries a general drawing rule), and once per round asks Opus 5.5 for find/replace edits to the prompt; a round is kept only if mean overall improves by `keepMinDelta` without output tokens growing past `maxOutputGrowth` or blind recognition falling. Prompt versions live in `lab/prompts/`; the app keeps using `src/llm/ops-prompt.ts` until you press Promote (Prompts tab), which rewrites the template literal in place. The `# Ops` grammar section is frozen by `validatePrompt`; the editor may only touch wording, cookbook, beats and the example. The SDK's `zodOutputFormat` (0.126) sends enums and min/max as `description` text, not JSON Schema constraints, so the judge parses the raw text through a lenient zod schema (`judge.ts`: unknown kind → `other`, numbers clamped) and retries once. First round finding: `mirror` reflects across the entity's x=0, so a side-view head at x=100 gets its mirrored ear at x=-100, floating left of the body.
- **Ask for the debug report before tuning anything.** Debug panel → "copy report" (or `window.__onceupon.report()`) dumps settings, tracker rules, every call (sent / first token / done / tokens / cost / restarts), and a merged timeline of the child's words, each DSL line as it landed, and the ears trace, all in ms since the session started (`LiveSession.t0`; call `sentAt` and `LineLog.t` are `performance.now()`, the ears trace is relative to `listenT0`, the report converts). The DSL line log keeps the last 200 lines and the ears trace the last 60 events; the story record itself is complete.
- **Never put story words in the transcription prompt.** Transcription models emit their prompt text during quiet/unclear audio; a vocabulary hint with "dragon, castle, exploded" produced phantom dragons in every session. The prompt is empty now. Mid-speech commits every 2.5s (`maxTurnMs`) keep words flowing while a child talks without pausing.
- **Voice lab first when ears feel wrong.** Debug panel: the green bar is mic level (if it barely moves, it is the device or the OS, not the model: pick another mic in Settings → Ears). "compare models on clip" runs the last 30s through three models; if whisper-1 and gpt-4o-transcribe get it right and the live one does not, it is the model. The trace under it shows every delta/final with ms since the click.
- **Mic startup:** socket and mic open in parallel; audio captured before `session.updated` is queued and flushed, so the first words after the click are never lost. `listening` in the store flips only on the recognizer's `onReady`; before that the button shows "one sec...". `warmMic()` pre-opens the mic on the story screen when permission is already granted.
- **STT model matters more than anything:** `gpt-live-transcribe` streams word by word (~1s behind the voice, no turn detection allowed, only delta events on one item; sentence punctuation is our "final"). `gpt-transcribe` / `gpt-4o-transcribe` only return after a pause. Default is the live model; the others remain selectable.
- **OpenAI Realtime:** the beta shape (`OpenAI-Beta` header, `transcription_session.update`, `openai-beta.realtime-v1` subprotocol) is retired and errors. Transcripts arrive as word deltas ~0.3s after the speaker pauses (server VAD, 450ms), not mid-sentence.
- **bx tabs are throttled** (rAF ~1/s when unfocused): drawing looks 10x slow there and short effects vanish between frames. Use `stage.setInstant(true)` via `window.__onceupon` for screenshots; timing bugs must be judged in a focused tab.
- **Video export is the live engine on a VirtualClock.** Never add a second renderer: anything that reads `performance.now()` or `setTimeout` in the draw path must go through the Stage/dialect `clock`, or exported frames drift from replay and stop being deterministic. Export canvases are CPU (`willReadFrequently`, Stage `software: true`): GPU canvases differed by a few pixels run to run. Chrome's software H.264 encoder (OpenH264) is NOT deterministic; the hardware one is, so the exporter prefers hardware. Audio is encoded up front with `AudioEncoder` and interleaved in a fixed order, so two exports differ only in the mvhd/tkhd/mdhd creation times. The book in `export/frame.ts` copies `.storybook` CSS values: change both together. The corner logo is a placeholder wordmark in `drawLogo()`.
- **Automated Chrome here exits on any download** (even a 5-byte blob), in bx and plain Playwright. To verify exports, capture the Blob instead (see verify.md).
- **Resize** re-rasterizes all layers (`Stage.rebuildLayer`). Layers are capped at 4096px.
- **Prompt caching needs a 4096-token prefix on Haiku 4.5** (1024 on Sonnet 5, 512 on Opus 5). Both system prompts carry a cookbook + story-beat section partly to be useful and partly to clear that bar; below it Anthropic silently caches nothing. The user message is blocks: header, one block per story chunk with the breakpoint on the last (`storyBlocks`), then the per-call tail, so each call reads the earlier story from cache and writes only the new chunk (hits are at block boundaries only). Debug panel shows `in/cacheWrite/cacheRead` per call; verify with the recipe in verify.md if it ever reads 0 again.
- **Thinking is switched off** for Sonnet 5 / Opus 5 in `providers.ts` for first-token speed.
- The Anthropic call uses `dangerouslyAllowBrowser`. That is the design for now (localhost). See decisions.md.
- The only `as` cast in the app is the constructor boundary in `speech/recognition.ts`.
- Web Speech only exists in Chrome/Edge. The typed-sentence input at bottom-right is the mic-free path (also what `bx` tests use).

## Status

- Drawing screen redesigned for iPad: stitched book, welcome illustration, separate mic dock, safe-area/portrait/compact layouts, optional typing, earlier-page tray, new-story confirmation, and finale actions. Backgrounding pauses listening and saves. Existing browser-direct keys/settings remain; this is the drawing UI, not the native/server launch milestone.

- Default drawing language is `ops` (v3) since 2026-09-22. Side-by-side on Sonnet 5, same two sentences: json 2230 + 934 output tokens, 17.7s + 8.9s, $0.052; ops 649 + 293 tokens, 7.4s + 3.6s, $0.013, picture equal or better (mirrored pairs, true circles). `json` and `lines` stay selectable and saved stories replay in the dialect they were recorded with.
- Earlier experiment: JSON ops dialect on Haiku 4.5, same opening sentence: first token ~500ms either way; JSON call 1116 output tokens / 6.5s / $0.008 vs lines ~200 tokens / ~2.5s / ~$0.002.
- Done: DSL, renderer, effects, audio, speech intake, director, providers, settings, subtitles (three-state), filmstrip, bookshelf, replay with narration captions, kid-safety (`skip` + masker), per-call usage + cost + estimated ears cost (Anthropic from stream usage; OpenRouter reports cost; OpenAI priced only if added to PRICING). Typed-input path verified end to end on Haiku 4.5 (first token 0.6 to 1.1s).
- OpenAI Realtime transcription verified from a script with synthesized speech (GA endpoint `?intent=transcription`, `session.update` with `type: transcription`, subprotocol auth). Live mic on it not yet confirmed by a human. OpenRouter/OpenAI LLM providers still unverified.
- MP4 export (`features/mp4-export.md`): download video from replay and the closing card, storybook frame, crayon audio, captions, corner logo, end card; deterministic. The child's voice track is a seam only.
- Ideas not built: story summary compaction for very long stories, per-model prompt variants.
