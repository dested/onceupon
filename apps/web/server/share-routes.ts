import express from 'express'
import {
  bumpDownloads,
  bumpInstalls,
  bumpViews,
  getPublicShare,
  getShareCover,
  getShareVoice,
} from './shares'
import { log } from './logger'

/**
 * Public replay endpoints for the /s/:id page and player. No device token. Mounted at /api/share by
 * the server. Read routes are cacheable per resource; the JSON payload is not (view counts, expiry).
 */
export const shareRouter = express.Router()

function fail(res: express.Response, status: number, code: string): void {
  res.status(status).json({ error: { code } })
}

shareRouter.get('/:id', async (req, res) => {
  try {
    const share = await getPublicShare(req.params.id)
    res.setHeader('Cache-Control', 'no-store')
    if (!share) return fail(res, 404, 'not_found')
    await bumpViews(req.params.id)
    res.json(share)
  } catch (err) {
    log.error(`[share] get ${req.params.id}: ${err instanceof Error ? err.message : String(err)}`)
    fail(res, 500, 'internal')
  }
})

shareRouter.get('/:id/voice', async (req, res) => {
  try {
    const voice = await getShareVoice(req.params.id)
    if (!voice) return fail(res, 404, 'not_found')
    res.setHeader('Content-Type', voice.mime)
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(voice.bytes)
  } catch (err) {
    log.error(`[share] voice ${req.params.id}: ${err instanceof Error ? err.message : String(err)}`)
    fail(res, 500, 'internal')
  }
})

shareRouter.get('/:id/cover.png', async (req, res) => {
  try {
    const cover = await getShareCover(req.params.id)
    if (!cover) return fail(res, 404, 'not_found')
    // Stored bytes may be JPEG (the studio's thumbnails) or PNG; sniff instead of trusting the URL suffix.
    res.setHeader('Content-Type', cover[0] === 0xff && cover[1] === 0xd8 ? 'image/jpeg' : 'image/png')
    res.setHeader('Cache-Control', 'private, max-age=3600')
    res.send(cover)
  } catch (err) {
    log.error(`[share] cover ${req.params.id}: ${err instanceof Error ? err.message : String(err)}`)
    fail(res, 500, 'internal')
  }
})

shareRouter.post('/:id/download', async (req, res) => {
  try {
    await bumpDownloads(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    log.error(`[share] download ${req.params.id}: ${err instanceof Error ? err.message : String(err)}`)
    fail(res, 500, 'internal')
  }
})

shareRouter.post('/:id/install', async (req, res) => {
  try {
    await bumpInstalls(req.params.id)
    res.json({ ok: true })
  } catch (err) {
    log.error(`[share] install ${req.params.id}: ${err instanceof Error ? err.message : String(err)}`)
    fail(res, 500, 'internal')
  }
})
