# Brief: release (opus-high), the 1.0.0 App Store build, screenshots and demo

**Goal.** A signed Squiggletale 1.0.0 build uploaded to App Store Connect and processed (VALID), plus the store screenshots and the review demo video, all from the one sha the lead names. Sal: "rebuild on the mac mini and submit".

**Read first.**
- `/w/code/mac-mini/cliffnotes.md`: the signing section (`signing xcodebuild qg …`, archive, `app-store-connect` export with `destination upload`, `signing api`), the agent contract, `onscreen`, Device Hub.
- `/w/code/mobile-game-2/apps/mobile/scripts/mini/archive.sh` and `export-upload.sh`: the reference to copy (same team, verified uploads).
- `/w/code/onceupon-f/apps/mobile/scripts/mini/README.md`, `sim-build.sh`, and `brief-sim-tester.md` (Setup, Evidence, Don't apply unchanged: build lock, no macOS settings, no output-device toggles, ~/scratch/squiggletale/).

**Owns.** `apps/mobile/scripts/mini/**` (commit only through `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (release)" <paths>`), `store/review/demo.mp4`, `store/screenshots/**`, scratch `/w/junk/onceupon-f/release/` and `~/scratch/squiggletale/` on the mini. Nothing else in the repo: if `apps/mobile/app.config.ts` or anything else needs a change, send the lead the exact lines.

**Facts.**
- Team `qg` (QuickGame World Inc). App Store Connect app id 6815029998, bundle `com.quickgame.squiggletale`, version 1.0.0 (the store lane changes ASC's "1.0" to "1.0.0").
- Build number: one more than the highest build already in App Store Connect for this app (none yet → 1). Set it in the mini clone's generated iOS project or through `CURRENT_PROJECT_VERSION`/Info.plist at archive time. Never commit build-number churn.
- The lead is excluding `whistle-ears` from the binary (autolinking exclude) and syncing the studio bundle. A prebuild is needed when the Expo fingerprint changes.

**Steps.**
1. Now: write `archive.sh` and `export-upload.sh` for this app modeled on mobile-game-2's. Prove signing with a dry run: archive mini master as it is (no upload). Report `ready release dry-run <sha> <archive ok/fail>`.
2. Wait for `go <sha>` from the lead (it lands as master in `mini:repos/squiggletale.git`). Archive that sha, export with `destination upload`, then poll `signing api qg GET /v1/apps/6815029998/builds` until the build is VALID. Report `ready release build <n> <sha> VALID`.
3. Screenshots of that same build (Release sim build, `sim-build.sh`):
   - iPhone 6.9" (iPhone 18 Pro Max, 1320×2868) and iPad 13" (iPad Pro 13-inch (M5), 2064×2752), portrait, `xcrun simctl status_bar <dev> override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`. If App Store Connect's required iPhone slot is another size (check the screenshot display types), shoot that size too.
   - Five per device, in this order, real screens, no captions or frames:
     1. A story mid-drawing with subtitles: type "A purple dragon named Pickles flew over a castle on a hill." in the typing tray.
     2. A night page: "An owl sat in a tree under the stars and the moon."
     3. A bright sea page: "A little turtle swam in the blue sea with three happy fish."
     4. The closing card after typing "The End" ("Look what you imagined!").
     5. The bookshelf with the three stories.
   - Also one IAP review screenshot: the paywall on the iPhone 6.9" (Grown-ups → Buy minutes, through the gate). Do not buy.
   - The sims have no working ears (no Whistle in the binary, sfspeech fails on the simulator), so stories are typed. Fresh keychain → a fresh production device with the free story; list every device code and id prefix you create.
   - Save to `store/screenshots/iphone-6.9/01-…png` … and `store/screenshots/ipad-13/…`, the IAP shot as `store/screenshots/iap-paywall.png`. Look at each one at full resolution before reporting: nothing cut off, no debug UI, no error notes.
4. Demo video: once the lead says `notes ready`, record that build on the iPhone 18 Pro Max sim walking `store/review/notes.md` step by step, in order (`xcrun simctl io <dev> recordVideo --codec=h264`). Caption each section with ffmpeg `drawtext` using the notes' own step words, one caption per step, no audio, under 2.5 minutes. Save `store/review/demo.mp4`.

**Done when.** Build VALID in App Store Connect, screenshots and demo committed, sims shut down, build lock free, nothing running.

**Don't.** Submit for review, write App Store Connect metadata (the store lane owns every ASC write except the build upload), push, touch macOS settings or other projects, print any key.

**Report** (≤ 10 lines): `ready release <step> <sha> <result>`, build number, file paths (absolute), test devices, doubts.

## Standing answers

- (2026-11-04, lead) `go 7528524`: archive + upload that sha. Screenshots (step 3) wait for `shots go` from the lead (fx is changing "The End" placement; it reaches the app through the hosted studio deploy, not the binary). Applies to: release.
- (2026-11-04, lead) pass e6445f9. Notes ready (store/review/notes.md, fc67c70): demo follows "Main review flow" 1–9; step 5 typed through the keyboard button, captioned "5. Say a story (typed here: the Simulator has no microphone)"; purchases shown via "..." → "Grown-ups" → gate → "Buy minutes" → close. Applies to: release.
- (2026-11-04, lead) `go 8912f86`: build 2. EAS Update is off (`updates.enabled: false`, `checkAutomatically: 'NEVER'`), so the fingerprint changed: prebuild. If archive.sh CHECKs the production channel in Expo.plist, change that CHECK to `EXUpdatesEnabled` false (you own the script). Build 1 is not submitted: if its upload is still running, let it finish; don't wait for it. Screenshots and the demo come from build 2. Applies to: release.
- (2026-11-04, lead) `shots go`: fx is live (abe015c deployed; the hosted studio has The End placement + white snow). Shoot from the build-2 binary (8912f86) on the sims. Order: store/screenshots/iap-paywall.png first (store is blocked on it), then iphone-6.9/ and ipad-13/, then the demo. Report each as it lands so store can upload. Applies to: release.
- (2026-11-04, lead) `go 580d0bf`: build 3. NSPhotoLibraryUsageDescription comes from expo-media-library's `photosPermission` (PHOTOS_ADD_USAGE), not infoPlist; add a CHECK in archive.sh that the archived Info.plist has it. Screenshots stay on the 8912f86 sim build. Applies to: release.
