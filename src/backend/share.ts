import { blobToBase64, bridgeCall } from './bridge'
import { NATIVE } from './config'
import { api } from './api'
import { renderVoiceFile } from '~/story/voice'
import type { StoryRecord } from '~/story/storage'
import type { ShareSummary } from '../../packages/shared/src/api'

/**
 * Sharing a finished story as a public page. Voice is only sent when the parent asked to include it
 * and the record has clips (the server also gates on paying + consent). The cover is sent separately
 * as its data URL (the server accepts the studio's JPEG thumbnails); the record goes up without it.
 */
export async function createShare(
  record: StoryRecord,
  opts: { childName: string | null; includeVoice: boolean }
): Promise<{ id: string; url: string; expiresAt: string }> {
  let voice: { mime: string; base64: string } | null = null
  if (opts.includeVoice && record.voice) {
    const rendered = await renderVoiceFile(record)
    if (rendered) voice = { mime: rendered.mime, base64: await blobToBase64(rendered.blob) }
  }
  const coverPng = record.cover
  const sent: StoryRecord = { ...record, cover: null }
  return api('share.create', { record: sent, childName: opts.childName, voice, coverPng })
}

export async function unpublishShare(id: string): Promise<void> {
  await api('share.unpublish', { id })
}

export async function listShares(): Promise<ShareSummary[]> {
  const { shares } = await api('share.list', {})
  return shares
}

/** Share a link natively / via the Web Share API, falling back to the clipboard. */
export async function shareLink(url: string, title: string): Promise<'shared' | 'copied'> {
  if (NATIVE) {
    await bridgeCall('share.url', { url, title })
    return 'shared'
  }
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ url, title })
      return 'shared'
    } catch {
      // cancelled or unsupported payload: fall back to the clipboard
    }
  }
  await navigator.clipboard.writeText(url)
  return 'copied'
}

/**
 * Keep the exported video: the camera roll on the native shell (add-only Photos access; 'denied'
 * when the grown-up has said no to Photos), the browser's downloads on the web.
 */
export async function saveVideo(blob: Blob, filename: string): Promise<'saved' | 'denied' | 'downloaded'> {
  if (NATIVE) {
    const base64 = await blobToBase64(blob)
    const { saved } = await bridgeCall('media.saveVideo', { base64, filename })
    return saved ? 'saved' : 'denied'
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

/** Share the exported video natively, or hand it to the browser's downloads on the web. */
export async function shareVideo(blob: Blob, filename: string): Promise<'shared' | 'downloaded'> {
  if (NATIVE) {
    const base64 = await blobToBase64(blob)
    await bridgeCall('share.file', { base64, mime: blob.type || 'video/mp4', filename })
    return 'shared'
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.append(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
