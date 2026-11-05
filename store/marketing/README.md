# Marketing assets

Every frame is the real studio (hosted mode, fake native shell, local API with a buyer device), captured at device pixels; every word on screen is a word the child says. Overlays: at most 4 words, scrawl hand, paper sticker, no period.

| File | Spec | Source |
| --- | --- | --- |
| `preview-iphone-6.9.mp4` | App Store app preview, iPhone 6.9": 886x1920 portrait, 29.4 s, H.264 High@4.0 30 fps ~11 Mbps CBR, AAC-LC 48 kHz stereo 256k target, -16 LUFS | dragons take `W:\junk\onceupon-f\assets\e-dragons` + shelf `W:\junk\onceupon-f\assets\shelf2`; cut by `edl/preview-iphone-6.9.json` |
| `preview-iphone-6.9-sheet.png` | 3x3 contact sheet of the preview | `scripts/marketing/edit.mjs` |
| `stories.md` | the three theme stories, voice, takes | `scripts/marketing/stories.ts` |
| `voice/<theme>-<n>.mp3`, `voice/<theme>.json` | kid voice lines (Teddy, eleven_v4) + word timings | `scripts/marketing/voice.ts` |
| `edl/*.json` | edit lists for each cut | hand-written, run by `scripts/marketing/edit.mjs` |

Apple's preview spec (checked 2026-11-04, App Store Connect help "App preview specifications"): 886x1920 for 6.9"/6.5" iPhones, 15–30 s, ≤ 30 fps, H.264 10–12 Mbps High ≤ 4.0, 256 kbps AAC stereo 44.1/48 kHz, ≤ 500 MB, .mov/.m4v/.mp4.

## Preview cut (iPhone 6.9")

| Time | Scene | Overlay | Sound |
| --- | --- | --- | --- |
| 0–18.6 | live: mic tap, the child tells the dragon story, words appear, the crayon draws, "The End", closing card | "Tell a story aloud" 0.6–6.6, "The crayon draws it" 7.6–13.6 | child's voice, crayon scratch, page flip |
| 18.5–26 | Replay "in their own voice": the dragon, castle and rainbow redraw | "Watch it again" | the replay playing the child's recording |
| 25.8–29.4 | My stories shelf (owl, dragon, turtle) | none | none |

## Pipeline (`scripts/marketing/`)

```
bun scripts/marketing/voice.ts                          # kid voice lines + timings (ELEVENLABS_API_KEY in .env)
cd apps/web && DATABASE_URL=postgresql://postgres@localhost:5432/onceupon_voice PORT=7820 \
  CORS_ORIGINS=http://localhost:7811 BETTER_AUTH_URL=http://localhost:7820 PUBLIC_ORIGIN=http://localhost:7820 bun server.ts
VITE_API_ORIGIN=http://localhost:7820 bunx vite --mode hosted --port 7811 --strictPort
node scripts/marketing/cdp.mjs launch                   # headless Windows Chrome, 443x960 @2x, :9333
node scripts/marketing/prep.mjs                         # intro, gate, consent, buyer device (buyer.ts), empty shelf
node scripts/marketing/capture-live.mjs dragons <take>  # one story told live + replay + shelf; flags failed drawings
node scripts/marketing/capture-shelf.mjs <take> 4       # the shelf alone
bash scripts/marketing/raw.sh <take>                    # frames -> raw.mp4 (CFR 30) + sheet
node scripts/marketing/edit.mjs store/marketing/edl/preview-iphone-6.9.json
node scripts/marketing/cdp.mjs quit
```

Wait about 30 s between takes and retake any take that prints `NOTES (retake?)`.
