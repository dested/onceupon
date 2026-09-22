import { useEffect, useState } from 'react'
import { Campaign } from './campaign'
import { saveCampaign } from './store'
import { CampaignTab } from './ui/Campaign'
import { Cases } from './ui/Cases'
import { errText, useCampaignTick } from './ui/common'
import { Playground } from './ui/Playground'
import { usePendingPlayground } from './ui/playground-store'
import { Prompts } from './ui/Prompts'
import { Results } from './ui/Results'
import { ToastProvider, useToast } from './ui/toast'

const TABS = ['playground', 'campaign', 'results', 'prompts', 'cases'] as const
type Tab = (typeof TABS)[number]

export function LabApp() {
  return (
    <ToastProvider>
      <LabLoader />
    </ToastProvider>
  )
}

function LabLoader() {
  const toast = useToast()
  const [campaign, setCampaign] = useState<Campaign | null>(null)

  useEffect(() => {
    let live = true
    Campaign.load()
      .then((c) => {
        if (live) setCampaign(c)
      })
      .catch((e: unknown) => toast.push(errText(e)))
    return () => {
      live = false
    }
  }, [toast])

  if (!campaign) {
    return (
      <div className="text-ink-soft bg-paper grid h-screen place-items-center text-xl">
        loading the lab…
      </div>
    )
  }
  return <LabBody campaign={campaign} setCampaign={setCampaign} />
}

function LabBody({
  campaign,
  setCampaign,
}: {
  campaign: Campaign
  setCampaign: (c: Campaign) => void
}) {
  const [tab, setTab] = useState<Tab>('playground')
  useCampaignTick(campaign)

  // A result sent to the Playground (from the Results detail drawer) pulls that tab forward.
  const pending = usePendingPlayground()
  useEffect(() => {
    if (pending) setTab('playground')
  }, [pending])

  async function setBest(version: number): Promise<void> {
    const next = { ...campaign.state, bestVersion: version, updatedAt: new Date().toISOString() }
    await saveCampaign(next)
    const reloaded = await Campaign.load()
    setCampaign(reloaded)
  }

  return (
    <div className="text-ink bg-paper font-hand h-screen overflow-y-auto">
      <header className="border-ink bg-paper sticky top-0 z-30 flex flex-wrap items-center gap-3 border-b-[3px] px-4 py-2">
        <h1 className="font-scrawl text-2xl">Once Upon lab</h1>
        <nav className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`border-ink rounded-2xl border-[3px] px-3 py-1 text-lg capitalize shadow-[2px_3px_0_0_rgba(59,47,47,0.25)] transition ${
                tab === t ? 'bg-crayon-yellow' : 'bg-paper'
              }`}
              style={{ transform: `rotate(${tab === t ? 0 : -1.5}deg)` }}>
              {t}
            </button>
          ))}
        </nav>
      </header>

      <main className="p-4">
        {tab === 'playground' ? (
          <Playground campaign={campaign} bestVersion={campaign.state.bestVersion} />
        ) : null}
        {tab === 'campaign' ? <CampaignTab campaign={campaign} /> : null}
        {tab === 'results' ? <Results defaultRoundId={campaign.state.bestRoundId} /> : null}
        {tab === 'prompts' ? <Prompts campaign={campaign} onSetBest={setBest} /> : null}
        {tab === 'cases' ? <Cases /> : null}
      </main>
    </div>
  )
}
