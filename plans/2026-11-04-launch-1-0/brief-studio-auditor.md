# studio-auditor: opus-high · phase 1 (read-only audit)

Re-read this file and the Standing answers in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** A ranked, evidence-backed finding list for the studio (`/w/code/onceupon-f/src/`), the native shell (`/w/code/onceupon-f/apps/mobile/`) and the shared contracts (`/w/code/onceupon-f/packages/shared/src/`), judged against shipping Squiggletale 1.0 in the App Store's Kids Category on iPhone and iPad. The lead turns it into fix briefs, so every finding must be concrete enough to brief from.

**Read first.** /w/code/onceupon-f/cliffnotes.md, /w/code/onceupon-f/ui.md, /w/code/onceupon-f/decisions.md, /w/code/onceupon-f/features/launch-platform.md, /w/code/onceupon-f/features/mp4-export.md, /w/code/onceupon-f/plans/2026-10-27-app-review-audit.md, /home/dested/.claude/skills/app-review/SKILL.md (Checklist + Kids).

**Decisions already made (audit against them).**
- Kids Category. Apple 1.3: no links out, purchases or "other distractions" except behind a parental gate; Kids Category apps may not send personally identifiable information or device information to third parties; no third-party analytics/ads. 5.1.2(i): disclose sharing personal data with third-party AI and get explicit permission first. 2.3.8: "For Kids" wording only in the Kids Category.
- Ears in 1.0: on-device only (analyzer, sfspeech, whistle). Cloud ears (OpenAI, Deepgram) must be unreachable in the store build.
- New 1.0 requirement: a one-time parent consent, behind the gate, before the first story's words go through our server to Anthropic's Claude.
- 1.0 is lean: fixes, heavy polish, finish the mp4. New drawing tools and the site rebuild are 1.1.
- The app's domain moves to squiggletale.com (from onceupon.dested.com).
- Voiceover/TTS rule: every voice the app plays must be ElevenLabs Eleven v4 (`eleven_v4` or `eleven_v4_turbo`). The intro and coach mp3s were made with OpenAI TTS (`scripts/render-coach.ts`): confirm and list them.

**Audit areas (cover every one; say "nothing found" where true).**
1. **Kids compliance in the hosted build:** every link, purchase, settings, mail, share and external navigation, and whether a gate guards it; every network destination the hosted studio and the shell can reach (grep URLs, fetch, WebSocket) and what data goes to each; AdServices attribution; whether any cloud-ears path is still reachable in hosted mode (store default, `settings.earsEngine` `cloud`, `apple-unavailable` fallback via `meter.refreshEars()`); share-with-voice consent; where the new Claude consent should sit in the flow (screen, copy draft, storage key, what happens on "No").
2. **Voice robustness ("the voice must always work"):** the full path from mic tap to words: permission request timing and denial handling, engine selection and fallback order, `speech.available` probing, engine failure mid-story, audio session conflicts (intro/replay playback vs the shell's mic, WebView audio), interruptions (call, Siri, background, route change, AirPods), restart after a pause, what the child sees in each failure, and whether the UI ever gets stuck in "one sec...". File and line for each gap.
3. **Hosted-build hygiene:** debug UI reachable by a child or reviewer (backtick debug panel, SpendChip, key/model settings, BYO-only screens like KeyGate), dev-only code shipped in `dist-hosted/index.html` (size it: `bun run build:hosted` then measure; which modules dominate), user-visible "Once Upon"/"onceupon" strings, `console.log`, TODO/FIXME, placeholder copy, "beta"/"coming soon", the lab or proto code in the bundle. Grep `dist-hosted/index.html` for `sk-` and key-like strings.
4. **UX and polish on phone and iPad:** run `bun run dev:hosted` (port 7711; it talks to the production API) or open https://onceupon.dested.com/app/ in bx at 1180x820, 820x1180, 1366x1024, 390x844, 844x390, 375x667. Look at every screen: alignment, wraps, safe areas, tap targets (48 px), contrast, the welcome state, subtitles, the paywall, the grown-ups area, the share card, bookshelf, replay. Screenshots to /w/junk/onceupon-f/studio-shots/. Use typed input only (a handful of short stories; it spends real minutes and a few cents). Follow ui.md for what "right" looks like.
5. **The mp4 export ("finish mp4"):** what is unfinished (the child's voice track? the end card logo is "a placeholder wordmark" per cliffnotes; branding on squiggletale.com), and what finishing means, with file paths.
6. **Store-review traps:** `requestReview` trigger timing (`apps/mobile/src/bridge/handlers/system.ts` and studio callers), notifications permission (must never auto-prompt; Kids apps should not ask at all), Restore Purchases placement, purpose strings in `apps/mobile/app.config.ts` (mic, speech, photos-add), unused permission plugins, `ITSAppUsesNonExemptEncryption`, iPad multitasking/orientation settings, the native modules shipped (whistle adds 17 MB: is it worth it?).
7. **Accessibility:** VoiceOver labels on the main controls, Dynamic Type behavior in the WebView, reduced motion.
8. **Cleanup candidates:** dead code, stale dialects/prototypes, unused deps in the root and apps/mobile package.json, stale git branches (`json-dsl`, `proto/dsl-rethink`, three `worktree-agent-*`), stray files. Mark each "safe to delete" or "keep, because".

**Output.** /w/junk/onceupon-f/audit-studio.md. Findings grouped by area, each with: id (S-01...), severity (`review-blocker` | `1.0-must` | `polish` | `1.1`), file:line (absolute path), what is wrong, the evidence (screenshot path, grep output, repro), and the concrete fix in one or two sentences (exact copy for any text). End with "Top 10 for 1.0" in priority order and a "Not checked and why" list. Under ~400 lines.

**Owns.** /w/junk/onceupon-f/audit-studio.md and /w/junk/onceupon-f/studio-shots/. Read-only everywhere else. `bun run build:hosted` writes `dist-hosted/` (gitignored), which is fine.

**Don't.** Edit repo files, commit, push or deploy. Install dependencies. Change settings on the production admin. Spend more than ~10 typed stories.

**Report** (≤ 10 lines): count by severity, the 5 worst with ids, the report path, and anything you could not check.
