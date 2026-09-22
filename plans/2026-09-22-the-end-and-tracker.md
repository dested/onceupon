# The End, and words that arrive twice

- **Date:** 2026-09-22
- **Status:** done
- **Type:** plan
- **What:** four fixes from Sal's Sep 22 Deepgram session: (1) the tracker re-emits already-released words when a final lands and cannot correct a released interim; (2) saying "The End" ends the story: stop listening, play a finale, show the closing card; (3) no one-word beats on Deepgram; (4) the voice-lab trace drops empty deltas. Spec for an Opus builder; every decision is made here.

## Evidence (debug report, 2026-09-22 18:11)

- Transcript: `...a dragon who hung out with hung out with a princess.` Call 1 got `...who hung out with` (interim release, consumed[0]=12), then Deepgram's `speech_final` committed a final at index 0 that was SHORTER than the released interim (`...a dragon who`, 9 words; Deepgram re-segments). The tracker set consumed[0]=9 and the live result moved to index 1 (`hung out with a princess.`) with consumed[1]=0, so the overlap went out again. Position-based consumption cannot survive an index shift; only content can.
- Interim `Please` was released; the final at that index was `The end.`; the tracker emitted `end.` and the story now reads `Please end.` The words the model saw are gone, but the record and transcript can still be corrected.
- The child said "The End", the model drew a celebration and `say princess the end!`, and the meter kept running.
- Call 10 sent the single word `Please` as a beat.
- The trace logged an empty `delta` every ~1 s of silence.

## 1. Tracker: content-based dedupe and corrections (`src/speech/recognition.ts`)

`TranscriptTracker` gains a rolling memory of released words and a correction callback.

```ts
export interface TrackerCallbacks {
  emit: (words: string) => void
  /** A final disagreed with interim words already released for the same stretch of speech. */
  correct?: (released: string, actual: string) => void
}
constructor(cb: TrackerCallbacks | ((words: string) => void), opts: TrackerOptions = CHROME_TRACKER)
```

Accept the old function form so nothing else breaks; normalize internally to `TrackerCallbacks`.

- Keep `private releasedTail: string[]` (normalized words, cap 24) across all result indexes. `normalize(w) = w.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '')`, drop empties.
- A private `release(chunkWords: string[])` does every emission (both `onResult` finals and `tick`): compute the longest `k` (0..min(chunk.length, releasedTail.length)) such that the normalized first `k` words of the chunk equal the normalized last `k` words of `releasedTail`; drop those `k`; if nothing remains, emit nothing; else append the normalized remainder to `releasedTail`, add the original-cased remainder to `finalText`, and call `emit`. Exact-match on normalized words only; no fuzzy matching.
- Corrections: keep `private releasedByIndex = new Map<number, string[]>()` (original-cased words released from index i). On a final at index i with `c = consumed(i)`: if `c > 0` and the normalized `words.slice(0, c)` differs from the normalized `releasedByIndex.get(i)`, call `correct(releasedJoined, words.slice(0, c).join(' '))` before handling the remainder. Also update `releasedTail`'s corresponding entries so later dedupe uses the corrected words. `reset()` clears `releasedByIndex` but NOT `releasedTail` (a recognizer restart must not re-emit the same sentence).
- `DEEPGRAM_TRACKER.minWords` becomes 2 with the comment: a one-word interim beat ("Please") draws nothing and wastes a call; finals still release at any length because `onResult` never applies `minWords`.
- `scripts/tracker-check.ts` (bun, no framework): feed `TranscriptTracker` the two exact sequences from the evidence and a normal sequence, using the `DEEPGRAM_TRACKER` rules and a fake clock: assert the emitted chunks are `["Once upon a time, there was a dragon who hung out with", "a princess."]` for the dup case, that the Please case emits `["Please", "end."]` AND fires `correct("Please", "The")`, and that a plain three-final sequence emits each final once. Exit 1 on any mismatch, print a table otherwise. Runs with `bun scripts/tracker-check.ts`.

## 2. Corrections in the session (`src/story/session.ts`)

Construct the tracker with `{ emit: (w) => this.feed(w), correct: (released, actual) => this.correct(released, actual) }`.

`correct(released, actual)`: like `skip()`, walk `this.story.events` backwards over `words` events until their joined text ends with `cleanText(released)` (compare normalized); if not found, return. Replace that trailing text inside those events with `cleanText(actual)` (rewrite the last event's `text`; if the released text spans several events, collapse them into one event at the earliest `t`). Rebuild `transcriptFinal` from the events (same code as `skip()`, extract a private `transcriptFromEvents()` used by both). Schedule the autosave. Do NOT touch the Director (the model already drew from the old words; that is fine).

## 3. The End (`src/story/session.ts`, `src/story/storage.ts`, `src/story/replay.ts`, `src/engine/stage.ts`, `src/ui/StoryScreen.tsx`, `src/story/store.ts`)

Detection is client-side, on every chunk that reaches `feed()` (speech and typed), before recording:

```ts
/** "the end", "and that's the end", "the end!" as the last words of a chunk. */
export const THE_END = /(?:^|\s)(?:and\s+)?(?:that'?s\s+|this\s+is\s+)?the\s+end[\s.!?]*$/i
```

in a new `src/story/the-end.ts` exporting `THE_END` and `splitTheEnd(text): { before: string; ended: boolean }` (the text with the match removed, trimmed, and whether it matched).

`feed(raw)`: `const { before, ended } = splitTheEnd(cleanText(raw))`; if `before` is non-empty it is recorded and fed to the director exactly as today; if `ended` and the story has not ended already: `this.endStory()`.

`endStory()`:
1. `this.ended = true`; `stopListening()`; record `{ k: 'words', t, text: 'The End' }` (shows in captions); `appStore.set({ ending: true })`.
2. When the director is idle (its next `status: 'idle'` event; if it is idle now, immediately), record `{ k: 'end', t }`, call `this.stage.finale(seedFor(this.story))`, play the page-flip sound, and after the finale's reveal finishes (the stage resolves a promise) `appStore.set({ ending: false, ended: true })` and `save()`.
3. Words that arrive after `ended` (typed input, a late Deepgram final) are ignored.

`StoryEvent` gains `z.object({ k: z.literal('end'), t: z.number() })`. Any code that switches over `k` handles it (debug report timeline prints `the end`). `Replayer`: on an `end` event call `stage.finale(seed)`; `seek()` past it renders the finale settled (via `settle()`), like every other event. `words: 'The End'` is excluded from `titleFromWords` like `SKIPPED_MARK`.

`Stage.finale(seed): Promise<void>`: one new top layer (above all objects, no idle motion) that reveals, with the crayon cursor and scratch audio, the words `The End` in the scrawl hand centered on the page at ~1/4 page height, using the existing text stamping in `brush.ts` (same seeded wobble: `${seed}:finale`); then a burst of `stars` across the upper half and `sparkle` around the title (existing fx kinds, three bursts, positions fixed from the seed). Resolve when the last stroke is revealed. `settle()` snaps it complete. The layer survives `resize()` like the others.

`AppState` gains `ending: boolean` and `ended: boolean` (both false on new story). `StoryScreen`: when `ending` or `ended`, hide the mic button and the typed input; the status line reads `the end!`; when `ended`, a `PaperCard` at bottom center (StickerButtons, per ui.md): `play it again` (opens the replay of this story, same as the shelf's play), `new story` (existing new-story path). No share button yet (share is not built). The note style and testids follow the existing patterns (`data-testid="the-end-card"`).

Prompt: no change is needed for detection (the model never sees the words), but add one sentence to the "story beats" section of `ops-prompt.ts` and `json-prompt.ts` and `prompt.ts`: `The app ends the story itself when the child says "The End"; never write those words or announce an ending.` Keep the examples' parser harness passing (`ops-prompt.ts` lines are checked; do not add example lines).

## 4. Trace noise (`src/speech/deepgram.ts`)

In the `Results` branch, do not call `onTrace('delta', ...)` when the transcript is empty (still update `interim` and `emit`). Settled and final traces unchanged.

## Docs (part of done)

- `cliffnotes.md`: the loop (a step for The End: detection, finale, record event), Key types (`StoryEvent` has `end`), file map row "The End phrase", gotchas: the tracker dedupes by content because Deepgram's finals re-segment shorter than the interim; a correction rewrites the record but not what the model saw. Tree: `src/story/the-end.ts`, `scripts/tracker-check.ts`.
- `decisions.md`: "2026-09-22 — The End is detected on the client, not by the model" (why: zero latency, works with any ears, stops the meter; rejected: teaching the model an `end` op) and "2026-09-22 — Tracker dedupes released words by content" (why: index shift on Deepgram commits; rejected: holdBack 1 on Deepgram (slower first stroke), making the recognizer hide segment boundaries (it already does; the shift is inherent)).
- `features/story-loop.md`: behavior bullets for The End and corrections.
- `verify.md`: `[cheap]` recipes: `bun scripts/tracker-check.ts`; typed path `Once upon a time a dragon lived in a castle. The End` → finale plays, mic and typed input gone, `the-end-card` shows, Bookshelf → Play ends with the same finale; scrub to the end shows it settled.
- `updates.md` entry; flip this plan to `done`.

## Constraints

- No `any`, no new `as` casts, strict TS; `bun run typecheck` green; prettier only on files you changed, by path (`bunx prettier --write <files>`); never `bun run prettier` (repo-wide).
- Never run git commands that rewrite the working tree (stash, checkout, restore, reset, clean). Do not commit. Another session edited this tree today; re-read every file right before editing it and use in-place edits.
- Do not touch `src/llm/ops-dsl.ts`, `json-dsl.ts`, `dialect.ts`, `ops-prompt.ts` beyond the one prompt sentence.
- Determinism: nothing in the finale uses `Math.random()`.
