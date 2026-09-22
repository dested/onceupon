/**
 * The hill-climb loop. A campaign runs a baseline round on the best prompt, then repeatedly asks the
 * editor for a patch, runs a round on the patched prompt, and keeps it only when mean overall rose
 * enough without blowing the output-token or blind-recognition guards. State lives on disk (lab/) so
 * a run resumes case by case; the class is the store the page subscribes to.
 */
import { roundId, caseFileBase } from './types'
import type {
  CampaignConfig,
  CampaignState,
  CaseResult,
  Critique,
  DrawResult,
  HistoryRow,
  Issue,
  LabCase,
  PatchAttempt,
  PromptMeta,
  RoundSummary,
} from './types'
import { DEFAULT_CAMPAIGN_CONFIG } from './types'
import { drawPhrase, type DrawOutcome } from './draw'
import { blindGuess, judgeCase } from './judge'
import { proposePatch } from './editor'
import { applyPatch, countPromptTokens, validatePrompt } from './prompt-tools'
import {
  appendHistory,
  loadCampaign,
  loadCases,
  loadCaseResults,
  loadPromptMetas,
  loadPromptText,
  loadRounds,
  saveCampaign,
  saveCaseResult,
  savePrompt,
  saveRound,
  updatePromptMeta,
} from './store'

export interface CampaignProgress {
  roundId: string | null
  done: number
  planned: number
  active: string[]
  lastError: string | null
}

const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

function slug(phrase: string): string {
  const out = phrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return out || 'thing'
}

function freshState(): CampaignState {
  return {
    status: 'idle',
    config: DEFAULT_CAMPAIGN_CONFIG,
    bestVersion: 0,
    bestRoundId: null,
    baselinePromptTokens: null,
    baselineOutputTokens: null,
    currentRoundId: null,
    spentUsd: 0,
    log: [],
    updatedAt: new Date().toISOString(),
  }
}

function newRound(id: string, n: number, version: number, planned: number): RoundSummary {
  return {
    id,
    n,
    promptVersion: version,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    planned,
    done: 0,
    meanOverall: null,
    meanRecognizable: null,
    blindYesRate: null,
    majorIssues: 0,
    meanOutputTokens: null,
    meanFirstTokenMs: null,
    meanDoneMs: null,
    drawCostUsd: 0,
    judgeCostUsd: 0,
    byCategory: {},
    byKind: {},
    kept: null,
    verdict: '',
  }
}

const mean = (xs: number[]): number | null =>
  xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length

export class Campaign {
  private _state: CampaignState
  private _progress: CampaignProgress
  private listeners = new Set<() => void>()
  private abort: AbortController | null = null
  private saveChain: Promise<void> = Promise.resolve()

  private constructor(state: CampaignState) {
    this._state = state
    this._progress = {
      roundId: state.currentRoundId,
      done: 0,
      planned: 0,
      active: [],
      lastError: null,
    }
  }

  static async load(): Promise<Campaign> {
    const saved = await loadCampaign()
    // A persisted "running" means the page went away mid-campaign; nothing is live until start().
    if (saved && saved.status === 'running') return new Campaign({ ...saved, status: 'paused' })
    return new Campaign(saved ?? freshState())
  }

  get state(): CampaignState {
    return this._state
  }

  get progress(): CampaignProgress {
    return this._progress
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }

  private setState(patch: Partial<CampaignState>): void {
    this._state = { ...this._state, ...patch, updatedAt: new Date().toISOString() }
    const snapshot = this._state
    this.saveChain = this.saveChain.then(() => saveCampaign(snapshot)).catch(() => {})
    this.emit()
  }

  private setProgress(patch: Partial<CampaignProgress>): void {
    this._progress = { ...this._progress, ...patch }
    this.emit()
  }

  private log(message: string): void {
    const stamp = new Date().toTimeString().slice(0, 8)
    const log = [...this._state.log, `${stamp} ${message}`].slice(-200)
    this.setState({ log })
  }

  private running(): boolean {
    return this._state.status === 'running'
  }

  setConfig(c: CampaignConfig): void {
    if (this.running()) throw new Error('cannot change config while the campaign is running')
    this.setState({ config: c })
  }

  async start(): Promise<void> {
    if (this.running()) return
    this.abort = new AbortController()
    this.setState({ status: 'running' })
    this.setProgress({ lastError: null })
    try {
      await this.runCampaign()
    } catch (e) {
      this.log(`error: ${msgOf(e)}`)
      this.setProgress({ lastError: msgOf(e) })
      this.setState({ status: 'stopped' })
    }
  }

  pause(): void {
    if (!this.running()) return
    this.setState({ status: 'paused' })
    this.log('paused')
  }

  async resume(): Promise<void> {
    if (this.running()) return
    await this.start()
  }

  stop(): void {
    this.abort?.abort()
    this.setState({ status: 'stopped' })
    this.log('stopped')
  }

  // --- the loop ---

  private async runCampaign(): Promise<void> {
    await this.resumeCurrentRound()
    if (!this.running()) return

    let rounds = await loadRounds()
    if (rounds.length === 0) {
      await this.ensureBaselineTokens()
      if (!this.running()) return
      const rid = roundId(0)
      await this.runRound(this._state.bestVersion, 0, rid)
      if (!this.running()) return
      const baseline = (await loadRounds()).find((r) => r.id === rid)
      if (baseline) await this.finalizeBaseline(baseline)
    }

    rounds = await loadRounds()
    while (this.running() && rounds.length - 1 < this._state.config.maxRounds) {
      const cont = await this.runImprovementRound()
      if (!cont) break
      rounds = await loadRounds()
    }

    if (this.running()) {
      this.setState({ status: 'done' })
      this.log('campaign done')
    }
  }

  private async resumeCurrentRound(): Promise<void> {
    const rid = this._state.currentRoundId
    if (!rid) return
    const round = (await loadRounds()).find((r) => r.id === rid)
    if (!round) {
      this.setState({ currentRoundId: null })
      return
    }
    this.log(`resuming ${rid}`)
    await this.runRound(round.promptVersion, round.n, rid)
    if (!this.running()) return
    const finished = (await loadRounds()).find((r) => r.id === rid)
    if (!finished) return
    if (round.n === 0) {
      await this.finalizeBaseline(finished)
    } else {
      const bestId = this._state.bestRoundId
      const bestRound = bestId ? (await loadRounds()).find((r) => r.id === bestId) : undefined
      if (bestRound) await this.decideKeep(finished, bestRound, finished.promptVersion)
      this.setState({ currentRoundId: null })
    }
  }

  private async ensureBaselineTokens(): Promise<void> {
    if (this._state.baselinePromptTokens !== null) return
    const version = this._state.bestVersion
    const text = await loadPromptText(version)
    const tokens = await countPromptTokens(text, this._state.config.drawModel)
    this.setState({ baselinePromptTokens: tokens })
    const meta = (await loadPromptMetas()).find((m) => m.version === version)
    if (meta && meta.tokens === null) await updatePromptMeta({ ...meta, tokens })
    this.log(`baseline prompt is ${tokens} tokens`)
  }

  private async finalizeBaseline(round: RoundSummary): Promise<void> {
    round.kept = true
    round.verdict = 'baseline'
    await saveRound(round)
    this.setState({
      baselineOutputTokens: round.meanOutputTokens,
      bestRoundId: round.id,
      currentRoundId: null,
    })
    this.log(
      `baseline ${round.id}: overall ${round.meanOverall === null ? '?' : round.meanOverall.toFixed(1)}`
    )
  }

  private async runImprovementRound(): Promise<boolean> {
    const cfg = this._state.config
    const best = this._state.bestVersion
    const bestRoundId = this._state.bestRoundId
    if (!bestRoundId) {
      this.log('no best round to learn from, stopping')
      this.setState({ status: 'stopped' })
      return false
    }
    const bestRound = (await loadRounds()).find((r) => r.id === bestRoundId)
    if (!bestRound) {
      this.log('best round missing, stopping')
      this.setState({ status: 'stopped' })
      return false
    }

    const bestText = await loadPromptText(best)
    const seedText = await loadPromptText(0)
    const bestResults = await loadCaseResults(bestRoundId)
    const allCases = await loadCases()
    const attempts = await this.buildAttempts()
    const baseTokens =
      this._state.baselinePromptTokens ?? (await countPromptTokens(bestText, cfg.drawModel))
    const tokensMax = Math.round(baseTokens * cfg.maxPromptGrowth)

    const proposal = await this.proposeValidPatch(
      {
        prompt: bestText,
        promptVersion: best,
        round: bestRound,
        results: bestResults,
        cases: allCases,
        attempts,
        tokensNow: baseTokens,
        tokensMax,
        model: cfg.editorModel,
      },
      seedText,
      baseTokens
    )
    if (!proposal) {
      this.setState({ status: 'stopped' })
      return false
    }
    this.setState({ spentUsd: this._state.spentUsd + (proposal.cost ?? 0) })
    if (!this.running()) return false

    const tokens = await countPromptTokens(proposal.text, cfg.drawModel)
    const meta = await savePrompt(proposal.text, {
      parent: best,
      note: proposal.patch.note,
      rationale: proposal.patch.rationale,
      tokens,
      source: 'editor',
    })
    this.log(`v${meta.version}: ${proposal.patch.note}`)

    const n = (await loadRounds()).length
    const rid = roundId(n)
    await this.runRound(meta.version, n, rid)
    if (!this.running()) return false

    const finished = (await loadRounds()).find((r) => r.id === rid)
    if (!finished) return false
    await this.decideKeep(finished, bestRound, meta.version)
    this.setState({ currentRoundId: null })
    return true
  }

  private async proposeValidPatch(
    input: Parameters<typeof proposePatch>[0],
    seedText: string,
    baseTokens: number
  ): Promise<{ text: string; patch: import('./types').PromptPatch; cost: number | null } | null> {
    const cfg = this._state.config
    let failure = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const { patch, costUsd } = await proposePatch(
        failure ? { ...input, previousFailure: failure } : input
      )
      const applied = applyPatch(input.prompt, patch)
      if (!applied.ok) {
        failure = applied.error
        this.log(`patch would not apply: ${applied.error}`)
        continue
      }
      const validity = validatePrompt(applied.text, seedText)
      if (!validity.ok) {
        failure = validity.errors.join('; ')
        this.log(`patch invalid: ${failure}`)
        continue
      }
      const tokens = await countPromptTokens(applied.text, cfg.drawModel)
      const cap = baseTokens * cfg.maxPromptGrowth
      if (tokens > cap) {
        failure = `the patched prompt is ${tokens} tokens, over the ${Math.round(cap)} token budget`
        this.log(`patch too big: ${tokens} > ${Math.round(cap)} tokens`)
        continue
      }
      return { text: applied.text, patch, cost: costUsd }
    }
    this.log('editor failed twice, stopping')
    return null
  }

  private async decideKeep(
    round: RoundSummary,
    bestRound: RoundSummary,
    version: number
  ): Promise<void> {
    const cfg = this._state.config
    const newOverall = round.meanOverall ?? 0
    const bestOverall = bestRound.meanOverall ?? 0
    const delta = newOverall - bestOverall
    const newOut = round.meanOutputTokens ?? 0
    const baseOut = this._state.baselineOutputTokens ?? newOut
    const newBlind = round.blindYesRate ?? 0
    const bestBlind = bestRound.blindYesRate ?? 0

    const scoreOk = delta >= cfg.keepMinDelta
    const tokenOk = baseOut === 0 || newOut <= baseOut * cfg.maxOutputGrowth
    const blindOk = newBlind >= bestBlind - 0.05

    let kept = false
    let verdict: string
    if (scoreOk && tokenOk && blindOk) {
      kept = true
      verdict = `kept: +${delta.toFixed(1)} overall (${bestOverall.toFixed(1)} → ${newOverall.toFixed(1)})`
    } else if (!scoreOk) {
      verdict = `reverted: ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} overall`
    } else if (!tokenOk) {
      const growth = baseOut === 0 ? 0 : Math.round((newOut / baseOut - 1) * 100)
      verdict = `reverted: output tokens +${growth}% over cap`
    } else {
      verdict = `reverted: blind-yes fell ${Math.round(bestBlind * 100)}% → ${Math.round(newBlind * 100)}%`
    }

    round.kept = kept
    round.verdict = verdict
    await saveRound(round)
    if (kept) this.setState({ bestVersion: version, bestRoundId: round.id })
    this.log(`${round.id} ${verdict}`)
  }

  private async buildAttempts(): Promise<PatchAttempt[]> {
    const metas = (await loadPromptMetas()).filter((m) => m.source === 'editor')
    const rounds = await loadRounds()
    const out: PatchAttempt[] = []
    for (const meta of metas) {
      const round = rounds.find((r) => r.promptVersion === meta.version)
      if (!round) continue
      const parentRound = rounds.find((r) => r.promptVersion === (meta.parent ?? -1))
      const delta =
        round.meanOverall !== null && parentRound?.meanOverall != null
          ? round.meanOverall - parentRound.meanOverall
          : null
      out.push({
        version: meta.version,
        note: meta.note,
        rationale: meta.rationale,
        delta,
        kept: round.kept === true,
      })
    }
    return out
  }

  // --- one round ---

  private async runRound(version: number, n: number, rid: string): Promise<void> {
    const cfg = this._state.config
    const allCases = await loadCases()
    const catOf = new Map(allCases.map((c) => [c.id, c.category]))
    const selected = cfg.caseIds ? allCases.filter((c) => cfg.caseIds?.includes(c.id)) : allCases
    const promptText = await loadPromptText(version)
    const planned = selected.length * cfg.samples

    const priorRounds = await loadRounds()
    const prior = priorRounds.find((r) => r.id === rid)
    const round: RoundSummary = prior ? { ...prior, planned } : newRound(rid, n, version, planned)
    await saveRound(round)
    this.setState({ currentRoundId: rid })

    const results: CaseResult[] = await loadCaseResults(rid)
    const done = new Set(results.map((r) => `${r.draw.caseId}-${r.draw.sample}`))
    this.recomputeMeans(round, results, catOf)
    round.done = results.length
    await saveRound(round)
    this.setProgress({ roundId: rid, done: results.length, planned, active: [] })

    const work: Array<{ c: LabCase; sample: number }> = []
    for (const c of selected) {
      for (let s = 0; s < cfg.samples; s++) {
        if (!done.has(`${c.id}-${s}`)) work.push({ c, sample: s })
      }
    }

    let next = 0
    const active = new Map<number, string>()
    let stopped = false

    const worker = async (): Promise<void> => {
      for (;;) {
        if (!this.running()) return
        if (this._state.spentUsd >= cfg.budgetUsd) {
          if (!stopped) {
            stopped = true
            this.log(`budget $${cfg.budgetUsd} reached`)
            this.setState({ status: 'stopped' })
          }
          return
        }
        const myIdx = next++
        const item = work[myIdx]
        if (!item) return
        active.set(myIdx, item.c.phrase)
        this.setProgress({ active: [...active.values()] })

        const result = await this.runCase(item.c, item.sample, version, promptText, rid)
        results.push(result)
        this.applyCosts(round, result)
        this.recomputeMeans(round, results, catOf)
        round.done = results.length
        await saveRound(round)

        active.delete(myIdx)
        this.setProgress({ done: results.length, active: [...active.values()] })
      }
    }

    const poolSize = Math.max(1, Math.min(cfg.concurrency, work.length))
    await Promise.all(Array.from({ length: poolSize }, () => worker()))

    if (this.running()) {
      round.finishedAt = new Date().toISOString()
      this.recomputeMeans(round, results, catOf)
      await saveRound(round)
    }
  }

  private applyCosts(round: RoundSummary, result: CaseResult): void {
    round.drawCostUsd += result.draw.costUsd ?? 0
    round.judgeCostUsd += result.critique?.judgeCostUsd ?? 0
  }

  private recomputeMeans(
    round: RoundSummary,
    results: CaseResult[],
    catOf: Map<string, string>
  ): void {
    const critiques = results.map((r) => r.critique).filter((c): c is Critique => c !== null)
    round.meanOverall = mean(critiques.map((c) => c.overall))
    round.meanRecognizable = mean(critiques.map((c) => c.recognizable))
    round.blindYesRate =
      critiques.length === 0
        ? null
        : critiques.filter((c) => c.blindMatch === 'yes').length / critiques.length
    round.majorIssues = critiques.reduce(
      (sum, c) => sum + c.issues.filter((i) => i.severity === 'major').length,
      0
    )
    round.meanOutputTokens = mean(
      results
        .map((r) => r.draw.usage?.output)
        .filter((x): x is number => x !== undefined && x !== null)
    )
    round.meanFirstTokenMs = mean(
      results.map((r) => r.draw.firstTokenMs).filter((x): x is number => x !== null)
    )
    round.meanDoneMs = mean(
      results.map((r) => r.draw.doneMs).filter((x): x is number => x !== null)
    )

    const byCatValues = new Map<string, number[]>()
    const byKind: Record<string, number> = {}
    for (const r of results) {
      if (!r.critique) continue
      const cat = catOf.get(r.draw.caseId) ?? 'unknown'
      const list = byCatValues.get(cat) ?? []
      list.push(r.critique.overall)
      byCatValues.set(cat, list)
      for (const issue of r.critique.issues) byKind[issue.kind] = (byKind[issue.kind] ?? 0) + 1
    }
    const byCategory: Record<string, number> = {}
    for (const [cat, values] of byCatValues) byCategory[cat] = mean(values) ?? 0
    round.byCategory = byCategory
    round.byKind = byKind
  }

  private async runCase(
    c: LabCase,
    sample: number,
    version: number,
    promptText: string,
    rid: string
  ): Promise<CaseResult> {
    const cfg = this._state.config
    const drawnAt = new Date().toISOString()
    const imagePath = `${caseFileBase(rid, c.id, sample)}.jpg`

    const outcome = await drawPhrase({
      phrase: c.phrase,
      system: promptText,
      model: cfg.drawModel,
      mode: 'batch',
      signal: this.abort?.signal,
    })
    if (outcome.error) this.setProgress({ lastError: `${c.phrase}: ${outcome.error}` })

    const draw = this.drawResult(c, version, sample, cfg.drawModel, outcome, imagePath, drawnAt)
    const { critique, critiqueError, blindCost } = await this.critique(c, outcome)

    const result: CaseResult = { draw, critique, critiqueError }
    await saveCaseResult(rid, result, outcome.image)
    await appendHistory(this.historyRow(rid, version, c, sample, draw, critique, blindCost))

    const spend = (draw.costUsd ?? 0) + (blindCost ?? 0) + (critique?.judgeCostUsd ?? 0)
    this.setState({ spentUsd: this._state.spentUsd + spend })
    return result
  }

  private drawResult(
    c: LabCase,
    version: number,
    sample: number,
    model: string,
    outcome: DrawOutcome,
    imagePath: string,
    drawnAt: string
  ): DrawResult {
    return {
      caseId: c.id,
      phrase: c.phrase,
      promptVersion: version,
      sample,
      model,
      ops: outcome.ops,
      lines: outcome.lines,
      parseErrors: outcome.parseErrors,
      firstTokenMs: outcome.firstTokenMs,
      doneMs: outcome.doneMs,
      usage: outcome.usage,
      costUsd: outcome.costUsd,
      error: outcome.error,
      imagePath,
      drawnAt,
    }
  }

  private async critique(
    c: LabCase,
    outcome: DrawOutcome
  ): Promise<{
    critique: Critique | null
    critiqueError: string | null
    blindCost: number | null
  }> {
    const cfg = this._state.config
    let blind = ''
    let blindCost: number | null = null
    try {
      const bg = await blindGuess(outcome.image, cfg.blindModel)
      blind = bg.guess
      blindCost = bg.costUsd
    } catch (e) {
      this.log(`blind guess failed for ${c.phrase}: ${msgOf(e)}`)
    }
    try {
      const j = await judgeCase({
        c,
        ops: outcome.ops,
        image: outcome.image,
        blindGuess: blind,
        model: cfg.judgeModel,
      })
      const critique: Critique = {
        ...j.output,
        blindGuess: blind,
        judgeModel: cfg.judgeModel,
        judgeCostUsd: j.costUsd,
        judgedAt: new Date().toISOString(),
      }
      return { critique, critiqueError: null, blindCost }
    } catch (e) {
      const critiqueError = msgOf(e)
      this.log(`judge failed for ${c.phrase}: ${critiqueError}`)
      this.setProgress({ lastError: `judge ${c.phrase}: ${critiqueError}` })
      return { critique: null, critiqueError, blindCost }
    }
  }

  private historyRow(
    rid: string,
    version: number,
    c: LabCase,
    sample: number,
    draw: DrawResult,
    critique: Critique | null,
    blindCost: number | null
  ): HistoryRow {
    const majorIssues = critique
      ? critique.issues.filter((i: Issue) => i.severity === 'major').length
      : 0
    return {
      at: new Date().toISOString(),
      roundId: rid,
      promptVersion: version,
      caseId: c.id,
      category: c.category,
      tier: c.tier,
      sample,
      overall: critique?.overall ?? null,
      recognizable: critique?.recognizable ?? null,
      blindMatch: critique?.blindMatch ?? null,
      subscores: critique?.subscores ?? null,
      majorIssues,
      parseErrors: draw.parseErrors,
      outputTokens: draw.usage?.output ?? null,
      firstTokenMs: draw.firstTokenMs,
      doneMs: draw.doneMs,
      costUsd: (draw.costUsd ?? 0) + (blindCost ?? 0) + (critique?.judgeCostUsd ?? 0),
    }
  }

  // --- playground ---

  async runOne(
    phrase: string,
    promptVersion: number,
    mode: 'live',
    canvas: HTMLCanvasElement,
    onLine?: (l: import('./types').DrawLine) => void,
    onText?: (delta: string) => void
  ): Promise<CaseResult> {
    const cfg = this._state.config
    const promptText = await loadPromptText(promptVersion)
    const c: LabCase = { id: slug(phrase), phrase, tier: 'subject', category: 'play', expect: [] }
    const drawnAt = new Date().toISOString()

    const outcome = await drawPhrase({
      phrase,
      system: promptText,
      model: cfg.drawModel,
      mode,
      canvas,
      onLine,
      onText,
    })
    outcome.stage.stop()

    const iso = new Date().toISOString().replace(/[:.]/g, '-')
    const imagePath = `lab/runs/play/${iso}-${c.id}.jpg`
    const draw = this.drawResult(c, promptVersion, 0, cfg.drawModel, outcome, imagePath, drawnAt)
    const { critique, critiqueError } = await this.critique(c, outcome)

    const result: CaseResult = { draw, critique, critiqueError }
    await saveCaseResult('play', result, outcome.image)
    return result
  }

  /**
   * Patch the prompt from the product owner's own words about one Playground picture, then save it as
   * a new manual version. An independent side path: it reads state but never mutates the campaign
   * (rounds, bestVersion, spentUsd, status all untouched), so it is safe to call while a campaign is
   * running. The caller redraws from the returned version. Throws with a clear message if the editor
   * cannot produce a valid patch in two tries.
   */
  async improveFromNote(input: {
    result: CaseResult
    c: LabCase
    note: string
    version: number
  }): Promise<PromptMeta> {
    const cfg = this._state.config
    const { result, c, note, version } = input
    const text = await loadPromptText(version)
    const seedText = await loadPromptText(0)

    // A synthetic one-case round so the editor sees this picture's scores the same way it sees a round.
    const round = newRound('play', -1, version, 1)
    this.recomputeMeans(round, [result], new Map([[c.id, c.category]]))
    round.done = 1

    const attempts: PatchAttempt[] = (await loadPromptMetas())
      .filter((m) => m.source === 'editor' || m.source === 'manual')
      .map((m) => ({
        version: m.version,
        note: m.note,
        rationale: m.rationale,
        delta: null,
        kept: m.version === this._state.bestVersion,
      }))

    const tokensNow = await countPromptTokens(text, cfg.drawModel)
    const baseTokens = this._state.baselinePromptTokens ?? tokensNow
    const tokensMax = Math.round(baseTokens * cfg.maxPromptGrowth)

    let failure = ''
    for (let attempt = 0; attempt < 2; attempt++) {
      const { patch } = await proposePatch({
        prompt: text,
        promptVersion: version,
        round,
        results: [result],
        cases: [c],
        attempts,
        tokensNow,
        tokensMax,
        model: cfg.editorModel,
        userNotes: note,
        previousFailure: failure || undefined,
      })
      const applied = applyPatch(text, patch)
      if (!applied.ok) {
        failure = applied.error
        continue
      }
      const validity = validatePrompt(applied.text, seedText)
      if (!validity.ok) {
        failure = validity.errors.join('; ')
        continue
      }
      const tokens = await countPromptTokens(applied.text, cfg.drawModel)
      if (tokens > baseTokens * cfg.maxPromptGrowth) {
        failure = `the patched prompt is ${tokens} tokens, over the ${tokensMax} token budget`
        continue
      }
      return savePrompt(applied.text, {
        parent: version,
        note: `playground: ${note.slice(0, 70)}`,
        rationale: patch.rationale,
        tokens,
        source: 'manual',
      })
    }
    throw new Error(`could not build a valid prompt patch from the note: ${failure}`)
  }
}
