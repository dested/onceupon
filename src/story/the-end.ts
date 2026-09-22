/**
 * "The End" detection. The app ends a story itself when the child says it: this runs on every chunk
 * that reaches the session (speech and typed) before the words are recorded or sent to the model, so
 * the model never sees the phrase. Matches "the end", "and that's the end", "the end!" at the end of
 * a chunk.
 */
export const THE_END = /(?:^|\s)(?:and\s+)?(?:that'?s\s+|this\s+is\s+)?the\s+end[\s.!?]*$/i

export interface SplitEnd {
  /** The chunk with a trailing ending phrase removed, trimmed. */
  before: string
  /** Whether the chunk ended with the phrase. */
  ended: boolean
}

/** Split a chunk into the words before an ending phrase and whether the story ended. */
export function splitTheEnd(text: string): SplitEnd {
  const m = THE_END.exec(text)
  if (!m) return { before: text.trim(), ended: false }
  return { before: text.slice(0, m.index).trim(), ended: true }
}
