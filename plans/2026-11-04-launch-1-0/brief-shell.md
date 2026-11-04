# shell: opus-high · phase 3 · native builds on the mini in `~/scratch/squiggletale-shell/`

Re-read this file and the Standing answers + Phase 3 decisions in /w/code/onceupon-f/plans/2026-11-04-launch-1-0.md before every item and before asking.

**Goal.** The Expo shell is ready for a Kids Category review: true purpose strings, no unused permissions or SDKs, voice that survives calls, Siri, AirPods and engine resets, a Settings path when permission is denied, purchases that credit even after a crash, iPhone in portrait, and a bundled studio that can actually reach the server.

**Read first.** /w/code/onceupon-f/cliffnotes.md (apps/mobile row, the Apple ears Gotcha), /w/code/onceupon-f/apps/mobile/README.md, /w/code/mac-mini/cliffnotes.md (the agent contract, build lock, onscreen), /w/code/onceupon-f/apps/mobile/scripts/mini/README.md (sim-tester's build scripts: read, don't edit), /w/junk/onceupon-f/audit-studio.md (S-05, S-10, S-14, S-31, S-33, S-34, S-35), /w/junk/onceupon-f/audit-server.md (V-16, V-30), /w/junk/onceupon-f/sim/report.md (R2, R3, P2, P7), /w/code/onceupon-f/packages/shared/src/bridge.ts (contract, lead-owned, last change c627d5c).

**Decisions already made.**
- Contract (item 1, makes `cd apps/mobile && bunx tsc --noEmit` green): handlers for `settings.open` (`Linking.openSettings()`), `speech.prepare` (analyzer: start `AssetInventory` download/install for the locale with no prompt and no listening, resolve `{ready}`; sfspeech/whistle: `{ready:true}`), `iap.pending` (unfinished StoreKit 2 transactions as `{jws, transactionId, productId}`). Every `speech.error` emits a `SpeechErrorCode`: map Swift and expo-speech-recognition codes onto it (permission → `not-allowed`, everything unknown → `failed`). `speech.ts:171`: sfspeech with Speech Recognition denied emits `speech.error {code:'not-allowed'}` and answers `{available:false}`. Remove the handlers for `audio.mode`, `orientation.lock`, `review.request`, `notify.permission` (the contract dropped them).
- Purpose strings (S-05, R3), exact:
  - Microphone: "Squiggletale listens while your child tells a story so the crayon can draw it. Speech is turned into words on this device, and the recording stays on this device unless a grown-up shares the story."
  - Speech recognition: "Squiggletale turns your child's spoken story into words on this device so the crayon can draw it."
  - Photos (add only): unchanged.
- Remove (S-33): `expo-notifications`, `expo-store-review`, `expo-screen-orientation` (package.json, app.config plugins, handlers). `expo-secure-store` gets `{ faceIDPermission: false }`. Confirm after prebuild that the Info.plist has no `NSFaceIDUsageDescription` and the entitlements have no `aps-environment`. `NSLocalNetworkUsageDescription` / `NSBonjourServices` must not be in a Release build.
- Interruptions (S-10): in `OnDeviceEarsModule.swift` observe `AVAudioSession.interruptionNotification`, `routeChangeNotification` (old device unavailable, new device available) and `AVAudioEngineConfigurationChange`; on a stop emit `onError {code:'interrupted'}` then `onEnd`. Category options add `.allowBluetoothA2DP` and `.allowBluetooth`. Same for the Whistle runner only while Whistle is still in the build.
- iPhone portrait (Standing answer): iPhone supports portrait only; iPad keeps all four orientations. `requireFullScreen` stays (S-34).
- Splash (P2): the native splash stays up until the studio's `ready` bridge call, with a 20 s fallback. `expo-splash-screen` `imageWidth: 220` (not the tiny contain).
- WebView debugging (P7): `webviewDebuggingEnabled` only when `__DEV__` or `process.env.EXPO_PUBLIC_WEBVIEW_DEBUG === '1'` (sim-tester's builds will set it; store builds don't).
- Bundled studio (V-30): `/w/code/onceupon-f/scripts/sync-studio.ts` builds `dist-hosted` with `VITE_API_ORIGIN` = the BRAND origin no matter what local env files say, copies it to `apps/mobile/assets/studio.html`, and exits 1 if the output contains `localhost` or `127.0.0.1`. Run it once and commit the refreshed `studio.html` at the end, after the studio lanes have landed (the lead tells you when).
- WebCodecs AAC (S-31): nothing native unless sim-tester finds AAC missing in WKWebView; the studio-polish lane exports without sound in that case.
- On hold, don't touch: Whistle removal (S-35, waits for sim-tester's bake-off; the lead sends "whistle out" or "whistle stays"), AdServices attribution module (S-07, waits for Sal's ads answer), the domain (`BRAND` mirror in app.config.ts flips with the lead's domain move).

**Native builds.** You compile; sim-tester runs simulators. For a compile check: `git archive <your sha> | ssh mini 'mkdir -p ~/scratch/squiggletale-shell/src && tar -x -C ~/scratch/squiggletale-shell/src'`, then on the mini take `~/code/.mac-build.lock` (owner `shell`; wait if held, never break another owner's lock), `bun install`, `expo prebuild --clean -p ios`, `xcodebuild` for the iOS Simulator with `ARCHS=arm64` and ad-hoc signing (copy the flags from sim-tester's `sim-build.sh`), in a visible Terminal via `onscreen`, logs in `~/scratch/squiggletale-shell/`. Release the lock. Never push to the mini's bare repo (the lead pushes; sim-tester installs).

**Owns.** `/w/code/onceupon-f/apps/mobile/**` except `/w/code/onceupon-f/apps/mobile/scripts/mini/**`, `/w/code/onceupon-f/scripts/sync-studio.ts`, mini `~/scratch/squiggletale-shell/`, scratch `/w/junk/onceupon-f/shell/`. Nothing else.

**Done when.**
- `cd /w/code/onceupon-f/apps/mobile && bunx tsc --noEmit` and `bun test` exit 0.
- A simulator build of your last sha compiles on the mini (exit 0, log path in the report), and the prebuilt Info.plist shows the new strings, portrait-only iPhone orientations, no Face ID string, no aps-environment.
- The mini's build lock is released and your scratch builds are cleaned of DerivedData over 5 GB.

**Don't.** Push or deploy, `eas build`/`eas update`, touch simulators sim-tester is using, edit studio, server or shared files (send the lead exact lines), add dependencies without asking, use sudo or change macOS settings on the mini.

**Commits.** `bash ~/.claude/sal/bin/commit-paths.sh "<msg> (shell)" <your paths>`, one per item group.

**Report** (≤ 10 lines, per ready): `ready shell <item> <sha>`, check output with exit codes, build log path, anything left, questions with recs.
