# DSL rethink: prototypes for speed, quality and cost

- **Date:** 2026-09-28
- **Status:** active
- **Type:** plan
- **What:** fresh-eyes review of the ops dialect on Sonnet 5.5; three prototypes benched head to head on one harness

## Diagnosis of ops (v3) as it stands

- The model is doing coordinate geometry. ~270-350 output tokens per beat, mostly recipes copied out of an 8.4k-token cookbook with multi-token numbers (`-235`) and scale arithmetic. The picture is only as good as a one-shot coordinate guess: ovals and rects, brown outlines on everything, googly faces.
- Rendering makes it muddier than it needs to be: hachure fills are see-through (the sky shows through characters), no light, no grounding, flat backgrounds.
- Latency floor: Sonnet 5.5 first token is ~1.0-1.4 s whether the prompt cache is cold or warm (probed: no difference at 8.4k tokens), so cache warm-up buys nothing. What a dialect controls is tokens-to-first-ink and tokens-to-done.

## Sonnet 5.5 facts (probed 2026-09-28)

- Same price as Sonnet 5 ($2 / $10, cache read $0.20). Faster output: on the old b002 bench, same tokens, done 2.76 s vs 3.69 s.
- Rejects `thinking: disabled`; its lowest is `between_tools`. Opus 5.5 and Fable 5.1 reject both and need adaptive + effort low. Fixed in `src/llm/anthropic-thinking.ts` (+ server mirror); SDK 0.126 lacks the `between_tools` type, 0.129 has it but bun's 3-day release-age gate holds it until 2026-10-01.

## Harness (branch proto/dsl-rethink)

- `src/proto/registry.ts` prototype dialects; `src/proto/stories.ts` bench set (14 subjects, 5 actions, 1 long-tail sentence, 3 multi-beat stories; `quick` subset).
- `bun scripts/proto-bench.ts <dialect> set=quick|full run=<name>`: API calls exactly as the Director sends them, per beat first token / first ink / done / tokens / cost / parse errors.
- `node scripts/proto-render.mjs <run> <dialect> [style=pop] [port=]`: headless render through the lab page hook `window.__proto.render`.
- `bun scripts/proto-sheet.ts <run>`: contact sheet `lab/proto/<run>/sheet.html`.

## Prototypes

| Name | Thesis | Owner |
| --- | --- | --- |
| kit | Model art-directs (what, colors, mood, place), an offline-authored library illustrates; designed backdrops in one line; freeform ops fallback for the long tail | agent, worktree, port 7741 |
| sketch | Model still illustrates, in an SVG-icon language: per-entity 0..100 box, blobs, arcs, fill-derived outlines, pattern tokens | agent, worktree, port 7742 |
| pop | Renderer style for every dialect: opaque waxy fills, tinted outlines, light, face appeal + blink, contact shadows, washed skies | agent, worktree, port 7743 |

## Results

(filled in when the agents report)
