# Once Upon — UI / visual language

> Source of truth for how this looks. Follow it for anything visual. Last updated: 2026-09-20

## North star

**A crayon picture book a five-year-old owns.** The canvas is cream construction paper and the
drawing is the star; every control is a paper sticker stuck on top of it: thick dark-ink
outline, pastel fill, a hard offset shadow, a slight tilt. Handwriting fonts everywhere. Nothing
should look like a dashboard. Failure modes: (a) app chrome that competes with the drawing;
(b) tiny text or thin lines; (c) gray/neutral SaaS styling.

## Tokens (`src/styles/app.css`, Tailwind v4 `@theme`)

| Token            | Value                          | Use                                 |
| ---------------- | ------------------------------ | ----------------------------------- |
| `bg-paper`       | `#fbf6ea`                      | page background, button fills       |
| `bg-paper-deep`  | `#efe6d2`                      | empty thumbnails, muted surfaces    |
| `text-ink`       | `#3b2f2f`                      | text, outlines (`border-ink`)       |
| `text-ink-soft`  | `#8a7a6a`                      | secondary text, interim words       |
| `crayon-red`     | `#ef4444`                      | listening state, delete confirm     |
| `crayon-yellow`  | `#fbbf24`                      | active/selected, mic idle           |
| `crayon-green`   | `#22c55e`                      | play                                |
| `crayon-blue`    | `#3b82f6`                      | spare accent                        |
| `font-hand`      | Patrick Hand                   | all UI text, subtitles              |
| `font-scrawl`    | Gloria Hallelujah              | headings, canvas handwriting        |

Canvas colors are a separate palette: the crayon box in `src/engine/colors.ts`. Do not reuse
UI tokens on the canvas or vice versa.

## Components (`src/ui/bits.tsx`)

- **StickerButton** — `rounded-2xl border-[3px] border-ink`, offset shadow `3px 4px 0`, tilt
  prop (default -2deg), tones paper/red/blue/yellow/green. Text `text-xl`.
- **IconButton** — 48px round sticker, `active` turns it yellow. Use for toolbar actions.
- **PaperCard** — modal/card surface, `rounded-3xl`, 3px ink border, big offset shadow.
- **Mic button** (in `StoryScreen`) — 96px round; yellow idle, red with a pinging ring when
  listening. It is the one big affordance on the screen.

## Patterns

- Overlays float on the canvas with absolute positioning: toolbar top-right, filmstrip
  top-left, subtitles bottom-center above the mic, typed input bottom-right, debug bottom-left.
- Subtitles sit on a translucent paper pill with a soft glow so they read on dark skies.
- Thumbnails (filmstrip, bookshelf) are tilted alternately ±2.5deg like taped photos.
- Destructive actions confirm inline (Delete → "sure?"), never with `window.confirm`.
- Debug panel is the one dark surface (`bg-ink/85`, monospace 11px). Keep it that way.

## Don'ts

- No system font, no gray text on gray, no hairline borders, no drop-shadow blur on stickers.
- No eyebrow labels above headings; headings never end with a period.
- No new chrome on the story screen without a reason a child would understand.
- No `bg-blue-500`-style Tailwind palette colors in components; use the tokens.
