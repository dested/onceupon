import { useEffect, useRef, useState } from 'react'
import { StickerButton } from '~/ui/bits'
import { hashString } from '~/engine/rng'
import { imageUrl } from '../api'
import type { Campaign } from '../campaign'
import { renderOps } from '../render'
import { loadCaseResults, loadPromoted, loadPromptMetas } from '../store'
import type { CaseResult, DrawLine, LabCase, PromptMeta } from '../types'
import {
  Chip,
  DrawStats,
  IssueRows,
  OpsView,
  PraiseList,
  Stars,
  SubscoreBars,
  errText,
  useLoader,
} from './common'
import { DetailDrawer } from './DetailDrawer'
import { playgroundStore, usePendingPlayground } from './playground-store'
import { useToast } from './toast'

export function Playground({ campaign, bestVersion }: { campaign: Campaign; bestVersion: number }) {
  const toast = useToast()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [phrase, setPhrase] = useState('horse')
  const [version, setVersion] = useState<number | null>(null)
  const [lines, setLines] = useState<DrawLine[]>([])
  const [drawing, setDrawing] = useState(false)
  const [result, setResult] = useState<CaseResult | null>(null)
  const [detail, setDetail] = useState<CaseResult | null>(null)
  // Per-line toggles for dissecting a finished picture; parse-error lines are locked off.
  const [enabled, setEnabled] = useState<boolean[]>([])
  const [prevEnabled, setPrevEnabled] = useState<boolean[] | null>(null)
  const [soloed, setSoloed] = useState<number | null>(null)
  // The phrase whose seed reproduces the current lines (frozen at draw/load time, not the input box).
  const [renderPhrase, setRenderPhrase] = useState('')
  // Critique-it-yourself: notes about the current picture, and the version the editor saved from them.
  const [note, setNote] = useState('')
  const [improving, setImproving] = useState(false)
  const [improvedVersion, setImprovedVersion] = useState<number | null>(null)

  const pending = usePendingPlayground()

  const metas = useLoader<PromptMeta[]>(
    () => loadPromptMetas(),
    [],
    (e) => toast.push(e)
  )
  const promoted = useLoader(
    () => loadPromoted(),
    [],
    (e) => toast.push(e)
  )
  const plays = useLoader<CaseResult[]>(
    () => loadCaseResults('play'),
    [],
    (e) => toast.push(e)
  )

  useEffect(() => {
    if (version !== null || !metas.data || metas.data.length === 0) return
    const promotedV = promoted.data?.version
    const highest = metas.data[metas.data.length - 1]?.version ?? 0
    setVersion(promotedV ?? bestVersion ?? highest)
  }, [metas.data, promoted.data, bestVersion, version])

  // A result handed over from a thumbnail or the detail drawer: load it for dissection.
  useEffect(() => {
    if (!pending || drawing) return
    loadForDissect(pending)
    playgroundStore.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, drawing])

  // When the set of lines changes (a finished draw or a loaded result), reset the toggles.
  useEffect(() => {
    if (drawing) return
    setEnabled(lines.map((l) => l.ok))
    setPrevEnabled(null)
    setSoloed(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, drawing])

  // Re-render the picture without the model whenever the toggles change (debounced).
  useEffect(() => {
    if (drawing || lines.length === 0 || enabled.length === 0) return
    const canvas = canvasRef.current
    if (!canvas) return
    const seed = hashString(renderPhrase.trim() || phrase.trim())
    const on = lines.filter((l, i) => l.ok && enabled[i]).map((l) => l.line)
    const t = window.setTimeout(() => {
      try {
        renderOps(canvas, on, seed)
      } catch (e) {
        toast.push(errText(e))
      }
    }, 50)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, lines, drawing, renderPhrase])

  const recentPlays = (plays.data ?? [])
    .slice()
    .sort((a, b) => b.draw.drawnAt.localeCompare(a.draw.drawnAt))
    .slice(0, 8)

  function loadForDissect(r: CaseResult): void {
    setPhrase(r.draw.phrase)
    setRenderPhrase(r.draw.phrase)
    setVersion(r.draw.promptVersion)
    setResult(r)
    setLines(r.draw.lines)
    setDetail(null)
  }

  async function draw(useVersion?: number) {
    const canvas = canvasRef.current
    const v = useVersion ?? version
    if (!canvas || v === null || drawing || phrase.trim().length === 0) return
    setDrawing(true)
    setLines([])
    setResult(null)
    setEnabled([])
    setImprovedVersion(null)
    if (useVersion !== undefined) setVersion(useVersion)
    try {
      const r = await campaign.runOne(
        phrase.trim(),
        v,
        'live',
        canvas,
        (l) => setLines((prev) => [...prev, l]),
        () => {}
      )
      setResult(r)
      setRenderPhrase(r.draw.phrase)
      plays.refresh()
      if (r.critiqueError) toast.push(`judge failed: ${r.critiqueError}`)
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setDrawing(false)
    }
  }

  async function improve() {
    if (!result || improving || note.trim().length === 0) return
    setImproving(true)
    try {
      const phraseForCase = result.draw.phrase
      const c: LabCase = {
        id: slug(phraseForCase),
        phrase: phraseForCase,
        tier: 'subject',
        category: 'play',
        expect: [],
      }
      const meta = await campaign.improveFromNote({
        result,
        c,
        note: note.trim(),
        version: result.draw.promptVersion,
      })
      metas.refresh()
      setVersion(meta.version)
      setImprovedVersion(meta.version)
      toast.push(`v${meta.version} saved: ${meta.note}`)
    } catch (e) {
      toast.push(errText(e))
    } finally {
      setImproving(false)
    }
  }

  function toggleLine(i: number): void {
    setSoloed(null)
    setPrevEnabled(null)
    setEnabled((prev) => prev.map((v, j) => (j === i ? !v : v)))
  }

  function allOn(): void {
    setSoloed(null)
    setPrevEnabled(null)
    setEnabled(lines.map((l) => l.ok))
  }

  function allOff(): void {
    setSoloed(null)
    setPrevEnabled(null)
    setEnabled(lines.map(() => false))
  }

  function solo(i: number): void {
    if (soloed === i) {
      setEnabled(prevEnabled ?? lines.map((l) => l.ok))
      setPrevEnabled(null)
      setSoloed(null)
      return
    }
    // Remember the pre-solo set the first time we enter solo, so the second click can restore it.
    setPrevEnabled(soloed === null ? enabled : prevEnabled)
    setEnabled(lines.map((l, j) => l.ok && j === i))
    setSoloed(i)
  }

  const critique = result?.critique ?? null
  const showToggles = !drawing && lines.length > 0

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_28rem]">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft text-sm">phrase</span>
            <input
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void draw()
              }}
              className="border-ink bg-paper w-64 rounded-xl border-[3px] px-3 py-2 text-xl"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-ink-soft text-sm">prompt version</span>
            <select
              value={version ?? ''}
              onChange={(e) => setVersion(Number(e.target.value))}
              className="border-ink bg-paper rounded-xl border-[3px] px-3 py-2 text-lg">
              {(metas.data ?? []).map((m) => (
                <option key={m.version} value={m.version}>
                  {versionLabel(m, bestVersion, promoted.data?.version ?? null)}
                </option>
              ))}
            </select>
          </label>
          <StickerButton
            tone="green"
            onClick={() => void draw()}
            disabled={drawing || version === null}>
            {drawing ? 'drawing…' : result ? 'draw again' : 'draw'}
          </StickerButton>
        </div>

        <div className="border-ink bg-paper relative aspect-[16/10] w-full overflow-hidden rounded-2xl border-[3px] shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
          {!drawing && !result ? (
            <div className="text-ink-soft absolute inset-0 grid place-items-center text-lg">
              type a word and draw
            </div>
          ) : null}
        </div>

        {recentPlays.length > 0 ? (
          <div>
            <div className="text-ink-soft mb-1 text-sm">recent playground draws</div>
            <div className="flex gap-3 overflow-x-auto pb-1">
              {recentPlays.map((p, i) => (
                <div
                  key={`${p.draw.imagePath}-${i}`}
                  className="flex shrink-0 flex-col items-center gap-1">
                  <button
                    onClick={() => setDetail(p)}
                    className="border-ink overflow-hidden rounded-xl border-2"
                    style={{ transform: `rotate(${i % 2 === 0 ? -2.5 : 2.5}deg)` }}
                    title={p.draw.phrase}>
                    <img
                      src={imageUrl(p.draw.imagePath)}
                      alt={p.draw.phrase}
                      className="h-20 w-32 object-cover"
                    />
                  </button>
                  <button
                    onClick={() => playgroundStore.open(p)}
                    className="border-ink bg-paper rounded-full border-2 px-2 py-0.5 text-xs leading-none">
                    open in playground
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-3">
        {showToggles ? (
          <OpsToggleList
            lines={lines}
            enabled={enabled}
            soloed={soloed}
            onToggle={toggleLine}
            onSolo={solo}
            onAllOn={allOn}
            onAllOff={allOff}
          />
        ) : (
          <OpsView lines={lines} className="min-h-[16rem] flex-1" />
        )}

        {result ? (
          <>
            <DrawStats draw={result.draw} />
            {critique ? (
              <div className="border-ink bg-paper flex flex-col gap-3 rounded-2xl border-[3px] p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
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
                {result.critiqueError ? `judge failed: ${result.critiqueError}` : 'not judged'}
              </p>
            )}

            <div className="border-ink bg-paper flex flex-col gap-2 rounded-2xl border-[3px] p-4 shadow-[3px_4px_0_0_rgba(59,47,47,0.25)]">
              <h3 className="font-scrawl text-lg">your notes</h3>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="what's wrong with this picture?"
                className="border-ink bg-paper min-h-[4.5rem] rounded-xl border-2 px-3 py-2 text-base"
              />
              <div className="flex flex-wrap items-center gap-2">
                <StickerButton
                  tone="blue"
                  onClick={() => void improve()}
                  disabled={improving || note.trim().length === 0}>
                  {improving ? 'improving…' : 'improve prompt from this'}
                </StickerButton>
                {improvedVersion !== null ? (
                  <StickerButton
                    tone="green"
                    onClick={() => void draw(improvedVersion)}
                    disabled={drawing}>
                    draw again with v{improvedVersion}
                  </StickerButton>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>

      <DetailDrawer result={detail} onClose={() => setDetail(null)} />
    </div>
  )
}

/** The dark ops surface, but each line is a checkbox + solo so a finished picture can be dissected. */
function OpsToggleList({
  lines,
  enabled,
  soloed,
  onToggle,
  onSolo,
  onAllOn,
  onAllOff,
}: {
  lines: DrawLine[]
  enabled: boolean[]
  soloed: number | null
  onToggle: (i: number) => void
  onSolo: (i: number) => void
  onAllOn: () => void
  onAllOff: () => void
}) {
  return (
    <div className="bg-ink/90 text-paper flex min-h-[16rem] flex-1 flex-col rounded-xl p-3 font-mono text-[11px] leading-relaxed">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={onAllOn}
          className="border-paper/40 hover:bg-paper/10 rounded-full border px-2 py-0.5 leading-none">
          all on
        </button>
        <button
          onClick={onAllOff}
          className="border-paper/40 hover:bg-paper/10 rounded-full border px-2 py-0.5 leading-none">
          all off
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {lines.map((l, i) => (
          <div key={i} className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={l.ok && (enabled[i] ?? false)}
              disabled={!l.ok}
              onChange={() => onToggle(i)}
              className="accent-crayon-yellow h-3 w-3 shrink-0 disabled:opacity-40"
              title={l.ok ? 'toggle this line' : 'parse error: cannot draw'}
            />
            <button
              onClick={() => onSolo(i)}
              disabled={!l.ok}
              className={`shrink-0 rounded border px-1 leading-none disabled:opacity-30 ${
                soloed === i
                  ? 'bg-crayon-yellow text-ink border-crayon-yellow'
                  : 'border-paper/40 hover:bg-paper/10'
              }`}
              title="draw only this line">
              solo
            </button>
            <span
              className={`whitespace-pre-wrap ${l.ok ? '' : 'text-crayon-red'}`}
              title={l.error ?? undefined}>
              {l.line || ' '}
              {l.error ? `   <- ${l.error}` : ''}
            </span>
          </div>
        ))}
      </div>
      <p className="text-paper/60 mt-2 leading-snug">
        toggle lines to see which op draws what; the picture re-renders without the model
      </p>
    </div>
  )
}

/** Same slug rule campaign.runOne uses, so the ad-hoc LabCase id matches its saved play. */
function slug(phrase: string): string {
  const out = phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'thing'
}

function versionLabel(m: PromptMeta, bestVersion: number, promotedVersion: number | null): string {
  const tag = `v${String(m.version).padStart(3, '0')}`
  const marks = [
    m.version === bestVersion ? 'best' : null,
    m.version === promotedVersion ? 'promoted' : null,
  ].filter((x): x is string => x !== null)
  const suffix = marks.length > 0 ? ` (${marks.join(', ')})` : ''
  return m.note ? `${tag} · ${m.note}${suffix}` : `${tag}${suffix}`
}
