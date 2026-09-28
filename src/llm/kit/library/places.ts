/**
 * Places: full-bleed designed backdrops in one line. Two entities, both anchored at paper (600,525):
 * `sky` (layer -3: sun, moon, clouds, stars, far things) and `land` (layer -2: hills, ground, props).
 * Local x runs -600..600, the ground line is y=0, the paper top is y=-525, the bottom y=95.
 * The sky color itself is the scene background.
 */
import { between, blob, circle, closedCurve, ink, light, line, mix, oval, P, path, patch, poly, rect, rrect, scallop, shade, starPts, type KitShape, type PathCmd, type Rng } from '../geom'
import { C } from '../palette'

export interface PlaceOpts {
  time: string
  weather: string
  rng: Rng
}

export interface PlaceDrawing {
  sky: string
  back: KitShape[]
  land: KitShape[]
  /** Where characters stand (paper y). */
  standY?: number
  note?: string
}

export interface PlaceDef {
  name: string
  aliases: string[]
  title: string
  doc: string
  build(o: PlaceOpts): PlaceDrawing
}

const SKY = { day: '#bfe4f8', sunset: '#f9c7a0', night: '#2e3b6e' }
const skyFor = (o: PlaceOpts): string => (o.weather === 'rain' ? '#b8c3cf' : o.weather === 'snow' ? '#dce6f0' : o.time === 'sunset' ? SKY.sunset : o.time === 'night' ? SKY.night : SKY.day)
const nightTint = (c: string, o: PlaceOpts): string => (o.time === 'night' ? mix(c, '#1c2550', 0.45) : o.time === 'sunset' ? mix(c, '#c0604a', 0.12) : c)

/* ---------- sky things ---------- */

function sun(x: number, y: number, r: number, id = 'sun'): KitShape[] {
  const rays: PathCmd[] = []
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    rays.push(['M', Math.round(x + Math.cos(a) * r * 1.35), Math.round(y + Math.sin(a) * r * 1.35)])
    rays.push(['L', Math.round(x + Math.cos(a) * r * 1.75), Math.round(y + Math.sin(a) * r * 1.75)])
  }
  return [{ id: `${id}_rays`, color: C('orange'), path: rays }, circle(id, C('yellow'), x, y, r, C('orange'))]
}

function moon(x: number, y: number, r: number): KitShape[] {
  return [
    path('moon', '#fff3c4', [
      ['M', x, y - r],
      ['C', x + r * 1.35, y - r, x + r * 1.35, y + r, x, y + r],
      ['C', x + r * 0.6, y + r * 0.6, x + r * 0.6, y - r * 0.6, x, y - r],
      ['Z'],
    ], '#d9b44a'),
  ]
}

function cloud(id: string, x: number, y: number, w: number, dark = false): KitShape {
  const fill = dark ? '#aeb6c2' : '#ffffff'
  return { id, color: dark ? '#7d8796' : '#a9c6dc', fill, path: scallop(x, y, w, w * 0.38, 7, 0.14, 0.3) }
}

function stars(n: number, rng: Rng, area: { x0: number; x1: number; y0: number; y1: number }, color = '#fff2a8'): KitShape[] {
  const out: KitShape[] = []
  for (let i = 0; i < n; i++) {
    const x = between(rng, area.x0, area.x1)
    const y = between(rng, area.y0, area.y1)
    const s = between(rng, 7, 13)
    out.push(patch(poly(`star${i}`, color, starPts(x, y, s, s * 0.45))))
  }
  return out
}

function rain(rng: Rng): KitShape {
  const cmds: PathCmd[] = []
  for (let i = 0; i < 34; i++) {
    const x = between(rng, -580, 580)
    const y = between(rng, -470, -60)
    cmds.push(['M', Math.round(x), Math.round(y)], ['L', Math.round(x - 8), Math.round(y + 26)])
  }
  return { id: 'rain', color: '#5a86c9', path: cmds }
}

function snowflakes(rng: Rng): KitShape[] {
  const out: KitShape[] = []
  for (let i = 0; i < 26; i++) out.push(patch(circle(`flake${i}`, '#ffffff', between(rng, -580, 580), between(rng, -480, -40), between(rng, 4, 7))))
  return out
}

/** Sun / moon / clouds / weather for an outdoor place. */
function skyThings(o: PlaceOpts, sunX = 430, clouds = 2): KitShape[] {
  const out: KitShape[] = []
  if (o.weather === 'rain') {
    out.push(cloud('cloud1', -300, -440, 150, true), cloud('cloud2', 120, -470, 170, true), cloud('cloud3', 430, -420, 130, true), rain(o.rng))
    return out
  }
  if (o.time === 'night') {
    out.push(...stars(7, o.rng, { x0: -580, x1: 580, y0: -500, y1: -200 }))
    out.push(...moon(sunX, -420, 46))
  } else if (o.time === 'sunset') {
    out.push(...sun(sunX, -90, 70))
    if (clouds > 0) out.push(cloud('cloud1', -330, -400, 120))
  } else {
    out.push(...sun(sunX, -420, 46))
    const xs = [-380, -40, 250]
    for (let i = 0; i < clouds; i++) out.push(cloud(`cloud${i + 1}`, xs[i] ?? 0, -440 + (i % 2) * 40, 95 + i * 10))
  }
  if (o.weather === 'snow') out.push(...snowflakes(o.rng))
  return out
}

/* ---------- land things ---------- */

/** A ground band with a gently wavy top edge from y≈top to the paper bottom. */
function groundBand(id: string, fill: string, top: number, rng: Rng, wave = 10, outline?: string): KitShape {
  const pts: PathCmd[] = [['M', -620, 170], ['L', -620, top]]
  const n = 6
  for (let i = 0; i < n; i++) {
    const x0 = -620 + (i * 1240) / n
    const x1 = -620 + ((i + 1) * 1240) / n
    const y1 = top + between(rng, -wave, wave)
    pts.push(['Q', Math.round((x0 + x1) / 2), Math.round(top + between(rng, -wave * 2, wave)), Math.round(x1), Math.round(y1)])
  }
  pts.push(['L', 620, 170], ['Z'])
  return path(id, fill, pts, outline)
}

function hill(id: string, fill: string, x0: number, x1: number, peak: number, base = 10): KitShape {
  const mid = (x0 + x1) / 2
  return path(id, fill, [['M', x0, base], ['C', x0 + (mid - x0) * 0.4, peak, x1 - (x1 - mid) * 0.4, peak, x1, base], ['Z']])
}

function tufts(rng: Rng, color: string, n: number, y0 = 20, y1 = 80): KitShape {
  const cmds: PathCmd[] = []
  for (let i = 0; i < n; i++) {
    const x = Math.round(between(rng, -580, 580))
    const y = Math.round(between(rng, y0, y1))
    cmds.push(['M', x - 10, y - 14], ['L', x - 3, y], ['L', x + 2, y - 18], ['M', x + 2, y - 18], ['L', x + 5, y], ['L', x + 12, y - 12])
  }
  return { id: 'tufts', color, path: cmds }
}

function flowers(rng: Rng, n: number, y0 = 25, y1 = 75): KitShape[] {
  const out: KitShape[] = []
  const cols = [C('pink'), C('yellow'), C('white'), C('coral'), C('lavender')]
  for (let i = 0; i < n; i++) {
    const x = between(rng, -560, 560)
    if (Math.abs(x) < 80) continue
    const y = between(rng, y0, y1)
    const c = cols[i % cols.length] ?? C('pink')
    out.push(patch(circle(`fl${i}`, c, x, y, 9)))
    out.push(patch(circle(`flc${i}`, C('orange'), x, y, 3.5)))
  }
  return out
}

function roundTree(id: string, x: number, h: number, crown: string): KitShape[] {
  const tw = h * 0.12
  return [
    path(`${id}_trunk`, C('brown'), [['M', x - tw, 2], ['Q', x - tw * 0.7, -h * 0.4, x - tw * 0.6, -h * 0.55], ['L', x + tw * 0.6, -h * 0.55], ['Q', x + tw * 0.7, -h * 0.4, x + tw, 2], ['Z']]),
    { id: `${id}_crown`, color: ink(crown), fill: crown, path: scallop(x, -h * 0.68, h * 0.36, h * 0.32, 8, 0.1, 0.2) },
  ]
}

function pineTree(id: string, x: number, h: number, green: string, snow = false): KitShape[] {
  const w = h * 0.36
  const out: KitShape[] = [rect(`${id}_trunk`, C('darkbrown'), x - h * 0.05, -h * 0.18, h * 0.1, h * 0.2)]
  for (let i = 0; i < 3; i++) {
    const top = -h + i * h * 0.24
    const bot = -h * 0.14 - (2 - i) * h * 0.2
    const ww = w * (0.55 + i * 0.25)
    out.push(poly(`${id}_t${i}`, green, [P(x, top), P(x + ww, bot), P(x - ww, bot)]))
    if (snow) out.push(patch(poly(`${id}_s${i}`, '#ffffff', [P(x, top), P(x + ww * 0.3, top + h * 0.1), P(x - ww * 0.3, top + h * 0.1)])))
  }
  return out
}

function house(id: string, x: number, w: number, h: number, wall: string, roof: string): KitShape[] {
  return [
    rect(`${id}_wall`, wall, x - w / 2, -h, w, h),
    poly(`${id}_roof`, roof, [P(x - w / 2 - 12, -h), P(x, -h - w * 0.55), P(x + w / 2 + 12, -h)]),
    rect(`${id}_win`, '#fff3b0', x - w * 0.3, -h * 0.75, w * 0.24, w * 0.24),
    rrect(`${id}_door`, C('brown'), x + w * 0.05, -h * 0.55, w * 0.26, h * 0.55, 6),
  ]
}

function fence(id: string, x0: number, x1: number, h: number, col: string): KitShape[] {
  const out: KitShape[] = [rect(`${id}_rail`, col, x0, -h * 0.72, x1 - x0, h * 0.14), rect(`${id}_rail2`, col, x0, -h * 0.36, x1 - x0, h * 0.14)]
  for (let x = x0, i = 0; x <= x1 - 16; x += 44, i++) out.push(poly(`${id}_p${i}`, col, [P(x, 4), P(x, -h * 0.9), P(x + 9, -h), P(x + 18, -h * 0.9), P(x + 18, 4)]))
  return out
}

/* ---------- rooms ---------- */

function room(o: PlaceOpts, wall: string, floor: string, extra: KitShape[] = []): PlaceDrawing {
  const night = o.time === 'night'
  const land: KitShape[] = [
    patch(rect('wallshade', mix(wall, '#b38a6a', 0.18), -620, -18, 1240, 18)),
    rect('floor', floor, -620, 0, 1240, 170, ink(floor)),
    { id: 'planks', color: shade(floor, 0.35), path: [['M', -620, 32], ['L', 620, 32], ['M', -620, 64], ['L', 620, 64], ['M', -380, 0], ['L', -380, 32], ['M', 120, 0], ['L', 120, 32], ['M', -120, 32], ['L', -120, 64], ['M', 380, 32], ['L', 380, 64], ['M', -500, 64], ['L', -500, 100], ['M', 260, 64], ['L', 260, 100]] },
    // window
    rrect('window', night ? '#2e3b6e' : '#bfe4f8', 290, -420, 220, 190, 10, C('brown')),
    { id: 'window_x', color: C('brown'), path: [['M', 400, -420], ['L', 400, -230], ['M', 290, -325], ['L', 510, -325]] },
    ...(night ? [patch(circle('winmoon', '#fff3c4', 460, -380, 18))] : [patch(circle('winsun', C('yellow'), 460, -380, 20))]),
    path('curtain', C('rose'), [['M', 270, -440], ['Q', 300, -330, 285, -215], ['L', 255, -215], ['Q', 262, -330, 250, -440], ['Z']]),
    path('curtain2', C('rose'), [['M', 530, -440], ['Q', 500, -330, 515, -215], ['L', 545, -215], ['Q', 538, -330, 550, -440], ['Z']]),
    rrect('rod', C('brown'), 240, -450, 320, 12, 6),
    ...extra,
  ]
  return { sky: wall, back: [], land }
}

/* ---------- presets ---------- */

const outdoors = (o: PlaceOpts, grass: string, extras: (o: PlaceOpts, land: KitShape[]) => void, hills = true): PlaceDrawing => {
  const g = nightTint(grass, o)
  const land: KitShape[] = []
  if (hills) {
    land.push(hill('hill1', nightTint(light(grass, 0.35), o), -700, -60, -170))
    land.push(hill('hill2', nightTint(light(grass, 0.2), o), -200, 720, -210))
  }
  extras(o, land)
  land.push(groundBand('ground', g, -4, o.rng, 8))
  land.push(tufts(o.rng, shade(g, 0.35), 12))
  if (o.weather === 'snow') land.push(patch(groundBand('snowcover', '#ffffff', 6, o.rng, 6)))
  return { sky: skyFor(o), back: skyThings(o), land }
}

export const PLACES: PlaceDef[] = [
  {
    name: 'meadow',
    aliases: ['field', 'grass', 'outside', 'garden', 'hill', 'yard', 'backyard'],
    title: 'the meadow',
    doc: 'grass, hills, sun, clouds, flowers',
    build: (o) => {
      const d = outdoors(o, '#72c858', () => {})
      if (o.time !== 'night') d.land.push(...flowers(o.rng, 10))
      return d
    },
  },
  {
    name: 'park',
    aliases: ['playground'],
    title: 'the park',
    doc: 'meadow with trees and a path',
    build: (o) => {
      const d = outdoors(o, '#72c858', (o2, land) => {
        land.push(...roundTree('tree1', -500, 300, nightTint('#4fae4a', o2)), ...roundTree('tree2', 520, 260, nightTint('#5dbb52', o2)))
      })
      d.land.push(patch(path('path', nightTint('#e8d4a8', o), [['M', -60, 100], ['Q', -20, 30, 120, 0], ['L', 200, 0], ['Q', 90, 30, 90, 100], ['Z']])))
      return d
    },
  },
  {
    name: 'farm',
    aliases: ['barnyard', 'countryside'],
    title: 'the farm',
    doc: 'red barn far left, fence, hills',
    build: (o) =>
      outdoors(o, '#7cc85a', (o2, land) => {
        const barn = nightTint(C('red'), o2)
        land.push(rect('barn', barn, -560, -190, 170, 190), poly('barnroof', nightTint('#8f2d3a', o2), [P(-575, -190), P(-475, -270), P(-375, -190)]), rect('barndoor', nightTint('#fff1cf', o2), -510, -110, 70, 110), { id: 'barnx', color: barn, path: [['M', -510, -110], ['L', -440, 0], ['M', -440, -110], ['L', -510, 0]] })
        land.push(...fence('fence', 330, 610, 90, nightTint('#f4e3c3', o2)))
      }),
  },
  {
    name: 'forest',
    aliases: ['woods', 'jungle-edge'],
    title: 'the forest',
    doc: 'tall trees on both sides, mushrooms',
    build: (o) => {
      const d = outdoors(o, '#5aa84a', (o2, land) => {
        const g1 = nightTint('#2f8a45', o2)
        const g2 = nightTint('#46a04f', o2)
        land.push(...pineTree('p1', -540, 400, g1), ...roundTree('r1', -390, 330, g2), ...pineTree('p2', -250, 300, g1))
        land.push(...pineTree('p3', 260, 330, g1), ...roundTree('r2', 400, 360, g2), ...pineTree('p4', 545, 420, g1))
      }, false)
      d.land.push(circle('mush', C('red'), -170, 30, 18), rect('mushstem', '#fff1cf', -178, 30, 16, 22))
      return d
    },
  },
  {
    name: 'beach',
    aliases: ['seaside', 'shore', 'sand'],
    title: 'the beach',
    doc: 'sand, sea behind, sun, palm tree',
    build: (o) => {
      const land: KitShape[] = [
        rect('sea', nightTint('#4aa6e0', o), -620, -110, 1240, 115, nightTint('#2f7fc0', o)),
        { id: 'waves', color: '#ffffff', path: [['M', -560, -70], ['Q', -530, -84, -500, -70], ['M', -250, -40], ['Q', -220, -54, -190, -40], ['M', 150, -80], ['Q', 180, -94, 210, -80], ['M', 420, -45], ['Q', 450, -59, 480, -45]] },
        groundBand('sand', nightTint('#f3d9a0', o), -6, o.rng, 12),
        // palm
        path('palm', C('brown'), [['M', -540, 40], ['Q', -560, -120, -500, -260], ['L', -480, -255], ['Q', -535, -120, -512, 40], ['Z']]),
        blob('frond1', nightTint('#3fae4f', o), [P(-490, -262), P(-400, -300), P(-340, -250), P(-410, -270)]),
        blob('frond2', nightTint('#3fae4f', o), [P(-490, -262), P(-590, -310), P(-640, -250), P(-570, -280)]),
        blob('frond3', nightTint('#52bf5a', o), [P(-490, -262), P(-470, -350), P(-420, -370), P(-455, -330)]),
        patch(poly('starfish', C('coral'), starPts(360, 50, 20, 9))),
        patch(oval('shell', C('pink'), -200, 60, 14, 10)),
      ]
      return { sky: skyFor(o), back: skyThings(o, 430, 2), land }
    },
  },
  {
    name: 'sea',
    aliases: ['lake', 'ocean', 'pond', 'river', 'water'],
    title: 'the water',
    doc: 'water from y=385 down, far hills; boats float at y=470, swimmers at y=520',
    build: (o) => {
      const water = nightTint('#4aa6e0', o)
      const land: KitShape[] = [
        hill('hill1', nightTint('#9ed98a', o), -700, -100, -300, -130),
        hill('hill2', nightTint('#86cf74', o), -250, 720, -260, -130),
        rect('water', water, -620, -140, 1240, 310, nightTint('#2f7fc0', o)),
        { id: 'ripples', color: light(water, 0.6), path: [['M', -520, -90], ['Q', -490, -102, -460, -90], ['M', -300, -30], ['Q', -270, -42, -240, -30], ['M', 180, -100], ['Q', 210, -112, 240, -100], ['M', 420, 20], ['Q', 450, 8, 480, 20], ['M', -120, 60], ['Q', -90, 48, -60, 60]] },
      ]
      return { sky: skyFor(o), back: skyThings(o), land, standY: 470, note: 'water: boats at y=470' }
    },
  },
  {
    name: 'town',
    aliases: ['street', 'city', 'village', 'road'],
    title: 'the town',
    doc: 'little houses behind, sidewalk, road',
    build: (o) => {
      const land: KitShape[] = [
        ...house('h1', -500, 150, 170, nightTint('#f7c95c', o), nightTint(C('red'), o)),
        ...house('h2', -300, 130, 140, nightTint('#9fd3f2', o), nightTint(C('purple'), o)),
        ...house('h3', 320, 140, 160, nightTint('#f79ac0', o), nightTint(C('blue'), o)),
        ...house('h4', 510, 150, 190, nightTint('#9fe3c4', o), nightTint('#8f2d3a', o)),
        rect('sidewalk', nightTint('#d8d2c8', o), -620, -6, 1240, 36),
        rect('road', nightTint('#6d6a70', o), -620, 30, 1240, 140),
        { id: 'dashes', color: '#fff3b0', path: [['M', -560, 64], ['L', -480, 64], ['M', -320, 64], ['L', -240, 64], ['M', -80, 64], ['L', 0, 64], ['M', 160, 64], ['L', 240, 64], ['M', 400, 64], ['L', 480, 64]] },
      ]
      return { sky: skyFor(o), back: skyThings(o, 60, 1), land }
    },
  },
  {
    name: 'castle',
    aliases: ['kingdom', 'palace'],
    title: 'the kingdom',
    doc: 'a castle on a hill far behind at the right, flags, road',
    build: (o) => {
      const d = outdoors(o, '#72c858', (o2, land) => {
        const st = nightTint('#c9c4d6', o2)
        const rf = nightTint(C('purple'), o2)
        land.push(hill('chill', nightTint('#9ed98a', o2), 150, 700, -230))
        land.push(rect('cwall', st, 300, -300, 220, 120), rect('ct1', st, 280, -360, 56, 180), rect('ct2', st, 484, -360, 56, 180))
        land.push(poly('cr1', rf, [P(272, -360), P(308, -420), P(344, -360)]), poly('cr2', rf, [P(476, -360), P(512, -420), P(548, -360)]))
        land.push(poly('cflag', C('red'), [P(308, -420), P(308, -450), P(335, -440)]))
        land.push(rrect('cgate', C('brown'), 385, -240, 50, 60, 22))
      })
      return d
    },
  },
  {
    name: 'space',
    aliases: ['outerspace', 'stars', 'galaxy', 'planet'],
    title: 'outer space',
    doc: 'dark sky, stars, a ringed planet, the moon surface',
    build: (o) => {
      const back: KitShape[] = [
        ...stars(9, o.rng, { x0: -590, x1: 590, y0: -510, y1: -60 }),
        circle('planet', C('coral'), -420, -380, 55),
        { id: 'ring', color: C('yellow'), path: [['M', -500, -370], ['Q', -420, -330, -340, -390]] },
        circle('earth', '#4aa6e0', 420, -400, 40),
        patch(blob('land1', C('green'), [P(405, -420), P(430, -415), P(425, -395), P(400, -398)])),
      ]
      const land: KitShape[] = [groundBand('moonground', '#b8b8c4', -6, o.rng, 14), patch(oval('crater1', '#9a9aa8', -300, 40, 50, 14)), patch(oval('crater2', '#9a9aa8', 250, 60, 36, 10)), patch(oval('crater3', '#9a9aa8', 470, 25, 26, 8))]
      return { sky: '#232a55', back, land }
    },
  },
  {
    name: 'moon',
    aliases: ['moonsurface', 'onthemoon'],
    title: 'the moon',
    doc: 'on the moon: gray craters, black sky, Earth',
    build: (o) => {
      const back: KitShape[] = [...stars(8, o.rng, { x0: -590, x1: 590, y0: -510, y1: -80 }), circle('earth', '#4aa6e0', 400, -400, 55), patch(blob('eland', C('green'), [P(380, -430), P(420, -420), P(410, -385), P(375, -392)]))]
      const land: KitShape[] = [groundBand('moonground', '#c9c9d2', -10, o.rng, 18), patch(oval('crater1', '#a4a4b2', -320, 35, 70, 18)), patch(oval('crater2', '#a4a4b2', 220, 60, 48, 12)), patch(oval('crater3', '#a4a4b2', -40, 75, 30, 8))]
      return { sky: '#1e2246', back, land }
    },
  },
  {
    name: 'underwater',
    aliases: ['undersea', 'ocean-floor', 'reef', 'seafloor'],
    title: 'under the sea',
    doc: 'blue water everywhere, sand floor, seaweed, bubbles; swimmers anywhere',
    build: (o) => {
      const land: KitShape[] = [groundBand('sand', '#f1d9a0', -10, o.rng, 14)]
      const weed = (id: string, x: number, h: number): KitShape => ({ id, color: '#2f8a45', path: [['M', x, 0], ['Q', x - 30, -h * 0.3, x, -h * 0.5], ['Q', x + 30, -h * 0.7, x, -h]] })
      land.push(weed('weed1', -520, 260), weed('weed2', -480, 190), weed('weed3', 470, 240), weed('weed4', 520, 300), weed('weed5', -150, 140))
      land.push(blob('rock1', '#9a9aa4', [P(380, 10), P(400, -50), P(460, -60), P(480, 10)]), blob('coral', C('coral'), [P(-360, 5), P(-380, -60), P(-340, -40), P(-330, -90), P(-300, -30), P(-290, 5)]))
      const back: KitShape[] = []
      for (let i = 0; i < 9; i++) back.push({ id: `bub${i}`, color: '#ffffff', circle: [Math.round(between(o.rng, -560, 560)), Math.round(between(o.rng, -480, -120)), Math.round(between(o.rng, 6, 14))] })
      return { sky: '#6cc0e6', back, land }
    },
  },
  {
    name: 'snow',
    aliases: ['winter', 'snowy', 'northpole', 'ice'],
    title: 'the snowy hill',
    doc: 'snow hills, snowy pines, snowflakes',
    build: (o) => {
      const land: KitShape[] = [
        hill('hill1', '#f4f8fc', -700, -60, -200),
        hill('hill2', '#eaf1f8', -200, 720, -230),
        ...pineTree('p1', -470, 260, '#2f8a45', true),
        ...pineTree('p2', 470, 300, '#2f8a45', true),
        groundBand('snow', '#ffffff', -4, o.rng, 8, '#9fb4cc'),
      ]
      const back = o.time === 'night' ? skyThings(o) : [...snowflakes(o.rng), ...(o.weather === 'snow' ? [] : sun(430, -420, 40))]
      return { sky: o.time === 'night' ? SKY.night : '#d6e6f4', back, land }
    },
  },
  {
    name: 'night',
    aliases: ['nighttime', 'bedtime-outside'],
    title: 'a starry night',
    doc: 'meadow under the moon and stars',
    build: (o) => outdoors({ ...o, time: 'night' }, '#72c858', () => {}),
  },
  {
    name: 'sky',
    aliases: ['clouds', 'air', 'high-up'],
    title: 'up in the sky',
    doc: 'only sky and big clouds (for flying)',
    build: (o) => {
      const back = o.time === 'night' ? [...stars(7, o.rng, { x0: -590, x1: 590, y0: -510, y1: 60 }), ...moon(430, -420, 46)] : [...sun(430, -420, 46)]
      const land: KitShape[] = [cloud('c1', -420, -120, 150), cloud('c2', 380, -40, 170), cloud('c3', -80, 60, 200), cloud('c4', -250, -380, 110)]
      return { sky: skyFor(o), back, land, note: 'no ground' }
    },
  },
  {
    name: 'bedroom',
    aliases: ['bed-room', 'nursery'],
    title: 'the bedroom',
    doc: 'wall, wood floor, window, rug, picture',
    build: (o) =>
      room(o, '#cfe0f5', '#d9a86c', [
        patch(oval('rug', C('coral'), -60, 55, 260, 32)),
        rrect('picture', C('yellow'), -420, -400, 130, 100, 6, C('brown')),
        patch(poly('picstar', C('orange'), starPts(-355, -350, 26, 12))),
      ]),
  },
  {
    name: 'kitchen',
    aliases: ['diningroom', 'dining'],
    title: 'the kitchen',
    doc: 'wall, tiles, window, cupboards',
    build: (o) =>
      room(o, '#fff0c8', '#e9c9a0', [
        rrect('cup1', C('mint'), -560, -440, 150, 130, 6),
        rrect('cup2', C('mint'), -400, -440, 150, 130, 6),
        circle('knob1', C('brown'), -425, -380, 6),
        circle('knob2', C('brown'), -385, -380, 6),
        { id: 'tiles', color: '#e0cda0', path: [['M', -620, -260], ['L', 200, -260], ['M', -620, -200], ['L', 200, -200]] },
      ]),
  },
  {
    name: 'room',
    aliases: ['house', 'inside', 'home', 'livingroom', 'indoors'],
    title: 'inside the house',
    doc: 'wall, wood floor, window, lamp',
    build: (o) =>
      room(o, '#f6dcc0', '#c9925a', [
        rect('lampstem', C('darkbrown'), -470, -230, 10, 230),
        poly('lampshade', C('yellow'), [P(-510, -230), P(-420, -230), P(-440, -300), P(-490, -300)]),
        rrect('frame', C('mint'), -300, -400, 110, 90, 6, C('brown')),
      ]),
  },
  {
    name: 'cave',
    aliases: ['cavern', 'den', 'tunnel'],
    title: 'the cave',
    doc: 'dark rock walls, stalactites, a glowing crystal',
    build: (o) => {
      const rock = '#6e6259'
      const land: KitShape[] = [
        blob('rockL', rock, [P(-640, -540), P(-420, -520), P(-470, -300), P(-560, -80), P(-640, 0)]),
        blob('rockR', rock, [P(640, -540), P(430, -520), P(480, -260), P(560, -60), P(640, 0)]),
        poly('stal1', rock, [P(-260, -525), P(-230, -400), P(-200, -525)]),
        poly('stal2', rock, [P(40, -525), P(70, -440), P(100, -525)]),
        poly('stal3', rock, [P(250, -525), P(275, -370), P(300, -525)]),
        groundBand('floor', '#8a7a6c', -6, o.rng, 12),
        poly('crystal', C('turquoise'), [P(420, 5), P(440, -70), P(465, 5)]),
        poly('crystal2', C('lavender'), [P(455, 5), P(485, -50), P(500, 5)]),
      ]
      return { sky: '#4a3f3a', back: [], land }
    },
  },
  {
    name: 'desert',
    aliases: ['dunes', 'sahara'],
    title: 'the desert',
    doc: 'sand dunes, cactus, hot sun',
    build: (o) => {
      const land: KitShape[] = [
        hill('dune1', '#f6d28c', -700, -40, -160),
        hill('dune2', '#f0c878', -150, 720, -200),
        blob('cactus', C('green'), [P(-470, 4), P(-475, -200), P(-440, -220), P(-430, 4)]),
        blob('cactusarm', C('green'), [P(-440, -120), P(-390, -120), P(-385, -180), P(-405, -180), P(-410, -140), P(-440, -140)]),
        groundBand('sand', '#f6d896', -4, o.rng, 8),
      ]
      return { sky: o.time === 'night' ? SKY.night : '#fbe3b0', back: skyThings(o, 420, 0), land }
    },
  },
  {
    name: 'jungle',
    aliases: ['rainforest', 'safari'],
    title: 'the jungle',
    doc: 'big leaves, vines, tall trees',
    build: (o) => {
      const d = outdoors(o, '#4fae4a', (o2, land) => {
        const g = nightTint('#2f8a45', o2)
        land.push(...roundTree('t1', -520, 420, nightTint('#3a9a44', o2)), ...roundTree('t2', 520, 440, nightTint('#3a9a44', o2)))
        land.push({ id: 'vine1', color: g, path: [['M', -380, -525], ['Q', -350, -400, -380, -300]] }, { id: 'vine2', color: g, path: [['M', 330, -525], ['Q', 360, -420, 330, -330]] })
        land.push(blob('leaf1', nightTint('#5dbb52', o2), [P(-300, 0), P(-380, -100), P(-300, -80)]), blob('leaf2', nightTint('#5dbb52', o2), [P(300, 0), P(390, -110), P(310, -80)]))
      }, false)
      return d
    },
  },
  {
    name: 'mountains',
    aliases: ['mountain', 'hills', 'valley'],
    title: 'the mountains',
    doc: 'big snowy mountains behind, meadow',
    build: (o) =>
      outdoors(o, '#72c858', (o2, land) => {
        land.push(poly('mt1', nightTint('#9a9ab4', o2), [P(-640, 10), P(-330, -400), P(-20, 10)]), patch(poly('mt1s', '#ffffff', [P(-330, -400), P(-395, -315), P(-265, -315)])))
        land.push(poly('mt2', nightTint('#8a8aa8', o2), [P(-100, 10), P(260, -460), P(640, 10)]), patch(poly('mt2s', '#ffffff', [P(260, -460), P(185, -360), P(335, -360)])))
      }, false),
  },
]

export function findPlace(name: string): PlaceDef | null {
  const n = name.toLowerCase().replace(/_/g, '-')
  return PLACES.find((p) => p.name === n || p.aliases.includes(n)) ?? null
}

export { closedCurve, oval, line, shade }
