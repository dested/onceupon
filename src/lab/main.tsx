import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LabApp } from './App'
import { renderOps } from './render'
import { readText, writeBlob } from './api'
import { hashString } from '~/engine/rng'
import type { DrawLine } from './types'
import { renderBench } from '~/proto/render'
import { benchFileSchema } from '~/proto/bench-types'

document.title = 'Once Upon lab'

/**
 * Agent mode: an agent writes ops to lab/agent/<rid>/<caseId>-<sample>.ops.txt, this renders them the
 * same way draw.ts does (detached 1280x800 canvas, seed hashString(phrase)) and writes the jpg to the
 * run dir, returning the executed lines. scripts/lab-agent.ts record-draw then files the CaseResult.
 */
interface LabHook {
  renderFromFile: (
    rid: string,
    caseId: string,
    sample: number,
    phrase: string
  ) => Promise<{ lines: DrawLine[]; imagePath: string }>
}

/** Prototype bench: render lab/proto/<run>/<dialect>/<story>.json, one jpg per beat beside it. */
interface ProtoHook {
  render: (run: string, dialect: string, storyId: string, style?: string) => Promise<{ images: string[]; parseErrors: string[]; warnings: string[] }>
}

declare global {
  interface Window {
    __lab?: LabHook
    __proto?: ProtoHook
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas.toBlob returned null'))),
      type,
      quality
    )
  })
}

const labHook: LabHook = {
  renderFromFile: async (rid, caseId, sample, phrase) => {
    const ops = await readText(`lab/agent/${rid}/${caseId}-${sample}.ops.txt`)
    if (ops === null) throw new Error(`missing ops file lab/agent/${rid}/${caseId}-${sample}.ops.txt`)
    const canvas = document.createElement('canvas')
    const lines = renderOps(canvas, ops.split('\n'), hashString(phrase), { w: 1280, h: 800 })
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88)
    const imagePath = `lab/runs/${rid}/${caseId}-${sample}.jpg`
    await writeBlob(imagePath, blob)
    return { lines, imagePath }
  },
}

window.__lab = labHook

window.__proto = {
  render: async (run, dialect, storyId, style) => {
    const dir = `lab/proto/${run}/${dialect}`
    const text = await readText(`${dir}/${storyId}.json`)
    if (text === null) throw new Error(`missing ${dir}/${storyId}.json`)
    const file = benchFileSchema.parse(JSON.parse(text))
    const beats = await renderBench(file, style ? { style } : {})
    const suffix = style && style !== 'classic' ? `.${style}` : ''
    const images: string[] = []
    for (const [i, b] of beats.entries()) {
      const p = `${dir}/${storyId}-b${i + 1}${suffix}.jpg`
      await writeBlob(p, b.image)
      images.push(p)
    }
    return {
      images,
      parseErrors: beats.flatMap((b) => b.parseErrors),
      warnings: beats.flatMap((b) => b.warnings),
    }
  },
}

const root = document.getElementById('lab')
if (!root) throw new Error('#lab missing')
createRoot(root).render(
  <StrictMode>
    <LabApp />
  </StrictMode>
)
