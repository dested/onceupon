import { BRAND } from '../../../../packages/shared/src/brand'
import { Head } from './seo'
import { Section } from './site-parts'

const FAQ: { q: string; a: string }[] = [
  {
    q: `What is ${BRAND.name}?`,
    a: 'An iPad app where your child tells a story out loud and a crayon draws it on the screen as they talk. When they say “The End”, the story is saved as a little picture book you can replay, download or share.',
  },
  {
    q: 'What ages is it for?',
    a: 'It is built for children roughly 3 to 7, told and used alongside a grown-up. There is no reading required; talking is the whole game.',
  },
  {
    q: 'Is it safe for my child?',
    a: 'Yes. There are no accounts and no ads, and no third-party analytics. The drawing model politely skips ideas that are not for a picture book, spoken words are masked before anything is ever shared, and a grown-up gate stands in front of any purchase.',
  },
  {
    q: 'What does it cost?',
    a: 'The first story is free, then 60 free seconds a week. When you want more you buy a pack of minutes: 40 minutes for $9.99, 120 for $19.99, or 400 for $39.99. There is no subscription.',
  },
  {
    q: 'Do the minutes expire?',
    a: 'No. Minutes you buy are yours until they are used, and they carry across to a new iPad through Restore Purchases.',
  },
  {
    q: 'What counts as a minute?',
    a: 'Only the time the microphone is open and the crayon is drawing. Thinking, pausing, and flipping back through pages do not use minutes.',
  },
  {
    q: 'Can I get a refund?',
    a: `Purchases made in the app go through Apple, so refunds are handled by Apple. For a pack bought on the web, write to ${BRAND.supportEmail} within 14 days if the minutes are unused and we will refund it.`,
  },
  {
    q: 'Can I gift it to a grandchild?',
    a: 'Yes. On the web you can buy a pack of minutes as a gift, get a code and a printable card, and the parent redeems it in the app or at the redeem page.',
  },
  {
    q: 'Does it work on road trips or offline?',
    a: 'Saved stories and their replays work offline, so the car is covered once a story exists. Live drawing needs an internet connection because the listening and the crayon run online.',
  },
  {
    q: 'What happens to my child’s voice?',
    a: 'The audio streams to our transcription partner to turn speech into words in real time, and is not stored by us. The voice recording stays on the iPad unless a parent chooses to share a story with voice.',
  },
]

export function FaqPage() {
  return (
    <>
      <Head title="Questions and answers" />
      <Section title="Questions and answers" headingClassName="text-4xl md:text-5xl text-ink">
        <div className="flex flex-col gap-3">
          {FAQ.map((f) => (
            <details
              key={f.q}
              className="group rounded-3xl border-[3px] border-ink bg-paper p-5 shadow-[4px_5px_0_0_rgba(59,47,47,0.22)]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-hand text-2xl text-ink">
                {f.q}
                <span className="font-scrawl text-2xl text-purple transition group-open:rotate-90">
                  ›
                </span>
              </summary>
              <p className="mt-3 font-hand text-lg text-ink">{f.a}</p>
            </details>
          ))}
        </div>
      </Section>
    </>
  )
}
