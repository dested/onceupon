/**
 * A tiny IndexedDB wrapper for binary blobs (voice clips) keyed by path string. Everything degrades
 * to a no-op with a single warning when IndexedDB is unavailable or blocked (private windows, some
 * webviews, thumbnail capture), so the caller never has to guard.
 */

const DB_NAME = 'onceupon'
const STORE = 'blobs'
const DB_VERSION = 1

let warned = false
function warnOnce(): void {
  if (warned) return
  warned = true
  console.warn('IndexedDB unavailable; voice clips will not persist')
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'))
  })
}

export async function idbPut(path: string, blob: Blob): Promise<void> {
  if (typeof indexedDB === 'undefined') return warnOnce()
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(blob, path)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('idb put failed'))
    })
    db.close()
  } catch {
    warnOnce()
  }
}

export async function idbGet(path: string): Promise<Blob | null> {
  if (typeof indexedDB === 'undefined') {
    warnOnce()
    return null
  }
  try {
    const db = await openDb()
    const blob = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(path)
      req.onsuccess = () => {
        const v: unknown = req.result
        resolve(v instanceof Blob ? v : null)
      }
      req.onerror = () => reject(req.error ?? new Error('idb get failed'))
    })
    db.close()
    return blob
  } catch {
    warnOnce()
    return null
  }
}

export async function idbDelete(path: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return warnOnce()
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(path)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('idb delete failed'))
    })
    db.close()
  } catch {
    warnOnce()
  }
}

export async function idbDeletePrefix(prefix: string): Promise<void> {
  if (typeof indexedDB === 'undefined') return warnOnce()
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      const req = tx.objectStore(STORE).openCursor()
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        const key = cursor.key
        if (typeof key === 'string' && key.startsWith(prefix)) cursor.delete()
        cursor.continue()
      }
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('idb deletePrefix failed'))
    })
    db.close()
  } catch {
    warnOnce()
  }
}
