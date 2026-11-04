#!/bin/zsh
# Squiggletale's shell in Release for the iOS Simulator, ad-hoc signed (no Apple ID), on the Mac mini. For the app-review
# walk on the mini's iPhone and iPad simulators. Run it there, through onscreen so it shows on the screen:
#   ssh mini 'cd ~/code/squiggletale && onscreen --title squiggletale-sim --wait -- zsh apps/mobile/scripts/mini/sim-build.sh'
# Flags: --no-sync (build the checkout as it is), --no-studio (skip the offline studio rebuild),
#        --prebuild (force `expo prebuild --clean`; otherwise only when the native fingerprint changed).
# Lock owner text: OWNER=<who> (e.g. `onscreen -- env OWNER=sim-tester zsh ...`).
# Prints `SIM_APP <path> version <v> build <n>` on success; then sim-run.sh installs it.
set -euo pipefail
REPO=~/code/squiggletale
OUT=~/scratch/squiggletale
DD=$OUT/sim-dd
sync=1 studio=1 prebuild=0
for a in "$@"; do
  case $a in
    --no-sync) sync=0 ;;
    --no-studio) studio=0 ;;
    --prebuild) prebuild=1 ;;
    *) echo "sim-build: unknown flag $a" >&2; exit 64 ;;
  esac
done
mkdir -p $OUT

# 1. The commit: master from the mini's bare repo (pushed from WSL: git push mini:repos/squiggletale.git master).
cd $REPO
if (( sync )); then
  git fetch -q origin
  # -f: the last run's sync-studio rewrote the tracked assets/studio.html; it is regenerated below anyway.
  git checkout -q -f --detach origin/master
fi
echo "commit $(git rev-parse --short HEAD) $(git log -1 --format=%s)"

# 2. Deps, then the offline studio copy the shell bundles (assets/studio.html; never committed from here).
bun install --frozen-lockfile
(cd apps/mobile && bun install --frozen-lockfile)
if (( studio )); then
  (cd apps/mobile && bun run sync-studio)   # builds dist-hosted itself (VITE_API_ORIGIN = BRAND.origin), then copies it
fi

# 3. Native build, holding the mini's one-build lock (released on any exit).
if ! mkdir ~/code/.mac-build.lock 2>/dev/null; then echo "LOCK_HELD: $(cat ~/code/.mac-build.lock/owner)"; exit 1; fi
echo "squiggletale ${OWNER:-sim-build} $(date)" > ~/code/.mac-build.lock/owner
trap 'rm -rf ~/code/.mac-build.lock; echo LOCK_RELEASED' EXIT

cd $REPO/apps/mobile
export LANG=en_US.UTF-8 CI=1
# The native inputs: config, deps and the local Swift modules. Any change re-runs prebuild from clean.
fp=$( { cat app.config.ts package.json bun.lock; find modules -type f -print0 | sort -z | xargs -0 shasum; } | shasum | cut -c1-12)
if (( prebuild )) || [[ ! -d ios ]] || [[ "$(cat $OUT/.prebuild-fp 2>/dev/null)" != "$fp" ]]; then
  npx expo prebuild -p ios --clean
  echo "$fp" > $OUT/.prebuild-fp
fi
# arm64 only: Needle.xcframework (whistle ears) has no x86_64 simulator slice, so a two-arch generic
# simulator build skips copying it and the link fails with "library 'needle' not found".
# Ad-hoc signed ("-"), not CODE_SIGNING_ALLOWED=NO: an unsigned app has no entitlements, so expo-secure-store
# fails ("A required entitlement is not present"), the device never registers and the studio says offline.
caffeinate -dimsu xcodebuild -workspace ios/Squiggletale.xcworkspace -scheme Squiggletale -configuration Release \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath $DD \
  ARCHS=arm64 ONLY_ACTIVE_ARCH=NO CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= build | tee $OUT/xcodebuild.log | grep -E '^(error|warning: .*deprecated)|\*\* BUILD' || true
APP=$DD/Build/Products/Release-iphonesimulator/Squiggletale.app
grep -q '\*\* BUILD SUCCEEDED' $OUT/xcodebuild.log || { echo "BUILD FAILED: see $OUT/xcodebuild.log"; grep -E 'error:' $OUT/xcodebuild.log | head -20; exit 1; }
echo "SIM_APP $APP version $(plutil -extract CFBundleShortVersionString raw $APP/Info.plist) build $(plutil -extract CFBundleVersion raw $APP/Info.plist)"
