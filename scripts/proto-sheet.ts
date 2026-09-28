/**
 * Contact sheet for a prototype run: one row per story beat, one column per dialect/style, timing
 * and cost under each picture, a summary table on top.
 *
 *   bun scripts/proto-sheet.ts <run> [col=dialect[.style] ...]
 *
 * Columns default to every dialect dir in lab/proto/<run>/ plus every style suffix found on its jpgs.
 * Writes lab/proto/<run>/sheet.html (relative image paths: open it from disk).
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { benchFileSchema, type BenchFile } from '~/proto/bench-types'

const run = process.argv[2]
if (!run) throw new Error('usage: bun scripts/proto-sheet.ts <run> [col ...]')
const root = path.join('lab', 'proto', run)
const dialects = (await fs.readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name)

interface Col {
  dialect: string
  style: string
}
let cols: Col[] = []
if (process.argv.length > 3) {
  cols = process.argv.slice(3).map((c) => {
    const [dialect = c, style = 'classic'] = c.split('.')
    return { dialect, style }
  })
} else {
  for (const d of dialects) {
    const styles = new Set<string>()
    for (const f of await fs.readdir(path.join(root, d))) {
      const m = /-b\d+(?:\.([a-z0-9]+))?\.jpg$/.exec(f)
      if (m) styles.add(m[1] ?? 'classic')
    }
    for (const s of [...styles].sort()) cols.push({ dialect: d, style: s })
  }
}

const files = new Map<string, Map<string, BenchFile>>()
for (const d of new Set(cols.map((c) => c.dialect))) {
  const m = new Map<string, BenchFile>()
  for (const f of await fs.readdir(path.join(root, d))) {
    if (!f.endsWith('.json') || f.startsWith('_')) continue
    const bf = benchFileSchema.parse(JSON.parse(await fs.readFile(path.join(root, d, f), 'utf8')))
    m.set(bf.storyId, bf)
  }
  files.set(d, m)
}
const storyIds = [...new Set([...files.values()].flatMap((m) => [...m.keys()]))].sort()

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const ms = (n: number | null): string => (n === null ? '–' : `${(n / 1000).toFixed(2)}s`)
const med = (xs: number[]): number | null => {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b)
  return s.length ? (s[Math.floor(s.length / 2)] ?? null) : null
}

const summaryRows = [...files.entries()].map(([d, m]) => {
  const beats = [...m.values()].flatMap((f) => f.beats).filter((b) => !b.error)
  const sys = [...m.values()][0]?.systemTokens ?? null
  const cost = beats.reduce((a, b) => a + (b.costUsd ?? 0), 0) / Math.max(1, beats.length)
  const pe = beats.reduce((a, b) => a + b.parseErrors.length, 0)
  const nn = (xs: Array<number | null>): number[] => xs.filter((x): x is number => x !== null)
  return `<tr><td>${esc(d)}</td><td>${beats.length}</td><td>${sys ?? '–'}</td><td>${ms(med(nn(beats.map((b) => b.firstTokenMs))))}</td><td>${ms(med(nn(beats.map((b) => b.firstInkMs))))}</td><td>${ms(med(beats.map((b) => b.doneMs)))}</td><td>${Math.round(beats.reduce((a, b) => a + b.output, 0) / Math.max(1, beats.length))}</td><td>$${cost.toFixed(4)}</td><td>${pe}</td></tr>`
})

const rows: string[] = []
for (const id of storyIds) {
  const nBeats = Math.max(...cols.map((c) => files.get(c.dialect)?.get(id)?.beats.length ?? 0))
  for (let i = 0; i < nBeats; i++) {
    const words = cols.map((c) => files.get(c.dialect)?.get(id)?.beats[i]?.words).find((w) => w) ?? ''
    const cells = cols.map((c) => {
      const b = files.get(c.dialect)?.get(id)?.beats[i]
      const suffix = c.style === 'classic' ? '' : `.${c.style}`
      const img = `${c.dialect}/${id}-b${i + 1}${suffix}.jpg`
      if (!b) return '<td></td>'
      const pe = b.parseErrors.length ? ` <b class="bad">${b.parseErrors.length} parse</b>` : ''
      const tip = esc(b.lines.join('\n'))
      return `<td><a href="${img}" target="_blank"><img src="${img}" loading="lazy" title="${tip}"></a><div class="m">ink ${ms(b.firstInkMs)} · done ${ms(b.doneMs)} · ${b.output} tok · $${(b.costUsd ?? 0).toFixed(4)}${pe}</div><details><summary>${b.lines.length} lines</summary><pre>${tip}</pre></details></td>`
    })
    rows.push(`<tr><th><div class="id">${esc(id)} ${nBeats > 1 ? `#${i + 1}` : ''}</div><div class="w">${esc(words)}</div></th>${cells.join('')}</tr>`)
  }
}

const html = `<!doctype html><meta charset="utf-8"><title>Proto ${esc(run)}</title>
<style>body{font:13px system-ui;margin:16px;background:#faf7f0;color:#2b2626}table{border-collapse:collapse}td,th{vertical-align:top;padding:6px;border-bottom:1px solid #e5dccb;text-align:left}img{width:420px;display:block;border-radius:6px}.m{color:#6b5d4d;margin-top:4px}.bad{color:#c0392b}.id{font-weight:600}.w{font-weight:400;max-width:180px;color:#6b5d4d}pre{white-space:pre-wrap;font-size:11px;max-width:420px}.sum td,.sum th{padding:4px 10px}</style>
<h1>Prototype run ${esc(run)}</h1>
<table class="sum"><tr><th>dialect</th><th>calls</th><th>system tok</th><th>med first token</th><th>med first ink</th><th>med done</th><th>mean out tok</th><th>mean $/call</th><th>parse errs</th></tr>${summaryRows.join('')}</table>
<table><tr><th></th>${cols.map((c) => `<th>${esc(c.dialect)}${c.style === 'classic' ? '' : ` · ${esc(c.style)}`}</th>`).join('')}</tr>${rows.join('')}</table>`
await fs.writeFile(path.join(root, 'sheet.html'), html)
console.log(`wrote ${path.join(root, 'sheet.html')} (${storyIds.length} stories, ${cols.length} columns)`)
