/** The first-launch intro copy, in order. Pure data so scripts/render-coach.ts can import it. */
export interface IntroCopy {
  /** On-screen heading (no trailing period). */
  title: string
  /** What the coach voice says (scripts/render-coach.ts renders these to src/tutorial/intro/N.mp3). */
  voice: string
}

export const INTRO_COPY: readonly IntroCopy[] = [
  { title: 'Tell a story your way', voice: 'Hi! This is your story book. You tell the story, any way you like.' },
  { title: 'Say whatever is in your head and watch it draw', voice: 'Say whatever is in your head, and watch the crayon draw it.' },
  { title: 'Change your mind anytime, the crayon keeps up', voice: 'Changed your mind? Just say so. The crayon keeps up.' },
  { title: 'When you’re done, say “The End”', voice: 'When your story is all finished, just say: The End!' },
  { title: 'Ready? Tap the mic and start', voice: 'Ready? Tap the big yellow button, and start talking!' },
]
