/** Cream construction paper with tooth. Rendered once per canvas size. */
export function makePaper(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, width)
  c.height = Math.max(1, height)
  const ctx = c.getContext('2d')
  if (!ctx) return c
  ctx.fillStyle = '#fbf6ea'
  ctx.fillRect(0, 0, c.width, c.height)

  const tile = document.createElement('canvas')
  tile.width = 256
  tile.height = 256
  const tctx = tile.getContext('2d')
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
  grad.addColorStop(1, 'rgba(120,90,40,0.10)')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}
