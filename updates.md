# Updates

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
