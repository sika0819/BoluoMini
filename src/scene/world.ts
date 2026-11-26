/**
 * One meadow, matched to beautiful-wonderland: rolling ground, pond, grass, flowers.
 * Counts are thinned so the meshes stay inside the WebGL index limit.
 */
import {
  fbm2, FOREST_POS, forestAmount, height, HILL_POS, pathDist, pondRadius, SCENE_SPAWN,
  shoreDist, smoothstep, TERRAIN_SIZE, valueNoise2, type SceneKind,
} from './island'
import { campfireClear, campfireLogs } from './campfire'
import {
  Builder, emptyMesh, hash, KIND_PROP, KIND_RAIN, type MeshData, type RGB,
} from './mesh'

export type { MeshData, SceneKind }
export { height, SCENE_SPAWN }

/** Same edge length as the rendered ground quads. */
const TERRAIN_STEP = 4

const GRASS_A: RGB = [0.706, 0.867, 0.322]
const GRASS_B: RGB = [0.455, 0.725, 0.278]
const GRASS_C: RGB = [0.843, 0.875, 0.400]
const GRASS_TIP: RGB = [0.914, 0.961, 0.557]
const WATER_DEEP: RGB = [0.09, 0.34, 0.60]
const LEAF_HI: RGB = [0.902, 0.941, 0.486]
const LEAF_LIGHT: RGB = [0.624, 0.816, 0.322]
const LEAF_MID: RGB = [0.310, 0.616, 0.294]
const LEAF_DARK: RGB = [0.122, 0.314, 0.275]
/** Tube under the bark strokes. A little darker than the strokes, so a gap still reads as wood. */
const BARK_UNDER: RGB = [0.38, 0.27, 0.18]
/** Birch trunk under the strokes. */
const BIRCH_WHITE: RGB = [0.97, 0.96, 0.93]
const WATER_SHALLOW: RGB = [0.42, 0.74, 0.90]
const WATER_MID: RGB = [0.22, 0.55, 0.80]

/** Stem height range, then blossom width, matching the wonderland kinds. */
const FLOWER_HEAD: Array<{ h0: number; h1: number; d0: number; d1: number }> = [
  { h0: 0.34, h1: 0.58, d0: 0.18, d1: 0.26 },
  { h0: 0.18, h1: 0.36, d0: 0.13, d1: 0.18 },
  { h0: 0.28, h1: 0.50, d0: 0.15, d1: 0.22 },
  { h0: 0.50, h1: 0.85, d0: 0.16, d1: 0.22 },
  { h0: 0.17, h1: 0.34, d0: 0.12, d1: 0.16 },
]

const ZONES: Array<[number, number, number, number]> = [
  [58, 12, 70, 1],
  [75, 60, 80, 1],
  [-112, -74, 75, 1],
  [-48, 14, 45, 0.8],
  [88, -58, 55, 0.7],
  [70, -118, 35, 0.5],
]

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function mul(c: RGB, s: number): RGB {
  return [c[0] * s, c[1] * s, c[2] * s]
}

function groundColor(x: number, z: number): RGB {
  // Colour lives on the 4m lattice. Finer noise freezes into one flat square per cell.
  // Two octaves stay near 18m; 31/24 puts that sum back on the old five-octave range.
  const n1 = fbm2(x * 0.028, z * 0.028, 2) * (31 / 24)
  const n2 = valueNoise2(x * 0.0085 + 7.3, z * 0.0085)
  const n3 = valueNoise2(x * 0.04 + 2.1, z * 0.04)
  let c = mix(GRASS_A, GRASS_B, smoothstep(0.36, 0.64, n1))
  c = mix(c, GRASS_C, smoothstep(0.5, 0.78, n2) * 0.6)
  c = mul(c, 0.95 + 0.1 * n3)
  c = mix(c, [GRASS_B[0] * 0.62, GRASS_B[1] * 0.74, GRASS_B[2] * 0.76], forestAmount(x, z) * 0.8)
  const dirt = mix([0.78, 0.72, 0.58], [0.66, 0.64, 0.56], n3)
  const wobble = pathDist(x, z) + (valueNoise2(x * 0.35, z * 0.35) - 0.5) * 1.6
  const path = smoothstep(3.1, 1.5, wobble)
  c = mix(c, dirt, path * 0.42 * (0.55 + 0.45 * smoothstep(0.35, 0.6, n1 + n3 * 0.3)))
  return c
}

class Bag {
  readonly meshes: MeshData[] = []
  private b = new Builder()
  constructor(private shadow: boolean, private side: boolean, private role?: MeshData['role']) {}

  room(extra: number): Builder {
    if (this.b.indexCount + extra > 60000) this.flush()
    return this.b
  }

  flush(): void {
    if (this.b.empty) return
    const mesh = this.b.finish(this.shadow, this.side)
    if (this.role) mesh.role = this.role
    this.meshes.push(mesh)
    this.b = new Builder()
  }

  finish(): MeshData[] {
    this.flush()
    return this.meshes
  }
}

function terrainMeshes(): MeshData[] {
  const step = TERRAIN_STEP
  const half = TERRAIN_SIZE / 2
  const n = half / step
  const out: MeshData[] = []
  for (const x0 of [-half, 0]) {
    for (const z0 of [-half, 0]) {
      const b = new Builder()
      const cols = n + 1
      const span = n + 3
      const h: number[] = []
      for (let j = -1; j <= n + 1; j++) {
        for (let i = -1; i <= n + 1; i++) h.push(height(x0 + i * step, z0 + j * step))
      }
      const at = (i: number, j: number) => h[(j + 1) * span + (i + 1)]
      const ids: number[] = []
      for (let j = 0; j <= n; j++) {
        for (let i = 0; i <= n; i++) {
          const x = x0 + i * step
          const z = z0 + j * step
          const dx = at(i - 1, j) - at(i + 1, j)
          const dz = at(i, j - 1) - at(i, j + 1)
          const ny = 2 * step
          ids.push(b.vertex(x, at(i, j), z, dx, ny, dz, groundColor(x, z), 0))
        }
      }
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = ids[j * cols + i]
          const bv = ids[j * cols + i + 1]
          const c = ids[(j + 1) * cols + i + 1]
          const d = ids[(j + 1) * cols + i]
          b.tri(a, bv, c)
          b.tri(a, c, d)
        }
      }
      const mesh = b.finish(true, true)
      mesh.role = 'ground'
      out.push(mesh)
    }
  }
  return out
}

export interface GroundContact {
  x: number
  y: number
  z: number
  nx: number
  ny: number
  nz: number
}

/** Cell origin on the same 4m lattice the ground mesh uses. */
function cellOrigin(v: number): number {
  const half = TERRAIN_SIZE / 2
  const i = Math.floor((v + half) / TERRAIN_STEP)
  const maxI = Math.floor(TERRAIN_SIZE / TERRAIN_STEP) - 1
  return -half + Math.max(0, Math.min(maxI, i)) * TERRAIN_STEP
}

interface GroundCell {
  xa: number
  za: number
  xb: number
  zb: number
  y00: number
  y10: number
  y11: number
  y01: number
  u: number
  v: number
}

/** Quad corners match terrainMeshes: a, b, c, d with diagonal a–c. */
function groundCell(x: number, z: number): GroundCell {
  const xa = cellOrigin(x)
  const za = cellOrigin(z)
  const xb = xa + TERRAIN_STEP
  const zb = za + TERRAIN_STEP
  const u = Math.max(0, Math.min(1, (x - xa) / TERRAIN_STEP))
  const v = Math.max(0, Math.min(1, (z - za) / TERRAIN_STEP))
  return {
    xa, za, xb, zb,
    y00: height(xa, za),
    y10: height(xb, za),
    y11: height(xb, zb),
    y01: height(xa, zb),
    u, v,
  }
}

function upward(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): [number, number, number] {
  const ux = bx - ax
  const uy = by - ay
  const uz = bz - az
  const vx = cx - ax
  const vy = cy - ay
  const vz = cz - az
  let nx = uy * vz - uz * vy
  let ny = uz * vx - ux * vz
  let nz = ux * vy - uy * vx
  if (ny < 0) {
    nx = -nx
    ny = -ny
    nz = -nz
  }
  const len = Math.hypot(nx, ny, nz) || 1
  return [nx / len, ny / len, nz / len]
}

/** Height on the rendered triangle, not the smooth height field. */
export function groundHeight(x: number, z: number): number {
  const c = groundCell(x, z)
  if (c.u >= c.v) return c.y00 * (1 - c.u) + c.y10 * (c.u - c.v) + c.y11 * c.v
  return c.y00 * (1 - c.v) + c.y11 * c.u + c.y01 * (c.v - c.u)
}

/** Contact on the ground triangle under (x, z), with an upward unit normal. */
export function groundContact(x: number, z: number): GroundContact {
  const c = groundCell(x, z)
  const px = c.xa + c.u * TERRAIN_STEP
  const pz = c.za + c.v * TERRAIN_STEP
  if (c.u >= c.v) {
    const [nx, ny, nz] = upward(c.xa, c.y00, c.za, c.xb, c.y10, c.za, c.xb, c.y11, c.zb)
    return {
      x: px,
      y: c.y00 * (1 - c.u) + c.y10 * (c.u - c.v) + c.y11 * c.v,
      z: pz,
      nx, ny, nz,
    }
  }
  const [nx, ny, nz] = upward(c.xa, c.y00, c.za, c.xb, c.y11, c.zb, c.xa, c.y01, c.zb)
  return {
    x: px,
    y: c.y00 * (1 - c.v) + c.y11 * c.u + c.y01 * (c.v - c.u),
    z: pz,
    nx, ny, nz,
  }
}

interface Wet {
  x: number
  z: number
  h: number
  color: RGB
  depth: number
}

/** Water stops where the ground rises through the surface, the same test as the reference pond. */
function waterMesh(): MeshData {
  const b = new Builder()
  const step = 4
  const reach = 92
  const y = 0.03
  const line = 0.02
  const tone = (px: number, pz: number, h: number): Wet => {
    const sd = shoreDist(px, pz)
    const color = sd > -6 ? WATER_SHALLOW : sd > -18 ? WATER_MID : WATER_DEEP
    return { x: px, z: pz, h, color, depth: Math.max(0, line - h) }
  }
  const cut = (a: Wet, c: Wet): Wet => {
    const t = (line - a.h) / (c.h - a.h)
    return {
      x: a.x + (c.x - a.x) * t,
      z: a.z + (c.z - a.z) * t,
      h: line,
      color: mix(a.color, c.color, t),
      depth: 0,
    }
  }
  const keepWet = (poly: Wet[]): Wet[] => {
    const out: Wet[] = []
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]
      const c = poly[(i + 1) % poly.length]
      const aIn = a.h <= line
      const cIn = c.h <= line
      if (aIn && cIn) out.push(c)
      else if (aIn && !cIn) out.push(cut(a, c))
      else if (!aIn && cIn) {
        out.push(cut(a, c))
        out.push(c)
      }
    }
    return out
  }
  for (let z = -reach; z < reach; z += step) {
    for (let x = -reach; x < reach; x += step) {
      const cx = x + step * 0.5
      const cz = z + step * 0.5
      if (shoreDist(cx, cz) > 7) continue
      const raw = [
        tone(x, z, height(x, z)),
        tone(x + step, z, height(x + step, z)),
        tone(x + step, z + step, height(x + step, z + step)),
        tone(x, z + step, height(x, z + step)),
      ]
      if (Math.min(raw[0].h, raw[1].h, raw[2].h, raw[3].h) > line) continue
      const poly = keepWet(raw)
      if (poly.length < 3) continue
      for (let i = 1; i < poly.length - 1; i++) {
        const p0 = poly[0]
        const p1 = poly[i]
        const p2 = poly[i + 1]
        const area = (p1.x - p0.x) * (p2.z - p0.z) - (p2.x - p0.x) * (p1.z - p0.z)
        if (Math.abs(area) < 0.05) continue
        const i0 = b.vertex(p0.x, y, p0.z, 0, 1, 0, p0.color, 1, p0.depth, 0)
        b.vertex(p1.x, y, p1.z, 0, 1, 0, p1.color, 1, p1.depth, 0)
        b.vertex(p2.x, y, p2.z, 0, 1, 0, p2.color, 1, p2.depth, 0)
        b.tri(i0, i0 + 1, i0 + 2)
      }
    }
  }
  const mesh = b.empty ? emptyMesh() : b.finish(false, false)
  mesh.reflect = false
  return mesh
}

function zoneDensity(x: number, z: number): number {
  const r0 = Math.hypot(x, z)
  let d = 0.12 * (1 - smoothstep(215, 260, r0))
  for (const [zx, zz, radius, w] of ZONES) {
    const r = Math.hypot(x - zx, z - zz)
    if (r < radius) d = Math.max(d, w * (1 - smoothstep(radius * 0.6, radius, r)))
  }
  return d
}

function tuftWeight(x: number, z: number): number {
  if (campfireClear(x, z)) return 0
  const d = zoneDensity(x, z)
  if (d <= 0 || height(x, z) < 0.06) return 0
  if (onJetty(x, z)) return 0
  const sd = Math.hypot(x, z) > 86 ? 99 : shoreDist(x, z)
  if (sd < 0.3) return 0
  let w = d * (0.35 + 0.65 * smoothstep(0.5, 3.2, sd))
  const pd = pathDist(x, z)
  w *= 0.15 + 0.85 * smoothstep(2.0, 4.2, pd)
  const forest = Math.hypot(x - FOREST_POS.x, z - FOREST_POS.z) > FOREST_POS.r + 26 ? 0 : forestAmount(x, z)
  w *= 1 - 0.65 * forest
  const m = 0.42 * fbm2(x * 0.07 + 5.3, z * 0.07 + 9.1, 3) / 0.875
    + 0.58 * valueNoise2(x * 0.4 + 1.7, z * 0.4 + 7.9)
  return w * (0.08 + 0.92 * smoothstep(0.37, 0.53, m))
}

/** A grass flick: one upright brush stroke, foot and tip keep the colours already on the blade. */
function addFlick(b: Builder, x: number, y: number, z: number, tall: number, wide: number, foot: RGB, tip: RGB, cell: number, flip: boolean): void {
  const hy = tall * 0.62
  b.stroke(x, y + hy * 0.8, z, wide, hy, foot, tip, cell, flip)
}

function grassMeshes(): MeshData[] {
  const bag = new Bag(false, true)
  const step = 1.7
  const extent = 250
  const n = Math.floor((extent * 2) / step)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -extent + (i + 0.5) * step
      const z = -extent + (j + 0.5) * step
      const w = tuftWeight(x, z)
      if (w < 0.1 || hash(x, z) > Math.min(0.7, w * 0.95)) continue
      const y = height(x, z)
      const g = groundColor(x, z)
      const foot = mul(mix(g, [g[0] * 0.68, g[1] * 0.83, g[2] * 0.9], 0.65), 0.92 + hash(x + 3, z) * 0.12)
      const tip = mix(g, GRASS_TIP, 0.62 + hash(x, z + 4) * 0.2)
      const tall = (0.22 + 0.26 * valueNoise2(x * 0.035 + 40.5, z * 0.035 + 17.3)) * (0.85 + hash(x + 1, z + 1) * 0.3)
      const yaw0 = hash(x + 8, z + 2) * Math.PI * 2
      const b = bag.room(12)
      for (let k = 0; k < 2; k++) {
        const a = yaw0 + k * 2.1
        const rr = 0.05 + hash(x + k * 3, z - k) * 0.12
        const cell = hash(x + k * 5, z + 9) > 0.84 ? 3 : k
        addFlick(
          b, x + Math.cos(a) * rr, y, z + Math.sin(a) * rr,
          tall * (0.72 + hash(x + k, z) * 0.45),
          0.12 + hash(z, x + k) * 0.05,
          foot, tip, cell, hash(x + 4, z + k) > 0.5,
        )
      }
    }
  }
  for (let i = 0; i < 90; i++) {
    const th = (i / 90) * Math.PI * 2
    const r = pondRadius(th) + 1.1 + hash(i, 3) * 2.4
    const x = Math.cos(th) * r
    const z = Math.sin(th) * r
    if (height(x, z) < 0.05) continue
    const y = height(x, z)
    const b = bag.room(12)
    const foot: RGB = [0.20, 0.38, 0.22]
    const tip: RGB = [0.55, 0.72, 0.32]
    addFlick(b, x, y, z, 1.15 + hash(x, i) * 0.45, 0.055, foot, tip, 0, false)
    addFlick(b, x + 0.12, y, z + 0.06, 0.95, 0.05, foot, tip, 2, true)
  }
  return bag.finish()
}

function flowerWeights(x: number, z: number, out: number[]): number {
  out[0] = out[1] = out[2] = out[3] = out[4] = 0
  if (campfireClear(x, z)) return 0
  if (Math.hypot(x, z) > 250) return 0
  const sd = Math.hypot(x, z) > 86 ? 99 : shoreDist(x, z)
  if (sd < 0.6 || height(x, z) < 0.08) return 0
  if (onJetty(x, z)) return 0
  const forest = Math.hypot(x - FOREST_POS.x, z - FOREST_POS.z) > FOREST_POS.r + 20 ? 0 : forestAmount(x, z)
  const mods = (0.08 + 0.92 * smoothstep(2.2, 4.4, pathDist(x, z))) * (1 - 0.8 * forest)
  const meadow = 1 - smoothstep(46, 88, Math.hypot(x - 75, z - 60))
  const shore = smoothstep(0.6, 2.5, sd) * (1 - smoothstep(7, 17, sd))
  const wM = Math.max(meadow, shore * 0.75)
  if (wM > 0) {
    out[0] = wM * (0.2 + 0.8 * smoothstep(0.48, 0.66, fbm2(x * 0.06 + 31, z * 0.06 + 7, 3)))
    out[1] = wM * (0.25 + 0.75 * smoothstep(0.45, 0.63, fbm2(x * 0.075 + 71, z * 0.075 + 53, 3)))
  }
  const hill = 1 - smoothstep(52, 94, Math.hypot(x + 112, z + 74))
  if (hill > 0) {
    out[2] = hill * (0.25 + 0.75 * smoothstep(0.48, 0.65, fbm2(x * 0.065 + 13, z * 0.065 + 91, 3)))
    out[3] = hill * (0.18 + 0.7 * smoothstep(0.5, 0.66, fbm2(x * 0.08 + 57, z * 0.08 + 23, 3)))
    out[4] = hill * (0.25 + 0.75 * smoothstep(0.48, 0.64, fbm2(x * 0.07 + 83, z * 0.07 + 37, 3)))
  }
  out[1] += 0.08
  out[4] += 0.08
  let s = 0
  for (let k = 0; k < 5; k++) {
    out[k] *= mods
    s += out[k]
  }
  return s
}

function addFlower(b: Builder, x: number, z: number, kind: number): void {
  const y = height(x, z)
  const tall = valueNoise2(x * 0.035 + 40.5, z * 0.035 + 17.3)
  const up = 0.8 + 0.3 * tall
  const spec = FLOWER_HEAD[kind]
  const H = (spec.h0 + (spec.h1 - spec.h0) * hash(x + 2, z)) * up
  const width = spec.d0 + (spec.d1 - spec.d0) * hash(z, x + 3)
  if (kind === 3) {
    b.flowerStem(x, y, z, H, kind)
    b.blossom(x, y, z, width * 0.55 * 0.5, H * 0.97, kind)
    b.blossom(x, y, z, width * 0.74 * 0.5, H * 0.85, kind)
    b.blossom(x, y, z, width * 0.9 * 0.5, H * 0.72, kind)
    b.blossom(x, y, z, width * 0.5, H * 0.58, kind)
    return
  }
  b.flowerStem(x, y, z, H, kind)
  b.blossom(x, y, z, width * 0.5, H, kind)
}

function flowerMeshes(): MeshData[] {
  const bag = new Bag(false, true)
  const step = 2.15
  const extent = 230
  const n = Math.floor((extent * 2) / step)
  const weights = [0, 0, 0, 0, 0]
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = -extent + (i + 0.5) * step
      const z = -extent + (j + 0.5) * step
      const sum = flowerWeights(x, z, weights)
      if (sum < 0.16 || hash(x + 19, z + 4) > Math.min(0.46, sum * 0.34)) continue
      let pick = hash(x + 1, z + 9) * sum
      let kind = 0
      for (let k = 0; k < 5; k++) {
        pick -= weights[k]
        if (pick <= 0) { kind = k; break }
      }
      addFlower(bag.room(kind === 3 ? 126 : 36), x + (hash(x, z + 5) - 0.5) * 0.8, z + (hash(z, x + 5) - 0.5) * 0.8, kind)
    }
  }
  return bag.finish()
}

/** East-shore walk, stopped halfway across the pond. No boarding platform. */
const JETTY = { x0: 66.2, x1: 38.4, z: 8, y: 0.62 }

function onJetty(x: number, z: number): boolean {
  return x < JETTY.x0 + 1.5 && x > JETTY.x1 - 1 && z > JETTY.z - 1.8 && z < JETTY.z + 1.8
}

function addAabb(
  b: Builder,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  color: RGB,
): void {
  const x0 = cx - hx, x1 = cx + hx
  const y0 = cy, y1 = cy + hy
  const z0 = cz - hz, z1 = cz + hz
  const quad = (
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx2: number, cy2: number, cz2: number,
    dx: number, dy: number, dz: number,
  ) => b.quad(ax, ay, az, bx, by, bz, cx2, cy2, cz2, dx, dy, dz, color, KIND_PROP, cx, cy + hy * 0.5, cz)
  quad(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0)
  quad(x1, y0, z1, x0, y0, z1, x0, y1, z1, x1, y1, z1)
  quad(x0, y0, z1, x0, y0, z0, x0, y1, z0, x0, y1, z1)
  quad(x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0)
  quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1)
  quad(x0, y0, z1, x1, y0, z1, x1, y0, z0, x0, y0, z0)
}

function addBeam(
  b: Builder,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  w: number, h: number,
  color: RGB,
): void {
  let dx = bx - ax, dy = by - ay, dz = bz - az
  const len = Math.hypot(dx, dy, dz) || 1
  dx /= len; dy /= len; dz /= len
  let hx = 0, hy = 1, hz = 0
  if (Math.abs(dy) > 0.92) { hx = 1; hy = 0; hz = 0 }
  let sx = hy * dz - hz * dy
  let sy = hz * dx - hx * dz
  let sz = hx * dy - hy * dx
  const sl = Math.hypot(sx, sy, sz) || 1
  sx /= sl; sy /= sl; sz /= sl
  const vx = dy * sz - dz * sy
  const vy = dz * sx - dx * sz
  const vz = dx * sy - dy * sx
  const hw = w * 0.5
  const hh = h * 0.5
  const p = (t: number, su: number, vu: number): [number, number, number] => [
    ax + dx * len * t + sx * su + vx * vu,
    ay + dy * len * t + sy * su + vy * vu,
    az + dz * len * t + sz * su + vz * vu,
  ]
  const c = [
    p(0, -hw, -hh), p(0, hw, -hh), p(0, hw, hh), p(0, -hw, hh),
    p(1, -hw, -hh), p(1, hw, -hh), p(1, hw, hh), p(1, -hw, hh),
  ]
  const mx = (ax + bx) * 0.5
  const my = (ay + by) * 0.5
  const mz = (az + bz) * 0.5
  const faces: Array<[number, number, number, number]> = [
    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [3, 2, 6, 7], [0, 4, 5, 1],
  ]
  for (const f of faces) {
    const a = c[f[0]], d = c[f[1]], e = c[f[2]], g = c[f[3]]
    b.quad(a[0], a[1], a[2], d[0], d[1], d[2], e[0], e[1], e[2], g[0], g[1], g[2], color, KIND_PROP, mx, my, mz)
  }
}

function jettyMesh(): MeshData {
  const b = new Builder()
  const { x0, x1, z, y } = JETTY
  const postC: RGB = [0.36, 0.27, 0.21]
  for (let x = x0; x > x1 + 0.4; x -= 0.95) {
    const r = hash(x, z + 1)
    if (r < 0.06) continue
    let len = 2.32 + (hash(x, z + 2) - 0.5) * 0.16
    let off = (hash(x, z + 3) - 0.5) * 0.1
    if (r > 0.92) {
      len = 1.05
      off = (hash(x, z + 4) < 0.5 ? -1 : 1) * 0.55
    }
    const tone = mul(mix(WOOD_GREY, [0.42, 0.33, 0.27], hash(x, z)), 0.9 + hash(x + 4, z) * 0.18)
    addAabb(b, x - 0.4, y - 0.06 + (hash(x, z + 5) - 0.5) * 0.03, z + off, 0.38, 0.11, len * 0.5, tone)
  }
  for (const sz of [-0.82, 0.82]) {
    addAabb(b, (x0 + x1) * 0.5, y - 0.2, z + sz, (x0 - x1) * 0.47, 0.08, 0.08, postC)
  }
  const posts: number[] = []
  for (let x = 64; x > x1; x -= 7) posts.push(x)
  posts.push(x1 + 0.6)
  for (const x of posts) {
    for (const sz of [-1.12, 1.12]) {
      const lean = Math.sign(sz) * 0.12
      const foot = Math.min(-1.45, height(x, z + sz) - 0.3)
      addBeam(b, x, foot, z + sz, x + lean, y - 0.1, z + sz + lean, 0.13, 0.12, postC)
    }
    addAabb(b, x, y - 0.24, z, 0.11, 0.14, 1.2, postC)
  }
  return b.finish(true, false)
}

const WOOD_GREY: RGB = [0.545, 0.49, 0.42]

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BEECH = 0
const BIRCH = 1
const OAK = 2

function nrm(x: number, y: number, z: number): [number, number, number] {
  const l = Math.hypot(x, y, z)
  if (l < 1e-5) return [0, 1, 0]
  return [x / l, y / l, z / l]
}

function cross(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
}

/**
 * Bark strokes on a tube. Each one runs along the grain.
 * Birch sits on the centre of the trunk, so the stroke is only a little wider than the wood.
 * alongOf and acrossOf are full sizes in metres.
 */
function coatTube(
  b: Builder,
  pts: Array<[number, number, number]>,
  radii: number[],
  species: number,
  rand: () => number,
  marks: number,
  alongOf: (r: number) => number,
  acrossOf: (r: number) => number,
  bands: boolean,
): void {
  if (pts.length < 2 || marks < 1) return
  const span = pts.length - 1
  for (let n = 0; n < marks; n++) {
    const u = Math.pow(rand(), bands ? 1.05 : species === BIRCH ? 1 : 1.25) * 0.98
    const f = u * span
    const i = Math.min(span - 1, Math.floor(f))
    const t = f - i
    const p0 = pts[i]
    const p1 = pts[i + 1]
    const c: [number, number, number] = [
      p0[0] + (p1[0] - p0[0]) * t,
      p0[1] + (p1[1] - p0[1]) * t,
      p0[2] + (p1[2] - p0[2]) * t,
    ]
    const r = radii[i] + (radii[Math.min(i + 1, radii.length - 1)] - radii[i]) * t
    const axis = nrm(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2])
    const ax = Math.abs(axis[1]) < 0.9 ? 0 : 1
    const ay = Math.abs(axis[1]) < 0.9 ? 1 : 0
    const ref = nrm(ax, ay, 0.15)
    const dot = ref[0] * axis[0] + ref[1] * axis[1] + ref[2] * axis[2]
    const side = nrm(ref[0] - axis[0] * dot, ref[1] - axis[1] * dot, ref[2] - axis[2] * dot)
    const bin = nrm(...cross(axis, side))
    const ang = rand() * Math.PI * 2
    const ca = Math.cos(ang)
    const sa = Math.sin(ang)
    const radial = nrm(
      side[0] * ca + bin[0] * sa,
      side[1] * ca + bin[1] * sa,
      side[2] * ca + bin[2] * sa,
    )
    let dir = bands ? nrm(...cross(axis, radial)) : axis
    const spin = (rand() - 0.5) * (bands ? 0.5 : species === BIRCH ? 0.06 : 0.28)
    const cs = Math.cos(spin)
    const sn = Math.sin(spin)
    const bent = cross(radial, dir)
    dir = nrm(dir[0] * cs + bent[0] * sn, dir[1] * cs + bent[1] * sn, dir[2] * cs + bent[2] * sn)
    const skin = species === BIRCH ? 0.012 : r
    b.barkDab(
      c[0] + radial[0] * skin,
      c[1] + radial[1] * skin,
      c[2] + radial[2] * skin,
      radial[0], radial[1], radial[2],
      dir[0], dir[1], dir[2],
      acrossOf(r) * 0.5,
      alongOf(r) * 0.5,
      species,
    )
  }
}

/** Tapered pipe. The frame is carried along it so the tube does not twist. */
function addTube(
  b: Builder,
  pts: Array<[number, number, number]>,
  radii: number[],
  sides: number,
  color: RGB,
): void {
  let ref = nrm(1, 0, 0.3)
  const rings: number[][] = []
  for (let i = 0; i < pts.length; i++) {
    const i0 = Math.max(i - 1, 0)
    const i1 = Math.min(i + 1, pts.length - 1)
    let tx = pts[i1][0] - pts[i0][0]
    let ty = pts[i1][1] - pts[i0][1]
    let tz = pts[i1][2] - pts[i0][2]
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl; ty /= tl; tz /= tl
    const dot = ref[0] * tx + ref[1] * ty + ref[2] * tz
    let nx = ref[0] - tx * dot
    let ny = ref[1] - ty * dot
    let nz = ref[2] - tz * dot
    let nl = Math.hypot(nx, ny, nz)
    if (nl < 1e-5) {
      const ax = Math.abs(ty) < 0.9 ? 0 : 1
      const ay = Math.abs(ty) < 0.9 ? 1 : 0
      const ad = ax * tx + ay * ty
      nx = ax - tx * ad
      ny = ay - ty * ad
      nz = -tz * ad
      nl = Math.hypot(nx, ny, nz) || 1
    }
    nx /= nl; ny /= nl; nz /= nl
    ref = [nx, ny, nz]
    const bx = ty * nz - tz * ny
    const by = tz * nx - tx * nz
    const bz = tx * ny - ty * nx
    const ids: number[] = []
    const rad = radii[i]
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2
      const c = Math.cos(a)
      const sn = Math.sin(a)
      const nnx = nx * c + bx * sn
      const nny = ny * c + by * sn
      const nnz = nz * c + bz * sn
      ids.push(b.vertex(
        pts[i][0] + nnx * rad, pts[i][1] + nny * rad, pts[i][2] + nnz * rad,
        nnx, nny, nnz, color, KIND_PROP,
      ))
    }
    rings.push(ids)
  }
  for (let i = 0; i < pts.length - 1; i++) {
    for (let s = 0; s < sides; s++) {
      const s1 = (s + 1) % sides
      b.tri(rings[i][s], rings[i][s1], rings[i + 1][s])
      b.tri(rings[i][s1], rings[i + 1][s1], rings[i + 1][s])
    }
  }
}

function bezier(
  p0: [number, number, number],
  p1: [number, number, number],
  p2: [number, number, number],
  u: number,
): [number, number, number] {
  const w = 1 - u
  return [
    p0[0] * w * w + p1[0] * 2 * w * u + p2[0] * u * u,
    p0[1] * w * w + p1[1] * 2 * w * u + p2[1] * u * u,
    p0[2] * w * w + p1[2] * 2 * w * u + p2[2] * u * u,
  ]
}

function crownColor(up: number, roll: number, family: number): RGB {
  const palette = [LEAF_MID, LEAF_LIGHT, LEAF_DARK, LEAF_HI]
  let c = palette[family] ?? LEAF_MID
  if (roll < 0.14) c = palette[(family + 1 + Math.floor(roll * 17)) % 4]
  if (up > 0.5) c = mix(c, LEAF_HI, 0.62)
  else if (up < 0.05) c = mix(c, LEAF_DARK, 0.5)
  return c
}

/** One lobe of the autumn crown: strokes on the shell, and two dark touches inside. */
function addLobe(
  b: Builder,
  lx: number, ly: number, lz: number, lr: number,
  crown: [number, number, number],
  family: number,
  rand: () => number,
  dabs: number,
): void {
  const away = nrm(lx - crown[0], ly - crown[1], lz - crown[2])
  for (let n = 0; n < dabs; n++) {
    const raw = nrm(rand() - 0.5, rand() - 0.5, rand() - 0.5)
    const d = nrm(raw[0] + away[0] * 0.5, raw[1] + away[1] * 0.5 + 0.15, raw[2] + away[2] * 0.5)
    const reach = lr * (0.72 + rand() * 0.4)
    const px = lx + d[0] * reach
    const py = ly + d[1] * reach
    const pz = lz + d[2] * reach
    const radial = nrm(px - crown[0], py - crown[1], pz - crown[2])
    const normal = nrm(
      d[0] * 0.6 + radial[0] * 0.55,
      d[1] * 0.6 + radial[1] * 0.55,
      d[2] * 0.6 + radial[2] * 0.55,
    )
    const size = lr * 0.34 * (1 + rand() * 0.6)
    const aspect = 1.5 + rand() * 0.5
    b.dab(px, py, pz, normal[0], normal[1], normal[2], size * 0.5, size * aspect * 0.5, crownColor(normal[1], rand(), family))
  }
  for (let k = 0; k < 2; k++) {
    const hx = lr * 0.42
    b.dab(
      lx + (rand() - 0.5) * lr * 0.5,
      ly - lr * 0.15 * k,
      lz + (rand() - 0.5) * lr * 0.5,
      0, -1, 0, hx, hx * 1.2, LEAF_DARK,
    )
  }
}

/**
 * Autumn-wood tree, kept in this meadow's greens and bark.
 * The trunk is a dark tube with strokes along the grain. Limbs curl out.
 * The crown is lobes of long brush dabs.
 * `scale` is the old size knob: 1 is a full beech, a bush is the low understorey.
 */
function addTree(b: Builder, x: number, z: number, scale: number, bush = false): void {
  const y = height(x, z)
  const rand = rng((Math.floor(hash(x, z) * 1e9) ^ Math.floor(hash(z + 3, x) * 1e9)) >>> 0 || 1)
  if (bush) {
    const tall = (1.15 + rand() * rand() * 2.4) * scale
    const family = rand() < 0.4 ? 2 : rand() < 0.7 ? 0 : 1
    const n = 3 + Math.floor(rand() * 3)
    for (let i = 0; i < n; i++) {
      const lx = x + (rand() - 0.5) * tall * 0.9
      const ly = y + tall * (0.45 + rand() * 0.55)
      const lz = z + (rand() - 0.5) * tall * 0.9
      const lr = (0.38 + rand() * 0.42) * scale
      const dir = nrm(lx - x, ly - y, lz - z)
      const stem: Array<[number, number, number]> = [
        [x, y, z],
        [x + dir[0] * tall * 0.55, y + tall * 0.55, z + dir[2] * tall * 0.55],
      ]
      const stemR = [0.03 * scale, 0.015 * scale]
      addTube(b, stem, stemR, 4, BARK_UNDER)
      coatTube(b, stem, stemR, 0, rand, 3, () => tall * 0.62, () => 0.05 * scale, false)
      addLobe(b, lx, ly, lz, lr, [x, y + tall * 0.4, z], family, rand, 8)
    }
    return
  }
  const stand = hash(x * 0.21, z * 0.17)
  const type = scale > 1.25 ? OAK : stand > 0.72 ? BIRCH : stand > 0.56 ? OAK : BEECH
  const k = 0.5 * scale
  const r0 = (type === BIRCH ? 0.13 + rand() * 0.08 : type === OAK ? 0.62 + rand() * 0.25 : 0.28 + rand() * rand() * 0.4) * k
  const h = (type === BIRCH ? 16 + rand() * 5 : type === OAK ? 18 + rand() * 4 : 22 + rand() * 6) * k
  const family = type === BIRCH ? 1 : type === OAK ? 0 : rand() < 0.55 ? 0 : 2
  const lean: [number, number] = [(rand() - 0.5) * 0.09, (rand() - 0.5) * 0.09]
  const seed = rand() * 6
  const rings = 7
  const top = h * (type === BIRCH ? 0.95 : 0.8)
  const pts: Array<[number, number, number]> = []
  const radii: number[] = []
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1)
    const yy = u * u * 0.4 + u * 0.6
    const bend = Math.sin(u * 2.4 + seed) * 0.25 * (type === BIRCH ? 1.6 : 1)
    pts.push([
      x + lean[0] * yy * top + bend * lean[1] * 8 * k,
      y - 0.3 * k + yy * (top + 0.3 * k),
      z + lean[1] * yy * top - bend * lean[0] * 8 * k,
    ])
    radii.push(r0 * (1 - 0.6 * yy) * (1 + 0.5 * Math.exp(-(yy * top) / (0.35 * k + r0 * 0.6))))
  }
  addTube(b, pts, radii, 6, type === BIRCH ? BIRCH_WHITE : BARK_UNDER)
  coatTube(
    b, pts, radii, type, rand,
    type === BIRCH ? 64 : Math.round(40 + radii[0] * 70),
    (r) => type === BIRCH ? 0.7 + rand() * 0.6 : 1.2 + rand() * 1.8,
    (r) => type === BIRCH ? r * 4.2 : Math.min(0.46, Math.max(0.12, r * 0.9)),
    false,
  )
  const trunkAt = (hgt: number): { p: [number, number, number]; r: number } => {
    let i = 0
    while (i < rings - 2 && pts[i + 1][1] - y < hgt) i++
    const span = pts[i + 1][1] - pts[i][1] || 1
    const t = Math.max(0, Math.min(1, (hgt - (pts[i][1] - y)) / span))
    return {
      p: [
        pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
        pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t,
        pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t,
      ],
      r: radii[i] + (radii[i + 1] - radii[i]) * t,
    }
  }
  const crown: [number, number, number] = [
    x + lean[0] * top,
    y + h * (type === OAK ? 0.7 : 0.8),
    z + lean[1] * top,
  ]
  const spread = (type === OAK ? 7.4 : type === BIRCH ? 2.7 + rand() : 4.2 + rand() * 1.6 + (r0 / k) * 2) * k
  const limbs = type === BIRCH ? 4 : type === OAK ? 6 : 5
  const lobes: Array<[number, number, number, number]> = []
  for (let i = 0; i < limbs; i++) {
    const a = (i / limbs) * Math.PI * 2 + rand() * 1.2
    const from = top * (0.48 + 0.42 * (i / limbs))
    const base = trunkAt(from)
    const tilt = type === BIRCH ? 0.35 : type === OAK ? 0.7 + rand() * 0.35 : 0.48 + rand() * 0.4
    const len = (spread / Math.sin(tilt)) * (0.7 + rand() * 0.4) * (1 - 0.35 * (i / limbs))
    const ox = Math.cos(a)
    const oz = Math.sin(a)
    const p0 = base.p
    const p2: [number, number, number] = [
      p0[0] + ox * len * Math.sin(tilt),
      p0[1] + len * Math.cos(tilt),
      p0[2] + oz * len * Math.sin(tilt),
    ]
    const p1: [number, number, number] = [
      p0[0] + (p2[0] - p0[0]) * 0.45 + ox * len * 0.12,
      p0[1] + (p2[1] - p0[1]) * 0.45 - len * 0.1,
      p0[2] + (p2[2] - p0[2]) * 0.45 + oz * len * 0.12,
    ]
    const lp: Array<[number, number, number]> = []
    const lrads: number[] = []
    for (let s = 0; s <= 4; s++) {
      const u = s / 4
      lp.push(bezier(p0, p1, p2, u))
      lrads.push(Math.max(0.028 * k, base.r * 0.5 * (1 - 0.82 * u)))
    }
    addTube(b, lp, lrads, 5, type === BIRCH ? BIRCH_WHITE : BARK_UNDER)
    coatTube(
      b, lp, lrads, type, rand, type === OAK ? 8 : 5,
      () => type === BIRCH ? 0.35 + rand() * 0.4 : 0.75 + rand() * 1.05,
      (r) => type === BIRCH ? r * 4.2 : Math.max(0.06, r * 2.4),
      false,
    )
    for (const u of type === OAK ? [0.55, 0.78, 1] : [0.72, 1]) {
      const c = bezier(p0, p1, p2, u)
      c[0] += (rand() - 0.5) * 1.6 * k
      c[1] += rand() * 0.9 * k
      c[2] += (rand() - 0.5) * 1.6 * k
      lobes.push([c[0], c[1], c[2], (1.25 + rand()) * k + r0 * 0.6])
    }
  }
  for (let i = 0; i < 3; i++) {
    lobes.push([
      crown[0] + (rand() - 0.5) * spread * 0.9,
      y + h * 0.96 + (rand() - 0.5) * 3 * k,
      crown[2] + (rand() - 0.5) * spread * 0.9,
      (1.5 + rand() * 0.9) * k,
    ])
  }
  for (const lobe of lobes) addLobe(b, lobe[0], lobe[1], lobe[2], lobe[3], crown, family, rand, 16)
}

function treeMeshes(): MeshData[] {
  const bag = new Bag(true, true, 'tree')
  addTree(bag.room(9000), HILL_POS.x, HILL_POS.z, 1.35)
  const rand = rng(4021)
  const trees: Array<[number, number]> = [[72.3, -109.7], [77.6, -112]]
  const open = (x: number, z: number) => Math.hypot(x - 70, z + 118) < 9.3 || Math.hypot(x - 66.5, z + 111.4) < 8.2
  for (let i = 0; i < 9000 && trees.length < 72; i++) {
    const x = FOREST_POS.x + (rand() * 2 - 1) * 90
    const z = FOREST_POS.z + (rand() * 2 - 1) * 90
    if (forestAmount(x, z) <= 0.5 || open(x, z) || shoreDist(x, z) < 6 || pathDist(x, z) < 5) continue
    let ok = true
    for (const p of trees) {
      if (Math.hypot(p[0] - x, p[1] - z) < 8.2) { ok = false; break }
    }
    if (ok) trees.push([x, z])
  }
  for (const [x, z] of trees) addTree(bag.room(9000), x, z, 0.9 + rand() * 0.35)
  const spots: Array<[number, number]> = [
    [-28, -88], [-40, -96], [-62, 78], [-74, 88], [112, 40], [122, 28], [20, 100], [35, 112],
    [-150, 120], [-60, -150], [150, -10], [140, 90],
  ]
  for (const [x, z] of spots) {
    if (shoreDist(x, z) < 8 || pathDist(x, z) < 6 || forestAmount(x, z) > 0.2) continue
    if (Math.hypot(x - HILL_POS.x, z - HILL_POS.z) < 40) continue
    addTree(bag.room(9000), x, z, 0.85 + hash(x, z) * 0.3)
  }
  for (let i = 0; i < 28; i++) {
    const th = rand() * Math.PI * 2
    const r = pondRadius(th) + 4.2 + rand() * 3.5
    const x = Math.cos(th) * r
    const z = Math.sin(th) * r
    if (shoreDist(x, z) < 3.2 || pathDist(x, z) < 4) continue
    addTree(bag.room(1200), x, z, 0.7 + rand() * 0.45, true)
  }
  return bag.finish()
}

interface Lily {
  x: number
  z: number
  r: number
  rot: number
  flower: number
  squash: number
}

/** Shore drifts from the wonderland pond, kept off the jetty. */
function placeLilies(): Lily[] {
  const rand = rng(90210)
  const range = (a: number, b: number) => a + rand() * (b - a)
  const pads: Lily[] = []
  const target = 96
  const clear = (x: number, z: number, r: number) => {
    if (shoreDist(x, z) > -1.1 - r || height(x, z) > -0.05) return false
    if (x > JETTY.x1 - 2 && x < JETTY.x0 + 3 && Math.abs(z - JETTY.z) < 1.5 + r) return false
    for (const p of pads) {
      const dx = p.x - x
      const dz = p.z - z
      const rr = (p.r + r) * 1.04
      if (dx * dx + dz * dz < rr * rr) return false
    }
    return true
  }
  const clusters: Array<{ cx: number; cz: number; s: number; a: number; e: number; w: number; bloom: boolean }> = [
    { cx: 53.5, cz: 14.6, s: 2.6, a: 0.5, e: 0.6, w: 1.5, bloom: true },
    { cx: 49, cz: 2.4, s: 2.2, a: 2.2, e: 0.7, w: 1.1, bloom: true },
  ]
  for (let c = 0; c < 18; c++) {
    const th = range(0, Math.PI * 2)
    const R = pondRadius(th) - range(2.5, 14)
    clusters.push({
      cx: Math.cos(th) * R,
      cz: Math.sin(th) * R,
      s: range(1.4, 3.6),
      a: range(0, Math.PI),
      e: range(0.45, 1),
      w: range(0.5, 1.6),
      bloom: false,
    })
  }
  const wsum = clusters.reduce((sum, c) => sum + c.w, 0)
  for (let guard = 0; pads.length < target && guard < target * 40; guard++) {
    let pick = rand() * wsum
    let c = clusters[0]
    for (const k of clusters) {
      pick -= k.w
      if (pick <= 0) { c = k; break }
    }
    const u = (rand() + rand() + rand() - 1.5) * 1.35
    const v = (rand() + rand() + rand() - 1.5) * 1.35 * c.e
    const x = c.cx + (Math.cos(c.a) * u - Math.sin(c.a) * v) * c.s
    const z = c.cz + (Math.sin(c.a) * u + Math.cos(c.a) * v) * c.s
    const r = 0.15 + 0.3 * Math.pow(rand(), 1.4)
    if (!clear(x, z, r)) continue
    pads.push({
      x, z, r,
      rot: range(0, Math.PI * 2),
      flower: rand() * (c.bloom ? 0.55 : 1),
      squash: range(0.88, 1),
    })
  }
  return pads
}

function lilyLeaf(seed: number): RGB {
  if (seed < 0.38) return LEAF_LIGHT
  if (seed < 0.74) return mix(LEAF_MID, GRASS_B, 0.55)
  return mix(LEAF_MID, LEAF_DARK, 0.22)
}

/** Notched disc from the wonderland pad. The slit is the wedge left out of the ring. */
function addLilyPad(b: Builder, pad: Lily): void {
  const seg = 14
  const wedge = 0.62
  const y = 0.035
  const base = lilyLeaf(hash(pad.x * 7.31, pad.z * 7.31 + 1.7))
  const c = Math.cos(pad.rot)
  const s = Math.sin(pad.rot)
  const at = (lx: number, lz: number): [number, number, number] => [
    pad.x + (c * lx - s * lz) * pad.r,
    y,
    pad.z + (s * lx + c * lz) * pad.r * pad.squash,
  ]
  const tone = (rr: number): RGB => {
    const d = (rr - 0.8) / 0.03
    const band = Math.exp(-d * d * 0.5)
    return mul(base, 1 - 0.17 * Math.min(1, band))
  }
  const center = at(0, 0)
  const ring: Array<[number, number, number]> = []
  const cols: RGB[] = []
  for (let i = 0; i <= seg; i++) {
    const a = wedge / 2 + (i / seg) * (Math.PI * 2 - wedge)
    const rr = 1 + 0.045 * Math.sin(a * 3 + 0.7)
    ring.push(at(Math.cos(a) * rr, Math.sin(a) * rr))
    cols.push(tone(rr))
  }
  const cc = tone(0)
  for (let i = 0; i < seg; i++) {
    const p1 = ring[i + 1]
    const p0 = ring[i]
    b.triangle(
      center[0], center[1], center[2], cc,
      p1[0], p1[1], p1[2], cols[i + 1],
      p0[0], p0[1], p0[2], cols[i],
      KIND_PROP, pad.x, y - 1, pad.z,
    )
  }
}

/** Upright petal cup. Outer ring, inner ring, yellow heart. */
function addLilyBlossom(b: Builder, pad: Lily): void {
  const sc = 0.13 + pad.r * 0.2
  const y = 0.05
  const rot = pad.rot * 1.7
  const tint: RGB = pad.flower < 0.14 ? [1, 0.55, 0.72] : [1, 0.97, 0.93]
  const c = Math.cos(rot)
  const s = Math.sin(rot)
  const at = (lx: number, ly: number, lz: number): [number, number, number] => {
    const px = lx * sc
    const pz = lz * sc
    return [pad.x + c * px - s * pz, y + ly * sc * 0.95, pad.z + s * px + c * pz]
  }
  const tri = (
    A: [number, number, number],
    B: [number, number, number],
    C: [number, number, number],
    col: RGB,
  ) => {
    const pa = at(A[0], A[1], A[2])
    const pb = at(B[0], B[1], B[2])
    const pc = at(C[0], C[1], C[2])
    b.triangle(
      pa[0], pa[1], pa[2], col,
      pb[0], pb[1], pb[2], col,
      pc[0], pc[1], pc[2], col,
      KIND_PROP, pad.x, y, pad.z,
    )
  }
  const ring = (
    n: number,
    r0: number, y0: number,
    rm: number, ym: number, hw: number,
    r1: number, y1: number,
    spin: number, toneLo: number, toneHi: number,
  ) => {
    const lo = mul(tint, toneLo)
    const hi = mul(tint, toneHi)
    for (let i = 0; i < n; i++) {
      const a = spin + (i / n) * Math.PI * 2
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const B: [number, number, number] = [ca * r0, y0, sa * r0]
      const T: [number, number, number] = [ca * r1, y1, sa * r1]
      const L: [number, number, number] = [ca * rm - sa * hw, ym, sa * rm + ca * hw]
      const R: [number, number, number] = [ca * rm + sa * hw, ym, sa * rm - ca * hw]
      tri(B, L, R, lo)
      tri(L, T, R, hi)
    }
  }
  ring(7, 0.12, 0.04, 0.74, 0.3, 0.32, 1.0, 0.6, 0, 0.8, 1.0)
  ring(5, 0.08, 0.1, 0.4, 0.55, 0.26, 0.5, 1.0, 0.4, 0.88, 1.06)
  const heart: RGB = [1, 0.8, 0.22]
  for (let i = 0; i < 6; i++) {
    const a0 = (i / 6) * Math.PI * 2
    const a1 = ((i + 1) / 6) * Math.PI * 2
    tri(
      [0, 0.62, 0],
      [Math.cos(a1) * 0.24, 0.5, Math.sin(a1) * 0.24],
      [Math.cos(a0) * 0.24, 0.5, Math.sin(a0) * 0.24],
      heart,
    )
  }
}

function lilyMesh(): MeshData {
  const b = new Builder()
  const pads = placeLilies()
  for (const pad of pads) addLilyPad(b, pad)
  for (const pad of pads) {
    if (pad.r > 0.25 && pad.flower < 0.24) addLilyBlossom(b, pad)
  }
  return b.empty ? emptyMesh() : b.finish(false, true)
}

function ridgeMesh(): MeshData {
  const b = new Builder()
  const rings = [
    { r: 395, h: 26, base: [0.498, 0.682, 0.322] as RGB, seed: 1.3, f: 5 },
    { r: 560, h: 52, base: [0.416, 0.616, 0.345] as RGB, seed: 4.1, f: 4 },
    { r: 820, h: 95, base: [0.365, 0.561, 0.400] as RGB, seed: 8.7, f: 3 },
    { r: 1250, h: 170, base: [0.341, 0.498, 0.463] as RGB, seed: 12.9, f: 2.4 },
  ]
  for (const ring of rings) {
    const n = 96
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2
      const a1 = ((i + 1) / n) * Math.PI * 2
      const prof = (a: number) => {
        const p = fbm2(Math.cos(a) * ring.f + ring.seed, Math.sin(a) * ring.f + ring.seed * 1.7, 4)
        return ring.h * (0.25 + 1.5 * Math.max(0, p - 0.22))
      }
      const ringR = (a: number) => ring.r * (1 + 0.06 * Math.sin(a * 3 + ring.seed))
      const x0 = Math.cos(a0)
      const z0 = Math.sin(a0)
      const x1 = Math.cos(a1)
      const z1 = Math.sin(a1)
      const r0 = ringR(a0)
      const r1 = ringR(a1)
      b.quad(
        x0 * r0, -6, z0 * r0,
        x1 * r1, -6, z1 * r1,
        x1 * (r1 + 30), prof(a1), z1 * (r1 + 30),
        x0 * (r0 + 30), prof(a0), z0 * (r0 + 30),
        ring.base, 0, 0, ring.h * 0.3, 0,
      )
    }
  }
  const mesh = b.finish(false, true)
  mesh.role = 'ground'
  return mesh
}

function rainStreak(
  b: Builder,
  x: number, y: number, z: number,
  len: number, halfW: number,
  rank: number, phase: number,
  tint: RGB,
): void {
  const corners: Array<[number, number]> = [
    [-halfW, 0],
    [halfW, 0],
    [halfW, -len],
    [-halfW, -len],
  ]
  const ids = corners.map(([dx, dy]) => b.vertex(x, y, z, dx, dy, 1, tint, KIND_RAIN, rank, phase))
  b.tri(ids[0], ids[1], ids[2])
  b.tri(ids[0], ids[2], ids[3])
}

function splashCard(b: Builder, x: number, z: number, rank: number, phase: number): void {
  const tint: RGB = [0.9, 0.95, 1]
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  const ids = corners.map(([cx, cz]) => b.vertex(x, -1, z, cx, cz, 1, tint, 3.2, rank, phase))
  b.tri(ids[0], ids[1], ids[2])
  b.tri(ids[0], ids[2], ids[3])
}

/** Streaks and splash rings share one mesh. The shader wraps them around the camera. */
function rainMesh(): MeshData {
  const b = new Builder()
  const tint: RGB = [0.78, 0.84, 0.95]
  const span = 28
  const column = 16
  const nx = 16
  const nz = 14
  const layers = 3
  for (let layer = 0; layer < layers; layer++) {
    for (let iz = 0; iz < nz; iz++) {
      for (let ix = 0; ix < nx; ix++) {
        const jx = (hash(ix + layer * 17, iz + 3) - 0.5) * (span / nx)
        const jz = (hash(iz + layer * 9, ix + 5) - 0.5) * (span / nz)
        const x = (ix + 0.5) / nx * span - span / 2 + jx
        const z = (iz + 0.5) / nz * span - span / 2 + jz
        const head = hash(ix + layer * 13, iz + 8) * column
        const len = 0.85 + hash(ix + 2, iz + layer) * 0.7
        const halfW = 0.012 + hash(layer, ix + iz) * 0.01
        const rank = hash(ix * 5 + layer, iz * 7 + 4)
        rainStreak(b, x, head, z, len, halfW, rank, head / column, tint)
      }
    }
  }
  const splashN = 6
  for (let iz = 0; iz < splashN; iz++) {
    for (let ix = 0; ix < splashN; ix++) {
      const jx = (hash(ix + 40, iz + 2) - 0.5) * (span / splashN)
      const jz = (hash(iz + 11, ix + 6) - 0.5) * (span / splashN)
      const x = (ix + 0.5) / splashN * span - span / 2 + jx
      const z = (iz + 0.5) / splashN * span - span / 2 + jz
      splashCard(b, x, z, hash(ix + 3, iz + 9), hash(ix * 3, iz + 4))
    }
  }
  const mesh = b.finish(false, true)
  mesh.blended = true
  mesh.doubleSided = true
  return mesh
}

export interface AmbienceBed {
  name: string
  full: number
  reach: number
  trimDb: number
  distance(x: number, z: number, y: number): number
}

export function ambienceFor(_scene: SceneKind): AmbienceBed[] {
  return [{
    name: 'Lake_Quad',
    full: 12,
    reach: 70,
    trimDb: 0,
    distance(x, z) {
      return Math.max(0, shoreDist(x, z))
    },
  }]
}

export interface WorldMeshes {
  pieces: MeshData[]
  rain: MeshData
  scene: SceneKind
}

export function buildWorld(_scene: SceneKind = 'meadow'): WorldMeshes {
  const pieces = [
    ...terrainMeshes(),
    waterMesh(),
    lilyMesh(),
    ...grassMeshes(),
    ...flowerMeshes(),
    ...treeMeshes(),
    ridgeMesh(),
    jettyMesh(),
    campfireLogs(),
  ]
  return { pieces, rain: rainMesh(), scene: 'meadow' }
}
