# Verify

## Cheap checks [cheap]

```
bun run typecheck
bun scripts/tracker-check.ts   # tracker dedupe/correction regression; prints a table, exits 1 on mismatch
bun run dev                    # http://localhost:7710
```

## Drawing screen layout and controls [cheap]

Check 1024×768 and 1366×1024 landscape, 768×1024 portrait, and a compact phone viewport. The book and dock fit without scrolling, buttons remain touch-sized, and captions stay inside the paper. Open Story options; toggle sound twice. Or type opens the focused input; Escape closes it. Tell a sentence, open New story and choose Keep telling this one: words remain. Finish with The End and play the saved story again. Earlier pages open from the page button. Backgrounding stops listening; returning requires another mic tap.

Sep 22: typecheck/build passed; 1024×768 frame inspected with no horizontal overflow and primary controls at least 46px. Browser automation reached typed story, ending, replay and saved bookshelf entry, but its overall run stalled after escalation; not a clean full-suite pass. Real iPad microphone and WKWebView remain human/device checks.

## The End finale [cheap]

Click Or type, then type `Once upon a time a dragon lived in a castle. The End`, Enter. Expect: the dragon-and-castle
scene draws, then a handwritten "The End" title reveals across the upper page with a star/sparkle
burst; the mic button and typed input are gone; the microphone dock becomes the ending actions; a closing card
(`[data-testid=the-end-card]`) shows "play it again" and "new story". "play it again" opens this
story's replay; the replay ends with the same finale. Bookshelf → Play does the same. In a replay,
scrub to the end: the finale shows settled. bx: `bx fill typed "Once upon a time a dragon lived in a
castle. The End"`, `bx press Enter`, `bx wait 6000`, `bx snap`, then `bx exists "[data-testid=the-end-card]"`.

## Typed story path [cheap]

Needs an Anthropic key in `.env.local` or Settings.

1. Open http://localhost:7710, open Story options → Drawing lab (or press backtick) for the debug panel.
2. Click Or type, then in the input type: `Once upon a time a big green dragon lived in a castle with a princess`, Enter.
3. Expect: sky/ground fill, a dragon on the left, castle right, latency row in the debug panel (first token under ~1.5s on Haiku).
4. Type: `then the dragon flew to the beach and ate a giant ice cream`, Enter.
5. Expect: a page turn (filmstrip thumbnail top-left), the dragon redrawn/carried over, ice cream then removed with sparkle.

With bx: `bx open http://localhost:7710`, `bx click "Type a story"`, `bx fill typed "<sentence>"`, `bx press Enter`, `bx wait 7000`, `bx snap`.

## Debug report [cheap]

After any beat, debug panel → "copy report" reads "copied" for 2s and the clipboard holds a text report starting `# Once Upon debug report`; the timeline section lists `words`, `call#n sent / first token / done` and one `cmd` row per DSL line with increasing ms. From bx (no clipboard): `bx js "window.__onceupon.report()"`. With a mic session, `ears delta/final` rows interleave with the calls; a beat that started while still talking shows `call#n sent` before the last `ears delta` of that sentence.

## Kid-safety skip [cheap]

1. Type: `a bunny and a fox went to the bathroom together`, Enter.
2. Expect within ~1s: nothing drawn, "the crayon skipped that part" under the mic for 4s, subtitle shows `(the crayon skipped a part)`, debug panel logs a `skip` line. The story title never contains the marker.
3. Type a rude word in a sentence: it shows masked (`s***`) in the subtitle and the saved title.

## Subtitle states [cheap]

Type two sentences quickly. The first sentence sits on a yellow highlight while its call streams (`[data-testid=subtitles-drawing]`); the second is grey (`subtitles-waiting`) until its own call starts. The paper status reads "Your words are coming to life".

## ops dialect (default) [cheap]

New story (Settings → Drawing language shows `ops`). Type `Once upon a time a big green dragon lived in a castle with a princess`. Expect: grass strip, a green dragon with two mirrored wings and legs and a face, a princess (dress, crown, face), a castle with two mirrored towers and a flag, a sun with rays; debug panel shows `ent`/`draw`/`face` lines, no red ones, ~650 output tokens. Type `then the dragon flew to the beach and ate a giant ice cream`: `scene ... clear keep=dragon`, sand + water, an ice cream, `move` glide, `fx burst`, `rm icecream`, `say`, ~300 output tokens. Bookshelf → Play replays it identically.

Parser harness without a model (Sonnet not needed): a bun script that imports `parseOpsLine`/`OpsDialect` from `src/llm/ops-dsl.ts`, feeds every line of the prompt's `# Example` through `dialect.parse` and applies the commands to a `Scene`; expect 0 failures. Direct engine check in the page: `window.__onceupon.director.execute('ent bunny 350 525 "bunny"')`, then `execute('draw bunny.head brown white circle 0 -170 48')`; `director.dialect.snapshot()` returns the terse page description the model sees.

## JSON ops dialect [cheap]

Settings → Drawing language → json ops, then New story. Type the dragon sentence. Expect: paper-colored background, grass strip, a two-tone dragon with two eyes and a mouth from the face helper, a house, a sun; the debug panel shows `{"op":...}` lines with no errors. Type `then the dragon flew to the house and the house exploded and the dragon was sad`: move, burst, scribble-out, smoke, a sad mouth (face redrawn without redrawing the body), a bubble. Bookshelf → Play replays it identically.

Direct engine check without a model: `window.__onceupon.director.execute('{"op":"entity",...}')` per line; `director.dialect.snapshot()` returns the JSON the model sees.

## Replay and bookshelf [cheap]

1. Book icon → a card for the story above with a cover.
2. Play → drawing replays; each heard chunk appears as a paper caption near the top (`[data-testid=narration]`) as it is reached. Bottom bar: pause/play and a slider (`[data-testid=scrubber]` shows `i/n`). Drag the slider: the page jumps to that point fully drawn and keeps playing; pause holds the position; at the end the button reads "again".
3. Delete → "sure?" → card gone. Inside a replay, the trash icon top-right → "delete this story?" → back on the shelf without it. "clear N empty" (top-right of the shelf, only when 0-word stories exist) → confirm → they are gone.

## MP4 export [cheap]

1. Replay any saved story → download icon top-right → the "Making your video" card shows a yellow bar, a phase and "cancel"; the replay keeps playing. When it finishes the card says "Your video is in your downloads" and the browser downloads `<title-slug>.mp4`. The closing card after "The End" has the same action as "Download video".
2. Cancel mid-way → the card closes and nothing downloads.
3. `ffprobe -v error -show_entries format=duration:stream=codec_name,profile,width,height,r_frame_rate,sample_rate,channels -of compact <file>` → h264 1280x800 30/1 + aac 48000 2ch; duration ≈ replay length + settle + 1.5 s hold + 2 s end card.
4. Look: storybook border and spine rings, caption pill, "Made by you" top-right, page number bottom-left, logo chip bottom-right on every frame, end card "Made with Squiggletale".

Scripted (automated Chrome here exits on any real download, so this captures the Blob): `bx stop`, then `node scripts/export-check.mjs <outDir> <storyId> 2` → two .mp4s + per-frame hashes. Determinism: `hashes-1.txt` == `hashes-2.txt`, and `cmp -l a.mp4 b.mp4` shows only ~10 bytes (mvhd/tkhd/mdhd creation times); `ffmpeg -i f.mp4 -map 0 -c copy -f streamhash -hash md5 -` identical for both. `CANCEL=1` runs the cancel check first. Needs the 7710 dev server; if Vite restarts mid-run the script times out, just rerun.

## Microphone [medium, needs a human]

With an OpenAI key set, Settings → Ears is auto = OpenAI Realtime (words appear ~0.5s after a pause). Without one, Chrome only. Click the big mic, allow the permission, speak a sentence and pause. Subtitles show
interim words lighter; on the pause the drawing starts. Keep talking through a call: words queue
and go out together.

Deepgram variant: Settings → Ears → Deepgram (key in Settings → Keys or `VITE_DEEPGRAM_API_KEY`; model `nova-3`). Auto resolves to OpenAI when both keys are set, so pick Deepgram explicitly. Click the mic and speak; the mic flips to "listening" on socket open (readiness is the socket `open` event, not `Metadata`, which Deepgram sends at stream end), words stream in like the OpenAI live path. Talk through a whole sentence with natural breaths: the subtitle stays grey (no yellow) until you stop; the voice lab trace shows `delta ... (settled)` lines mid-sentence and one `final ... (speech_final)` (or `(utterance_end)`) when you stop, and the drawing starts then. Hum or keep talking without pausing for 14+ words: it still releases (max-words cap). With no Deepgram key, choosing Deepgram and clicking the mic shows a `speech:` warning (a red dot on the bug icon) and does not crash.

Socket ground-truth without a mic (works headless, no getUserMedia): `bun scripts/probe-deepgram.ts` (Bun loads `.env.local`; reads `DEEPGRAM_API_KEY` or `VITE_DEEPGRAM_API_KEY`). With no WAV argument it synthesizes a sentence via OpenAI TTS (`VITE_OPENAI_API_KEY`, `response_format: 'pcm'`) and streams it; pass a WAV path (e.g. the app's "save clip") to stream real audio. It prints every Results/UtteranceEnd with ms. Last run: interim words from ~1.1s, two `is_final` segments, `Metadata` + `close 1000` at the end. In a headless browser (bx) the socket opens and the `ready` trace fires (~200ms), but `onReady`/"listening" needs a real microphone, so confirm the live mic on a human's machine.

## Ears cost [cheap, needs a mic]

Listen for a minute. The spend chip grows an `ears ~$… (1.0 min)` part at the resolved vendor's rate (`~$0.017` for OpenAI live, `~$0.0077` for Deepgram); the debug panel shows minutes sent. Settings → "Transcription price" overrides the rate live; its "reset" button returns to the vendor default.

## Voice lab [medium, needs a mic, ~$0.02]

Listen, say a sentence, stop. Debug panel → voice lab: the level bar moved while talking; the trace lists `ready`, `delta` words with timestamps, `final` on punctuation. "save clip (last 30s)" downloads a WAV of exactly what was sent (open it: is it loud and clean?). "compare models on clip" fills a table with gpt-live-transcribe / gpt-4o-transcribe / whisper-1 text and latency for that same audio. Settings → Ears → Microphone lists input devices; pick one and listen again.

Without a mic (bx): `import('/src/speech/clip-lab.ts')` in the page, feed it PCM16 24k from the OpenAI TTS endpoint (`response_format: 'pcm'`), and call `compareClip(pcm, key)`.

## Prompt cache check [cheap, ~$0.02]

Type two sentences into the app, open the debug panel: call 2's token cell must show a large cache-read part (hover shows `input+writeW+readR`). If it reads 0: Haiku needs a 4096-token prefix; measure the prompt with a tiny script (Anthropic SDK, `system: [{text, cache_control}]`, `max_tokens: 5`, call twice, print `usage.cache_creation_input_tokens` / `cache_read_input_tokens`) and grow the cookbook until the first call writes.

## Other providers [medium]

Settings → provider openrouter or openai, paste a key, pick a preset, repeat the typed path. Watch
the debug panel for HTTP errors from the provider (the story screen never shows error text, only a red dot on the bug icon).

## Transcriber smoke test without a mic [cheap, ~$0.01]

`bun run <scratch>/rt-test.ts` pattern: TTS a sentence to PCM16 24k, stream it into `wss://api.openai.com/v1/realtime?intent=transcription` with `session.update { type: 'transcription', audio.input.{format,transcription,turn_detection} }`, expect `...transcription.completed` with the sentence. The script lives in the session scratchpad; recreate from `src/speech/openai-realtime.ts` if needed.

## Drawing lab [cheap, ~$0.05 per playground draw]

Needs an Anthropic key. `bun run dev`, open http://localhost:7710/lab.html. Playground: phrase `horse`,
Draw. Expect: the crayon draws live, ops stream into the dark panel, within ~30 s a critique card with
a blind guess, an overall score, six subscores and issues (each with a general rule);
`lab/runs/play/` gains a jpg + json + ops.txt. bx (use a non-default profile if another session holds
`default`): `bx --profile lab open http://localhost:7710/lab.html`, `bx --profile lab fill phrase horse`,
`bx --profile lab click draw`, `bx --profile lab wait 40000`, `bx --profile lab text`.

## Drawing lab campaign [heavy — ask first, ~$3 per round on the full set]

Campaign tab: pick 3 cases, maxRounds 1, Start. Expect `lab/runs/r000/` with a jpg/json/ops.txt per
case and `round.json` with means, `lab/campaign.json` status `done`, 3 lines in `lab/history.jsonl`.
Start again with maxRounds 2: `lab/prompts/v001.md` appears, `r001` runs on it, the rounds table
shows kept or reverted with a verdict. Prompts tab: v001 diff shows the editor's edits; Promote
rewrites only the template literal in `src/llm/ops-prompt.ts` (check `git diff`); promote v000 to undo.

## Hosted studio + API [cheap, needs Postgres]

```
cd apps/web && bun run db:push && bun run dev        # http://localhost:7720 (site, /admin, /api/app/*, /app/ once built)
bun scripts/smoke-api.ts                             # register → state → config → session start/beat/stop → draw stream (needs ANTHROPIC_API_KEY in apps/web/.env)
bun scripts/smoke-money.ts                           # gift mint/redeem, share create/get/unpublish
cd ../.. && bun run build:hosted                     # dist-hosted/index.html (single file, no external URLs)
bun run dev:hosted                                   # studio in hosted mode on 7711; .env.hosted.local sets VITE_API_ORIGIN=http://localhost:7720
```

Click-path: open 7711 in hosted mode → the tutorial plays (skip with ×) → tap the mic (grown-up gate, then the browser mic prompt) or type a sentence → the minutes chip counts down → Grown-ups (gate) shows the family code and balance → "Send to grandma" after The End makes a `/s/<id>` link that opens on 7720.

## Website [cheap]

`/`, `/pricing`, `/gift`, `/s/<bad id>` render at 390 px and 1280 px; `curl -s localhost:7720/s/abc | grep og:title` shows the tag in raw SSR. `/shop` with a wrong family code shows the not-found message.

## Admin [cheap]

Sign up at `/admin/sign-up` with an email in `ADMIN_EMAILS`; every page renders with empty data; a flag change on Settings round-trips.

## Expo shell [medium]

```
cd apps/mobile && bunx tsc --noEmit && bun test && bunx expo-doctor
bun run sync-studio          # copies dist-hosted/index.html into assets/studio.html
eas build --profile development --platform ios     # [heavy — Sal runs it] then on a real iPad: mic inside the WebView on the hosted origin, purchase in sandbox, share sheet
eas update --channel production --message "..."    # ships shell JS; the studio itself ships with a web deploy
```
