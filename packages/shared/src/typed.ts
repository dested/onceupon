/**
 * Typed words are metered as talking time: a child saying the same sentence would keep the mic open
 * about this long. The server computes the charge from the text (`session.typed`); the studio never
 * reports a duration for typed input. This file is the one place the rule lives.
 */

/** Speaking pace a typed message is charged at. */
export const TYPED_WORDS_PER_SEC = 2.5
/** Every typed message costs at least this much. */
export const TYPED_MIN_SEC = 3
/** Longest typed message the server accepts, in characters. */
export const TYPED_MAX_CHARS = 4000

/** A word is a whitespace-separated token with at least one letter or digit ("--" and "…" are not words). */
export function countTypedWords(text: string): number {
  let n = 0
  for (const token of text.split(/\s+/)) if (/[\p{L}\p{N}]/u.test(token)) n++
  return n
}

/** Seconds charged for one typed message: max(3, ceil(words / 2.5)). */
export function typedChargeSec(text: string): number {
  return Math.max(TYPED_MIN_SEC, Math.ceil(countTypedWords(text) / TYPED_WORDS_PER_SEC))
}
