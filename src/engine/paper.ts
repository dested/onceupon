/** Cream construction paper with tooth. Rendered once per canvas size. */
export function makePaper(
  width: number,
  height: number,
  ctxOpts: CanvasRenderingContext2DSettings = {},
  /** Pop style: warmer fibers and a deeper vignette (the base color stays: knockouts paint it). */
  pop = false
): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, width)
  c.height = Math.max(1, height)
  const ctx = c.getContext('2d', ctxOpts)
  if (!ctx) return c
  ctx.fillStyle = '#fbf6ea'
  ctx.fillRect(0, 0, c.width, c.height)

  const tile = document.createElement('canvas')
  tile.width = 256
  tile.height = 256
  const tctx = tile.getContext('2d', ctxOpts)
  if (tctx) {
    const img = tctx.createImageData(256, 256)
    let h = 88172645
    for (let i = 0; i < img.data.length; i += 4) {
      h ^= h << 13
      h ^= h >>> 17
      h ^= h << 5
      const v = (h >>> 0) % 1000
      const dark = v < 60
      const light = v > 940
      img.data[i] = dark ? 120 : 255
      img.data[i + 1] = dark ? 100 : 255
      img.data[i + 2] = dark ? 80 : 250
      img.data[i + 3] = dark ? 26 : light ? 40 : 0
    }
    tctx.putImageData(img, 0, 0)
    const pattern = ctx.createPattern(tile, 'repeat')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, c.width, c.height)
    }
  }

  const grad = ctx.createRadialGradient(
    c.width / 2,
    c.height / 2,
    Math.min(c.width, c.height) * 0.35,
    c.width / 2,
    c.height / 2,
    Math.max(c.width, c.height) * 0.75
  )
  grad.addColorStop(0, 'rgba(120,90,40,0)')
  grad.addColorStop(1, pop ? 'rgba(130,85,35,0.16)' : 'rgba(120,90,40,0.10)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, c.width, c.height)
  if (pop) {
    // Paper fibers: short faint seeded hairlines.
    let h = 362436069
    const rand = (): number => {
      h ^= h << 13
      h ^= h >>> 17
      h ^= h << 5
      return ((h >>> 0) % 100000) / 100000
    }
    const n = Math.round((c.width * c.height) / 9000)
    ctx.lineWidth = Math.max(1, c.width / 1400)
    for (let i = 0; i < n; i++) {
      const x = rand() * c.width
      const y = rand() * c.height
      const a = rand() * Math.PI
      const len = (4 + rand() * 10) * (c.width / 1280)
      ctx.strokeStyle = rand() < 0.5 ? 'rgba(150,110,60,0.07)' : 'rgba(255,255,255,0.18)'
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len)
      ctx.stroke()
    }
  }
  return c
}
