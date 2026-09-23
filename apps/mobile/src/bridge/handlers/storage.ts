import { Directory, File, Paths } from 'expo-file-system'
import { z } from 'zod'
import { BridgeHostError, parseInput, type Handler } from '../host'

// Story JSON and voice clips live under documents/onceupon/. `stories/<id>.json` is the record;
// `voice/<id>/...` holds that story's clips; other blob paths are relative under the same root.
const ROOT_DIR = 'onceupon'

function root(): Directory {
  return new Directory(Paths.document, ROOT_DIR)
}

function ensure(dir: Directory): void {
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
}

function safeId(id: string): string {
  if (id.length === 0 || id.includes('/') || id.includes('\\') || id.includes('..')) {
    throw new BridgeHostError('bad_request', `illegal story id: ${id}`)
  }
  return id
}

/** Split a relative blob path into safe segments, rejecting traversal and absolute paths. */
function safeSegments(rel: string): string[] {
  if (rel.startsWith('/')) throw new BridgeHostError('bad_request', `absolute path not allowed: ${rel}`)
  const segments = rel.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) throw new BridgeHostError('bad_request', 'empty path')
  for (const segment of segments) {
    if (segment === '.' || segment === '..') throw new BridgeHostError('bad_request', `illegal path segment in ${rel}`)
  }
  return segments
}

export const storiesList: Handler<'stories.list'> = async () => {
  const dir = new Directory(root(), 'stories')
  if (!dir.exists) return { records: [] }
  const records: string[] = []
  for (const entry of dir.list()) {
    if (entry instanceof File && entry.name.endsWith('.json')) {
      try {
        records.push(await entry.text())
      } catch {
        // Skip a clip that cannot be read rather than failing the whole list.
      }
    }
  }
  return { records }
}

const storiesPutSchema = z.object({ id: z.string(), json: z.string() })
export const storiesPut: Handler<'stories.put'> = async (input) => {
  const { id, json } = parseInput(storiesPutSchema, input)
  const file = new File(root(), 'stories', `${safeId(id)}.json`)
  file.create({ intermediates: true, overwrite: true })
  file.write(json)
  return {}
}

const idSchema = z.object({ id: z.string() })
export const storiesDelete: Handler<'stories.delete'> = async (input) => {
  const { id } = parseInput(idSchema, input)
  const storyId = safeId(id)
  const file = new File(root(), 'stories', `${storyId}.json`)
  if (file.exists) file.delete()
  const voiceDir = new Directory(root(), 'voice', storyId)
  if (voiceDir.exists) voiceDir.delete()
  return {}
}

const blobPutSchema = z.object({ path: z.string(), base64: z.string() })
export const blobPut: Handler<'blob.put'> = async (input) => {
  const { path, base64 } = parseInput(blobPutSchema, input)
  const file = new File(root(), ...safeSegments(path))
  file.create({ intermediates: true, overwrite: true })
  file.write(base64, { encoding: 'base64' })
  return {}
}

const pathSchema = z.object({ path: z.string() })
export const blobGet: Handler<'blob.get'> = async (input) => {
  const { path } = parseInput(pathSchema, input)
  const file = new File(root(), ...safeSegments(path))
  if (!file.exists) return { base64: null }
  return { base64: await file.base64() }
}

export const blobDelete: Handler<'blob.delete'> = async (input) => {
  const { path } = parseInput(pathSchema, input)
  const file = new File(root(), ...safeSegments(path))
  if (file.exists) file.delete()
  return {}
}

// Exposed for handlers that share the same root (kv.json).
export { root as storageRoot, ensure as ensureDir }
