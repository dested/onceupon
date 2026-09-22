# MP4 export

- **Status:** done (first cut; child's voice track is a seam, not built)
- **Owner files:** `src/export/mp4.ts`, `src/export/frame.ts`, `src/ui/VideoExport.tsx`, `src/engine/clock.ts`, `src/engine/stage.ts` (`renderAt`, `settled`), `src/engine/audio.ts` (`AudioCues`, `renderAudioCues`), `src/story/replay.ts` (`replaySchedule`)

## What it is

"Download video" turns a saved story into an .mp4 the family keeps: the replay, frame by frame,
inside the storybook from the drawing screen, with the crayon sounds and the narration captions,
ending on a "Made with Once Upon" card. Made entirely in the browser; nothing is uploaded.

## Behavior spec

- The replay screen has a download icon in its top-right toolbar; the closing card after The End has a "Download video" button (the live story is saved first).
- Clicking it shows a paper card near the bottom of the screen, above the replay scrubber: "Making your video", a crayon-yellow progress bar with a percentage and the phase (drawing every page / adding the crayon sounds / wrapping it up), and "cancel". The UI stays responsive; the replay keeps playing.
- Cancel stops the export at the next frame and closes the card; nothing downloads.
- When done the browser downloads `<story-title-slug>.mp4` and the card says "Your video is in your downloads" with the size, then disappears after 3 s.
- A browser without WebCodecs H.264 gets "This browser cannot make videos yet"; any other failure gets "The video got stuck. Try again?" (details in the console).
- The video: 1280x800, 30 fps, H.264 (High, Main or Baseline, whichever the browser can encode; hardware encoder preferred, see Design notes), AAC 128 kbps stereo 48 kHz (Opus if AAC is not encodable, no audio track if neither). About 6.4 MB for 15 s, 13.8 MB for 34 s.
- Picture: the drawing screen's book (warm tabletop, coral cover with the stitched spine rings, cream paper), the 160x100 world filling the paper exactly, a "Made by you" tag top-right, the page number bottom-left, the Once Upon logo bottom-right on every frame (a placeholder wordmark until there is a real logo; the idle crayon rests left of it), the replay's paper caption pill with the latest words chunk near the top of the page.
- Timing matches replay: events play at the replay's capped-gap times (`replaySchedule`); page turns, effects, bubbles, idle motion, the crayon cursor and The End finale all appear as in replay. After the last event the video runs until the page is still, holds 1.5 s, then crossfades (0.35 s) into a 2 s end card: "Made with Once Upon" in the scrawl hand on fresh paper, inside the same book.
- Audio: the engine's own crayon scratch (loudness follows the reveal, as live) and a page-flip whoosh per page turn, rendered offline with the story's seed.
- Deterministic: the same record renders the same frames and audio every time (virtual clock, seeded noise, no `Math.random`, CPU canvases). Two exports differ only in the container's creation times (~10 bytes).

## Design notes

- One renderer. The exporter builds a Stage on a detached 1184x740 canvas with a `VirtualClock`, a Director and the record's dialect (whose delayed pose/hop commands also run on that clock), schedules every record event on the clock, and calls `stage.renderAt(t)` per frame. `frame.ts` composes the book around it.
- Audio is recorded as cues (`AudioCues`) while stepping, then replayed through a `CrayonAudio` attached to an `OfflineAudioContext`: the same synthesis code as live play.
- Encoded video and audio packets (both straight WebCodecs: `VideoEncoder`, `AudioEncoder`) are kept in memory, then muxed with Mediabunny's `Encoded*PacketSource`, interleaved a second at a time in a fixed order (`fastStart: 'in-memory'`). Mediabunny's `AudioBufferSource` was dropped: its async encoding varied the chunk layout between runs.
- Measured in Chrome on Windows: GPU canvases differed by a few pixels run to run (so every export canvas is CPU, `willReadFrequently`), and the software H.264 encoder (OpenH264) gives different bytes for identical frames while the hardware encoder does not (so hardware is tried first).
- Main thread: the stepper yields (MessageChannel, not throttled in background tabs) whenever a slice passes 12 ms; the longest measured main-thread gap during an export was 36 to 63 ms (one heavy frame).
- Voice seam: `exportStoryVideo(record, { voice })`, `VoiceTrack.mix(ctx, videoSecondsOf)`; `videoSecondsOf` maps record time to video time through the replay's squeezed gaps.

## Open questions

- Keep the "Made by you" tag and page number in the video, or a cleaner page?
- The real logo: `drawLogo()` in `src/export/frame.ts` is the one place to swap it in.
- Website version renders the same stepper in headless Chrome (production plan); not built here.
