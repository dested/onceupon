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
- When interim words have been stable for ~900ms and there are 6 or more of them, all but the last word are sent early. If 14 or more pile up they go regardless.
- While a model call is in flight, new words accumulate and are sent as one chunk when it finishes. Never two calls at once.
- Each streamed DSL line executes as soon as its newline arrives. The first stroke appears at first-token time, not at call end.
- Reveal speed rises with the stroke backlog so drawing catches up within ~2 seconds of speech.
- Unknown lines are logged in the debug panel and skipped; the story continues.
- `page` snapshots the current page into the filmstrip, slides it away, and starts a fresh page. Characters referenced afterwards are recreated from the previous page automatically.
- Every words chunk and every executed line is recorded with a timestamp; the story autosaves to localStorage 1.5s after the last event and when leaving the screen.
- "New story" starts a fresh session (new seed, empty page, new record).
- Typing a sentence in the bottom-right box behaves exactly like speaking it.
- The subtitle line shows drawn words in ink, the words of the call in flight on a yellow highlight, and words heard but not yet sent in grey. The mic status names the same thing ("drawing the yellow bit! keep going").
- If the model answers `skip`, nothing is drawn, the words are removed from the story and transcript, a `(the crayon skipped a part)` marker takes their place, and "the crayon skipped that part" shows under the mic for 4s. Rude words are masked everywhere they are shown or saved.
- Replay shows each heard chunk as a caption near the top of the page as it is reached, plus the running subtitle.
- The drawing language is chosen in Settings and fixed per story: `lines` (v1) or `json` (v2, NDJSON operations with paths, face helper, poses, recolor, scene keep). Both run the same renderer; a story replays in the language it was told in.
- Audio sent to the OpenAI transcriber is metered; the spend chip shows an estimated ears cost at the per-minute rate from Settings.

## Open questions

- Should very long stories get a rolling summary instead of the last 700 chars of transcript?
- Should the child be able to say "clear the page" / "start over" as voice commands?
