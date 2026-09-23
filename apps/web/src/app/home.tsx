import { BookOpen, Mic, Pencil, ShieldCheck } from 'lucide-react'
import { Link } from 'react-router-dom'
import { PaperCard, Scrawl, StickerLink } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { Head } from './seo'
import { PackCards, PhoneMockup, Section, SpeechBubble, StudioFrame } from './site-parts'

const STEPS = [
  { icon: Mic, title: 'Tell it out loud', tilt: -1.5 },
  { icon: Pencil, title: 'The crayon draws it live', tilt: 1 },
  { icon: BookOpen, title: 'Say The End, keep the book', tilt: -1 },
]

const SAFE = [
  'No accounts, ever. Nothing to sign up for',
  'Nothing is recorded on our servers. The voice is transcribed live and thrown away',
  'The crayon politely skips ideas that are not for a picture book',
  'A grown-up gate stands in front of anything you buy',
]

export function HomePage() {
  const hasStore = BRAND.appStoreUrl !== ''

  return (
    <>
      <Head title="Tell a story, watch it draw" />

      {/* Hero */}
      <section className="grid items-center gap-10 py-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Scrawl as="h1" className="text-ink text-[clamp(40px,6vw,72px)]">
            Tell a story, watch it draw
          </Scrawl>
          <p className="mt-5 font-hand text-2xl text-ink">
            The iPad listens while your child tells a story, and a crayon draws every word as they
            say it. Say “The End” and send the picture book to grandma.
          </p>
          <div className="mt-7 flex flex-wrap gap-4">
            <StickerLink
              to={hasStore ? BRAND.appStoreUrl : '/#get-the-app'}
              tone="yellow"
              tilt={-2}
              external={hasStore}>
              Get the app
            </StickerLink>
            <StickerLink to="/how-it-works" tone="paper" tilt={1}>
              See how it works
            </StickerLink>
          </div>
          <p className="mt-4 font-hand text-lg text-ink-soft">
            First story free. Then minute packs, no subscription.
          </p>
        </div>
        <div className="lg:col-span-7">
          <StudioFrame src="/app/?player=tutorial&embed=1" title="A story drawn by the crayon" />
        </div>
      </section>

      {/* How it works strip */}
      <Section title="How it works">
        <div className="grid gap-6 sm:grid-cols-3">
          {STEPS.map((s) => (
            <PaperCard key={s.title} tilt={s.tilt} className="flex flex-col items-start gap-4">
              <span className="grid h-16 w-16 place-items-center rounded-full border-[3px] border-ink bg-lilac">
                <s.icon size={30} className="text-ink" />
              </span>
              <Scrawl as="h3" className="text-2xl text-ink">
                {s.title}
              </Scrawl>
            </PaperCard>
          ))}
        </div>
      </Section>

      {/* Made with real words */}
      <Section title="Made with real words">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start">
          <SpeechBubble tilt={-2}>the dragon ate a giant ice cream</SpeechBubble>
          <SpeechBubble tilt={1}>a rocket flew to the moon and it was made of cheese</SpeechBubble>
          <SpeechBubble tilt={-1}>and then the bunny found a rainbow slide</SpeechBubble>
        </div>
        <p className="mt-5 font-hand text-xl text-ink-soft">Whatever they say, it appears</p>
      </Section>

      {/* Pricing teaser */}
      <Section title="Minutes, not subscriptions">
        <PackCards compact />
        <div className="mt-6">
          <StickerLink to="/pricing" tone="paper" tilt={-1}>
            See pricing
          </StickerLink>
        </div>
      </Section>

      {/* Grandma */}
      <Section title="Send it to grandma">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <p className="font-hand text-2xl text-ink">
              Every finished story gets a share link. Grandma opens it on any phone and watches the
              picture book draw itself again, told in your child’s own voice.
            </p>
            <ul className="mt-5 flex flex-col gap-2 font-hand text-xl text-ink">
              <li>• A link she can open anywhere, no app needed</li>
              <li>• The story replays in your child’s own voice</li>
              <li>• The link stays live for 90 days</li>
              <li>• Download it as a video to keep or post</li>
            </ul>
          </div>
          <PhoneMockup />
        </div>
      </Section>

      {/* Kids-safe */}
      <Section title="Built for small hands, watched over by grown-ups">
        <PaperCard tilt={-1} className="flex flex-col gap-4">
          <ul className="flex flex-col gap-3">
            {SAFE.map((line) => (
              <li key={line} className="flex items-start gap-3 font-hand text-xl text-ink">
                <ShieldCheck size={24} className="mt-1 shrink-0 text-crayon-green" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
          <Link to="/privacy" className="font-hand text-lg text-purple underline">
            Read the whole privacy story
          </Link>
        </PaperCard>
      </Section>

      {/* Get the app */}
      <Section title="Get the app">
        <div id="get-the-app" className="flex flex-col items-start gap-4">
          {hasStore ? (
            <StickerLink to={BRAND.appStoreUrl} tone="yellow" tilt={-2} external>
              Download on the App Store
            </StickerLink>
          ) : (
            <span
              className="inline-flex items-center rounded-2xl border-[3px] border-dashed border-ink/50 bg-paper px-5 py-2.5 font-hand text-xl text-ink-soft"
              style={{ transform: 'rotate(-2deg)' }}>
              Coming to the App Store
            </span>
          )}
          <p className="font-hand text-lg text-ink-soft">Works on iPad</p>
        </div>
      </Section>
    </>
  )
}
