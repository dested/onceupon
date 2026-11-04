#!/bin/zsh
# Boot simulators on the mini, install the last sim-build.sh app and launch it, shown in Device Hub.
#   zsh ~/code/squiggletale/apps/mobile/scripts/mini/sim-run.sh [--fresh] [--no-launch] "iPhone 18 Pro" "iPad (A16)" ...
#   zsh ~/code/squiggletale/apps/mobile/scripts/mini/sim-run.sh --shutdown "iPhone 18 Pro" ...
# --fresh uninstalls first and resets the app's privacy grants (mic, speech, photos), so prompts show again.
# Prints `DEVICE <name> <udid>` per device. Devices are matched by exact name on the iOS 27.0 runtime.
set -euo pipefail
APP=~/scratch/squiggletale/sim-dd/Build/Products/Release-iphonesimulator/Squiggletale.app
BUNDLE=com.quickgame.squiggletale
fresh=0 launch=1 shutdown=0
names=()
for a in "$@"; do
  case $a in
    --fresh) fresh=1 ;;
    --no-launch) launch=0 ;;
    --shutdown) shutdown=1 ;;
    -*) echo "sim-run: unknown flag $a" >&2; exit 64 ;;
    *) names+=("$a") ;;
  esac
done
(( ${#names} )) || { echo "sim-run: name at least one simulator" >&2; exit 64; }
[[ $shutdown == 1 || -d $APP ]] || { echo "sim-run: no app at $APP; run sim-build.sh first" >&2; exit 1; }

udid_of() {
  xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
for rt, devs in json.load(sys.stdin)["devices"].items():
    if "iOS-27-0" in rt:
        for d in devs:
            if d["name"] == name: print(d["udid"]); sys.exit(0)
sys.exit(1)' "$1"
}

for n in $names; do
  u=$(udid_of "$n") || { echo "sim-run: no iOS 27.0 simulator named '$n'" >&2; exit 1; }
  if (( shutdown )); then xcrun simctl shutdown "$u" 2>/dev/null || true; echo "SHUTDOWN $n $u"; continue; fi
  xcrun simctl boot "$u" 2>/dev/null || true
  xcrun simctl bootstatus "$u" -b >/dev/null
  if (( fresh )); then
    xcrun simctl terminate "$u" $BUNDLE 2>/dev/null || true
    xcrun simctl uninstall "$u" $BUNDLE 2>/dev/null || true
    xcrun simctl privacy "$u" reset all $BUNDLE 2>/dev/null || true
  fi
  xcrun simctl install "$u" "$APP"
  (( launch )) && xcrun simctl launch "$u" $BUNDLE >/dev/null
  echo "DEVICE $n $u"
done
(( shutdown )) || open -b com.apple.dt.Devices
