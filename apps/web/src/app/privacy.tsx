import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PaperCard, Scrawl } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { Head } from './seo'
import { Section } from './site-parts'

const UPDATED = '2026-11-04'

const mail = (
  <a href={`mailto:${BRAND.supportEmail}`} className="text-purple underline">
    {BRAND.supportEmail}
  </a>
)

const SECTIONS: { title: string; content: ReactNode }[] = [
  {
    title: 'Who we are',
    content: (
      <>
        <p>
          {BRAND.name} is made by {[BRAND.legalName, BRAND.postalAddress, BRAND.phone].filter(Boolean).join(', ')},{' '}
          {mail}.
          This policy covers the {BRAND.name} app for iPhone and iPad and this website.
        </p>
        <p className="mt-2">
          {BRAND.name} is made for children. A grown-up sets it up, answers the grown-up question
          in front of anything that leaves the story, and decides whether a story is shared.
        </p>
      </>
    ),
  },
  {
    title: 'Speech stays on the device',
    content: (
      <p>
        When your child tells a story, the iPhone or iPad turns speech into words on the device,
        using Apple's own speech recognition. The audio is not sent to us or to anyone else. The
        app keeps the recording with the story on the device so it can play it back, and it leaves
        the device only if a grown-up shares that story with voice.
      </p>
    ),
  },
  {
    title: 'Drawing with AI',
    content: (
      <>
        <p>
          Before the first story, a grown-up is asked whether {BRAND.name} may draw with AI. With
          that yes, the words of the story, as text, go through our server to Anthropic's Claude,
          which chooses what to draw. No audio, name, account, device identifier or location is sent
          with them.
        </p>
        <p className="mt-2">
          Anthropic does not use these words to train its models and deletes them within 30 days.
          We do not keep the story's words on our server, except words the crayon refused to draw,
          which we keep masked for 30 days to improve the safety filter.
        </p>
        <p className="mt-2">
          A grown-up can turn this off at any time in the app, under Grown-ups, "Drawing with AI".
          Drawing stops until it is turned back on.
        </p>
      </>
    ),
  },
  {
    title: 'What we keep',
    content: (
      <ul className="list-disc pl-6">
        <li>
          A random device id the app creates, the device's minutes balance and its history of
          minutes used and bought. Kept while the device is in use; deleted after 18 months without
          use if nothing is left on the balance.
        </li>
        <li>
          Records of each drawing request: time, length and cost, without the words. Kept 180 days.
        </li>
        <li>Purchase records from Apple or from our website, kept for accounting.</li>
        <li>Shared stories, while they are shared (see below).</li>
        <li>Backups of all of the above, kept 30 days.</li>
      </ul>
    ),
  },
  {
    title: 'Children’s privacy',
    content: (
      <>
        <p>
          There are no accounts, no advertising and no third-party analytics in the app. We don't
          ask a child for a name, email, photo or location, and nothing in the app needs one.
        </p>
        <p className="mt-2">
          Parents can ask us to show them, or delete, anything we hold for their device, and can
          withdraw the permission to draw with AI at any time. Write to {mail} or use the{' '}
          <Link to="/delete-my-data" className="text-purple underline">
            delete my data
          </Link>{' '}
          page; we answer within 7 days.
        </p>
      </>
    ),
  },
  {
    title: 'Sharing a story',
    content: (
      <p>
        A grown-up can make an unlisted link to a story. It carries the story's drawing and words
        (with rude words masked) and, only if the grown-up chooses, the recording of the child
        telling it. A link stays up for 90 days and then comes down by itself; a grown-up can take
        it down sooner from the app, and it is deleted within a day.
      </p>
    ),
  },
  {
    title: 'Payments',
    content: (
      <p>
        Minutes bought in the app are sold by Apple; we receive a receipt, not your card or Apple
        Account details. Gift codes and packs bought on this website are processed by Stripe; we
        receive the buyer's email address to send the code.
      </p>
    ),
  },
  {
    title: 'Who helps us run it',
    content: (
      <ul className="list-disc pl-6">
        <li>Anthropic: draws the pictures from the story's words (see Drawing with AI).</li>
        <li>Amazon Web Services: hosts our server, database and backups in the United States.</li>
        <li>Apple: in-app purchases and on-device speech recognition.</li>
        <li>Stripe: purchases on this website.</li>
      </ul>
    ),
  },
  {
    title: 'Deleting your data',
    content: (
      <p>
        Delete any story from My stories in the app; deleting the app removes everything stored on
        the device. To have us delete what our server holds for your device, use the{' '}
        <Link to="/delete-my-data" className="text-purple underline">
          delete my data
        </Link>{' '}
        page or write to {mail}.
      </p>
    ),
  },
  {
    title: 'Changes',
    content: (
      <p>
        If this policy changes in a way that matters, the date below changes, and the app asks a
        grown-up again before it sends anything new.
      </p>
    ),
  },
]

export function PrivacyPage() {
  return (
    <>
      <Head title="Privacy" />
      <Section title="Privacy" headingClassName="text-4xl md:text-5xl text-ink">
        <p className="font-hand text-lg text-ink-soft">Last updated {UPDATED}</p>
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
