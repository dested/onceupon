# Drawing lab: word → picture → critique → prompt hill-climb

- **Date:** 2026-09-22
- **Status:** done (built 2026-09-22; first 3-case campaign: 67.3 → 80.0 kept, v2 reverted)
- **Type:** spec (zero-decision; Opus agents build from it, Fable reviews)
- **Board:** https://board.localhost/t/187

Sal: "send it a word, have it generate, save that, analyze the image on what it did wrong, update
the system prompt accordingly. Generic, lots of analysis, results on disk over time, plus a page I can
play with." Decisions taken (asked, 2026-09-22): auto hill-climb; Opus 5.5 judges and edits; kept
versions are promoted into `src/llm/ops-prompt.ts` manually; test set is subjects + actions.

## Shape

| Piece | Where | Owner |
| --- | --- | --- |
| Shared types (zod) | `src/lab/types.ts` | Fable (done) |
| Default test set | `src/lab/cases.ts` | Fable (done) |
| Vite dev plugin: `lab/` file API + promote | `scripts/lab-plugin.ts`, `vite.config.ts` | Agent A |
| Second entry | `lab.html`, `src/lab/main.tsx` (mount only, A) | Agent A |
| Client data layer | `src/lab/api.ts` (fetch wrappers), `src/lab/store.ts` (typed disk model) | Agent A |
| Pricing row for Opus 5.5 | `src/llm/models.ts` | Agent A |
| Draw one phrase | `src/lab/draw.ts` | Agent B |
| Blind guess + judge | `src/lab/judge.ts` | Agent B |
| Prompt tools + editor | `src/lab/prompt-tools.ts`, `src/lab/editor.ts` | Agent B |
| Campaign loop | `src/lab/campaign.ts` | Agent B |
| Page UI | `src/lab/ui/*.tsx`, `src/lab/App.tsx` | Agent C |

Nothing in `src/app.tsx`, `src/ui/**`, `src/engine/**`, `src/llm/dialect.ts`, `json-dsl.ts`,
`ops-dsl.ts`, `ops-prompt.ts` changes (another session owns engine/export files right now). The lab
imports the engine and dialect as they are.

Rules for every agent: `bunx prettier --write <your files only>`, never `bun run prettier`; never
git stash/checkout/restore/reset/clean; never whole-file Write on a file you did not create; no
`any`, no `as` casts (except none), no `!` where narrowing works; `bun run typecheck` green on your
files before you report. Another Claude session is editing this working tree at the same time.

## Disk layout (`lab/`, repo root)

```
lab/
  cases.json             LabCase[]            seeded from DEFAULT_CASES when missing
  campaign.json          CampaignState        written after every case; resume reads it
  history.jsonl          HistoryRow per line  append only
  prompts/
    v000.md              prompt text          seeded from OPS_SYSTEM_PROMPT when missing
    v000.json            PromptMeta
  runs/
    r000/round.json      RoundSummary         written when the round starts and after every case
    r000/horse-0.jpg     1280x800 JPEG q0.88  what the judge saw
    r000/horse-0.ops.txt raw model output
    r000/horse-0.json    CaseResult
    play/<iso>-<slug>.jpg|.json|.ops.txt      playground saves (same CaseResult shape, roundId "play")
```

`.gitignore` adds `lab/runs/` (images). `lab/prompts`, `lab/cases.json`, `lab/campaign.json`,
`lab/history.jsonl` are tracked so the trend survives.

## Agent A: server plugin, entry, data layer

### `scripts/lab-plugin.ts` (node, imported by `vite.config.ts`)

`export function labPlugin(): Plugin` with `configureServer(server)` registering middleware for
`/__lab/*`. Root = `lab/` under the vite root (`server.config.root`). Every `path` query/body value is
resolved with `path.resolve(root, p)` and must start with `root + sep` or equal root; otherwise 400.
`..` anywhere → 400. Directories are created on write (`mkdir -p`). JSON responses; errors
`{ error: string }` with 4xx/5xx.

| Route | In | Out |
| --- | --- | --- |
| `GET /__lab/file?path=lab/x.json` | | body text utf8, `content-type: text/plain`; 404 if missing |
| `GET /__lab/file?path=...&b64=1` | | `{ b64: string }` |
| `PUT /__lab/file?path=...` | raw body utf8 | `{ ok: true, bytes }` |
| `PUT /__lab/file?path=...&b64=1` | raw body = base64 | `{ ok: true, bytes }` |
| `POST /__lab/append?path=...` | raw body, one line (a `\n` is appended) | `{ ok: true }` |
| `GET /__lab/list?path=lab/runs` | | `{ entries: [{ name, dir, size, mtime }] }`, `[]` if missing |
| `DELETE /__lab/file?path=...` | | `{ ok: true }` (files only) |
| `POST /__lab/promote` | `{ version: number }` | `{ ok: true, chars: number }` |

Promote: read `lab/prompts/vNNN.md`; refuse (400) if it contains a backtick or `${`; in
`src/llm/ops-prompt.ts` replace everything between `export const OPS_SYSTEM_PROMPT = \`` and the
first line that is exactly a backtick followed by end of line (the template's closing line is
`move bunny 480 525 1.5 walk\`` today, so: find the closing backtick that is followed by `\n\n/** The
same prompt`), with the file text; write; return. Refuse (409) if the markers are not found exactly
once. Also write `lab/prompts/promoted.json` = `{ version, at }`.

Body reading: collect the request stream to a Buffer (limit 24 MB → 413).

`vite.config.ts` in-place edit: import `labPlugin` from `./scripts/lab-plugin`, add to plugins;
`build.rollupOptions.input = { main: 'index.html', lab: 'lab.html' }` (use `fileURLToPath` as the
alias does). Port unchanged (7710).

### `lab.html`

Copy of `index.html` with `<title>Once Upon lab</title>`, `<div id="lab">`, script
`/src/lab/main.tsx`, same fonts and `/src/styles/app.css`.

### `src/lab/main.tsx`

```tsx
createRoot(document.getElementById('lab')).render(<StrictMode><LabApp /></StrictMode>)
```
`LabApp` is imported from `./App` (Agent C). If `./App` does not exist yet when you typecheck,
create a placeholder `src/lab/App.tsx` exporting `LabApp = () => <div>lab</div>` ONLY if the file is
absent; Agent C will overwrite it. Set `document.title`.

### `src/lab/api.ts`

```ts
export async function readText(path: string): Promise<string | null>   // null on 404
export async function readBytes(path: string): Promise<Uint8Array | null>
export async function writeText(path: string, text: string): Promise<void>
export async function writeBlob(path: string, blob: Blob): Promise<void>  // base64 via FileReader
export async function appendLine(path: string, line: string): Promise<void>
export async function list(path: string): Promise<Array<{ name: string; dir: boolean; size: number; mtime: number }>>
export async function remove(path: string): Promise<void>
export async function promote(version: number): Promise<void>
export function imageUrl(path: string): string   // `/__lab/file?path=...&raw=1` — add `raw=1` to the GET route: serves bytes with the file's content type (image/jpeg) so <img src> works
```
Non-2xx → throw `Error(\`lab api ${status}: ${message}\`)`. Zod-validate JSON bodies.

### `src/lab/store.ts` (typed disk model; every read zod-parsed, throw on invalid)

```ts
export async function loadCases(): Promise<LabCase[]>              // seeds DEFAULT_CASES if missing
export async function saveCases(cases: LabCase[]): Promise<void>
export async function loadPromptMetas(): Promise<PromptMeta[]>     // sorted by version; seeds v000 from OPS_SYSTEM_PROMPT (import from '~/llm/ops-prompt') if none, source 'seed', note 'seeded from src/llm/ops-prompt.ts', tokens null
export async function loadPromptText(version: number): Promise<string>
export async function savePrompt(text: string, meta: Omit<PromptMeta, 'version' | 'createdAt'>): Promise<PromptMeta>  // version = max+1
export async function updatePromptMeta(meta: PromptMeta): Promise<void>
export async function loadPromoted(): Promise<{ version: number; at: string } | null>
export async function loadCampaign(): Promise<CampaignState | null>
export async function saveCampaign(state: CampaignState): Promise<void>
export async function loadRounds(): Promise<RoundSummary[]>        // every runs/r*/round.json, sorted by n
export async function saveRound(r: RoundSummary): Promise<void>
export async function loadCaseResults(roundId: string): Promise<CaseResult[]>   // every *.json in the round dir except round.json
export async function saveCaseResult(roundId: string, r: CaseResult, image: Blob): Promise<void>  // writes .jpg, .ops.txt, .json (imagePath must already be the .jpg path)
export async function appendHistory(row: HistoryRow): Promise<void>
export async function loadHistory(): Promise<HistoryRow[]>          // skips unparsable lines
```

### `src/llm/models.ts`

Insert before the `/claude-opus-(5|4-8|...)/` row:
`{ match: /claude-opus-5-5/, input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 }`. Nothing else.

## Agent B: draw, judge, editor, campaign

Anthropic client: `new Anthropic({ apiKey, dangerouslyAllowBrowser: true })` (same as
`providers.ts`; localhost-only app). Key: `appStore.get().settings.keys.anthropic` from
`~/story/store` (env `.env.local` or Settings, already loaded there). If empty, throw
`Error('no Anthropic key: set VITE_ANTHROPIC_API_KEY in .env.local or paste it in the app Settings')`.

### `src/lab/draw.ts`

```ts
export interface DrawOptions {
  phrase: string
  system: string                       // the prompt version text; dialect.system is ignored
  model: string                        // 'claude-sonnet-5'
  mode: 'batch' | 'live'
  canvas?: HTMLCanvasElement           // live: required (visible); batch: created detached 1280x800
  onLine?: (l: DrawLine) => void
  onText?: (delta: string) => void
  signal?: AbortSignal
}
export interface DrawOutcome {
  ops: string; lines: DrawLine[]; parseErrors: number
  firstTokenMs: number | null; doneMs: number | null
  usage: Usage | null; costUsd: number | null; error: string | null
  image: Blob                          // 1280x800 image/jpeg 0.88 of the settled picture
  stage: Stage; scene: Scene            // live mode: caller stops the stage when done with it
}
export async function drawPhrase(o: DrawOptions): Promise<DrawOutcome>
```

- `scene = new Scene()`; batch: `clock = new VirtualClock()`, `stage = new Stage(canvas, { seed: hashString(phrase), clock, size: { w: 1280, h: 800 } })`, `stage.setInstant(true)`; live: `realClock` (omit), `stage.start()`, no instant, and `stage.resize()` once.
- `dialect = new OpsDialect(scene, { moderation: true, clock })` (pass `clock` only in batch; the option is optional in `DialectOptions`). `dialect.later = (cmds) => apply(cmds)`.
- `provider = makeProvider('anthropic', model, keys)`; `user = dialect.buildUser({ storyChunks: [], newWords: phrase })`; stream `{ system: o.system, user, maxTokens: dialect.maxTokens, signal }`.
- Line loop copied from `Director.kick` (split on `\n`, trim, skip empties, `dialect.isSkip(line)` ends the call with a `skip` line recorded, `dialect.parse` → `scene.apply` → `stage.handle` for each event, `warn` events become `ok: true` lines with `error` = the message). Count `parseErrors` = lines with `ok: false`.
- Settle. Batch: after the stream, `t = clock.now()`; loop `t += 100; clock.advanceTo(t); stage.renderAt(t)` until `stage.settled && t >= streamEnd + 4000`, cap 20 s. Live: poll every 100 ms until `stage.settled` for 3 consecutive polls (fx die, bubbles stay… bubbles block `settled`; so live cap 12 s then continue anyway).
- Snapshot: draw the canvas to a 1280x800 offscreen canvas (`drawImage`), `toBlob('image/jpeg', 0.88)`. Batch canvas is already 1280x800 → use it directly.
- Errors from the stream become `error` (string); the picture is still snapshotted.
- Timing with `performance.now()` around the stream, same fields as `CallStat`.

### `src/lab/judge.ts`

```ts
export async function blindGuess(image: Blob, model: string): Promise<{ guess: string; costUsd: number | null }>
export async function judgeCase(input: { c: LabCase; ops: string; image: Blob; blindGuess: string; model: string }): Promise<{ output: JudgeOutput; costUsd: number | null }>
```

Blind guess: one user message [image (base64 jpeg), text]. Text: `This is a child's crayon drawing
from a picture-book app. In at most six words, name the main thing drawn and, if there is one, what it
is doing. Answer with the words only.` `max_tokens: 60`, `output_config: { effort: 'low' }`.

Judge: `client.messages.parse({ model, max_tokens: 6000, output_config: { effort: 'high', format: zodOutputFormat(judgeOutputSchema) }, system: JUDGE_SYSTEM, messages: [{ role: 'user', content: [image block, text block] }] })`.
`zodOutputFormat` from `@anthropic-ai/sdk/helpers/zod`. `parsed_output` null → throw. Cost via
`estimateCost(model, usage)` mapping the SDK usage fields to our `Usage`. Text block:

```
CHILD'S WORDS: <phrase>
A RECOGNIZABLE DRAWING NEEDS:
- <expect line>
...
BLIND GUESS (another model, words unseen): <blindGuess>
OPS THE DRAWER EMITTED:
<ops, with a leading "PARSE ERROR: <msg> | " prefix on lines that failed>
```

`JUDGE_SYSTEM` verbatim:

```
You are the art director of a picture-book app for four-year-olds. A drawing model turns a child's words into a crayon picture using a tiny language called ops. You receive the child's words, what a recognizable drawing needs, the exact ops the drawer wrote, a blind guess from a model that saw the picture without the words, and the picture itself.

Judge the PICTURE the way a four-year-old and their parent would: is it instantly that thing? Charm beats accuracy. Bold simple shapes are the goal, not detail. But anatomy must read: the right parts, the right count, in the right place, attached to what they belong to, feet on the ground, inside the page, not overlapping into mush.

Paper conventions so you can read the ops: paper 1200 wide, 620 tall, y goes down, ground y=525. `ent <id> <x> <y>` puts the anchor at the feet. `draw <id>.<shape>` coordinates are LOCAL to that anchor, negative y is up. `mirror` also draws the x-mirror. Shapes stack in order, later on top. `face <id> <shape>` puts eyes and a mouth on that shape. A circle is `cx cy r`, an oval `cx cy rx ry`, a rect `x y w h` from its top-left corner.

Method:
1. Look at the picture first and say what you see (`seen`), then compare with the child's words and the needs list.
2. For each thing wrong, find the ops line(s) that caused it and explain in coordinates, e.g. "ears drawn at local y -120 but the head circle spans y -235..-151, so the ears float under the chin". Attribute, do not guess: if the ops are fine but the picture is not, say so (renderer issue) under kind `other`.
3. Classify each issue with one kind: missing-part, misplaced-part, wrong-count, wrong-proportion, wrong-color, floating (parts detached or feet off the ground), off-page, bad-overlap (a part hidden or merged by another), too-complex (shape spam or fussy detail), too-small, too-big, unrecognizable, wrong-subject, extra-thing (unasked scenery or props that distract), parse-error, other. Major = a four-year-old would notice or the thing stops reading as itself; minor = a parent would notice.
4. For every issue write `rule`: ONE sentence, a general drawing rule about ANY subject that would have prevented this class of mistake. Bad: "put the horse's ears on its head". Good: "Ears attach to the top edge of the head shape: their base y equals the head's top y and their x stays within the head's radius."
5. Praise: one to three things that worked and must not be lost.

Scores. recognizable 1-5: 5 = a four-year-old names it at once; 4 = names it after a beat; 3 = you can tell once you know the word; 2 = only with the word and goodwill; 1 = no. subscores 1-5: anatomy (parts, counts, attachment), proportion (relative sizes), placement (on the ground, in the page, sensible layout, no bad overlap), color (sensible for the thing, outline plus fill, reads on cream paper), composition (big enough, centered, uncluttered), simplicity (few bold shapes; penalize fussiness and shape spam). overall 0-100: your honest score of the picture for the book, recognizability weighing most, then anatomy and placement. blindMatch: yes if the blind guess names the same thing (and the same action when there is one), partial if a close cousin or the thing without the action, no otherwise. Be strict and consistent: a 90 is a picture you would print.
```

### `src/lab/prompt-tools.ts`

```ts
export function applyPatch(prompt: string, patch: PromptPatch): { ok: true; text: string } | { ok: false; error: string }
  // each find must occur exactly once (report which index and 0/many); apply in order
export function validatePrompt(text: string): { ok: boolean; errors: string[] }
  // required headers present once each: "# Paper", "# Ops", "# How to draw well", "# Cookbook", "# Story beats", "# For a small child", "# Example";
  // the "# For a small child" section is one paragraph followed by a blank line (the *_UNMODERATED regex /# For a small child\n[^\n]+\n\n/ must match) and the text "skip\n  See below.\n" is present;
  // no backtick, no "${";
  // every line in the "# Example" section that is not blank and not starting with "NEW STORY:" must parse with parseOpsLine (ok and op !== null unless it starts with #);
  // "# Ops" section text must be byte-identical to the seed prompt's "# Ops" section (grammar frozen) — read the seed via loadPromptText(0)? No: pass it in: validatePrompt(text, seedText)
export function diffLines(a: string, b: string): Array<{ k: 'same' | 'add' | 'del'; line: string }>   // simple LCS line diff for the UI
export async function countPromptTokens(text: string, model: string): Promise<number>
  // client.messages.countTokens({ model, system: text, messages: [{ role: 'user', content: 'x' }] }).input_tokens
export function sectionOf(text: string, header: string): string   // text from the header line to the next "\n# " or end
```

### `src/lab/editor.ts`

```ts
export interface EditorInput {
  prompt: string; promptVersion: number
  round: RoundSummary; results: CaseResult[]; cases: LabCase[]
  attempts: PatchAttempt[]
  tokensNow: number; tokensMax: number
  model: string
}
export async function proposePatch(i: EditorInput): Promise<{ patch: PromptPatch; costUsd: number | null }>
```

`client.messages.parse` with `zodOutputFormat(promptPatchSchema)`, `max_tokens: 12000`,
`output_config: { effort: 'high', format }`, system `EDITOR_SYSTEM`, user text:

```
CURRENT PROMPT (version N, T tokens; budget MAX tokens):
<<<
<prompt>
>>>

ROUND SUMMARY: mean overall X, mean recognizable Y, blind-yes Z%, major issues M over K cases; by kind: <kind: count, ...>; by category: <category: mean overall, ...>

RESULTS (worst first; each: phrase | overall | recognizable | blind guess | major issues as kind: what -> rule):
- "horse" | 41 | 2 | "a dog" | misplaced-part: ears under the chin -> Ears attach ... ; floating: ...
...
(cases at 80+ listed on one line each as "fine: phrase (score)")

PREVIOUS EDITS:
- v3 (kept, +4.2): note — rationale
- v4 (reverted, -1.8): note — rationale
(or "none yet")
```

`EDITOR_SYSTEM` verbatim:

```
You maintain the system prompt of a crayon-drawing model (Claude Sonnet 5, thinking off, streaming) inside a picture-book app for four-year-olds. The prompt teaches a tiny drawing language (ops) and a cookbook of recipes; the app parses each output line as it streams and draws it. You receive the current prompt, one round of test results (each phrase with its scores and the judge's issues, each issue carrying a general rule), what earlier edits tried and whether they helped, and a token budget.

Propose ONE set of edits that raises picture quality across MANY subjects, not just the failures listed. Think like this: group the issues by kind and by what body of knowledge the drawer lacked (attachment of parts, proportions, where things stand, layering order, when to use mirror, scene clutter). The most common kinds show where the prompt is weak. Write rules that generalize (about heads, limbs, wings, wheels, roofs: relations between shapes), placed where the drawer will read them at the right moment (# How to draw well for global rules; the cookbook for recipe fixes). Fix a cookbook recipe only when a category fails systematically, and then fix the pattern the recipes share (for example one "four-legged animal" template that the cat, dog and horse recipes all follow) rather than patching one animal.

Hard constraints:
- Never change the "# Ops" section: the parser is fixed and every op, argument and default listed there is what the app understands. Do not invent ops or arguments.
- Do not change the "# For a small child" section or the skip op.
- Every cookbook fragment and every "# Example" line must be valid ops syntax: integers only, local coordinates, `mirror` for pairs, `M x y L x y Q cx cy x y C ... Z` paths, no trailing punctuation inside an ops fragment. The example story must still parse line by line.
- Tokens are latency: the prompt is read on every call. Stay under the budget. Cut, merge or tighten weak text before adding; prefer one sharp sentence to three soft ones. Never pad.
- Do not repeat an edit that was reverted; try a different lever.
- Keep the prompt's voice: short imperative bullets, concrete numbers.

Output exact find/replace edits. `find` is copied verbatim from the current prompt and must occur exactly once; make it a whole line or bullet so it is unique. To insert, find the line before and replace with itself plus the new line. To delete, replace with an empty string. rationale: what the round's failures have in common and why these edits fix the class. note: one line for the version log, under 80 characters.
```

### `src/lab/campaign.ts`

```ts
export class Campaign {
  readonly state: CampaignState            // current snapshot
  subscribe(fn: () => void): () => void    // for useSyncExternalStore
  progress: { roundId: string | null; done: number; planned: number; active: string[]; lastError: string | null }
  static async load(): Promise<Campaign>   // from loadCampaign() or a fresh idle state with DEFAULT_CAMPAIGN_CONFIG
  setConfig(c: CampaignConfig): void       // only while not running
  async start(): Promise<void>             // idle/stopped/done → running; resumes currentRoundId if set
  pause(): void                            // finish in-flight cases, then stop scheduling; status 'paused'
  resume(): Promise<void>
  stop(): void                             // abort in-flight (AbortController), status 'stopped'
  async runOne(phrase: string, promptVersion: number, mode: 'live', canvas: HTMLCanvasElement, onLine?, onText?): Promise<CaseResult>   // playground: draw + blind + judge with an ad-hoc LabCase { id: slug(phrase), phrase, tier: 'subject', category: 'play', expect: [] }, saved under lab/runs/play/
  async judgeOnly(...)                     // not needed; runOne does both
}
```

Round algorithm (`runRound(version)`):
1. `rid = roundId(n)` where n = rounds.length (or `currentRoundId` on resume). Write `round.json` with `done: 0`, `kept: null`, `verdict: ''`.
2. Cases = `config.caseIds ?? all` × `samples`. Skip any whose `<caseId>-<sample>.json` already exists (resume).
3. Worker pool of `config.concurrency`: for each (case, sample): `drawPhrase` (batch) → `blindGuess` → `judgeCase` → `saveCaseResult` → `appendHistory` → update round.json aggregates (recompute from all results so far) → `saveCampaign` (spentUsd += draw + blind + judge). Judge errors: `critique: null, critiqueError`, the case counts as scored 0 in means? No: excluded from means, counted in `done`, logged. Draw errors with no ops: still judged (the judge will say unrecognizable).
4. Finish: `finishedAt`, means: `meanOverall` over critiques, `meanRecognizable`, `blindYesRate`, `majorIssues` total, `meanOutputTokens` over draws with usage, `meanFirstTokenMs`, `meanDoneMs`, `byCategory` = mean overall per category, `byKind` = issue counts per kind.
5. Budget check before every case: if `spentUsd >= budgetUsd` → status 'stopped', log, return.

Campaign loop (`start`):
- Round 0: baseline on `bestVersion` (0 unless campaign.json says otherwise). Count `baselinePromptTokens` via `countPromptTokens(v000)` if null and store it in v000's meta too. After the round: `baselineOutputTokens = meanOutputTokens`, `bestRoundId = r000`, `kept: true`, verdict `baseline`.
- Each next round while `rounds.length - 1 < maxRounds` and status running:
  a. `attempts` = every editor-made version's meta + its round's delta/kept.
  b. `proposePatch` from the BEST version's text + the best round's results (not the last reverted round's). Apply; validate (`validatePrompt(text, seedText)`); if apply/validate fails, call the editor once more with the errors appended to the user text (`PREVIOUS ATTEMPT FAILED: ...`); if it fails again, log and stop (status 'stopped').
  c. `tokens = countPromptTokens(text)`; if `tokens > baselinePromptTokens * maxPromptGrowth` → reject the patch with the same one-retry rule (tell the editor the count).
  d. `savePrompt(text, { parent: bestVersion, note, rationale, tokens, source: 'editor' })` → vN.
  e. `runRound(N)`.
  f. Keep if `meanOverall(new) - meanOverall(best) >= keepMinDelta` AND `meanOutputTokens(new) <= baselineOutputTokens * maxOutputGrowth` AND `blindYesRate(new) >= blindYesRate(best) - 0.05`. Kept → `bestVersion = N`, `bestRoundId`. Verdict strings: `kept: +3.4 overall (61.2 → 64.6)`, `reverted: -0.8 overall`, `reverted: output tokens +31% over cap`, `reverted: blind-yes fell 62% → 51%`.
- End: status 'done'. Log lines are `HH:MM:SS message`.
- Every state change → `saveCampaign` and notify subscribers. `progress.active` = phrases in flight.
- Concurrency: draw and judge of different cases overlap through the pool; one editor call at a time.

## Agent C: the page

`src/lab/App.tsx` exports `LabApp`. Tailwind + the ui.md language (paper, ink, hand fonts, sticker
buttons from `~/ui/bits` where they fit), but this is a lab: denser, tables allowed, monospace for
ops and JSON. One dark surface only for raw ops (like the debug panel). No eyebrow labels, no
periods in headings. Tabs across the top: **Playground · Campaign · Results · Prompts · Cases**.
State via `useSyncExternalStore` on `Campaign` and small `useState`/`useEffect` loaders around the
store functions; a `refresh()` after writes.

**Playground.** Left: 16:10 canvas (`<canvas>` sized by CSS to the column, the stage handles DPR).
Above it: phrase input (default "horse"), prompt version select (labels `v003 · note`, best and
promoted marked), Draw button (StickerButton). Draw runs `campaign.runOne(phrase, version, 'live', canvas, onLine, onText)`; ops stream into a dark monospace panel on the right as they land (red for parse errors); timing chips first token / done / output tokens / cost update when done. Then the critique card appears under the ops: blind guess, recognizable stars, overall as a big number, six subscore bars, issues as rows (severity chip, kind chip, what, evidence in mono, rule in italics), praise. A "Save picture" is not needed (runOne saves). "Draw again" repeats. Show the thumbnail strip of the last 8 playground results (from `lab/runs/play`) below, click → opens it in the detail drawer used by Results.

**Campaign.** Config form (all CampaignConfig fields; case picker as category checkboxes + tier toggles; "all" default), Start / Pause / Resume / Stop, status line (`round r003 · 21/56 · $4.12 of $40 · best v002 (64.6)`), active phrases, the log (mono, newest at bottom, auto-scroll). Below: the rounds table (id, version, n cases, mean overall, recognizable, blind-yes %, major issues, out tokens, first token ms, cost, kept ✓/✗, verdict). Then the trend: inline SVG line chart of mean overall per round (kept rounds solid dots, reverted hollow), a second chart of mean output tokens and first-token ms per round, and a small multiples row of mean overall per category over rounds. Hand-drawn feel is fine but keep axes readable (ink lines, hand font labels). No chart library.

**Results.** Round select (default best) and a second "compare with" select. Grid of cases: thumbnail (`imageUrl`), phrase, overall chip (green ≥ 75, yellow ≥ 50, red below), recognizable, major issue count; when comparing, the two thumbnails side by side with the delta. Click → detail drawer (PaperCard, right side, scrollable): big image, blind guess, scores, issues, praise, ops (mono, parse errors red), draw stats. Filters: category, tier, "only regressions" when comparing.

**Prompts.** Version list (version, note, tokens, source, parent, kept/reverted from rounds, promoted badge). Select one → text in a monospace editor (`<textarea>`) with a diff view vs its parent (green/red lines from `diffLines`). "Save as new version" (source manual, note from an input) after `validatePrompt` (errors shown inline; count tokens on save). "Promote to app" button → inline confirm ("this rewrites src/llm/ops-prompt.ts — sure?") → `promote(version)` → toast. "Set as campaign best" sets `bestVersion` on an idle campaign.

**Cases.** Table of cases (id, phrase, tier, category, expect lines), inline edit of phrase/category/expect, add row, delete with inline confirm; Save writes `cases.json`. "Reset to defaults" with inline confirm.

Empty states and errors are visible text on paper, never `alert`. Every fetch error lands in a toast strip at the top (dismissable). No `window.confirm`.

## Verify

1. `bun run typecheck` green. `bun run dev`, open http://localhost:7710/lab.html.
2. Playground: type `horse`, Draw. Expect: the crayon draws live on the canvas, ops stream in, a critique card appears within ~30 s with a blind guess and issues; `lab/runs/play/` holds a jpg+json+ops.txt.
3. Campaign: set `caseIds` to three cases (Cases tab picker or config), maxRounds 1, Start. Expect `lab/runs/r000/*` files, `round.json` with means, `campaign.json` status done, three history lines. Start again with maxRounds 2 → `lab/prompts/v001.md` exists, `r001` runs, verdict says kept or reverted.
4. Prompts: pick v001, diff shows the editor's edits; Promote → `git diff src/llm/ops-prompt.ts` shows only the prompt text; revert with the promote of v000.
5. bx: `bx open http://localhost:7710/lab.html`, `bx fill "phrase" horse`, `bx click "Draw"`, `bx wait 30000`, `bx snap`.

## Cost

Per case: draw ≈ $0.01 (Sonnet 5, cached prompt), blind ≈ $0.003, judge ≈ $0.035 (Opus 5.5, one
image, ~1k output) → ≈ $0.05. 56 cases ≈ $2.8 per round, editor ≈ $0.07. Default budget $40 ≈ 12
rounds. The campaign shows spend live and stops at the budget.
