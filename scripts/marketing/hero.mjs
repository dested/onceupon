/**
 * Cuts the 16:9 hero ad (and the 9:16 verticals, size [1080, 1920]) from an edit list: full-picture moments
 * (the app's mp4 export render), phones showing captured takes, a closing card with the name and Apple's
 * App Store badge.
 *   node scripts/marketing/hero.mjs <edl.json>
 *
 * EDL: {
 *   out: "store/marketing/hero-1080p.mp4", work: "<scratch dir>", size: [1920, 1080], bg: "#eee5d5",
 *   xfade: 0.2,                                   // between scenes
 *   statusbar: "store/screenshots/iphone-6.9/01-story-drawing.png", statusbarCrop: 186,
 *   scenes: [
 *     { full: { file: "<export.mp4>", from, to } },                       // the export, fit to the height
 *     { phones: [{ take, x: 960, zoom?: 1.7, top?: -650, bezel?: "#2a2321", padTop?: 124, padColor?: "#ebe3d2",
 *                  taps?: [{ at, x, y }],               // touches: take time, capture px
 *                  items: [{ from, to, audio: ["voice" | "ctx", …] } | { hold: t, dur }] }] },
 *     { end: { dur, icon, badge, scale?: 1.2 } },
 *   ]
 *   and on any scene: overlay: { text, x, y, at, to, size, tilt }       // seconds within the scene
 * }
 * A take is a capture-*.mjs folder (raw.mp4 from raw.sh, frames.json, events.json, taps.json, voice.wav);
 * item times are seconds from its first frame, and audio is placed by wall clock (voice.wav at
 * events.speakT0, a tap at its runAt). Each scene is rendered to <work>/scene-N.mp4/.wav, then joined.
 * Output: H.264 High@4.0 30 fps CRF 17 (≤ 12 Mbps), AAC 256 kbps 48 kHz stereo at -16 LUFS, + <out>-sheet.png.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataUrl, renderHtml } from './render-html.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const edlPath = process.argv[2]
if (!edlPath) {
  console.error('usage: hero.mjs <edl.json>')
  process.exit(2)
}
const edl = JSON.parse(readFileSync(edlPath, 'utf8'))
const [W, H] = edl.size ?? [1920, 1080]
const BG = edl.bg ?? '#eee5d5'
const X = edl.xfade ?? 0.2
const work = edl.work
mkdirSync(work, { recursive: true })
const out = join(ROOT, edl.out)
const json = (p) => JSON.parse(readFileSync(p, 'utf8'))
const ff = (args) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...args], { stdio: ['ignore', 'inherit', 'inherit'] })
const repo = (p) => (p.startsWith('/') ? p : join(ROOT, p))
const hex = (c) => `0x${c.replace('#', '')}`

// --- the phone: a screen 456x988 inside a 16 px warm-black bezel ---------------------------------------
const SCREEN = { w: 456, h: 988 }
const BEZEL = 16
const PHONE = { w: SCREEN.w + 2 * BEZEL, h: SCREEN.h + 2 * BEZEL }
const PHONE_Y = Math.round((H - PHONE.h) / 2)
const frames = new Map()
/** The bezel (and its shadow) as a PNG with a see-through screen, at `z` times the normal phone size. */
async function framePng(color = '#2a2321', z = 1) {
  const key = `${color}@${z}`
  if (frames.has(key)) return frames.get(key)
  const png = join(work, `phone-frame-${color.replace('#', '')}-${z}.png`)
  const sw = Math.round(SCREEN.w * z)
  const sh = Math.round(SCREEN.h * z)
  const bz = Math.round(BEZEL * z)
  const pw = sw + 2 * bz
  await renderHtml(
    `<div style="position:absolute; left:${Math.round(40 * z)}px; top:${Math.round(40 * z)}px; width:${sw}px; height:${sh}px; border:${bz}px solid ${color};
       border-radius:${Math.round(66 * z)}px; box-shadow: 0 ${Math.round(24 * z)}px ${Math.round(50 * z)}px rgba(59,47,47,.28), 0 4px 10px rgba(59,47,47,.18);"></div>
     <div style="position:absolute; left:${Math.round(40 * z + pw / 2 - 58 * z)}px; top:${Math.round(40 * z + bz + 14 * z)}px; width:${Math.round(116 * z)}px; height:${Math.round(34 * z)}px; border-radius:${Math.round(17 * z)}px; background:#0d0b0a;"></div>`,
    { width: pw + Math.round(80 * z), height: sh + 2 * bz + Math.round(80 * z), out: png }
  )
  frames.set(key, png)
  return png
}
// A touch: a soft ink ring where the finger lands (capture px, 886-wide screen).
const tapPng = join(work, 'tap.png')
await renderHtml(
  `<div style="position:absolute; left:10px; top:10px; width:100px; height:100px; border-radius:50%; background:rgba(59,47,47,.16); border:6px solid rgba(59,47,47,.5);"></div>`,
  { width: 132, height: 132, out: tapPng }
)

let statusbar = null
if (edl.statusbar) {
  statusbar = join(work, 'statusbar.png')
  ff([
    '-i', repo(edl.statusbar),
    '-vf', `crop=iw:${edl.statusbarCrop ?? 186}:0:0,scale=886:-1:flags=lanczos,drawbox=x=0:y=0:w=8:h=8:color=0xebe2d2:t=fill,format=rgba,colorkey=0xebe2d2:0.10:0.08`,
    statusbar,
  ])
}

// Overlays: the studio's paper sticker (overlay.mjs) at 2x.
function overlayPng(o, name) {
  const png = join(work, `${name}.png`)
  execFileSync('node', [join(ROOT, 'scripts', 'marketing', 'overlay.mjs'), png, o.text, String(o.size ?? 30), String(o.tilt ?? -2)], { stdio: 'inherit' })
  return png
}

// Decode tap webms once (no duration in their headers; wav seeks exactly).
function wavOf(take, file) {
  const wav = join(take, file.replace(/\.webm$/, '.wav'))
  if (!existsSync(wav)) ff(['-i', join(take, file), '-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', wav])
  return wav
}

/** Audio filter chains for one take item: [{ input, chain }] each producing exactly `len` s, at `offset` in the scene. */
function itemAudio(take, item, offset, add) {
  const frame0 = json(join(take, 'frames.json'))[0]
  const events = json(join(take, 'events.json'))
  const taps = existsSync(join(take, 'taps.json')) ? json(join(take, 'taps.json')) : []
  const len = item.to - item.from
  const chains = []
  for (const src of item.audio ?? []) {
    const [kind, gainDb] = String(src).split('@')
    let file
    let startEpoch
    if (kind === 'voice') {
      file = join(take, 'voice.wav')
      startEpoch = events.speakT0 / 1000
    } else {
      const tap = taps.find((x) => x.kind === kind)
      if (!tap) throw new Error(`${take}: no ${kind} tap`)
      file = wavOf(take, tap.file)
      startEpoch = (tap.runAt ?? tap.start) / 1000
    }
    const a0 = frame0 + item.from - startEpoch
    const a1 = frame0 + item.to - startEpoch
    if (a1 <= 0) continue
    const lead = Math.max(0, -a0)
    const i = add(['-i', file])
    chains.push(
      `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${Math.max(0, a0).toFixed(3)}:end=${a1.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(lead * 1000)}:all=1,apad=whole_dur=${len.toFixed(3)},atrim=0:${len.toFixed(3)},afade=t=in:d=0.05,afade=t=out:st=${(len - 0.05).toFixed(3)}:d=0.05,volume=${Number(gainDb ?? 0)}dB,adelay=${Math.round(offset * 1000)}:all=1`
    )
  }
  return chains
}

const itemLen = (it) => (it.hold !== undefined ? it.dur : it.to - it.from)

// --- one scene → scene-N.mp4 (video only, near lossless) + scene-N.wav --------------------------------------
async function renderScene(scene, n) {
  const inputs = []
  const add = (args) => {
    inputs.push(...args)
    return inputs.filter((a) => a === '-i').length - 1
  }
  const f = []
  const audio = []
  let D
  let last

  if (scene.full) {
    const { file, from, to } = scene.full
    D = to - from
    const bg = add(['-f', 'lavfi', '-t', D.toFixed(3), '-i', `color=c=${hex(BG)}:s=${W}x${H}:r=30`])
    const vi = add(['-i', repo(file)])
    f.push(`[${vi}:v]trim=${from}:${to},setpts=PTS-STARTPTS,fps=30,scale=-2:${H}:flags=lanczos[full]`)
    f.push(`[${bg}:v][full]overlay=(W-w)/2:0[v]`)
    audio.push(`[${vi}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=${from}:${to},asetpts=PTS-STARTPTS`)
    last = 'v'
  } else if (scene.phones) {
    D = scene.dur ?? Math.max(...scene.phones.map((p) => p.items.reduce((s, it) => s + itemLen(it), 0)))
    const bg = add(['-f', 'lavfi', '-t', D.toFixed(3), '-i', `color=c=${hex(BG)}:s=${W}x${H}:r=30`])
    last = `${bg}:v`
    const sb = statusbar ? add(['-loop', '1', '-t', D.toFixed(3), '-i', statusbar]) : null
    for (const [k, p] of scene.phones.entries()) {
      const vi = add(['-i', join(p.take, 'raw.mp4')])
      const parts = []
      let t = 0
      p.items.forEach((it, j) => {
        const lbl = `p${k}i${j}`
        if (it.hold !== undefined) {
          f.push(`[${vi}:v]trim=start=${it.hold}:duration=0.04,setpts=PTS-STARTPTS,fps=30,tpad=stop_mode=clone:stop_duration=${it.dur},trim=duration=${it.dur},setpts=PTS-STARTPTS[${lbl}]`)
        } else {
          f.push(`[${vi}:v]trim=${it.from}:${it.to},setpts=PTS-STARTPTS,fps=30[${lbl}]`)
          audio.push(...itemAudio(p.take, it, t, add))
        }
        parts.push(`[${lbl}]`)
        t += itemLen(it)
      })
      // The track holds its last frame to the end of the scene.
      const pad = p.padTop ? `,pad=886:${1796 + p.padTop}:0:${p.padTop}:color=${hex(p.padColor ?? '#ebe3d2')},crop=886:1920:0:0` : ''
      f.push(`${parts.join('')}concat=n=${parts.length}:v=1:a=0,tpad=stop_mode=clone:stop_duration=${D},trim=duration=${D},setpts=PTS-STARTPTS${pad}[s${k}raw]`)
      let screen = `s${k}raw`
      // Touches, placed on the track's own clock.
      ;(p.taps ?? []).forEach((tp, m) => {
        let start = 0
        let at = null
        for (const it of p.items) {
          if (it.hold === undefined && tp.at >= it.from && tp.at < it.to) at = start + tp.at - it.from
          start += itemLen(it)
        }
        if (at === null) throw new Error(`tap at ${tp.at} is outside ${p.take}'s items`)
        const ti = add(['-loop', '1', '-t', D.toFixed(3), '-i', tapPng])
        const e = at + 0.5
        f.push(`[${ti}:v]format=rgba,fade=t=in:st=${at.toFixed(3)}:d=0.08:alpha=1,fade=t=out:st=${(e - 0.2).toFixed(3)}:d=0.2:alpha=1[t${k}_${m}]`)
        f.push(`[${screen}][t${k}_${m}]overlay=${tp.x - 66}:${tp.y - 66}:enable='between(t,${at.toFixed(3)},${e.toFixed(3)})'[s${k}t${m}]`)
        screen = `s${k}t${m}`
      })
      if (sb !== null) {
        f.push(`[${screen}][${sb}:v]overlay=0:0[s${k}sb]`)
        screen = `s${k}sb`
      }
      // `zoom` (default 1) is a close-up: the phone that many times larger, its screen's top edge at `top` (canvas px).
      const z = p.zoom ?? 1
      const sw = Math.round(SCREEN.w * z)
      const sh = Math.round(SCREEN.h * z)
      const bz = Math.round(BEZEL * z)
      f.push(`[${screen}]scale=${sw}:${sh}:flags=lanczos,format=yuv420p[s${k}]`)
      const sx = Math.round(p.x - sw / 2)
      const sy = p.top ?? PHONE_Y + BEZEL
      f.push(`[${last}][s${k}]overlay=${sx}:${sy}[b${k}]`)
      const fr = add(['-loop', '1', '-t', D.toFixed(3), '-i', await framePng(p.bezel, z)])
      f.push(`[b${k}][${fr}:v]overlay=${sx - bz - Math.round(40 * z)}:${sy - bz - Math.round(40 * z)}[c${k}]`)
      last = `c${k}`
    }
  } else if (scene.end) {
    D = scene.end.dur
    const png = join(work, `end-${n}.png`)
    const e = scene.end
    const k = e.scale ?? 1
    const px = (v) => Math.round(v * k)
    await renderHtml(
      `<div style="position:absolute; inset:0; background:${BG}; display:flex; flex-direction:column; align-items:center; justify-content:center;">
         <img src="${dataUrl(repo(e.icon))}" style="width:${px(240)}px; height:${px(240)}px; border-radius:${px(54)}px; box-shadow:0 14px 34px rgba(59,47,47,.25);">
         <div style="position:relative; margin-top:${px(34)}px; font-family:Scrawl; font-size:${px(150)}px; line-height:1.1; color:#7b5c91;">
           <span style="position:absolute; left:${px(-62)}px; top:${px(58)}px; color:#d9937e; font:${px(52)}px Hand;">✦</span>Squiggletale<span style="position:absolute; right:${px(-58)}px; top:${px(6)}px; color:#d9937e; font:${px(52)}px Hand;">✦</span>
         </div>
         <img src="${dataUrl(repo(e.badge))}" style="height:${px(112)}px; margin-top:${px(96)}px;">
       </div>`,
      { width: W, height: H, out: png }
    )
    add(['-loop', '1', '-t', D.toFixed(3), '-i', png])
    f.push(`[0:v]fps=30,format=yuv420p[v]`)
    last = 'v'
  }

  if (scene.overlay) {
    const o = scene.overlay
    const png = overlayPng(o, `overlay-${n}`)
    const oi = add(['-loop', '1', '-t', D.toFixed(3), '-i', png])
    f.push(`[${oi}:v]format=rgba,fade=t=in:st=${o.at}:d=0.25:alpha=1,fade=t=out:st=${(o.to - 0.25).toFixed(3)}:d=0.25:alpha=1[ov]`)
    f.push(`[${last}][ov]overlay=x=${o.x}-w/2:y=${o.y}-h/2:enable='between(t,${o.at},${o.to})'[vo]`)
    last = 'vo'
  }

  const sil = add(['-f', 'lavfi', '-t', D.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo'])
  audio.forEach((chain, i) => f.push(`${chain}[a${i}]`))
  f.push(`[${sil}:a]${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length + 1}:normalize=0:duration=first,atrim=0:${D.toFixed(3)}[aout]`)
  const mp4 = join(work, `scene-${n}.mp4`)
  const wav = join(work, `scene-${n}.wav`)
  ff([
    ...inputs, '-filter_complex', f.join(';'),
    '-map', `[${last}]`, '-t', D.toFixed(3), '-r', '30', '-c:v', 'libx264', '-crf', '8', '-preset', 'fast', '-pix_fmt', 'yuv420p', mp4,
    '-map', '[aout]', '-t', D.toFixed(3), '-c:a', 'pcm_s16le', wav,
  ])
  console.log(`scene ${n}: ${D.toFixed(2)} s`)
  return { D, mp4, wav }
}

const scenes = []
for (const [n, s] of edl.scenes.entries()) scenes.push(await renderScene(s, n))

// --- join: xfade between scenes, audio crossfaded at the same points -----------------------------------------
const inputs = []
const f = []
const offsets = []
let t = 0
scenes.forEach((s, i) => {
  offsets.push(t)
  t += s.D - (i < scenes.length - 1 ? X : 0)
  inputs.push('-i', s.mp4)
})
const total = t
scenes.forEach((s) => inputs.push('-i', s.wav))
let vlast = '0:v'
for (let i = 1; i < scenes.length; i++) {
  f.push(`[${vlast}][${i}:v]xfade=transition=fade:duration=${X}:offset=${offsets[i].toFixed(3)}[x${i}]`)
  vlast = `x${i}`
}
scenes.forEach((s, i) => {
  const ai = scenes.length + i
  const fin = i > 0 ? `,afade=t=in:d=${X}` : ''
  const fout = i < scenes.length - 1 ? `,afade=t=out:st=${(s.D - X).toFixed(3)}:d=${X}` : ''
  f.push(`[${ai}:a]aformat=channel_layouts=stereo${fin}${fout},adelay=${Math.round(offsets[i] * 1000)}:all=1[a${i}]`)
})
f.push(`${scenes.map((_, i) => `[a${i}]`).join('')}amix=inputs=${scenes.length}:normalize=0:duration=longest,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,atrim=0:${total.toFixed(3)}[aout]`)

mkdirSync(dirname(out), { recursive: true })
ff([
  ...inputs,
  '-filter_complex', f.join(';'),
  '-map', `[${vlast}]`, '-map', '[aout]',
  '-t', total.toFixed(3),
  '-c:v', 'libx264', '-profile:v', 'high', '-level:v', '4.0', '-pix_fmt', 'yuv420p', '-r', '30',
  // Not an App Store preview, so quality-based (paper and crayon compress well) with a 12 Mbps ceiling.
  '-crf', '17', '-maxrate', '12M', '-bufsize', '24M',
  '-preset', 'slow', '-g', '30',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2',
  '-movflags', '+faststart',
  out,
])
const sheet = out.replace(/\.mp4$/, '-sheet.png')
const step = total / 12
const tile = H > W ? 'scale=360:-1,tile=6x2' : 'scale=640:-1,tile=4x3'
ff(['-i', out, '-vf', `fps=1/${step.toFixed(4)},${tile}`, '-frames:v', '1', sheet])
console.log(`${out} ${total.toFixed(2)} s, scenes at ${offsets.map((o) => o.toFixed(2)).join(' ')}\n${sheet}`)
