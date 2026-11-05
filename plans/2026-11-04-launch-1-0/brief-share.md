# Brief: share (opus-high), the "Send to grandma" page works on an iPhone held upright, with sound

**Goal.** Sal opened a share link on his iPhone (2026-11-05): "the share link needs audio, its too small on iphone vertical, and has the same issues". Three fixes:
1. **Sound:** the share player plays the crayon sounds, and the child's voice when the story was shared with voice.
2. **Size:** on a portrait phone the picture is as big as the screen allows.
3. **Story time:** the dead air goes away. That comes from the `storytime` lane through Replayer/VoicePlayer; you only wire its `primeAudio()`.

**Read first.** `/w/code/onceupon-f/cliffnotes.md`, `ui.md` (follow it exactly), `apps/web/src/app/share.tsx` (the page at `/s/<id>`: heading, `StudioFrame` iframe of `/app/?player=<id>&embed=1`, App Store button), `apps/web/src/app/site-parts.tsx` (`StudioFrame`, `Section`), `src/ui/SharePlayer.tsx` (the player in the iframe; `Stage(..., { audio: null })` today, so it never makes a sound), `src/engine/audio.ts` (`StageAudio`, the crayon scratch + page flip the in-app replay uses), the `bx` skill.

**Owns.** `src/ui/SharePlayer.tsx`, `apps/web/src/app/share.tsx`, `apps/web/src/app/site-parts.tsx` (`StudioFrame` only; the landing hero uses it too, so keep that working), the share-player CSS in the studio (`src/**/*.css` rules that only the share player uses; check before editing a shared rule). **Not** `src/story/**`, `src/export/**` or `src/engine/audio.ts` (`storytime` owns them). Need a change there? Send the lead the exact lines. Commit only with `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (share)" <paths>`.

**Contract with storytime.**
- `VoicePlayer.fromUrl(url, mime, totalMs)` and `new Replayer(record, director, handlers, { voice })` keep their signatures.
- `primeAudio(): void` from `src/story/voice.ts` lands in storytime's first commit. Call it synchronously inside the tap that starts playback (`onFirstPlay`, and "Watch it again"), before `player.play()`.
- Before that commit lands, build against it anyway and leave the call in place. Your typecheck goes green once it lands. Re-read `src/story/voice.ts` before relying on it.

**1. Sound.**
- Give the player's Stage a `StageAudio`, the same way the in-app replay does, so the crayon scratch and page flips play. Start sound only from the first tap: the share page already starts playback from a tap (`onFirstPlay`). iOS Safari blocks sound that isn't started by a tap.
- The voice stays behind its consent gate: the server stores a voice only for a paying or comped device whose grown-up turned on sharing with voice (`apps/web/server/shares.ts`). That gate is the COPPA consent, so don't loosen it. The voice upload from an iPhone is storytime's fix (AAC fallback in `renderVoiceFile`). Your part: when a share has voice, it plays in step.

**2. Portrait phones (the real fix Sal asked for).** At 390–440 px wide, held upright:
- The picture (the 160x100 paper, 8:5) spans the content width with the 16 px side gutters and nothing else beside it. Drop the book chrome around it (cover, spine rings, extra padding) at that width; keep it on wider screens.
- The heading drops to about 28 px, at most two lines, above the picture.
- Subtitles move from over the drawing (they cover it at this size) to a line under the picture, at least 18 px.
- The play button is big and centred on the picture. "Watch it again" and the App Store button sit right under the subtitles. The first screen shows heading, picture and play without scrolling.
- Landscape phones, iPad and desktop look as they do now, or better.
- Check it at 390x844, 430x932, 844x390, 1024x1366 and 1440x900 with `bx` (real Chrome, device metrics). Look at every shot at full size before reporting.

**Facts.** Local dev: studio `bun run dev:hosted` (7711); website + API `cd apps/web && DATABASE_URL=postgresql://postgres@localhost:5432/onceupon_voice PORT=7720 bun server.ts` (check `apps/web` README/cliffnotes for how the site and `/app/` are served locally). **Always pass that DATABASE_URL: `apps/web/.env` is PRODUCTION.** Make test shares in the local DB (comp the local device to test a voiced share). `player=tutorial` is a bundled demo record with no server round trip. Stop every server and browser tab you start. No `any`, no papering `as`; `bun run typecheck` (root) and `cd apps/web && bunx tsc --noEmit` green before every ready line. Visual rules: no eyebrows, no taglines or helper text, no periods in headings.

**Steps.** (1) Layout. Commit, then report `ready share layout <sha>` with the shot paths (absolute). (2) Sound + primeAudio wiring. Commit and report. (3) When storytime lands story time, play a voiced share end to end and report what you heard on the readout (you can't listen: use the page's AudioContext state + a recorded-tab loudness readout).

**Don't.** Push; loosen the voice consent gate; touch production data; print a key; change the landing hero's look.

**Report** (≤ 10 lines): `ready share <step> <sha>`, absolute shot paths, doubts.

## Standing answers
- (2026-11-05, lead) `primeAudio()` landed in ab32bb3 (src/story/voice.ts). It unlocks the one shared playback AudioContext in src/engine/audio.ts (`playbackContext()`), which `CrayonAudio.start()` now uses too, so a CrayonAudio on the share Stage sounds after the same tap. Applies to: share.
