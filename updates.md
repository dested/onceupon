# Updates

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
