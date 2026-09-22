import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { LabApp } from './App'
import { renderOps } from './render'
import { readText, writeBlob } from './api'
import { hashString } from '~/engine/rng'
import type { DrawLine } from './types'

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

declare global {
  interface Window {
    __lab?: LabHook
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

const root = document.getElementById('lab')
if (!root) throw new Error('#lab missing')
createRoot(root).render(
  <StrictMode>
    <LabApp />
  </StrictMode>
)
