# Brief: sim-verify (opus-high), live build 94affe8

**Goal.** Prove the phase-3 build that is now live in production (94affe8, deployed 2026-11-04 22:21 UTC) works end to end in the mini's simulators. Do it before anything goes to TestFlight.

**Read first.** /w/code/onceupon-f/plans/2026-11-04-launch-1-0/brief-sim-tester.md: its Setup, Owns, Evidence and Don't sections apply unchanged (build lock, `onscreen`, Device Hub, ~/scratch/squiggletale/, no macOS settings, no output-device toggles). /w/code/onceupon-f/cliffnotes.md and /w/code/onceupon-f/verify.md for the flows.

**Build.** The lead has pushed 94affe8 to `mini:repos/squiggletale.git` master. Build with `apps/mobile/scripts/mini/sim-build.sh` (sync on, studio on), Release, for the iPhone 18 Pro and the iPad Pro 13-inch (M5) simulators. The bundled studio.html is already committed at 94affe8; sync-studio regenerates the same file.

**Devices.** iPhone 18 Pro and iPad Pro 13-inch (M5). A fresh keychain gives a fresh production device with the 300 s free first story. Every device you create is a test device: list its 8-character code and id prefix in the report.

**Checks (each: pass / bug / not testable + why, with a screenshot path).**
1. Fresh install → the consent card. Its text names no AI vendor ("a third-party AI service"). Allow → the first story draws (free minutes, so the fast crayon).
2. Silence (Whistle via BlackHole): play clips 1-2, then 30 s of nothing. The minutes chip may drop at most about 10 s during the silence (the meter stops counting after 8 s of quiet); at 30 s the nudge "all done? just say "The End"" shows; at 60 s the story ends with "All quiet…".
3. Chip vs server: during a spoken story, the chip and `device.state` agree within one 15 s beat. Read device.state through the bridge or the Grown-ups area, whichever you used before.
4. Out of minutes before anything is drawn (use a device at 0 or burn it down first): no new card on the shelf; the closing card shows "More minutes" and "New story" only (no Play it again, Send to grandma or Save video).
5. Paywall (Grown-ups → Buy minutes, through the gate): the owl drawn twice, captioned "owl", labels "Free" and "With minutes"; Restore purchases, Privacy, Terms; no gift-code link; Privacy and Terms go through the gate. Do not buy.
6. Save video from the closing card and from a replay: it finishes, or fails within about 10 s with "Couldn't make the video. Try again later."; Cancel works at 0%.
7. Replay: words show once (subtitles at the bottom, no top caption), "Play again", no counter. A night-sky story ("an owl sat in a tree under the stars, the end") ends with light "The End" lettering.
8. Typing tray open: the subtitles sit above it.
9. Ears list on the simulator: Apple dictation (sfspeech) is not offered where it can't start.

**Report file.** /w/junk/onceupon-f/sim/verify-94affe8.md, screenshots in /w/junk/onceupon-f/sim/verify-94affe8/. Findings with severity (review-blocker / 1.0-must / polish).

**Owns.** The same as brief-sim-tester.md. You commit nothing unless a mini script needs a fix (then `apps/mobile/scripts/mini/**` only, through commit-paths.sh).

**Done when.** All 9 checks have a result on both devices, the report exists, the sims are shut down, the lock is free, nothing is running.

**Report** (≤ 10 lines): `ready sim-verify <one-line result>`, counts by severity, the worst three, the new test devices, every path absolute.
