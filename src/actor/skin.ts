import { multiply } from '../gl/math'
import { FLOATS, KIND_ACTOR, type MeshData } from '../scene/mesh'

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

export function actorMatrix(out: Float32Array, x: number, y: number, z: number, yaw: number): void {
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
  out[13] = y + ACTOR_LIFT
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
  private readonly posed: Float32Array
  private readonly global: Float32Array
  private readonly jointMat: Float32Array
  private readonly tmp = new Float32Array(16)
  private readonly scratch = new Float32Array(16)
  private idleT = 0
  private walkT = 0
  private walkBlend = 0

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
    this.posed = new Float32Array(nodes * 10)
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
    this.mesh = {
      interleaved,
      indices: u16(file.idx),
      receiveShadow: false,
      dynamic: true,
    }
    this.compose()
  }

  /**
   * Bind-space point (Blender Z-up) after the chest joint.
   * Eyes sit on the chest, and the highlight discs are not skinned themselves.
   */
  posePoint(x: number, y: number, z: number): { x: number; y: number; z: number } {
    const m = 2 * 16
    const jm = this.jointMat
    return {
      x: jm[m] * x + jm[m + 4] * y + jm[m + 8] * z + jm[m + 12],
      y: jm[m + 1] * x + jm[m + 5] * y + jm[m + 9] * z + jm[m + 13],
      z: jm[m + 2] * x + jm[m + 6] * y + jm[m + 10] * z + jm[m + 14],
    }
  }

  /** `walking` is the Unity Speed gate: true above 0.15, false below 0.12. */
  advance(dt: number, walking: boolean): void {
    const goal = walking ? 1 : 0
    this.walkBlend += (goal - this.walkBlend) * (1 - Math.exp(-dt / 0.12))
    this.idleT += dt
    this.walkT += dt
    this.compose()
  }

  private poseClip(clip: Clip, time: number, out: Float32Array): void {
    out.set(this.rest)
    for (let i = 0; i < clip.tracks.length; i++) {
      const track = clip.tracks[i]
      if (track) sampleTrack(track, time, clip.duration, out, i * 10)
    }
  }

  private compose(): void {
    this.poseClip(this.idle, this.idleT, this.localA)
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
      const px = this.bindPos[v * 3]
      const py = this.bindPos[v * 3 + 1]
      const pz = this.bindPos[v * 3 + 2]
      const nx0 = this.bindNrm[v * 3]
      const ny0 = this.bindNrm[v * 3 + 1]
      const nz0 = this.bindNrm[v * 3 + 2]
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
