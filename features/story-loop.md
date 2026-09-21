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
- Interim words are released early by rules that match the recognizer. Chrome: stable for 700ms with 5 or more words, all but the last word go (Chrome rewrites the tail). OpenAI live model: quiet for 1100ms (on top of its own ~1s lag), every word goes, because it appends and never rewrites; punctuation does not count as done. If 14 or more pile up they go regardless.
- While a model call is in flight, new words accumulate and are sent as one chunk when it finishes. Never two calls at once.
- Each streamed DSL line executes as soon as its newline arrives. The first stroke appears at first-token time, not at call end.
- Reveal speed rises with the stroke backlog so drawing catches up within ~2 seconds of speech; a large backlog is drawn by two or three crayons at once (different objects in parallel).
- Unknown lines are logged in the debug panel and skipped; the story continues.
- `page` snapshots the current page into the filmstrip, slides it away, and starts a fresh page. Characters referenced afterwards are recreated from the previous page automatically.
- Every words chunk and every executed line is recorded with a timestamp; the story autosaves to localStorage 1.5s after the last event and when leaving the screen.
- "New story" starts a fresh session (new seed, empty page, new record).
- Typing a sentence in the bottom-right box behaves exactly like speaking it.
- The subtitle line shows drawn words in ink, the words of the call in flight on a yellow highlight, and words heard but not yet sent in grey. The mic status names the same thing ("drawing the yellow bit! keep going").
- Moderation can be switched off in Settings (for testing): no safety section in the prompt for the next story, no word masking.
- If the model answers `skip`, nothing is drawn, the words are removed from the story and transcript, a `(the crayon skipped a part)` marker takes their place, and "the crayon skipped that part" shows under the mic for 4s. Rude words are masked everywhere they are shown or saved.
- Replay shows each heard chunk as a caption near the top of the page as it is reached, plus the running subtitle.
- Replay has a scrubber (event index) and play/pause. Dragging rebuilds the page instantly through that event with a fresh scene, then continues in the same play state; at the end the button becomes "again". Page thumbnails for pages passed during a scrub are not captured.
- Voice lab in the debug panel: mic level meter (also a small bar under the mic while listening), a trace of transcriber events with timestamps, save the last 30s of sent audio as WAV, and compare three OpenAI models on that clip. Settings → Ears lets you pick the microphone device (OpenAI ears only).
- Audio sent to the OpenAI transcriber is metered; the spend chip shows an estimated ears cost at the per-minute rate from Settings.

## Open questions

- Should very long stories get a rolling summary instead of the last 700 chars of transcript?
- Should the child be able to say "clear the page" / "start over" as voice commands?
