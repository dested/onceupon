import { File } from 'expo-file-system'
import * as SecureStore from 'expo-secure-store'
import { z } from 'zod'
import { KV_KEYS } from '../../../../../packages/shared/src/bridge'
import { parseInput, type Handler } from '../host'
import { ensureDir, storageRoot } from './storage'

// Small keys the studio wants kept in the keychain; everything else lives in a plain kv.json file
// under the same documents/onceupon/ root as the stories.
const SECURE_KEYS: ReadonlySet<string> = new Set([KV_KEYS.deviceToken])

const mapSchema = z.record(z.string(), z.string())

function kvFile(): File {
  return new File(storageRoot(), 'kv.json')
}

async function readMap(): Promise<Record<string, string>> {
  const file = kvFile()
  if (!file.exists) return {}
  try {
    return mapSchema.parse(JSON.parse(await file.text()))
  } catch {
    return {}
  }
}

function writeMap(map: Record<string, string>): void {
  ensureDir(storageRoot())
  const file = kvFile()
  file.create({ intermediates: true, overwrite: true })
  file.write(JSON.stringify(map))
}

const getSchema = z.object({ key: z.string() })
export const kvGet: Handler<'kv.get'> = async (input) => {
  const { key } = parseInput(getSchema, input)
  if (SECURE_KEYS.has(key)) return { value: await SecureStore.getItemAsync(key) }
  const map = await readMap()
  return { value: map[key] ?? null }
}

const setSchema = z.object({ key: z.string(), value: z.string().nullable() })
export const kvSet: Handler<'kv.set'> = async (input) => {
  const { key, value } = parseInput(setSchema, input)
  if (SECURE_KEYS.has(key)) {
    if (value === null) await SecureStore.deleteItemAsync(key)
    else await SecureStore.setItemAsync(key, value)
    return {}
  }
  const map = await readMap()
  if (value === null) delete map[key]
  else map[key] = value
  writeMap(map)
  return {}
}
