import { describe, expect, test } from 'bun:test'
import { Scene } from '~/engine/scene'
import { VirtualClock } from '~/engine/clock'
import { KitDialect } from './dialect'
import { KIT_SYSTEM_PROMPT } from './prompt'

const dialect = (): KitDialect => new KitDialect(new Scene(), { moderation: true })

describe('kit dialect skip', () => {
  test('skip lines end the call', () => {
    const d = dialect()
    for (const line of ['skip', 'Skip', '  skip  ', 'SKIP', '# nothing', '# Nothing.', '#nothing', '#  NOTHING']) {
      expect([line, d.isSkip(line)]).toEqual([line, true])
    }
  })

  test('ordinary lines and comments are not skips', () => {
    const d = dialect()
    for (const line of ['# the dog runs', '# nothingness', 'wait', 'pass', 'bunny 380', 'say dog skip it', '', '# could read as nothing', "# Nothing is drawn, but I'll draw it gently"]) {
      expect([line, d.isSkip(line)]).toEqual([line, false])
    }
  })

  test('pass (and the older wait) is a no-op that parses', () => {
    expect(dialect().parse('pass')).toEqual({ ok: true, cmds: [] })
    expect(dialect().parse('wait')).toEqual({ ok: true, cmds: [] })
  })

  test('the prompt never asks for a "# nothing" line', () => {
    expect(KIT_SYSTEM_PROMPT.includes('# nothing')).toBe(false)
  })
})

describe('kit dialect hide', () => {
  test('hiding behind a missing tree grows one beside the hider', () => {
    const scene = new Scene()
    const d = new KitDialect(scene, { moderation: true, clock: new VirtualClock() })
    const apply = (line: string): boolean => {
      const r = d.parse(line)
      if (r.ok) for (const c of r.cmds) scene.apply(c)
      return r.ok
    }
    expect(apply('place meadow')).toBe(true)
    expect(apply('bunny 380')).toBe(true)
    expect(apply('hide bunny tree')).toBe(true)
    expect(scene.objects.has('tree')).toBe(true)
  })
})

describe('kit dialect crayons in freehand', () => {
  test('every prompt crayon works in draw and recolor; say keeps its words', () => {
    const scene = new Scene()
    const d = new KitDialect(scene, { moderation: true, clock: new VirtualClock() })
    const apply = (line: string): boolean => {
      const r = d.parse(line)
      if (r.ok) for (const c of r.cmds) scene.apply(c)
      return r.ok
    }
    expect(apply('ent toaster 600 525')).toBe(true)
    for (const c of ['darkbrown', 'mint', 'cream', 'beige', 'coral', 'turquoise', 'lavender', 'rose', 'golden', 'blonde', 'ginger', 'red']) {
      expect([c, apply(`draw toaster.leg${c} ${c} rect -50 -60 14 60`)]).toEqual([c, true])
    }
    expect(apply('recolor toaster mint')).toBe(true)
    expect(apply('say toaster I love mint')).toBe(true)
  })
})

describe('kit dialect freehand idle', () => {
  test('an unknown idle on ent never blanks the drawing that follows', () => {
    const scene = new Scene()
    const d = new KitDialect(scene, { moderation: true, clock: new VirtualClock() })
    const apply = (line: string): boolean => {
      const r = d.parse(line)
      if (r.ok) for (const c of r.cmds) scene.apply(c)
      return r.ok
    }
    expect(apply('ent toaster 600 525 "Toaster" idle=bounce')).toBe(true)
    expect(apply('draw toaster.body black silver rect -100 -170 200 150')).toBe(true)
    expect(apply('ent jelly 300 300 idle=zoomy')).toBe(true)
    expect(apply('draw jelly.bell purple purple oval 0 -150 150 110')).toBe(true)
    expect(apply('ent kite 900 250 idle=float')).toBe(true)
  })
})

describe('kit dialect id as kind', () => {
  test('a named character can be updated by its id alone', () => {
    const scene = new Scene()
    const d = new KitDialect(scene, { moderation: true, clock: new VirtualClock() })
    const apply = (line: string): boolean => {
      const r = d.parse(line)
      if (r.ok) for (const c of r.cmds) scene.apply(c)
      return r.ok
    }
    expect(apply('place meadow')).toBe(true)
    expect(apply('man badguy 1000 black angry left')).toBe(true)
    expect(apply('badguy 300 surprised')).toBe(true)
    expect(apply('dinosaur sprinkles 400')).toBe(true)
    expect(apply('sprinkles 800')).toBe(true)
    expect(apply('nobody 800')).toBe(false)
  })
})

describe('kit aliases', () => {
  test('a jellyfish kind line draws the nearest kit (octopus) instead of nothing', () => {
    const d = dialect()
    expect(d.parse('jellyfish 600 330 pink purple').ok).toBe(true)
  })
})
