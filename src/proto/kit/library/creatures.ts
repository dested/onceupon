/**
 * Fantasy and friends: dragon, dinosaurs, monster, ghost, alien, robot, snowman.
 */
import { blob, circle, ink, light, oval, P, path, patch, poly, rect, rrect, scallop, shade, type KitShape } from '../geom'
import { C, slot } from '../palette'
import type { KitDef, KitDrawing, KitParams } from '../types'

function dragon(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'green')
  const belly = slot(p, 1, 'yellow')
  const wing = slot(p, 2, light(body, 0.25))
  const fly = p.pose === 'fly'
  const shapes: KitShape[] = []
  const lift = fly ? 30 : 0
  // wing behind
  shapes.push(path('wing', wing, [['M', -30, -150 + lift], ['Q', -80, -290 + lift, -180, -300 + lift], ['Q', -150, -250 + lift, -165, -215 + lift], ['Q', -120, -225 + lift, -120, -185 + lift], ['Q', -80, -195 + lift, -70, -150 + lift], ['Z']]))
  // tail with a spade
  shapes.push(path('tail', body, [['M', -80, -60], ['C', -160, -40, -200, -20, -240, -70], ['L', -228, -80], ['C', -190, -45, -150, -80, -70, -110], ['Z']]))
  shapes.push(poly('tailtip', C('coral'), [P(-238, -72), P(-280, -95), P(-262, -55)]))
  // far legs
  if (!fly) shapes.push(rrect('leg3', shade(body, 0.2), -40, -60, 34, 60, 14), rrect('leg4', shade(body, 0.2), 70, -60, 34, 60, 14))
  // back spikes
  for (let i = 0; i < 4; i++) {
    const x = -70 + i * 38
    shapes.push(poly(`spike${i}`, C('coral'), [P(x - 14, -148 + Math.abs(i - 1.5) * 6), P(x + 2, -182 + Math.abs(i - 1.5) * 8), P(x + 16, -146 + Math.abs(i - 1.5) * 6)]))
  }
  shapes.push(blob('body', body, [P(-95, -80), P(-60, -150), P(40, -160), P(105, -110), P(95, -40), P(-60, -30)]))
  shapes.push(patch(blob('belly', belly, [P(-40, -50), P(40, -60), P(85, -95), P(70, -45), P(-20, -38)])))
  shapes.push({ id: 'bellylines', color: shade(belly, 0.3), path: [['M', 10, -52], ['L', 18, -40], ['M', 40, -60], ['L', 50, -48], ['M', 64, -72], ['L', 74, -62]] })
  if (!fly) shapes.push(rrect('leg1', body, -60, -60, 36, 60, 14), rrect('leg2', body, 50, -62, 36, 62, 14))
  // neck and head
  shapes.push(blob('neck', body, [P(50, -140), P(95, -205), P(140, -200), P(110, -110)]))
  shapes.push(poly('horn', C('cream'), [P(90, -262), P(80, -305), P(110, -268)]))
  shapes.push(poly('horn2', C('cream'), [P(118, -266), P(125, -308), P(140, -262)]))
  shapes.push(circle('head', body, 118, -225, 52))
  shapes.push(oval('snout', light(body, 0.2), 168, -205, 42, 30))
  shapes.push(patch(circle('nostril', shade(body, 0.5), 188, -214, 5)), patch(circle('nostril2', shade(body, 0.5), 200, -208, 5)))
  shapes.push(patch(oval('cheek', C('pink'), 140, -200, 12, 8)))
  if (fly) shapes.push(path('wing2', wing, [['M', 0, -130], ['Q', 10, -270, -60, -330], ['Q', -40, -270, -70, -240], ['Q', -30, -245, -40, -200], ['Q', -10, -210, -10, -140], ['Z']]))
  return { shapes, head: { id: 'head', cx: 118, cy: -225, r: 52, facing: 'right' }, neck: { x: 100, y: -165, w: 60 }, mouth: P(205, -195) }
}

function dinosaur(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'teal')
  const spots = slot(p, 1, 'mint')
  const shapes: KitShape[] = [
    path('tail', body, [['M', -90, -90], ['C', -170, -80, -220, -40, -260, -20], ['C', -200, -30, -150, -40, -80, -50], ['Z']]),
    rrect('leg3', shade(body, 0.2), -55, -70, 38, 70, 14),
    rrect('leg4', shade(body, 0.2), 55, -70, 38, 70, 14),
    blob('body', body, [P(-110, -80), P(-60, -170), P(60, -170), P(115, -110), P(90, -50), P(-80, -45)]),
    rrect('leg1', body, -80, -70, 40, 70, 16),
    rrect('leg2', body, 30, -72, 40, 72, 16),
    path('neck', body, [['M', 40, -150], ['C', 80, -230, 90, -300, 110, -330], ['L', 160, -320], ['C', 140, -280, 120, -200, 105, -110], ['Z']]),
    oval('head', body, 150, -345, 50, 36),
  ]
  for (let i = 0; i < 5; i++) shapes.push(patch(circle(`spot${i}`, spots, -70 + i * 40, -130 + (i % 2) * 30, 11 + (i % 3) * 3)))
  shapes.push(patch(oval('cheek', C('pink'), 172, -330, 10, 7)))
  return { shapes, head: { id: 'head', cx: 150, cy: -345, r: 44, facing: 'right' }, neck: { x: 120, y: -300, w: 50 }, mouth: P(198, -335) }
}

function trex(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'green')
  const belly = slot(p, 1, 'yellow')
  const shapes: KitShape[] = [
    path('tail', body, [['M', -40, -110], ['C', -120, -100, -170, -60, -220, -10], ['C', -150, -40, -100, -50, -30, -60], ['Z']]),
    rrect('leg2', shade(body, 0.2), 10, -70, 40, 70, 16),
    blob('body', body, [P(-60, -80), P(-40, -190), P(40, -210), P(80, -130), P(60, -50), P(-40, -40)]),
    patch(blob('belly', belly, [P(0, -170), P(55, -140), P(50, -60), P(0, -55)])),
    rrect('leg1', body, -40, -75, 44, 75, 18),
    blob('arm', body, [P(55, -150), P(95, -140), P(92, -125), P(60, -130)]),
    blob('head', body, [P(10, -230), P(60, -290), P(160, -275), P(170, -220), P(90, -195), P(20, -190)]),
    { id: 'teeth', color: '#8a8a8a', fill: C('white'), path: [['M', 90, -210], ['L', 100, -198], ['L', 110, -210], ['L', 120, -198], ['L', 130, -212], ['L', 140, -200], ['L', 150, -214], ['Z']] },
  ]
  return { shapes, head: { id: 'head', cx: 90, cy: -245, r: 60, facing: 'right' }, mouth: P(165, -220) }
}

function monster(p: KitParams): KitDrawing {
  const body = slot(p, 0, 'purple')
  const horn = slot(p, 1, 'yellow')
  const shapes: KitShape[] = [
    poly('horn', horn, [P(-60, -225), P(-85, -300), P(-25, -240)]),
    poly('horn2', horn, [P(60, -225), P(85, -300), P(25, -240)]),
    rrect('leg', shade(body, 0.15), 20, -50, 40, 50, 16),
    rrect('leg2', shade(body, 0.15), -60, -50, 40, 50, 16),
    { id: 'body', color: ink(body), fill: body, path: scallop(0, -140, 110, 110, 14, 0.05, 0.2) },
    blob('arm', body, [P(95, -140), P(150, -110), P(145, -85), P(98, -105)]),
    blob('arm2', body, [P(-95, -140), P(-150, -170), P(-160, -145), P(-100, -110)]),
    patch(oval('belly', light(body, 0.35), 0, -95, 60, 45)),
  ]
  return { shapes, head: { id: 'body', cx: 0, cy: -160, r: 100, facing: 'front' } }
}

function ghost(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'white')
  const shapes: KitShape[] = [
    path('sheet', c, [
      ['M', -90, 0],
      ['L', -90, -150],
      ['C', -90, -290, 90, -290, 90, -150],
      ['L', 90, 0],
      ['Q', 75, -30, 60, 0],
      ['Q', 45, -30, 30, 0],
      ['Q', 15, -30, 0, 0],
      ['Q', -15, -30, -30, 0],
      ['Q', -45, -30, -60, 0],
      ['Q', -75, -30, -90, 0],
      ['Z'],
    ], '#8f95a8'),
    blob('arm', c, [P(80, -140), P(130, -170), P(135, -150), P(88, -115)], '#8f95a8'),
    blob('arm2', c, [P(-80, -140), P(-130, -170), P(-135, -150), P(-88, -115)], '#8f95a8'),
  ]
  return { shapes, head: { id: 'sheet', cx: 0, cy: -180, r: 80, facing: 'front' } }
}

function alien(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'lime')
  const suit = slot(p, 1, 'purple')
  const shapes: KitShape[] = [
    { id: 'antennae', color: ink(c), path: [['M', -30, -270], ['Q', -45, -310, -60, -320], ['M', 30, -270], ['Q', 45, -310, 60, -320]] },
    circle('bob', C('pink'), -60, -322, 11),
    circle('bob2', C('pink'), 60, -322, 11),
    rrect('leg', c, 10, -60, 26, 60, 12),
    rrect('leg2', c, -36, -60, 26, 60, 12),
    blob('arm', c, [P(40, -120), P(85, -95), P(80, -80), P(40, -100)]),
    blob('arm2', c, [P(-40, -120), P(-85, -95), P(-80, -80), P(-40, -100)]),
    blob('body', suit, [P(0, -140), P(45, -120), P(50, -55), P(-50, -55), P(-45, -120)]),
    patch(poly('badge', C('yellow'), [P(0, -115), P(10, -95), P(-10, -95)])),
    oval('head', c, 0, -205, 82, 66),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -205, r: 70, facing: 'front' } }
}

function robot(p: KitParams): KitDrawing {
  const c = slot(p, 0, 'silver')
  const c2 = slot(p, 1, 'skyblue')
  const shapes: KitShape[] = [
    { id: 'antenna', color: '#5a5a66', path: [['M', 0, -292], ['L', 0, -325]] },
    circle('antball', C('red'), 0, -332, 12),
    rrect('leg', c, 16, -70, 30, 70, 6),
    rrect('leg2', c, -46, -70, 30, 70, 6),
    rrect('foot', shade(c, 0.2), 10, -16, 46, 16, 6),
    rrect('foot2', shade(c, 0.2), -56, -16, 46, 16, 6),
    rrect('arm', c, 72, -180, 26, 90, 12),
    rrect('arm2', c, -98, -180, 26, 90, 12),
    circle('claw', shade(c, 0.2), 85, -82, 16),
    circle('claw2', shade(c, 0.2), -85, -82, 16),
    rrect('body', c, -75, -190, 150, 125, 14),
    rrect('panel', c2, -45, -165, 90, 55, 8),
    circle('dial', C('yellow'), -22, -138, 10),
    circle('dial2', C('red'), 12, -138, 10),
    rect('neck', shade(c, 0.2), -16, -205, 32, 18),
    rrect('ear', shade(c, 0.2), -85, -262, 16, 34, 5),
    rrect('ear2', shade(c, 0.2), 69, -262, 16, 34, 5),
    rrect('head', c, -70, -295, 140, 92, 16),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -249, r: 62, facing: 'front' } }
}

function snowman(p: KitParams): KitDrawing {
  const scarf = slot(p, 0, 'red')
  const hat = slot(p, 1, 'black')
  const w = '#ffffff'
  const o = '#9fb4cc'
  const shapes: KitShape[] = [
    { id: 'arms', color: C('brown'), path: [['M', 60, -150], ['L', 140, -200], ['M', 118, -186], ['L', 130, -215], ['M', -60, -150], ['L', -140, -190], ['M', -118, -176], ['L', -140, -168]] },
    circle('bottom', w, 0, -72, 72, o),
    circle('middle', w, 0, -175, 55, o),
    circle('buttons', C('black'), 0, -190, 6),
    circle('buttons2', C('black'), 0, -160, 6),
    circle('head', w, 0, -262, 45, o),
    poly('nose', C('orange'), [P(0, -262), P(45, -254), P(0, -248)]),
    rrect('scarf', scarf, -48, -226, 96, 20, 9),
    rrect('scarftail', scarf, 18, -218, 22, 55, 8),
    oval('hatbrim', hat, 0, -300, 55, 10),
    rrect('hat', hat, -34, -360, 68, 60, 6),
    patch(rect('hatband', C('red'), -34, -318, 68, 12)),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -262, r: 45, facing: 'front' } }
}

function mermaid(p: KitParams): KitDrawing {
  const tail = slot(p, 0, 'turquoise')
  const hair = slot(p, 1, 'red')
  const skin = slot(p, 2, '#f7c9a3')
  const shapes: KitShape[] = [
    path('hairback', hair, [['M', -66, -230], ['C', -80, -330, 80, -330, 66, -230], ['Q', 85, -150, 60, -110], ['L', -60, -110], ['Q', -85, -150, -66, -230], ['Z']]),
    path('tail', tail, [['M', -40, -120], ['Q', -50, -50, 10, -30], ['Q', 60, -20, 80, 0], ['L', 30, 10], ['Q', 20, -5, -10, -10], ['Q', -70, -20, -50, -120], ['Z']]),
    poly('fin', tail, [P(70, 0), P(120, -30), P(115, 25)]),
    path('body', skin, [['M', -40, -170], ['Q', 0, -178, 40, -170], ['L', 40, -115], ['Q', 0, -105, -40, -115], ['Z']]),
    oval('top', C('lavender'), -14, -150, 16, 12),
    oval('top2', C('lavender'), 14, -150, 16, 12),
    circle('head', skin, 0, -235, 56),
    path('hair', hair, [['M', -58, -240], ['C', -64, -305, 64, -305, 58, -240], ['Q', 30, -275, 0, -265], ['Q', -30, -275, -58, -240], ['Z']]),
    patch(oval('cheek', C('pink'), 30, -215, 10, 7)),
    patch(oval('cheek2', C('pink'), -30, -215, 10, 7)),
  ]
  return { shapes, head: { id: 'head', cx: 0, cy: -235, r: 56, facing: 'front' }, neck: { x: 0, y: -175, w: 60 } }
}

const d = (kind: string, doc: string, height: number, build: (p: KitParams) => KitDrawing, o: Partial<Pick<KitDef, 'aliases' | 'idle' | 'air'>> = {}): KitDef => ({
  kind,
  doc,
  height,
  idle: o.idle ?? 'breathe',
  character: true,
  ...(o.aliases ? { aliases: o.aliases } : {}),
  ...(o.air ? { air: true } : {}),
  build,
})

export const CREATURES: KitDef[] = [
  d('dragon', 'dragon [body] [belly] [wings] (pose fly)', 310, dragon, { aliases: ['dragons'] }),
  d('dinosaur', 'dinosaur [body] [spots] (long neck)', 380, dinosaur, { aliases: ['dino', 'brontosaurus', 'dinosaurs'] }),
  d('trex', 't-rex [body] [belly]', 290, trex, { aliases: ['t-rex', 'tyrannosaurus'] }),
  d('monster', 'monster [fur] [horns]', 300, monster, { aliases: ['beast'] }),
  d('ghost', 'ghost [sheet] (air)', 270, ghost, { idle: 'float', air: true, aliases: ['spook'] }),
  d('alien', 'alien [skin] [suit]', 330, alien, { aliases: ['martian'] }),
  d('robot', 'robot [metal] [panel]', 335, robot, { aliases: ['robo'] }),
  d('snowman', 'snowman [scarf] [hat]', 360, snowman, { idle: 'none' }),
  d('mermaid', 'mermaid [tail] [hair] [skin]', 300, mermaid),
]

export { ink }
