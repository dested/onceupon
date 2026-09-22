/**
 * Pure tools for editing and checking a drawing-model system prompt: apply the editor's find/replace
 * patch, validate the result against the frozen grammar and example story, diff two versions for the
 * UI, and count prompt tokens. The validator is the guardrail on the auto hill-climb: a patch that
 * breaks the ops grammar or the example story never gets run.
 */
import { parseOpsLine } from '~/llm/ops-dsl'
import { labClient } from './judge'
import type { PromptPatch } from './types'

const REQUIRED_HEADERS = [
  '# Paper',
  '# Ops',
  '# How to draw well',
  '# Cookbook',
  '# Story beats',
  '# For a small child',
  '# Example',
] as const

function countOccurrences(haystack: string, needle: string): number {
  if (needle === '') return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) break
    count++
    from = at + needle.length
  }
  return count
}

function truncate(s: string): string {
  const flat = s.replace(/\n/g, '\\n')
  return flat.length > 60 ? `${flat.slice(0, 60)}...` : flat
}

export function applyPatch(
  prompt: string,
  patch: PromptPatch
): { ok: true; text: string } | { ok: false; error: string } {
  let text = prompt
  for (let i = 0; i < patch.edits.length; i++) {
    const edit = patch.edits[i]
    if (!edit) continue
    const count = countOccurrences(text, edit.find)
    if (count === 0)
      return { ok: false, error: `edit ${i}: find not found: "${truncate(edit.find)}"` }
    if (count > 1)
      return {
        ok: false,
        error: `edit ${i}: find occurs ${count} times, must be unique: "${truncate(edit.find)}"`,
      }
    const at = text.indexOf(edit.find)
    text = text.slice(0, at) + edit.replace + text.slice(at + edit.find.length)
  }
  return { ok: true, text }
}

/** Index of the start of the line beginning with `header`, or -1. */
function headerLineStart(text: string, header: string): number {
  if (text.startsWith(header)) return 0
  const at = text.indexOf(`\n${header}`)
  return at < 0 ? -1 : at + 1
}

/** Text from the header line to the next `\n# ` header or the end. */
export function sectionOf(text: string, header: string): string {
  const start = headerLineStart(text, header)
  if (start < 0) return ''
  const next = text.indexOf('\n# ', start + header.length)
  return next < 0 ? text.slice(start) : text.slice(start, next)
}

export function validatePrompt(text: string, seedText: string): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  const lines = text.split('\n')

  for (const header of REQUIRED_HEADERS) {
    const n = lines.filter((l) => l.startsWith(header)).length
    if (n !== 1) errors.push(`header "${header}" must appear exactly once, found ${n}`)
  }

  if (!/# For a small child\n[^\n]+\n\n/.test(text))
    errors.push('"# For a small child" must be one paragraph followed by a blank line')
  if (!text.includes('skip\n  See below.\n'))
    errors.push('the "skip" op ("skip\\n  See below.") is missing')

  if (text.includes('`')) errors.push('the prompt must not contain a backtick')
  if (text.includes('${')) errors.push('the prompt must not contain "${"')

  const example = sectionOf(text, '# Example')
  for (const line of example.split('\n')) {
    const t = line.trim()
    if (t === '' || t.startsWith('NEW STORY:') || t.startsWith('#')) continue
    const res = parseOpsLine(line)
    if (!res.ok) errors.push(`# Example line does not parse: ${res.error}`)
    else if (res.op === null) errors.push(`# Example line produced no op: "${truncate(line)}"`)
  }

  const opsHere = sectionOf(text, '# Ops')
  const opsSeed = sectionOf(seedText, '# Ops')
  if (opsHere !== opsSeed)
    errors.push('the "# Ops" section must be byte-identical to the seed (the grammar is frozen)')

  return { ok: errors.length === 0, errors }
}

export interface DiffLine {
  k: 'same' | 'add' | 'del'
  line: string
}

/** Simple LCS line diff for the UI. */
export function diffLines(a: string, b: string): DiffLine[] {
  const A = a.split('\n')
  const B = b.split('\n')
  const n = A.length
  const m = B.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  const at = (i: number, j: number): number => dp[i]?.[j] ?? 0
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    if (!row) continue
    for (let j = m - 1; j >= 0; j--) {
      row[j] = A[i] === B[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ k: 'same', line: A[i] ?? '' })
      i++
      j++
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      out.push({ k: 'del', line: A[i] ?? '' })
      i++
    } else {
      out.push({ k: 'add', line: B[j] ?? '' })
      j++
    }
  }
  while (i < n) {
    out.push({ k: 'del', line: A[i] ?? '' })
    i++
  }
  while (j < m) {
    out.push({ k: 'add', line: B[j] ?? '' })
    j++
  }
  return out
}

export async function countPromptTokens(text: string, model: string): Promise<number> {
  const client = labClient()
  const res = await client.messages.countTokens({
    model,
    system: text,
    messages: [{ role: 'user', content: 'x' }],
  })
  return res.input_tokens
}
