/**
 * People: one front-facing picture-book figure (big head, round body, stubby limbs) dressed by role.
 * Color slots: outfit, hair, skin.
 */
import { blob, circle, ink, light, line, oval, P, path, patch, poly, rrect, shade, starPts, xform, type KitShape, type Rng } from '../geom'
import { C, SKINS, slot } from '../palette'
import type { KitDef, KitDrawing, KitParams } from '../types'

type Hair = 'short' | 'long' | 'pigtails' | 'bun' | 'curly' | 'bald' | 'spiky' | 'none'
type Outfit = 'clothes' | 'dress' | 'gown' | 'robe' | 'armor' | 'suit' | 'stripes' | 'diaper'

interface Role {
  hair: Hair
  hairColor: string
  outfit: Outfit
  outfitColor: string
  pants?: string
  wear?: string[]
  beard?: string
  /** Held prop. */
  hold?: 'wand' | 'sword' | 'staff' | 'cane' | 'none'
  scale?: number
  cheeks?: boolean
}

const ROLES: Record<string, Role> = {
  kid: { hair: 'short', hairColor: 'brown', outfit: 'clothes', outfitColor: 'red', pants: 'blue' },
  boy: { hair: 'short', hairColor: 'brown', outfit: 'clothes', outfitColor: 'blue', pants: 'darkblue' },
  girl: { hair: 'pigtails', hairColor: 'ginger', outfit: 'dress', outfitColor: 'pink', wear: ['bow'] },
  baby: { hair: 'bald', hairColor: 'blonde', outfit: 'diaper', outfitColor: 'white', scale: 0.62 },
  mom: { hair: 'long', hairColor: 'darkbrown', outfit: 'dress', outfitColor: 'coral' },
  dad: { hair: 'short', hairColor: 'darkbrown', outfit: 'clothes', outfitColor: 'green', pants: 'darkblue', scale: 1.12 },
  man: { hair: 'short', hairColor: 'black', outfit: 'clothes', outfitColor: 'teal', pants: 'darkbrown', scale: 1.1 },
  woman: { hair: 'long', hairColor: 'blonde', outfit: 'dress', outfitColor: 'purple', scale: 1.05 },
  grandma: { hair: 'bun', hairColor: 'white', outfit: 'dress', outfitColor: 'lavender', wear: ['glasses'] },
  grandpa: { hair: 'bald', hairColor: 'white', outfit: 'clothes', outfitColor: 'olive', pants: 'darkbrown', wear: ['glasses'], hold: 'cane', beard: 'white' },
  prince: { hair: 'short', hairColor: 'blonde', outfit: 'clothes', outfitColor: 'blue', pants: 'white', wear: ['crown', 'cape'] },
  princess: { hair: 'long', hairColor: 'blonde', outfit: 'gown', outfitColor: 'pink', wear: ['tiara'] },
  king: { hair: 'short', hairColor: 'brown', outfit: 'robe', outfitColor: 'red', wear: ['crown', 'cape'], beard: 'brown', scale: 1.1 },
  queen: { hair: 'long', hairColor: 'darkbrown', outfit: 'gown', outfitColor: 'purple', wear: ['crown', 'cape'], scale: 1.05 },
  knight: { hair: 'none', hairColor: 'brown', outfit: 'armor', outfitColor: 'silver', wear: ['helmet'], hold: 'sword' },
  wizard: { hair: 'short', hairColor: 'white', outfit: 'robe', outfitColor: 'indigo', wear: ['wizardhat'], beard: 'white', hold: 'staff', scale: 1.08 },
  witch: { hair: 'long', hairColor: 'black', outfit: 'robe', outfitColor: 'purple', wear: ['wizardhat'], hold: 'wand' },
  fairy: { hair: 'bun', hairColor: 'blonde', outfit: 'dress', outfitColor: 'mint', wear: ['wings'], hold: 'wand', scale: 0.85 },
  astronaut: { hair: 'none', hairColor: 'brown', outfit: 'suit', outfitColor: 'white', wear: [] },
  pirate: { hair: 'curly', hairColor: 'black', outfit: 'stripes', outfitColor: 'red', pants: 'darkbrown', wear: ['pirate', 'eyepatch'], hold: 'sword' },
  superhero: { hair: 'short', hairColor: 'black', outfit: 'clothes', outfitColor: 'blue', pants: 'blue', wear: ['cape', 'mask'] },
  chef: { hair: 'short', hairColor: 'brown', outfit: 'clothes', outfitColor: 'white', pants: 'gray' },
  doctor: { hair: 'short', hairColor: 'black', outfit: 'robe', outfitColor: 'white' },
  farmer: { hair: 'short', hairColor: 'ginger', outfit: 'clothes', outfitColor: 'blue', pants: 'blue', wear: ['hat'] },
  cowboy: { hair: 'short', hairColor: 'brown', outfit: 'clothes', outfitColor: 'red', pants: 'blue', wear: ['hat'] },
  teacher: { hair: 'bun', hairColor: 'brown', outfit: 'dress', outfitColor: 'teal', wear: ['glasses'] },
  clown: { hair: 'curly', hairColor: 'orange', outfit: 'stripes', outfitColor: 'yellow', pants: 'purple', wear: ['partyhat'] },
}

function hairShapes(style: Hair, col: string, cx: number, cy: number, r: number, rng: Rng): { back: KitShape[]; front: KitShape[] } {
  const back: KitShape[] = []
  const front: KitShape[] = []
  const top = cy - r
  const cap = (id: string): KitShape =>
    path(id, col, [
      ['M', cx - r * 1.04, cy - r * 0.05],
      ['C', cx - r * 1.12, top - r * 0.35, cx + r * 1.12, top - r * 0.35, cx + r * 1.04, cy - r * 0.05],
      ['Q', cx + r * 0.85, cy - r * 0.55, cx + r * 0.3, cy - r * 0.62],
      ['Q', cx - r * 0.15, cy - r * 0.42, cx - r * 0.45, cy - r * 0.62],
      ['Q', cx - r * 0.9, cy - r * 0.55, cx - r * 1.04, cy - r * 0.05],
      ['Z'],
    ])
  switch (style) {
    case 'short':
      front.push(cap('hair'))
      break
    case 'spiky': {
      const pts = []
      const n = 7
      for (let i = 0; i <= n; i++) {
        const a = Math.PI + (i / n) * Math.PI
        const rr = i % 2 === 0 ? r * 1.05 : r * 1.35
        pts.push(P(cx + Math.cos(a) * rr, cy - r * 0.2 + Math.sin(a) * rr))
      }
      front.push(poly('hair', col, [P(cx - r * 1.02, cy - r * 0.1), ...pts, P(cx + r * 1.02, cy - r * 0.1), P(cx, cy - r * 0.55)]))
      break
    }
    case 'long':
      back.push(path('hairback', col, [
        ['M', cx - r * 1.1, cy - r * 0.2],
        ['C', cx - r * 1.3, top - r * 0.3, cx + r * 1.3, top - r * 0.3, cx + r * 1.1, cy - r * 0.2],
        ['Q', cx + r * 1.35, cy + r * 1.2, cx + r * 1.0, cy + r * 1.75],
        ['L', cx - r * 1.0, cy + r * 1.75],
        ['Q', cx - r * 1.35, cy + r * 1.2, cx - r * 1.1, cy - r * 0.2],
        ['Z'],
      ]))
      front.push(cap('hair'))
      break
    case 'pigtails':
      back.push(blob('pigtail', col, [P(cx + r * 0.85, cy - r * 0.35), P(cx + r * 1.45, cy + r * 0.1), P(cx + r * 1.35, cy + r * 0.75), P(cx + r * 1.05, cy + r * 0.45)]))
      back.push(blob('pigtail2', col, [P(cx - r * 0.85, cy - r * 0.35), P(cx - r * 1.45, cy + r * 0.1), P(cx - r * 1.35, cy + r * 0.75), P(cx - r * 1.05, cy + r * 0.45)]))
      front.push(circle('tie', C('pink'), cx + r * 0.98, cy - r * 0.22, r * 0.12), circle('tie2', C('pink'), cx - r * 0.98, cy - r * 0.22, r * 0.12))
      front.push(cap('hair'))
      break
    case 'bun':
      back.push(circle('bun', col, cx, top - r * 0.12, r * 0.42))
      front.push(cap('hair'))
      break
    case 'curly': {
      front.push(path('hair', col, [
        ['M', cx - r * 1.05, cy - r * 0.05],
        ...scallopArc(cx, cy - r * 0.1, r * 1.12, r * 1.08, 7, rng),
        ['Q', cx + r * 0.6, cy - r * 0.6, cx, cy - r * 0.62],
        ['Q', cx - r * 0.6, cy - r * 0.6, cx - r * 1.05, cy - r * 0.05],
        ['Z'],
      ]))
      break
    }
    case 'bald': {
      front.push(blob('hair', col, [P(cx - r * 0.98, cy - r * 0.45), P(cx - r * 1.22, cy - r * 0.12), P(cx - r * 1.02, cy + r * 0.2), P(cx - r * 0.86, cy - r * 0.05)]))
      front.push(blob('hair2', col, [P(cx + r * 0.98, cy - r * 0.45), P(cx + r * 1.22, cy - r * 0.12), P(cx + r * 1.02, cy + r * 0.2), P(cx + r * 0.86, cy - r * 0.05)]))
      front.push(line('curl', ink(col), [P(cx - r * 0.1, top + r * 0.02), P(cx + r * 0.1, top - r * 0.2), P(cx + r * 0.2, top - r * 0.05)]))
      break
    }
    case 'none':
      break
  }
  return { back, front }
}

/** Bumps along the top half of an ellipse from left to right (for curly hair). */
function scallopArc(cx: number, cy: number, rx: number, ry: number, bumps: number, rng: Rng): Array<['Q', number, number, number, number]> {
  const out: Array<['Q', number, number, number, number]> = []
  for (let i = 0; i < bumps; i++) {
    const a0 = Math.PI + (i / bumps) * Math.PI
    const a1 = Math.PI + ((i + 1) / bumps) * Math.PI
    const am = (a0 + a1) / 2
    const bump = 1.28 + rng() * 0.08
    out.push([
      'Q',
      Math.round(cx + Math.cos(am) * rx * bump),
      Math.round(cy + Math.sin(am) * ry * bump),
      Math.round(cx + Math.cos(a1) * rx),
      Math.round(cy + Math.sin(a1) * ry),
    ])
  }
  return out
}

function arm(id: string, sleeve: string, skin: string, side: 1 | -1, shoulder: { x: number; y: number }, len: number, angle: number): KitShape[] {
  const a = side * angle
  const s = xform([rrect(id, sleeve, -13, -6, 26, len, 13)], { rot: -a, dx: shoulder.x * side, dy: shoulder.y })
  const hx = shoulder.x * side + Math.sin(a) * (len - 4)
  const hy = shoulder.y + Math.cos(a) * (len - 4)
  return [...s, circle(`${id}_hand`, skin, hx, hy, 13)]
}

function buildPerson(role: Role, p: KitParams): KitDrawing {
  const rng = p.rng
  const outfit = slot(p, 0, role.outfitColor)
  const hairCol = slot(p, 1, role.hairColor)
  const skin = p.colors[2] ?? SKINS[Math.floor(rng() * SKINS.length)] ?? '#f7c9a3'
  const pants = role.pants ? C(role.pants) : shade(outfit, 0.35)
  const shoes = C('darkbrown')
  const shapes: KitShape[] = []
  const back: KitShape[] = []
  const r = 60
  const hcy = -212
  const sleepy = p.pose === 'sleep'

  // hair behind, beard behind? no: beard in front of the head, before the face
  const hair = role.hair === 'none' ? { back: [], front: [] } : hairShapes(role.hair, hairCol, 0, hcy, r, rng)
  back.push(...hair.back)

  // legs and shoes
  const skirt = role.outfit === 'dress' || role.outfit === 'gown' || role.outfit === 'robe'
  const legCol = skirt ? skin : role.outfit === 'suit' || role.outfit === 'armor' ? outfit : pants
  if (role.outfit !== 'gown' && role.outfit !== 'robe') {
    shapes.push(rrect('legs', legCol, 8, -78, 22, 72, 9))
    shapes.push({ ...rrect('legs2', legCol, -30, -78, 22, 72, 9) })
  }
  shapes.push(oval('shoes', role.outfit === 'suit' ? C('gray') : shoes, 22, -8, 22, 11))
  shapes.push(oval('shoes2', role.outfit === 'suit' ? C('gray') : shoes, -22, -8, 22, 11))

  // arms behind the body
  const sleeve = role.outfit === 'diaper' ? skin : role.outfit === 'stripes' ? outfit : outfit
  const armLen = 62
  const hold = role.hold ?? 'none'
  shapes.push(...arm('arm', sleeve, skin, 1, { x: 40, y: -146 }, armLen, hold === 'none' ? 0.42 : 0.9))
  shapes.push(...arm('arm2', sleeve, skin, -1, { x: 40, y: -146 }, armLen, 0.42))

  // body
  switch (role.outfit) {
    case 'clothes':
    case 'stripes':
    case 'armor':
    case 'suit':
      shapes.push(path('body', outfit, [
        ['M', -44, -152],
        ['Q', 0, -164, 44, -152],
        ['Q', 52, -110, 46, -70],
        ['Q', 0, -60, -46, -70],
        ['Q', -52, -110, -44, -152],
        ['Z'],
      ]))
      if (role.outfit === 'stripes') {
        for (let i = 0; i < 3; i++) shapes.push(patch(rrect(`stripe${i}`, C('white'), -44, -140 + i * 24, 88, 10, 4)))
      }
      if (role.outfit === 'armor') shapes.push(patch(oval('shine', light(outfit, 0.5), -18, -128, 10, 18)))
      if (role.outfit === 'suit') {
        shapes.push(rrect('panel', C('skyblue'), -20, -132, 40, 30, 6))
        shapes.push(circle('button', C('red'), -8, -117, 5))
      }
      break
    case 'dress':
      shapes.push(path('body', outfit, [
        ['M', -36, -152],
        ['Q', 0, -162, 36, -152],
        ['Q', 44, -110, 70, -56],
        ['Q', 0, -44, -70, -56],
        ['Q', -44, -110, -36, -152],
        ['Z'],
      ]))
      shapes.push(patch(path('trim', light(outfit, 0.5), [['M', -66, -64], ['Q', 0, -52, 66, -64], ['L', 70, -56], ['Q', 0, -44, -70, -56], ['Z']])))
      break
    case 'gown':
    case 'robe': {
      const hem = role.outfit === 'gown' ? 92 : 62
      shapes.push(path('body', outfit, [
        ['M', -36, -152],
        ['Q', 0, -162, 36, -152],
        ['Q', 50, -80, hem, -8],
        ['Q', 0, 4, -hem, -8],
        ['Q', -50, -80, -36, -152],
        ['Z'],
      ]))
      if (role.outfit === 'gown') {
        shapes.push(patch(path('ruffle', light(outfit, 0.45), [['M', -hem + 8, -30], ['Q', 0, -18, hem - 8, -30], ['L', hem, -8], ['Q', 0, 4, -hem, -8], ['Z']])))
        shapes.push(patch(oval('waist', shade(outfit, 0.2), 0, -112, 36, 7)))
      } else {
        shapes.push(patch(rrect('belt', C('golden'), -40, -100, 80, 12, 5)))
        if (role.hairColor === 'white') shapes.push(patch(poly('robestar', C('yellow'), starPts(-26, -50, 13, 6))))
      }
      break
    }
    case 'diaper':
      shapes.push(oval('body', skin, 0, -104, 46, 50))
      shapes.push(path('diaper', C('white'), [['M', -44, -86], ['Q', 0, -76, 44, -86], ['Q', 40, -52, 0, -48], ['Q', -40, -52, -44, -86], ['Z']]))
      break
  }

  // held prop in the right hand (viewer's right)
  const hx = 40 + Math.sin(0.9) * 58
  const hy = -146 + Math.cos(0.9) * 58
  if (hold === 'wand') {
    shapes.push(line('wand', C('darkbrown'), [P(hx, hy), P(hx + 30, hy - 50)], false))
    shapes.push(poly('wandstar', C('yellow'), starPts(hx + 32, hy - 56, 18, 8)))
  } else if (hold === 'sword') {
    shapes.push(poly('blade', C('silver'), [P(hx - 6, hy - 14), P(hx - 4, hy - 110), P(hx + 4, hy - 124), P(hx + 10, hy - 110), P(hx + 8, hy - 14)]))
    shapes.push(rrect('guard', C('golden'), hx - 20, hy - 18, 42, 10, 4))
  } else if (hold === 'staff') {
    shapes.push(rrect('staff', C('brown'), hx - 5, hy - 150, 10, 160, 5))
    shapes.push(circle('orb', C('turquoise'), hx, hy - 158, 16))
  } else if (hold === 'cane') {
    shapes.push({ id: 'cane', color: C('darkbrown'), path: [['M', hx, hy + 4], ['L', hx + 2, -4], ['M', hx, hy + 4], ['Q', hx + 2, hy - 26, hx - 20, hy - 20]] })
  }
  // re-add hand on top of the prop
  if (hold !== 'none') shapes.push(circle('hand_top', skin, hx, hy, 13))

  // head
  const head = circle('head', skin, 0, hcy, r, mixInk(skin))
  shapes.push(head)
  if (role.outfit === 'suit') shapes.push({ id: 'visor', color: C('skyblue'), circle: [0, hcy, r * 1.28] })
  const beard = role.beard ? C(role.beard) : null
  if (beard) {
    shapes.push(path('beard', beard, [
      ['M', -r * 0.92, hcy + r * 0.05],
      ['Q', -r * 0.9, hcy + r * 1.6, 0, hcy + r * 1.75],
      ['Q', r * 0.9, hcy + r * 1.6, r * 0.92, hcy + r * 0.05],
      ['Q', r * 0.5, hcy + r * 0.62, 0, hcy + r * 0.62],
      ['Q', -r * 0.5, hcy + r * 0.62, -r * 0.92, hcy + r * 0.05],
      ['Z'],
    ]))
  }
  shapes.push(...hair.front)
  if (role.cheeks !== false && !beard) {
    shapes.push(patch(oval('cheek', C('pink'), r * 0.52, hcy + r * 0.3, r * 0.17, r * 0.11)))
    shapes.push(patch(oval('cheek2', C('pink'), -r * 0.52, hcy + r * 0.3, r * 0.17, r * 0.11)))
  }
  const d: KitDrawing = {
    shapes: [...back, ...shapes],
    head: { id: 'head', cx: 0, cy: hcy, r, facing: 'front' },
    neck: { x: 0, y: -150, w: 70 },
    hand: P(hx, hy),
  }
  if (sleepy) return d
  return d
}

const mixInk = (skin: string): string => ink(skin)

function def(kind: string, role: Role, doc: string, aliases?: string[]): KitDef {
  return {
    kind,
    ...(aliases ? { aliases } : {}),
    doc,
    height: Math.round(275 * (role.scale ?? 1)),
    idle: 'breathe',
    character: true,
    build: (p) => {
      const d = buildPerson({ ...role, wear: [] }, p)
      const s = role.scale ?? 1
      if (s === 1) return d
      return scaleDrawing(d, s)
    },
  }
}

/** Default accessories of a role (the dialect adds them to the model's wear= list). */
export function roleWear(kind: string): string[] {
  return ROLES[kind]?.wear ?? []
}

export function scaleDrawing(d: KitDrawing, s: number): KitDrawing {
  const out: KitDrawing = { ...d, shapes: xform(d.shapes, { s }) }
  if (d.front) out.front = xform(d.front, { s })
  if (d.head) out.head = { ...d.head, cx: d.head.cx * s, cy: d.head.cy * s, r: d.head.r * s }
  if (d.neck) out.neck = { x: d.neck.x * s, y: d.neck.y * s, w: d.neck.w * s }
  if (d.hand) out.hand = P(d.hand.x * s, d.hand.y * s)
  if (d.seat) out.seat = P(d.seat.x * s, d.seat.y * s)
  return out
}

const R = (k: string): Role => {
  const r = ROLES[k]
  if (!r) throw new Error(`no role ${k}`)
  return r
}

export const PEOPLE: KitDef[] = [
  def('kid', R('kid'), 'kid [shirt] [hair] [skin]', ['child', 'person']),
  def('boy', R('boy'), 'boy [shirt] [hair] [skin]'),
  def('girl', R('girl'), 'girl [dress] [hair] [skin] (pigtails, bow)'),
  def('baby', R('baby'), 'baby [diaper] [hair] [skin]'),
  def('mom', R('mom'), 'mom [dress] [hair] [skin]', ['mommy', 'mother', 'mum']),
  def('dad', R('dad'), 'dad [shirt] [hair] [skin]', ['daddy', 'father']),
  def('man', R('man'), 'man [shirt] [hair] [skin]'),
  def('woman', R('woman'), 'woman [dress] [hair] [skin]', ['lady']),
  def('grandma', R('grandma'), 'grandma [dress] [hair] [skin] (bun, glasses)', ['granny', 'grandmother']),
  def('grandpa', R('grandpa'), 'grandpa [shirt] [hair] [skin] (glasses, cane, beard)', ['grandfather']),
  def('prince', R('prince'), 'prince [shirt] [hair] [skin] (crown, cape)'),
  def('princess', R('princess'), 'princess [gown] [hair] [skin] (tiara)'),
  def('king', R('king'), 'king [robe] [hair] [skin] (crown, cape, beard)'),
  def('queen', R('queen'), 'queen [gown] [hair] [skin] (crown, cape)'),
  def('knight', R('knight'), 'knight [armor] - [skin] (helmet, sword)'),
  def('wizard', R('wizard'), 'wizard [robe] [beard] [skin] (hat, staff)'),
  def('witch', R('witch'), 'witch [robe] [hair] [skin] (hat, wand)'),
  def('fairy', R('fairy'), 'fairy [dress] [hair] [skin] (wings, wand)'),
  def('astronaut', R('astronaut'), 'astronaut [suit] - [skin] (helmet bubble)', ['spaceman']),
  def('pirate', R('pirate'), 'pirate [shirt] [hair] [skin] (hat, patch, sword)'),
  def('superhero', R('superhero'), 'superhero [suit] [hair] [skin] (cape, mask)', ['hero']),
  def('chef', R('chef'), 'chef [shirt] [hair] [skin]', ['cook']),
  def('doctor', R('doctor'), 'doctor [coat] [hair] [skin]', ['nurse']),
  def('farmer', R('farmer'), 'farmer [shirt] [hair] [skin] (hat)'),
  def('cowboy', R('cowboy'), 'cowboy [shirt] [hair] [skin] (hat)', ['cowgirl']),
  def('teacher', R('teacher'), 'teacher [dress] [hair] [skin]'),
  def('clown', R('clown'), 'clown [shirt] [hair] [skin]'),
]
