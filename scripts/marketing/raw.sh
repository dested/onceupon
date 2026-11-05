#!/bin/bash
# raw.sh <takeDir>: frames -> raw.mp4 (CFR 30; the last frame holds until events.stop) + sheet.png (every 2 s)
d=$1
python3 - $d <<'PY'
import json,sys
d=sys.argv[1]
ts=json.load(open(f'{d}/frames.json'))
ev=json.load(open(f'{d}/events.json'))
end=ev.get('stop', ev.get('done', ts[-1]*1000+50))/1000
L=[]
for i,t in enumerate(ts):
    dur=(ts[i+1]-t) if i+1<len(ts) else max(0.05,end-t)
    L.append(f"file 'frames/{i:05d}.jpg'\nduration {dur:.5f}")
L.append(f"file 'frames/{len(ts)-1:05d}.jpg'")
open(f'{d}/concat.txt','w').write("\n".join(L)+"\n")
open(f'{d}/total.txt','w').write(f"{end-ts[0]:.3f}")
PY
cd $d && ffmpeg -y -v error -f concat -safe 0 -i concat.txt -t $(cat total.txt) -vf "fps=30,format=yuv420p" -c:v libx264 -crf 12 -preset fast raw.mp4 && ffmpeg -y -v error -i raw.mp4 -vf "fps=1/2,scale=295:640,tile=8x3" -frames:v 1 sheet.png && echo "$d ok"
