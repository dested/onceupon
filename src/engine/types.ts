// World is 160 wide x 100 tall. Ground line at y = 80.
export const WORLD_W = 160
export const WORLD_H = 100
export const GROUND_Y = 80

export interface Vec {
  x: number
  y: number
}

export type Shape =
  | { k: 'circle'; cx: number; cy: number; r: number; color: string; fill: boolean }
  | { k: 'ellipse'; cx: number; cy: number; rx: number; ry: number; color: string; fill: boolean }
  | { k: 'rect'; x: number; y: number; w: number; h: number; color: string; fill: boolean }
  | { k: 'line'; x1: number; y1: number; x2: number; y2: number; color: string }
  | { k: 'poly'; pts: Vec[]; color: string; fill: boolean; closed: boolean }
  | { k: 'path'; d: string; color: string; fill: boolean }
  | { k: 'text'; x: number; y: number; size: number; color: string; text: string }

export const ANIM_KINDS = ['none', 'bob', 'bounce', 'shake', 'spin', 'wobble', 'fly', 'walk'] as const
export type AnimKind = (typeof ANIM_KINDS)[number]

export const FX_KINDS = ['explode', 'sparkle', 'hearts', 'rain', 'fire', 'smoke', 'stars', 'poof'] as const
export type FxKind = (typeof FX_KINDS)[number]

export type MoveTarget =
  | { kind: 'abs'; x: number; y: number }
  | { kind: 'ref'; ref: string; dx: number; dy: number }

export type Command =
  | { k: 'obj'; id: string; x: number; y: number }
  | { k: 'shape'; shape: Shape }
  | { k: 'stamp'; name: string; x: number; y: number; size: number; color: string | undefined }
  | { k: 'end' }
  | { k: 'mv'; id: string; to: MoveTarget; secs: number }
  | { k: 'sc'; id: string; factor: number; secs: number }
  | { k: 'flip'; id: string }
  | { k: 'rm'; id: string }
  | { k: 'anim'; id: string; kind: AnimKind }
  | { k: 'fx'; kind: FxKind; x: number; y: number; size: number }
  | { k: 'say'; id: string; text: string }
  | { k: 'bg'; sky: string; ground: string | undefined }
  | { k: 'page'; title: string }
  /** The model judged the new words not fit for the book: draw nothing, forget them. */
  | { k: 'skip' }

export type ParseResult =
  | { ok: true; cmd: Command | null }
  | { ok: false; error: string }
