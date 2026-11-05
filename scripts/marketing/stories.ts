/**
 * The three marketing stories, one per custom product page theme. Each line is one spoken sentence;
 * the last is always "The End". Words on screen must match these words exactly (store/marketing/stories.md).
 * Kept to subjects the crayon draws well and that the drawing honours (no counts).
 */
export type Theme = 'dragons' | 'bedtime' | 'ocean'

export interface MarketingStory {
  theme: Theme
  title: string
  lines: string[]
}

export const STORIES: MarketingStory[] = [
  {
    theme: 'dragons',
    title: 'The purple dragon',
    lines: [
      'Once upon a time a purple dragon lived in a big castle on a hill.',
      'One day he flew up into the sky and found a rainbow.',
      'The End!',
    ],
  },
  {
    theme: 'bedtime',
    title: 'The sleepy owl',
    lines: [
      'Once upon a time a sleepy owl lived in a tree.',
      'At night the moon came out and the stars were twinkling.',
      'The owl said goodnight and went to sleep.',
      'The End!',
    ],
  },
  {
    theme: 'ocean',
    title: 'The little turtle',
    lines: [
      'Once upon a time a little green turtle lived in the sea.',
      'She swam with a happy pink fish and they found a treasure chest.',
      'The End!',
    ],
  },
]

/** The kid voice for every marketing asset: ElevenLabs "Teddy Twinkle" (young, American), model eleven_v4. */
export const VOICE = { name: 'Teddy', id: 'XjGYkUkzth8BPs29fmcV', model: 'eleven_v4' } as const
