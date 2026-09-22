#!/usr/bin/env bash
# Agent-mode helper: render every ops file of a round in the lab page (bx) and record the draws.
# Usage: bash scripts/lab-render-round.sh <rid> [bx-profile]   (dev server on 7710, lab.html open in that profile)
set -u
rid="$1"
profile="${2:-lab}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
tmp="$root/lab/agent/$rid/.lines"
mkdir -p "$tmp"
ok=0; bad=0
for f in lab/agent/"$rid"/*-0.ops.txt; do
  [ -e "$f" ] || continue
  base="$(basename "$f" -0.ops.txt)"
  if [ -e "lab/runs/$rid/$base-0.json" ]; then continue; fi
  phrase="$(node -e "const c=require('./lab/cases.json').find(c=>c.id===process.argv[1]);process.stdout.write(c?c.phrase:process.argv[1])" "$base")"
  out="$(bx --profile "$profile" js "window.__lab.renderFromFile('$rid','$base',0,$(node -e "process.stdout.write(JSON.stringify(process.argv[1]))" "$phrase"))" 2>&1)"
  if node -e "const j=JSON.parse(process.argv[1]); if(!Array.isArray(j.lines)) process.exit(1); require('fs').writeFileSync(process.argv[2], JSON.stringify(j.lines))" "$out" "$tmp/$base.json" 2>/dev/null; then
    if bun scripts/lab-agent.ts record-draw "$rid" "$base" 0 "$phrase" "$tmp/$base.json" >/dev/null 2>&1; then ok=$((ok+1)); else bad=$((bad+1)); echo "record-draw failed: $base"; fi
  else
    bad=$((bad+1)); echo "render failed: $base: ${out:0:200}"
  fi
done
echo "rendered+recorded $ok, failed $bad"
