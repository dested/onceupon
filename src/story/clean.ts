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

let words: string[] = [...BAD]
let RE = compile(words)

function compile(list: string[]): RegExp {
  return new RegExp(`\\b(${list.join('|')})\\b`, 'gi')
}

/** Extend the mask list with server-supplied words (deduped, lowercased) and rebuild the matcher. */
export function addMaskWords(add: string[]): void {
  const set = new Set(words)
  for (const w of add) {
    const t = w.trim().toLowerCase()
    if (t) set.add(t)
  }
  words = [...set]
  RE = compile(words)
}

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
