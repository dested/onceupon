/**
 * Kid-safety text filter. Masks profanity and slurs in anything shown on screen, saved, or sent
 * to the drawing model: the child's transcript, and the model's own `say` / `t` text.
 * The list is deliberately short and blunt; the drawing model gets separate content rules in the prompt.
 */
const BAD = [
  'fuck',
  'fucking',
  'fucked',
  'shit',
  'shitty',
  'bullshit',
  'bitch',
  'bitches',
  'asshole',
  'assholes',
  'dick',
  'dicks',
  'cock',
  'pussy',
  'cunt',
  'slut',
  'whore',
  'bastard',
  'damn',
  'goddamn',
  'crap',
  'piss',
  'pissed',
  'nigger',
  'nigga',
  'faggot',
  'fag',
  'retard',
  'retarded',
  'sex',
  'sexy',
  'porn',
  'penis',
  'vagina',
  'boobs',
  'tits',
  'nude',
  'naked',
]

const RE = new RegExp(`\\b(${BAD.join('|')})\\b`, 'gi')

let enabled = true

/** Settings → "kid-safe moderation". Off = words pass through untouched. */
export function setModeration(on: boolean): void {
  enabled = on
}

export function cleanText(text: string): string {
  if (!enabled) return text
  return text.replace(RE, (m) => (m[0] ?? '*') + '*'.repeat(Math.max(1, m.length - 1)))
}

export function hasBadWords(text: string): boolean {
  RE.lastIndex = 0
  return RE.test(text)
}
