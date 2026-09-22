import type { DebugHandle } from '~/debug-handle'
import type { CallStat } from '~/llm/director'
import { effectiveSttRate, resolveStt, type AppState } from './store'
import { trackerOptionsFor, VOICE_HOLD_MS, VOICE_LEVEL } from '~/speech/beat-rules'

/**
 * One pasteable text dump of everything the debug panel knows, on ONE clock: ms since the story
 * session started (`t0`). Calls, DSL lines, the child's words, and the ears trace are merged into a
 * single timeline so a "the crayon started while I was still talking" report can be read straight
 * off the gaps.
 */

interface Row {
  t: number
  kind: string
  text: string
}

const ms = (n: number): string => `${Math.round(n)}`
const secs = (n: number): string => `${(n / 1000).toFixed(1)}s`
const q = (s: string): string => `"${s.replace(/\s+/g, ' ').trim()}"`

function callLine(c: CallStat, t0: number): string {
  const sent = ms(c.sentAt - t0)
  const first = c.firstTokenMs === null ? '...' : ms(c.firstTokenMs)
  const done = c.doneMs === null ? '...' : ms(c.doneMs)
  const usage = c.usage
    ? `${c.usage.input + c.usage.cacheWrite + c.usage.cacheRead} in (${c.usage.cacheRead} cached, ${c.usage.cacheWrite} cache write) / ${c.usage.output} out`
    : 'no usage'
  const cost = c.costUsd === null ? '' : ` · $${c.costUsd.toFixed(4)}`
  const err = c.error ? ` · ERROR ${c.error}` : ''
  return `#${c.id} sent ${sent} · first token +${first}ms · done +${done}ms · ${c.lines} lines · ${usage}${cost}${err}\n    words: ${q(c.words)}`
}

export function buildDebugReport(s: AppState, h: DebugHandle | null): string {
  const t0 = h?.t0 ?? 0
  const listenT0 = h?.listenT0?.() ?? 0
  const now = performance.now()
  const settings = s.settings
  const stt = resolveStt(settings)
  const tracker = trackerOptionsFor(settings)
  const out: string[] = []

  out.push('# Once Upon debug report')
  out.push(
    `generated ${new Date().toISOString()} · session age ${secs(now - t0)} · listening ${listenT0 ? `since ${ms(listenT0 - t0)}` : 'never started'} · status ${s.status}`
  )
  out.push(`browser: ${navigator.userAgent}`)
  out.push(`screen: ${window.innerWidth}x${window.innerHeight} @${window.devicePixelRatio}`)
  out.push('')

  out.push('## settings')
  out.push(
    `model: ${settings.provider}/${settings.model} · dialect ${settings.dialect} · moderation ${settings.moderation ? 'on' : 'off'} · sound ${settings.sound ? 'on' : 'off'}`
  )
  out.push(
    `ears: ${stt} (mode ${settings.stt}) · openai model ${settings.sttModel} · deepgram model ${settings.deepgramModel} · rate $${effectiveSttRate(settings)}/min · mic ${settings.micDeviceId || 'default'}`
  )
  out.push(
    `tracker: stableMs ${tracker.stableMs} · minWords ${tracker.minWords} · maxWords ${tracker.maxWords} · holdBack ${tracker.holdBack} · voice hold level>=${VOICE_LEVEL} within ${VOICE_HOLD_MS}ms`
  )
  out.push(
    `keys: anthropic ${settings.keys.anthropic ? 'set' : 'none'} · openai ${settings.keys.openai ? 'set' : 'none'} · deepgram ${settings.keys.deepgram ? 'set' : 'none'} · openrouter ${settings.keys.openrouter ? 'set' : 'none'}`
  )
  out.push('')

  out.push('## spend')
  const done = s.calls.filter((c) => c.doneMs !== null && c.error === null)
  const avg = (pick: (c: CallStat) => number | null): string => {
    const xs = done.map(pick).filter((n): n is number => n !== null)
    return xs.length ? ms(xs.reduce((a, b) => a + b, 0) / xs.length) : '-'
  }
  out.push(
    `calls ${s.spend.calls} (${done.length} ok) · $${s.spend.usd.toFixed(4)} · in ${s.spend.input + s.spend.cached} (cached ${s.spend.cached}) · out ${s.spend.output} · avg first token ${avg((c) => c.firstTokenMs)}ms · avg done ${avg((c) => c.doneMs)}ms`
  )
  out.push(
    `ears: ${(s.spend.audioMs / 60000).toFixed(2)} min sent · ~$${((s.spend.audioMs / 60000) * effectiveSttRate(settings)).toFixed(4)} (estimate)`
  )
  out.push('')

  out.push('## calls (t = ms since session start; +ms relative to sent)')
  if (s.calls.length === 0) out.push('(none)')
  for (const c of s.calls) out.push(callLine(c, t0))
  out.push('')

  out.push('## now')
  out.push(`drawing (in flight): ${q(s.drawingWords) || '-'}`)
  out.push(`queued (heard, not sent): ${q(s.queuedWords) || '-'}`)
  out.push(`interim (still being said): ${q(s.transcriptInterim) || '-'}`)
  out.push(`mic level: ${s.micLevel.toFixed(2)}`)
  out.push('')

  out.push('## timeline (t = ms since session start)')
  const rows: Row[] = []
  const story = h?.story?.()
  if (story) {
    for (const ev of story.events) {
      if (ev.k === 'words') rows.push({ t: ev.t, kind: 'words', text: q(ev.text) })
      else if (ev.k === 'end') rows.push({ t: ev.t, kind: 'the end', text: '(finale)' })
    }
  }
  for (const c of s.calls) {
    rows.push({ t: c.sentAt - t0, kind: `call#${c.id}`, text: `sent ${q(c.words)}` })
    if (c.firstTokenMs !== null)
      rows.push({
        t: c.sentAt - t0 + c.firstTokenMs,
        kind: `call#${c.id}`,
        text: `first token (+${ms(c.firstTokenMs)}ms)`,
      })
    if (c.doneMs !== null)
      rows.push({
        t: c.sentAt - t0 + c.doneMs,
        kind: `call#${c.id}`,
        text: `${c.error ? `ended: ${c.error}` : 'done'} (+${ms(c.doneMs)}ms, ${c.lines} lines)`,
      })
  }
  for (const l of s.lines)
    rows.push({
      t: l.t - t0,
      kind: l.ok ? 'cmd' : 'cmd!!',
      text: l.ok ? l.line : `${l.line}   <- ${l.error ?? 'error'}`,
    })
  if (listenT0)
    for (const e of s.sttLog)
      rows.push({ t: listenT0 - t0 + e.t, kind: `ears ${e.kind}`, text: e.text })
  rows.sort((a, b) => a.t - b.t)
  const w = Math.max(6, ...rows.map((r) => ms(r.t).length))
  for (const r of rows) out.push(`${ms(r.t).padStart(w)}  ${r.kind.padEnd(12)} ${r.text}`)
  if (s.lines.length >= 199) out.push('(cmd lines are the last 200 only)')
  if (s.sttLog.length >= 59) out.push('(ears trace is the last 60 events only)')
  out.push('')

  out.push('## transcript')
  out.push(s.transcriptFinal || '(nothing yet)')
  out.push('')

  if (h) {
    out.push(
      `## scene now (page ${h.scene.page.index}${h.scene.page.title ? ` "${h.scene.page.title}"` : ''})`
    )
    const d: unknown = h.director.dialect
    const snap =
      typeof d === 'object' && d !== null && 'snapshot' in d && typeof d.snapshot === 'function'
        ? String((d.snapshot as () => string).call(d))
        : h.scene.summary()
    out.push(snap)
    out.push('')
  }

  if (s.warnings.length > 0) {
    out.push('## warnings')
    for (const wmsg of s.warnings) out.push(`- ${wmsg}`)
    out.push('')
  }

  return out.join('\n')
}
