import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/**
 * The site's sticker vocabulary, ported from the studio's src/ui/bits.tsx (root ui.md): thick ink
 * outline, pastel fill, hard offset shadow, slight tilt. Use these instead of raw Tailwind buttons.
 */

export type Tone = 'paper' | 'red' | 'blue' | 'yellow' | 'green' | 'lilac' | 'sage' | 'coral'

const FILL: Record<Tone, string> = {
  paper: 'bg-paper text-ink',
  red: 'bg-crayon-red text-white',
  blue: 'bg-crayon-blue text-white',
  yellow: 'bg-crayon-yellow text-ink',
  green: 'bg-crayon-green text-white',
  lilac: 'bg-lilac text-ink',
  sage: 'bg-sage text-ink',
  coral: 'bg-coral text-ink',
}

const STICKER =
  'inline-flex items-center justify-center gap-2 rounded-2xl border-[3px] border-ink px-5 py-2.5 text-xl leading-none shadow-[3px_4px_0_0_rgba(59,47,47,0.35)] transition active:translate-y-[2px] active:shadow-[1px_2px_0_0_rgba(59,47,47,0.35)] disabled:opacity-40 disabled:pointer-events-none'

export function StickerButton({
  children,
  tone = 'paper',
  tilt = -2,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; tilt?: number }) {
  return (
    <button
      {...rest}
      style={{ transform: `rotate(${tilt}deg)`, ...rest.style }}
      className={`${STICKER} ${FILL[tone]} ${className}`}>
      {children}
    </button>
  )
}

export function StickerLink({
  children,
  to,
  tone = 'paper',
  tilt = -2,
  className = '',
  external = false,
}: {
  children: ReactNode
  to: string
  tone?: Tone
  tilt?: number
  className?: string
  external?: boolean
}) {
  const style = { transform: `rotate(${tilt}deg)` }
  const cls = `${STICKER} ${FILL[tone]} ${className}`
  if (external)
    return (
      <a href={to} style={style} className={cls} target="_blank" rel="noreferrer">
        {children}
      </a>
    )
  return (
    <Link to={to} style={style} className={cls}>
      {children}
    </Link>
  )
}

export function IconButton({
  label,
  children,
  active = false,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean; children: ReactNode }) {
  return (
    <button
      {...rest}
      aria-label={label}
      title={label}
      className={`grid h-12 w-12 place-items-center rounded-full border-[3px] border-ink shadow-[2px_3px_0_0_rgba(59,47,47,0.35)] transition active:translate-y-[2px] ${active ? 'bg-crayon-yellow' : 'bg-paper'} ${className}`}>
      {children}
    </button>
  )
}

export function PaperCard({
  children,
  className = '',
  tilt = 0,
}: {
  children: ReactNode
  className?: string
  tilt?: number
}) {
  return (
    <div
      style={tilt ? { transform: `rotate(${tilt}deg)` } : undefined}
      className={`rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[6px_8px_0_0_rgba(59,47,47,0.3)] ${className}`}>
      {children}
    </div>
  )
}

/** A hand-lettered heading; never ends with a period, never has an eyebrow above it. */
export function Scrawl({
  children,
  as: Tag = 'h2',
  className = '',
}: {
  children: ReactNode
  as?: 'h1' | 'h2' | 'h3'
  className?: string
}) {
  return <Tag className={`font-scrawl leading-tight tracking-tight ${className}`}>{children}</Tag>
}

export const FIELD =
  'w-full rounded-xl border-[3px] border-ink bg-white px-3 py-2 font-hand text-lg text-ink outline-none focus:border-purple'
export const LABEL = 'mb-1 block font-hand text-lg text-ink-soft'
