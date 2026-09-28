/**
 * The prototype bench set. A story is one or more beats; each beat is one model call, sent the way
 * the Director sends it (earlier beats as cached story chunks, the page described back through the
 * dialect). Single-beat stories are the lab's subjects and actions; the multi-beat ones test what
 * a dialect does with CURRENT PAGE, page turns and continuity.
 */
export interface BenchStory {
  id: string
  beats: string[]
  /** In the quick set (fast iteration). Everything is in the full set. */
  quick?: boolean
  /** Long-tail subjects no library covers (set=tail). */
  tail?: boolean
}

export const BENCH_STORIES: BenchStory[] = [
  // lone subjects
  { id: 'horse', beats: ['horse'], quick: true },
  { id: 'princess', beats: ['princess'], quick: true },
  { id: 'dragon', beats: ['dragon'] },
  { id: 'cat', beats: ['cat'] },
  { id: 'elephant', beats: ['elephant'] },
  { id: 'owl', beats: ['owl'] },
  { id: 'robot', beats: ['robot'] },
  { id: 'pirate', beats: ['pirate'] },
  { id: 'castle', beats: ['castle'] },
  { id: 'airplane', beats: ['airplane'] },
  { id: 'snowman', beats: ['snowman'] },
  { id: 'unicorn', beats: ['unicorn'] },
  { id: 'monster', beats: ['monster'] },
  { id: 'turtle', beats: ['turtle'] },
  // two-thing actions
  { id: 'dragon-fire-castle', beats: ['a dragon breathes fire on a castle'], quick: true },
  { id: 'bear-in-boat', beats: ['a bear sits in a boat on the lake'], quick: true },
  { id: 'dog-jumps-fence', beats: ['the dog jumps over the fence'] },
  { id: 'girl-flies-kite', beats: ['a girl flies a kite'] },
  { id: 'cat-sleeps-bed', beats: ['the cat is sleeping in a bed'] },
  // the long tail: nothing in any cookbook
  { id: 'pig-rocket-car', beats: ['a pig wearing sunglasses drove a rocket car to the candy store'] },
  // not in any catalog: kit must break out and draw freehand
  { id: 'tail-cheese-ship', beats: ['a spaceship made of cheese'], tail: true },
  { id: 'tail-jellyfish', beats: ['a giant jellyfish wearing a crown'], tail: true },
  { id: 'tail-toaster', beats: ['a toaster with legs that can talk'], tail: true },
  { id: 'tail-volcano', beats: ['a volcano erupting with lava'], tail: true },
  { id: 'tail-windmill', beats: ['a windmill on a hill'], tail: true },
  { id: 'tail-snail', beats: ['a snail with a rainbow shell'], tail: true },
  { id: 'tail-hat-horse', beats: ['a horse wearing a birthday party hat and a long striped scarf'], tail: true },
  // multi-beat stories
  {
    id: 'story-bunny',
    quick: true,
    beats: [
      'Once upon a time there was a little bunny who lived next to a big red house',
      'one day a hungry fox came out of the forest',
      'the bunny was scared and hid behind a tree',
      'then they went inside the house and ate carrot soup together',
    ],
  },
  {
    id: 'story-dragon',
    beats: [
      'there was a purple dragon who loved to eat pizza',
      'one night he flew all the way up to the moon',
      'on the moon he met an alien with three eyes and they became best friends',
    ],
  },
  {
    id: 'story-princess',
    beats: [
      'a princess had a pet dinosaur named Sprinkles',
      'they went to the beach and built a big sandcastle',
      'then a giant wave came and washed it away and the dinosaur cried',
      'so the princess gave him an ice cream and he was happy again',
    ],
  },
]

export function benchSet(which: 'quick' | 'full' | string): BenchStory[] {
  if (which === 'full') return BENCH_STORIES
  if (which === 'quick') return BENCH_STORIES.filter((s) => s.quick)
  if (which === 'tail') return BENCH_STORIES.filter((s) => s.tail)
  const ids = which.split(',')
  return BENCH_STORIES.filter((s) => ids.includes(s.id))
}
