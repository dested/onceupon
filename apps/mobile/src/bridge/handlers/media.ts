import { Directory, File, Paths } from 'expo-file-system'
import { Asset, getPermissionsAsync, requestPermissionsAsync } from 'expo-media-library'
import { z } from 'zod'
import { BridgeHostError, parseInput, type Handler } from '../host'

// Camera-roll saves. Add-only access (NSPhotoLibraryAddUsageDescription, `writeOnly`): the app never
// asks to read the parent's library. The studio sends the mp4 as base64; we stage it in the cache
// (Photos needs a file URL with a video extension) and delete it once Photos has copied it.

const schema = z.object({ base64: z.string().min(1), filename: z.string().min(1) })

function stagedName(filename: string): string {
  const base = filename.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '')
  if (base.length === 0) throw new BridgeHostError('bad_request', `illegal filename: ${filename}`)
  return base.toLowerCase().endsWith('.mp4') ? base : `${base}.mp4`
}

async function canAdd(): Promise<boolean> {
  const current = await getPermissionsAsync(true, ['video'])
  if (current.granted) return true
  if (!current.canAskAgain) return false
  const asked = await requestPermissionsAsync(true, ['video'])
  return asked.granted
}

export const saveVideo: Handler<'media.saveVideo'> = async (input) => {
  const { base64, filename } = parseInput(schema, input)
  if (!(await canAdd())) return { saved: false }
  const dir = new Directory(Paths.cache, 'export')
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true })
  const file = new File(dir, stagedName(filename))
  try {
    file.create({ intermediates: true, overwrite: true })
    file.write(base64, { encoding: 'base64' })
    // The SDK 57 entry point's saveToLibraryAsync is a legacy stub that throws; Asset.create is the
    // new API and only needs the add-only permission.
    await Asset.create(file.uri)
  } finally {
    try {
      if (file.exists) file.delete()
    } catch {
      // A leftover cache file is harmless; the OS purges the cache directory.
    }
  }
  return { saved: true }
}
