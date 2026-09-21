import type { Shape } from './types'
import { shapeBounds } from './geometry'

export type Facing = 'front' | 'left' | 'right'
export type Expression = 'happy' | 'surprised' | 'sad'

export interface FacePart {
  id: string
  shape: Shape
}

const f2 = (n: number): string => (Math.round(n * 100) / 100).toString()

/**
 * Two eyes and a mouth anchored to a head contour. Always two eyes, the way a child draws them:
 * facing left/right only shifts the pair toward that side and turns the pupils.
 * Ids follow the JSON DSL contract (`<head>_eye0`, `<head>_eye0_pupil`, `<head>_mouth`) plus a
 * white `<head>_eye0w` under each eye so it reads on a colored-in head.
 */
export function faceShapes(headId: string, head: Shape, facing: Facing, expression: Expression, ink: string): FacePart[] {
  const b = shapeBounds(head)
  const w = b.maxX - b.minX
  const h = b.maxY - b.minY
  if (w <= 0 || h <= 0) return []
  const r = Math.max(0.5, Math.min(w, h) * 0.09)
  const eyeY = b.minY + h * 0.42
  const eyeXs =
    facing === 'front'
      ? [b.minX + w * 0.35, b.minX + w * 0.65]
      : facing === 'right'
        ? [b.minX + w * 0.5, b.minX + w * 0.74]
        : [b.minX + w * 0.26, b.minX + w * 0.5]
  const look = facing === 'right' ? r * 0.3 : facing === 'left' ? -r * 0.3 : 0
  const out: FacePart[] = []
  eyeXs.forEach((ex, i) => {
    const eye = `${headId}_eye${i}`
    out.push({ id: `${eye}w`, shape: { k: 'circle', cx: ex, cy: eyeY, r, color: '#ffffff', fill: true } })
    out.push({ id: eye, shape: { k: 'circle', cx: ex, cy: eyeY, r, color: ink, fill: false } })
    out.push({ id: `${eye}_pupil`, shape: { k: 'circle', cx: ex + look, cy: eyeY + r * 0.1, r: r * 0.45, color: '#1f1a1a', fill: true } })
  })
  const my = b.minY + h * 0.7
  const mx = b.minX + w * (facing === 'right' ? 0.62 : facing === 'left' ? 0.38 : 0.5)
  const mw = w * (facing === 'front' ? 0.18 : 0.15)
  let mouth: Shape
  if (expression === 'surprised') {
    mouth = { k: 'circle', cx: mx, cy: my + mw * 0.2, r: mw * 0.5, color: ink, fill: false }
  } else if (expression === 'sad') {
    const d = `M ${f2(mx - mw)} ${f2(my + mw * 0.5)} Q ${f2(mx)} ${f2(my - mw * 0.4)} ${f2(mx + mw)} ${f2(my + mw * 0.5)}`
    mouth = { k: 'path', d, color: ink, fill: false }
  } else {
    const d = `M ${f2(mx - mw)} ${f2(my)} Q ${f2(mx)} ${f2(my + mw * 0.9)} ${f2(mx + mw)} ${f2(my)}`
    mouth = { k: 'path', d, color: ink, fill: false }
  }
  out.push({ id: `${headId}_mouth`, shape: mouth })
  return out
}
