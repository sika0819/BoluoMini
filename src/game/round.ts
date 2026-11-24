import { Builder, KIND_BEAT, type MeshData, type RGB } from '../scene/mesh'
import { groundContact, groundHeight } from '../scene/world'

const BPM = 120
const BEAT = 60 / BPM
const STEP_SEC = 30
const HUNT_LEAD = 8
const HIT_R = 1.1
const FIND_R = 1.6
const BURST = 0.4
const PAD_ARC = 40 * Math.PI / 180
/** Guide rings sit this far ahead, close enough to catch before they close. */
const GUIDE_MIN = 5
const GUIDE_MAX = 8
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

interface Source {
  x: number
  z: number
  found: boolean
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
  let lift = 0
  // A lift along the normal also slides the ring sideways, so the rim is checked again.
  for (let pass = 0; pass < 2; pass++) {
    let deficit = 0
    for (let i = 0; i < RING_SAMPLES; i++) {
      const a = (i / RING_SAMPLES) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const xw = g.x + g.nx * lift + (tx * c * RING_OUTER + g.nx * RING_Y + bx * sn * RING_OUTER) * s
      const yw = g.y + g.ny * lift + (ty * c * RING_OUTER + g.ny * RING_Y + by * sn * RING_OUTER) * s
      const zw = g.z + g.nz * lift + (tz * c * RING_OUTER + g.nz * RING_Y + bz * sn * RING_OUTER) * s
      const gap = groundHeight(xw, zw) + RING_CLEAR - yw
      if (gap > deficit) deficit = gap
    }
    if (deficit <= 0) break
    lift += deficit / Math.max(0.2, g.ny)
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
  m[12] = g.x + g.nx * lift
  m[13] = g.y + g.ny * lift
  m[14] = g.z + g.nz * lift
  m[15] = 1
}

export class Round {
  phase: RoundPhase = 'idle'
  score = 0
  /** Kept at 0. Hunt no longer darkens the meadow. */
  dim = 0
  private t = 0
  private stepUntil = STEP_SEC
  private nextAt = 0
  private pad: Pad | null = null
  private readonly padMesh: MeshData
  private readonly padModel = new Float32Array(16)
  private readonly burstMesh: MeshData[]
  private readonly burstModel: Float32Array[]
  private readonly bursts: Array<Burst | null>
  private burstCursor = 0
  private readonly marks: MeshData[]
  private readonly markModel: Float32Array[]
  private sources: Source[] = []
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
    const green: RGB = [0.45, 0.95, 0.5]
    this.marks = []
    this.markModel = []
    for (let i = 0; i < 3; i++) {
      this.marks.push(ringMesh(green))
      this.markModel.push(new Float32Array(16))
    }
  }

  /** Drop any round in progress. The step clock starts when the song actually plays. */
  hold(): void {
    this.sources = []
    this.pad = null
    this.aimYaw = null
    this.clearBursts()
    this.phase = 'idle'
    this.score = 0
    this.dim = 0
    this.t = 0
  }

  /** Start stepping. Hunt begins at 30s, or 8s before the song ends, whichever is sooner. */
  begin(songSec: number): void {
    this.sources = []
    this.pad = null
    this.aimYaw = null
    this.clearBursts()
    this.score = 0
    this.dim = 0
    this.t = 0
    this.nextAt = 0
    const length = Math.max(0, songSec)
    this.stepUntil = Math.min(STEP_SEC, Math.max(0, length - HUNT_LEAD))
    this.phase = 'step'
  }

  /** Song finished before the three sources were found. */
  fail(): void {
    if (this.phase === 'clear' || this.phase === 'idle' || this.phase === 'fail') return
    this.phase = 'fail'
    this.pad = null
    this.aimYaw = null
    this.sources = []
  }

  update(dt: number, x: number, z: number, yaw: number, hooks: RoundHooks): RoundView {
    if (hooks.ended?.() && (this.phase === 'step' || this.phase === 'hunt')) this.fail()
    if (this.phase === 'step') {
      this.t += dt
      if (this.t >= this.stepUntil) this.enterHunt(x, z, hooks)
      else {
        this.spawn(x, z, yaw, hooks)
        this.judge(x, z, hooks)
      }
    } else if (this.phase === 'hunt') {
      this.t += dt
      this.listen(x, z, hooks)
      if (this.phase === 'hunt') {
        this.guide(x, z, hooks)
        this.judge(x, z, hooks)
        const pad = this.pad
        this.aimYaw = pad ? Math.atan2(pad.x - x, pad.z - z) : null
      }
    }
    return this.view(hooks)
  }

  view(hooks: RoundHooks): RoundView {
    this.fill()
    const found = this.sources.reduce((n, s) => n + (s.found ? 1 : 0), 0)
    let phaseText = ''
    let scoreText = ''
    if (this.phase === 'step') {
      scoreText = String(this.score)
      phaseText = `踩点 ${Math.max(0, Math.ceil(this.stepUntil - this.t))}s`
    } else if (this.phase === 'hunt') {
      scoreText = String(this.score)
      phaseText = `寻宝 ${found}/3`
    } else if (this.phase === 'clear') {
      scoreText = String(this.score)
      phaseText = '通关'
    } else if (this.phase === 'fail') {
      scoreText = String(this.score)
      phaseText = '游戏失败'
    }
    return {
      phase: this.phase,
      score: this.score,
      dim: 0,
      scoreText,
      phaseText,
      aimYaw: this.phase === 'hunt' ? this.aimYaw : null,
      items: this.items,
    }
  }

  private enterHunt(x: number, z: number, hooks: RoundHooks): void {
    this.phase = 'hunt'
    this.pad = null
    this.aimYaw = null
    this.nextAt = this.t
    this.placeSources(x, z, hooks)
    this.guide(x, z, hooks)
    const pad = this.pad
    this.aimYaw = pad ? Math.atan2(pad.x - x, pad.z - z) : null
  }

  private spawn(x: number, z: number, yaw: number, hooks: RoundHooks): void {
    if (this.pad || this.t < this.nextAt) return
    for (let tryN = 0; tryN < 12; tryN++) {
      const ang = yaw + (Math.random() * 2 - 1) * PAD_ARC
      const dist = 5 + Math.random() * 3
      const px = x + Math.sin(ang) * dist
      const pz = z + Math.cos(ang) * dist
      if (!hooks.canOccupy(px, pz)) continue
      const open = Math.max(2.5, dist / 4 + 1.2)
      this.pad = { x: px, z: pz, until: this.t + open }
      return
    }
  }

  private judge(x: number, z: number, hooks: RoundHooks): void {
    const pad = this.pad
    if (!pad) return
    if (Math.hypot(pad.x - x, pad.z - z) < HIT_R) {
      this.score += 100
      hooks.beep?.(880, 0.08)
      this.burstAt(x, z)
      this.pad = null
      this.nextAt = this.t + BEAT
      return
    }
    if (this.t >= pad.until) {
      if (this.phase !== 'hunt') hooks.beep?.(180, 0.06)
      this.pad = null
      this.nextAt = this.t + BEAT
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

  /** One ring near the player, on the way to the nearest unfound treasure. */
  private guide(x: number, z: number, hooks: RoundHooks): void {
    if (this.pad || this.t < this.nextAt) return
    const source = this.nearest(x, z)
    if (!source) return
    const dx = source.x - x
    const dz = source.z - z
    const remain = Math.hypot(dx, dz)
    if (remain < 0.05) return
    const ux = dx / remain
    const uz = dz / remain
    const primary = Math.min(GUIDE_MIN + Math.random() * (GUIDE_MAX - GUIDE_MIN), Math.max(2.4, remain - 0.5))
    for (const dist of [primary, 4, 3.2, 6]) {
      const reach = Math.min(dist, Math.max(2.2, remain - 0.4))
      if (reach < 1.8) continue
      for (let n = 0; n < 11; n++) {
        const side = n === 0 ? 0 : (n % 2 ? 1 : -1) * Math.ceil(n / 2) * 0.55
        const px = x + ux * reach - uz * side
        const pz = z + uz * reach + ux * side
        if (!hooks.canOccupy(px, pz)) continue
        this.pad = { x: px, z: pz, until: this.t + Math.max(2.8, reach / 4 + 1.3) }
        return
      }
    }
  }

  private nearest(x: number, z: number): Source | null {
    let best: Source | null = null
    let bestD = Infinity
    for (const source of this.sources) {
      if (source.found) continue
      const d = Math.hypot(source.x - x, source.z - z)
      if (d < bestD) {
        best = source
        bestD = d
      }
    }
    return best
  }

  private placeSources(x: number, z: number, hooks: RoundHooks): void {
    const spots: Source[] = []
    const attempt = (minDist: number, maxDist: number, sep: number) => {
      for (let n = 0; n < 80 && spots.length < 3; n++) {
        const ang = Math.random() * Math.PI * 2
        const dist = minDist + Math.random() * (maxDist - minDist)
        const sx = x + Math.sin(ang) * dist
        const sz = z + Math.cos(ang) * dist
        if (!hooks.canOccupy(sx, sz)) continue
        if (spots.some((s) => Math.hypot(s.x - sx, s.z - sz) < sep)) continue
        spots.push({ x: sx, z: sz, found: false })
      }
    }
    attempt(12, 26, 8)
    if (spots.length < 3) attempt(8, 32, 5)
    this.sources = spots
  }

  private listen(x: number, z: number, hooks: RoundHooks): void {
    if (this.phase === 'clear') return
    let found = 0
    for (const source of this.sources) {
      if (source.found) {
        found++
        continue
      }
      if (Math.hypot(source.x - x, source.z - z) < FIND_R) {
        source.found = true
        this.score += 200
        hooks.beep?.(880, 0.09)
        this.pad = null
        this.aimYaw = null
        this.nextAt = this.t + BEAT
        found++
      }
    }
    if (this.sources.length >= 3 && found >= 3) {
      this.phase = 'clear'
      this.pad = null
      this.aimYaw = null
    }
  }

  private fill(): void {
    this.items.length = 0
    const pulse = 0.92 + 0.08 * Math.sin(this.t * 8)
    const pad = this.pad
    if (pad && (this.phase === 'step' || this.phase === 'hunt')) {
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
    if (this.phase === 'fail') return
    this.sources.forEach((source, i) => {
      if (!source.found) return
      put(this.markModel[i], source.x, source.z, pulse)
      this.items.push({ mesh: this.marks[i], model: this.markModel[i] })
    })
  }
}
