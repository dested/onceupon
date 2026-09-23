/**
 * When each coach line speaks during the tutorial replay. `at` anchors the line to a moment in the
 * canned story; `holdMs` is how long the replay pauses on that line (0 = keep playing under it).
 */
export interface Cue {
  line: 1 | 2 | 3 | 4
  at:
    | { kind: 'start' }
    | { kind: 'firstCmd' }
    | { kind: 'wordsIndex'; n: number }
    | { kind: 'end' }
  holdMs: number
}

export const CUES: Cue[] = [
  { line: 1, at: { kind: 'start' }, holdMs: 3800 },
  { line: 2, at: { kind: 'firstCmd' }, holdMs: 0 },
  { line: 3, at: { kind: 'wordsIndex', n: 2 }, holdMs: 3800 },
  { line: 4, at: { kind: 'end' }, holdMs: 3200 },
]
