# sim-tester: opus-high · Mac mini simulators · phase 1 (test and report, no source fixes)

Re-read this file and the Standing answers in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** Squiggletale's native shell runs in the mini's iPhone and iPad simulators, and every flow a parent, a child and an App Reviewer will touch has been walked, screenshotted and written up, so the lead can build the 1.0 fix list from evidence. Phase 1 finds problems; it does not fix app source.

**Read first.**
- /w/code/onceupon-f/cliffnotes.md (the whole thing; Gotchas on the bridge, Apple/Whistle ears, safe areas)
- /w/code/mac-mini/cliffnotes.md ("How agents use it", Maestro section: iOS Maestro is broken here; use `axe` instead, at /opt/homebrew/bin/axe on the mini: `axe describe-ui`, `axe tap`, `axe type`, `axe swipe`, `axe button`; `--udid <udid>`)
- /w/code/onceupon-f/features/launch-platform.md
- /home/dested/.claude/skills/app-review/SKILL.md, section "Checklist" (you are walking it)
- Reference scripts to copy: /w/code/mobile-game-2/apps/mobile/scripts/mini/sim-build.sh (and archive.sh, export-upload.sh, ExportOptions.plist for later phases)

**Decisions already made.**
- 1.0 ships in the Kids Category, on-device ears only (analyzer / sfspeech / whistle; never cloud), parental gate before links out, purchases and settings.
- The shell loads `https://onceupon.dested.com/app/?shell=native` (production, master at 6ea5ee6 or newer). A Drydock deploy of 6ea5ee6 started 2026-11-04 17:39 UTC; before testing, confirm the live studio has the Grown-ups "Ears" picker (`curl -s https://onceupon.dested.com/app/ | grep -c earsEngine` > 0). If not, set up the build and wait.
- The mini has no microphone. Sal is installing BlackHole (virtual audio device). Until the lead messages you that it exists, test everything except live voice, and record what the ears do with no input device. Once it exists: set it as the Mac's default input, play speech into it (`say -v Samantha -a <BlackHole device id> "..."` or `afplay` with the output device set to BlackHole), and run the voice matrix below.

**Setup (yours to decide inside these lines).**
1. On the mini: `git init --bare ~/repos/squiggletale.git`; from WSL `git -C /w/code/onceupon-f push mini:repos/squiggletale.git master`; clone to `~/code/squiggletale`. Never push anywhere else.
2. Hold the build lock (`~/code/.mac-build.lock`, owner file `squiggletale sim-tester <date>`) only while xcodebuild/prebuild runs, from a shell that outlives your ssh connection; release on failure too.
3. `bun install` at the repo root and in `apps/mobile` on the mini; `bun run build:hosted` + `cd apps/mobile && bun run sync-studio` so the bundled offline copy matches (do not commit it); `npx expo prebuild -p ios --clean` in apps/mobile; a Release simulator build, unsigned, modeled on sim-build.sh. Put your scripts at /w/code/onceupon-f/apps/mobile/scripts/mini/ (`sim-build.sh`, plus a `README.md` of one screen on how to run them) and commit only those with the helper.
4. Builds and long commands run visibly through `onscreen` (mini cliffnotes). Logs in `~/scratch/squiggletale/`.

**Devices.** iPhone 18 Pro, iPhone 17e (small), iPad Pro 13-inch (M5), iPad (A16) (the base iPad most kids use), iPad mini (A17 Pro). Portrait and landscape on each iPad; iPhone in both orientations the app allows. Boot with simctl, then `open -b com.apple.dt.Devices` so Sal sees them in Device Hub. Shut down what you boot when done.

**Walk (each on a fresh install, `xcrun simctl privacy <udid> reset all com.quickgame.squiggletale` where needed).**
1. Cold launch: splash, time to first interactive paint, the intro (5 pages, voice plays, Next/Back/swipe/skip).
2. Permissions: exactly when the microphone and speech-recognition prompts appear, their text, and what happens on Allow, on Don't Allow, and when re-entering after Don't Allow (is there a path to Settings? what does the child see?). Nothing may prompt at launch.
3. Parental gate: where it appears (first mic use, purchases, links, settings), whether it can be passed, how it looks on phone and iPad.
4. Typed story path end to end (works with no mic): drawing appears, subtitles, page turns, "The End" finale, the closing card, share card, bookshelf, replay, scrubber, delete.
5. Grown-ups area: every row, every link (does it open the in-app Safari sheet, behind the gate?), the Ears picker (which engines `speech.available` lists in the simulator), restore, gift redeem field, privacy/terms/support links (do they load?).
6. Money: the free allowance counting down, the sleepy paywall at zero (use typed stories to burn the free minutes), the three packs and what the StoreKit sheet does in the simulator (sandbox or local StoreKit; report exactly what happens; do not sign in to any Apple ID without asking the lead).
7. Video export: export from replay, the Photos permission prompt, the saved video (pull it with `simctl` and check that it plays, has the drawing, audio, the end card).
8. Lifecycle: background mid-story and return, kill and relaunch (story saved?), rotation mid-drawing, keyboard open on iPad and iPhone (typing tray), Dynamic Type at the largest size.
9. Offline: if you can cut the simulator's network (e.g. a pf rule is NOT allowed; try `networksetup` only if it needs no sudo, otherwise skip and say so), what the app shows.
10. Voice matrix (after BlackHole): for each engine the picker offers (analyzer, sfspeech, whistle): does the mic open, do words appear, how far behind speech, does drawing follow, does "The End" spoken end the story, what happens on a 30 s pause, an interruption (background/foreground while listening), and the replay with voice.

**Evidence.** Screenshots via `xcrun simctl io <udid> screenshot`, copied to /w/junk/onceupon-f/sim/<device>/<NN-step>.png. One contact sheet per device (ImageMagick `montage` on the mini if present, else skip). Short screen recordings (`simctl io recordVideo --codec=h264`) only for bugs that need motion.

**Report file.** /w/junk/onceupon-f/sim/report.md: a table per device of the walk steps (pass / bug / not tested + why), then a findings list. Each finding: severity (`review-blocker` = Apple would reject or the flow breaks; `1.0-must` = a parent would notice; `polish`; `1.1`), device + orientation, exact repro steps, the screenshot path, and your best guess at the cause with a file path if you can find it (read-only). Plus a "Not tested and why" section, and the exact build commands that worked.

**Owns.** Mini: `~/repos/squiggletale.git`, `~/code/squiggletale`, `~/scratch/squiggletale/`, the simulators you boot, the build lock while you hold it. Local: /w/junk/onceupon-f/sim/, /w/code/onceupon-f/apps/mobile/scripts/mini/** (new). Nothing else.

**Done when.** The app runs on all five simulators, every walk step has a result, report.md exists, the scripts are committed (`ready sim-tester <sha> ...`), the simulators are shut down, the lock is released, no background jobs remain.

**Don't.**
- Edit app source, config or assets in the repo (phase 1 is evidence only). If the build itself fails on a real defect, report it with the error and stop; ask the lead before working around it.
- `sudo`, macOS settings changes, deleting anything you did not create on the mini, other projects' folders, or the MacBook.
- Sign in to an Apple ID, buy anything, or touch App Store Connect.
- Push to GitHub or deploy.

**Report** (≤ 10 lines, to the lead): `ready sim-tester <sha> <one-line result>`, the count of findings by severity, the 3 worst, and what was not tested. Every path absolute.
