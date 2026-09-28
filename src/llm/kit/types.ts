import type { KitShape, Pt, Rng } from './geom'

export const MOODS = ['happy', 'surprised', 'sad', 'angry', 'sleepy'] as const
export type Mood = (typeof MOODS)[number]

export const POSES = ['stand', 'sit', 'sleep', 'fly', 'swim'] as const
export type Pose = (typeof POSES)[number]

export interface KitParams {
  kind: string
  /** Colors the model gave, in slot order (hex). Missing slots use the kit's defaults. */
  colors: string[]
  mood: Mood
  pose: Pose
  /** Accessory names (hat, crown, glasses...). */
  wear: string[]
  rng: Rng
  /** eyes=N from the model (default 2). */
  eyes?: number
}

export interface HeadAnchor {
  /** The head shape's id (face goes on it). */
  id: string
  cx: number
  cy: number
  r: number
  facing: 'front' | 'right'
  /** No visible head shape: the face is drawn from this box alone. */
  hidden?: boolean
}

export interface KitDrawing {
  shapes: KitShape[]
  head?: HeadAnchor
  /** Parts drawn on a layer ABOVE characters (a boat's front, a blanket): a container's front. */
  front?: KitShape[]
  /** Where an occupant's feet go, local to the container anchor. */
  seat?: Pt
  /** Where a held prop goes (the hand), local. */
  hand?: Pt
  /** Local y of the top surface things stand on (table top). Default: -height. */
  surface?: number
  /** Mouth (fire, eating), local. */
  mouth?: Pt
  /** Neck (scarf), local. */
  neck?: Pt & { w: number }
  /** Skip the face even if there is a head (the builder drew its own). */
  noFace?: boolean
}

export type Idle = 'breathe' | 'float' | 'sway' | 'none'

export interface KitDef {
  kind: string
  aliases?: string[]
  /** One-line catalog entry for the prompt: what the color slots mean, extras. */
  doc: string
  /** Default height in paper units at size 1. */
  height: number
  idle: Idle
  /** Scenery sits behind characters. */
  layer?: number
  /** Lives in the air: default y=330. */
  air?: boolean
  /** A character: gets a face, moods and accessories. */
  character?: boolean
  build(p: KitParams): KitDrawing
}
