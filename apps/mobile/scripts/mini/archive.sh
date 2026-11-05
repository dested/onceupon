#!/bin/zsh
# Squiggletale's App Store archive on the Mac mini, no EAS: the mini signs headlessly with `signing` (W:\code\mac-mini).
# Does what `eas build --profile production` would: prebuild from clean, the production update channel and the build
# number, then a signed Release archive. Prints CHECK lines; nothing is uploaded here (export-upload.sh does that).
#   ssh mini 'cd ~/code/squiggletale && onscreen --title squiggletale-archive --wait -- \
#     env BUILD=1 SHA=<sha> OWNER=release zsh apps/mobile/scripts/mini/archive.sh'
# BUILD must beat every build App Store Connect has for app 6815029998:
#   signing api qg GET '/v1/apps/6815029998/builds?limit=50'
# SHA (optional) fails the run unless origin/master is that commit. NO_SYNC=1 archives the checkout as it is.
# The build number and channel are written into the generated ios/ only, never committed. The committed
# assets/studio.html (the offline studio the lead synced at that sha) is what ships; it is not rebuilt here.
set -euo pipefail
BUILD=${BUILD:?set BUILD to the build number}
REPO=~/code/squiggletale
OUT=~/scratch/squiggletale
ARCHIVE=$OUT/Squiggletale-$BUILD.xcarchive
mkdir -p $OUT

# The lock first: sim-build.sh shares this checkout and its ios/. ARCHIVE_LOCK_HELD=1 means the run that
# re-exec'd us (below) already holds it.
if [[ -z ${ARCHIVE_LOCK_HELD:-} ]]; then
  if ! mkdir ~/code/.mac-build.lock 2>/dev/null; then echo "LOCK_HELD: $(cat ~/code/.mac-build.lock/owner)"; exit 1; fi
  echo "squiggletale ($BUILD) App Store archive (${OWNER:-agent}) $(date)" > ~/code/.mac-build.lock/owner
fi
trap 'rm -rf ~/code/.mac-build.lock; echo LOCK_RELEASED' EXIT

cd $REPO
if [[ -z ${NO_SYNC:-} ]]; then
  git fetch -q origin
  git checkout -q -f --detach origin/master
  # The checkout can replace this very script, and zsh keeps running the copy it started (build 4 ran 580d0bf's
  # CHECKs). Hand the lock to the synced copy and run that one instead.
  trap - EXIT
  exec env NO_SYNC=1 ARCHIVE_LOCK_HELD=1 zsh $REPO/apps/mobile/scripts/mini/archive.sh
fi
head=$(git rev-parse HEAD)
if [[ -n ${SHA:-} && $head != ${SHA}* ]]; then echo "WRONG_SHA HEAD is ${head:0:12}, wanted $SHA (push it as master first)"; exit 1; fi
echo "COMMIT $(git log --oneline -1 | cut -c1-90)"
git diff --quiet || { echo "DIRTY checkout:"; git status --short; exit 1; }

bun install --frozen-lockfile
cd apps/mobile
bun install --frozen-lockfile
export LANG=en_US.UTF-8 CI=1
unset EXPO_PUBLIC_WEBVIEW_DEBUG
npx expo prebuild --platform ios --clean
# ios/ now carries this archive's build number and channel; make the next sim-build.sh prebuild from clean.
rm -f $OUT/.prebuild-fp
NAME=Squiggletale
WS=ios/$NAME.xcworkspace
# eas build sets these two: the update channel (eas.json production; only while EAS Update is on), and the build number.
if [[ $(plutil -extract EXUpdatesEnabled raw "ios/$NAME/Supporting/Expo.plist" 2>/dev/null) == true ]]; then
  plutil -replace EXUpdatesRequestHeaders -json '{"expo-channel-name":"production"}' "ios/$NAME/Supporting/Expo.plist"
fi
plutil -replace CFBundleVersion -string "$BUILD" "ios/$NAME/Info.plist"

rm -rf "$ARCHIVE"
caffeinate -dimsu signing xcodebuild qg -workspace "$WS" -scheme "$NAME" -configuration Release \
  -destination generic/platform=iOS -derivedDataPath $OUT/archive-dd -archivePath "$ARCHIVE" archive \
  | tee $OUT/archive.log | grep -E '^error|\*\* ARCHIVE' || true
grep -q '\*\* ARCHIVE SUCCEEDED' $OUT/archive.log || { echo "ARCHIVE_FAILED see $OUT/archive.log"; grep -E 'error:' $OUT/archive.log | head -20; exit 1; }

APP="$ARCHIVE/Products/Applications/$NAME.app"
plist() { plutil -extract "$1" raw "$2" 2>/dev/null || echo none; }
echo "CHECK app $NAME version $(plist CFBundleShortVersionString $APP/Info.plist) build $(plist CFBundleVersion $APP/Info.plist) id $(plist CFBundleIdentifier $APP/Info.plist)"
echo "CHECK updates enabled $(plist EXUpdatesEnabled $APP/Expo.plist) check $(plist EXUpdatesCheckOnLaunch $APP/Expo.plist) channel $(plutil -extract EXUpdatesRequestHeaders json -o - "$APP/Expo.plist" 2>/dev/null || echo none) runtime $(plist EXUpdatesRuntimeVersion $APP/Expo.plist) url $(plist EXUpdatesURL $APP/Expo.plist)"
echo "CHECK orientations iphone $(plutil -extract UISupportedInterfaceOrientations json -o - $APP/Info.plist) ipad $(plutil -extract 'UISupportedInterfaceOrientations~ipad' json -o - $APP/Info.plist | tr -d '\n')"
# Purpose strings: mic + speech must be there; Photos must not (Save video left 1.0, so no
# expo-media-library; a photo key without the API reads as an unused permission in review). If a linked
# module ever needs one back, App Store processing says so (ITMS-90683, builds 1 and 2).
for k in NSMicrophoneUsageDescription NSSpeechRecognitionUsageDescription; do
  plutil -extract $k raw $APP/Info.plist >/dev/null 2>&1 && echo "CHECK purpose $k ok" \
    || { echo "ARCHIVE_UNFIT $k missing from Info.plist"; exit 1; }
done
for k in NSPhotoLibraryUsageDescription NSPhotoLibraryAddUsageDescription; do
  plutil -extract $k raw $APP/Info.plist >/dev/null 2>&1 \
    && { echo "ARCHIVE_UNFIT $k is in Info.plist: Photos is not in 1.0 (drop the plugin that adds it)"; exit 1; } \
    || echo "CHECK purpose $k absent (ok)"
done
# The origin: squiggletale.com only (onceupon.dested.com is gone, so a build that names it is dead on arrival).
STUDIO=$(find $APP -name 'studio*.html' -print -quit)
for f in "$STUDIO" "$APP/main.jsbundle"; do
  good=$(grep -a -c 'https://squiggletale.com' "$f" || true); bad=$(grep -a -c 'onceupon.dested.com' "$f" || true)
  echo "CHECK origin ${f:t} squiggletale.com $good, onceupon.dested.com $bad"
  [[ $good -gt 0 && $bad -eq 0 ]] || { echo "ARCHIVE_UNFIT ${f:t} must name https://squiggletale.com and never onceupon.dested.com"; exit 1; }
done
echo "CHECK frameworks $(ls $APP/Frameworks 2>/dev/null | tr '\n' ' ')"
echo "CHECK whistle/needle in binary: $(ls $APP/Frameworks 2>/dev/null | grep -ci needle || true) frameworks, $(grep -a -c -i 'whistle' "$APP/$NAME" || true) symbol hits"
echo "CHECK webview debug flag in bundle: $(grep -a -c 'EXPO_PUBLIC_WEBVIEW_DEBUG' "$APP/main.jsbundle" || true)"
echo "CHECK studio.html sha $(find $APP -name 'studio*.html' -print -quit | xargs shasum 2>/dev/null | cut -c1-12) committed $(shasum assets/studio.html | cut -c1-12)"
codesign -d --entitlements :- "$APP" 2>/dev/null | plutil -convert json -o - - 2>/dev/null | sed 's/^/CHECK entitlements /' || true
codesign -dvv "$APP" 2>&1 | grep -E "Authority|TeamIdentifier" | head -3 | sed 's/^/CHECK sign /'
echo "ARCHIVE_DONE $ARCHIVE"
