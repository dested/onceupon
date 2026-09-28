# Prototype: the sketch dialect

- **Date:** 2026-09-28
- **Status:** active
- **Type:** plan
- **What:** design and bench results for `sketch`, a drawing language where every entity is an SVG icon in its own 100x100 box

## Thesis

The model stays the illustrator, but draws in the format it knows best: an icon in a 100x100 viewBox (y down, feet at y=100, centered on x=50), placed on the paper by `ent id x [y] h=<size>`. No negative-up paper offsets and no scale formula.

## Grammar (src/proto/sketch/)

```
bg <sky> [<ground>]                    day sunset dawn night storm indoor space underwater paper / grass sand water snow floor road moon dirt none
ent <id> <x> [<y>] h=<size> ["name"] [float|sway|still] [back|far]
<id>.<part> <color> [mirror] [hollow] [stripes|spots|dots[=<color>]] [w=<n>] <shape>
   circle cx cy r | oval cx cy rx ry | rect x y w h [r] | blob x y .. | poly x y .. | curve x y .. | stamp name x y s | M.. (full SVG path, arcs too)
face <id> [<head>] [front|left|right] [happy|surprised|sad|sleepy]
line <id> <color> x y x y ..           paper points: kite strings, leashes
turn <id>                              face the other way (engine flip)
move / pose / recolor (also <id> <part> <color>) / fx / rm / say / scene / skip   as in ops
```

- One color per shape: the outline is derived (`palette.ts inkFor`: same hue, darker; warm gray for white, chroma-based so creams don't get yellow outlines).
- `blob` / `curve` are Catmull-Rom → cubic; `curve w=` becomes a tapered filled ribbon (tails, manes, arms); `rect` corners round by default; SVG `A/S/T` and relative commands are converted (`geom.ts`).
- Patterns are real clipped pieces: stripes run across the short side (tall shirt → horizontal, wide tiger → vertical), spots and dots are placed deterministically inside the shape.
- `bg` paints sky color + a designed ground (wavy grass with tufts, sand, water with a surface at y=465, floor boards, road, moon, snow, dirt). The ground entity is owned by the dialect and emitted as raw engine commands, so one line can create and paint it.
- `face ... sleepy` draws closed-eye arcs in the dialect (blanks old open eyes).
- Everything else goes through `JsonDialect.applyRaw`, so verbs and timing match ops. No engine files touched.

## Results (lab/proto/sketch-full, Sonnet 5.5, 23 stories / 31 calls each)

| | median first token | median first ink | median done | p90 done | mean out tok | tok/line | $/call | parse errors |
|---|---|---|---|---|---|---|---|---|
| ops | 1.10s | 1.28s | 3.21s | 4.48s | 337 | 25.1 | $0.0060 | 4 |
| sketch | 1.10s | 1.24s | 2.42s | 3.79s | 286 | 20.6 | $0.0049 | 1 |

Picture quality: sketch wins most pairs outright (princess: ops broke on parse errors; horse, bear-in-boat, kite, unicorn, dragon-fire-castle), ops ties on pirate. Every sketch page has a full-color backdrop.

## Hypotheses

1. 100-box, 1-token numbers: **partly held.** Tokens per line down 18%, total output down 15% (not 30-40%: blobs spend more points than an oval). Proportions and placement are clearly better; no scale math errors seen.
2. Organic primitives: **held.** blob/curve/ribbons are what make it look drawn instead of assembled.
3. One color, derived outline: **held strongly.** It is the single biggest look upgrade and saves a token per shape.
4. Style tokens: **held.** Patterns, sleepy face and bg are all used unprompted and parse cleanly; bg-first also gives ink on the page in ~1.2s.
- `sketch-svg` (literal SVG elements): **not built.** The same bunny+horse is 3.1x the tokens as SVG (count_tokens: 883 vs 281), so about 3x slower to draw. The terse form wins on speed and the cookbook already carries the quality.

## Weaknesses

- Cross-entity geometry: anything linking two boxes needs paper points (`line`), and the driver-in-car beat still misplaces the pig.
- Translucent fills: backgrounds and hair show through white and skin fills (a renderer issue; the renderer prototype's knockout should fix it).
- Snapshots after settle drop fx and bubbles; the prompt now draws lasting things as parts and changes the face for mood.
- The prompt is ~8.9k tokens (ops 8.5k), mostly cookbook.

## Files

`src/proto/sketch/{dialect,geom,palette,prompt}.ts`, registry line in `src/proto/registry.ts`, `scripts/sketch-check.ts` (every example and cookbook line must parse; `--gallery` writes hand BenchFiles for rendering the recipes without the API).
