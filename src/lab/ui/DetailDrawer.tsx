import { imageUrl } from '../api'
import type { CaseResult } from '../types'
import { PaperCard } from '~/ui/bits'
import {
  Chip,
  DrawStats,
  IssueRows,
  OpsView,
  OverallChip,
  PraiseList,
  Stars,
  SubscoreBars,
} from './common'
import { playgroundStore } from './playground-store'

/** Right-side scrollable detail for one drawn case; shared by Playground and Results. */
export function DetailDrawer({
  result,
  onClose,
}: {
  result: CaseResult | null
  onClose: () => void
}) {
  if (!result) return null
  const { draw, critique, critiqueError } = result
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button className="bg-ink/30 absolute inset-0" aria-label="close" onClick={onClose} />
      <div className="relative z-10 h-full w-[min(40rem,95vw)] overflow-y-auto p-3">
        <PaperCard className="min-h-full">
          <div className="mb-3 flex items-start justify-between gap-3">
            <h2 className="font-scrawl text-2xl">{draw.phrase}</h2>
            <div className="flex items-center gap-2">
              <button
                className="border-ink bg-paper rounded-full border-2 px-3 py-1 leading-none"
                onClick={() => {
                  playgroundStore.open(result)
                  onClose()
                }}>
                open in playground
              </button>
              <button
                className="border-ink bg-paper rounded-full border-2 px-3 py-1 leading-none"
                onClick={onClose}>
                close
              </button>
            </div>
          </div>

          <img
            src={imageUrl(draw.imagePath)}
            alt={draw.phrase}
            className="border-ink mb-3 aspect-[16/10] w-full rounded-xl border-[3px] object-cover"
          />

          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Chip tone="ink">{draw.caseId}</Chip>
            <Chip>sample {draw.sample}</Chip>
            <Chip>v{draw.promptVersion}</Chip>
            <Chip>{draw.model}</Chip>
          </div>

          {critique ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="font-scrawl text-4xl">{critique.overall}</span>
                  <span className="text-ink-soft text-sm">overall</span>
                </div>
                <Stars n={critique.recognizable} />
                <Chip
                  tone={
                    critique.blindMatch === 'yes'
                      ? 'green'
                      : critique.blindMatch === 'partial'
                        ? 'yellow'
                        : 'red'
                  }>
                  blind {critique.blindMatch}
                </Chip>
              </div>
              <p className="text-sm">
                <span className="text-ink-soft">blind guess:</span> “{critique.blindGuess}”
              </p>
              <p className="text-sm">
                <span className="text-ink-soft">judge saw:</span> {critique.seen}
              </p>
              <SubscoreBars subs={critique.subscores} />
              <div>
                <h3 className="font-scrawl mb-1 text-lg">issues</h3>
                <IssueRows issues={critique.issues} />
              </div>
              {critique.praise.length > 0 ? (
                <div>
                  <h3 className="font-scrawl mb-1 text-lg">praise</h3>
                  <PraiseList praise={critique.praise} />
                </div>
              ) : null}
            </div>
          ) : (
            <p className="text-crayon-red text-sm">
              {critiqueError ? `judge failed: ${critiqueError}` : 'not judged'}
            </p>
          )}

          <div className="mt-4">
            <h3 className="font-scrawl mb-1 text-lg">draw</h3>
            <DrawStats draw={draw} />
            <OpsView lines={draw.lines} className="mt-2 max-h-[22rem]" />
          </div>
        </PaperCard>
      </div>
    </div>
  )
}
