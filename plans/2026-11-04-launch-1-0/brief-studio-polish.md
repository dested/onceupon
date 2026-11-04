# studio-polish: opus-high · phase 3 · studio dev :7751 (server :7750, DB `onceupon_polish`, only if you need hosted flows)

Re-read this file and the Standing answers + Phase 3 decisions in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** Every screen a reviewer or parent sees looks finished on iPhone and iPad: a compliant paywall, a gated video share, an export that finishes or fails cleanly, a replay that matches the studio, phones that fit, and no taglines or claims. Follow /w/code/onceupon-f/ui.md exactly.

**Read first.** /w/code/onceupon-f/cliffnotes.md, /w/code/onceupon-f/ui.md, /w/code/onceupon-f/features/mp4-export.md, /w/junk/onceupon-f/audit-studio.md (the S-ids below; its Fix lines are the default unless this brief says otherwise), /w/junk/onceupon-f/sim/report.md (M5, M6, P3, P4, P5), the screenshots each finding cites under `/w/junk/onceupon-f/studio-shots/` and `/w/junk/onceupon-f/sim/`.

**Decisions already made.**
- Video export, gating (S-03): when `APP_SHELL`, `gate()` runs before the export starts (it can raise the Photos prompt) and before "Share". The web build is unchanged.
- Video export, robustness (M6): every wait loop in `src/export/mp4.ts` checks the abort signal, so Cancel works at any point. No encoder output for 10 s → stop and show "Couldn't make the video. Try again later." with a "Close" button. If `AudioEncoder` can't do AAC (`isConfigSupported`), export the video with no sound rather than Opus-in-mp4 (S-31); log it in the debug report.
- Video look (S-30): `drawLogo()` draws the real app icon (`/w/code/onceupon-f/apps/mobile/assets/icon.png`, copied to a studio asset and imported through Vite so it inlines) instead of the text chip. The end card reads "Made with Squiggletale" with "squiggletale.com" (`BRAND.publicDomain`) under it. No "Made by you" tag and no page number on video frames.
- Paywall (S-23, M5, S-04, S-29, S-27): add "Privacy" and "Terms" links (config `privacyUrl` / `termsUrl`, through the existing gated external-link path) beside "Restore purchases". Delete the "Most popular" badge and the paywall subtitle tagline. Under 500 px wide, pack tiles become compact one-row tiles so Buy and Restore sit above the fold at 375×667. Hide "Redeem a gift code" when `APP_SHELL`. Escape closes the paywall. Accept an "already gated" open option from Grown-ups (studio-voice passes it) so Buy doesn't gate twice (P4).
- Share card (S-08): delete the "Who made it?" field; `share.create` sends `childName: null`.
- Phones (S-21, S-22, P5): iPhone is portrait-only in the shell; these rules are for the web and iPad split views. Under `max-height: 480px`: hide the welcome subcopy and the status pill, cap subtitles to one line during the finale, icon-only action buttons. Under 380 px wide hide the wordmark, and keep it on one line when the minutes chip turns coral.
- Typing tray (S-24): subtitles sit above the tray while it is open.
- Intro (S-25, P3): on portrait phones size the intro book to the picture's 16:10 aspect; stars on page 2 stay inside the sky band. Re-roll intro page 1 (the dragon's wing) with `bun scripts/author-intro.ts 1` (it spends API money: under $1; report the cost) and commit the new drawing only if the wing is attached; otherwise report it.
- Replay (S-26): the studio's book frame; no caption pill during the finale; the button reads "Play again"; drop the "4/4" counter.
- Copy (S-27): Bookshelf "Our stories" → "My stories". Remove any remaining taglines in your files (StoryWelcome included).
- Tap targets (S-28): 44×44 minimum hit areas for the Grown-ups close button, the text links (Restore purchases, Copy, Privacy, Terms, Support, Delete my data), checkboxes, the minutes chip and the phone keyboard button, by padding, without changing their look.
- Accessibility (S-36, S-37): `aria-live="polite"` on the subtitle words; the Stage honours `prefers-reduced-motion` (no idle breathing, no particle fx; page turns become a cut).
- Out of scope: the bundle-size work (S-19) waits until both studio lanes land; StoryScreen, ParentArea, ParentGate and the consent card are studio-voice's.

**Owns.** `/w/code/onceupon-f/src/ui/Paywall.tsx`, `/w/code/onceupon-f/src/ui/VideoExport.tsx`, `/w/code/onceupon-f/src/ui/ReplayScreen.tsx`, `/w/code/onceupon-f/src/ui/Bookshelf.tsx`, `/w/code/onceupon-f/src/ui/ShareCard.tsx`, `/w/code/onceupon-f/src/ui/Subtitles.tsx`, `/w/code/onceupon-f/src/ui/StoryWelcome.tsx`, `/w/code/onceupon-f/src/ui/bits.tsx`, `/w/code/onceupon-f/src/export/**`, `/w/code/onceupon-f/src/styles/app.css`, `/w/code/onceupon-f/src/tutorial/IntroScreen.tsx`, `/w/code/onceupon-f/src/tutorial/intro.css`, `/w/code/onceupon-f/src/tutorial/intro.ts`, `/w/code/onceupon-f/src/tutorial/intro-slides.json`, `/w/code/onceupon-f/src/engine/stage.ts`, `/w/code/onceupon-f/src/engine/fx.ts`, new studio asset files for the logo, scratch `/w/junk/onceupon-f/polish/`. Nothing else. studio-voice may send you CSS rules through the lead; apply them as given.

**Done when.**
- Root `bun run typecheck` exits 0; `node scripts/export-check.mjs` passes (see /w/code/onceupon-f/verify.md) and an exported mp4 shows the icon and the end card (look at frames).
- bx screenshots of paywall, replay, welcome, intro, share card and the export progress at 375×667, 390×844, 1180×820 and 820×1180 in `/w/junk/onceupon-f/polish/`, each looked at by you.
- Your dev servers are stopped.

**Don't.** Push or deploy. Touch studio-voice, server, shell or model files. Add dependencies without asking. Decide product questions: ask with a recommendation.

**Commits.** `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (studio-polish)" <your paths>`, one per item group.

**Report** (≤ 10 lines, per ready): `ready studio-polish <item> <sha>`, what was verified, screenshot paths, anything left, questions with recs.
