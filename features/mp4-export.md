# MP4 export

- **Status:** done (with the child's voice, in story time)
- **Owner files:** `src/export/mp4.ts`, `src/export/aac.ts`, `src/export/watch.ts`, `src/export/frame.ts`, `src/ui/VideoExport.tsx`, `src/engine/clock.ts`, `src/engine/stage.ts` (`renderAt`, `settled`), `src/engine/audio.ts` (`AudioCues`, `renderAudioCues`), `src/story/replay.ts` (`replayPlan`, `replaySchedule`), `src/story/story-time.ts`, `src/story/voice.ts` (`makeVoiceTrack`, `renderVoiceFile`)

## What it is

"Download video" turns a saved story into an .mp4 the family keeps: the replay, frame by frame,
inside the storybook from the drawing screen, with the child's voice, the crayon sounds and the
narration captions, ending on a "Made with Squiggletale" card. Made entirely in the browser;
nothing is uploaded.

## Behavior spec

- The replay screen has a download icon in its top-right toolbar; the closing card after The End has a "Download video" button (the live story is saved first).
- Clicking it shows a paper card near the bottom of the screen, above the replay scrubber: "Making your video", a crayon-yellow progress bar with a percentage and the phase (drawing every page / adding the crayon sounds / wrapping it up), and "cancel". The UI stays responsive; the replay keeps playing.
- Cancel works at every wait (frame loop, encoder backpressure, flush, audio render, AAC encode): the card closes and nothing downloads. An encoder that holds work but produces no output for 10 s fails the export with "Couldn't make the video. Try again later." and a Close button, never a frozen 0%.
- In the app shell a grown-up passes the parental gate before the export starts (it ends in the system share sheet).
- When done the browser downloads `<story-title-slug>.mp4` and the card says "Your video is in your downloads" with the size, then disappears after 3 s.
- A browser without WebCodecs H.264 gets "This browser cannot make videos yet"; any other failure gets "The video got stuck. Try again?" (details in the console).
- The video: 1280x800, 30 fps, H.264 (High, Main or Baseline, whichever the browser can encode; hardware encoder preferred, see Design notes), AAC-LC 128 kbps stereo 48 kHz. AAC comes from the browser's WebCodecs encoder, or, where there is none (iOS before 26, Firefox, Linux Chrome), from the wasm encoder (`@mediabunny/aac-encoder`, imported on first need). No audio track only when neither can run (Photos and most players refuse Opus-in-mp4). About 6.5 MB for 25 s, 27 MB for 97 s.
- Picture: the drawing screen's book (warm tabletop, coral cover with the stitched spine rings, cream paper), the 160x100 world filling the paper exactly, no tag and no page number, the app icon bottom-right on every frame (`src/assets/brand/app-icon.jpg`; the idle crayon rests left of it), the replay's subtitles with the latest words.
- Timing matches replay (`replayPlan`). An unvoiced story plays at the capped-gap times (`replaySchedule`). A voiced story plays in story time (`src/story/story-time.ts`): the drawing starts 300 ms after the words that asked for it, every stretch with no speech, drawing or words longer than 500 ms plays as 500 ms, and the video starts 300 ms before the first activity. Page turns, effects, bubbles, idle motion, the crayon cursor and The End finale all appear as in replay. After the last event and the last words the video runs until the page is still, holds 1.5 s, then crossfades (0.35 s) into a 2 s end card: "Made with" / "Squiggletale" in the scrawl hand with two sparkles and the public domain (`BRAND.publicDomain`) under it, on fresh paper inside the same book. The End sits where it covers the least of the drawing (`src/engine/finale-place.ts`, scored from the shapes at rest, so studio, replay and export agree). On a dark page (night sky) it is light lettering with a dark outline, as in the studio and replay; the end card sits on paper and keeps dark ink.
- Audio: the child's voice (the kept record spans at their story times, 8 ms fades where a quiet stretch was squeezed; every speech span plays whole), the engine's own crayon scratch (loudness follows the reveal, as live) and a page-flip whoosh per page turn, rendered offline with the story's seed.
- Deterministic: the same record renders the same frames and audio every time (virtual clock, seeded noise, no `Math.random`, CPU canvases, the voice decoded offline). Two exports differ only in the container's creation times (~10 bytes).

## Design notes

- One renderer. The exporter builds a Stage on a detached 1184x740 canvas with a `VirtualClock`, a Director and the record's dialect (whose delayed pose/hop commands also run on that clock), schedules every record event on the clock, and calls `stage.renderAt(t)` per frame. `frame.ts` composes the book around it.
- Audio is recorded as cues (`AudioCues`) while stepping, then replayed through a `CrayonAudio` attached to an `OfflineAudioContext`: the same synthesis code as live play. The voice is mixed into the same context (`VoiceTrack.mix(ctx, spans)`, the same piece placement as replay's `VoicePlayer`).
- Video packets come straight from WebCodecs `VideoEncoder`. Audio goes through Mediabunny's `AudioSampleSource` on a throwaway `Output` (`NullTarget`) whose packets are collected (`export/aac.ts`), because WebKit's AAC `AudioEncoder` is broken in ways Mediabunny 1.65 repairs: its `description` is a whole ES_Descriptor instead of an AudioSpecificConfig (WebKit bug 302253; written as-is the esds read "object type 0, 0 channels" and Photos played the video silent, which is what TestFlight build 3 shipped), and its first frame needs a silence prefix (bug 328491). Both tracks are then muxed with `Encoded*PacketSource`, interleaved a second at a time in a fixed order (`fastStart: 'in-memory'`): a live audio source muxing as it encodes varied the chunk layout between runs.
- Measured in Chrome on Windows: GPU canvases differed by a few pixels run to run (so every export canvas is CPU, `willReadFrequently`), and the software H.264 encoder (OpenH264) gives different bytes for identical frames while the hardware encoder does not (so hardware is tried first).
- Main thread: the stepper yields (MessageChannel, not throttled in background tabs) whenever a slice passes 12 ms; the longest measured main-thread gap during an export was 36 to 63 ms (one heavy frame).
- Voice: `exportStoryVideo(record, { voice })`; left undefined it is built from the record's local clips (`makeVoiceTrack`). `VoiceTrack` is `{ speech, mix(ctx, spans) }`: `speech` feeds `replayPlan`, `mix` places the plan's kept spans.
- Story time, measured (2026-11-04): a 2:20 voiced test story (six told stretches, the mic closed 6 to 9 s between them, room noise in every clip) went from 140 s of voice timeline to 91 s (mp4 97 s with the finale and end card; the real-time export was about 147 s). Quiet under -45 dB: 80.7 s in 22 gaps before, 30.8 s after, the longest 10.3 s before and 2.5 s after (what remains is drawing time). All 28 speech spans came back whole.
- The share page's voice file (`renderVoiceFile`) is the whole record timeline as recorded, in one AAC file; the share page finds the speech in it and plays it in story time itself (event times within 40 ms of the app's).

## Open questions

- AAC and Photos are verified in the iOS 27 Simulator's Safari (native and wasm paths), not yet on a real iPhone or in the shell's save path.
- The iOS 27 Simulator's H.264 High and Main encoders never produce output (the export stalls after 10 s); Baseline works. Real devices are unverified.
- The hosted single file inlines the wasm AAC encoder: +1.18 MB raw, +0.31 MB gzip.
