import { randomBytes } from 'node:crypto'
import type { Device } from '@prisma/client'
import { z } from 'zod'
import { prisma } from './prisma'
import { env } from './env'
import { getFlags } from './flags'
import { maskText } from './mask'
import { ApiError } from './app-api-types'
import type { AppApi, PublicShare, SharedRecord, ShareSummary } from '../../../packages/shared/src/api'

const MAX_RECORD_CHARS = 500_000
const MAX_CHILD_NAME = 24
const MAX_COVER_BYTES = 300 * 1024
const MAX_VOICE_BYTES = 12 * 1024 * 1024
// The studio's thumbnails are JPEG (stage.thumbnail()); PNG is accepted too. Served back by sniffing the bytes.
const COVER_PREFIXES = ['data:image/png;base64,', 'data:image/jpeg;base64,']
const VOICE_MIMES = ['audio/mp4', 'audio/webm', 'audio/mpeg', 'audio/aac']

const voiceClipSchema = z.object({ t: z.number(), ms: z.number(), file: z.string() })
const eventSchema = z.discriminatedUnion('k', [
  z.object({ k: z.literal('words'), t: z.number(), text: z.string() }),
  z.object({ k: z.literal('cmd'), t: z.number(), line: z.string() }),
  z.object({ k: z.literal('end'), t: z.number() }),
])

/** Validates a StoryRecord crossing the wire (share.create) and coming back out of the JSON column. */
export const sharedRecordSchema: z.ZodType<SharedRecord> = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  seed: z.number(),
  cover: z.string().nullable(),
  dialect: z.string().optional(),
  events: z.array(eventSchema),
  voice: z.object({ mime: z.string(), clips: z.array(voiceClipSchema) }).optional(),
})

const SHARE_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

function newShareId(): string {
  const bytes = randomBytes(12)
  let id = ''
  for (const b of bytes) id += SHARE_ID_ALPHABET[b % SHARE_ID_ALPHABET.length]
  return id
}

// Prisma's Bytes columns take a Uint8Array backed by a plain ArrayBuffer, not a Node Buffer.
function toBytes(buffer: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buffer.length)
  out.set(buffer)
  return out
}

function decodeCover(coverPng: string): Uint8Array<ArrayBuffer> {
  const prefix = COVER_PREFIXES.find((p) => coverPng.startsWith(p))
  if (!prefix) {
    throw new ApiError(400, 'bad_request', 'Cover must be a data:image/png or image/jpeg base64 URL')
  }
  const bytes = Buffer.from(coverPng.slice(prefix.length), 'base64')
  if (bytes.length === 0) throw new ApiError(400, 'bad_request', 'Cover image is empty')
  if (bytes.length > MAX_COVER_BYTES) throw new ApiError(400, 'bad_request', 'Cover image is too large')
  return toBytes(bytes)
}

function decodeVoice(voice: { mime: string; base64: string }): Uint8Array<ArrayBuffer> {
  if (!VOICE_MIMES.includes(voice.mime)) {
    throw new ApiError(400, 'bad_request', `Unsupported voice type ${voice.mime}`)
  }
  const bytes = Buffer.from(voice.base64, 'base64')
  if (bytes.length === 0) throw new ApiError(400, 'bad_request', 'Voice clip is empty')
  if (bytes.length > MAX_VOICE_BYTES) throw new ApiError(400, 'bad_request', 'Voice clip is too large')
  return toBytes(bytes)
}

function isLive(share: { unpublishedAt: Date | null; expiresAt: Date }): boolean {
  return share.unpublishedAt === null && share.expiresAt.getTime() > Date.now()
}

/** Publish a masked, unlisted copy of a story. Voice needs consent (paying + shareVoice). */
export async function createShare(
  device: Device,
  input: AppApi['share.create']['input']
): Promise<AppApi['share.create']['output']> {
  const { record, childName, voice, coverPng } = input

  if (voice && !(device.paying && device.shareVoice)) {
    throw new ApiError(403, 'consent_required', 'Voice sharing needs a paying account with consent')
  }
  if (childName && childName.length > MAX_CHILD_NAME) {
    throw new ApiError(400, 'bad_request', 'Child name is too long')
  }
  if (JSON.stringify(record).length > MAX_RECORD_CHARS) {
    throw new ApiError(400, 'bad_request', 'Story record is too large')
  }

  const coverBytes = coverPng ? decodeCover(coverPng) : null
  const voiceBytes = voice ? decodeVoice(voice) : null

  // Mask every spoken word and the title; never store a raw name or the inline cover.
  const maskedTitle = await maskText(record.title)
  const maskedEvents = await Promise.all(
    record.events.map(async (e) => (e.k === 'words' ? { ...e, text: await maskText(e.text) } : e))
  )
  const maskedChildName = childName ? await maskText(childName) : null
  const maskedRecord: SharedRecord = {
    ...record,
    title: maskedTitle,
    events: maskedEvents,
    cover: null,
  }

  const flags = await getFlags()
  const expiresAt = new Date(Date.now() + flags.shareLifetimeDays * 24 * 60 * 60 * 1000)
  const id = newShareId()

  await prisma.share.create({
    data: {
      id,
      deviceId: device.id,
      storyId: record.id,
      title: maskedTitle,
      childName: maskedChildName,
      record: JSON.parse(JSON.stringify(maskedRecord)),
      cover: coverBytes,
      voice: voiceBytes,
      voiceMime: voice ? voice.mime : null,
      expiresAt,
    },
  })

  return { id, url: `${env.PUBLIC_ORIGIN}/s/${id}`, expiresAt: expiresAt.toISOString() }
}

function toPublicRecord(json: unknown): SharedRecord {
  return sharedRecordSchema.parse(json)
}

/** The player + share page payload. Null when the share is gone, unpublished, or expired. */
export async function getPublicShare(id: string): Promise<PublicShare | null> {
  const row = await prisma.share.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      childName: true,
      record: true,
      voiceMime: true,
      createdAt: true,
      expiresAt: true,
      unpublishedAt: true,
    },
  })
  if (!row || !isLive(row)) return null
  const hasCover = await coverExists(id)
  return {
    id: row.id,
    title: row.title,
    childName: row.childName,
    record: toPublicRecord(row.record),
    hasVoice: row.voiceMime !== null,
    voiceUrl: row.voiceMime ? `/api/share/${id}/voice` : null,
    voiceMime: row.voiceMime,
    coverUrl: hasCover ? `/api/share/${id}/cover.png` : null,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
  }
}

async function coverExists(id: string): Promise<boolean> {
  const row = await prisma.share.findFirst({ where: { id, cover: { not: null } }, select: { id: true } })
  return row !== null
}

export interface ShareMeta {
  title: string
  childName: string | null
  coverUrl: string | null
  expiresAt: string
  hasVoice: boolean
}

/** Lightweight fields for SSR of the /s/:id page (OG tags), without shipping the record. */
export async function shareMeta(id: string): Promise<ShareMeta | null> {
  const row = await prisma.share.findUnique({
    where: { id },
    select: { title: true, childName: true, voiceMime: true, expiresAt: true, unpublishedAt: true },
  })
  if (!row || !isLive(row)) return null
  const hasCover = await coverExists(id)
  return {
    title: row.title,
    childName: row.childName,
    coverUrl: hasCover ? `/api/share/${id}/cover.png` : null,
    expiresAt: row.expiresAt.toISOString(),
    hasVoice: row.voiceMime !== null,
  }
}

export async function getShareVoice(id: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const row = await prisma.share.findUnique({
    where: { id },
    select: { voice: true, voiceMime: true, unpublishedAt: true, expiresAt: true },
  })
  if (!row || !isLive(row) || !row.voice || !row.voiceMime) return null
  return { bytes: Buffer.from(row.voice), mime: row.voiceMime }
}

export async function getShareCover(id: string): Promise<Buffer | null> {
  const row = await prisma.share.findUnique({
    where: { id },
    select: { cover: true, unpublishedAt: true, expiresAt: true },
  })
  if (!row || !isLive(row) || !row.cover) return null
  return Buffer.from(row.cover)
}

export async function bumpViews(id: string): Promise<void> {
  await prisma.share.updateMany({ where: { id }, data: { views: { increment: 1 } } })
}

export async function bumpDownloads(id: string): Promise<void> {
  await prisma.share.updateMany({ where: { id }, data: { downloads: { increment: 1 } } })
}

export async function bumpInstalls(id: string): Promise<void> {
  await prisma.share.updateMany({ where: { id }, data: { installs: { increment: 1 } } })
}

/** Owner-only takedown; the link dies immediately (getPublicShare then returns null). */
export async function unpublishShare(device: Device, id: string): Promise<void> {
  const row = await prisma.share.findUnique({ where: { id }, select: { deviceId: true } })
  if (!row || row.deviceId !== device.id) {
    throw new ApiError(404, 'not_found', 'That share was not found')
  }
  await prisma.share.update({ where: { id }, data: { unpublishedAt: new Date() } })
}

export async function listShares(device: Device): Promise<ShareSummary[]> {
  const rows = await prisma.share.findMany({
    where: { deviceId: device.id, unpublishedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      storyId: true,
      voiceMime: true,
      views: true,
      createdAt: true,
      expiresAt: true,
    },
  })
  return rows.map((r) => ({
    id: r.id,
    storyId: r.storyId,
    url: `${env.PUBLIC_ORIGIN}/s/${r.id}`,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    hasVoice: r.voiceMime !== null,
    views: r.views,
  }))
}

/** Nightly cleanup: drop expired links and ones unpublished more than a day ago. Returns the count. */
export async function expireShares(): Promise<number> {
  const now = new Date()
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const res = await prisma.share.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: now } }, { unpublishedAt: { lt: dayAgo } }],
    },
  })
  return res.count
}
