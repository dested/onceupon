# Brief: fx (opus-high), "The End" placement and snow flakes

**Goal.** Two picture bugs from sim-verify (/w/junk/onceupon-f/sim/verify-94affe8.md, P1 and P3), fixed before the 1.0 submission.

**Read first.** `/w/code/onceupon-f/cliffnotes.md`, `ui.md`, `features/mp4-export.md` (The End on dark pages), and the screenshots below at full resolution.

**P1. "The End" sits on the subject.** On the night owl page the lettering covers the owl's head; on the dragon page it covers a cloud.
- `/w/junk/onceupon-f/sim/verify-94affe8/iphone-07-night-replay-end.png`, `/w/junk/onceupon-f/sim/verify-94affe8/ipad-07-night-closing.png`, `/w/junk/onceupon-f/sim/verify-94affe8/ipad-07-replay-end.png`
- Want: the lettering goes where it covers the least of the drawing. Score a few candidate positions inside the picture (top centre, top left, top right, and the band above the ground line) by overlap with the scene's drawn objects (characters and props first, clouds/sun/moon next; the sky and ground fills don't count) and pick the lowest, deterministic from the scene data so the studio, replay and the mp4 export agree. Keep the size, the font and the light-on-dark rule.

**P3. Snow flakes draw as dark grey dots.** `/w/junk/onceupon-f/sim/verify-94affe8/iphone-08-tray-after-send.png`: the `snow` place (day) shows grey dots in a blue sky, and the snow patches on the pines read grey. `snowflakes()` in `src/llm/kit/library/places.ts` makes fill-only `#ffffff` circles (`patch`), so find why they render dark (renderer path for small fill-only shapes, crayon texture on white, outline fallback…) and make flakes read as white flakes and the pine snow as white, at day and night. Do not change the drawing prompt (`src/llm/kit/prompt.ts`): a prompt change needs the safety bench.

**Owns.** `src/engine/**`, `src/export/**`, `src/ui/ReplayScreen.tsx`, `src/llm/kit/library/**`, `src/llm/kit/geom.ts`, scratch `/w/junk/onceupon-f/fx/`. The lead owns `src/story/**` and `src/ui/StoryScreen.tsx`: send exact lines if those need a change. Commit only with `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (fx)" <paths>`.

**Check.** Render before/after PNGs (the proto/lab render path, see cliffnotes `src/proto/render.ts` and `scripts/lab-*`) of: the snow place day and night, the night owl story ending, the dragon story ending, and one light page; save them in `/w/junk/onceupon-f/fx/` and look at each at full resolution. `bun run typecheck` (root) and `bun test src/llm/kit` pass. No dev servers left running.

**Report** (≤ 10 lines): `ready fx <sha> <result>`, the PNG paths (absolute), doubts.

## Standing answers
