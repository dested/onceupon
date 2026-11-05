#!/bin/zsh
# Re-signs a checked archive (archive.sh) with Apple's cloud-managed distribution and uploads it to App Store Connect
# (ExportOptions.plist: app-store-connect, destination upload), headless via `signing`, then waits for Apple's
# processing verdict (WAIT=0 skips it; `export-upload.sh --status` only prints it):
#   ssh mini 'cd ~/code/squiggletale && onscreen --title squiggletale-upload --wait -- \
#     env BUILD=1 OWNER=release zsh apps/mobile/scripts/mini/export-upload.sh'
# A build that fails processing never shows in /v1/apps/<id>/builds; its errors (ITMS codes) are only in
# /v1/apps/<id>/buildUploads, which is what the poll reads. Prints PROCESSING_<STATE> and exits 1 on FAILED.
# Never submits for review and writes no App Store Connect metadata.
set -euo pipefail
BUILD=${BUILD:?set BUILD to the build number}
APP_ID=6815029998
OUT=~/scratch/squiggletale
ARCHIVE=$OUT/Squiggletale-$BUILD.xcarchive

# One line per state: "<state> <errors>" for this build number's newest upload, or "NONE".
upload_state() {
  signing api qg GET "/v1/apps/$APP_ID/buildUploads?limit=50" | python3 -c '
import json, sys
want = sys.argv[1]
ups = [u for u in json.load(sys.stdin)["data"] if u["attributes"]["cfBundleVersion"] == want]
if not ups: print("NONE"); sys.exit()
a = max(ups, key=lambda u: u["attributes"]["createdDate"])["attributes"]["state"]
errs = " | ".join(e["code"] + ": " + e["description"][:160] for e in a["errors"])
print(a["state"], errs)' "$BUILD"
}

if [[ ${1:-} == --status ]]; then echo "PROCESSING_$(upload_state)"; exit 0; fi

[[ -d $ARCHIVE ]] || { echo "NO_ARCHIVE $ARCHIVE (run archive.sh first)"; exit 1; }
if ! mkdir ~/code/.mac-build.lock 2>/dev/null; then echo "LOCK_HELD: $(cat ~/code/.mac-build.lock/owner)"; exit 1; fi
echo "squiggletale ($BUILD) export + upload (${OWNER:-agent}) $(date)" > ~/code/.mac-build.lock/owner
trap 'rm -rf ~/code/.mac-build.lock; echo LOCK_RELEASED' EXIT
rm -rf "$OUT/export-$BUILD"
caffeinate -dimsu signing xcodebuild qg -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist "${0:A:h}/ExportOptions.plist" -exportPath "$OUT/export-$BUILD" 2>&1 | tee $OUT/export-$BUILD.log
grep -q 'EXPORT SUCCEEDED' $OUT/export-$BUILD.log || { echo "UPLOAD_FAILED see $OUT/export-$BUILD.log"; exit 1; }
echo "UPLOAD_DONE $(date)"
rm -rf ~/code/.mac-build.lock; trap - EXIT; echo LOCK_RELEASED   # the poll below needs no lock

[[ ${WAIT:-1} == 0 ]] && exit 0
for i in {1..90}; do   # up to ~45 min
  s=$(upload_state || echo "ERROR api")
  case $s in
    COMPLETE*) echo "PROCESSING_$s"; exit 0 ;;
    FAILED*) echo "PROCESSING_$s"; exit 1 ;;
  esac
  echo "$(date +%H:%M) $s"; sleep 30
done
echo "PROCESSING_TIMEOUT $s"; exit 1
