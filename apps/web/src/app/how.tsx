import { Link } from 'react-router-dom'
import { PaperCard, Scrawl, StickerLink } from '~/components/paper'
import { Head } from './seo'
import { Section } from './site-parts'

const STEPS = [
  {
    n: 1,
    title: 'Tell your story',
    body: 'Tap the crayon and start talking. “Once there was a dragon…” The iPad listens; there are no buttons to hunt for and nothing to read.',
    tilt: -1.5,
  },
  {
    n: 2,
    title: 'Watch the crayon',
    body: 'As your child talks, a crayon draws what they say, right on the paper, in real time. A dragon, a castle, a rocket to the moon: whatever they say appears.',
    tilt: 1,
  },
  {
    n: 3,
    title: 'Turn the page',
    body: 'Every new idea gets its own page, so the story becomes a real picture book. Flip back through the pages any time.',
    tilt: -1,
  },
  {
    n: 4,
    title: 'Say The End',
    body: 'When your child says “The End”, the crayon draws the finale and the book is saved. That’s the whole game: talking is all it takes.',
    tilt: 1.5,
  },
]

const THEN = [
  'Replay the story, drawn again in their own voice',
  'Download it as a video to keep or post',
  'Send a share link to family',
]

export function HowPage() {
  return (
    <>
      <Head title="How it works" />
      <Section title="How it works" headingClassName="text-4xl md:text-5xl text-ink">
        <div className="grid gap-6 sm:grid-cols-2">
          {STEPS.map((s) => (
            <PaperCard key={s.n} tilt={s.tilt} className="flex gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border-[3px] border-ink bg-coral font-scrawl text-3xl text-ink">
                {s.n}
              </span>
              <div>
                <Scrawl as="h3" className="text-2xl text-ink">
                  {s.title}
                </Scrawl>
                <p className="mt-2 font-hand text-lg text-ink">{s.body}</p>
              </div>
            </PaperCard>
          ))}
        </div>
      </Section>

      <Section title="Then what?">
        <ul className="flex flex-col gap-3">
          {THEN.map((t) => (
            <li key={t} className="font-hand text-xl text-ink">
              • {t}
            </li>
          ))}
        </ul>
      </Section>

      <Section>
        <PaperCard tilt={-1} className="flex flex-col items-start gap-4">
          <Scrawl as="h2" className="text-3xl text-ink">
            What it costs
          </Scrawl>
          <p className="font-hand text-xl text-ink">
            The first story is free. After that you buy minutes in packs that never expire, with no
            subscription to remember.
          </p>
          <div className="flex flex-wrap gap-3">
            <StickerLink to="/pricing" tone="yellow" tilt={-1}>
              See pricing
            </StickerLink>
            <Link to="/faq" className="self-center font-hand text-lg text-purple underline">
              Read the FAQ
            </Link>
          </div>
        </PaperCard>
      </Section>
    </>
  )
}
