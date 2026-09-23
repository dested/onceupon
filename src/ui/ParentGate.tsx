import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { useApp } from '~/story/store'
import { resolveGate } from './hosted'

/**
 * The grown-up gate: a written-out sum a small child cannot solve, shown before any purchase, link-out,
 * or the first microphone permission prompt (Apple's Kids category rule). Rendered once in App; it opens
 * whenever `gate()` bumps `gateRequest`. Correct answer resolves true; three wrong or "Not now" resolves
 * false. Nothing is persisted: the gate is per action.
 */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
] as const

function inWords(n: number): string {
  return ONES[n] ?? String(n)
}

interface Question {
  a: number
  b: number
}

function makeQuestion(): Question {
  const a = 3 + Math.floor(Math.random() * 7) // 3..9
  const b = 3 + Math.floor(Math.random() * 7) // 3..9
  return { a, b }
}

export function ParentGate() {
  const gateRequest = useApp((s) => s.gateRequest)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState<Question>(makeQuestion)
  const [answer, setAnswer] = useState('')
  const [wrong, setWrong] = useState(0)
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (gateRequest === 0) return
    setQ(makeQuestion())
    setAnswer('')
    setWrong(0)
    const d = dialogRef.current
    if (d && !d.open) d.showModal()
    window.setTimeout(() => inputRef.current?.focus(), 60)
  }, [gateRequest])

  const finish = (ok: boolean): void => {
    dialogRef.current?.close()
    resolveGate(ok)
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (Number(answer.trim()) === q.a + q.b) {
      finish(true)
      return
    }
    const next = wrong + 1
    if (next >= 3) {
      finish(false)
      return
    }
    setWrong(next)
    setQ(makeQuestion())
    setAnswer('')
    setShake(true)
    window.setTimeout(() => setShake(false), 480)
    inputRef.current?.focus()
  }

  const field =
    'w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 text-center font-hand text-2xl text-ink outline-none'

  return (
    <dialog
      ref={dialogRef}
      className={`new-story-dialog grown-dialog ${shake ? 'grown-shake' : ''}`}
      onCancel={(e) => {
        e.preventDefault()
        finish(false)
      }}
      aria-labelledby="grown-gate-heading">
      <h2 id="grown-gate-heading" className="font-scrawl">
        Ask a grown-up
      </h2>
      <p>To keep going, a grown-up solves this:</p>
      <form onSubmit={submit}>
        <div className="grown-gate-question font-scrawl" data-testid="gate-question">
          What is {inWords(q.a)} plus {inWords(q.b)}?
        </div>
        <input
          ref={inputRef}
          value={answer}
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="off"
          className={field}
          placeholder="?"
          data-testid="gate-answer"
          onChange={(e) => setAnswer(e.target.value.replace(/[^0-9]/g, ''))}
        />
        {wrong > 0 && (
          <p className="grown-gate-oops" role="status">
            Not quite, try again
          </p>
        )}
        <div>
          <button
            type="button"
            className="studio-button"
            onClick={() => finish(false)}
            data-testid="gate-cancel">
            Not now
          </button>
          <button
            type="submit"
            className="studio-button replay-button"
            disabled={answer.trim().length === 0}
            data-testid="gate-go">
            Go
          </button>
        </div>
      </form>
    </dialog>
  )
}
