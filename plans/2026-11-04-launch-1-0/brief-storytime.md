# Brief: storytime (opus-xhigh), sound in Save video, and voiced stories play in story time

**Goal.** Sal tested build 3 from TestFlight on his iPhone (2026-11-05): "the save video has no audio and has a ton of dead timing. it doesnt have to be minute to minute accurate, do the story in story time not real time. also why is there no audio." Two jobs, one owner, because both live in the same files:
1. **Sound.** A video saved on an iPhone has the child's voice and the crayon sounds. Today it has none. Find out why on real iOS WebKit, then fix it.
2. **Story time.** A story told out loud plays back (in-app replay, Save video, and the share page, which uses your Replayer and VoicePlayer) with the dead air removed and the drawing pulled under the words that asked for it. Today a voiced story replays in real time: the 8 s voice lead-in, every pause, and every wait for the drawing.

**Read first.** `/w/code/onceupon-f/cliffnotes.md` (the "Video export is the live engine on a VirtualClock" and "Stories with voice replay in real time" lines), `features/mp4-export.md`, `verify.md` (export-check, fake shell), `src/story/replay.ts`, `src/story/voice.ts`, `src/export/mp4.ts`, `src/engine/audio.ts`, `apps/mobile/scripts/mini/README.md` + `sim-build.sh`, `/w/code/mac-mini/cliffnotes.md` (agent contract, build lock, `onscreen`, Device Hub), the `bx` skill.

**Owns.** `src/story/replay.ts`, `src/story/voice.ts`, new `src/story/story-time.ts` + `src/story/story-time.test.ts`, `src/export/**`, `src/ui/VideoExport.tsx`, `src/engine/audio.ts`, root `package.json` + `bun.lock` (mediabunny and an AAC encoder only), `features/mp4-export.md`, scratch `/w/junk/onceupon-f/storytime/` and `~/scratch/squiggletale/` on the mini. **Not** `src/ui/SharePlayer.tsx` or `apps/web/**` (the `share` lane owns them). Other files: send the lead the exact lines. Commit only with `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (storytime)" <paths>`.

**Contract with the share lane (keep it).**
- `VoicePlayer.fromUrl(url, mime, totalMs)` stays synchronous with that signature, and `new Replayer(record, director, handlers, { voice })` keeps its signature. If the voice now needs decoding first, do it inside: the player starts fetching and decoding at construction and `Replayer.play()` waits for it.
- Export `primeAudio(): void` from `src/story/voice.ts`. The share lane calls it synchronously inside the tap that starts playback, before `play()`. It must resume (or create) every AudioContext that replay uses, voice and crayon, so iOS lets them sound. Land this export in your first commit, even as a stub that resumes the voice context, so the share lane can build against it.

**1. Sound in Save video.**
- Diagnose first, on iOS WebKit, not Chrome. Likely cause: `AudioEncoder` with AAC (`mp4a.40.2`) is missing or unsupported in WKWebView, so `encodeAudio` returns null and the mp4 has no audio track (`src/export/mp4.ts` around line 225, and the "no AAC AudioEncoder" note). Prove or disprove it in Safari on an iOS 26 Simulator on the mini. WebCodecs needs a secure context, so reach a local studio as `http://localhost:<port>` in the sim through `ssh -R <port>:localhost:<port> mini` (the sim shares the Mac's network), or use the Release sim build from `sim-build.sh` against production. Also check the save path: does the file the shell writes to Photos still have its audio track (`ffprobe` the file the sim's Photos library got)?
- Fix: keep WebCodecs AAC first. When it is missing, encode AAC in the page with `@mediabunny/aac-encoder` (wasm). Upgrade `mediabunny` to the same version (1.65.x today) and run the export-check determinism recipe in Chrome again. The wasm path need not be byte-deterministic, but the Chrome hardware path must stay so. Load the encoder lazily (dynamic import), only when native AAC is missing. Apply the same fallback to `renderVoiceFile` (the share upload) so a voiced share works from an iPhone.
- Done when the mp4 saved from the iOS Simulator app has an AAC track you can hear: the child's voice plus the crayon scratch and page flips. Check it with ffprobe plus a short loudness readout (e.g. ffmpeg `ebur128` or `volumedetect`) over a voiced span. There is no microphone in the sim, so build a voiced test story: author a record with a voice clip (Teddy kid clips in `W:\junk\onceupon-f\voice-clips\`, or the assets lane's `W:\junk\onceupon-f\assets\shelf-stories-natural.json`).

**2. Story time (voiced stories only; unvoiced stories keep today's capped gaps).** Put it in `src/story/story-time.ts` as one pure function that replay, export and the share page all use. Unit-test it (`bun test src`).
- **Speech.** From the decoded voice, find speech: 20 ms RMS windows over a level set from that clip's own loudness, so a quiet mic still works. Merge gaps under 300 ms and pad each span 150 ms both sides. The share page has one voice file starting at record t = 0; apply the same detection to it.
- **Pull the drawing under the words.** Each `words` event W is followed by the draw events its beat streamed, up to the next `words` event. If the first of those lands more than 300 ms after W, move all of them earlier by the same amount so the first lands 300 ms after W. Keep their spacing and order, and never move one before W.
- **Squeeze the dead air.** Activity = speech spans ∪ [t, t + 1000 ms] for each draw event (after the pull) ∪ [t, t + 300 ms] for `words` / `end` / page events. Each stretch with no activity that is longer than 500 ms plays as 500 ms. The story starts 300 ms before the first activity, which replaces the 8 s voice lead (`voiceLeadMs`).
- **Output.** A map from record time to story time, plus the kept record-time spans, each with its story-time start. The voice plays only the kept spans, each at its story-time start (Web Audio `AudioBufferSourceNode.start(when, offset, duration)`; no element seeking), and the events fire at their mapped times. VoicePlayer moves to Web Audio decoded buffers; HTML audio-element seeking is what lost clips in WKWebView before.
- Export: video time = story time; `VoiceTrack.mix` places the kept spans; crayon audio cues follow the same clock as now. Replay: the scrubber and `seek()` work in story time.
- Scale check: a 2-minute voiced story should play noticeably shorter with no audible cut inside a word. Watch one replay and one export end to end, and listen with a loudness/silence readout (you cannot hear: report `silencedetect` gaps before and after).

**Facts.**
- The studio is hosted: your fix reaches build 3 on Sal's phone with the next deploy; no app build. The lead pushes; you never push.
- Local dev: studio `bun run dev:hosted` (7711); API `cd apps/web && DATABASE_URL=postgresql://postgres@localhost:5432/onceupon_voice PORT=7720 bun server.ts`. **Always pass that DATABASE_URL: `apps/web/.env` is PRODUCTION.** Stop every server and sim you start; take and release the mini build lock (`~/code/.mac-build.lock`).
- Automated Chrome exits on downloads: capture the Blob (verify.md).
- No `any`, no papering `as`. `bun run typecheck` and `bun test src` green before every ready line. Keep `features/mp4-export.md` and the two cliffnotes lines true.

**Steps.** (1) `primeAudio` stub commit. (2) Diagnose sound on iOS; report `ready storytime diagnosis <cause>` with evidence, and keep going. (3) Fix sound, verify on the sim, commit. (4) story-time.ts + tests, then replay, then export; commit each. (5) Report.

**Don't.** Push; touch production data or `apps/web/.env`; print a key; change unvoiced replay timing; touch macOS settings or other projects on the mini; leave sims, servers or the build lock behind.

**Report** (≤ 10 lines): `ready storytime <step> <sha>`, cause, what you verified on iOS and how, before/after length of the test story, absolute file paths, doubts.

## Standing answers
