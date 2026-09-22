import { z } from 'zod'

const storyEventSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('words'), t: z.number(), text: z.string() }),
  z.object({ k: z.literal('cmd'), t: z.number(), line: z.string() }),
  // The child said "The End": the app plays a finale and shows the closing card.
  z.object({ k: z.literal('end'), t: z.number() }),
])
export type StoryEvent = z.infer<typeof storyEventSchema>

const storyRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  seed: z.number(),
  cover: z.string().nullable(),
  /** Drawing language the cmd lines are written in; missing = lines. */
  dialect: z.string().optional(),
  events: z.array(storyEventSchema),
})
export type StoryRecord = z.infer<typeof storyRecordSchema>

export interface StoryMeta {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  cover: string | null
  words: number
}

const KEY = 'onceupon.stories'

function readAll(): StoryRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = z.array(storyRecordSchema).safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

function writeAll(records: StoryRecord[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(records))
    return true
  } catch {
    return false
  }
}

export function listStories(): StoryMeta[] {
  return readAll()
    .map((r) => ({
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      cover: r.cover,
      words: r.events
        .filter((e) => e.k === 'words')
        .reduce((n, e) => n + (e.k === 'words' ? e.text.split(/\s+/).length : 0), 0),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getStory(id: string): StoryRecord | null {
  return readAll().find((r) => r.id === id) ?? null
}

export function saveStory(record: StoryRecord): boolean {
  const all = readAll().filter((r) => r.id !== record.id)
  all.push(record)
  if (writeAll(all)) return true
  // Out of room: drop covers from old stories and retry once.
  for (const r of all) if (r.id !== record.id) r.cover = null
  return writeAll(all)
}

export function deleteStory(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id))
}

export function titleFromWords(text: string): string {
  const cleaned = text.replace(/^(once upon a time,?\s*)/i, '').trim()
  const words = (cleaned || text).split(/\s+/).filter(Boolean).slice(0, 6)
  if (words.length === 0) return 'Untitled story'
  const t = words.join(' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function newStoryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
