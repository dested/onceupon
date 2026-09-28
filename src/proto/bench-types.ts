import { z } from 'zod'

/** One model call of a benched story. Times are ms from the request. */
export const benchBeatSchema = z.object({
  words: z.string(),
  lines: z.array(z.string()),
  firstTokenMs: z.number().nullable(),
  /** The first line that put ink on the page (shapes, a background, an effect). */
  firstInkMs: z.number().nullable(),
  doneMs: z.number(),
  input: z.number(),
  cacheRead: z.number(),
  cacheWrite: z.number(),
  output: z.number(),
  costUsd: z.number().nullable(),
  parseErrors: z.array(z.string()),
  error: z.string().nullable(),
})
export type BenchBeat = z.infer<typeof benchBeatSchema>

export const benchFileSchema = z.object({
  storyId: z.string(),
  dialect: z.string(),
  model: z.string(),
  /** Token count of the system prompt (count_tokens), for the record. */
  systemTokens: z.number().nullable(),
  beats: z.array(benchBeatSchema),
})
export type BenchFile = z.infer<typeof benchFileSchema>
