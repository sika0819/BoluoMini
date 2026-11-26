import { multiply } from '../gl/math'
import { FLOATS, KIND_ACTOR, type MeshData } from '../scene/mesh'
import { DANCE_DURATION, JUMP, LIE, SIT, STAND_AIM, WAVE_DURATION, dancePose, jellyScale, wavePose, type DanceKind, type GesturePose } from './gesture'

interface Track {
  times: Float32Array
  trs: Float32Array
}

interface Clip {
  duration: number
  tracks: Array<Track | null>
}

interface ActorFile {
  parents: number[]
  rest: string
  joints: number[]
  ibm: string
  pos: string
  nrm: string
  jnt: string
  wgt: string
  idx: string
  uv: string
  rgb: string
  idle: { duration: number; tracks: Array<{ times: string; trs: string } | null> }
  walk: { duration: number; tracks: Array<{ times: string; trs: string } | null> }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function decodeB64(src: string): Uint8Array {
  const clean = src.replace(/=+$/, '')
  const len = Math.floor(clean.length * 3 / 4)
  const out = new Uint8Array(len)
  let j = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64.indexOf(clean[i])
    const b = B64.indexOf(clean[i + 1])
    const c = i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0
    const d = i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0
    out[j++] = (a << 2) | (b >> 4)
    if (j < len) out[j++] = ((b & 15) << 4) | (c >> 2)
    if (j < len) out[j++] = ((c & 3) << 6) | d
  }
  return out
}

function f32(src: string): Float32Array {
  const bytes = decodeB64(src)
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return new Float32Array(buf)
}

function u8(src: string): Uint8Array {
  return decodeB64(src)
}

function u16(src: string): Uint16Array {
  const bytes = decodeB64(src)
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return new Uint16Array(buf)
}

function trsToMat(trs: Float32Array, index: number, out: Float32Array): void {
  const o = index * 10
  const x = trs[o + 3]
  const y = trs[o + 4]
  const z = trs[o + 5]
  const w = trs[o + 6]
  const sx = trs[o + 7]
  const sy = trs[o + 8]
  const sz = trs[o + 9]
  const xx = x * x
  const yy = y * y
  const zz = z * z
  const xy = x * y
  const xz = x * z
  const yz = y * z
  const wx = w * x
  const wy = w * y
  const wz = w * z
  out[0] = (1 - 2 * (yy + zz)) * sx
  out[1] = 2 * (xy + wz) * sx
  out[2] = 2 * (xz - wy) * sx
  out[3] = 0
  out[4] = 2 * (xy - wz) * sy
  out[5] = (1 - 2 * (xx + zz)) * sy
  out[6] = 2 * (yz + wx) * sy
  out[7] = 0
  out[8] = 2 * (xz + wy) * sz
  out[9] = 2 * (yz - wx) * sz
  out[10] = (1 - 2 * (xx + yy)) * sz
  out[11] = 0
  out[12] = trs[o]
  out[13] = trs[o + 1]
  out[14] = trs[o + 2]
  out[15] = 1
}

function slerp(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  t: number,
  out: Float32Array,
  offset: number,
): void {
  let x = bx
  let y = by
  let z = bz
  let w = bw
  let dot = ax * x + ay * y + az * z + aw * w
  if (dot < 0) {
    x = -x
    y = -y
    z = -z
    w = -w
    dot = -dot
  }
  let s0: number
  let s1: number
  if (dot > 0.9995) {
    s0 = 1 - t
    s1 = t
  } else {
    const theta = Math.acos(Math.min(1, dot))
    const sin = Math.sin(theta)
    s0 = Math.sin((1 - t) * theta) / sin
    s1 = Math.sin(t * theta) / sin
  }
  let ox = ax * s0 + x * s1
  let oy = ay * s0 + y * s1
  let oz = az * s0 + z * s1
  let ow = aw * s0 + w * s1
  const len = Math.hypot(ox, oy, oz, ow) || 1
  out[offset] = ox / len
  out[offset + 1] = oy / len
  out[offset + 2] = oz / len
  out[offset + 3] = ow / len
}

function mulQuat(
  ax: number, ay: number, az: number, aw: number,
  bx: number, by: number, bz: number, bw: number,
  out: Float32Array, offset: number,
): void {
  out[offset] = aw * bx + ax * bw + ay * bz - az * by
  out[offset + 1] = aw * by - ax * bz + ay * bw + az * bx
  out[offset + 2] = aw * bz + ax * by - ay * bx + az * bw
  out[offset + 3] = aw * bw - ax * bx - ay * by - az * bz
}

function sampleTrack(track: Track, time: number, duration: number, out: Float32Array, offset: number): void {
  const times = track.times
  const values = track.trs
  const n = times.length
  let t = duration > 0 ? time % duration : 0
  if (t < 0) t += duration
  if (n === 1 || t <= times[0]) {
    out.set(values.subarray(0, 10), offset)
    return
  }
  let i = 0
  while (i < n - 2 && times[i + 1] < t) i++
  const t0 = times[i]
  const t1 = times[i + 1]
  const u = t1 > t0 ? Math.min(1, Math.max(0, (t - t0) / (t1 - t0))) : 0
  const a = i * 10
  const b = (i + 1) * 10
  const k = 1 - u
  out[offset] = values[a] * k + values[b] * u
  out[offset + 1] = values[a + 1] * k + values[b + 1] * u
  out[offset + 2] = values[a + 2] * k + values[b + 2] * u
  slerp(
    values[a + 3], values[a + 4], values[a + 5], values[a + 6],
    values[b + 3], values[b + 4], values[b + 5], values[b + 6],
    u, out, offset + 3,
  )
  out[offset + 7] = values[a + 7] * k + values[b + 7] * u
  out[offset + 8] = values[a + 8] * k + values[b + 8] * u
  out[offset + 9] = values[a + 9] * k + values[b + 9] * u
}

function loadClip(raw: ActorFile['idle']): Clip {
  return {
    duration: raw.duration,
    tracks: raw.tracks.map((track) => track ? { times: f32(track.times), trs: f32(track.trs) } : null),
  }
}

/** Feet sit a little under y=0 in the bind pose. Lift so the soles meet the ground. */
export const ACTOR_LIFT = 0.05
export const ACTOR_SCALE = 1.8

/**
 * Immersed breath, shared by the HUD ring, the belly, and the mouth.
 * Inhale 4s, hold 3s, exhale 4s. One clock so the circle and the body stay together.
 */
export const BREATH_IN_S = 4
export const BREATH_HOLD_S = 3
export const BREATH_OUT_S = 4
export const BREATH_CYCLE_S = BREATH_IN_S + BREATH_HOLD_S + BREATH_OUT_S

/** 0 at the end of the exhale, 1 through the hold. Cosine ease, then a flat hold. */
export function breathOpen(nowMs: number): number {
  const u = (nowMs / 1000) % BREATH_CYCLE_S
  if (u < BREATH_IN_S) return 0.5 - 0.5 * Math.cos(Math.PI * (u / BREATH_IN_S))
  if (u < BREATH_IN_S + BREATH_HOLD_S) return 1
  const x = (u - BREATH_IN_S - BREATH_HOLD_S) / BREATH_OUT_S
  return 0.5 + 0.5 * Math.cos(Math.PI * x)
}

/** The step the circle is on, so a guide can name it while it happens. */
export function breathCue(nowMs: number): '吸气' | '屏息' | '呼气' {
  const u = (nowMs / 1000) % BREATH_CYCLE_S
  if (u < BREATH_IN_S) return '吸气'
  if (u < BREATH_IN_S + BREATH_HOLD_S) return '屏息'
  return '呼气'
}

/** How far the belly front pushes out at the top of a breath. The chest stays put. */
const BREATH_RADIAL = 0.16
/** Mouth diameter at the held breath is about twice the rest size. Speech only. */
const MOUTH_GROW = 1
const REST_Q = [0, 0, 0, 1]
const REST_T = [0, 0, 0]

type Vec3 = { x: number; y: number; z: number }

function smooth01(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/**
 * Bind-space height mask (Blender Z-up). The belly only.
 * The chest, face and leaves sit above this band and keep their shape.
 */
function bellyHeight(z: number): number {
  return smooth01(0.2, 0.32, z) * (1 - smooth01(0.42, 0.54, z))
}

export function actorMatrix(
  out: Float32Array, x: number, y: number, z: number, yaw: number, lift = 0,
): void {
  const s = ACTOR_SCALE
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  out[0] = s * cy
  out[1] = 0
  out[2] = -s * sy
  out[3] = 0
  out[4] = 0
  out[5] = s
  out[6] = 0
  out[7] = 0
  out[8] = s * sy
  out[9] = 0
  out[10] = s * cy
  out[11] = 0
  out[12] = x
  out[13] = y + ACTOR_LIFT + lift
  out[14] = z
  out[15] = 1
}

export class Actor {
  readonly mesh: MeshData
  private readonly parents: number[]
  private readonly rest: Float32Array
  private readonly jointNodes: number[]
  private readonly ibm: Float32Array
  private readonly bindPos: Float32Array
  private readonly bindNrm: Float32Array
  private readonly bindJnt: Uint8Array
  private readonly bindWgt: Float32Array
  private readonly idle: Clip
  private readonly walk: Clip
  private readonly localA: Float32Array
  private readonly localB: Float32Array
  private readonly localG: Float32Array
  private readonly posed: Float32Array
  private readonly global: Float32Array
  private readonly jointMat: Float32Array
  private readonly offQ: Float32Array
  private readonly offT: Float32Array
  private readonly tmp = new Float32Array(16)
  private readonly scratch = new Float32Array(16)
  private readonly quat = new Float32Array(4)
  private idleT = 0
  private walkT = 0
  private walkBlend = 0
  /** 0 is the walk. 1 lengthens the stride, leans in, and bounces. */
  private runBlend = 0
  private gestureBlend = 0
  private mode: 'stand' | 'wave' | 'sit' | 'lie' = 'stand'
  private waveT = 0
  private waveEnded = false
  private poseLift = 0
  /** 0..1 tuck while a step-mode hop is in the air. */
  private jumpAmt = 0
  private wasJumping = false
  private aimX = STAND_AIM[0]
  private aimY = STAND_AIM[1]
  private aimZ = STAND_AIM[2]
  /** Per vertex, how much of the deep breath this point follows. Leaves fade out; limbs stay. */
  private readonly breathMask: Float32Array
  /** Center of the belly in bind space. The front bulge grows away from here. */
  private breathCx = 0
  private breathCy = 0
  /** 0 keeps the bind shape. Only 沉浸 eases this up, and only for a still stand, sit, or lie. */
  private breathW = 0
  /** 1 on the mouth disc. Immersed, the disc stays round and grows with the breath ring. */
  private readonly mouthMask: Uint8Array
  private mouthCx = 0
  private mouthCy = 0
  private mouthCz = 0
  /** Dialogue is still typing. The mouth opens and closes on `talkPhase`. */
  private speaking = false
  /** 0..1 through one open-close while a line is being typed. */
  private talkPhase = 0
  /** Eases to 1 while speaking and back to 0 when the line is done. */
  private talkW = 0
  /** Same 4-3-4 envelope as the ring. The speaking mouth grows on this while immersed. */
  private speakBreath = 0
  /** 0..1 from the breath ring. 1 is the ring at its largest. */
  private ringOpen = 0
  private breathAmt = 0
  private swellX = 0
  private swellY = 0
  private swellZ = 0
  private swellS = 1
  /** 1 at the normal idle speed. During 沉浸 it eases toward the breath rhythm. */
  private idleRate = 1
  private danceKind: DanceKind | null = null
  private danceT = 0
  private danceDur = 0
  /** +1 or -1 for the current spin. Chosen once when the spin starts. */
  private spinDir = 1
  private danceOut = false
  private danceQuick = false
  /** 0 is the idle clip. 1 is the dance sampled on the rest pose. */
  private danceAmt = 0
  /** Hips Y scale. 1 leaves the bind shape alone. */
  private jellyY = 1

  constructor(file: ActorFile) {
    this.parents = file.parents
    this.rest = f32(file.rest)
    this.jointNodes = file.joints
    this.ibm = f32(file.ibm)
    this.bindPos = f32(file.pos)
    this.bindNrm = f32(file.nrm)
    this.bindJnt = u8(file.jnt)
    this.bindWgt = f32(file.wgt)
    this.idle = loadClip(file.idle)
    this.walk = loadClip(file.walk)
    const nodes = this.parents.length
    this.localA = new Float32Array(nodes * 10)
    this.localB = new Float32Array(nodes * 10)
    this.localG = new Float32Array(nodes * 10)
    this.posed = new Float32Array(nodes * 10)
    this.offQ = new Float32Array(nodes * 4)
    this.offT = new Float32Array(nodes * 3)
    for (let i = 0; i < nodes; i++) this.offQ[i * 4 + 3] = 1
    this.global = new Float32Array(nodes * 16)
    this.jointMat = new Float32Array(this.jointNodes.length * 16)
    const count = this.bindPos.length / 3
    const interleaved = new Float32Array(count * FLOATS)
    const colors = u8(file.rgb)
    const uv = f32(file.uv)
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS
      interleaved[o + 6] = colors[i * 3] / 255
      interleaved[o + 7] = colors[i * 3 + 1] / 255
      interleaved[o + 8] = colors[i * 3 + 2] / 255
      interleaved[o + 9] = KIND_ACTOR
      interleaved[o + 10] = uv[i * 2]
      interleaved[o + 11] = uv[i * 2 + 1]
    }
    // Pineapple scales. UV stays a unit angle so the fade cannot bend the grid.
    // Kind packs height in 10 bits and strength in 6 bits: 15 + n * 0.4/65536.
    for (let i = 0; i < count; i++) {
      const o = i * FLOATS
      const r = colors[i * 3]
      const g = colors[i * 3 + 1]
      const b = colors[i * 3 + 2]
      const yellow = r > 180 && g > 120 && b < 100 && r > b + 80 && g > b + 30
      if (!yellow) {
        interleaved[o + 10] = 0
        interleaved[o + 11] = 0
        continue
      }
      const x = this.bindPos[i * 3]
      const y = this.bindPos[i * 3 + 1]
      const z = this.bindPos[i * 3 + 2]
      let arm = 0
      for (let k = 0; k < 4; k++) {
        const weight = this.bindWgt[i * 4 + k]
        if (weight <= 0) continue
        const joint = this.bindJnt[i * 4 + k]
        if (joint === 3 || joint === 4) arm += weight
      }
      const rad = Math.hypot(x, y) || 1
      const limb = Math.max(smooth01(0.05, 0.28, arm), smooth01(0.35, 0.41, rad))
      const dx = x / 0.2
      const dz = (z - 0.59) / 0.15
      const face = smooth01(1.05, 0.42, dx * dx + dz * dz) * smooth01(0.02, -0.16, y)
      const band = smooth01(0.05, 0.12, z) * (1 - smooth01(0.78, 0.86, z))
      const w = (1 - limb) * (1 - face) * band
      const zq = Math.min(1023, Math.max(0, Math.round(Math.min(1, Math.max(0, z)) * 1023)))
      const mq = Math.min(63, Math.max(0, Math.round(w * 63)))
      interleaved[o + 10] = x / rad
      interleaved[o + 11] = y / rad
      interleaved[o + 9] = KIND_ACTOR + (zq * 64 + mq) * (0.4 / 65536)
    }
    this.mesh = {
      interleaved,
      indices: u16(file.idx),
      receiveShadow: false,
      dynamic: true,
    }
    this.breathMask = new Float32Array(count)
    let sx = 0
    let sy = 0
    let sc = 0
    for (let i = 0; i < count; i++) {
      let torso = 0
      let limb = 0
      for (let k = 0; k < 4; k++) {
        const weight = this.bindWgt[i * 4 + k]
        if (weight <= 0) continue
        const joint = this.bindJnt[i * 4 + k]
        if (joint === 1 || joint === 2) torso += weight
        else if (joint >= 3) limb += weight
      }
      const gate = smooth01(0.4, 0.75, torso) * (1 - smooth01(0.2, 0.55, limb))
      const mask = bellyHeight(this.bindPos[i * 3 + 2]) * gate
      this.breathMask[i] = mask
      if (mask > 0.55) {
        sx += this.bindPos[i * 3]
        sy += this.bindPos[i * 3 + 1]
        sc++
      }
    }
    if (sc > 0) {
      this.breathCx = sx / sc
      this.breathCy = sy / sc
    }
    this.mouthMask = new Uint8Array(count)
    let mx = 0
    let my = 0
    let mz = 0
    let mc = 0
    const lip: number[] = []
    for (let i = 0; i < count; i++) {
      const r = colors[i * 3]
      const g = colors[i * 3 + 1]
      const b = colors[i * 3 + 2]
      if (r > 170 && g < 100 && b < 120 && r > g + 60) lip.push(i)
    }
    for (const i of lip) {
      mx += this.bindPos[i * 3]
      my += this.bindPos[i * 3 + 1]
      mz += this.bindPos[i * 3 + 2]
      mc++
    }
    if (mc > 0) {
      this.mouthCx = mx / mc
      this.mouthCy = my / mc
      this.mouthCz = mz / mc
      for (const i of lip) this.mouthMask[i] = 1
      for (let i = 0; i < count; i++) {
        const r = colors[i * 3]
        const g = colors[i * 3 + 1]
        const b = colors[i * 3 + 2]
        if (r < 80 || r > 140 || g > 60 || b > 80 || r < g + 40) continue
        const dx = this.bindPos[i * 3] - this.mouthCx
        const dy = this.bindPos[i * 3 + 1] - this.mouthCy
        const dz = this.bindPos[i * 3 + 2] - this.mouthCz
        if (dx * dx + dy * dy + dz * dz < 0.0001) this.mouthMask[i] = 1
      }
    }
    this.pins = this.measurePins()
    this.compose()
  }

  /** Bind-space anchors. Feet and the right hand, so shoes and a lantern can sit on the bones. */
  readonly pins: { footL: Vec3; footR: Vec3; handR: Vec3 }

  /**
   * Bind-space point through one joint, without the belly swell.
   * Joint 2 is the chest, 4 the right arm, 5 and 6 the feet.
   */
  poseBind(joint: number, x: number, y: number, z: number): Vec3 {
    const m = joint * 16
    const jm = this.jointMat
    return {
      x: jm[m] * x + jm[m + 4] * y + jm[m + 8] * z + jm[m + 12],
      y: jm[m + 1] * x + jm[m + 5] * y + jm[m + 9] * z + jm[m + 13],
      z: jm[m + 2] * x + jm[m + 6] * y + jm[m + 10] * z + jm[m + 14],
    }
  }

  /** Direction through the same joint. Length is not preserved. */
  poseDir(joint: number, x: number, y: number, z: number): Vec3 {
    const m = joint * 16
    const jm = this.jointMat
    return {
      x: jm[m] * x + jm[m + 4] * y + jm[m + 8] * z,
      y: jm[m + 1] * x + jm[m + 5] * y + jm[m + 9] * z,
      z: jm[m + 2] * x + jm[m + 6] * y + jm[m + 10] * z,
    }
  }

  /** 0 is idle. 1 is a dance fully on the body. */
  danceAmount(): number {
    return this.danceAmt
  }

  private measurePins(): { footL: Vec3; footR: Vec3; handR: Vec3 } {
    const avg = (joint: number): Vec3 => {
      let x = 0
      let y = 0
      let z = 0
      let c = 0
      const count = this.bindPos.length / 3
      for (let i = 0; i < count; i++) {
        let w = 0
        for (let k = 0; k < 4; k++) {
          if (this.bindJnt[i * 4 + k] === joint) w += this.bindWgt[i * 4 + k]
        }
        if (w < 0.45) continue
        x += this.bindPos[i * 3]
        y += this.bindPos[i * 3 + 1]
        z += this.bindPos[i * 3 + 2]
        c++
      }
      if (c === 0) return { x: 0, y: 0, z: 0 }
      return { x: x / c, y: y / c, z: z / c }
    }
    const tip = (joint: number): Vec3 => {
      let best = -1
      let out = { x: 0.2, y: -0.05, z: 0.35 }
      const count = this.bindPos.length / 3
      for (let i = 0; i < count; i++) {
        let w = 0
        for (let k = 0; k < 4; k++) {
          if (this.bindJnt[i * 4 + k] === joint) w += this.bindWgt[i * 4 + k]
        }
        if (w < 0.45) continue
        const x = this.bindPos[i * 3]
        const y = this.bindPos[i * 3 + 1]
        const z = this.bindPos[i * 3 + 2]
        const d = x * x + y * y + (z - 0.55) * (z - 0.55)
        if (d > best) {
          best = d
          out = { x, y, z }
        }
      }
      return out
    }
    return { footL: avg(5), footR: avg(6), handR: tip(4) }
  }

  /**
   * Leaves, in bind space (Blender Z-up). The whole crown is weighted to the chest,
   * so the same joint that places the eyes places this point.
   */
  crownLocal(): { x: number; y: number; z: number } {
    return this.posePoint(-0.005, 0.052, 0.919)
  }

  /**
   * Above the posed silhouette. Standing, that is the leaf tips.
   * Lying, the belly is higher than the crown, so the dialog clears the body.
   */
  topLocal(): { x: number; y: number; z: number } {
    const crown = this.crownLocal()
    const posed = this.mesh.interleaved
    let y = crown.y
    for (let i = 1; i < posed.length; i += FLOATS) {
      if (posed[i] > y) y = posed[i]
    }
    return { x: crown.x, y, z: crown.z }
  }

  /**
   * Bind-space point (Blender Z-up) after the chest joint.
   * Eyes sit on the chest, and the highlight discs are not skinned themselves.
   */
  posePoint(x: number, y: number, z: number): { x: number; y: number; z: number } {
    this.swell(x, y, z, bellyHeight(z))
    const m = 2 * 16
    const jm = this.jointMat
    const sx = this.swellX
    const sy = this.swellY
    const sz = this.swellZ
    return {
      x: jm[m] * sx + jm[m + 4] * sy + jm[m + 8] * sz + jm[m + 12],
      y: jm[m + 1] * sx + jm[m + 5] * sy + jm[m + 9] * sz + jm[m + 13],
      z: jm[m + 2] * sx + jm[m + 6] * sy + jm[m + 10] * sz + jm[m + 14],
    }
  }

  /** World metres to add in `actorMatrix` so a sit or lie meets the ground. */
  groundLift(): number {
    return this.poseLift * this.gestureBlend
  }

  /**
   * Posed actor-local box. Center is the middle of the fruit.
   * The six reach points sit on the faces, so a tap can use the whole body.
   */
  bodyBox(): { center: { x: number; y: number; z: number }; reach: { x: number; y: number; z: number }[] } {
    const posed = this.mesh.interleaved
    let minX = Infinity
    let minY = Infinity
    let minZ = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    let maxZ = -Infinity
    for (let i = 0; i < posed.length; i += FLOATS) {
      const x = posed[i]
      const y = posed[i + 1]
      const z = posed[i + 2]
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (z < minZ) minZ = z
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
      if (z > maxZ) maxZ = z
    }
    if (!(maxY > minY + 0.2)) {
      minX = -0.5
      maxX = 0.5
      minY = 0
      maxY = 1
      minZ = -0.33
      maxZ = 0.33
    }
    const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 }
    return {
      center,
      reach: [
        { x: minX, y: center.y, z: center.z },
        { x: maxX, y: center.y, z: center.z },
        { x: center.x, y: minY, z: center.z },
        { x: center.x, y: maxY, z: center.z },
        { x: center.x, y: center.y, z: minZ },
        { x: center.x, y: center.y, z: maxZ },
      ],
    }
  }

  /** Actor-local chest, before scale. Follows the pose so a tap still lands. */
  aimLocal(): { x: number; y: number; z: number } {
    const w = this.gestureBlend
    const keep = 1 - w
    return {
      x: STAND_AIM[0] * keep + this.aimX * w,
      y: STAND_AIM[1] * keep + this.aimY * w,
      z: STAND_AIM[2] * keep + this.aimZ * w,
    }
  }

  /**
   * Wave plays once and reports itself through `takeWaveEnd`.
   * Sit and lie hold. Stand eases the offsets back to the idle pose.
   */
  gesture(name: 'stand' | 'wave' | 'sit' | 'lie'): void {
    if (name === 'wave') {
      this.mode = 'wave'
      this.waveT = 0
      this.waveEnded = false
      return
    }
    if (this.mode === name) return
    this.mode = name
    this.waveEnded = false
  }

  /** True once, on the frame a wave finishes and the body is back to standing. */
  takeWaveEnd(): boolean {
    const ended = this.waveEnded
    this.waveEnded = false
    return ended
  }

  /**
   * Greeting text is still appearing. `phase` runs 0..1 through one open-close,
   * closed at both ends. The mouth eases back to the breath shape when this stops.
   */
  setSpeaking(on: boolean, phase: number): void {
    this.speaking = on
    if (on) this.talkPhase = phase
  }

  /** Air time of a step-mode hop, 0 on the ground. Peaks mid-jump. */
  setJump(amount: number): void {
    this.jumpAmt = Math.max(0, Math.min(1, amount))
  }

  /** Start a tour dance, or keep the one already playing. */
  playDance(kind: DanceKind): void {
    if (this.danceKind === kind && !this.danceOut) return
    this.danceKind = kind
    this.danceT = 0
    this.danceDur = DANCE_DURATION[kind]
    this.danceOut = false
    this.danceQuick = false
    if (kind === 'spin') this.spinDir = Math.random() < 0.5 ? -1 : 1
  }

  /**
   * Ease the dance off. A jump uses the short fade so the tuck can take the beat.
   * Calling again while it is already fading does nothing.
   */
  stopDance(quick = false): void {
    if (!this.danceKind || this.danceOut) return
    this.danceOut = true
    this.danceQuick = quick
  }

  /**
   * `walking` and `running` follow the body's real speed.
   * The rig has no run clip, so the walk is played faster with a longer
   * stride, a forward lean and a bounce.
   * A hop that is still travelling keeps that gait. The tuck is only for a jump with no travel.
   * `immersed` is the HUD-down idle. Stand, sit, and lie then play on the breath-ring clock.
   * `nowMs` is the same clock the HUD ring uses.
   */
  advance(dt: number, walking: boolean, immersed = false, running = false, nowMs = 0): void {
    const moving = walking || running
    const jumping = this.jumpAmt > 0.001 && !moving
    if ((jumping || this.jumpAmt > 0.001) && this.danceKind) {
      this.danceOut = true
      this.danceQuick = true
    }
    if (moving && this.mode !== 'stand' && !this.danceKind) {
      this.mode = 'stand'
      this.waveEnded = false
    }
    let dancing = false
    if (jumping && !this.danceKind) {
      this.writePose(JUMP)
      this.danceAmt = 0
      this.jellyY = 1
      this.gestureBlend += (this.jumpAmt - this.gestureBlend) * (1 - Math.exp(-dt / 0.08))
      this.wasJumping = true
    } else if (this.danceKind) {
      dancing = true
      this.wasJumping = false
      if (this.danceOut) {
        const tc = this.danceQuick ? 0.12 : 0.2
        this.danceAmt += (0 - this.danceAmt) * (1 - Math.exp(-dt / tc))
        if (this.danceAmt < 0.02) {
          this.danceKind = null
          this.danceAmt = 0
          this.danceOut = false
          this.jellyY = 1
          dancing = false
          if (jumping) {
            this.writePose(JUMP)
            this.gestureBlend = this.jumpAmt
            this.wasJumping = true
          } else {
            this.writePose({ bones: [], lift: 0, aim: STAND_AIM })
            this.gestureBlend = 0
          }
        }
      } else {
        this.danceT += dt
        if (this.danceKind === 'wobble') {
          if (this.danceT >= this.danceDur) this.danceT -= this.danceDur
        } else if (this.danceT >= this.danceDur) {
          this.danceOut = true
        }
        this.danceAmt += (1 - this.danceAmt) * (1 - Math.exp(-dt / 0.08))
      }
      if (this.danceKind && !moving) {
        const poseTime = Math.min(this.danceT, this.danceDur)
        this.writePose(dancePose(this.danceKind, poseTime, this.spinDir))
        this.gestureBlend = this.danceAmt
        const squash = this.danceKind === 'jelly' ? jellyScale(poseTime) : 1
        this.jellyY = 1 + (squash - 1) * this.danceAmt
      } else if (this.danceKind && moving) {
        this.danceOut = true
        this.danceQuick = true
        this.gestureBlend += (0 - this.gestureBlend) * (1 - Math.exp(-dt / 0.12))
      }
    } else {
      this.jellyY = 1
      if (this.wasJumping && this.mode === 'stand') {
        this.writePose({ bones: [], lift: 0, aim: STAND_AIM })
        this.gestureBlend = 0
      }
      this.wasJumping = false
      if (this.mode === 'wave') {
        this.waveT = Math.min(WAVE_DURATION, this.waveT + dt)
        this.writePose(wavePose(this.waveT))
        if (this.waveT >= WAVE_DURATION) {
          this.mode = 'stand'
          this.waveEnded = true
        }
      } else {
        const target = this.mode === 'sit' ? SIT : this.mode === 'lie' ? LIE : null
        const tc = moving ? 0.08 : this.mode === 'lie' ? 0.15 : 0.12
        this.dampPose(dt, tc, target)
      }
      const blendGoal = this.mode === 'stand' && this.settled() ? 0 : 1
      const blendTc = moving ? 0.08 : 0.12
      this.gestureBlend += (blendGoal - this.gestureBlend) * (1 - Math.exp(-dt / blendTc))
    }
    const goal = moving ? 1 : 0
    this.walkBlend += (goal - this.walkBlend) * (1 - Math.exp(-dt / (jumping || dancing ? 0.05 : 0.12)))
    const runGoal = moving && running ? 1 : 0
    this.runBlend += (runGoal - this.runBlend) * (1 - Math.exp(-dt / 0.14))
    const calm = !jumping && !dancing && !moving && this.mode !== 'wave'
    const breathe = calm && immersed
    this.breathW += ((breathe ? 1 : 0) - this.breathW) * (1 - Math.exp(-dt / 0.4))
    const open = breathOpen(nowMs)
    this.speakBreath = open * this.breathW
    this.ringOpen = open
    this.breathAmt = open * this.breathW
    const talkGoal = this.speaking ? 1 : 0
    this.talkW += (talkGoal - this.talkW) * (1 - Math.exp(-dt / 0.06))
    const rateGoal = calm && immersed && this.idle.duration > 0
      ? this.idle.duration / BREATH_CYCLE_S
      : 1
    this.idleRate += (rateGoal - this.idleRate) * (1 - Math.exp(-dt / 0.4))
    this.idleT += dt * this.idleRate
    if (this.idle.duration > 0 && this.idleT >= this.idle.duration) this.idleT %= this.idle.duration
    this.walkT += dt * (1 + this.runBlend * 1.4)
    if (this.walk.duration > 0 && this.walkT >= this.walk.duration) this.walkT %= this.walk.duration
    this.compose()
  }

  /**
   * Belly-front bulge. Face is -Y, so only the front of the belly band moves.
   * The back, the sides and the chest stay on the bind shape.
   * `s` is the radial scale, for the normal correction.
   */
  private swell(x: number, y: number, z: number, mask: number): void {
    const front = smooth01(0.05, 0.2, this.breathCy - y)
    const amt = this.breathAmt * mask * front
    const s = 1 + BREATH_RADIAL * amt
    this.swellX = this.breathCx + (x - this.breathCx) * s
    this.swellY = this.breathCy + (y - this.breathCy) * s
    this.swellZ = z
    this.swellS = s
  }

  private poseClip(clip: Clip, time: number, out: Float32Array): void {
    out.set(this.rest)
    for (let i = 0; i < clip.tracks.length; i++) {
      const track = clip.tracks[i]
      if (track) sampleTrack(track, time, clip.duration, out, i * 10)
    }
  }

  private writePose(pose: GesturePose): void {
    const nodes = this.parents.length
    this.offT.fill(0)
    for (let i = 0; i < nodes; i++) {
      this.offQ[i * 4] = 0
      this.offQ[i * 4 + 1] = 0
      this.offQ[i * 4 + 2] = 0
      this.offQ[i * 4 + 3] = 1
    }
    for (const bone of pose.bones) {
      const q = bone.node * 4
      const t = bone.node * 3
      this.offQ[q] = bone.q[0]
      this.offQ[q + 1] = bone.q[1]
      this.offQ[q + 2] = bone.q[2]
      this.offQ[q + 3] = bone.q[3]
      this.offT[t] = bone.t[0]
      this.offT[t + 1] = bone.t[1]
      this.offT[t + 2] = bone.t[2]
    }
    this.poseLift = pose.lift
    this.aimX = pose.aim[0]
    this.aimY = pose.aim[1]
    this.aimZ = pose.aim[2]
  }

  private dampPose(dt: number, tc: number, pose: GesturePose | null): void {
    const u = 1 - Math.exp(-dt / tc)
    const nodes = this.parents.length
    const bones = pose ? pose.bones : null
    for (let i = 0; i < nodes; i++) {
      let bone: GesturePose['bones'][number] | undefined
      if (bones) {
        for (let b = 0; b < bones.length; b++) {
          if (bones[b].node === i) {
            bone = bones[b]
            break
          }
        }
      }
      const tq = bone ? bone.q : REST_Q
      const tt = bone ? bone.t : REST_T
      const q = i * 4
      const t = i * 3
      slerp(
        this.offQ[q], this.offQ[q + 1], this.offQ[q + 2], this.offQ[q + 3],
        tq[0], tq[1], tq[2], tq[3],
        u, this.quat, 0,
      )
      this.offQ[q] = this.quat[0]
      this.offQ[q + 1] = this.quat[1]
      this.offQ[q + 2] = this.quat[2]
      this.offQ[q + 3] = this.quat[3]
      this.offT[t] += (tt[0] - this.offT[t]) * u
      this.offT[t + 1] += (tt[1] - this.offT[t + 1]) * u
      this.offT[t + 2] += (tt[2] - this.offT[t + 2]) * u
    }
    const lift = pose ? pose.lift : 0
    const aim = pose ? pose.aim : STAND_AIM
    this.poseLift += (lift - this.poseLift) * u
    this.aimX += (aim[0] - this.aimX) * u
    this.aimY += (aim[1] - this.aimY) * u
    this.aimZ += (aim[2] - this.aimZ) * u
  }

  private settled(): boolean {
    if (Math.abs(this.poseLift) > 0.01) return false
    const trans = this.offT
    for (let i = 0; i < trans.length; i++) if (Math.abs(trans[i]) > 0.004) return false
    const nodes = this.parents.length
    for (let i = 0; i < nodes; i++) if (this.offQ[i * 4 + 3] < 0.999) return false
    return true
  }

  private applyOffsets(buf: Float32Array): void {
    const nodes = this.parents.length
    for (let i = 0; i < nodes; i++) {
      const o = i * 10
      const t = i * 3
      const q = i * 4
      buf[o] += this.offT[t]
      buf[o + 1] += this.offT[t + 1]
      buf[o + 2] += this.offT[t + 2]
      mulQuat(
        buf[o + 3], buf[o + 4], buf[o + 5], buf[o + 6],
        this.offQ[q], this.offQ[q + 1], this.offQ[q + 2], this.offQ[q + 3],
        this.quat, 0,
      )
      buf[o + 3] = this.quat[0]
      buf[o + 4] = this.quat[1]
      buf[o + 5] = this.quat[2]
      buf[o + 6] = this.quat[3]
    }
  }

  /**
   * The shipped clip is a walk. A run keeps that timing but swings the arms
   * and feet farther past rest, tips the crown forward, and bounces the hips
   * twice per cycle.
   */
  private applyRun(): void {
    const run = this.runBlend
    if (run < 0.001) return
    const limbs = [4, 5, 6, 7]
    const stride = [1.7, 1.7, 1.42, 1.42]
    for (let n = 0; n < limbs.length; n++) {
      const o = limbs[n] * 10
      slerp(
        this.rest[o + 3], this.rest[o + 4], this.rest[o + 5], this.rest[o + 6],
        this.localB[o + 3], this.localB[o + 4], this.localB[o + 5], this.localB[o + 6],
        stride[n], this.quat, 0,
      )
      slerp(
        this.posed[o + 3], this.posed[o + 4], this.posed[o + 5], this.posed[o + 6],
        this.quat[0], this.quat[1], this.quat[2], this.quat[3],
        run, this.posed, o + 3,
      )
    }
    const lean = 0.46 * run
    const half = lean * 0.5
    const o = 3 * 10
    mulQuat(
      this.posed[o + 3], this.posed[o + 4], this.posed[o + 5], this.posed[o + 6],
      Math.sin(half), 0, 0, Math.cos(half),
      this.quat, 0,
    )
    this.posed[o + 3] = this.quat[0]
    this.posed[o + 4] = this.quat[1]
    this.posed[o + 5] = this.quat[2]
    this.posed[o + 6] = this.quat[3]
    const dur = this.walk.duration || 1
    const bounce = 0.5 - 0.5 * Math.cos((this.walkT / dur) * Math.PI * 4)
    this.posed[2 * 10 + 1] += bounce * 0.07 * run
  }

  /** Dance samples the bind pose so the idle breath does not play underneath. */
  private pullRest(out: Float32Array, amount: number): void {
    if (amount < 0.001) return
    const nodes = this.parents.length
    for (let i = 0; i < nodes; i++) {
      const o = i * 10
      const keep = 1 - amount
      for (let k = 0; k < 3; k++) out[o + k] = out[o + k] * keep + this.rest[o + k] * amount
      slerp(
        out[o + 3], out[o + 4], out[o + 5], out[o + 6],
        this.rest[o + 3], this.rest[o + 4], this.rest[o + 5], this.rest[o + 6],
        amount, this.quat, 0,
      )
      out[o + 3] = this.quat[0]
      out[o + 4] = this.quat[1]
      out[o + 5] = this.quat[2]
      out[o + 6] = this.quat[3]
      for (let k = 7; k < 10; k++) out[o + k] = out[o + k] * keep + this.rest[o + k] * amount
    }
  }

  private compose(): void {
    this.poseClip(this.idle, this.idleT, this.localA)
    this.pullRest(this.localA, this.danceAmt)
    this.poseClip(this.walk, this.walkT, this.localB)
    const w = this.walkBlend
    const keep = 1 - w
    const nodes = this.parents.length
    for (let i = 0; i < nodes; i++) {
      const o = i * 10
      for (let k = 0; k < 3; k++) this.posed[o + k] = this.localA[o + k] * keep + this.localB[o + k] * w
      slerp(
        this.localA[o + 3], this.localA[o + 4], this.localA[o + 5], this.localA[o + 6],
        this.localB[o + 3], this.localB[o + 4], this.localB[o + 5], this.localB[o + 6],
        w, this.posed, o + 3,
      )
      for (let k = 7; k < 10; k++) this.posed[o + k] = this.localA[o + k] * keep + this.localB[o + k] * w
    }
    this.applyRun()
    const g = this.gestureBlend
    if (g > 0.001) {
      this.localG.set(this.posed)
      this.applyOffsets(this.localG)
      for (let i = 0; i < nodes; i++) {
        const o = i * 10
        const stay = 1 - g
        for (let k = 0; k < 3; k++) this.posed[o + k] = this.posed[o + k] * stay + this.localG[o + k] * g
        slerp(
          this.posed[o + 3], this.posed[o + 4], this.posed[o + 5], this.posed[o + 6],
          this.localG[o + 3], this.localG[o + 4], this.localG[o + 5], this.localG[o + 6],
          g, this.quat, 0,
        )
        this.posed[o + 3] = this.quat[0]
        this.posed[o + 4] = this.quat[1]
        this.posed[o + 5] = this.quat[2]
        this.posed[o + 6] = this.quat[3]
        for (let k = 7; k < 10; k++) this.posed[o + k] = this.posed[o + k] * stay + this.localG[o + k] * g
      }
    }
    if (Math.abs(this.jellyY - 1) > 0.001) {
      const o = 2 * 10
      const sy = this.jellyY
      const sxz = 1 / Math.sqrt(Math.max(0.45, sy))
      this.posed[o + 7] *= sxz
      this.posed[o + 8] *= sy
      this.posed[o + 9] *= sxz
      this.posed[o + 1] += (sy - 1) * 0.32
    }
    for (let i = 0; i < nodes; i++) {
      trsToMat(this.posed, i, this.tmp)
      const parent = this.parents[i]
      if (parent < 0) {
        this.global.set(this.tmp, i * 16)
      } else {
        multiply(this.global.subarray(parent * 16, parent * 16 + 16), this.tmp, this.scratch)
        this.global.set(this.scratch, i * 16)
      }
    }
    for (let j = 0; j < this.jointNodes.length; j++) {
      const node = this.jointNodes[j]
      multiply(this.global.subarray(node * 16, node * 16 + 16), this.ibm.subarray(j * 16, j * 16 + 16), this.scratch)
      this.jointMat.set(this.scratch, j * 16)
    }
    const dst = this.mesh.interleaved
    const count = this.bindPos.length / 3
    const jm = this.jointMat
    for (let v = 0; v < count; v++) {
      const bx = this.bindPos[v * 3]
      const by = this.bindPos[v * 3 + 1]
      const bz = this.bindPos[v * 3 + 2]
      this.swell(bx, by, bz, this.breathMask[v])
      let px = this.swellX
      let py = this.swellY
      let pz = this.swellZ
      const nx0 = this.bindNrm[v * 3] / this.swellS
      const ny0 = this.bindNrm[v * 3 + 1] / this.swellS
      const nz0 = this.bindNrm[v * 3 + 2]
      if (this.mouthMask[v]) {
        const breath = 1 + MOUTH_GROW * this.speakBreath
        const open = Math.sin(this.talkPhase * Math.PI)
        const w = this.talkW
        // Closed is a wide slit. Fully open is a small circle.
        const round = 1.32
        const zTalk = breath * (1 + (0.22 + open * (round - 0.22) - 1) * w)
        const xTalk = breath * (1 + (1.18 + open * (round - 1.18) - 1) * w)
        const dropTalk = 0.003 * w * open
        // Immersed breath stays a circle. It only grows and shrinks with the ring.
        const circle = 1 + MOUTH_GROW * this.breathAmt
        const keep = 1 - w
        const zScale = circle * keep + zTalk * w
        const xScale = circle * keep + xTalk * w
        const yScale = circle * keep + breath * w
        px = this.mouthCx + (bx - this.mouthCx) * xScale
        py = this.mouthCy + (by - this.mouthCy) * yScale - dropTalk * w
        pz = this.mouthCz + (bz - this.mouthCz) * zScale
      }
      let x = 0
      let y = 0
      let z = 0
      let nx = 0
      let ny = 0
      let nz = 0
      for (let k = 0; k < 4; k++) {
        const weight = this.bindWgt[v * 4 + k]
        if (weight <= 0) continue
        const m = this.bindJnt[v * 4 + k] * 16
        x += weight * (jm[m] * px + jm[m + 4] * py + jm[m + 8] * pz + jm[m + 12])
        y += weight * (jm[m + 1] * px + jm[m + 5] * py + jm[m + 9] * pz + jm[m + 13])
        z += weight * (jm[m + 2] * px + jm[m + 6] * py + jm[m + 10] * pz + jm[m + 14])
        nx += weight * (jm[m] * nx0 + jm[m + 4] * ny0 + jm[m + 8] * nz0)
        ny += weight * (jm[m + 1] * nx0 + jm[m + 5] * ny0 + jm[m + 9] * nz0)
        nz += weight * (jm[m + 2] * nx0 + jm[m + 6] * ny0 + jm[m + 10] * nz0)
      }
      const nlen = Math.hypot(nx, ny, nz) || 1
      const o = v * FLOATS
      dst[o] = x
      dst[o + 1] = y
      dst[o + 2] = z
      dst[o + 3] = nx / nlen
      dst[o + 4] = ny / nlen
      dst[o + 5] = nz / nlen
    }
  }
}

export function loadActor(text: string): Actor {
  return new Actor(JSON.parse(text) as ActorFile)
}
