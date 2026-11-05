# Brief: assets (opus-high), store preview, hero video, vertical cuts, custom product pages, Apple Ads plan

**Goal.** Marketing assets that show what Squiggletale does in seconds: a child tells a story out loud and the crayon draws it. Sal (2026-11-04): "we need ads too. and assets. showing off how cool this is." He picked Apple Ads only (no ad SDKs in a Kids app), $20/day, US only, and all four assets. **Sample first:** build only step 2 (the iPhone preview), report, and wait for `pass sample` before anything else. Sal approves the sample himself.

**Read first.** `/w/code/onceupon-f/cliffnotes.md`, `ui.md`, `features/mp4-export.md`, `verify.md` (export-check, fake shell), `scripts/author-tutorial.ts` (authors a StoryRecord with the real ops dialect), `src/backend/dev-shell.ts` (`window.__fakeShell`: `say`, `cfg`, `calls`), the `bx` skill. Store shots for the look: `W:\code\onceupon-f\store\screenshots\iphone-6.9\` and `ipad-13\`.

**Owns.** `store/marketing/**` (final assets + `store/marketing/README.md` listing each file, its spec and source), `store/ads/**` (Apple Ads plan and scripts), `scripts/marketing/**` (new, pipeline scripts), scratch `/w/junk/onceupon-f/assets/`. Nothing in `src/**`, `apps/**`, `packages/**`: if the app needs a hook, send the lead the exact lines. Commit only with `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (assets)" <paths>`. Raw captures stay in scratch; commit only finished files.

**Facts.**
- The app is the hosted studio in a WebView. The same studio runs in Chrome with `?shell=native&fakeshell=1`, and `__fakeShell.say(text)` feeds recognised words as native speech would. Local dev: studio `bun run dev:hosted` (7711), API `cd apps/web && DATABASE_URL=postgresql://postgres@localhost:5432/onceupon_voice PORT=7720 bun server.ts`. **Always pass that DATABASE_URL: `apps/web/.env` points at production.** Stop every server you start.
- Drawings: use the "With minutes" tier (the one buyers get) so the pictures are the app's best real output. Comp the local device in the local DB if needed. Never re-roll for a picture that the sentence doesn't describe; pick sentences the drawing honours (counts are not honoured: no "three fish").
- Voice: a child's voice telling the story, ElevenLabs **`eleven_v4`** only (key in `.env`, never print it; `keys` skill). Candidates from the voice test: teddy `XjGYkUkzth8BPs29fmcV`, candy `Nggzl2QAXh3OijoXD116` (samples in `W:\junk\onceupon-f\voice-clips\`); use one US-sounding kid voice for everything and say which. Use the with-timestamps endpoint so words can be fed to `__fakeShell.say` in sync.
- The app's own sounds (crayon scratch, page flip: `src/engine/audio.ts`, `renderAudioCues`) are the soundtrack, under the voice. No music, no voiceover beyond the child.
- Honesty: every frame is the real app, or the app's own replay/export render. Words on screen match the words spoken. No fake reviews, no ratings, no "AI" hype, never "Claude", "Anthropic", "Haiku", "Sonnet". Don't claim it works offline (new stories need the internet).
- Text overlays: at most 4 words each, in the app's scrawl hand, no period at the end, at most one per scene. Examples: "Tell a story out loud", "The crayon draws it", "Watch it again". No eyebrows, no taglines under them.

**Steps.**
1. Three stories, one per theme (these become the custom product page themes): dragons and castles, bedtime (owl, moon, stars), ocean (turtle, fish). 2–3 short sentences each, the way a 6–8 year old talks, ending "The End". Make the voice clips. Write them in `store/marketing/stories.md`.
2. **Sample: iPhone App Store preview.** Check Apple's current app preview specs (WebFetch developer.apple.com, App Store Connect help, "App preview specifications") for iPhone 6.9" (expected 886x1920 portrait, 15–30 s, H.264 30 fps, AAC). Capture: Chrome via `bx` at the iPhone 6.9" viewport, fake shell, the child's audio playing while `__fakeShell.say` feeds the words at their timestamps; record with `bx record` (or CDP screencast) at full device pixels. If the studio's own voice capture can't hear the clip, author the record with the clip as its voice so Replay plays it. Edit with ffmpeg (or Remotion if it's clearly better): open on the mic tap and the first line drawing, the crayon finishing, "The End", a moment of replay, the shelf. Mix the child's voice with the app's sounds. Save `store/marketing/preview-iphone-6.9.mp4`, plus a 3×3 contact sheet PNG next to it. Watch it at full size before reporting.
3. (After `pass sample`) iPad 13" landscape preview from the same stories (expected 1600x1200).
4. Hero video, 30–60 s, 1920x1080: the three stories told out loud, the replay with the child's voice, "Send to grandma", using the app's mp4 export render (`scripts/export-check.mjs`) for full-picture moments. `store/marketing/hero-1080p.mp4`.
5. Vertical 9:16 cuts (1080x1920), 3 of them, one per story, 10–20 s each, cut from the hero footage. `store/marketing/vertical-<theme>.mp4`.
6. Custom product pages: one per theme. For each: 3 iPhone 6.9" and 3 iPad 13" landscape screenshots in the store-shot style (real screens, 9:41 status bar on device shots), promo text (≤ 170 chars). Check in Apple's docs whether a page can be created before the app is live; write the payloads and an `apply` step but **don't create anything in App Store Connect** (the store lane owns ASC writes).
7. Apple Ads plan, `store/ads/plan.md`: one Search Results campaign, US, $20/day. Ad groups per theme, mapped to the matching custom page, plus one broad group (parents searching for kids' story, drawing and bedtime apps). Exact and broad keywords, negatives, starting CPT bids with a reason each, and what to watch in the first week (CPT, tap-through rate, cost per install). Check whether an Apple Ads API credential exists (`keys` CLI, fingerprints only). **Create no campaign**: the app isn't approved yet, and the lead launches it.

**Done when.** Each file exists at its spec, has been watched or looked at in full, is listed in `store/marketing/README.md`, and is committed; the plan is written; no servers or browser tabs left running.

**Don't.** Write to App Store Connect or Apple Ads, spend money, touch app code, push, print a key, use a voice model other than eleven_v4.

**Report** (≤ 10 lines): `ready assets <step> <sha>`, absolute file paths, the voice used, doubts.

## Standing answers
