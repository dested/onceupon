/**
 * Regression for TranscriptTracker's content-based dedupe and corrections (Deepgram re-segments a
 * settled interim into a shorter final at a new index, so the same words can arrive twice).
 *
 * No test framework: feed the tracker fixed RecResult sequences with a fake clock, compare the
 * emitted chunks and correction calls to the expected values, print a table, exit 1 on any mismatch.
 *
 *   bun scripts/tracker-check.ts
 */
import { DEEPGRAM_TRACKER, TranscriptTracker, type RecResult } from '../src/speech/recognition'

interface Run {
  emits: string[]
  corrects: Array<[string, string]>
}

function makeTracker(): { tracker: TranscriptTracker; run: Run } {
  const run: Run = { emits: [], corrects: [] }
  const tracker = new TranscriptTracker(
    {
      emit: (w) => run.emits.push(w),
      correct: (released, actual) => run.corrects.push([released, actual]),
    },
    DEEPGRAM_TRACKER
  )
  return { tracker, run }
}

const interim = (transcript: string): RecResult => ({ transcript, isFinal: false })
const final = (transcript: string): RecResult => ({ transcript, isFinal: true })

// --- Case 1: Deepgram re-segments a released interim into a shorter final at a new index ---
function dupCase(): Run {
  const { tracker, run } = makeTracker()
  const idx0Interim = 'Once upon a time, there was a dragon who hung out with'
  const idx0Final = 'Once upon a time, there was a dragon who'
  const idx1 = 'hung out with a princess.'
  tracker.onResult([interim(idx0Interim)], 1000)
  tracker.tick(1700) // quiet window: release all 12 settled words
  tracker.onResult([final(idx0Final)], 2000) // speech_final, shorter than the released interim
  tracker.onResult([final(idx0Final), interim(idx1)], 2100) // the overlap re-appears at index 1
  tracker.tick(2800) // release index 1; "hung out with" is dropped as a repeat of the tail
  return run
}

// --- Case 2: a released word is contradicted by the endpoint's final (Please -> The) ---
// minWords=2 now blocks a lone one-word interim, so the single word is modeled as a released final
// (the child paused after it); the re-segmented final at the same index exercises the correction net.
function pleaseCase(): Run {
  const { tracker, run } = makeTracker()
  tracker.onResult([final('Please')], 1000) // released
  tracker.onResult([final('The end.')], 2000) // Deepgram rewrote the segment
  return run
}

// --- Case 3: a plain three-final sequence emits each final once ---
function normalCase(): Run {
  const { tracker, run } = makeTracker()
  tracker.onResult([final('Once upon a time')], 1000)
  tracker.onResult([final('Once upon a time'), final('there was a cat')], 2000)
  tracker.onResult(
    [final('Once upon a time'), final('there was a cat'), final('who liked to nap')],
    3000
  )
  return run
}

interface Check {
  name: string
  run: Run
  emits: string[]
  corrects: Array<[string, string]>
}

const checks: Check[] = [
  {
    name: 'dup re-segment',
    run: dupCase(),
    emits: ['Once upon a time, there was a dragon who hung out with', 'a princess.'],
    corrects: [],
  },
  {
    name: 'correction',
    run: pleaseCase(),
    emits: ['Please', 'end.'],
    corrects: [['Please', 'The']],
  },
  {
    name: 'three finals',
    run: normalCase(),
    emits: ['Once upon a time', 'there was a cat', 'who liked to nap'],
    corrects: [],
  },
]

const j = (v: unknown): string => JSON.stringify(v)
let failed = 0
const rows: Array<{ name: string; field: string; ok: boolean; got: string; want: string }> = []
for (const c of checks) {
  const emitOk = j(c.run.emits) === j(c.emits)
  const corrOk = j(c.run.corrects) === j(c.corrects)
  if (!emitOk) failed++
  if (!corrOk) failed++
  rows.push({ name: c.name, field: 'emits', ok: emitOk, got: j(c.run.emits), want: j(c.emits) })
  rows.push({
    name: c.name,
    field: 'corrects',
    ok: corrOk,
    got: j(c.run.corrects),
    want: j(c.corrects),
  })
}

const pad = (s: string, n: number): string => (s.length >= n ? s : s + ' '.repeat(n - s.length))
console.log(pad('case', 16), pad('field', 10), pad('ok', 4), 'value')
for (const r of rows) {
  console.log(
    pad(r.name, 16),
    pad(r.field, 10),
    pad(r.ok ? 'ok' : 'FAIL', 4),
    r.ok ? r.got : `got ${r.got} want ${r.want}`
  )
}

if (failed > 0) {
  console.error(`\n${failed} mismatch(es)`)
  process.exit(1)
}
console.log('\nall tracker checks passed')
