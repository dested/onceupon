# Deepgram ears behind a flag

- **Date:** 2026-09-22
- **Status:** done
- **Type:** plan
- **What:** add Deepgram Nova-3 streaming as a third transcriber, selectable in Settings → Ears, with the same Recognizer shape, cost metering and voice-lab trace as the OpenAI path. Spec for an Opus builder; Fable made every decision below.

## Why

OpenAI `gpt-live-transcribe` bills $0.017 per mic minute (the spend chip still assumes $0.006). Deepgram Nova-3 streaming is $0.0077 list ($0.0048 promo), AssemblyAI $0.0025. Before an iPad launch we want to A/B kid-speech accuracy and latency against the OpenAI path from the same Settings panel. Flag, not replacement: OpenAI stays the default when its key is present.

## Shape (do exactly this)

### 1. Shared mic pipeline: `src/speech/pcm-mic.ts` (new)

Move out of `openai-realtime.ts`, unchanged in behavior:
`SAMPLE_RATE` (24000), the worklet source + `PcmSender`, `rms`, `pcmToWav`, `lastClip`, the 30s ring (`RING_MAX`), `warmMic`, `listMics`, `takeMic`, `micConstraints`.

Export one function both recognizers use:

```ts
export interface PcmMic {
  stop(): void
}
export interface PcmMicOptions {
  deviceId: string
  /** One PCM16 frame from the worklet; the caller decides what to do with it. */
  onFrame: (buf: ArrayBuffer) => void
}
export async function openPcmMic(opts: PcmMicOptions): Promise<PcmMic>
```

`openPcmMic` = takeMic → AudioContext → addModule → worklet node → mute gain, and pushes every frame into the ring (so `lastClip` keeps working for the voice lab) before calling `onFrame`. `openai-realtime.ts` keeps its socket logic and calls `openPcmMic`; its exported API (`createOpenAiRealtimeRecognizer`, `isLiveModel`, `RealtimeOptions`) is unchanged. Re-export `warmMic`, `listMics`, `lastClip`, `pcmToWav`, `SAMPLE_RATE` from `pcm-mic.ts` and fix the imports in `session.ts`, `SettingsPanel.tsx`, `DebugPanel.tsx`, `clip-lab.ts` (import from `~/speech/pcm-mic`). No `as` casts, no `any`.

### 2. `src/speech/deepgram.ts` (new)

```ts
export interface DeepgramOptions {
  apiKey: string
  model: string
  deviceId: string
}
export function createDeepgramRecognizer(
  handlers: RecognizerHandlers,
  opts: DeepgramOptions
): Recognizer
```

- Socket: `new WebSocket(url, ['token', opts.apiKey])` (browser auth via subprotocol; no headers possible). URL:
  `wss://api.deepgram.com/v1/listen?model=<opts.model>&encoding=linear16&sample_rate=24000&channels=1&language=en&interim_results=true&punctuate=true&smart_format=false&numerals=false&filler_words=false&vad_events=true&endpointing=300`
- Audio: send each worklet frame as a **binary** message (`socket.send(buf)`), no base64. Frames captured before `open` queue (cap 600) and flush on open, same as the OpenAI path. Meter `handlers.onAudio(ms)` and `handlers.onLevel(rms*6 capped at 1)` per frame exactly like `openai-realtime.ts`.
- Keep-alive: Deepgram closes the socket after ~10s without audio. A `setInterval` every 5s sends `{"type":"KeepAlive"}` when no frame went out in the last 4s.
- Stop/abort: send `{"type":"CloseStream"}` (if open), close the socket, stop the mic, clear the interval. Fire `handlers.onEnd()` from `onclose` only; `onError` on `onclose` only when not stopped by us (`deepgram closed (<code>)`).
- Messages (parse with a zod schema, `unknown` in):
  - `{type:'Results', is_final, speech_final, channel:{alternatives:[{transcript}]}}` → maintain `finals: RecResult[]` (every non-empty `is_final` segment this session, in order) and `interim: string`. On interim: `interim = transcript`; on `is_final`: push `{transcript, isFinal:true}` (skip empty), `interim = ''`. After each Results message call `handlers.onResult([...finals, ...(interim ? [{transcript: interim, isFinal:false}] : [])], finals.length - (this was a final ? 1 : 0))` — i.e. resultIndex is the index of the first changed result, matching what the OpenAI recognizer passes. Trace: `'delta'` with the interim text, `'final'` with the final text.
  - `{type:'SpeechStarted'}` → trace `'speech' 'started'`.
  - `{type:'UtteranceEnd'}` → trace `'commit' ''` (nothing else; the tracker's quiet window decides).
  - `{type:'Metadata'}` on open → `ready = true`, trace `'ready' <model>`, then `handlers.onReady()` once the mic is also open (mirror the OpenAI `ready && stream` logic).
  - Anything else: ignore.
- Read `openai-realtime.ts` first and keep the same structure (start/teardown/stopped flags) so the two files read as siblings.

### 3. Tracker: `src/speech/recognition.ts`

Add `export const DEEPGRAM_TRACKER: TrackerOptions = { stableMs: 700, minWords: 1, maxWords: 14, holdBack: 0 }` with a comment: Deepgram rewrites the interim tail, but the director's early restart makes a wrong guess cheap, so nothing is held back (same reasoning as `LIVE_TRACKER`).

### 4. Keys, settings, store

- `src/llm/providers.ts` `ApiKeys` gains `deepgram: string`. Every place that builds an `ApiKeys` literal gets it (`store.ts` env parse: `VITE_DEEPGRAM_API_KEY`, the persisted-settings zod schema, `KeyGate.tsx` where it spreads keys).
- `src/story/store.ts`:
  - `STT_MODES = ['auto', 'browser', 'openai', 'deepgram'] as const`.
  - `resolveStt(s): 'browser' | 'openai' | 'deepgram'`; `auto` → openai key ? `'openai'` : deepgram key ? `'deepgram'` : `'browser'`.
  - New setting `deepgramModel: string`, default `'nova-3'` (`DEFAULT_DEEPGRAM_MODEL`), persisted, migrated with `?? default`.
  - Replace `DEFAULT_STT_RATE`/`sttRatePerMin` with an override model: setting `sttRateOverride: number | null` (null = vendor default) and
    ```ts
    export function sttRateFor(kind: 'browser' | 'openai' | 'deepgram', model: string): number
    // browser 0; openai: /live/.test(model) ? 0.017 : 0.006; deepgram: 0.0077
    export function effectiveSttRate(s: Settings): number // override ?? sttRateFor(resolveStt(s), model for that kind)
    ```
    Migration in the persisted-settings parse: old `sttRatePerMin` of exactly `0.006` (the old default everyone has stored) → `null`; any other old value → that number as the override. Every reader of `settings.sttRatePerMin` (SpendChip, DebugPanel, wherever) switches to `effectiveSttRate(settings)`.
- `src/story/session.ts` `startListening`: widen `sttKind`; `kind === 'deepgram'` → `createDeepgramRecognizer(handlers, { apiKey: settings.keys.deepgram, model: settings.deepgramModel, deviceId: settings.micDeviceId })`; tracker `DEEPGRAM_TRACKER`; the 800ms restart delay and the `speech: <err>` warning apply to deepgram as well as openai; the no-recognizer warning reads `speech recognition needs Chrome, an OpenAI key, or a Deepgram key`.

### 5. Settings panel (`src/ui/SettingsPanel.tsx`)

- `STT_LABELS.deepgram = 'Deepgram streaming (needs Deepgram key)'`; auto label becomes `'auto (OpenAI key → OpenAI, else Deepgram key → Deepgram, else Chrome)'`.
- The second column of the Ears grid shows the model input for the **resolved** vendor: OpenAI → existing `sttModel` input; Deepgram → `deepgramModel` input with a datalist of `nova-3` only; Chrome → column empty.
- Keys section: a Deepgram key field beside the OpenAI one, same styling (`field`, `label`), id `key-deepgram`.
- Mic label: `Microphone (OpenAI or Deepgram ears; Chrome's recognizer always uses the default)`.
- Rate input shows `effectiveSttRate`; editing sets `sttRateOverride`; a small "reset" StickerButton (tone paper) next to it sets it back to null. Label: `Transcription price, $ per minute of audio (vendor default unless you change it)`.
- `KeyGate.tsx`: unchanged except carrying `deepgram` through the keys spread.

### 6. Docs (part of done)

- `cliffnotes.md`: tree (`pcm-mic.ts`, `deepgram.ts`), file map row "which transcriber is used", the Loop step 1, gotchas: replace the "Transcription cost is an estimate" bullet with the vendor-default/override rule and the real $0.017 live price; add a Deepgram bullet (subprotocol auth, binary frames, KeepAlive, finals+interim mapping). Bump Last updated.
- `decisions.md`: append "2026-09-22 — Deepgram streaming as a flagged third transcriber" (why: price + A/B; rejected: replacing OpenAI outright, AssemblyAI first (cheapest but no kid-speech data), Deepgram Flux (v2 endpoint, later)).
- `features/story-loop.md`: ears section mentions the three vendors and the tracker each uses.
- `verify.md`: Microphone recipe gains a Deepgram variant (Settings → Ears → Deepgram, key in Settings or `VITE_DEEPGRAM_API_KEY`); Ears cost recipe says `~$0.017` for OpenAI live and `~$0.0077` for Deepgram.
- `updates.md`: one entry at the top, referencing this plan; flip this plan's Status to `done`.

## Verification the builder can do

- `bun run typecheck` green. `bun run prettier`.
- `bun run dev` then with bx: open http://localhost:7710, Settings → Ears → Deepgram appears; typed-story path still works (verify.md "Typed story path"); with no Deepgram key, choosing Deepgram and clicking the mic yields the warning, no crash.
- There is **no Deepgram key in this repo** (`.env.local` has none). Do not invent one. Write `scripts/probe-deepgram.ts` (bun, node WebSocket, `DEEPGRAM_API_KEY` from env, streams a WAV file path argument as 24k PCM16 in 100ms frames, prints every Results/UtteranceEnd message with ms since start) so Sal can run it the moment he has a key: `DEEPGRAM_API_KEY=... bun scripts/probe-deepgram.ts clip.wav`. Add a `scripts/` line to the cliffnotes tree.
- The OpenAI path must be byte-for-byte behaviorally unchanged after the mic extraction; re-read the diff of `openai-realtime.ts` before finishing.
