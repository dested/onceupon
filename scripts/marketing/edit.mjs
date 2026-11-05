/**
 * Cuts a marketing video from captured takes with ffmpeg, from an edit list (EDL) JSON:
 *   node scripts/marketing/edit.mjs <edl.json>
 *
 * EDL: {
 *   out: "store/marketing/preview-iphone-6.9.mp4",   // repo-relative
 *   work: "/w/junk/onceupon-f/assets/edit-iphone",   // scratch for overlays and the contact sheet
 *   size: [886, 1920], xfade: 0.3,
 *   statusbar: "store/screenshots/iphone-6.9/01-story-drawing.png",  // optional: 9:41 bar keyed off this shot
 *   statusbarCrop: 186,                               // px of that shot's top the bar occupies
 *   segments: [{ take: "<take dir>", from: 1.0, to: 20.2, audio: [{ src: "voice" | "ctx" | "media", gainDb: 0 }] }],
 *   overlays: [{ text: "The crayon draws it", at: 7.6, to: 13.6, y: 520, tilt: 2, size: 30 }]   // times on the output
 * }
 * A take is a capture-live.mjs / capture-shelf.mjs folder with raw.mp4 (scripts/marketing/raw.sh),
 * frames.json and events.json. Segment times are seconds from the take's first frame. Audio sources are placed
 * by wall clock: voice.wav starts at events.speakT0, tap files at taps.json start.
 * Output: H.264 High@4.0 30 fps 10-12 Mbps, AAC 256 kbps 48 kHz stereo, -16 LUFS; plus <out>-sheet.png (3x3).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const edlPath = process.argv[2]
if (!edlPath) {
  console.error('usage: edit.mjs <edl.json>')
  process.exit(2)
}
const edl = JSON.parse(readFileSync(edlPath, 'utf8'))
const [W, H] = edl.size
const X = edl.xfade ?? 0.3
const work = edl.work
mkdirSync(work, { recursive: true })
const out = join(ROOT, edl.out)
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })

// Decode tap webms once (their headers carry no duration; wav is easier to seek).
function wavOf(take, file) {
  const wav = join(take, file.replace(/\.webm$/, '.wav'))
  if (!existsSync(wav)) ff(['-i', join(take, file), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', wav])
  return wav
}

const inputs = []
const addInput = (args) => {
  inputs.push(...args)
  return inputs.filter((a) => a === '-i').length - 1
}

const filters = []
const segOffsets = []
let t = 0
edl.segments.forEach((seg, i) => {
  segOffsets.push(t)
  t += seg.to - seg.from - (i < edl.segments.length - 1 ? X : 0)
})
const total = t

// --- video ---
edl.segments.forEach((seg, i) => {
  const vi = addInput(['-i', join(seg.take, 'raw.mp4')])
  filters.push(`[${vi}:v]trim=${seg.from}:${seg.to},setpts=PTS-STARTPTS,fps=30,scale=${W}:${H},format=yuv420p[v${i}]`)
})
let vlast = 'v0'
for (let i = 1; i < edl.segments.length; i++) {
  const off = (segOffsets[i]).toFixed(3)
  filters.push(`[${vlast}][v${i}]xfade=transition=fade:duration=${X}:offset=${off}[x${i}]`)
  vlast = `x${i}`
}

if (edl.statusbar) {
  const bar = join(work, 'statusbar.png')
  const crop = edl.statusbarCrop ?? 186
  ff([
    '-i', join(ROOT, edl.statusbar),
    '-vf', `crop=iw:${crop}:0:0,scale=${W}:-1:flags=lanczos,drawbox=x=0:y=0:w=8:h=8:color=0xebe2d2:t=fill,format=rgba,colorkey=0xebe2d2:0.10:0.08`,
    bar,
  ])
  const bi = addInput(['-loop', '1', '-t', String(total), '-i', bar])
  filters.push(`[${vlast}][${bi}:v]overlay=0:0:shortest=0[sb]`)
  vlast = 'sb'
}

;(edl.overlays ?? []).forEach((o, k) => {
  const png = join(work, `overlay-${k}.png`)
  execFileSync('node', [join(ROOT, 'scripts', 'marketing', 'overlay.mjs'), png, o.text, String(o.size ?? 30), String(o.tilt ?? -2)], { stdio: 'inherit' })
  const oi = addInput(['-loop', '1', '-t', String(total), '-i', png])
  const fadeOut = (o.to - 0.25).toFixed(3)
  filters.push(`[${oi}:v]format=rgba,fade=t=in:st=${o.at}:d=0.25:alpha=1,fade=t=out:st=${fadeOut}:d=0.25:alpha=1[o${k}]`)
  filters.push(`[${vlast}][o${k}]overlay=x=(W-w)/2:y=${o.y}-h/2:enable='between(t,${o.at},${o.to})'[ov${k}]`)
  vlast = `ov${k}`
})

// --- audio ---
const pieces = []
edl.segments.forEach((seg, i) => {
  const take = seg.take
  const frame0 = json(join(take, 'frames.json'))[0]
  const events = json(join(take, 'events.json'))
  const taps = existsSync(join(take, 'taps.json')) ? json(join(take, 'taps.json')) : []
  for (const a of seg.audio ?? []) {
    let file
    let startEpoch
    if (a.src === 'voice') {
      file = join(take, 'voice.wav')
      startEpoch = events.speakT0 / 1000
    } else {
      const tap = taps.find((x) => x.kind === a.src)
      if (!tap) throw new Error(`${take}: no ${a.src} tap`)
      file = wavOf(take, tap.file)
      startEpoch = tap.start / 1000
    }
    const a0 = frame0 + seg.from - startEpoch
    const a1 = frame0 + seg.to - startEpoch
    if (a1 <= 0) continue
    const lead = Math.max(0, -a0)
    const ai = addInput(['-i', file])
    const label = `a${pieces.length}`
    const len = seg.to - seg.from
    const fadeIn = i > 0 ? `,afade=t=in:st=0:d=${X}` : ''
    const fadeOut = i < edl.segments.length - 1 ? `,afade=t=out:st=${(len - X).toFixed(3)}:d=${X}` : ''
    filters.push(
      `[${ai}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${Math.max(0, a0).toFixed(3)}:end=${a1.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(lead * 1000)}:all=1,apad=whole_dur=${len.toFixed(3)},atrim=0:${len.toFixed(3)}${fadeIn}${fadeOut},volume=${a.gainDb ?? 0}dB,adelay=${Math.round(segOffsets[i] * 1000)}:all=1[${label}]`
    )
    pieces.push(label)
  }
})
const silence = addInput(['-f', 'lavfi', '-t', String(total), '-i', 'anullsrc=r=48000:cl=stereo'])
filters.push(
  `[${silence}:a]${pieces.map((p) => `[${p}]`).join('')}amix=inputs=${pieces.length + 1}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,atrim=0:${total.toFixed(3)}[aout]`
)

mkdirSync(dirname(out), { recursive: true })
ff([
  ...inputs,
  '-filter_complex', filters.join(';'),
  '-map', `[${vlast}]`, '-map', '[aout]',
  '-t', total.toFixed(3),
  '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p', '-r', '30',
  // Apple's preview spec targets 10-12 Mbps; easy paper footage undershoots VBR, so hold the rate (CBR HRD).
  '-b:v', '11M', '-minrate', '11M', '-maxrate', '11M', '-bufsize', '11M', '-x264-params', 'nal-hrd=cbr',
  '-preset', 'slow', '-g', '30',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart',
  out,
])

// 3x3 contact sheet, evenly spaced.
const sheet = out.replace(/\.mp4$/, '-sheet.png')
const step = total / 9
ff(['-i', out, '-vf', `fps=1/${step.toFixed(4)},scale=${Math.round(W / 3)}:-1,tile=3x3`, '-frames:v', '1', sheet])
console.log(`${out} ${total.toFixed(2)} s\n${sheet}`)
