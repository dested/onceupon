# Verify

## Cheap checks [cheap]

```
bun run typecheck
bun run dev            # http://localhost:7710
```

## Typed story path [cheap]

Needs an Anthropic key in `.env.local` or Settings.

1. Open http://localhost:7710, click the bug icon (or press backtick) for the debug panel.
2. In the bottom-right input type: `Once upon a time a big green dragon lived in a castle with a princess`, Enter.
3. Expect: sky/ground fill, a dragon on the left, castle right, latency row in the debug panel (first token under ~1.5s on Haiku).
4. Type: `then the dragon flew to the beach and ate a giant ice cream`, Enter.
5. Expect: a page turn (filmstrip thumbnail top-left), the dragon redrawn/carried over, ice cream then removed with sparkle.

With bx: `bx open http://localhost:7710`, `bx fill typed "<sentence>"`, `bx press Enter`, `bx wait 7000`, `bx snap`.

## Kid-safety skip [cheap]

1. Type: `a bunny and a fox went to the bathroom together`, Enter.
2. Expect within ~1s: nothing drawn, "the crayon skipped that part" under the mic for 4s, subtitle shows `(the crayon skipped a part)`, debug panel logs a `skip` line. The story title never contains the marker.
3. Type a rude word in a sentence: it shows masked (`s***`) in the subtitle and the saved title.

## Subtitle states [cheap]

Type two sentences quickly. The first sentence sits on a yellow highlight while its call streams (`[data-testid=subtitles-drawing]`); the second is grey (`subtitles-waiting`) until its own call starts. Mic status reads "drawing the yellow bit! keep going".

## JSON ops dialect [cheap]

Settings → Drawing language → json ops, then New story. Type the dragon sentence. Expect: paper-colored background, grass strip, a two-tone dragon with two eyes and a mouth from the face helper, a house, a sun; the debug panel shows `{"op":...}` lines with no errors. Type `then the dragon flew to the house and the house exploded and the dragon was sad`: move, burst, scribble-out, smoke, a sad mouth (face redrawn without redrawing the body), a bubble. Bookshelf → Play replays it identically.

Direct engine check without a model: `window.__onceupon.director.execute('{"op":"entity",...}')` per line; `director.dialect.snapshot()` returns the JSON the model sees.

## Replay and bookshelf [cheap]

1. Book icon → a card for the story above with a cover.
2. Play → drawing replays; each heard chunk appears as a paper caption near the top (`[data-testid=narration]`) as it is reached. Bottom bar: pause/play and a slider (`[data-testid=scrubber]` shows `i/n`). Drag the slider: the page jumps to that point fully drawn and keeps playing; pause holds the position; at the end the button reads "again".
3. Delete → "sure?" → card gone. Inside a replay, the trash icon top-right → "delete this story?" → back on the shelf without it. "clear N empty" (top-right of the shelf, only when 0-word stories exist) → confirm → they are gone.

## Microphone [medium, needs a human]

With an OpenAI key set, Settings → Ears is auto = OpenAI Realtime (words appear ~0.5s after a pause). Without one, Chrome only. Click the big mic, allow the permission, speak a sentence and pause. Subtitles show
interim words lighter; on the pause the drawing starts. Keep talking through a call: words queue
and go out together.

## Ears cost [cheap, needs a mic]

Listen for a minute with OpenAI ears. The spend chip grows an `ears ~$0.006 (1.0 min)` part; the debug panel shows minutes sent. Settings → "Transcription price" changes the rate live.

## Voice lab [medium, needs a mic, ~$0.02]

Listen, say a sentence, stop. Debug panel → voice lab: the level bar moved while talking; the trace lists `ready`, `delta` words with timestamps, `final` on punctuation. "save clip (last 30s)" downloads a WAV of exactly what was sent (open it: is it loud and clean?). "compare models on clip" fills a table with gpt-live-transcribe / gpt-4o-transcribe / whisper-1 text and latency for that same audio. Settings → Ears → Microphone lists input devices; pick one and listen again.

Without a mic (bx): `import('/src/speech/clip-lab.ts')` in the page, feed it PCM16 24k from the OpenAI TTS endpoint (`response_format: 'pcm'`), and call `compareClip(pcm, key)`.

## Other providers [medium]

Settings → provider openrouter or openai, paste a key, pick a preset, repeat the typed path. Watch
the debug panel for HTTP errors from the provider.

## Transcriber smoke test without a mic [cheap, ~$0.01]

`bun run <scratch>/rt-test.ts` pattern: TTS a sentence to PCM16 24k, stream it into `wss://api.openai.com/v1/realtime?intent=transcription` with `session.update { type: 'transcription', audio.input.{format,transcription,turn_detection} }`, expect `...transcription.completed` with the sentence. The script lives in the session scratchpad; recreate from `src/speech/openai-realtime.ts` if needed.
