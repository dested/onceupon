#!/bin/zsh
# Re-signs a checked archive (archive.sh) with Apple's cloud-managed distribution and uploads it to App Store Connect
# (ExportOptions.plist: app-store-connect, destination upload), headless via `signing`. Then poll until VALID:
#   ssh mini 'cd ~/code/squiggletale && onscreen --title squiggletale-upload --wait -- \
#     env BUILD=1 OWNER=release zsh apps/mobile/scripts/mini/export-upload.sh'
#   signing api qg GET '/v1/apps/6815029998/builds?limit=50'   # processingState PROCESSING -> VALID
# Never submits for review and writes no App Store Connect metadata.
set -euo pipefail
BUILD=${BUILD:?set BUILD to the build number}
OUT=~/scratch/squiggletale
ARCHIVE=$OUT/Squiggletale-$BUILD.xcarchive
[[ -d $ARCHIVE ]] || { echo "NO_ARCHIVE $ARCHIVE (run archive.sh first)"; exit 1; }
if ! mkdir ~/code/.mac-build.lock 2>/dev/null; then echo "LOCK_HELD: $(cat ~/code/.mac-build.lock/owner)"; exit 1; fi
echo "squiggletale ($BUILD) export + upload (${OWNER:-agent}) $(date)" > ~/code/.mac-build.lock/owner
trap 'rm -rf ~/code/.mac-build.lock; echo LOCK_RELEASED' EXIT
rm -rf "$OUT/export-$BUILD"
caffeinate -dimsu signing xcodebuild qg -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "${0:A:h}/ExportOptions.plist" -exportPath "$OUT/export-$BUILD" 2>&1 | tee $OUT/export-$BUILD.log
grep -q 'EXPORT SUCCEEDED\|Upload succeeded' $OUT/export-$BUILD.log || { echo "UPLOAD_FAILED see $OUT/export-$BUILD.log"; exit 1; }
echo "UPLOAD_DONE $(date)"
