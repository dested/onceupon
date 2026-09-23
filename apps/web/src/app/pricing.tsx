import { Link } from 'react-router-dom'
import { PaperCard, Scrawl, StickerLink } from '~/components/paper'
import { Head } from './seo'
import { PackCards, Section } from './site-parts'

const MINI_FAQ: { q: string; a: string }[] = [
  {
    q: 'Do minutes expire?',
    a: 'Never. A pack you buy is yours until it is used, even across a new iPad.',
  },
  {
    q: 'What counts as a minute?',
    a: 'Only the time the microphone is open and drawing. Thinking, pausing and flipping pages are free.',
  },
  {
    q: 'Is there a subscription?',
    a: 'No. You buy minutes once. There is nothing to cancel and nothing renews.',
  },
]

export function PricingPage() {
  return (
    <>
      <Head title="Pricing" />
      <Section title="Minutes, not subscriptions" headingClassName="text-4xl md:text-5xl text-ink">
        <p className="max-w-2xl font-hand text-2xl text-ink">
          The first story is free, about two minutes of storytelling. After that you get 60 free
          seconds every week, and when you want more you buy a pack of minutes. Packs never expire,
          and there is no subscription.
        </p>
      </Section>

      <Section>
        <PackCards />
      </Section>

      <Section>
        <PaperCard tilt={-1} className="flex flex-col items-start gap-4">
          <Scrawl as="h2" className="text-3xl text-ink">
            Gifting a story
          </Scrawl>
          <p className="font-hand text-xl text-ink">
            Grandparents can buy minutes as a gift on the web and get a code with a printable card to
            hand over.
          </p>
          <StickerLink to="/gift" tone="yellow" tilt={-1}>
            Give a story
          </StickerLink>
        </PaperCard>
      </Section>

      <Section title="Quick questions">
        <div className="grid gap-4 sm:grid-cols-3">
          {MINI_FAQ.map((f, i) => (
            <PaperCard key={f.q} tilt={i === 1 ? 1 : -1} className="flex flex-col gap-2">
              <Scrawl as="h3" className="text-2xl text-ink">
                {f.q}
              </Scrawl>
              <p className="font-hand text-lg text-ink">{f.a}</p>
            </PaperCard>
          ))}
        </div>
        <div className="mt-6">
          <Link to="/faq" className="font-hand text-lg text-purple underline">
            More questions answered
          </Link>
        </div>
      </Section>
    </>
  )
}
