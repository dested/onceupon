# Brief: reshoot (opus-high), store shot 04 and the review demo without "Save video"

**Goal.** Sal dropped Save video (2026-11-05: "just share the link, fuck the mp4"). It's gone from the live studio (d78bc47). Two store screenshots and the review demo still show the old closing card with a "Save video" button, and App Review compares them with the app. Reshoot those two shots and re-record the demo from the live app, with the same look and the same steps as before.

**Read first.**
- `/w/code/onceupon-f/plans/2026-11-04-launch-1-0/brief-release.md`: steps 3 and 4 and every Standing answer. Same rules, sizes, status bar, sims and order.
- `/w/code/mac-mini/cliffnotes.md`: the agent contract, `onscreen`, Device Hub.
- `apps/mobile/scripts/mini/README.md`.
- `store/review/notes.md`: current; the Save video line is gone and the steps are unchanged.

**Do.**
1. Wait until the live studio has no Save video: `curl -s https://onceupon.dested.com/app/ | grep -c 'Save video'` prints 0. The deploy of d78bc47 is running.
2. Reshoot `store/screenshots/iphone-6.9/04-the-end.png` (1320x2868) and `store/screenshots/ipad-13/04-the-end.png` (2752x2064 landscape).
   - Same story ("A purple dragon named Pickles flew over a castle on a hill." then "The End") and same framing as the current files.
   - The closing card now reads "Play it again", "Send to grandma", "New story".
   - Use the Release sim app already installed from the build-2 binary (8912f86). **No new build**: the studio is hosted. If the app is gone from the sims, reinstall it from the existing archive or .app in `~/scratch/squiggletale/`; ask the lead before building anything.
3. Re-record `store/review/demo.mp4` exactly as before: brief-release.md step 4 and its Standing answers, the notes' "Main review flow" 1–9 with captions in the notes' words, under 2.5 minutes, iPhone 18 Pro Max sim.
4. Look at both PNGs at full size and watch the demo (contact sheet) before reporting: no "Save video", no error notes, no debug UI.

**Owns.** `store/screenshots/iphone-6.9/04-the-end.png`, `store/screenshots/ipad-13/04-the-end.png`, `store/review/demo.mp4`, scratch `/w/junk/onceupon-f/reshoot/` and `~/scratch/squiggletale/` on the mini. Commit only with `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (reshoot)" <paths>`.

**Mini etiquette.**
- Another session (`taste1`) holds the build lock and has a sim (`taste-0`) booted. Leave both alone.
- Screenshots and recordings need no build, so they don't need the lock. If you must build, wait for the lock.
- Boot only the sims you use, and shut them down when done.
- No macOS settings.
- Each sim makes a fresh production device: list each device code and id prefix in your report.

**Don't.** Upload to App Store Connect (the lead does); push; print a key; touch other projects' sims or files.

**Report** (≤ 10 lines): `ready reshoot <sha>`, absolute Windows paths of the three files, test devices made, doubts.

## Standing answers
