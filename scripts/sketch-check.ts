/**
 * Sketch dialect check: every example line and every cookbook recipe in the prompt must parse.
 * With --gallery also writes one BenchFile per recipe (lab/proto/gallery/sketch/<name>.json) so the
 * recipes render without the API: node scripts/proto-render.mjs gallery sketch port=7742
 *
 *   bun scripts/sketch-check.ts [--gallery]
 */
import { promises as fs } from 'node:fs'
import { Scene } from '~/engine/scene'
import { VirtualClock } from '~/engine/clock'
import { SketchDialect } from '~/llm/sketch/dialect'
import { SKETCH_SYSTEM_PROMPT } from '~/llm/sketch/prompt'
import { isSketchColor } from '~/llm/sketch/palette'
import type { BenchFile } from '~/proto/bench-types'

/** A dialect whose commands are applied to its own Scene, as the Director does. */
function fresh(): { parse: (line: string) => { ok: true } | { ok: false; error: string } } {
  const scene = new Scene()
  const dialect = new SketchDialect(scene, { moderation: true, clock: new VirtualClock() })
  dialect.later = (cmds) => cmds.forEach((c) => scene.apply(c))
  return {
    parse: (line) => {
      const r = dialect.parse(line)
      if (!r.ok) return r
      for (const c of r.cmds) scene.apply(c)
      return { ok: true }
    },
  }
}
let bad = 0

// 1. the worked example, in order through one dialect (one scene)
const ex = SKETCH_SYSTEM_PROMPT.slice(SKETCH_SYSTEM_PROMPT.indexOf('# Example'))
const d = fresh()
for (const line of ex.split('\n').slice(1)) {
  if (!line.trim() || line.startsWith('NEW STORY')) continue
  const r = d.parse(line)
  if (!r.ok) {
    bad++
    console.log('EXAMPLE', r.error)
  }
}

// 2. cookbook recipes: "name (note): part color shape; part color shape; face head right"
const cb = SKETCH_SYSTEM_PROMPT.slice(
  SKETCH_SYSTEM_PROMPT.indexOf('# Cookbook'),
  SKETCH_SYSTEM_PROMPT.indexOf('# Story beats')
)
const gallery = process.argv.includes('--gallery')
if (gallery) await fs.mkdir('lab/proto/gallery/sketch', { recursive: true })
let recipes = 0
for (const raw of cb.split('\n').slice(1)) {
  const m = /^\s*([a-z0-9 ]+?)(?: \([^)]*\))?: (.*)$/.exec(raw)
  if (!m?.[1] || !m[2]) continue
  const name = m[1].trim().replace(/ /g, '-')
  const hm = /h=(\d+)/.exec(raw)
  const dd = fresh()
  const lines = ['bg day grass', `ent r 600 ${/float/.test(raw) ? 400 : 525} h=${hm?.[1] ?? 320}`]
  for (const seg0 of m[2].split(/; |\. /)) {
    const seg = seg0.replace(/\.$/, '').trim()
    const toks = seg.split(/\s+/)
    if (toks[0] === 'face') lines.push(`face r ${toks.slice(1).join(' ')}`)
    else if (toks.length > 2 && /^[a-z0-9]+$/.test(toks[0] ?? '') && isSketchColor(toks[1] ?? ''))
      lines.push(`r.${seg}`)
  }
  if (lines.length < 3) continue
  recipes++
  for (const l of lines) {
    const r = dd.parse(l)
    if (!r.ok) {
      bad++
      console.log(`RECIPE ${name}:`, r.error)
    }
  }
  if (gallery) {
    const file: BenchFile = {
      storyId: name,
      dialect: 'sketch',
      model: 'hand',
      systemTokens: null,
      beats: [
        {
          words: name,
          lines,
          firstTokenMs: null,
          firstInkMs: null,
          doneMs: 0,
          input: 0,
          cacheRead: 0,
          cacheWrite: 0,
          output: 0,
          costUsd: null,
          parseErrors: [],
          error: null,
        },
      ],
    }
    await fs.writeFile(`lab/proto/gallery/sketch/${name}.json`, JSON.stringify(file))
  }
}
console.log(`${recipes} recipes, ${bad} bad lines`)
process.exit(bad ? 1 : 0)
