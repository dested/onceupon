# Once Upon — cliffnotes

> Living map of the project. Read first, every task. Last updated: 2026-09-20

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
    audio.ts               synthesized crayon scratch + page flip (Web Audio)
  llm/
    models.ts              provider + preset model list, per-MTok pricing, estimateCost()
    providers.ts           LlmProvider: Anthropic SDK (browser-direct) and OpenAI-compatible SSE (OpenRouter, OpenAI)
    prompt.ts              SYSTEM_PROMPT (the whole DSL spec + example) and buildUserMessage()
    director.ts            Director: words in -> one streaming call at a time -> execute lines as they land
  speech/
    recognition.ts         typed boundary over webkitSpeechRecognition + TranscriptTracker (when words are "ready")
    openai-realtime.ts     OpenAI Realtime transcription over a browser WebSocket (PCM16 via AudioWorklet), same Recognizer shape
  story/
    store.ts               app state (useSyncExternalStore), settings load/persist, env keys via zod
    storage.ts             StoryRecord zod schema, localStorage list/get/save/delete
    replay.ts              Replayer: plays a StoryRecord through a Director with gaps capped
    session.ts             LiveSession (mic + director + stage + autosave) and ReplaySession
  ui/
    StoryScreen.tsx        canvas, mic button, toolbar, typed-input fallback, warnings, panels
    Subtitles.tsx          one clipped line along the bottom; newest words stay visible (float-right trick)
    SpendChip.tsx          running $ / calls / time-to-first-stroke under the toolbar
    Filmstrip.tsx          thumbnails of earlier pages, top-left
    SettingsPanel.tsx      provider/model picker + API key
    DebugPanel.tsx         latency stats + raw DSL stream (backtick key)
    Bookshelf.tsx          saved stories grid, play, two-tap delete
    ReplayScreen.tsx       replay canvas + play again
    bits.tsx               StickerButton, IconButton, PaperCard
features/                  feature specs
plans/                     dated working docs
```

## File map (concept -> where)

| Want to change...                    | Go to                                              |
| ------------------------------------ | -------------------------------------------------- |
| what the model is told / DSL wording | `src/llm/prompt.ts`                                |
| a DSL verb's syntax                  | `src/engine/dsl.ts` + `types.ts` + prompt          |
| how strokes look (width, wobble)     | `src/engine/geometry.ts` consts, `brush.ts` dabs   |
| reveal speed / catch-up              | `src/engine/stage.ts` `OUTLINE_SPEED` etc          |
| idle motion / anim kinds             | `stage.ts` `objectTransform`                       |
| add a stamp                          | `src/engine/stamps.ts` (and STAMP_NAMES)           |
| add an effect                        | `src/engine/fx.ts` + FX_KINDS                      |
| when speech chunks are sent          | `src/speech/recognition.ts` `TranscriptTracker`    |
| which transcriber is used            | `src/story/store.ts` `resolveStt`, `session.ts` `startListening` |
| call scheduling / prompt assembly    | `src/llm/director.ts`                              |
| model presets                        | `src/llm/models.ts`                                |
| save format                          | `src/story/storage.ts`                             |
| what counts as not-for-kids          | `src/llm/prompt.ts` "For a small child" (the model judges, answers `skip`); `src/story/clean.ts` word masker |
| ears cost / spend chip               | `src/story/store.ts` `Spend.audioMs`, `settings.sttRatePerMin`; `src/ui/SpendChip.tsx` |

## Screens

| Screen | Component      | Notes                                                   |
| ------ | -------------- | ------------------------------------------------------- |
| story  | `StoryScreen`  | default; remounts on "New story" (storyNonce)            |
| shelf  | `Bookshelf`    | opens from the book icon                                |
| replay | `ReplayScreen` | keyed by story id; autoplays                            |

## The loop

1. `LiveSession.startListening` → OpenAI Realtime transcription when an OpenAI key is set (Settings → Ears), else `webkitSpeechRecognition`. Both emit the same result list. `TranscriptTracker` releases final results at once and interim words by per-recognizer rules (`CHROME_TRACKER`: stable 700ms, 5+ words, last word held back because Chrome rewrites the tail; `LIVE_TRACKER` for gpt-live-transcribe: stable 600ms, any count, nothing held back, since its deltas are append-only and finals only come on sentence punctuation).
2. `Director.feed(words)` appends to `pending`; if no call is in flight, sends one: cached `SYSTEM_PROMPT` + user message (story tail, `scene.summary()`, NEW WORDS). Words arriving mid-call go out together next.
3. Streamed text is split on newlines; each line → `parseLine` → `scene.apply` → `SceneEvent[]` → `stage.handle`. Nothing waits for the call to finish.
4. `Stage` converts shapes to strokes (outline, then hachure fill), queues them, and reveals along arc length each frame. Reveal speed rises with backlog so it never falls far behind speech. The crayon cursor rides the stroke head; audio intensity follows.
5. Every emitted `words` chunk and every OK `cmd` line is recorded with a timestamp into the `StoryRecord`, autosaved 1.5s after the last event.
6. If the model answers `skip` (words not fit for a picture book, judged by meaning), the Director aborts the call, drops the words from its story tail, and the session pulls them out of the record and transcript, leaving a `(the crayon skipped a part)` marker. Nothing is drawn.
7. The subtitle shows three states: drawn words in ink, the in-flight call's words on a yellow highlight (`drawingWords`), words heard but not yet sent in grey (`queuedWords` + interim).

## Key types

- `Command` (`engine/types.ts`): obj, shape, stamp, end, mv, sc, flip, rm, anim, fx, say, bg, page, skip.
- `SceneEvent` (`engine/scene.ts`): what the renderer consumes.
- `Stroke` (`engine/geometry.ts`): pts + cumulative lengths + clip polys; the unit of reveal.
- `StoryRecord` (`story/storage.ts`): `{ id, title, seed, cover, events: ({words}|{cmd})[] }`.

## Gotchas

- **World is 160x100, ground at y=80.** Shapes inside an `obj` are relative to its anchor; negative y is up. The prompt and the engine must agree.
- **`page` wipes objects.** Characters from the previous page are kept in `Scene.carried`; a verb that references one recreates it on the new page (so `mv dragon` after `page` works even if the model forgot to redraw).
- **`s <fx-name>`** is accepted as an effect (models do this). A stamp as the first shape inside an `obj` whose relative position is off-page but whose absolute position fits is read as page coordinates (models write `obj house 40 80` / `s house 40 68`).
- **Determinism:** every stroke's wobble is seeded from `storySeed:objectId:strokeIndex` so replay looks identical. Do not use `Math.random()` in engine code.
- **Object bounds:** `contentBounds` is the unpadded union of shapes; `layerBounds` is the padded canvas. Never derive UI placement from `layerBounds`. Bubbles use `uprightBounds` (no rotation; the sweep circle for spin) and wait until the character is fully drawn.
- **Content filter is two layers.** The word masker (`story/clean.ts`) runs on the transcript before display/storage/model and on the model's `say`/`t` text. Contextual judgement (clean words, bad idea: "they went to the bathroom together") is the drawing model's job via `skip`; there is no separate classifier call, so it costs nothing extra. The kid's raw words are on screen for the ~0.5s before the model answers.
- **Transcription cost is an estimate.** Audio ms actually sent over the socket are metered in `send()` (`onAudio`), priced at `settings.sttRatePerMin` (default $0.006). OpenAI does not report transcription usage on the Realtime socket.
- **Never put story words in the transcription prompt.** Transcription models emit their prompt text during quiet/unclear audio; a vocabulary hint with "dragon, castle, exploded" produced phantom dragons in every session. The prompt is empty now. Mid-speech commits every 2.5s (`maxTurnMs`) keep words flowing while a child talks without pausing.
- **Mic startup:** socket and mic open in parallel; audio captured before `session.updated` is queued and flushed, so the first words after the click are never lost. `listening` in the store flips only on the recognizer's `onReady`; before that the button shows "one sec...". `warmMic()` pre-opens the mic on the story screen when permission is already granted.
- **STT model matters more than anything:** `gpt-live-transcribe` streams word by word (~1s behind the voice, no turn detection allowed, only delta events on one item; sentence punctuation is our "final"). `gpt-transcribe` / `gpt-4o-transcribe` only return after a pause. Default is the live model; the others remain selectable.
- **OpenAI Realtime:** the beta shape (`OpenAI-Beta` header, `transcription_session.update`, `openai-beta.realtime-v1` subprotocol) is retired and errors. Transcripts arrive as word deltas ~0.3s after the speaker pauses (server VAD, 450ms), not mid-sentence.
- **bx tabs are throttled** (rAF ~1/s when unfocused): drawing looks 10x slow there and short effects vanish between frames. Use `stage.setInstant(true)` via `window.__onceupon` for screenshots; timing bugs must be judged in a focused tab.
- **Resize** re-rasterizes all layers (`Stage.rebuildLayer`). Layers are capped at 4096px.
- **Thinking is switched off** for Sonnet 5 / Opus 5 in `providers.ts` for first-token speed.
- The Anthropic call uses `dangerouslyAllowBrowser`. That is the design for now (localhost). See decisions.md.
- The only `as` cast in the app is the constructor boundary in `speech/recognition.ts`.
- Web Speech only exists in Chrome/Edge. The typed-sentence input at bottom-right is the mic-free path (also what `bx` tests use).

## Status

- Done: DSL, renderer, effects, audio, speech intake, director, providers, settings, subtitles (three-state), filmstrip, bookshelf, replay with narration captions, kid-safety (`skip` + masker), per-call usage + cost + estimated ears cost (Anthropic from stream usage; OpenRouter reports cost; OpenAI priced only if added to PRICING). Typed-input path verified end to end on Haiku 4.5 (first token 0.6 to 1.1s).
- OpenAI Realtime transcription verified from a script with synthesized speech (GA endpoint `?intent=transcription`, `session.update` with `type: transcription`, subprotocol auth). Live mic on it not yet confirmed by a human. OpenRouter/OpenAI LLM providers still unverified.
- Ideas not built: export replay to video, story summary compaction for very long stories, per-model prompt variants.
