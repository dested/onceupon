import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PaperCard, Scrawl } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { Head } from './seo'
import { Section } from './site-parts'

const SECTIONS: { title: string; content: ReactNode }[] = [
  {
    title: 'What we collect',
    content: (
      <p>
        We keep as little as we can: an anonymous device id, the minutes balance for that device,
        and purchase receipts. When a parent shares a story, we store the masked words and the
        drawing commands of that story so the share page can replay it. We do not ask for a name,
        an email, or an account to use the app.
      </p>
    ),
  },
  {
    title: 'The microphone',
    content: (
      <p>
        While your child is telling a story, the audio streams to our transcription partner
        (Deepgram or OpenAI) to turn speech into words in real time. We do not store that audio, and
        we ask our partners for zero-data-retention handling. The child’s voice recording stays on
        the iPad and is never sent to us unless a parent turns on “share with voice” for a story.
      </p>
    ),
  },
  {
    title: 'Children’s privacy',
    content: (
      <p>
        {BRAND.name} is built for children and follows the spirit of COPPA. There are no accounts,
        no advertising, and no third-party analytics SDKs. A story is only shared, and voice is only
        included, when a parent chooses to; because sharing with voice is gated behind a purchase and
        the grown-up gate, that purchase acts as verifiable parental consent. A parent can delete
        everything at any time (see below).
      </p>
    ),
  },
  {
    title: 'Sharing',
    content: (
      <p>
        A share link is unlisted and stays live for 90 days, then it goes back on the shelf
        automatically. A parent can unpublish any shared story from the app at any time, which takes
        the link down straight away.
      </p>
    ),
  },
  {
    title: 'Apple attribution',
    content: (
      <p>
        If enabled, the app uses Apple’s own attribution token to learn which ad brought an install.
        This uses no personal data and no third-party tracking.
      </p>
    ),
  },
  {
    title: 'Deleting your data',
    content: (
      <p>
        You can delete every story on the iPad from My stories, and uninstalling removes everything
        stored on the device. To have us remove server-side records tied to your device, use the{' '}
        <Link to="/delete-my-data" className="text-purple underline">
          delete my data
        </Link>{' '}
        page.
      </p>
    ),
  },
  {
    title: 'Contact',
    content: (
      <p>
        Questions about privacy go to{' '}
        <a href={`mailto:${BRAND.supportEmail}`} className="text-purple underline">
          {BRAND.supportEmail}
        </a>
        .
      </p>
    ),
  },
]

export function PrivacyPage() {
  return (
    <>
      <Head title="Privacy" />
      <Section title="Privacy" headingClassName="text-4xl md:text-5xl text-ink">
        <p className="font-hand text-lg text-ink-soft">Last updated 2026-09-22</p>
        <div className="mt-6 flex flex-col gap-4">
          {SECTIONS.map((s, i) => (
            <PaperCard key={s.title} tilt={i % 2 === 0 ? -0.6 : 0.6}>
              <Scrawl as="h2" className="text-2xl text-ink">
                {s.title}
              </Scrawl>
              <div className="mt-2 font-hand text-lg text-ink">{s.content}</div>
            </PaperCard>
          ))}
        </div>
      </Section>
    </>
  )
}
