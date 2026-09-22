import { makePaper } from '~/engine/paper'
import { mulberry32 } from '~/engine/rng'

/**
 * The video's picture: the home screen's storybook drawn on a canvas (warm tabletop, coral cloth
 * cover, stitched spine with rings, cream paper), the stage inside the paper, and the replay's
 * overlays burned in. Values mirror `.story-studio` / `.storybook` / `.book-binding` /
 * `.story-paper` / `.made-by-you` / `.paper-bottomline` in src/styles/app.css, scaled up ~1.2x so
 * they read on a phone. If the home screen's book changes, change it here too.
 */
export const VIDEO_W = 1280
export const VIDEO_H = 800
/** Exactly 16:10, so the 160x100 world fills it edge to edge. */
export const PAPER = { x: 60, y: 28, w: 1184, h: 740 } as const
const BOOK = { x: 22, y: 18, w: 1232, h: 762 } as const
const K = 1.2

const TABLE = '#eee5d5'
const CORAL = '#d9937e'
const CORAL_EDGE = '#876351'
const INK = '#3b2f2f'
const MUTED = '#998977'
const PURPLE = '#7b5c91'
const LILAC = '#e6ddec'
const HAND = '"Patrick Hand", "Comic Sans MS", cursive'
const SCRAWL = '"Gloria Hallelujah", "Patrick Hand", cursive'

const PAPER_RADII = [7, 16, 15, 6]
/** CPU canvases: GPU rasterization is not bit-identical between runs. */
export const CPU: CanvasRenderingContext2DSettings = { willReadFrequently: true }

function canvas(w: number, h: number): { c: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', CPU)
  if (!ctx) throw new Error('2d context unavailable')
  return { c, ctx }
}

/** Fonts the frame and the stage draw with; canvas text silently falls back if they are not loaded. */
export async function loadVideoFonts(): Promise<void> {
  await Promise.all([document.fonts.load(`32px ${HAND}`), document.fonts.load(`32px ${SCRAWL}`)])
}

function drawTable(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = TABLE
  ctx.fillRect(0, 0, VIDEO_W, VIDEO_H)
  // Seeded grain, like the studio's fractal-noise tabletop.
  const rng = mulberry32(0x7ab1e)
  ctx.fillStyle = 'rgba(128,105,76,0.10)'
  for (let i = 0; i < 9000; i++) {
    const x = rng() * VIDEO_W
    const y = rng() * VIDEO_H
    const r = 0.5 + rng() * 1.1
    ctx.fillRect(x, y, r, r)
  }
}

function drawBook(ctx: CanvasRenderingContext2D): void {
  const { x, y, w, h } = BOOK
  const radii = [17, 23, 23, 17]
  // Page edges peeking under the cover (.storybook::after).
  ctx.fillStyle = '#f2ead8'
  ctx.strokeStyle = '#c8bda7'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x + 39, y + h - 4, w - 55, 10, [0, 0, 12, 12])
  ctx.fill()
  ctx.stroke()
  // Hard offset shadows, never blurred.
  for (const [dx, dy, color] of [
    [3, 8, '#d9ccba'],
    [2, 5, '#c4b59e'],
  ] as const) {
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.roundRect(x + dx, y + dy, w, h, radii)
    ctx.fill()
  }
  ctx.fillStyle = CORAL
  ctx.strokeStyle = CORAL_EDGE
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radii)
  ctx.fill()
  ctx.stroke()

  // Spine: fine cloth stripes and five stitched rings.
  const spineX = x + 2
  const spineW = PAPER.x - spineX
  ctx.fillStyle = 'rgba(153,92,67,0.07)'
  for (let sy = y + 4; sy < y + h - 4; sy += 4) ctx.fillRect(spineX, sy, spineW, 1)
  const top = y + 2 + 22 * K
  const slot = (h - 4 - 44 * K) / 5
  for (let i = 0; i < 5; i++) {
    const cx = spineX + spineW / 2
    const cy = top + slot * (i + 0.5)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate((-7 * Math.PI) / 180)
    ctx.lineWidth = 2 * K
    ctx.strokeStyle = '#f9dbbf'
    ctx.beginPath()
    ctx.ellipse(0, 0, 6 * K, 14 * K, 0, Math.PI / 2, (Math.PI * 3) / 2)
    ctx.stroke()
    ctx.strokeStyle = '#a66c55'
    ctx.beginPath()
    ctx.ellipse(0, 0, 6 * K, 14 * K, 0, -Math.PI / 2, Math.PI / 2)
    ctx.stroke()
    ctx.restore()
  }
}

/**
 * The Once Upon mark, bottom-right of the paper on every frame (end card included). Placeholder
 * until there is a real logo: the home screen's wordmark (yellow star, "once upon", coral ✦) on a
 * paper chip so it reads on dark skies. Swap this one function for an image when the logo exists.
 */
function drawLogo(ctx: CanvasRenderingContext2D): void {
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.globalAlpha = 1
  const word = 'once upon'
  ctx.font = `${20 * K}px ${SCRAWL}`
  const ww = ctx.measureText(word).width
  const star = 15 * K
  const gap = 7 * K
  const w = 14 * K + star + gap + ww + gap + 10 * K + 12 * K
  const h = 38 * K
  const x = PAPER.x + PAPER.w - 16 * K - w
  const y = PAPER.y + PAPER.h - 12 * K - h
  ctx.fillStyle = 'rgba(251,246,234,0.88)'
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, 12 * K)
  ctx.fill()
  // Five-point star, wax yellow with a darker edge (the header's Star icon).
  const sx = x + 14 * K + star / 2
  const sy = y + h / 2
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? star / 2 : star / 4.4
    const a = -Math.PI / 2 + (i * Math.PI) / 5
    if (i === 0) ctx.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r)
    else ctx.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r)
  }
  ctx.closePath()
  ctx.fillStyle = '#efd48f'
  ctx.fill()
  ctx.strokeStyle = '#aa8a44'
  ctx.lineWidth = 1.5 * K
  ctx.lineJoin = 'round'
  ctx.stroke()
  ctx.fillStyle = INK
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  const tx = sx + star / 2 + gap
  ctx.fillText(word, tx, sy + 2 * K)
  ctx.fillStyle = CORAL
  ctx.font = `${13 * K}px ${HAND}`
  ctx.fillText('✦', tx + ww + 3 * K, sy - 8 * K)
  ctx.restore()
}

function paperPath(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath()
  ctx.roundRect(PAPER.x, PAPER.y, PAPER.w, PAPER.h, PAPER_RADII)
}

/** Wrap `text` into lines no wider than `max` px in the current font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > max) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

export interface FrameOverlay {
  page: number
  /** The replay's narration caption (latest words chunk); empty for none. */
  caption: string
}

/** Builds the static book once; `compose` draws one full video frame around a paper-sized picture. */
export class BookFrame {
  private base: HTMLCanvasElement
  private end: HTMLCanvasElement | null = null

  constructor() {
    const { c, ctx } = canvas(VIDEO_W, VIDEO_H)
    drawTable(ctx)
    drawBook(ctx)
    this.base = c
  }

  compose(ctx: CanvasRenderingContext2D, picture: CanvasImageSource, overlay: FrameOverlay): void {
    this.drawBase(ctx, picture)
    this.drawTags(ctx, overlay.page)
    if (overlay.caption) this.drawCaption(ctx, overlay.caption)
    drawLogo(ctx)
  }

  /** The closing card, crossfading in over the last story frame (`mix` 0..1). */
  composeEnd(ctx: CanvasRenderingContext2D, lastFrame: CanvasImageSource, mix: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.drawImage(lastFrame, 0, 0)
    ctx.globalAlpha = Math.max(0, Math.min(1, mix))
    this.drawBase(ctx, this.endCard())
    ctx.globalAlpha = 1
    drawLogo(ctx)
  }

  private drawBase(ctx: CanvasRenderingContext2D, picture: CanvasImageSource): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.drawImage(this.base, 0, 0)
    ctx.save()
    paperPath(ctx)
    ctx.clip()
    ctx.drawImage(picture, PAPER.x, PAPER.y, PAPER.w, PAPER.h)
    // The binding's soft shade on the paper's left edge (.story-paper inset shadow).
    const g = ctx.createLinearGradient(PAPER.x, 0, PAPER.x + 22, 0)
    g.addColorStop(0, 'rgba(105,77,44,0.10)')
    g.addColorStop(1, 'rgba(105,77,44,0)')
    ctx.fillStyle = g
    ctx.fillRect(PAPER.x, PAPER.y, 22, PAPER.h)
    ctx.restore()
    ctx.strokeStyle = '#cbbb9f'
    ctx.lineWidth = 1
    paperPath(ctx)
    ctx.stroke()
  }

  private drawTags(ctx: CanvasRenderingContext2D, page: number): void {
    // "Made by you" sticker, top-right, tilted 3deg.
    ctx.save()
    ctx.font = `${16 * K}px ${HAND}`
    const label = '✦ Made by you'
    const tw = ctx.measureText(label).width
    const w = tw + 24 * K
    const h = 30 * K
    const x = PAPER.x + PAPER.w - 24 * K - w
    const y = PAPER.y + 17 * K
    ctx.translate(x + w / 2, y + h / 2)
    ctx.rotate((3 * Math.PI) / 180)
    ctx.fillStyle = '#f4e7c9'
    ctx.beginPath()
    ctx.roundRect(-w / 2, -h / 2, w, h, [3, 5, 3, 6])
    ctx.fill()
    ctx.fillStyle = '#886c45'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, 0, 1)
    ctx.restore()
    // Page number, bottom-left (the logo holds the bottom-right).
    ctx.save()
    ctx.font = `${14 * K}px ${HAND}`
    ctx.fillStyle = MUTED
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    ctx.fillText(String(page).padStart(2, '0'), PAPER.x + 26 * K, PAPER.y + PAPER.h - 13 * K)
    ctx.restore()
  }

  /** The replay's caption pill: paper at 90%, scrawl hand, hard offset shadow, near the top of the page. */
  private drawCaption(ctx: CanvasRenderingContext2D, caption: string): void {
    ctx.save()
    const fontPx = 24 * K
    const lineH = fontPx * 1.375
    ctx.font = `${fontPx}px ${SCRAWL}`
    const padX = 24 * K
    const padY = 8 * K
    const lines = wrap(ctx, caption, 768 * K - padX * 2).slice(-3)
    let tw = 0
    for (const l of lines) tw = Math.max(tw, ctx.measureText(l).width)
    const w = tw + padX * 2
    const h = lines.length * lineH + padY * 2
    const x = PAPER.x + PAPER.w / 2 - w / 2
    const y = PAPER.y + 64 * K
    ctx.fillStyle = 'rgba(59,47,47,0.25)'
    ctx.beginPath()
    ctx.roundRect(x + 3, y + 4, w, h, 16 * K)
    ctx.fill()
    ctx.fillStyle = 'rgba(251,246,234,0.9)'
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, 16 * K)
    ctx.fill()
    ctx.fillStyle = INK
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    lines.forEach((l, i) => ctx.fillText(l, x + w / 2, y + padY + lineH * (i + 0.5)))
    ctx.restore()
  }

  /** "Made with Once Upon" on fresh paper, paper-sized. */
  private endCard(): HTMLCanvasElement {
    if (this.end) return this.end
    const paper = makePaper(PAPER.w, PAPER.h, CPU)
    const ctx = paper.getContext('2d', CPU)
    if (!ctx) return paper
    const cx = PAPER.w / 2
    const cy = PAPER.h / 2
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = INK
    ctx.font = `${40 * K}px ${SCRAWL}`
    ctx.fillText('Made with', cx, cy - 58 * K)
    ctx.fillStyle = PURPLE
    ctx.font = `${76 * K}px ${SCRAWL}`
    ctx.fillText('Once Upon', cx, cy + 20 * K)
    const nameW = ctx.measureText('Once Upon').width
    // A lilac crayon swash under the name, seeded wobble.
    const rng = mulberry32(0x0ce0)
    ctx.strokeStyle = LILAC
    ctx.lineCap = 'round'
    ctx.lineWidth = 9 * K
    ctx.beginPath()
    const y0 = cy + 72 * K
    for (let i = 0; i <= 24; i++) {
      const px = cx - nameW / 2 + (nameW * i) / 24
      const py = y0 + Math.sin(i / 3.2) * 3 * K + (rng() - 0.5) * 2 * K
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.fillStyle = CORAL
    ctx.font = `${30 * K}px ${HAND}`
    ctx.fillText('✦', cx + nameW / 2 + 26 * K, cy - 18 * K)
    ctx.fillText('✦', cx - nameW / 2 - 30 * K, cy + 40 * K)
    this.end = paper
    return paper
  }
}
