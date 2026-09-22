#!/usr/bin/env bash
# Agent-mode helper: record every critique the judge agents wrote for a round that is not recorded yet.
# Usage: bash scripts/lab-record-judges.sh <rid>
set -u
rid="$1"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
ok=0; bad=0
for f in lab/agent/"$rid"/*-0.critique.json; do
  [ -e "$f" ] || continue
  base="$(basename "$f" -0.critique.json)"
  if node -e "const j=require('./lab/runs/$rid/$base-0.json'); process.exit(j.critique ? 0 : 1)" 2>/dev/null; then continue; fi
  if bun scripts/lab-agent.ts record-judge "$rid" "$base" 0 "$f" >/dev/null 2>&1; then ok=$((ok+1)); else bad=$((bad+1)); echo "record-judge failed: $base"; fi
done
echo "recorded $ok, failed $bad"
