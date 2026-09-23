import c1 from './coach/1.mp3'
import c2 from './coach/2.mp3'
import c3 from './coach/3.mp3'
import c4 from './coach/4.mp3'

/** The four spoken coach lines of the first-launch tutorial, in order. */
export const COACH_LINES: readonly string[] = [
  "Tell your story out loud, like you're telling a friend.",
  'Look! The crayon is drawing your words. Watch your story come to life.',
  'When the crayon stops, tell what happens next.',
  'All done? Just say: The End!',
]

const SOURCES: readonly string[] = [c1, c2, c3, c4]

let current: HTMLAudioElement | null = null

/** Play one coach line; resolves when it ends or errors. A second call stops the first. */
export function playCoachLine(n: 1 | 2 | 3 | 4): Promise<void> {
  if (current) {
    current.pause()
    current = null
  }
  const src = SOURCES[n - 1]
  if (!src) return Promise.resolve()
  const el = new Audio(src)
  current = el
  return new Promise<void>((resolve) => {
    const done = (): void => {
      if (current === el) current = null
      resolve()
    }
    el.onended = done
    el.onerror = done
    void el.play().catch(done)
  })
}
