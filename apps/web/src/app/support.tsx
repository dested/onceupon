import { Link } from 'react-router-dom'
import { PaperCard, Scrawl } from '~/components/paper'
import { BRAND } from '../../../../packages/shared/src/brand'
import { Head } from './seo'
import { Section } from './site-parts'

const CHECKLIST = [
  'Check the iPad is online. Live drawing needs an internet connection.',
  'Check the microphone permission in iPad Settings, under Squiggletale.',
  'Check there are minutes left, under Grown-ups in the app.',
]

export function SupportPage() {
  return (
    <>
      <Head title="Support" />
      <Section title="We are here to help" headingClassName="text-4xl md:text-5xl text-ink">
        <div className="grid gap-6 md:grid-cols-2">
          <PaperCard tilt={-1} className="flex flex-col items-start gap-3">
            <Scrawl as="h2" className="text-3xl text-ink">
              Write to us
            </Scrawl>
            <p className="font-hand text-xl text-ink">
              A real person reads every message and we answer within a day.
            </p>
            <a
              href={`mailto:${BRAND.supportEmail}`}
              className="font-scrawl text-2xl text-purple underline">
              {BRAND.supportEmail}
            </a>
            <div className="mt-2 flex flex-wrap gap-4 font-hand text-lg text-purple">
              <Link to="/faq" className="underline">
                FAQ
              </Link>
              <Link to="/delete-my-data" className="underline">
                Delete my data
              </Link>
              <Link to="/privacy" className="underline">
                Privacy
              </Link>
            </div>
          </PaperCard>

          <PaperCard tilt={1} className="flex flex-col items-start gap-3">
            <Scrawl as="h2" className="text-3xl text-ink">
              App not drawing?
            </Scrawl>
            <ul className="flex flex-col gap-3">
              {CHECKLIST.map((c) => (
                <li key={c} className="font-hand text-lg text-ink">
                  • {c}
                </li>
              ))}
            </ul>
          </PaperCard>
        </div>
      </Section>
    </>
  )
}
