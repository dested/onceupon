# Decisions

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
