import { z } from 'zod'
import { base64ToBlob, blobToBase64, bridgeCall } from '~/backend/bridge'
import { NATIVE } from '~/backend/config'
import { idbDelete, idbGet, idbPut } from './idb'
import { storyRecordSchema, type StoryRecord } from './storage'

/**
 * Where stories, voice clips and small key/values live. The web keeps records in localStorage and
 * blobs in IndexedDB; the native shell keeps everything through the bridge. `pickBackend()` chooses.
 */
export interface StorageBackend {
  loadAll(): Promise<StoryRecord[]>
  put(record: StoryRecord): Promise<void>
  remove(id: string): Promise<void>
  putBlob(path: string, blob: Blob): Promise<void>
  getBlob(path: string): Promise<Blob | null>
  removeBlob(path: string): Promise<void>
  getKv(key: string): Promise<string | null>
  setKv(key: string, value: string | null): Promise<void>
}

const STORIES_KEY = 'onceupon.stories'
const KV_PREFIX = 'onceupon.kv.'

export class LocalBackend implements StorageBackend {
  /** Synchronous read for dev paths that render before boot() has run. */
  loadAllSync(): StoryRecord[] {
    try {
      const raw = localStorage.getItem(STORIES_KEY)
      if (!raw) return []
      const parsed = z.array(storyRecordSchema).safeParse(JSON.parse(raw))
      return parsed.success ? parsed.data : []
    } catch {
      return []
    }
  }

  loadAll(): Promise<StoryRecord[]> {
    return Promise.resolve(this.loadAllSync())
  }

  private writeAll(records: StoryRecord[]): boolean {
    try {
      localStorage.setItem(STORIES_KEY, JSON.stringify(records))
      return true
    } catch {
      return false
    }
  }

  put(record: StoryRecord): Promise<void> {
    const all = this.loadAllSync().filter((r) => r.id !== record.id)
    all.push(record)
    if (!this.writeAll(all)) {
      // Out of room: drop covers from the other stories and retry once.
      for (const r of all) if (r.id !== record.id) r.cover = null
      this.writeAll(all)
    }
    return Promise.resolve()
  }

  remove(id: string): Promise<void> {
    this.writeAll(this.loadAllSync().filter((r) => r.id !== id))
    return Promise.resolve()
  }

  putBlob(path: string, blob: Blob): Promise<void> {
    return idbPut(path, blob)
  }
  getBlob(path: string): Promise<Blob | null> {
    return idbGet(path)
  }
  removeBlob(path: string): Promise<void> {
    return idbDelete(path)
  }

  getKv(key: string): Promise<string | null> {
    try {
      return Promise.resolve(localStorage.getItem(KV_PREFIX + key))
    } catch {
      return Promise.resolve(null)
    }
  }
  setKv(key: string, value: string | null): Promise<void> {
    try {
      if (value === null) localStorage.removeItem(KV_PREFIX + key)
      else localStorage.setItem(KV_PREFIX + key, value)
    } catch {
      // storage blocked; the value just will not survive
    }
    return Promise.resolve()
  }
}

function mimeForPath(path: string): string {
  if (path.endsWith('.m4a')) return 'audio/mp4'
  if (path.endsWith('.webm')) return 'audio/webm'
  return 'application/octet-stream'
}

export class BridgeBackend implements StorageBackend {
  async loadAll(): Promise<StoryRecord[]> {
    const { records } = await bridgeCall('stories.list', {})
    const out: StoryRecord[] = []
    for (const json of records) {
      try {
        const parsed = storyRecordSchema.safeParse(JSON.parse(json))
        if (parsed.success) out.push(parsed.data)
      } catch {
        // skip an unreadable record
      }
    }
    return out
  }

  async put(record: StoryRecord): Promise<void> {
    await bridgeCall('stories.put', { id: record.id, json: JSON.stringify(record) })
  }

  async remove(id: string): Promise<void> {
    await bridgeCall('stories.delete', { id })
  }

  async putBlob(path: string, blob: Blob): Promise<void> {
    const base64 = await blobToBase64(blob)
    await bridgeCall('blob.put', { path, base64 })
  }

  async getBlob(path: string): Promise<Blob | null> {
    const { base64 } = await bridgeCall('blob.get', { path })
    if (base64 === null) return null
    return base64ToBlob(base64, mimeForPath(path))
  }

  async removeBlob(path: string): Promise<void> {
    await bridgeCall('blob.delete', { path })
  }

  async getKv(key: string): Promise<string | null> {
    const { value } = await bridgeCall('kv.get', { key })
    return value
  }

  async setKv(key: string, value: string | null): Promise<void> {
    await bridgeCall('kv.set', { key, value })
  }
}

export function pickBackend(): StorageBackend {
  return NATIVE ? new BridgeBackend() : new LocalBackend()
}
