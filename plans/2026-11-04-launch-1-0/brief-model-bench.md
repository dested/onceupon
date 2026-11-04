# model-bench: opus-high · phase 1 (measure; the only code it changes is model plumbing)

Re-read this file and the Standing answers in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** Evidence for one product call: can Claude Haiku 5.5 (`claude-haiku-5-5`, $0.10 in / $0.50 out per MTok, prompt ≤ 100K; 20× cheaper than Sonnet 5.5 at $2 / $10) draw stories in the kit dialect (the production default) at Sonnet 5.5's picture quality and speed? Measured per beat and per minute of talking (6–7 beats per mic minute, the 2026-09-22 measurement), side by side, on the same day, with pictures the lead can look at.

**Read first.** /w/code/onceupon-f/cliffnotes.md (kit dialect, Gotchas: thinking, prompt caching, prototype bench), /w/code/onceupon-f/plans/2026-09-28-dsl-rethink.md (how the last bench was run and judged), /w/code/onceupon-f/scripts/proto-bench.ts, /w/code/onceupon-f/scripts/proto-render.mjs, /w/code/onceupon-f/scripts/proto-sheet.ts, /w/code/onceupon-f/src/llm/anthropic-thinking.ts, /w/code/onceupon-f/apps/web/server/anthropic-thinking.ts, /w/code/onceupon-f/src/llm/models.ts.

**API facts (from the claude-api skill, 2026-11-04; do not re-research).**
- Haiku 5.5: adaptive thinking on by default, default effort `medium`; `{type: "disabled"}` is accepted at effort `high` or below; `between_tools` is Sonnet 5.5 only; `budget_tokens`, prefill and non-default sampling params are 400s. Newer tokenizer (~30% more tokens for the same text). Prompt-cache minimum 512 tokens. Cache reads ~0.1× input ($0.01/MTok), writes 1.25× (5 min). Refusals have no server-side fallback (`stop_reason: "refusal"`).
- Sonnet 5.5: lowest setting `between_tools`; $2 / $10, cache read $0.20, write $2.50.

**Steps.**
1. Model plumbing (lead-approved edits, inside your owned files only):
   - `src/llm/models.ts`: add preset `{ provider: 'anthropic', id: 'claude-haiku-5-5', label: 'Haiku 5.5', hint: 'cheapest, fast' }` after Haiku 4.5, and PRICING row `{ match: /claude-haiku-5-5/, input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }` placed before the haiku-4-5 row. Do not change `DEFAULT_MODEL`.
   - `fastThinking()` in both `src/llm/anthropic-thinking.ts` and `apps/web/server/anthropic-thinking.ts`: a `haiku-5-5` branch. Probe first with one real call each: `{type:'disabled'}` vs adaptive + effort low; keep whichever gives the earlier first token without hurting the output, and update the doc comment with the probe date and result. If the server has its own pricing table for cost tracking (grep apps/web/server for `haiku-4-5` / `cacheRead`), add the same Haiku 5.5 row there.
   - `scripts/proto-bench.ts`: replace the hard-coded thinking branch with `fastThinking(model)` as the default (keep `thinking=adaptive-low` / `thinking=between` as explicit overrides), so `model=claude-haiku-5-5` works.
   - `bun run typecheck` at the root and `cd apps/web && bun run typecheck` must exit 0. Commit these with the helper: `bash ~/.claude/sal/bin/commit-paths.sh "Haiku 5.5: preset, pricing, fastest thinking, bench uses fastThinking (model-bench)" <the files>`.
2. Bench, same day, same set: `bun scripts/proto-bench.ts kit set=full run=2026-11-04-haiku model=claude-haiku-5-5` and `bun scripts/proto-bench.ts kit set=full run=2026-11-04-sonnet model=claude-sonnet-5-5`. Also `set=tail` for both (long-tail subjects fall back to freehand ops lines; that is where a weaker model shows). Keys come from `.env.local` (`VITE_ANTHROPIC_API_KEY`); never print them.
3. Render both with the production look: start the dev server (`bun run dev`, port 7710; report its pid; stop it when done), `node scripts/proto-render.mjs <run> kit style=pop port=7710`, then `bun scripts/proto-sheet.ts <run>`.
4. Look at every sheet yourself (Read the images). For each story: which model's picture is better, or equal; note wrong subjects, missing characters, broken freehand, safety `skip` differences. Also run the kid-safety probe: the bench set's unsuitable lines (if none, write 5 short ones a 5-year-old might say that should be skipped, e.g. bathroom or violence phrasing, and 5 that look edgy but are fine, e.g. "the dragon ate the bad guy's sandwich"), on both models.
5. Numbers per model from results.jsonl: median and p90 time to first token and to first ink, output tokens per beat, input / cache-read / cache-write tokens per beat, cost per beat, parse-error rate, skip rate, refusal count; then cost per mic minute at 6 and at 8 beats per minute, including one restart per minute (input plus ~100 output tokens). Confirm prompt caching actually hits on both (cache reads > 0 after the first beat).

**Report file.** /w/junk/onceupon-f/model-bench.md: the numbers table, the quality verdict per story (a compact table), the sheet paths (absolute), the safety results, and a 5-line recommendation: Haiku 5.5 for all beats / Haiku with Sonnet fallback for the freehand tail / stay on Sonnet, with the reason. State any doubt plainly.

**Owns.** `/w/code/onceupon-f/src/llm/models.ts`, `/w/code/onceupon-f/src/llm/anthropic-thinking.ts`, `/w/code/onceupon-f/apps/web/server/anthropic-thinking.ts` (and the server pricing file if one exists; name it in your ready line), `/w/code/onceupon-f/scripts/proto-bench.ts`, `/w/code/onceupon-f/lab/proto/2026-11-04-*` (bench output), `/w/junk/onceupon-f/model-bench.md`. Nothing else.

**Spend cap.** $5 of API spend in total. Stop and report if a run looks like it will pass it.

**Done when.** Typechecks exit 0, the plumbing commit exists, both runs and sheets exist, the report is written, the dev server is stopped.

**Don't.** Change the production default model or the relay's model flag (the lead decides). Edit prompts, the kit library or the engine. Push or deploy. Touch files other agents own (sim-tester: apps/mobile/scripts/mini/**).

**Report** (≤ 10 lines): `ready model-bench <sha> <one-line verdict>`, the per-minute cost for each model, first-ink p50 for each, the quality tally (Haiku better / equal / worse), the report path.
