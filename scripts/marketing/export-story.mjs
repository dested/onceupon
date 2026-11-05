/**
 * The app's own mp4 export (src/export/mp4.ts, the storybook-frame render: 1280x800, the child's voice in
 * story time, crayon audio, captions, end card) for a story on the capture browser's shelf. Imports the
 * exporter through the hosted studio's Vite server, so it is the app's code, unchanged.
 *   node scripts/marketing/export-story.mjs list
 *   node scripts/marketing/export-story.mjs <storyId|title words> <out.mp4>
 */
import { writeFileSync } from 'node:fs'
import { page } from './cdp.mjs'

const [what, out] = process.argv.slice(2)
const cdp = await page()
const stories = await cdp.eval(
  `import('/src/story/storage.ts').then((m) => m.listStories().map((s) => ({ id: s.id, title: s.title })))`
)
if (what === 'list' || !out) {
  for (const s of stories) console.log(`${s.id}  ${s.title}`)
  process.exit(0)
}
const hit = stories.find((s) => s.id === what) ?? stories.find((s) => s.title.toLowerCase().includes(what.toLowerCase()))
if (!hit) throw new Error(`no story matches ${what}; try: list`)
const t0 = Date.now()
const info = await cdp.eval(
  `(async () => {
    const [{ getStory }, { exportStoryVideo }] = await Promise.all([import('/src/story/storage.ts'), import('/src/export/mp4.ts')])
    const res = await exportStoryVideo(getStory(${JSON.stringify(hit.id)}), { moderation: true })
    window.__heroMp4 = res.blob
    return { bytes: res.blob.size, seconds: res.seconds, frames: res.frames, audio: res.audioCodec, encoder: res.audioEncoder, notes: res.notes }
  })()`
)
console.log(hit.title, JSON.stringify(info), `${((Date.now() - t0) / 1000).toFixed(1)} s`)
const parts = []
const CHUNK = 4 << 20
for (let at = 0; at < info.bytes; at += CHUNK) {
  const b64 = await cdp.eval(
    `window.__heroMp4.slice(${at}, ${at + CHUNK}).arrayBuffer().then((b) => { let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s) })`
  )
  parts.push(Buffer.from(b64, 'base64'))
}
writeFileSync(out, Buffer.concat(parts))
console.log('wrote', out)
process.exit(0)
