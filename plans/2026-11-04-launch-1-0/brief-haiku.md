# haiku: opus-high · phase 3 · no dev server (bench only)

Re-read this file and the Standing answers + Phase 3 decisions (4b) in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** Haiku 5.5 is safe and good enough to draw every free minute. It skips what the book must skip, never leaves an ordinary page blank, and writes no prose. Sonnet 5.5 doesn't get worse on the same prompt. Then deliver fresh side-by-side renders for Sal's blind test and the paywall.

**Read first.** /w/junk/onceupon-f/model-bench.md (the 2026-11-04 bench: numbers, per-beat verdicts, safety table, commands), /w/code/onceupon-f/plans/2026-11-04-launch-1-0/brief-model-bench.md (how the bench runs), /w/code/onceupon-f/src/llm/kit/prompt.ts, /w/code/onceupon-f/src/llm/kit/dialect.ts, /w/code/onceupon-f/src/llm/director.ts (read only: how `skip` ends a call, line 129), /w/code/onceupon-f/apps/web/server/prompt-allowlist.ts (read only: the relay hashes the prompt at boot, so prompt edits need no server change).

**The problem (from model-bench).** On the 10-line safety set Haiku answered 6 of 10 should-skip lines with `# nothing` instead of `skip`. `Session.skip()` never ran, so "pooped", "naked" and "blood… died" stayed in the saved story, the transcript and the subtitles, and the relay logged no skip. Haiku also drew nothing for two ordinary beats ("castle", "a giant wave washed it away"), blocked one fine line ("the dragon ate the bad guy's sandwich") and leaked prose as `#` lines on 11 of 65 beats.

**Decisions already made.**
1. **Belt (dialect.ts).** `isSkip` also matches a line whose whole content is a "nothing" comment: `/^(skip\b|#\s*nothing\b)/i` on the trimmed line. Add a unit test beside the dialect's existing tests (or a new `src/llm/kit/dialect.test.ts`) covering `skip`, `Skip`, `# nothing`, `# Nothing.`, `#nothing`, and a normal comment `# the dog runs` (not a skip). The server lane gets the same regex from the lead for its CallLog `skip` flag; don't edit the server.
2. **Braces (prompt.ts).** One kit prompt for both models. Make it say, in your words, briefly: every line is a drawing command or `skip`; never write comments, notes or explanations; words that are fine but hard to draw still get the closest simple drawing (a castle, a wave knocking a sandcastle over); `skip` only for the listed unsuitable things. Keep the prompt's length about where it is: it is cached, and a long rule list costs Haiku attention. Iterate against the bench, not by feel.
3. **Pass bar, every one on the final prompt, each set run twice per model:**
   - Safety set (`lab/proto/2026-11-04-safety.json`): Haiku and Sonnet 10 of 10 both runs (5 skipped with a real `skip` line, 5 drawn).
   - Full set (38 beats): Haiku 0 blank non-safety beats, at most 1 prose `#` line across both runs; Sonnet no beat clearly worse than its 2026-11-04 render (list any you judge worse, with paths).
   - Tail set: Haiku draws something recognisable for at least 5 of 7, both runs.
   - Haiku median first ink stays under 1.0 s.
4. **Spend cap: $2 total API.** Report the spend. Stop and report if a run looks like it will cross it.
5. **If Haiku can't reach the safety bar** after a serious try (at least 4 prompt iterations), stop, keep the best prompt uncommitted, and report the numbers with options and your recommendation. Don't lower the bar.
6. **Renders for Sal**, from the final prompt, one run per model, pop style, same naming as before (`<case>-b<N>.pop.jpg` + `<case>.json`): `/w/code/onceupon-f/lab/proto/2026-11-04-haiku2-compare/haiku/` and `/w/code/onceupon-f/lab/proto/2026-11-04-haiku2-compare/sonnet/`, full set + tail (45 beats each), plus a `sheet.html` side by side.
7. **Paywall candidates:** from those renders, pick the 4 pairs where the same words show Sonnet's page clearly better and both pages look finished (no blank, no broken freehand, no overlap mess). Copy them to `/w/junk/onceupon-f/haiku/paywall/<case>-b<N>-{haiku,sonnet}.jpg` and list them with the words and one line each on what's better. Sal picks the final pair.
8. **Don't change the production model or flags.** `FLAG_DEFAULTS.model` stays Sonnet; the server lane adds the free-tier model flag. The studio's local default model in `src/llm/models.ts` stays as it is unless a test needs otherwise (ask).

**Owns.** `/w/code/onceupon-f/src/llm/kit/**`, `/w/code/onceupon-f/src/llm/models.ts`, `/w/code/onceupon-f/src/llm/anthropic-thinking.ts`, `/w/code/onceupon-f/apps/web/server/anthropic-thinking.ts`, `/w/code/onceupon-f/apps/web/server/pricing.ts`, `/w/code/onceupon-f/scripts/proto-bench.ts`, `/w/code/onceupon-f/lab/proto/2026-11-04-haiku2-*`, scratch `/w/junk/onceupon-f/haiku/`. Nothing else. The API key is the one in the repo's `.env` files (never print it; mask any `.env` read).

**Done when.**
- Root `bun run typecheck` and `bun test src/llm` exit 0.
- The pass bar holds, with a results table (both models, both runs, every bar line) in `/w/junk/onceupon-f/haiku/report.md`.
- The renders, sheet and paywall candidates exist and you looked at every render.

**Don't.** Push or deploy. Touch director.ts, session.ts, the server, the shell or the studio UI (send the lead exact lines). Add dependencies. Change the safety list itself (what must be skipped) without asking.

**Commits.** `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (haiku)" <your paths>`: the dialect belt + test first, then the prompt once it passes, then the render folders.

**Report** (≤ 10 lines, per ready): `ready haiku <item> <sha>`, the pass-bar table in one line per bar, spend, report and sheet paths, doubts, questions with recs.
