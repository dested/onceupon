import { describe, expect, test } from 'bun:test'
import { Scene } from '~/engine/scene'
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
    for (const line of ['# the dog runs', '# nothingness', 'wait', 'bunny 380', 'say dog skip it', '', '# could read as nothing', "# Nothing is drawn, but I'll draw it gently"]) {
      expect([line, d.isSkip(line)]).toEqual([line, false])
    }
  })

  test('wait is a no-op that parses', () => {
    expect(dialect().parse('wait')).toEqual({ ok: true, cmds: [] })
  })

  test('the prompt never asks for a "# nothing" line', () => {
    expect(KIT_SYSTEM_PROMPT.includes('# nothing')).toBe(false)
  })
})
