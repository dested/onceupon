# Live story loop

- **Status:** done (first cut)
- **Owner files:** `src/story/session.ts`, `src/llm/director.ts`, `src/speech/recognition.ts`, `src/engine/*`

## What it is

The child talks; the crayon draws what they say while they say it. This doc is the behavior
spec for the talk → draw loop. The DSL itself is documented in `src/llm/prompt.ts` (the system
prompt is the spec the model sees).

## Behavior spec

- When the mic button is tapped, audio starts (crayon scratch sound), speech recognition starts, and the status reads "listening...".
- When the recognizer finalizes a phrase, those words are sent to the model immediately.
- Interim words are released early by rules that match the recognizer. Chrome: stable for 700ms with 5 or more words, all but the last word go (Chrome rewrites the tail). OpenAI live model: quiet for 700ms (on top of its own ~1s lag), every word goes, because it appends and never rewrites; punctuation does not count as done. If 14 or more pile up they go regardless.
- While a model call is in flight, new words accumulate and are sent as one chunk when it finishes. Never two calls at once. Exception: if the call has drawn fewer than 3 lines when more words arrive (the child paused mid-sentence), it is aborted and re-sent with the whole sentence, at most three times per beat; a "hold on... drawing all of that" note shows until that call finishes.
- Each streamed DSL line executes as soon as its newline arrives. The first stroke appears at first-token time, not at call end.
- Reveal speed rises with the stroke backlog so drawing catches up within ~2 seconds of speech; a large backlog is drawn by two or three crayons at once (different objects in parallel).
- Unknown lines are logged in the debug panel and skipped; the story continues.
- `page` snapshots the current page into the filmstrip, slides it away, and starts a fresh page. Characters referenced afterwards are recreated from the previous page automatically.
- Every words chunk and every executed line is recorded with a timestamp; the story autosaves to localStorage 1.5s after the last event and when leaving the screen.
- "New story" starts a fresh session (new seed, empty page, new record). A story is only saved once it has words; stories can be deleted from the shelf (per card, or all empty ones at once) and from inside a replay, always with a second tap to confirm.
- Or type opens a keyboard form; typing a sentence behaves exactly like speaking it. Escape closes the form.
- The iPad drawing screen keeps navigation and the microphone dock outside the picture-book canvas. Welcome artwork disappears as soon as words arrive; the page button opens earlier thumbnails. New story asks before leaving an unfinished story.
- Backgrounding the document stops listening and saves the current story. Returning does not restart the microphone automatically.
- The subtitle line shows drawn words in ink, the words of the call in flight on a yellow highlight, and words heard but not yet sent in grey. The paper status describes thinking/drawing; the mic dock describes listening and pausing.
- Moderation can be switched off in Settings (for testing): no safety section in the prompt for the next story, no word masking.
- If the model answers `skip`, nothing is drawn, the words are removed from the story and transcript, a `(the crayon skipped a part)` marker takes their place, and "the crayon skipped that part" shows under the mic for 4s. Rude words are masked everywhere they are shown or saved.
- When the child says "The End" (on any ears, or typed), the app ends the story itself: it stops listening, lets the current drawing finish, plays a "The End" finale (a handwritten title revealed on a top layer with a star/sparkle burst) with a page-flip sound, then shows a closing card with "play it again" (opens this story's replay) and "new story". The mic button and typed input are hidden once it is ending. Detection is client-side and the model never sees the phrase. Words after the end are ignored. Replay draws the same finale where the child said it.
- When a final from the recognizer disagrees with interim words already drawn (Deepgram rewrites the tail, "Please" → "The"), the record and transcript are corrected to the actual words; the drawing is left as it was, because the model already drew from what it heard. Interim words that a later final only re-segments (moves to a new index) are not repeated in the transcript.
- Replay shows each heard chunk as a caption near the top of the page as it is reached, plus the running subtitle.
- Replay has a scrubber (event index) and play/pause. Dragging rebuilds the page instantly through that event with a fresh scene, then continues in the same play state; at the end the button becomes "again". Page thumbnails for pages passed during a scrub are not captured.
- The drawing language is chosen in Settings and fixed per story: `lines` (v1) or `json` (v2, NDJSON operations with paths, face helper, poses, recolor, scene keep). Both run the same renderer; a story replays in the language it was told in.
- Speech to text has three vendors, chosen in Settings → Ears (auto picks OpenAI when its key is set, else Deepgram when its key is set, else Chrome). Each releases words on its own tracker: Chrome (`CHROME_TRACKER`, holds the last word back), OpenAI live and Deepgram (`LIVE_TRACKER` / `DEEPGRAM_TRACKER`, quiet-window only, nothing held back), OpenAI pause-gated (`PHRASE_TRACKER`). All three run through the shared `pcm-mic.ts` mic and present the same result shape.
- Voice lab in the debug panel: mic level meter (also a small bar under the mic while listening), a trace of transcriber events with timestamps, save the last 30s of sent audio as WAV, and compare three OpenAI models on that clip. Settings → Ears lets you pick the microphone device (OpenAI or Deepgram ears).
- Audio sent to a paid transcriber is metered; the development drawing lab’s spend chip shows an estimated ears cost at the resolved vendor's per-minute rate (OpenAI live $0.017, Deepgram $0.0077), which the user can override in Settings.

## Open questions

- Should very long stories get a rolling summary instead of the last 700 chars of transcript?
- Should the child be able to say "clear the page" / "start over" as voice commands?
