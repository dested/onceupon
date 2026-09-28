/**
 * Vehicles, scenery and props. Containers (boat, bed, car, nest, basket, wagon) return a `front`
 * (drawn on a layer above characters) and a `seat` where an occupant's feet go.
 */
import { blob, circle, ellipsePath, ink, light, line, oval, P, path, patch, poly, rect, rrect, scallop, shade, starPts, type KitShape, type PathCmd } from '../geom'
import { C, slot } from '../palette'
import type { KitDef, KitDrawing, KitParams } from '../types'
import { scaleDrawing } from './people'

/** Props sized to sit on a table or be held; `big` still fills the page. */
const sized = (b: (p: KitParams) => KitDrawing, s: number) => (p: KitParams): KitDrawing => scaleDrawing(b(p), s)

const wheel = (id: string, x: number, y: number, r: number): KitShape[] => [circle(id, C('black'), x, y, r, '#2a2226'), circle(`${id}_hub`, C('silver'), x, y, r * 0.42)]

/* ---------- vehicles ---------- */

function car(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const back: KitShape[] = [
    path('roof', c, [['M', -80, -80], ['Q', -60, -150, 10, -150], ['Q', 70, -150, 90, -80], ['Z']]),
    path('window', C('lightblue'), [['M', -62, -84], ['Q', -48, -134, 2, -134], ['L', 2, -84], ['Z']], ink(c)),
    path('window2', C('lightblue'), [['M', 16, -84], ['L', 16, -134], ['Q', 60, -134, 74, -84], ['Z']], ink(c)),
  ]
  const front: KitShape[] = [
    path('body', c, [['M', -150, -20], ['Q', -152, -84, -110, -86], ['L', 130, -86], ['Q', 160, -84, 160, -40], ['L', 160, -20], ['Z']]),
    patch(rrect('stripe', light(c, 0.45), -140, -62, 290, 12, 6)),
    circle('light', C('yellow'), 150, -60, 10),
    rect('bumper', C('silver'), 140, -32, 26, 12),
    ...wheel('wheel', -85, -18, 30),
    ...wheel('wheel2', 95, -18, 30),
  ]
  return { shapes: back, front, seat: P(-10, -70) }
}

function truck(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'blue')
  const c2 = slot(p, 1, 'orange')
  const shapes: KitShape[] = [
    rrect('cargo', c2, -190, -170, 230, 140, 8),
    rrect('cab', c, 50, -150, 110, 120, 12),
    rrect('window', C('lightblue'), 90, -135, 55, 45, 8, ink(c)),
    rect('base', shade(c, 0.3), -195, -40, 365, 22),
    circle('light', C('yellow'), 160, -60, 9),
    ...wheel('wheel', -130, -18, 32),
    ...wheel('wheel2', -40, -18, 32),
    ...wheel('wheel3', 110, -18, 32),
  ]
  return { shapes }
}

function bus(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'yellow')
  const shapes: KitShape[] = [rrect('body', c, -200, -190, 400, 170, 24)]
  for (let i = 0; i < 4; i++) shapes.push(rrect(`win${i}`, C('lightblue'), -175 + i * 80, -170, 60, 55, 8, ink(c)))
  shapes.push(rrect('door', C('lightblue'), 150, -170, 36, 130, 6, ink(c)), patch(rect('stripe', C('black'), -200, -95, 350, 10)), ...wheel('wheel', -120, -20, 32), ...wheel('wheel2', 110, -20, 32))
  return { shapes }
}

function train(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const c2 = slot(p, 1, 'blue')
  const shapes: KitShape[] = [
    rect('coupler', C('black'), -150, -45, 40, 10),
    rrect('wagon', c2, -290, -130, 145, 105, 8),
    rrect('wagonwin', C('lightblue'), -265, -110, 95, 40, 6, ink(c2)),
    ...wheel('wheelw', -255, -20, 24),
    ...wheel('wheelw2', -180, -20, 24),
    rrect('boiler', c, -110, -140, 200, 110, 20),
    rrect('cab', c, 60, -210, 100, 180, 10),
    rrect('cabwin', C('lightblue'), 80, -190, 60, 50, 8, ink(c)),
    rrect('roof', shade(c, 0.35), 50, -225, 120, 20, 6),
    rrect('chimney', C('black'), -80, -200, 40, 64, 6),
    rect('cowcatcher', C('silver'), -135, -50, 30, 30),
    circle('lamp', C('yellow'), -100, -110, 14),
    ...wheel('wheel', -60, -26, 30),
    ...wheel('wheel2', 20, -26, 30),
    ...wheel('wheel3', 110, -26, 34),
  ]
  return { shapes }
}

function boat(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'brown')
  const sail = slot(p, 1, 'white')
  const back: KitShape[] = [
    rect('mast', C('darkbrown'), -8, -300, 12, 260),
    path('sail', sail, [['M', 8, -290], ['Q', 90, -200, 120, -90], ['L', 8, -90], ['Z']], '#9a9aa4'),
    poly('flag', C('red'), [P(-4, -300), P(-4, -330), P(36, -315)]),
    path('hullback', shade(c, 0.25), [['M', -160, -80], ['L', 160, -80], ['L', 150, -60], ['L', -150, -60], ['Z']]),
  ]
  const front: KitShape[] = [
    path('hull', c, [['M', -175, -85], ['L', 175, -85], ['Q', 150, 0, 110, 0], ['L', -110, 0], ['Q', -150, 0, -175, -85], ['Z']]),
    patch(rrect('stripe', light(c, 0.4), -160, -70, 320, 12, 6)),
    { id: 'planks', color: shade(c, 0.35), path: [['M', -140, -40], ['L', 140, -40]] },
  ]
  return { shapes: back, front, seat: P(-40, -45) }
}

function ship(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'darkbrown')
  const shapes: KitShape[] = [
    rect('mast', C('darkbrown'), -8, -380, 14, 320),
    rrect('sail', C('white'), -110, -350, 220, 110, 10, '#9a9aa4'),
    rrect('sail2', C('white'), -90, -225, 180, 100, 10, '#9a9aa4'),
    poly('flag', C('black'), [P(-2, -380), P(-2, -420), P(50, -400)]),
    path('hull', c, [['M', -240, -120], ['L', 240, -120], ['Q', 200, 0, 150, 0], ['L', -150, 0], ['Q', -200, 0, -240, -120], ['Z']]),
    patch(rrect('stripe', C('golden'), -225, -100, 450, 14, 6)),
  ]
  for (let i = 0; i < 4; i++) shapes.push(circle(`port${i}`, C('black'), -120 + i * 80, -60, 12))
  return { shapes }
}

function airplane(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'white')
  const c2 = slot(p, 1, 'red')
  const shapes: KitShape[] = [
    poly('tail', c2, [P(-170, -10), P(-215, -110), P(-175, -110), P(-120, -20)]),
    poly('wing2', shade(c2, 0.2), [P(-20, 0), P(-60, -70), P(-20, -70), P(40, 0)]),
    path('body', c, [['M', -190, -10], ['Q', -180, -45, -120, -45], ['L', 130, -45], ['Q', 210, -40, 220, 0], ['Q', 210, 30, 130, 30], ['L', -150, 30], ['Q', -185, 25, -190, -10], ['Z']], '#6a6a78'),
    path('nose', C('lightblue'), [['M', 150, -40], ['Q', 200, -34, 212, -10], ['L', 150, -10], ['Z']], '#6a6a78'),
    poly('wing', c2, [P(-30, 5), P(-80, 90), P(-30, 90), P(50, 5)]),
    patch(rrect('stripe', c2, -170, 0, 320, 10, 5)),
  ]
  for (let i = 0; i < 4; i++) shapes.push(circle(`win${i}`, C('lightblue'), -80 + i * 50, -18, 12, '#6a6a78'))
  return { shapes, noFace: true }
}

function rocket(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'white')
  const c2 = slot(p, 1, 'red')
  const shapes: KitShape[] = [
    blob('flame', C('orange'), [P(-30, -30), P(0, 50), P(30, -30)], C('red')),
    patch(blob('flame2', C('yellow'), [P(-15, -30), P(0, 18), P(15, -30)])),
    poly('fin', c2, [P(-50, -150), P(-100, -40), P(-45, -60)]),
    poly('fin2', c2, [P(50, -150), P(100, -40), P(45, -60)]),
    path('body', c, [['M', -52, -40], ['L', -52, -220], ['Q', -45, -330, 0, -380], ['Q', 45, -330, 52, -220], ['L', 52, -40], ['Z']], '#6a6a78'),
    path('tip', c2, [['M', -40, -290], ['Q', -25, -350, 0, -380], ['Q', 25, -350, 40, -290], ['Z']]),
    circle('window', C('lightblue'), 0, -220, 28, '#6a6a78'),
    rect('base', shade(c2, 0.2), -52, -60, 104, 22),
  ]
  return { shapes }
}

function bike(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const shapes: KitShape[] = [
    { id: 'wheels', color: '#2a2226', circle: [-80, -50, 48] },
    { id: 'wheels2', color: '#2a2226', circle: [85, -50, 48] },
    { id: 'frame', color: ink(c), fill: c, path: [['M', -80, -50], ['L', -10, -50], ['L', 55, -120], ['L', -30, -120], ['Z'], ['M', 55, -120], ['L', 85, -50]] },
    { id: 'post', color: ink(c), path: [['M', -30, -120], ['L', -40, -150], ['M', 55, -120], ['L', 60, -165], ['L', 85, -170]] },
    rrect('saddle', C('black'), -65, -158, 50, 14, 7),
  ]
  return { shapes, seat: P(-40, -60) }
}

function helicopter(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'orange')
  const shapes: KitShape[] = [
    rect('rotorpost', C('black'), -6, -200, 12, 40),
    rrect('rotor', C('black'), -170, -208, 340, 10, 5),
    rrect('tailboom', c, -230, -130, 180, 30, 14),
    poly('tailfin', c, [P(-230, -130), P(-255, -180), P(-210, -130)]),
    blob('body', c, [P(-90, -110), P(-40, -170), P(80, -165), P(120, -100), P(60, -50), P(-60, -55)]),
    path('bubble', C('lightblue'), [['M', 20, -160], ['Q', 110, -155, 112, -100], ['L', 20, -100], ['Z']], ink(c)),
    { id: 'skids', color: '#2a2226', path: [['M', -80, -10], ['L', 100, -10], ['M', -40, -50], ['L', -40, -10], ['M', 50, -50], ['L', 50, -10]] },
  ]
  return { shapes }
}

function tractor(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'green')
  const shapes: KitShape[] = [
    rrect('hood', c, -20, -120, 160, 80, 10),
    rrect('cab', c, -130, -230, 120, 190, 10),
    rrect('window', C('lightblue'), -110, -210, 80, 70, 6, ink(c)),
    rect('pipe', C('black'), 100, -170, 14, 50),
    ...wheel('big', -80, -60, 60),
    ...wheel('small', 100, -34, 34),
  ]
  return { shapes, seat: P(-70, -110) }
}

/* ---------- scenery ---------- */

function tree(p: KitParams): KitDrawing {
  const crown = slot(p, 0, 'green')
  const fruit = p.colors[1]
  const shapes: KitShape[] = [
    path('trunk', C('brown'), [['M', -32, 2], ['Q', -24, -110, -28, -170], ['L', 28, -170], ['Q', 24, -110, 32, 2], ['Z']]),
    { id: 'bark', color: shade(C('brown'), 0.35), path: [['M', -8, -40], ['Q', 0, -60, -6, -80], ['M', 12, -110], ['Q', 16, -125, 10, -140]] },
    { id: 'crown', color: ink(crown), fill: crown, path: scallop(0, -250, 150, 120, 9, 0.09, 0.3) },
    patch(oval('shine', light(crown, 0.3), -50, -290, 48, 30)),
  ]
  if (fruit) for (let i = 0; i < 5; i++) shapes.push(circle(`fruit${i}`, fruit, -90 + i * 45, -250 + ((i * 37) % 60) - 20, 14))
  return { shapes, noFace: true }
}

function pine(p: KitParams): KitDrawing {
  const g = slot(p, 0, 'darkgreen')
  const shapes: KitShape[] = [rect('trunk', C('brown'), -18, -60, 36, 62)]
  for (let i = 0; i < 3; i++) {
    const top = -340 + i * 80
    const bot = -150 + i * 50
    const w = 70 + i * 40
    shapes.push(poly(`tier${i}`, g, [P(0, top), P(w, bot), P(-w, bot)]))
  }
  if (p.colors[1]) for (let i = 0; i < 6; i++) shapes.push(circle(`ball${i}`, p.colors[1] ?? C('red'), -60 + i * 24, -130 - (i % 3) * 60, 10))
  return { shapes, noFace: true }
}

function palm(p: KitParams): KitDrawing {
  const g = slot(p, 0, 'green')
  return {
    shapes: [
      path('trunk', C('tan'), [['M', -30, 2], ['Q', -40, -180, 10, -330], ['L', 32, -322], ['Q', -10, -180, 6, 2], ['Z']]),
      blob('frond', g, [P(20, -330), P(140, -380), P(200, -300), P(110, -330)]),
      blob('frond2', g, [P(20, -330), P(-110, -390), P(-170, -310), P(-80, -335)]),
      blob('frond3', g, [P(20, -330), P(40, -440), P(100, -450), P(60, -400)]),
      circle('coconut', C('brown'), 10, -312, 16),
      circle('coconut2', C('brown'), 34, -318, 16),
    ],
    noFace: true,
  }
}

function flower(p: KitParams): KitDrawing {
  const petals = slot(p, 0, 'pink')
  const mid = slot(p, 1, 'yellow')
  const shapes: KitShape[] = [
    { id: 'stem', color: C('darkgreen'), path: [['M', 0, 0], ['Q', 10, -60, 0, -110]] },
    blob('leaf', C('green'), [P(2, -40), P(40, -70), P(55, -50)]),
  ]
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    shapes.push(circle(`petal${i}`, petals, Math.cos(a) * 30, -140 + Math.sin(a) * 30, 22))
  }
  shapes.push(circle('head', mid, 0, -140, 24))
  return { shapes, head: { id: 'head', cx: 0, cy: -140, r: 24, facing: 'front' } }
}

function bush(p: KitParams): KitDrawing {
  const g = slot(p, 0, 'green')
  const shapes: KitShape[] = [{ id: 'bush', color: ink(g), fill: g, path: scallop(0, -70, 130, 75, 9, 0.08, 0.2) }]
  if (p.colors[1]) for (let i = 0; i < 5; i++) shapes.push(circle(`berry${i}`, p.colors[1] ?? C('red'), -80 + i * 40, -70 - ((i * 29) % 50) + 20, 10))
  return { shapes, noFace: true }
}

function mountain(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'gray')
  return { shapes: [poly('rock', c, [P(-260, 2), P(0, -380), P(260, 2)]), patch(poly('snow', C('white'), [P(0, -380), P(-70, -278), P(-30, -295), P(0, -265), P(35, -292), P(68, -282)]))], noFace: true }
}

function rainbow(p: KitParams): KitDrawing {
  const cols = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'].map((n) => C(n))
  const shapes: KitShape[] = cols.map((c, i) => {
    const r = 330 - i * 26
    return { id: `band${i}`, color: c, fill: c, path: [['M', -r, 0], ['C', -r, -r * 1.33, r, -r * 1.33, r, 0], ['L', r - 26, 0], ['C', r - 26, -(r - 26) * 1.33, -(r - 26), -(r - 26) * 1.33, -(r - 26), 0], ['Z']] satisfies PathCmd[] }
  })
  shapes.push({ id: 'cloudL', color: '#a9c6dc', fill: '#ffffff', path: scallop(-250, -20, 90, 40, 6, 0.14) }, { id: 'cloudR', color: '#a9c6dc', fill: '#ffffff', path: scallop(250, -20, 90, 40, 6, 0.14) })
  return { shapes, noFace: true }
}

function sunKit(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'yellow')
  const rays: PathCmd[] = []
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2
    rays.push(['M', Math.round(Math.cos(a) * 80), Math.round(Math.sin(a) * 80)], ['L', Math.round(Math.cos(a) * 110), Math.round(Math.sin(a) * 110)])
  }
  return { shapes: [{ id: 'rays', color: C('orange'), path: rays }, circle('head', c, 0, 0, 62, C('orange'))], head: { id: 'head', cx: 0, cy: 0, r: 62, facing: 'front' } }
}

function moonKit(p: KitParams): KitDrawing {
  const c = slot(p, 0, '#fff3c4')
  return { shapes: [path('head', c, [['M', -10, -80], ['C', 100, -80, 100, 80, -10, 80], ['C', 40, 40, 40, -40, -10, -80], ['Z']], '#d9b44a')], noFace: true }
}

function cloudKit(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'white')
  return { shapes: [{ id: 'head', color: '#a9c6dc', fill: c, path: scallop(0, 0, 130, 55, 8, 0.13, 0.3) }], noFace: true }
}

function starKit(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'yellow')
  return { shapes: [poly('head', c, starPts(0, -70, 70, 30), C('orange'))], noFace: true }
}

function heartKit(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  return { shapes: [path('heart', c, [['M', 0, -10], ['C', -110, -80, -70, -170, 0, -125], ['C', 70, -170, 110, -80, 0, -10], ['Z']])], noFace: true }
}

function house(p: KitParams): KitDrawing {
  const wall = slot(p, 0, 'yellow')
  const roof = slot(p, 1, 'red')
  const door = slot(p, 2, 'brown')
  return {
    shapes: [
      rect('chimney', C('brown'), 70, -330, 36, 80),
      rect('wall', wall, -140, -200, 280, 200),
      poly('roof', roof, [P(-170, -196), P(0, -340), P(170, -196)]),
      rrect('door', door, -30, -120, 64, 120, 26),
      circle('knob', C('golden'), 20, -60, 5),
      rect('window', C('lightblue'), -115, -160, 62, 58, ink(wall)),
      { id: 'windowx', color: ink(wall), path: [['M', -84, -160], ['L', -84, -102], ['M', -115, -131], ['L', -53, -131]] },
      rect('window2', C('lightblue'), 55, -160, 62, 58, ink(wall)),
      { id: 'window2x', color: ink(wall), path: [['M', 86, -160], ['L', 86, -102], ['M', 55, -131], ['L', 117, -131]] },
      patch(rect('step', C('gray'), -42, -6, 88, 8)),
    ],
    noFace: true,
  }
}

function castle(p: KitParams): KitDrawing {
  const st = slot(p, 0, '#c9c4d6')
  const rf = slot(p, 1, 'purple')
  const flag = slot(p, 2, 'red')
  const shapes: KitShape[] = [
    rect('wall', st, -170, -220, 340, 220),
    rect('tower', st, -230, -330, 90, 330),
    rect('tower2', st, 140, -330, 90, 330),
    rect('keep', st, -60, -340, 120, 130),
    poly('roof', rf, [P(-245, -330), P(-185, -440), P(-125, -330)]),
    poly('roof2', rf, [P(125, -330), P(185, -440), P(245, -330)]),
    poly('roof3', rf, [P(-75, -340), P(0, -430), P(75, -340)]),
    { id: 'poles', color: '#5a5a66', path: [['M', -185, -440], ['L', -185, -480], ['M', 185, -440], ['L', 185, -480]] },
    poly('flag', flag, [P(-185, -480), P(-140, -468), P(-185, -455)]),
    poly('flag2', flag, [P(185, -480), P(230, -468), P(185, -455)]),
    path('gate', C('brown'), [['M', -50, 0], ['L', -50, -90], ['Q', 0, -150, 50, -90], ['L', 50, 0], ['Z']]),
    { id: 'bars', color: C('darkbrown'), path: [['M', -25, -2], ['L', -25, -105], ['M', 0, -2], ['L', 0, -118], ['M', 25, -2], ['L', 25, -105]] },
    rrect('win', C('yellow'), -200, -270, 30, 44, 14, ink(st)),
    rrect('win2', C('yellow'), 170, -270, 30, 44, 14, ink(st)),
    rrect('win3', C('yellow'), -15, -300, 30, 44, 14, ink(st)),
  ]
  // battlements on the wall
  for (let i = 0; i < 4; i++) shapes.push(rect(`merlon${i}`, st, -130 + i * 72, -250, 40, 32))
  return { shapes, noFace: true }
}

function sandcastle(p: KitParams): KitDrawing {
  const s = slot(p, 0, 'sand')
  return {
    shapes: [
      rect('base', s, -130, -90, 260, 90),
      rect('tower', s, -110, -170, 70, 90),
      rect('tower2', s, 40, -170, 70, 90),
      rect('top', s, -40, -220, 80, 130),
      path('door', shade(s, 0.3), [['M', -24, 0], ['L', -24, -40], ['Q', 0, -70, 24, -40], ['L', 24, 0], ['Z']]),
      poly('flag', C('red'), [P(0, -270), P(40, -258), P(0, -246)]),
      { id: 'pole', color: '#5a4a44', path: [['M', 0, -220], ['L', 0, -272]] },
      patch(circle('shell', C('pink'), -90, -45, 9)),
      patch(circle('shell2', C('coral'), 80, -120, 8)),
    ],
    noFace: true,
  }
}

function pond(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'skyblue')
  return { shapes: [oval('water', c, 0, 10, 220, 42, ink(c)), { id: 'ripple', color: light(c, 0.6), path: [['M', -90, 8], ['Q', -60, -2, -30, 8], ['M', 40, 22], ['Q', 70, 12, 100, 22]] }], noFace: true }
}

function mud(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'darkbrown')
  return { shapes: [blob('mud', c, [P(-200, 10), P(-120, -14), P(0, -8), P(130, -16), P(210, 6), P(100, 34), P(-120, 32)])], noFace: true }
}

function fence(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'cream')
  const shapes: KitShape[] = [rect('rail', c, -150, -90, 300, 18), rect('rail2', c, -150, -45, 300, 18)]
  for (let i = 0; i < 5; i++) {
    const x = -140 + i * 66
    shapes.push(poly(`post${i}`, c, [P(x, 2), P(x, -110), P(x + 12, -126), P(x + 24, -110), P(x + 24, 2)]))
  }
  return { shapes, noFace: true }
}

function bridge(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'brown')
  return {
    shapes: [
      path('arch', c, [['M', -260, 0], ['L', -260, -110], ['L', 260, -110], ['L', 260, 0], ['L', 190, 0], ['Q', 0, -120, -190, 0], ['Z']]),
      rect('rail', shade(c, 0.2), -260, -170, 520, 16),
      { id: 'posts', color: ink(c), path: [['M', -240, -110], ['L', -240, -170], ['M', -120, -110], ['L', -120, -170], ['M', 0, -110], ['L', 0, -170], ['M', 120, -110], ['L', 120, -170], ['M', 240, -110], ['L', 240, -170]] },
    ],
    noFace: true,
  }
}

function tent(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'orange')
  return {
    shapes: [poly('tent', c, [P(-180, 2), P(0, -240), P(180, 2)]), poly('door', shade(c, 0.35), [P(-50, 2), P(0, -130), P(50, 2)]), { id: 'pole', color: C('darkbrown'), path: [['M', 0, -240], ['L', 0, -275]] }, poly('flag', C('red'), [P(0, -275), P(35, -265), P(0, -255)])],
    noFace: true,
  }
}

function rock(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'gray')
  return { shapes: [blob('rock', c, [P(-110, 2), P(-90, -80), P(-10, -120), P(80, -90), P(110, 2)]), patch(oval('shine', light(c, 0.4), -30, -80, 26, 12))], noFace: true }
}

function wave(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'blue')
  return {
    shapes: [
      path('wave', c, [['M', -300, 2], ['C', -250, -250, 100, -380, 200, -260], ['C', 250, -200, 180, -140, 120, -170], ['C', 170, -220, 110, -250, 60, -210], ['C', 0, -150, 60, -40, 300, 2], ['Z']]),
      { id: 'foam', color: C('white'), fill: C('white'), path: scallop(150, -250, 60, 26, 5, 0.18, Math.PI) },
      patch(path('shine', light(c, 0.4), [['M', -200, -40], ['Q', -120, -200, 20, -250], ['Q', -100, -170, -170, -30], ['Z']])),
    ],
    noFace: true,
  }
}

/* ---------- things ---------- */

function bed(p: KitParams): KitDrawing {
  const blanket = slot(p, 0, 'blue')
  const wood = slot(p, 1, 'brown')
  return {
    shapes: [
      rrect('headboard', wood, -190, -200, 40, 200, 10),
      rrect('footboard', wood, 160, -120, 32, 120, 8),
      rect('frame', wood, -170, -70, 350, 40),
      rect('legs', shade(wood, 0.2), -170, -30, 20, 30),
      rect('legs2', shade(wood, 0.2), 155, -30, 20, 30),
      rrect('mattress', C('white'), -165, -100, 335, 34, 10, '#9a9aa4'),
      oval('pillow', C('white'), -110, -112, 48, 22, '#9a9aa4'),
    ],
    front: [
      path('blanket', blanket, [['M', -60, -120], ['Q', 60, -140, 170, -110], ['L', 170, -62], ['L', -60, -62], ['Z']]),
      patch(rrect('fold', light(blanket, 0.45), -64, -126, 36, 64, 10)),
      ...[0, 1, 2].map((i) => patch(circle(`dot${i}`, light(blanket, 0.5), 20 + i * 50, -95, 7))),
    ],
    seat: P(0, -100),
  }
}

function chair(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'brown')
  return { shapes: [rect('back', c, -60, -220, 22, 220), rect('seat', c, -60, -110, 130, 22), rect('leg', c, 50, -92, 18, 92), rect('leg2', c, -60, -92, 18, 92)], noFace: true, seat: P(0, -100) }
}

function table(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'tan')
  const cloth = p.colors[1]
  const shapes: KitShape[] = [rect('leg', shade(c, 0.2), -140, -130, 22, 130), rect('leg2', shade(c, 0.2), 118, -130, 22, 130), rrect('top', c, -170, -150, 340, 26, 8)]
  if (cloth) shapes.push(path('cloth', cloth, [['M', -175, -152], ['L', 175, -152], ['L', 160, -95], ['Q', 0, -85, -160, -95], ['Z']]))
  return { shapes, noFace: true }
}

function cake(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'pink')
  const icing = slot(p, 1, 'white')
  const shapes: KitShape[] = [
    rrect('plate', C('white'), -140, -14, 280, 16, 8, '#9a9aa4'),
    rrect('bottom', c, -115, -100, 230, 90, 10),
    rrect('top', light(c, 0.2), -80, -170, 160, 72, 10),
    path('drip', icing, [['M', -115, -100], ['L', 115, -100], ['L', 115, -80], ['Q', 95, -60, 80, -80], ['Q', 60, -55, 40, -80], ['Q', 15, -60, -10, -80], ['Q', -35, -55, -60, -80], ['Q', -85, -60, -115, -80], ['Z']]),
  ]
  for (let i = 0; i < 3; i++) {
    const x = -40 + i * 40
    shapes.push(rrect(`candle${i}`, [C('skyblue'), C('yellow'), C('mint')][i] ?? C('white'), x - 7, -225, 14, 55, 5))
    shapes.push(blob(`flame${i}`, C('orange'), [P(x, -262), P(x + 11, -236), P(x, -226), P(x - 11, -236)], C('red')))
  }
  for (let i = 0; i < 5; i++) shapes.push(patch(circle(`sprinkle${i}`, [C('red'), C('blue'), C('yellow'), C('green'), C('purple')][i] ?? C('red'), -90 + i * 45, -45 + (i % 2) * 14, 6)))
  return { shapes, noFace: true }
}

function pizza(p: KitParams): KitDrawing {
  return {
    shapes: [
      poly('crust', C('tan'), [P(-110, -10), P(0, -180), P(110, -10)]),
      path('slice', C('yellow'), [['M', -92, -22], ['L', 0, -168], ['L', 92, -22], ['Q', 0, 0, -92, -22], ['Z']], C('orange')),
      rrect('edge', C('tan'), -115, -30, 230, 30, 14),
      circle('pep', C('red'), -20, -70, 16),
      circle('pep2', C('red'), 30, -100, 13),
      circle('pep3', C('red'), 10, -45, 12),
    ],
    noFace: true,
  }
}

function fruitKit(color: string, leaf = true) {
  return (p: KitParams): KitDrawing => {
    const c = slot(p, 0, color)
    const shapes: KitShape[] = [
      path('body', c, [['M', 0, -120], ['C', 80, -170, 130, -60, 70, -10], ['Q', 0, 20, -70, -10], ['C', -130, -60, -80, -170, 0, -120], ['Z']]),
      patch(oval('shine', light(c, 0.5), -40, -90, 16, 24)),
      { id: 'stem', color: C('darkbrown'), path: [['M', 0, -118], ['Q', 4, -150, 16, -160]] },
    ]
    if (leaf) shapes.push(blob('leaf', C('green'), [P(8, -140), P(50, -175), P(70, -150)]))
    return { shapes, head: { id: 'body', cx: 0, cy: -70, r: 70, facing: 'front' } }
  }
}

function carrot(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'orange')
  return {
    shapes: [
      blob('leaves', C('green'), [P(-10, -170), P(-40, -240), P(0, -200), P(30, -250), P(14, -170)]),
      path('body', c, [['M', -38, -170], ['Q', 0, -185, 38, -170], ['Q', 20, -60, 0, 0], ['Q', -20, -60, -38, -170], ['Z']]),
      { id: 'lines', color: ink(c), path: [['M', -26, -130], ['L', -10, -128], ['M', 14, -100], ['L', 24, -102], ['M', -16, -70], ['L', -6, -68]] },
    ],
    noFace: true,
  }
}

function cookie(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'tan')
  const shapes: KitShape[] = [circle('body', c, 0, -80, 80)]
  for (let i = 0; i < 6; i++) shapes.push(patch(circle(`chip${i}`, C('darkbrown'), -40 + (i % 3) * 38, -110 + Math.floor(i / 3) * 55 + (i % 2) * 8, 9)))
  return { shapes, noFace: true }
}

function icecream(p: KitParams): KitDrawing {
  const s1 = slot(p, 0, 'pink')
  const s2 = slot(p, 1, 'mint')
  return {
    shapes: [
      poly('cone', C('tan'), [P(-45, -110), P(45, -110), P(0, 0)]),
      { id: 'waffle', color: shade(C('tan'), 0.35), path: [['M', -30, -110], ['L', 20, -40], ['M', 10, -110], ['L', 32, -80], ['M', 30, -110], ['L', -20, -40], ['M', -10, -110], ['L', -32, -80]] },
      { id: 'scoop', color: ink(s1), fill: s1, path: scallop(0, -140, 55, 40, 7, 0.08, 0.2) },
      { id: 'scoop2', color: ink(s2), fill: s2, path: scallop(0, -200, 45, 36, 7, 0.08, 0.2) },
      circle('cherry', C('red'), 6, -246, 13),
    ],
    noFace: true,
  }
}

function lollipop(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'rose')
  return {
    shapes: [rect('stick', C('white'), -6, -140, 12, 140, '#9a9aa4'), circle('candy', c, 0, -180, 55), { id: 'swirl', color: C('white'), path: [['M', 0, -180], ['C', 20, -180, 20, -205, 0, -205], ['C', -30, -205, -35, -160, 0, -155], ['C', 40, -150, 45, -215, 0, -228]] }],
    noFace: true,
  }
}

function soup(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'orange')
  const bowl = slot(p, 1, 'skyblue')
  return {
    shapes: [
      { id: 'steam', color: '#b8c0cc', path: [['M', -30, -110], ['Q', -45, -135, -30, -160], ['M', 10, -115], ['Q', -5, -145, 10, -175], ['M', 45, -110], ['Q', 30, -135, 45, -160]] },
      oval('soup', c, 0, -76, 100, 18),
      path('bowl', bowl, [['M', -110, -80], ['L', 110, -80], ['Q', 100, 0, 0, 0], ['Q', -100, 0, -110, -80], ['Z']]),
      patch(rrect('band', light(bowl, 0.5), -95, -55, 190, 10, 5)),
    ],
    noFace: true,
  }
}

function ball(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const c2 = slot(p, 1, 'yellow')
  return { shapes: [circle('ball', c, 0, -60, 60), patch(path('band', c2, [['M', -58, -75], ['Q', 0, -40, 58, -75], ['L', 56, -48], ['Q', 0, -12, -56, -48], ['Z']])), patch(oval('shine', light(c, 0.6), -25, -90, 12, 8))], noFace: true }
}

function balloon(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  return {
    shapes: [
      { id: 'string', color: '#5a4a44', path: [['M', 0, -150], ['Q', -20, -100, 0, -60], ['Q', 20, -20, 0, 0]] },
      poly('knot', c, [P(-8, -145), P(8, -145), P(0, -158)]),
      path('balloon', c, [['M', 0, -155], ['C', -85, -165, -80, -300, 0, -300], ['C', 80, -300, 85, -165, 0, -155], ['Z']]),
      patch(oval('shine', light(c, 0.6), -28, -250, 10, 18)),
    ],
    noFace: true,
  }
}

function kite(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'red')
  const c2 = slot(p, 1, 'yellow')
  return {
    shapes: [
      { id: 'tailstring', color: '#5a4a44', path: [['M', 0, 0], ['Q', -40, 50, -10, 100], ['Q', 20, 150, -20, 200]] },
      poly('kite', c, [P(0, -110), P(70, -30), P(0, 0), P(-70, -30)]),
      patch(poly('kite2', c2, [P(0, -110), P(70, -30), P(0, -30)])),
      patch(poly('kite3', c2, [P(0, 0), P(-70, -30), P(0, -30)])),
      poly('bow', C('blue'), [P(-25, 50), P(-10, 70), P(-35, 70)]),
      poly('bow2', C('green'), [P(-5, 130), P(10, 150), P(-15, 150)]),
    ],
    noFace: true,
  }
}

function book(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'blue')
  return { shapes: [rrect('cover', c, -70, -120, 140, 110, 8), rect('pages', C('white'), 55, -115, 12, 100, '#9a9aa4'), patch(poly('star', C('yellow'), starPts(-5, -65, 26, 11)))], noFace: true }
}

function present(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'purple')
  const rib = slot(p, 1, 'yellow')
  return {
    shapes: [
      rect('box', c, -80, -130, 160, 130),
      rect('lid', light(c, 0.15), -90, -150, 180, 30),
      patch(rect('ribbon', rib, -12, -150, 24, 150)),
      blob('bow', rib, [P(0, -150), P(-50, -190), P(-45, -150)]),
      blob('bow2', rib, [P(0, -150), P(50, -190), P(45, -150)]),
    ],
    noFace: true,
  }
}

function nest(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'brown')
  return {
    shapes: [oval('back', shade(c, 0.3), 0, -40, 90, 20)],
    front: [path('nest', c, [['M', -100, -45], ['Q', 0, -30, 100, -45], ['Q', 90, 0, 0, 0], ['Q', -90, 0, -100, -45], ['Z']]), { id: 'twigs', color: shade(c, 0.4), path: [['M', -80, -30], ['L', -20, -18], ['M', 10, -30], ['L', 70, -16], ['M', -50, -12], ['L', 30, -8]] }],
    seat: P(0, -30),
  }
}

function basket(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'tan')
  return {
    shapes: [{ id: 'handle', color: ink(c), path: [['M', -80, -90], ['C', -80, -220, 80, -220, 80, -90]] }],
    front: [path('basket', c, [['M', -100, -95], ['L', 100, -95], ['L', 80, 0], ['L', -80, 0], ['Z']]), { id: 'weave', color: shade(c, 0.3), path: [['M', -92, -60], ['L', 92, -60], ['M', -86, -30], ['L', 86, -30], ['M', -40, -95], ['L', -34, 0], ['M', 20, -95], ['L', 18, 0]] }],
    seat: P(0, -60),
  }
}

function treasure(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'brown')
  return {
    shapes: [
      rect('chest', c, -100, -100, 200, 100),
      path('lid', c, [['M', -100, -100], ['Q', 0, -170, 100, -100], ['Z']]),
      { id: 'gold', color: shade(C('golden'), 0.2), fill: C('golden'), path: scallop(0, -105, 80, 18, 6, 0.3, Math.PI) },
      patch(rect('band', C('golden'), -100, -70, 200, 12)),
      rect('lock', C('golden'), -14, -80, 28, 30),
    ],
    noFace: true,
  }
}

function flame(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'orange')
  return {
    shapes: [
      blob('fire', c, [P(0, 0), P(90, -40), P(200, -10), P(150, 20), P(240, 50), P(120, 50), P(170, 90), P(40, 40)], C('red')),
      patch(blob('core', C('yellow'), [P(10, 10), P(80, -10), P(140, 20), P(70, 35)])),
    ],
    noFace: true,
  }
}

function cup(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'white')
  return { shapes: [{ id: 'handle', color: ink(c), path: [['M', 45, -80], ['C', 90, -80, 90, -30, 45, -30]] }, path('cup', c, [['M', -50, -110], ['L', 50, -110], ['L', 40, 0], ['L', -40, 0], ['Z']]), oval('drink', C('brown'), 0, -110, 50, 10)], noFace: true }
}

const k = (kind: string, doc: string, height: number, build: (p: KitParams) => KitDrawing, o: Partial<Pick<KitDef, 'aliases' | 'idle' | 'air' | 'layer' | 'character'>> = {}): KitDef => ({
  kind,
  doc,
  height,
  idle: o.idle ?? 'none',
  ...(o.character ? { character: true } : {}),
  ...(o.layer !== undefined ? { layer: o.layer } : {}),
  ...(o.aliases ? { aliases: o.aliases } : {}),
  ...(o.air ? { air: true } : {}),
  build,
})

export const OBJECTS: KitDef[] = [
  // vehicles
  k('car', 'car [body] (container: in=car shows the rider in the window)', 150, car, { aliases: ['racecar', 'taxi', 'jeep', 'van'] }),
  k('truck', 'truck [cab] [cargo]', 175, truck, { aliases: ['firetruck', 'lorry'] }),
  k('bus', 'bus [body]', 190, bus, { aliases: ['schoolbus'] }),
  k('train', 'train [engine] [wagon]', 225, train, { aliases: ['locomotive'] }),
  k('boat', 'boat [hull] [sail] (container)', 330, boat, { aliases: ['sailboat', 'canoe', 'rowboat'] }),
  k('ship', 'ship [hull] (pirate ship)', 420, ship, { aliases: ['pirateship'] }),
  k('airplane', 'airplane [body] [wings] (air)', 120, airplane, { aliases: ['plane', 'jet', 'aeroplane'], air: true, idle: 'float' }),
  k('rocket', 'rocket [body] [fins]', 380, rocket, { aliases: ['spaceship', 'rocketship'] }),
  k('bike', 'bike [frame] (container)', 170, bike, { aliases: ['bicycle', 'scooter'] }),
  k('helicopter', 'helicopter [body] (air)', 210, helicopter, { air: true, idle: 'float' }),
  k('tractor', 'tractor [body] (container)', 230, tractor),
  // scenery (behind characters)
  k('tree', 'tree [leaves] [fruit]', 370, tree, { layer: -1, idle: 'sway', aliases: ['appletree', 'oak'] }),
  k('pine', 'pine [needles] [ornaments]', 340, pine, { layer: -1, idle: 'sway', aliases: ['pinetree', 'christmastree', 'fir'] }),
  k('palm', 'palm [leaves]', 450, palm, { layer: -1, idle: 'sway', aliases: ['palmtree'] }),
  k('flower', 'flower [petals] [middle]', 170, flower, { idle: 'sway', aliases: ['rose', 'tulip', 'daisy', 'sunflower'] }),
  k('bush', 'bush [leaves] [berries]', 150, bush, { layer: -1, idle: 'sway' }),
  k('mountain', 'mountain [rock]', 380, mountain, { layer: -1, aliases: ['volcano', 'hill'] }),
  k('rainbow', 'rainbow (arch over the scene)', 440, rainbow, { layer: -1 }),
  k('sun', 'sun [color] (sky: y 120)', 220, sunKit, { layer: -1, idle: 'sway', air: true }),
  k('moon', 'moon (sky: y 120)', 160, moonKit, { layer: -1, air: true }),
  k('cloud', 'cloud [color] (sky)', 110, cloudKit, { layer: -1, idle: 'float', air: true }),
  k('star', 'star [color]', 140, starKit, { idle: 'sway' }),
  k('heart', 'heart [color]', 160, heartKit, { idle: 'breathe' }),
  k('house', 'house [walls] [roof] [door]', 340, house, { layer: -1, aliases: ['home', 'cottage', 'barn'] }),
  k('castle', 'castle [stone] [roofs] [flags]', 480, castle, { layer: -1, aliases: ['palace', 'tower'] }),
  k('sandcastle', 'sandcastle [sand]', 270, sandcastle, { aliases: ['sandcastles'] }),
  k('pond', 'pond [water] (on the ground)', 60, pond, { layer: -1, aliases: ['puddle', 'lake'] }),
  k('mud', 'mud puddle [color]', 50, mud, { layer: -1 }),
  k('fence', 'fence [paint]', 126, fence, { layer: -1 }),
  k('bridge', 'bridge [wood]', 170, bridge, { layer: -1 }),
  k('tent', 'tent [cloth]', 275, tent, { layer: -1 }),
  k('rock', 'rock [stone]', 120, rock, { aliases: ['boulder', 'stone'] }),
  k('wave', 'wave [water] (a big sea wave)', 380, wave, { aliases: ['tsunami'] }),
  // things
  k('bed', 'bed [blanket] [wood] (container: sleeper in=bed pose=sleep)', 200, bed, { layer: -1 }),
  k('chair', 'chair [wood]', 220, chair, { layer: -1, aliases: ['seat', 'bench'] }),
  k('table', 'table [wood] [cloth]', 150, table, { layer: -1, aliases: ['desk'] }),
  k('cake', 'cake [cake] [icing] (candles)', 195, sized(cake, 0.75), { aliases: ['birthdaycake', 'cupcake'] }),
  k('pizza', 'pizza (a slice)', 145, sized(pizza, 0.8)),
  k('apple', 'apple [color] (any round fruit: orange, peach, cherry)', 126, sized(fruitKit('red'), 0.7), { aliases: ['fruit', 'peach', 'cherry', 'tomato'] }),
  k('orange', 'orange', 126, sized(fruitKit('orange'), 0.7)),
  k('carrot', 'carrot', 175, sized(carrot, 0.7), { aliases: ['carrots', 'vegetable'] }),
  k('cookie', 'cookie [dough]', 112, sized(cookie, 0.7), { aliases: ['biscuit', 'donut'] }),
  k('icecream', 'icecream [scoop] [scoop2]', 210, sized(icecream, 0.8), { aliases: ['ice-cream', 'cone', 'icecreamcone'] }),
  k('lollipop', 'lollipop [candy]', 188, sized(lollipop, 0.8), { aliases: ['candy', 'sweets'] }),
  k('soup', 'soup [soup] [bowl]', 105, sized(soup, 0.6), { aliases: ['bowl', 'stew', 'porridge'] }),
  k('cup', 'cup [cup]', 88, sized(cup, 0.8), { aliases: ['mug', 'tea', 'cocoa'] }),
  k('ball', 'ball [color] [band]', 120, ball, { idle: 'breathe', aliases: ['football', 'soccerball', 'beachball'] }),
  k('balloon', 'balloon [color] (floats)', 300, balloon, { idle: 'float', aliases: ['balloons'] }),
  k('kite', 'kite [color] [color2] (flies: y 200)', 310, kite, { idle: 'float', air: true }),
  k('book', 'book [cover]', 120, book, { aliases: ['storybook'] }),
  k('present', 'present [box] [ribbon]', 152, sized(present, 0.8), { aliases: ['gift', 'box'] }),
  k('nest', 'nest (container: bird in=nest)', 50, nest),
  k('basket', 'basket (container)', 200, basket, { aliases: ['wagon'] }),
  k('treasure', 'treasure chest', 170, treasure, { aliases: ['chest', 'treasurechest', 'gold'] }),
  k('flame', 'flame (fire blowing right from its left end: put it at a mouth)', 140, flame, { aliases: ['fire', 'firebreath'], idle: 'breathe' }),
]

export { ellipsePath, line, oval }
