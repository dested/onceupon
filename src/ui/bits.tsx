import type { ReactNode, ButtonHTMLAttributes } from 'react'

/** A paper-sticker button: thick ink outline, slight tilt, pastel fill. */
export function StickerButton({
  children,
  tone = 'paper',
  tilt = -2,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'paper' | 'red' | 'blue' | 'yellow' | 'green'; tilt?: number }) {
  const fill = {
    paper: 'bg-paper',
    red: 'bg-crayon-red text-white',
    blue: 'bg-crayon-blue text-white',
    yellow: 'bg-crayon-yellow',
    green: 'bg-crayon-green text-white',
  }[tone]
  return (
    <button
      {...rest}
      style={{ transform: `rotate(${tilt}deg)`, ...rest.style }}
      className={`inline-flex items-center gap-2 rounded-2xl border-[3px] border-ink px-4 py-2 text-xl leading-none shadow-[3px_4px_0_0_rgba(59,47,47,0.35)] transition active:translate-y-[2px] active:shadow-[1px_2px_0_0_rgba(59,47,47,0.35)] disabled:opacity-40 ${fill} ${className}`}>
      {children}
    </button>
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

export function PaperCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-3xl border-[3px] border-ink bg-paper p-6 shadow-[6px_8px_0_0_rgba(59,47,47,0.3)] ${className}`}>
      {children}
    </div>
  )
}
