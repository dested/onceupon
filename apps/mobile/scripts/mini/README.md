# Mini simulator scripts

Squiggletale's Expo shell in Release on the Mac mini's iOS simulators (ad-hoc signed, no Apple ID). Rules for the
mini: `W:\code\mac-mini\cliffnotes.md`.

Once per mini: `git init --bare ~/repos/squiggletale.git && git clone ~/repos/squiggletale.git ~/code/squiggletale`.

From WSL:

```sh
git -C /w/code/onceupon-f push mini:repos/squiggletale.git master
ssh mini 'cd ~/code/squiggletale && git fetch -q && git checkout -q --detach origin/master && \
  onscreen --title squiggletale-sim --wait -- zsh apps/mobile/scripts/mini/sim-build.sh'
ssh mini 'zsh ~/code/squiggletale/apps/mobile/scripts/mini/sim-run.sh --fresh "iPhone 18 Pro" "iPad (A16)"'
ssh mini 'xcrun simctl io <udid> screenshot ~/scratch/squiggletale/shot.png'
ssh mini 'zsh ~/code/squiggletale/apps/mobile/scripts/mini/sim-run.sh --shutdown "iPhone 18 Pro" "iPad (A16)"'
```

- `sim-build.sh` checks out `origin/master` (unless `--no-sync`), installs deps, rebuilds the bundled offline
  studio (`--no-studio` skips it), runs `expo prebuild -p ios --clean` when app.config, deps or `modules/`
  changed (`--prebuild` forces it), then `xcodebuild` Release for the simulator, ad-hoc signed, under the mini's build lock.
  App: `~/scratch/squiggletale/sim-dd/Build/Products/Release-iphonesimulator/Squiggletale.app`; log:
  `~/scratch/squiggletale/xcodebuild.log`.
- `sim-run.sh` boots the named iOS 27.0 simulators, installs and launches the app, and opens Device Hub.
  `--fresh` uninstalls first and resets the mic, speech and Photos grants so the prompts show again.
- The shell loads the live studio, `https://onceupon.dested.com/app/?shell=native`; the bundled copy is only
  the offline fallback. Studio changes need a web deploy, not a rebuild.
- Drive the UI with `axe` (`axe describe-ui --udid <udid>`, `axe tap -x <x> -y <y> --udid <udid>`); Maestro's
  iOS driver doesn't start on Xcode 27 here.
