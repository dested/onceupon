import { z } from 'zod'
import { LocalBackend, pickBackend, type StorageBackend } from './storage-backend'

const storyEventSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('words'), t: z.number(), text: z.string() }),
  z.object({ k: z.literal('cmd'), t: z.number(), line: z.string() }),
  // The child said "The End": the app plays a finale and shows the closing card.
  z.object({ k: z.literal('end'), t: z.number() }),
])
export type StoryEvent = z.infer<typeof storyEventSchema>

export const storyRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  seed: z.number(),
  cover: z.string().nullable(),
  /** Drawing language the cmd lines are written in; missing = lines. */
  dialect: z.string().optional(),
  events: z.array(storyEventSchema),
  /** The child's voice, recorded per listening span, stored as blobs beside the record. */
  voice: z
    .object({
      mime: z.string(),
      clips: z.array(z.object({ t: z.number(), ms: z.number(), file: z.string() })),
    })
    .optional(),
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

/**
 * The record list is held in a module cache. `initStorage()` picks the backend (bridge on native,
 * localStorage on the web) and fills the cache; the sync accessors read it. Before boot(), a
 * LocalBackend fills the cache lazily from localStorage so dev code that never calls boot still works.
 */
let backend: StorageBackend = new LocalBackend()
let records: StoryRecord[] | null = null

function cache(): StoryRecord[] {
  if (records !== null) return records
  records = backend instanceof LocalBackend ? backend.loadAllSync() : []
  return records
}

export async function initStorage(): Promise<void> {
  backend = pickBackend()
  records = await backend.loadAll()
}

export function listStories(): StoryMeta[] {
  return cache()
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
  return cache().find((r) => r.id === id) ?? null
}

export function saveStory(record: StoryRecord): boolean {
  records = cache().filter((r) => r.id !== record.id)
  records.push(record)
  void backend.put(record).catch((e: unknown) => console.warn('saveStory failed', e))
  return true
}

export function deleteStory(id: string): void {
  const removed = cache().find((r) => r.id === id)
  records = cache().filter((r) => r.id !== id)
  void backend.remove(id).catch((e: unknown) => console.warn('deleteStory failed', e))
  if (removed?.voice) {
    for (const clip of removed.voice.clips) void backend.removeBlob(clip.file).catch(() => undefined)
  }
}

/** Validate an untrusted record (the player loads records that crossed the wire). */
export function parseStoryRecord(input: unknown): StoryRecord | null {
  const parsed = storyRecordSchema.safeParse(input)
  return parsed.success ? parsed.data : null
}

export async function putVoiceClip(
  storyId: string,
  index: number,
  blob: Blob,
  mime: string
): Promise<string> {
  const ext = mime === 'audio/mp4' ? 'm4a' : 'webm'
  const path = `voice/${storyId}/${index}.${ext}`
  await backend.putBlob(path, blob)
  return path
}

export function getVoiceClip(file: string): Promise<Blob | null> {
  return backend.getBlob(file)
}

export function getKv(key: string): Promise<string | null> {
  return backend.getKv(key)
}

export function setKv(key: string, value: string | null): Promise<void> {
  return backend.setKv(key, value)
}

/** Words a title must not end on ("There was a purple dragon named"). */
const DANGLING = new Set(
  'a an the and or but of in on at to with from for by named called was were is are who that which his her their my our its under over into onto near behind beside above below across through around up down off about after before like as so then when where very big little'.split(
    ' '
  )
)

/**
 * The shelf title: the story's first sentence when it is short (up to 8 words), else the longest 5–8
 * word start of it that ends on a real word, never ending on a dangling word. "Once upon a time" is dropped.
 */
export function titleFromWords(text: string): string {
  const cleaned = text.replace(/^(once upon a time,?\s*)/i, '').trim() || text.trim()
  const firstSentence = cleaned.split(/[.!?]/, 1)[0] ?? ''
  const sentenceWords = firstSentence.split(/\s+/).filter(Boolean)
  const strip = (w: string): string => w.replace(/[,;:]+$/, '')
  const dangling = (w: string | undefined): boolean => DANGLING.has((w ?? '').toLowerCase())
  let words: string[]
  if (sentenceWords.length > 0 && sentenceWords.length <= 8) {
    words = sentenceWords.map(strip)
  } else {
    // A long sentence: the longest 5–8 word start that ends on a real word ("A purple dragon lived in
    // a big castle", not "A purple dragon lived"); else the first six words.
    const pool = (sentenceWords.length > 0 ? sentenceWords : cleaned.split(/\s+/).filter(Boolean)).map(strip)
    words = pool.slice(0, 6)
    for (let n = Math.min(8, pool.length); n >= 5; n--) {
      if (!dangling(pool[n - 1])) {
        words = pool.slice(0, n)
        break
      }
    }
  }
  while (words.length > 1 && dangling(words[words.length - 1])) words = words.slice(0, -1)
  if (words.length === 0) return 'Untitled story'
  const t = words.join(' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export function newStoryId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
