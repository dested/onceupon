/**
 * Client wrappers over the dev-only `/__lab/*` file API (scripts/lab-plugin.ts). These only work
 * under `bun run dev`; there is no lab in a production build. Every JSON body is zod-validated and a
 * non-2xx response throws `Error(`lab api ${status}: ${message}`)`.
 */
import { z } from 'zod'

const errorSchema = z.object({ error: z.string() })
const okSchema = z.object({ ok: z.literal(true) })
const writeSchema = z.object({ ok: z.literal(true), bytes: z.number() })
const b64Schema = z.object({ b64: z.string() })
const promoteSchema = z.object({ ok: z.literal(true), chars: z.number() })
const entrySchema = z.object({
  name: z.string(),
  dir: z.boolean(),
  size: z.number(),
  mtime: z.number(),
})
const listSchema = z.object({ entries: z.array(entrySchema) })

export type LabEntry = z.infer<typeof entrySchema>

async function fail(res: Response): Promise<never> {
  let message = res.statusText
  try {
    message = errorSchema.parse(await res.json()).error
  } catch {
    // response had no JSON error body; fall back to the status text
  }
  throw new Error(`lab api ${res.status}: ${message}`)
}

function fileUrl(path: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams({ path, ...(extra ?? {}) })
  return `/__lab/file?${params.toString()}`
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'))
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('FileReader did not return a data URL'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.readAsDataURL(blob)
  })
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export async function readText(path: string): Promise<string | null> {
  const res = await fetch(fileUrl(path))
  if (res.status === 404) return null
  if (!res.ok) return fail(res)
  return res.text()
}

export async function readBytes(path: string): Promise<Uint8Array | null> {
  const res = await fetch(fileUrl(path, { b64: '1' }))
  if (res.status === 404) return null
  if (!res.ok) return fail(res)
  const { b64 } = b64Schema.parse(await res.json())
  return base64ToBytes(b64)
}

export async function writeText(path: string, text: string): Promise<void> {
  const res = await fetch(fileUrl(path), { method: 'PUT', body: text })
  if (!res.ok) return fail(res)
  writeSchema.parse(await res.json())
}

export async function writeBlob(path: string, blob: Blob): Promise<void> {
  const b64 = await blobToBase64(blob)
  const res = await fetch(fileUrl(path, { b64: '1' }), { method: 'PUT', body: b64 })
  if (!res.ok) return fail(res)
  writeSchema.parse(await res.json())
}

export async function appendLine(path: string, line: string): Promise<void> {
  const res = await fetch(`/__lab/append?${new URLSearchParams({ path }).toString()}`, {
    method: 'POST',
    body: line,
  })
  if (!res.ok) return fail(res)
  okSchema.parse(await res.json())
}

export async function list(path: string): Promise<LabEntry[]> {
  const res = await fetch(`/__lab/list?${new URLSearchParams({ path }).toString()}`)
  if (!res.ok) return fail(res)
  return listSchema.parse(await res.json()).entries
}

export async function remove(path: string): Promise<void> {
  const res = await fetch(fileUrl(path), { method: 'DELETE' })
  if (!res.ok) return fail(res)
  okSchema.parse(await res.json())
}

export async function promote(version: number): Promise<void> {
  const res = await fetch('/__lab/promote', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ version }),
  })
  if (!res.ok) return fail(res)
  promoteSchema.parse(await res.json())
}

/** A URL that serves the file's bytes with its content type, for `<img src>`. */
export function imageUrl(path: string): string {
  return fileUrl(path, { raw: '1' })
}
