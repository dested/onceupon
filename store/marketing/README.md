# Marketing assets

Every frame is the real studio (hosted mode, fake native shell, local API with a buyer device) captured at device pixels, the app's own mp4 export render, or the real share page; every word on screen is a word the child says. Touches show as a soft ink ring where the finger lands. Overlays: at most 4 words, scrawl hand, paper sticker, no period.

| File | Spec | Source |
| --- | --- | --- |
| `preview-iphone-6.9.mp4` | App Store app preview, iPhone 6.9": 886x1920 portrait, 29.7 s, H.264 High@4.0 30 fps ~11 Mbps CBR, AAC-LC 48 kHz stereo 256k target, -16 LUFS | dragons take `W:\junk\onceupon-f\assets\n-dragons` + shelf `W:\junk\onceupon-f\assets\n-shelf`; cut by `edl/preview-iphone-6.9.json` |
| `preview-iphone-6.9-sheet.png` | 3x3 contact sheet of the preview | `scripts/marketing/edit.mjs` |
| `hero-1080p.mp4` | 16:9 hero ad: 1920x1080, 40.6 s, H.264 High@4.0 30 fps CRF 17 (≤ 12 Mbps), AAC-LC 48 kHz stereo, -16 LUFS | ocean export `W:\junk\onceupon-f\assets\hero\x-ocean.mp4`, owl take `W:\junk\onceupon-f\assets\h2-bedtime`, share take `W:\junk\onceupon-f\assets\h-share3`, grandma's phone `W:\junk\onceupon-f\assets\h-grandma3`; cut by `edl/hero-1080p.json` |
| `hero-1080p-sheet.png` | 4x3 contact sheet of the hero | `scripts/marketing/hero.mjs` |
| `brand/app-store-badge-black.svg` | Apple's "Download on the App Store" badge (US-UK, black), unmodified | toolbox.marketingtools.apple.com, 2026-11-05 |
| `stories.md` | the three theme stories, voice, takes | `scripts/marketing/stories.ts` |
| `voice/<theme>-<n>.mp3`, `voice/<theme>.json` | kid voice lines (Teddy, eleven_v4) + word timings | `scripts/marketing/voice.ts` |
| `edl/*.json` | edit lists for each cut | hand-written, run by `scripts/marketing/edit.mjs` (portrait previews) or `hero.mjs` (16:9) |

Apple's preview spec (checked 2026-11-04, App Store Connect help "App preview specifications"): 886x1920 for 6.9"/6.5" iPhones, 15–30 s, ≤ 30 fps, H.264 10–12 Mbps High ≤ 4.0, 256 kbps AAC stereo 44.1/48 kHz, ≤ 500 MB, .mov/.m4v/.mp4.

## Preview cut (iPhone 6.9")

| Time | Scene | Overlay | Sound |
| --- | --- | --- | --- |
| 0–18.9 | live: mic tap, the child tells the dragon story, words appear, the crayon draws, "The End", closing card | "Tell a story aloud" 0.6–7.4, "The crayon draws it" 8.3–14.3 | child's voice, crayon scratch, page flip |
| 18.75–26.25 | Replay "in their own voice": the dragon, castle and rainbow redraw | "Watch it again" | the replay playing the child's recording |
| 26.1–29.7 | My stories shelf (dragon, owl, turtle) | none | none |

## Hero ad (1920x1080)

Sells in the first 2 seconds: a child's voice and the crayon already drawing, no logo card. Then the three stories, the replay in the child's voice, "Send to grandma" opening on grandma's phone (blue), and the name with Apple's badge. No tagline.

| Time | Scene | Overlay | Sound |
| --- | --- | --- | --- |
| 0–8.7 | the turtle story full-frame (the app's mp4 export render): turtle, fish and chest drawn, "The End" | "Kids tell the story" | "She swam with a happy pink fish and they found a treasure chest", "The End!" |
| 8.5–13.85 | close-up: mic tap, "Your story starts with you", the words appear as the child talks | "Just tap and talk" | "Once upon a time a sleepy owl lived in a tree" |
| 13.65–18.35 | the phone: the crayon draws the owl in its tree | "A crayon draws it" | "At night the moon came out and the stars were twinkling", crayon scratch |
| 18.15–26.05 | closing card, tap "Play it again": the replay redraws the night, "in their own voice" | "In their own voice" | the replay playing the child's recording |
| 25.85–37.0 | kid's phone: "Send to grandma", "Make a link", "Your link is ready"; grandma's phone: the share page, tap Play, the dragon story in the child's voice | "Send it to grandma" | the share page playing the recording |
| 36.8–40.6 | app icon, Squiggletale, App Store badge | none | none |

Grandma's phone is the local API's real `/s/<id>` page; its player frame points at the studio dev server (same player code) because the built studio in `dist-hosted` calls the production API. Share links read `https://squiggletale.com/s/…` because the API runs with `PUBLIC_ORIGIN=https://squiggletale.com` for the share take.

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
node scripts/marketing/export-story.mjs list            # the app's mp4 export render of a shelf story:
node scripts/marketing/export-story.mjs ocean <out.mp4> #   1280x800, voice in story time, deterministic
AFTER=share node scripts/marketing/capture-live.mjs dragons <take>   # ends on Send to grandma -> Make a link (events.shareUrl)
node scripts/marketing/capture-player.mjs <shareId> <take> 20        # grandma's phone: the /s/<id> page, tap Play
node scripts/marketing/hero.mjs store/marketing/edl/hero-1080p.json  # 16:9 cut: export, phones, touches, end card
node scripts/marketing/cdp.mjs quit
```

Wait about 30 s between takes and retake any take that prints `NOTES (retake?)`. Sharing with the voice needs the device's consent once: `node scripts/marketing/cdp.mjs js "import('/src/backend/device.ts').then((m) => m.setShareVoice(true))"`.

Audio taps (`tap.mjs`) keep a silent source running into every recorder: without it Chrome drops silent stretches from the recording and the tap drifts from the wall clock (takes before 2026-11-05 have that drift; re-capture before reusing their tap audio).
