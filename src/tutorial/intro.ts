import v1 from './intro/1.mp3'
import v2 from './intro/2.mp3'
import v3 from './intro/3.mp3'
import v4 from './intro/4.mp3'
import v5 from './intro/5.mp3'
import { INTRO_COPY, type IntroCopy } from './intro-copy'

export interface IntroSlideCopy extends IntroCopy {
  voiceSrc: string
}

const VOICES: readonly string[] = [v1, v2, v3, v4, v5]

/** The intro slides with their rendered voice lines. Each slide's drawing: scripts/author-intro.ts. */
export const INTRO_SLIDES: readonly IntroSlideCopy[] = INTRO_COPY.map((c, i) => ({
  ...c,
  voiceSrc: VOICES[i] ?? '',
}))

let current: HTMLAudioElement | null = null

/** Stop whatever line is playing. */
export function stopIntroVoice(): void {
  if (current) {
    current.pause()
    current = null
  }
}

/**
 * Play one slide's line. Resolves 'played' when it ends, 'blocked' if the browser refused to start it
 * without a tap (the intro then shows a hear-it button), 'stopped' if another line replaced it.
 */
export function playIntroVoice(src: string): Promise<'played' | 'blocked' | 'stopped'> {
  stopIntroVoice()
  const el = new Audio(src)
  current = el
  return new Promise((resolve) => {
    el.onended = () => {
      if (current === el) current = null
      resolve('played')
    }
    el.onerror = () => resolve('stopped')
    el.onpause = () => {
      if (!el.ended) resolve('stopped')
    }
    el.play().catch(() => resolve('blocked'))
  })
}
