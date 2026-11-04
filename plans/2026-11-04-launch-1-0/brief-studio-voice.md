# studio-voice: opus-high · phase 3 · studio dev :7741 against a local server :7740 (DB `onceupon_voice`)

Re-read this file and the Standing answers + Phase 3 decisions in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** In the App Store build the voice is always honest and always recovers: only on-device ears, a parent says yes once before any story words leave the device, every failure (denied permission, interruption, model download, engine error, relay error) shows the child a kind message and a way on, and nothing charges for a story that didn't draw.

**Read first.** /w/code/onceupon-f/cliffnotes.md and /w/code/onceupon-f/ui.md (follow ui.md exactly for the card and notes), /w/junk/onceupon-f/audit-studio.md (the S-ids below; its Fix lines are the default unless this brief says otherwise), /w/junk/onceupon-f/sim/report.md (R2, M2, M9, M10), /w/code/onceupon-f/packages/shared/src/api.ts and /w/code/onceupon-f/packages/shared/src/bridge.ts (contracts, lead-owned, committed edaed0c and the next lead commit).

**Decisions already made.**
- Ears (S-01, R2): when `APP_SHELL`, the only ears kind is `apple` (shell engines). No cloud, no `browser`/webkitSpeechRecognition, no `appleFailed` → `refreshEars()` fallback, no "Cloud" option. If no engine can run, show the not-allowed / can't-hear message below; typing still works. Web (not shell) keeps today's behaviour.
- Consent card (S-02, decision 8): new `src/ui/ConsentCard.tsx` with its own stylesheet `src/styles/consent.css` (ui.md look; the polish lane owns app.css). It shows on the first mic tap or the first typed submit, after the parental gate, before the mic permission prompt: gate → card → (mic) prompt. Copy, exact:
  - Title: "Before the first story"
  - P1: "To draw a story, Squiggletale sends the words your child says, as text, to our server, which asks Anthropic's Claude AI to turn them into a drawing."
  - P2 (shell): "Speech becomes words on this device. Recordings of your child's voice never leave it unless you share a story."
  - P2 (web, not shell): "Your browser turns speech into words."
  - P3: "Anthropic doesn't use these words to train its models and deletes them within 30 days."
  - Buttons: "I agree" (primary), "Not now". Link: "Privacy Policy" → `config.privacyUrl` through the existing gated external-link path.
  - "I agree": kv `aiConsent` = `{"v":1,"at":"<iso>"}` (key in `KV_KEYS`), `device.consent {aiConsent:true}`, then in the shell `speech.prepare` in the background (S-14), then continue the tap that triggered it. `aiConsent` replaces `micGateDone`: a device that passed the old mic gate still sees the card once.
  - "Not now": mic and typing stay off. The dock reads "A grown-up needs to say yes first" with a button "Ask a grown-up" (gate → the same card). Bookshelf, replays and the intro still work.
  - A server `consent_required` (consent withdrawn elsewhere, kv lost) shows the same "Not now" state.
  - Grown-ups gets a row "Drawing with AI": state "On" / "Off" and a button "Turn off" (or "Turn on" → the card). Turn off clears kv and sends `aiConsent:false`.
- Parental gate (S-06, P5): spelled-out multiplication, operands 6..9 × 3..9 ("What is seven times eight?"), numeric input, the 3-strikes close stays. On a 375×667 phone with the keyboard up the answer field and buttons stay visible.
- Permission denied (S-09, R2): `speech.error {code:'not-allowed'}` or `available:false` with permission denied → the dock and a note read "The crayon can't hear you yet. Ask a grown-up to turn on the microphone." with a button "Open Settings" (gate → `settings.open`). The meter stops; no minutes burn.
- Interruptions and engine errors (S-10 studio half, S-15): `speech.error` `interrupted` or `transcriber` after ready → stop, restart once quietly; if that fails, stop listening with the note "Tap the mic to keep going."
- Model download (S-14): no `speech.ready` 15 s after start → note "The crayon is learning to listen. This needs the internet the first time." Keep waiting to 60 s, then stop with "Try again in a moment." `speech.start` gets a 70 s bridge timeout, not the 10-minute interactive one.
- Races (S-11, S-17): a start while stopping chains after the stop resolves; `micStarting` is set at the top of `startListening`, one start in flight.
- Coach (S-12): drop recognizer results from a coach clip's start to its end + 500 ms. Coach lines and timings come from config (`silenceNudgeMs` 30 s, `silenceEndMs` 60 s after the server lane).
- Drawing errors (S-13, M10): on a relay `{k:'error'}` retry once when the code is `upstream`; if it still fails, the note reads "Oops, the crayon slipped. Say that part again?" and the dock invites the mic as today. `consent_required` → the consent state above. Pass the director's real `restart` flag through `src/backend/relay-provider.ts` (V-12).
- Unfinished purchases (V-16 studio half): at boot in the shell, `iap.pending` → `iap.verify` each → `iap.finish` each that credited or was already credited (`already_used`); log failures, never block boot.
- Minutes chip (M2): show the freshest of `remainingSec` and `balanceSec` (whichever was updated last), never a stale `remainingSec`.
- Registration failure (M9): retry with backoff (1 s, 3 s, 10 s, then every 30 s); a non-network error shows "Can't reach the crayon right now. Trying again…" instead of the offline message.
- Grown-ups (S-18, S-04, S-27, S-29): when `APP_SHELL`, remove the Ears select and the "Microphone & sound" button (keep "Crayon sounds"), hide the gift-code and family-code sections. "this iPad" → "this device". The shared-stories list shows the story title, not the id. "Buy minutes" closes Grown-ups before opening the paywall and passes "already gated" so the paywall's Buy doesn't gate a second time.
- StoryScreen copy (S-27, P1): delete the taglines "A little voice. A whole lot of magic.", "A blank page. Endless possibilities." and "every story is a little adventure"; the "✳" doodle gets U+FE0E (text presentation); the "Made by you" chip shows only after the first stroke. Typed sentences without end punctuation get a period before the next one (session.ts `typeWords`).
- Canvas label (S-36 half): the story canvas `aria-label` becomes the scene summary after each beat.
- AdServices attribution (S-07): on hold, Sal is deciding on ads. Leave the boot call as it is.

**Owns.** `/w/code/onceupon-f/src/story/**`, `/w/code/onceupon-f/src/speech/**`, `/w/code/onceupon-f/src/backend/**`, `/w/code/onceupon-f/src/boot.ts`, `/w/code/onceupon-f/src/llm/director.ts`, `/w/code/onceupon-f/src/tutorial/coach.ts`, `/w/code/onceupon-f/src/ui/StoryScreen.tsx`, `/w/code/onceupon-f/src/ui/ParentArea.tsx`, `/w/code/onceupon-f/src/ui/ParentGate.tsx`, `/w/code/onceupon-f/src/ui/SettingsPanel.tsx`, `/w/code/onceupon-f/src/ui/MinutesChip.tsx`, `/w/code/onceupon-f/src/ui/hosted.ts`, new `/w/code/onceupon-f/src/ui/ConsentCard.tsx`, new `/w/code/onceupon-f/src/styles/consent.css`, scratch `/w/junk/onceupon-f/voice/`. Nothing else. `packages/shared/**` and the cliffnotes kit are the lead's: send exact lines. `src/styles/app.css` is studio-polish's: if you need a rule there, send it the lead.

**Sample first.** Item 1 is the consent card flow (gate → card → mic, "Not now" state, Grown-ups row). Commit it and send `ready studio-voice consent <sha>` with bx screenshots at 390×844 and 1180×820 in `/w/junk/onceupon-f/voice/`. The lead shows Sal before the rest of the studio work fans out; carry on with the next items meanwhile.

**Done when.**
- Root `bun run typecheck` exits 0 and `bun scripts/tracker-check.ts` still passes.
- Checked in bx on the hosted build against your local server: consent flow, "Not now" state, Turn off, gate, a forced relay error (note + no charge), a forced `not-allowed` and `interrupted` (fake the bridge events through `window.__onceupon` or a dev hook), registration retry.
- Your dev servers are stopped.

**Don't.** Push or deploy. Touch server, shell, app.css, Paywall, VideoExport, export, Replay, Bookshelf or ShareCard files (studio-polish), or model plumbing (model-bench). Add dependencies without asking. Decide product questions: ask with a recommendation.

**Commits.** `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (studio-voice)" <your paths>`, one per item group.

**Report** (≤ 10 lines, per ready): `ready studio-voice <item> <sha>`, what was verified, screenshots (absolute paths), anything left, questions with recs.
