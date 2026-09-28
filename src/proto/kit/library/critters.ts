/**
 * Front-facing critters (bear, bunny, monkey...), birds, water animals and bugs.
 */
import { blob, circle, ink, light, line, oval, P, path, patch, poly, rrect, scallop, shade, starPts, type KitShape } from '../geom'
import { C, slot } from '../palette'
import type { KitDef, KitDrawing, KitParams } from '../types'

/* ---------- front-facing critters ---------- */

type CEar = 'round' | 'bunny' | 'mouse' | 'monkey' | 'koala' | 'none' | 'cat'

interface Critter {
  body: string
  second: string
  ear: CEar
  muzzle: boolean
  belly: boolean
  headR: number
  bodyRx: number
  bodyRy: number
  height: number
  tail?: 'bunny' | 'monkey' | 'none'
  panda?: boolean
  nose?: string
}

const CRITTERS: Record<string, Critter> = {
  bear: { body: 'brown', second: 'tan', ear: 'round', muzzle: true, belly: true, headR: 66, bodyRx: 70, bodyRy: 78, height: 280, nose: 'black' },
  teddy: { body: 'golden', second: 'cream', ear: 'round', muzzle: true, belly: true, headR: 62, bodyRx: 62, bodyRy: 66, height: 250, nose: 'darkbrown' },
  panda: { body: 'white', second: 'black', ear: 'round', muzzle: false, belly: false, headR: 66, bodyRx: 70, bodyRy: 76, height: 275, panda: true, nose: 'black' },
  koala: { body: 'gray', second: 'white', ear: 'koala', muzzle: false, belly: true, headR: 64, bodyRx: 60, bodyRy: 66, height: 250, nose: 'black' },
  bunny: { body: 'white', second: 'pink', ear: 'bunny', muzzle: false, belly: true, headR: 56, bodyRx: 56, bodyRy: 64, height: 300, tail: 'bunny', nose: 'pink' },
  monkey: { body: 'brown', second: 'peach', ear: 'monkey', muzzle: true, belly: true, headR: 58, bodyRx: 54, bodyRy: 64, height: 250, tail: 'monkey', nose: 'darkbrown' },
  hamster: { body: 'ginger', second: 'cream', ear: 'round', muzzle: false, belly: true, headR: 56, bodyRx: 62, bodyRy: 56, height: 190, nose: 'pink' },
  kitty: { body: 'gray', second: 'white', ear: 'cat', muzzle: false, belly: true, headR: 62, bodyRx: 56, bodyRy: 62, height: 250, nose: 'pink' },
}

function buildCritter(c: Critter, p: KitParams): KitDrawing {
  const body = slot(p, 0, c.body)
  const second = slot(p, 1, c.second)
  const dark = c.panda ? second : shade(body, 0.2)
  const { headR: r, bodyRx: bx, bodyRy: bry } = c
  const bcy = -bry - 8
  const hcy = bcy - bry * 0.62 - r * 0.72
  const shapes: KitShape[] = []
  const sit = p.pose === 'sit' || p.pose === 'sleep'
  if (c.tail === 'monkey') shapes.push({ id: 'tail', color: ink(body), path: [['M', -bx * 0.6, bcy + bry * 0.5], ['C', -bx * 1.8, bcy + bry * 0.6, -bx * 1.9, bcy - bry * 0.9, -bx * 1.3, bcy - bry * 0.8], ['C', -bx * 1.0, bcy - bry * 0.7, -bx * 1.1, bcy - bry * 0.35, -bx * 1.35, bcy - bry * 0.45]] })
  // legs / feet
  const legCol = c.panda ? second : body
  if (!sit) {
    shapes.push(rrect('leg', legCol, bx * 0.2, bcy + bry * 0.5, bx * 0.42, -bcy - bry * 0.5 - 4, 14))
    shapes.push(rrect('leg2', legCol, -bx * 0.62, bcy + bry * 0.5, bx * 0.42, -bcy - bry * 0.5 - 4, 14))
  }
  shapes.push(oval('foot', legCol, bx * 0.45, -12, bx * 0.34, 14), oval('foot2', legCol, -bx * 0.45, -12, bx * 0.34, 14))
  // arms behind the body edge
  const armCol = c.panda ? second : body
  shapes.push(blob('arm', armCol, [P(bx * 0.7, bcy - bry * 0.55), P(bx * 1.25, bcy - bry * 0.05), P(bx * 1.15, bcy + bry * 0.3), P(bx * 0.75, bcy + bry * 0.05)]))
  shapes.push(blob('arm2', armCol, [P(-bx * 0.7, bcy - bry * 0.55), P(-bx * 1.25, bcy - bry * 0.05), P(-bx * 1.15, bcy + bry * 0.3), P(-bx * 0.75, bcy + bry * 0.05)]))
  shapes.push(blob('body', body, [P(0, bcy - bry), P(bx * 0.85, bcy - bry * 0.55), P(bx, bcy + bry * 0.35), P(bx * 0.55, bcy + bry), P(-bx * 0.55, bcy + bry), P(-bx, bcy + bry * 0.35), P(-bx * 0.85, bcy - bry * 0.55)]))
  if (c.belly) shapes.push(patch(oval('belly', light(second, 0.25), 0, bcy + bry * 0.18, bx * 0.55, bry * 0.6)))
  // ears
  switch (c.ear) {
    case 'round':
      shapes.push(circle('ear', dark, r * 0.72, hcy - r * 0.72, r * 0.34), circle('ear2', dark, -r * 0.72, hcy - r * 0.72, r * 0.34))
      if (!c.panda) shapes.push(patch(circle('earin', light(second, 0.2), r * 0.72, hcy - r * 0.72, r * 0.17)), patch(circle('earin2', light(second, 0.2), -r * 0.72, hcy - r * 0.72, r * 0.17)))
      break
    case 'koala':
      shapes.push({ id: 'ear', color: ink(body), fill: body, path: scallop(r * 0.95, hcy - r * 0.45, r * 0.5, r * 0.46, 7, 0.08) }, { id: 'ear2', color: ink(body), fill: body, path: scallop(-r * 0.95, hcy - r * 0.45, r * 0.5, r * 0.46, 7, 0.08) })
      shapes.push(patch(circle('earin', C('white'), r * 0.95, hcy - r * 0.45, r * 0.26)), patch(circle('earin2', C('white'), -r * 0.95, hcy - r * 0.45, r * 0.26)))
      break
    case 'bunny':
      shapes.push(oval('ear', body, r * 0.38, hcy - r * 1.55, r * 0.28, r * 0.85), oval('ear2', body, -r * 0.38, hcy - r * 1.55, r * 0.28, r * 0.85))
      shapes.push(patch(oval('earin', second, r * 0.38, hcy - r * 1.5, r * 0.13, r * 0.6)), patch(oval('earin2', second, -r * 0.38, hcy - r * 1.5, r * 0.13, r * 0.6)))
      break
    case 'mouse':
      shapes.push(circle('ear', body, r * 0.8, hcy - r * 0.75, r * 0.5), circle('ear2', body, -r * 0.8, hcy - r * 0.75, r * 0.5))
      break
    case 'monkey':
      shapes.push(circle('ear', body, r * 1.02, hcy + r * 0.05, r * 0.3), circle('ear2', body, -r * 1.02, hcy + r * 0.05, r * 0.3))
      shapes.push(patch(circle('earin', second, r * 1.02, hcy + r * 0.05, r * 0.16)), patch(circle('earin2', second, -r * 1.02, hcy + r * 0.05, r * 0.16)))
      break
    case 'cat':
      shapes.push(poly('ear', body, [P(r * 0.2, hcy - r * 0.85), P(r * 0.75, hcy - r * 1.35), P(r * 0.9, hcy - r * 0.45)]), poly('ear2', body, [P(-r * 0.2, hcy - r * 0.85), P(-r * 0.75, hcy - r * 1.35), P(-r * 0.9, hcy - r * 0.45)]))
      break
    case 'none':
      break
  }
  shapes.push(circle('head', body, 0, hcy, r))
  if (c.ear === 'monkey') shapes.push(patch(blob('face', second, [P(-r * 0.62, hcy - r * 0.2), P(-r * 0.3, hcy - r * 0.62), P(0, hcy - r * 0.3), P(r * 0.3, hcy - r * 0.62), P(r * 0.62, hcy - r * 0.2), P(r * 0.5, hcy + r * 0.62), P(-r * 0.5, hcy + r * 0.62)])))
  if (c.panda) shapes.push(patch(oval('patch', second, r * 0.33, hcy - r * 0.12, r * 0.24, r * 0.3)), patch(oval('patch2', second, -r * 0.33, hcy - r * 0.12, r * 0.24, r * 0.3)))
  if (c.muzzle) shapes.push(oval('muzzle', light(second, 0.3), 0, hcy + r * 0.42, r * 0.4, r * 0.3))
  const noseCol = C(c.nose ?? 'black')
  if (c.ear === 'koala') shapes.push(oval('nose', noseCol, 0, hcy + r * 0.2, r * 0.2, r * 0.3))
  else shapes.push(oval('nose', noseCol, 0, hcy + (c.muzzle ? r * 0.3 : r * 0.28), r * 0.13, r * 0.09))
  shapes.push(patch(oval('cheek', C('pink'), r * 0.55, hcy + r * 0.32, r * 0.16, r * 0.1)), patch(oval('cheek2', C('pink'), -r * 0.55, hcy + r * 0.32, r * 0.16, r * 0.1)))
  if (c.tail === 'bunny') shapes.push({ id: 'tailpuff', color: '#b8b0a8', fill: C('white'), path: scallop(bx * 0.95, -18, 16, 14, 6, 0.15) })
  return { shapes, head: { id: 'head', cx: 0, cy: hcy, r, facing: 'front' }, neck: { x: 0, y: hcy + r * 0.95, w: r * 1.1 } }
}

function critter(kind: string, doc: string, aliases?: string[]): KitDef {
  const c = CRITTERS[kind]
  if (!c) throw new Error(kind)
  return { kind, ...(aliases ? { aliases } : {}), doc, height: c.height, idle: 'breathe', character: true, build: (p) => buildCritter(c, p) }
}

/* ---------- birds ---------- */

function bird(p: KitParams, o: { body: string; wing: string; beak: string; r: number; tall: number; crest?: boolean; duck?: boolean; comb?: boolean }): KitDrawing {
  const body = slot(p, 0, o.body)
  const wing = slot(p, 1, o.wing)
  const beak = slot(p, 2, o.beak)
  const fly = p.pose === 'fly'
  const shapes: KitShape[] = []
  const by = fly ? -40 : -o.tall * 0.42
  if (!fly) {
    const foot = o.duck ? C('orange') : C('orange')
    shapes.push({ id: 'legs', color: shade(foot, 0.2), path: [['M', -12, by + 50], ['L', -14, -2], ['L', -30, -2], ['M', 14, by + 50], ['L', 16, -2], ['L', 32, -2]] })
  }
  // tail
  shapes.push(blob('tail', wing, [P(-o.r * 0.8, by - 10), P(-o.r * 1.6, by - o.r * 0.55), P(-o.r * 1.55, by + o.r * 0.1), P(-o.r * 0.8, by + 20)]))
  shapes.push(blob('body', body, [P(-o.r, by), P(-o.r * 0.6, by - o.r * 0.7), P(o.r * 0.5, by - o.r * 0.75), P(o.r * 1.0, by - o.r * 0.1), P(o.r * 0.6, by + o.r * 0.7), P(-o.r * 0.5, by + o.r * 0.72)]))
  shapes.push(patch(oval('belly', light(body, 0.45), o.r * 0.25, by + o.r * 0.2, o.r * 0.5, o.r * 0.42)))
  const hr = o.r * 0.62
  const hx = o.r * 0.75
  const hy = by - o.r * 0.95
  if (o.comb) shapes.push({ id: 'comb', color: ink(C('red')), fill: C('red'), path: scallop(hx - 4, hy - hr * 0.95, hr * 0.5, hr * 0.28, 4, 0.2, Math.PI) })
  if (o.crest) shapes.push(poly('crest', wing, [P(hx - hr * 0.2, hy - hr * 0.8), P(hx - hr * 0.5, hy - hr * 1.6), P(hx + hr * 0.2, hy - hr * 0.95)]))
  shapes.push(circle('head', body, hx, hy, hr))
  if (o.duck) shapes.push(path('beak', beak, [['M', hx + hr * 0.7, hy + hr * 0.05], ['Q', hx + hr * 1.7, hy - hr * 0.05, hx + hr * 1.75, hy + hr * 0.3], ['Q', hx + hr * 1.5, hy + hr * 0.55, hx + hr * 0.75, hy + hr * 0.45], ['Z']]))
  else shapes.push(poly('beak', beak, [P(hx + hr * 0.8, hy - hr * 0.2), P(hx + hr * 1.6, hy + hr * 0.12), P(hx + hr * 0.82, hy + hr * 0.4)]))
  if (o.comb) shapes.push(blob('wattle', C('red'), [P(hx + hr * 0.7, hy + hr * 0.45), P(hx + hr * 0.95, hy + hr * 0.5), P(hx + hr * 0.85, hy + hr * 0.95)]))
  // wing over the body
  if (fly) shapes.push(blob('wing', wing, [P(-o.r * 0.3, by - o.r * 0.3), P(-o.r * 0.9, by - o.r * 1.9), P(o.r * 0.1, by - o.r * 1.5), P(o.r * 0.35, by - o.r * 0.35)]))
  else shapes.push(blob('wing', wing, [P(-o.r * 0.55, by - o.r * 0.25), P(o.r * 0.2, by - o.r * 0.35), P(o.r * 0.35, by + o.r * 0.1), P(-o.r * 0.2, by + o.r * 0.45), P(-o.r * 0.75, by + o.r * 0.2)]))
  shapes.push(patch(oval('cheek', C('pink'), hx + hr * 0.45, hy + hr * 0.42, hr * 0.2, hr * 0.12)))
  return { shapes, head: { id: 'head', cx: hx, cy: hy, r: hr, facing: 'right' } }
}

function owl(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'brown')
  const second = slot(p, 1, 'tan')
  const shapes: KitShape[] = [
    { id: 'feet', color: C('orange'), path: [['M', -30, -14], ['L', -34, 0], ['M', -24, -14], ['L', -24, 0], ['M', 24, -14], ['L', 24, 0], ['M', 30, -14], ['L', 34, 0]] },
    blob('body', body, [P(0, -250), P(78, -200), P(85, -80), P(50, -12), P(-50, -12), P(-85, -80), P(-78, -200)]),
    poly('tuft', body, [P(-72, -205), P(-78, -265), P(-35, -225)]),
    poly('tuft2', body, [P(72, -205), P(78, -265), P(35, -225)]),
    patch(oval('belly', light(second, 0.2), 0, -85, 52, 60)),
    { id: 'chevrons', color: shade(second, 0.35), path: [['M', -24, -110], ['L', -14, -100], ['L', -4, -110], ['M', 4, -110], ['L', 14, -100], ['L', 24, -110], ['M', -14, -80], ['L', -4, -70], ['L', 6, -80], ['M', 10, -60], ['L', 20, -50], ['L', 30, -60]] },
    blob('wing', shade(body, 0.2), [P(70, -170), P(98, -110), P(80, -50), P(60, -100)]),
    blob('wing2', shade(body, 0.2), [P(-70, -170), P(-98, -110), P(-80, -50), P(-60, -100)]),
    oval('head', light(second, 0.35), 0, -185, 70, 50),
    poly('beak', C('orange'), [P(-10, -175), P(10, -175), P(0, -150)]),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -185, r: 70, facing: 'front' } }
}

function penguin(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'black')
  const shapes: KitShape[] = [
    oval('foot', C('orange'), 26, -8, 24, 10),
    oval('foot2', C('orange'), -26, -8, 24, 10),
    blob('body', body, [P(0, -250), P(62, -200), P(78, -70), P(45, -10), P(-45, -10), P(-78, -70), P(-62, -200)]),
    blob('flipper', body, [P(62, -150), P(100, -80), P(85, -70), P(58, -110)]),
    blob('flipper2', body, [P(-62, -150), P(-100, -80), P(-85, -70), P(-58, -110)]),
    blob('belly', C('white'), [P(0, -190), P(48, -140), P(52, -60), P(0, -20), P(-52, -60), P(-48, -140)], '#9a9aa4'),
    circle('head', C('white'), 0, -190, 44, '#9a9aa4'),
    poly('beak', C('orange'), [P(-12, -170), P(12, -170), P(0, -150)]),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -195, r: 44, facing: 'front' }, neck: { x: 0, y: -148, w: 80 } }
}

/* ---------- water ---------- */

function fish(p: KitParams, shark = false): KitDrawing {
  const body = slot(p, 0, shark ? 'gray' : 'orange')
  const fin = slot(p, 1, shark ? 'gray' : 'yellow')
  const L = shark ? 170 : 90
  const H = shark ? 60 : 55
  const shapes: KitShape[] = [
    poly('tail', fin, [P(-L * 0.85, 0), P(-L * 1.35, -H * 0.8), P(-L * 1.2, 0), P(-L * 1.35, H * 0.8)]),
    poly('fin', fin, shark ? [P(-L * 0.2, -H * 0.8), P(L * 0.05, -H * 1.8), P(L * 0.2, -H * 0.8)] : [P(-L * 0.3, -H * 0.8), P(-L * 0.05, -H * 1.3), P(L * 0.2, -H * 0.85)]),
    blob('body', body, [P(-L, 0), P(-L * 0.4, -H), P(L * 0.5, -H * 0.85), P(L, -H * 0.1), P(L * 0.55, H * 0.8), P(-L * 0.4, H * 0.9)]),
  ]
  if (shark) shapes.push(patch(blob('belly', C('white'), [P(-L * 0.6, H * 0.5), P(L * 0.6, H * 0.35), P(L * 0.85, H * 0.05), P(L * 0.3, H * 0.75), P(-L * 0.4, H * 0.85)])))
  else {
    shapes.push(patch(blob('stripe', light(body, 0.55), [P(-L * 0.3, -H * 0.75), P(-L * 0.12, -H * 0.8), P(-L * 0.1, H * 0.8), P(-L * 0.3, H * 0.75)])))
    shapes.push(blob('side', fin, [P(0, H * 0.05), P(L * 0.3, H * 0.2), P(0, H * 0.5)]))
  }
  return { shapes, head: { id: 'head', cx: L * 0.5, cy: -H * 0.12, r: H * 0.62, facing: 'right', hidden: true } }
}

function whale(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'blue')
  const shapes: KitShape[] = [
    { id: 'spout', color: '#5aa6e0', path: [['M', 60, -150], ['Q', 40, -210, 10, -220], ['M', 60, -150], ['Q', 62, -215, 60, -235], ['M', 60, -150], ['Q', 80, -210, 110, -220]] },
    poly('tail', body, [P(-150, -60), P(-230, -140), P(-210, -60), P(-240, 0)]),
    blob('body', body, [P(-170, -40), P(-60, -140), P(120, -120), P(180, -40), P(120, 30), P(-80, 30)]),
    patch(blob('belly', light(body, 0.55), [P(-100, 10), P(40, -10), P(160, -20), P(110, 25), P(-60, 30)])),
  ]
  return { shapes, head: { id: 'body', cx: 90, cy: -60, r: 70, facing: 'right' } }
}

function octopus(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'purple')
  const shapes: KitShape[] = []
  for (let i = 0; i < 6; i++) {
    const x = -75 + i * 30
    const dir = i % 2 === 0 ? -1 : 1
    shapes.push({ id: `leg${i}`, color: ink(body), fill: body, path: [['M', x - 10, -80], ['Q', x - 14, -40, x + dir * 20, -10], ['Q', x + dir * 30, 4, x + dir * 12, 6], ['Q', x + 12, -30, x + 12, -80], ['Z']] })
  }
  shapes.push(blob('head', body, [P(0, -230), P(80, -180), P(85, -100), P(0, -70), P(-85, -100), P(-80, -180)]))
  shapes.push(patch(circle('spot', light(body, 0.4), -30, -190, 12)), patch(circle('spot2', light(body, 0.4), 34, -200, 8)))
  return { shapes, head: { id: 'head', cx: 0, cy: -140, r: 80, facing: 'front' } }
}

function turtle(p: KitParams): KitDrawing {
  const shell = slot(p, 0, 'darkgreen')
  const skin = slot(p, 1, 'lightgreen')
  const shapes: KitShape[] = [
    oval('leg', skin, -60, -18, 22, 20),
    oval('leg2', skin, 60, -18, 22, 20),
    poly('tail', skin, [P(-110, -40), P(-140, -30), P(-105, -25)]),
    circle('head', skin, 130, -80, 38),
    path('shell', shell, [['M', -115, -30], ['C', -110, -150, 110, -150, 115, -30], ['Z']]),
    rrect('rim', light(shell, 0.4), -122, -38, 244, 16, 8),
    { id: 'hex', color: light(shell, 0.45), path: [['M', -40, -40], ['L', -25, -95], ['L', 25, -95], ['L', 40, -40], ['M', -25, -95], ['L', -60, -110], ['M', 25, -95], ['L', 60, -110]] },
  ]
  return { shapes, head: { id: 'head', cx: 130, cy: -80, r: 38, facing: 'right' } }
}

function crab(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const shapes: KitShape[] = [
    { id: 'legs', color: ink(c), path: [['M', -50, -30], ['L', -85, -5], ['M', -40, -25], ['L', -70, 0], ['M', 50, -30], ['L', 85, -5], ['M', 40, -25], ['L', 70, 0]] },
    { id: 'arms', color: ink(c), path: [['M', -60, -60], ['L', -85, -110], ['M', 60, -60], ['L', 85, -110]] },
    blob('claw', c, [P(-85, -110), P(-115, -140), P(-95, -165), P(-70, -150), P(-85, -135)]),
    blob('claw2', c, [P(85, -110), P(115, -140), P(95, -165), P(70, -150), P(85, -135)]),
    oval('head', c, 0, -55, 75, 42),
    { id: 'stalks', color: ink(c), path: [['M', -18, -90], ['L', -22, -115], ['M', 18, -90], ['L', 22, -115]] },
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -55, r: 50, facing: 'front' } }
}

/* ---------- bugs and friends ---------- */

function butterfly(p: KitParams): KitDrawing {
  const w = slot(p, 0, 'pink')
  const w2 = slot(p, 1, 'yellow')
  const shapes: KitShape[] = [
    blob('wing', w, [P(4, -10), P(70, -80), P(95, -30), P(40, 0)]),
    blob('wing2', w, [P(-4, -10), P(-70, -80), P(-95, -30), P(-40, 0)]),
    blob('wing3', w2, [P(4, 0), P(60, 10), P(55, 55), P(15, 30)]),
    blob('wing4', w2, [P(-4, 0), P(-60, 10), P(-55, 55), P(-15, 30)]),
    patch(circle('dot', C('white'), 55, -40, 10)),
    patch(circle('dot2', C('white'), -55, -40, 10)),
    oval('bodyb', C('black'), 0, 0, 9, 42),
    { id: 'antenna', color: C('black'), path: [['M', -3, -40], ['Q', -10, -70, -26, -78], ['M', 3, -40], ['Q', 10, -70, 26, -78]] },
  ]
  return { shapes, noFace: true }
}

function bee(p: KitParams): KitDrawing {
  const shapes: KitShape[] = [
    oval('wing', '#e8f4fb', -8, -58, 26, 34, '#8fb4cc'),
    oval('wing2', '#e8f4fb', 22, -54, 22, 30, '#8fb4cc'),
    poly('stinger', C('black'), [P(-58, -2), P(-78, 4), P(-58, 10)]),
    oval('body', slot(p, 0, 'yellow'), 0, 0, 58, 40),
    patch(rrect('band', C('black'), -30, -38, 14, 76, 6)),
    patch(rrect('band2', C('black'), 0, -40, 14, 80, 6)),
    circle('head', slot(p, 0, 'yellow'), 50, -4, 30),
    { id: 'antenna', color: C('black'), path: [['M', 50, -32], ['Q', 56, -60, 70, -64], ['M', 58, -30], ['Q', 72, -52, 86, -52]] },
  ]
  return { shapes, head: { id: 'head', cx: 50, cy: -4, r: 30, facing: 'right' } }
}

function snake(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'green')
  const c2 = slot(p, 1, 'yellow')
  const shapes: KitShape[] = [
    path('body', c, [['M', -150, -10], ['C', -120, -70, -60, -70, -40, -20], ['C', -20, 30, 40, 30, 60, -20], ['C', 80, -70, 110, -90, 120, -110], ['L', 138, -95], ['C', 120, -60, 100, -40, 80, -10], ['C', 50, 50, -40, 50, -65, -5], ['C', -80, -40, -110, -40, -130, 0], ['Z']]),
    { id: 'marks', color: c2, path: [['M', -100, -45], ['L', -95, -30], ['M', -60, -45], ['L', -58, -30], ['M', 20, 22], ['L', 20, 8], ['M', 60, 5], ['L', 72, -8]] },
    oval('head', c, 140, -115, 34, 26),
    { id: 'tongue', color: C('red'), path: [['M', 172, -110], ['L', 196, -104], ['L', 204, -112], ['M', 196, -104], ['L', 204, -98]] },
  ]
  return { shapes, head: { id: 'head', cx: 140, cy: -115, r: 30, facing: 'right' } }
}

function frog(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'green')
  const shapes: KitShape[] = [
    oval('leg', c, 72, -26, 52, 26),
    oval('leg2', c, -72, -26, 52, 26),
    oval('body', c, 0, -80, 84, 64),
    patch(oval('belly', light(c, 0.5), 0, -62, 52, 38)),
    oval('head', c, 0, -150, 78, 50),
    circle('bump', c, 42, -196, 24),
    circle('bump2', c, -42, -196, 24),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -165, r: 70, facing: 'front' } }
}

function ladybug(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const shapes: KitShape[] = [
    circle('head', C('black'), 60, -40, 30),
    path('body', c, [['M', -70, -2], ['C', -70, -110, 70, -110, 70, -2], ['Z']]),
    { id: 'split', color: C('black'), path: [['M', 0, -78], ['L', 0, -2]] },
    patch(circle('dot', C('black'), -34, -44, 12)),
    patch(circle('dot2', C('black'), 30, -52, 12)),
    patch(circle('dot3', C('black'), -30, -16, 9)),
    patch(circle('dot4', C('black'), 36, -18, 9)),
  ]
  return { shapes, head: { id: 'head', cx: 60, cy: -40, r: 30, facing: 'right' } }
}

function snail(p: KitParams): KitDrawing {
  const shell = slot(p, 0, 'coral')
  const body = slot(p, 1, 'tan')
  const shapes: KitShape[] = [
    path('foot', body, [['M', -90, 0], ['Q', 0, -20, 90, -10], ['Q', 110, -60, 95, -80], ['L', 70, -70], ['Q', 70, -30, 40, -25], ['L', -90, -10], ['Z']]),
    circle('shell', shell, -10, -70, 60),
    { id: 'swirl', color: ink(shell), path: [['M', -10, -70], ['C', 10, -70, 10, -95, -12, -95], ['C', -40, -95, -45, -55, -10, -48], ['C', 30, -40, 45, -90, 5, -118]] },
    circle('head', body, 95, -85, 22),
    { id: 'stalks', color: ink(body), path: [['M', 90, -105], ['L', 82, -135], ['M', 102, -105], ['L', 110, -135]] },
  ]
  return { shapes, head: { id: 'head', cx: 95, cy: -85, r: 22, facing: 'right' } }
}

const d = (kind: string, doc: string, height: number, build: (p: KitParams) => KitDrawing, o: Partial<Pick<KitDef, 'aliases' | 'idle' | 'air' | 'character'>> = {}): KitDef => ({
  kind,
  doc,
  height,
  idle: o.idle ?? 'breathe',
  character: o.character ?? true,
  ...(o.aliases ? { aliases: o.aliases } : {}),
  ...(o.air ? { air: true } : {}),
  build,
})

export const CRITTER_KITS: KitDef[] = [
  critter('bear', 'bear [fur] [belly]', ['grizzly']),
  critter('teddy', 'teddy [fur] [belly]', ['teddybear']),
  critter('panda', 'panda'),
  critter('koala', 'koala [fur]'),
  critter('bunny', 'bunny [fur] [inner ears]', ['rabbit', 'bunnies', 'hare']),
  critter('monkey', 'monkey [fur] [face]', ['ape', 'chimp']),
  critter('hamster', 'hamster [fur]', ['guinea']),
  d('bird', 'bird [body] [wing] [beak] (pose fly)', 200, (p) => bird(p, { body: 'skyblue', wing: 'blue', beak: 'orange', r: 62, tall: 200 }), { aliases: ['birdie', 'robin', 'parrot', 'bluebird'] }),
  d('chicken', 'chicken [body] [wing]', 220, (p) => bird(p, { body: 'white', wing: 'cream', beak: 'orange', r: 70, tall: 220, comb: true }), { aliases: ['hen', 'rooster', 'chick'] }),
  d('duck', 'duck [body] [wing] [beak]', 200, (p) => bird(p, { body: 'yellow', wing: 'golden', beak: 'orange', r: 66, tall: 180, duck: true }), { aliases: ['duckling', 'goose'] }),
  d('owl', 'owl [body] [chest]', 265, owl),
  d('penguin', 'penguin [body]', 255, penguin),
  d('fish', 'fish [body] [fins] (y 450 in water)', 110, (p) => fish(p), { aliases: ['goldfish'], idle: 'float' }),
  d('shark', 'shark [body]', 180, (p) => fish(p, true), { idle: 'float' }),
  d('whale', 'whale [body]', 180, whale, { idle: 'float', aliases: ['dolphin'] }),
  d('octopus', 'octopus [body]', 235, octopus, { aliases: ['squid'] }),
  d('turtle', 'turtle [shell] [skin]', 140, turtle, { aliases: ['tortoise'] }),
  d('crab', 'crab [shell]', 165, crab),
  d('frog', 'frog [skin]', 220, frog, { aliases: ['toad'] }),
  d('butterfly', 'butterfly [wings] [lower wings] (air)', 140, butterfly, { idle: 'float', air: true, character: false }),
  d('bee', 'bee (air)', 110, bee, { idle: 'float', air: true, aliases: ['bumblebee'] }),
  d('snake', 'snake [body] [marks]', 130, snake),
  d('ladybug', 'ladybug [shell]', 100, ladybug, { aliases: ['bug', 'beetle'] }),
  d('snail', 'snail [shell] [body]', 140, snail),
]

export { line, starPts }
