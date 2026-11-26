import { Builder, KIND_BEAT, type MeshData, type RGB } from '../scene/mesh'
import { groundContact, groundHeight } from '../scene/world'

const BURST = 0.4
/** Matches ringMesh. Local Y is already a lift along the ring normal. */
const RING_OUTER = 1.05
const RING_Y = 0.08
/** Gap kept above neighbouring triangles, in metres. */
const RING_CLEAR = 0.05
const RING_SAMPLES = 32

export interface RoundHooks {
  beep?: (freq: number, seconds: number) => void
  canOccupy(x: number, z: number): boolean
  /** True once the level song has finished. Clear is left alone. */
  ended?: () => boolean
}

export interface RoundDraw {
  mesh: MeshData
  model: Float32Array
}

export type RoundPhase = 'idle' | 'step' | 'hunt' | 'clear' | 'fail'

export interface RoundView {
  phase: RoundPhase
  score: number
  dim: number
  scoreText: string
  phaseText: string
  /** Bearing toward the hunt guide ring. Null when there is nothing to face. */
  aimYaw: number | null
  items: RoundDraw[]
}

interface Pad {
  x: number
  z: number
  until: number
}

interface Burst {
  x: number
  z: number
  born: number
}

function ringMesh(color: RGB): MeshData {
  const b = new Builder()
  const seg = 28
  const inner = 0.62
  const outer = RING_OUTER
  const y = RING_Y
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    const at = (a: number, r: number): [number, number, number] => [Math.cos(a) * r, y, Math.sin(a) * r]
    b.face(
      at(a0, inner), at(a1, inner), at(a1, outer), at(a0, outer),
      [color, color, color, color],
      KIND_BEAT,
      0, -4, 0,
    )
  }
  return b.finish(false, true)
}

/** Lay the ring on the ground triangle. Its Y axis is that triangle's normal. */
function put(m: Float32Array, x: number, z: number, s: number): void {
  const g = groundContact(x, z)
  let tx = 1 - g.nx * g.nx
  let ty = -g.ny * g.nx
  let tz = -g.nz * g.nx
  let tlen = Math.hypot(tx, ty, tz)
  if (tlen < 1e-4) {
    tx = -g.nz
    ty = 0
    tz = g.nx
    tlen = Math.hypot(tx, ty, tz) || 1
  }
  tx /= tlen
  ty /= tlen
  tz /= tlen
  const bx = g.ny * tz - g.nz * ty
  const by = g.nz * tx - g.nx * tz
  const bz = g.nx * ty - g.ny * tx
  // The ring center is local (0, RING_Y, 0). Keep that point on (x, z)
  // and only lift straight up, so a slope does not slide the landing mark.
  let lift = 0
  for (let pass = 0; pass < 4; pass++) {
    const transX = x - g.nx * s * RING_Y
    const transY = g.y + lift
    const transZ = z - g.nz * s * RING_Y
    let deficit = 0
    for (let i = 0; i < RING_SAMPLES; i++) {
      const a = (i / RING_SAMPLES) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const xw = transX + (tx * c * RING_OUTER + g.nx * RING_Y + bx * sn * RING_OUTER) * s
      const yw = transY + (ty * c * RING_OUTER + g.ny * RING_Y + by * sn * RING_OUTER) * s
      const zw = transZ + (tz * c * RING_OUTER + g.nz * RING_Y + bz * sn * RING_OUTER) * s
      const gap = groundHeight(xw, zw) + RING_CLEAR - yw
      if (gap > deficit) deficit = gap
    }
    if (deficit <= 0) break
    lift += deficit
  }
  m[0] = tx * s
  m[1] = ty * s
  m[2] = tz * s
  m[3] = 0
  m[4] = g.nx * s
  m[5] = g.ny * s
  m[6] = g.nz * s
  m[7] = 0
  m[8] = bx * s
  m[9] = by * s
  m[10] = bz * s
  m[11] = 0
  m[12] = x - g.nx * s * RING_Y
  m[13] = g.y + lift
  m[14] = z - g.nz * s * RING_Y
  m[15] = 1
}

export class Round {
  phase: RoundPhase = 'idle'
  score = 0
  /** Kept at 0. Hunt no longer darkens the meadow. */
  dim = 0
  private t = 0
  private nextAt = 0
  private pad: Pad | null = null
  private readonly padMesh: MeshData
  private readonly padModel = new Float32Array(16)
  private readonly burstMesh: MeshData[]
  private readonly burstModel: Float32Array[]
  private readonly bursts: Array<Burst | null>
  private burstCursor = 0
  private aimYaw: number | null = null
  private readonly items: RoundDraw[] = []

  constructor() {
    this.padMesh = ringMesh([1, 0.82, 0.28])
    this.burstMesh = []
    this.burstModel = []
    this.bursts = []
    for (let i = 0; i < 4; i++) {
      this.burstMesh.push(ringMesh([1, 0.96, 0.72]))
      this.burstModel.push(new Float32Array(16))
      this.bursts.push(null)
    }
  }

  /** Drop any round in progress. The step clock starts when the song actually plays. */
  hold(): void {
    this.pad = null
    this.aimYaw = null
    this.clearBursts()
    this.phase = 'idle'
    this.score = 0
    this.dim = 0
    this.t = 0
  }

  /** Start stepping. The round lasts until the song ends. */
  begin(_songSec: number): void {
    this.pad = null
    this.aimYaw = null
    this.clearBursts()
    this.score = 0
    this.dim = 0
    this.t = 0
    this.nextAt = 0
    this.phase = 'step'
  }

  /** Show the landing ring. It stays until land or disarm. */
  arm(x: number, z: number): void {
    this.pad = { x, z, until: 0 }
    this.phase = 'step'
  }

  /** Hide the landing ring without the hit burst. */
  disarm(): void {
    this.pad = null
  }

  /** Feet arrived. The ring becomes the hit burst on the same center. */
  land(x: number, z: number, beep?: (freq: number, seconds: number) => void): void {
    this.pad = null
    this.burstAt(x, z)
    beep?.(880, 0.08)
  }

  /** Current step ring, or null when there is nothing to jump toward. */
  padAt(): { x: number; z: number } | null {
    if (!this.pad) return null
    return { x: this.pad.x, z: this.pad.z }
  }

  /** Song finished. Drop the round and every ring the beats put on the ground. */
  fail(): void {
    if (this.phase !== 'step' && this.phase !== 'hunt') return
    this.phase = 'idle'
    this.pad = null
    this.aimYaw = null
    this.clearBursts()
    this.score = 0
  }

  update(dt: number, _x?: number, _z?: number, _yaw?: number, _hooks?: RoundHooks): RoundView {
    this.t += dt
    return this.view()
  }

  view(_hooks?: RoundHooks): RoundView {
    this.fill()
    return {
      phase: this.phase,
      score: this.score,
      dim: 0,
      scoreText: '',
      phaseText: '',
      aimYaw: null,
      items: this.items,
    }
  }

  private burstAt(x: number, z: number): void {
    const slot = this.burstCursor % this.bursts.length
    this.burstCursor++
    this.bursts[slot] = { x, z, born: this.t }
  }

  private clearBursts(): void {
    for (let i = 0; i < this.bursts.length; i++) this.bursts[i] = null
  }

  private fill(): void {
    this.items.length = 0
    const pulse = 0.92 + 0.08 * Math.sin(this.t * 8)
    const pad = this.pad
    if (pad) {
      put(this.padModel, pad.x, pad.z, pulse)
      this.items.push({ mesh: this.padMesh, model: this.padModel })
    }
    this.bursts.forEach((burst, i) => {
      if (!burst) return
      const age = this.t - burst.born
      if (age < 0 || age >= BURST) {
        this.bursts[i] = null
        return
      }
      const scale = 1 + (age / BURST) * 1.8
      put(this.burstModel[i], burst.x, burst.z, scale)
      this.items.push({ mesh: this.burstMesh[i], model: this.burstModel[i] })
    })
  }
}
