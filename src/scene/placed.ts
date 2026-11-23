/**
 * Every CustomSRP placement in the preset window, merged into a few meshes.
 * Size is the prefab LOD0 AABB. Position / rotation / scale are the MapItem TRS
 * (Unity Euler ZXY). Rivers, falls, and the invisible airwall are drawn elsewhere.
 */
import { barrelMesh } from './barrel'
import { benchMesh } from './bench'
import { crateMesh } from './crate'
import { dockMesh } from './dock'
import { fenceMesh } from './fence'
import { pineappleHouse } from './house'
import { wagonMesh } from './wagon'
import { atlasUv, Builder, FLOATS, hash, KIND_BARK, KIND_GRASS, KIND_LEAF, KIND_PROP, KIND_ROCK, type MeshData, type RGB } from './mesh'
import {
  addBarrel, addBridge, addCampfire, addCanoe, addCrate, addDeadTree,
  addFarmhouse, addShed, addTent, withGroundY,
} from './props'
import { ITEMS, MODELS, type LayoutItem, type ModelBounds, type PresetLayout } from './data/layout.gen'

const COLOR: Record<string, RGB> = {
  Songshu: [0.20, 0.36, 0.14],
  Lvshu: [0.32, 0.52, 0.16],
  Yeshu: [0.48, 0.58, 0.22],
  Guanmu: [0.26, 0.46, 0.16],
  Zacao: [0.42, 0.60, 0.20],
  Hua: [0.82, 0.48, 0.58],
  ShiTou: [0.48, 0.46, 0.42],
  ZaWu: [0.42, 0.32, 0.20],
  JianZhu: [0.62, 0.46, 0.28],
  Qiao: [0.50, 0.38, 0.24],
  Other: [0.45, 0.48, 0.42],
  FX_Day: [0.95, 0.88, 0.45],
  FX_Night: [0.70, 0.78, 0.95],
}

type Xform = (x: number, y: number, z: number) => [number, number, number]

function eulerQuat(rx: number, ry: number, rz: number): [number, number, number, number] {
  const x = rx * Math.PI / 360
  const y = ry * Math.PI / 360
  const z = rz * Math.PI / 360
  const cx = Math.cos(x), sx = Math.sin(x)
  const cy = Math.cos(y), sy = Math.sin(y)
  const cz = Math.cos(z), sz = Math.sin(z)
  // Unity Quaternion.Euler: yaw * pitch * roll.
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz - sx * sy * cz,
    cx * cy * cz + sx * sy * sz,
  ]
}

function quatRotate(q: [number, number, number, number], v: [number, number, number]): [number, number, number] {
  const [qx, qy, qz, qw] = q
  const [vx, vy, vz] = v
  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}

function makeXform(it: LayoutItem, ox: number, oz: number): Xform {
  const q = eulerQuat(it.rx, it.ry, it.rz)
  return (x, y, z) => {
    const r = quatRotate(q, [x * it.sx, y * it.sy, z * it.sz])
    return [r[0] + it.x - ox, r[1] + it.y, r[2] + it.z - oz]
  }
}

function tint(parent: string, it: LayoutItem): RGB {
  const base = COLOR[parent] ?? [0.55, 0.5, 0.42]
  const k = 0.88 + ((Math.abs(Math.sin(it.x * 12.9898 + it.z * 78.233)) * 43758.5453) % 1) * 0.18
  return [base[0] * k, base[1] * k, base[2] * k]
}

/** CustomSRP bark albedo (oil map × _MainColor). Forest trunks share one tan; palms are lighter. */
const BARK_WOOD: RGB = [0.576, 0.507, 0.327]
const BARK_PALM: RGB = [0.806, 0.698, 0.419]
/**
 * Leaf bands from CustomSRP green texels.
 * Lit keeps the texture. Shade/mid are that albedo × OilVolumePaint (bottom/top, 0.55).
 * Pine = TFF atlas, broadleaf/bush = oak leaf, palm = TAI atlas.
 */
type LeafBand = { shade: RGB; mid: RGB; lit: RGB }
const PINE_LEAF: LeafBand = {
  shade: [0.362, 0.465, 0.273],
  mid: [0.435, 0.532, 0.315],
  lit: [0.508, 0.599, 0.358],
}
const BROAD_LEAF: LeafBand = {
  shade: [0.402, 0.502, 0.294],
  mid: [0.483, 0.575, 0.340],
  lit: [0.564, 0.647, 0.386],
}
const PALM_LEAF: LeafBand = {
  shade: [0.298, 0.479, 0.258],
  mid: [0.358, 0.548, 0.299],
  lit: [0.418, 0.617, 0.339],
}
const LEAF_TOP: RGB = [0.50, 0.74, 0.18]
const LEAF_BOTTOM: RGB = [0.24, 0.44, 0.10]
/** CustomSRP T_Grass green texels, root darkened by the oil volume shade. */
const GRASS_ROOT: RGB = [0.381, 0.489, 0.320]
const GRASS_MID: RGB = [0.458, 0.560, 0.370]
const GRASS_TIP: RGB = [0.535, 0.630, 0.420]
const ROCK: RGB = [0.48, 0.46, 0.42]
const FLOWER: RGB = [0.86, 0.48, 0.58]
const FLOWER_TOP: RGB = [0.95, 0.72, 0.55]

const LEAF_UV = [
  atlasUv(0, 1, 0, 0), atlasUv(0, 1, 1, 0), atlasUv(0, 1, 1, 1), atlasUv(0, 1, 0, 1),
] as const
const FLOWER_UV = [
  atlasUv(3, 1, 0, 0), atlasUv(3, 1, 1, 0), atlasUv(3, 1, 1, 1), atlasUv(3, 1, 0, 1),
] as const

function addBox(b: Builder, xf: Xform, m: ModelBounds, color: RGB, kind: number): void {
  const xs = [m.cx - m.ex, m.cx + m.ex]
  const ys = [m.cy - m.ey, m.cy + m.ey]
  const zs = [m.cz - m.ez, m.cz + m.ez]
  const p: [number, number, number][] = []
  for (const y of ys) for (const z of zs) for (const x of xs) p.push(xf(x, y, z))
  const c = xf(m.cx, m.cy, m.cz)
  const col: [RGB, RGB, RGB, RGB] = [color, color, color, color]
  const faces: [number, number, number, number][] = [
    [0, 1, 5, 4], [1, 3, 7, 5], [3, 2, 6, 7], [2, 0, 4, 6], [4, 5, 7, 6], [2, 3, 1, 0],
  ]
  for (const f of faces) {
    b.face(p[f[0]], p[f[1]], p[f[2]], p[f[3]], col, kind, c[0], c[1], c[2])
  }
}

function ring(b: Builder, xf: Xform, y0: number, y1: number, r0x: number, r0z: number, r1x: number, r1z: number, cx: number, cz: number, sides: number, color: RGB, kind: number, ref: [number, number, number]): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    b.face(
      xf(cx + c0 * r0x, y0, cz + s0 * r0z),
      xf(cx + c1 * r0x, y0, cz + s1 * r0z),
      xf(cx + c1 * r1x, y1, cz + s1 * r1z),
      xf(cx + c0 * r1x, y1, cz + s0 * r1z),
      [color, color, color, color],
      kind, ref[0], ref[1], ref[2],
    )
  }
}

/** One oil-paint dab. Half-size rides in the normal; the brush mark runs along the long side. */
function dab(
  b: Builder, xf: Xform,
  x: number, y: number, z: number,
  hx: number, hy: number, tile: number, color: RGB,
): void {
  const c = xf(x, y, z)
  const alongX = hx > hy * 1.2
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const
  const ids = corners.map(([cx, cy]) => {
    const su = alongX ? cy : cx
    const sv = alongX ? cx : cy
    const u = ((tile % 4) + su * 0.5 + 0.5) / 4
    const v = (Math.floor(tile / 4) + sv * 0.5 + 0.5) / 2
    return b.vertex(c[0], c[1], c[2], cx * hx, cy * hy, 1, color, KIND_LEAF, u, v)
  })
  b.tri(ids[0], ids[1], ids[2])
  b.tri(ids[0], ids[2], ids[3])
}

type TrunkPt = { x: number; y: number; z: number; r: number }

/** Oil-paint trunk: a bent pipe that flares at the foot and thins toward the crown. */
function trunkLine(cx: number, y0: number, cz: number, height: number, radius: number, seed: number, rings: number): TrunkPt[] {
  const leanX = (hash(seed, 1.7) - 0.5) * 0.16
  const leanZ = (hash(seed, 2.3) - 0.5) * 0.16
  const pts: TrunkPt[] = []
  for (let i = 0; i < rings; i++) {
    const u = i / (rings - 1)
    const y = u * u * 0.4 + u * 0.6
    const bend = Math.sin(u * 2.4 + seed) * 0.07
    const reach = y * height
    pts.push({
      x: cx + (leanX * y + bend * leanZ) * height,
      y: y0 + reach,
      z: cz + (leanZ * y - bend * leanX) * height,
      r: Math.max(0.03, radius * (1 - 0.58 * y) * (1 + 0.5 * Math.exp(-reach / (0.35 + radius)))),
    })
  }
  return pts
}

function addTube(b: Builder, xf: Xform, pts: TrunkPt[], color: RGB, sides: number): void {
  for (let i = 0; i < pts.length - 1; i++) {
    const p = pts[i]
    const q = pts[i + 1]
    const ref = xf((p.x + q.x) * 0.5, (p.y + q.y) * 0.5, (p.z + q.z) * 0.5)
    for (let s = 0; s < sides; s++) {
      const a0 = (s / sides) * Math.PI * 2
      const a1 = ((s + 1) / sides) * Math.PI * 2
      const at = (pt: TrunkPt, a: number) => xf(pt.x + Math.cos(a) * pt.r, pt.y, pt.z + Math.sin(a) * pt.r)
      const a = at(p, a0)
      const c = at(p, a1)
      const d = at(q, a1)
      const e = at(q, a0)
      b.quad(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], e[0], e[1], e[2], color, KIND_BARK, ref[0], ref[1], ref[2])
    }
  }
}

/** Vertical bark strokes laid on the pipe, the same marks oil-paint puts on a trunk. */
function addBarkStrokes(b: Builder, xf: Xform, pts: TrunkPt[], color: RGB, seed: number, n: number): void {
  const span = pts[pts.length - 1].y - pts[0].y
  for (let k = 0; k < n; k++) {
    const u = 0.08 + hash(seed + k, 4.1) * 0.78
    const f = u * (pts.length - 1)
    const i = Math.min(pts.length - 2, Math.floor(f))
    const t = f - i
    const p = pts[i]
    const q = pts[i + 1]
    const x = p.x + (q.x - p.x) * t
    const y = p.y + (q.y - p.y) * t
    const z = p.z + (q.z - p.z) * t
    const r = p.r + (q.r - p.r) * t
    const a = hash(seed, k + 9) * Math.PI * 2
    const along = Math.max(0.16, span * (0.22 + hash(k, seed) * 0.14))
    const across = Math.max(0.025, Math.min(r * 1.15, 0.16))
    const dark = hash(k, seed + 3) > 0.5
    const col: RGB = dark
      ? [color[0] * 0.72, color[1] * 0.68, color[2] * 0.62]
      : [Math.min(1, color[0] * 1.05), Math.min(1, color[1] * 1.03), Math.min(1, color[2] * 1.02)]
    dab(b, xf, x + Math.cos(a) * r, y, z + Math.sin(a) * r, across, along * 0.5, k % 4, col)
  }
}

/** Lobes of leaf dabs: a dark core, then lighter touches pushed out, as in oil-paint. */
function addCrownDabs(
  b: Builder, xf: Xform,
  cx: number, cy: number, cz: number,
  spread: number, tall: number,
  band: LeafBand, lobes: number, per: number, conical: number, seed: number,
): void {
  for (let i = 0; i < lobes; i++) {
    const yn = conical > 0.5 ? (i + 0.5) / lobes : 0.2 + hash(seed + i, 2.2) * 0.7
    const ring = conical > 0.5 ? (1 - yn) * 0.92 + 0.06 : Math.sqrt(hash(i + 1, seed))
    const a = i * 2.39996 + hash(seed, 8.1) * 6
    const lx = cx + Math.cos(a) * ring * spread
    const lz = cz + Math.sin(a) * ring * spread
    const ly = cy + (yn - 0.2) * tall
    const lr = Math.max(0.12, spread * (0.38 + hash(lx, lz) * 0.18))
    dab(b, xf, lx, ly, lz, lr * 0.5, lr * 0.4, 4, band.shade)
    for (let k = 0; k < per; k++) {
      const ang = a + k * 2.2
      const out = 0.42 + hash(lx + k, lz) * 0.5
      const lit = out > 0.7
      dab(
        b, xf,
        lx + Math.cos(ang) * lr * out,
        ly + (hash(k + 3, ly) - 0.35) * lr,
        lz + Math.sin(ang) * lr * out,
        lr * 0.32, lr * 0.46,
        lit ? 5 : 4,
        lit ? band.lit : band.mid,
      )
    }
  }
}

function leafCard(
  b: Builder, xf: Xform,
  x: number, y: number, z: number,
  yaw: number, w: number, h: number,
  uvs: typeof LEAF_UV,
  bottom: RGB, top: RGB,
): void {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const a = xf(x - c * w, y, z - s * w)
  const d = xf(x + c * w, y, z + s * w)
  const e = xf(x + c * w * 0.4, y + h, z + s * w * 0.4)
  const f = xf(x - c * w * 0.4, y + h, z - s * w * 0.4)
  b.card(a[0], a[1], a[2], d[0], d[1], d[2], e[0], e[1], e[2], f[0], f[1], f[2], bottom, bottom, top, top, KIND_GRASS, uvs)
}

function addPine(b: Builder, xf: Xform, m: ModelBounds): void {
  const y0 = m.cy - m.ey
  const h = Math.max(0.8, m.ey * 2)
  const spread = Math.max(m.ex, m.ez, 0.35)
  const seed = hash(m.cx, m.cz) * 100
  const pts = trunkLine(m.cx, y0, m.cz, h * 0.5, Math.max(0.045, Math.min(m.ex, m.ez) * 0.18), seed, 4)
  addTube(b, xf, pts, BARK_WOOD, 5)
  addBarkStrokes(b, xf, pts, BARK_WOOD, seed, 4)
  const top = pts[pts.length - 1]
  addCrownDabs(b, xf, top.x, y0 + h * 0.4, top.z, spread * 0.92, h * 0.62, PINE_LEAF, 4, 2, 1, seed + 3)
}

function addBroadleaf(b: Builder, xf: Xform, m: ModelBounds): void {
  const y0 = m.cy - m.ey
  const h = Math.max(0.8, m.ey * 2)
  const spread = Math.max(m.ex, m.ez, 0.4)
  const seed = hash(m.cx, m.cz) * 90
  const pts = trunkLine(m.cx, y0, m.cz, h * 0.38, Math.max(0.05, Math.min(m.ex, m.ez) * 0.2), seed, 4)
  addTube(b, xf, pts, BARK_WOOD, 5)
  addBarkStrokes(b, xf, pts, BARK_WOOD, seed, 4)
  const top = pts[pts.length - 1]
  addCrownDabs(b, xf, top.x, y0 + h * 0.48, top.z, spread, h * 0.52, BROAD_LEAF, 4, 2, 0, seed + 5)
}

function addPalm(b: Builder, xf: Xform, m: ModelBounds): void {
  const y0 = m.cy - m.ey
  const h = Math.max(0.6, m.ey * 2)
  const yaw = 0.7
  const reach = Math.max(m.ex, m.ez, m.ey * 0.72)
  const pts: TrunkPt[] = []
  const rings = 5
  for (let i = 0; i < rings; i++) {
    const t = i / (rings - 1)
    const lean = t * t * Math.max(m.ex, 0.4) * 0.85
    pts.push({
      x: m.cx + Math.cos(yaw) * lean,
      y: y0 + t * h * 0.72,
      z: m.cz + Math.sin(yaw) * lean,
      r: Math.max(0.05, m.ex * (0.13 - t * 0.06)),
    })
  }
  addTube(b, xf, pts, BARK_PALM, 4)
  addBarkStrokes(b, xf, pts, BARK_PALM, hash(m.cx, m.cz) * 40, 4)
  const top = pts[pts.length - 1]
  const arm = Math.min(Math.max(reach * 0.62, 1.0), 2.1)
  const stroke = Math.min(0.9, Math.max(0.46, arm * 0.55))
  dab(b, xf, top.x, top.y + 0.05, top.z, stroke * 0.85, stroke * 0.7, 4, PALM_LEAF.shade)
  for (let i = 0; i < 8; i++) {
    const a = yaw + (i / 8) * Math.PI * 2
    for (let k = 0; k < 3; k++) {
      const t = (k + 1) / 3
      dab(
        b, xf,
        top.x + Math.cos(a) * arm * t,
        top.y + 0.08 - t * t * arm * 0.35,
        top.z + Math.sin(a) * arm * t,
        stroke * 0.55,
        stroke * (0.85 - t * 0.2),
        4 + (k % 2),
        t > 0.7 ? PALM_LEAF.lit : PALM_LEAF.mid,
      )
    }
  }
}

function addBush(b: Builder, xf: Xform, m: ModelBounds): void {
  const y0 = m.cy - m.ey
  const h = Math.max(0.35, m.ey * 2)
  const spread = Math.max(m.ex, m.ez, 0.25)
  const seed = hash(m.cx, m.cz) * 70
  const pts = trunkLine(m.cx, y0, m.cz, h * 0.22, Math.max(0.03, spread * 0.08), seed, 3)
  addTube(b, xf, pts, BARK_WOOD, 4)
  addBarkStrokes(b, xf, pts, BARK_WOOD, seed, 3)
  addCrownDabs(b, xf, m.cx, y0 + h * 0.28, m.cz, spread * 0.95, h * 0.7, BROAD_LEAF, 4, 2, 0, seed + 2)
}

/** Oil-paint grass: thin flicks from one foot, each flick one brush mark. */
function addPaintedGrass(b: Builder, xf: Xform, m: ModelBounds): void {
  const y0 = m.cy - m.ey
  const H = Math.max(0.28, m.ey * 2)
  const spread = Math.max(m.ex, m.ez, 0.08)
  const n = 6
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + hash(m.cx + i, m.cz) * 0.7
    const tall = H * (0.62 + hash(i, m.cz) * 0.4)
    const lean = tall * (0.12 + hash(m.cx, i) * 0.28)
    const col = i % 3 === 0 ? GRASS_TIP : i % 3 === 1 ? GRASS_ROOT : GRASS_MID
    dab(
      b, xf,
      m.cx + Math.cos(a) * (spread * 0.2 + lean * 0.45),
      y0 + tall * 0.5,
      m.cz + Math.sin(a) * (spread * 0.2 + lean * 0.45),
      tall * 0.035,
      tall * 0.5,
      i % 3,
      col,
    )
  }
}

function addCards(b: Builder, xf: Xform, m: ModelBounds, flower: boolean): void {
  const y0 = m.cy - m.ey
  const y1 = m.cy + m.ey
  const uvs = flower ? FLOWER_UV : LEAF_UV
  const bottom = flower ? FLOWER : LEAF_BOTTOM
  const top = flower ? FLOWER_TOP : LEAF_TOP
  leafCard(b, xf, m.cx, y0, m.cz, 0.3, m.ex, y1 - y0, uvs, bottom, top)
  leafCard(b, xf, m.cx, y0, m.cz, 0.3 + Math.PI * 0.5, m.ez, y1 - y0, uvs, bottom, top)
}

function addRock(b: Builder, xf: Xform, m: ModelBounds, color: RGB): void {
  const y0 = m.cy - m.ey
  const y1 = m.cy + m.ey * 0.92
  const ref = xf(m.cx, (y0 + y1) * 0.5, m.cz)
  ring(b, xf, y0, y1, m.ex, m.ez, m.ex * 0.22, m.ez * 0.22, m.cx, m.cz, 5, color, KIND_ROCK, ref)
}

function addCone(b: Builder, xf: Xform, m: ModelBounds, color: RGB): void {
  const y0 = m.cy - m.ey
  const y1 = m.cy + m.ey
  const ref = xf(m.cx, (y0 + y1) * 0.5, m.cz)
  ring(b, xf, y0, y1, m.ex, m.ez, m.ex * 0.05, m.ez * 0.05, m.cx, m.cz, 5, color, KIND_ROCK, ref)
}

function appendMesh(dst: Builder, src: MeshData, xf: Xform): void {
  const f = src.interleaved
  const idx = src.indices
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const ids: number[] = []
    for (let k = 0; k < 3; k++) {
      const o = idx[i + k] * FLOATS
      const p = xf(f[o], f[o + 1], f[o + 2])
      const q = xf(f[o] + f[o + 3], f[o + 1] + f[o + 4], f[o + 2] + f[o + 5])
      ids.push(dst.vertex(
        p[0], p[1], p[2], q[0] - p[0], q[1] - p[1], q[2] - p[2],
        [f[o + 6], f[o + 7], f[o + 8]], f[o + 9], f[o + 10], f[o + 11],
      ))
    }
    dst.tri(ids[0], ids[1], ids[2])
  }
}

function fit(it: LayoutItem, m: ModelBounds, ref: number): number {
  const s = Math.max(m.ex * Math.abs(it.sx), m.ey * Math.abs(it.sy), m.ez * Math.abs(it.sz))
  return Math.max(0.15, Math.min(s / ref, 8))
}

function sit(b: Builder, it: LayoutItem, m: ModelBounds, ox: number, oz: number, ref: number, fn: (x: number, z: number, yaw: number, scale: number) => void): void {
  const y = it.y - m.ey * Math.abs(it.sy)
  withGroundY(y, () => fn(it.x - ox, it.z - oz, it.ry * Math.PI / 180, fit(it, m, ref)))
}

function finish(b: Builder, shadow: boolean): MeshData {
  if (b.empty) {
    return { interleaved: new Float32Array(0), indices: new Uint16Array(0), receiveShadow: shadow }
  }
  return b.finish(shadow, true)
}

export function buildPlaced(layout: PresetLayout): { trees: MeshData; rocks: MeshData; grass: MeshData; props: MeshData } {
  const trees = new Builder()
  const rocks = new Builder()
  const grass = new Builder()
  const props = new Builder()
  for (let i = 0; i < layout.items.length; i++) {
    const it = ITEMS[layout.items[i]]
    const model = it ? MODELS[it.m] : undefined
    if (!it || !model) continue
    if (model.p === 'FX_Day' || model.p === 'FX_Night' || model.p === 'Common' || model.p === 'texiao') continue
    const xf = makeXform(it, layout.ox, layout.oz)
    const color = tint(model.p, it)
    const name = model.n
    if (model.p === 'Songshu') addPine(trees, xf, model)
    else if (model.p === 'Yeshu') addPalm(trees, xf, model)
    else if (model.p === 'Lvshu') addBroadleaf(trees, xf, model)
    else if (model.p === 'Guanmu') addBush(trees, xf, model)
    else if (model.p === 'Zacao') addPaintedGrass(grass, xf, model)
    else if (model.p === 'Hua') addCards(grass, xf, model, true)
    else if (model.p === 'ShiTou') addRock(rocks, xf, model, color)
    else if (/mountain/i.test(name)) addCone(props, xf, model, color)
    else if (/boluo|pineapple/i.test(name)) appendMesh(props, pineappleHouse(0, 0, 0, 1), xf)
    else if (/house/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 1.7, (x, z, yaw, s) => addFarmhouse(props, x, z, yaw, s))
    else if (/shed/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 1.4, (x, z, yaw, s) => addShed(props, x, z, yaw, s))
    else if (/tent/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 1.2, (x, z, _yaw, s) => addTent(props, x, z, s))
    else if (/dock|pier/i.test(name)) appendMesh(props, dockMesh(), xf)
    else if (/bridge/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 3.2, (x, z, yaw, s) => addBridge(props, x, z, yaw, s))
    else if (/fence/i.test(name)) appendMesh(props, fenceMesh(), xf)
    else if (/canoe/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 1.6, (x, z, yaw, s) => addCanoe(props, x, z, yaw, s))
    else if (/barrel/i.test(name) && !/stack|broken/i.test(name)) appendMesh(props, barrelMesh(), xf)
    else if (/barrel/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 0.4, (x, z, _yaw, s) => addBarrel(props, x, z, s))
    else if (/crate|box_wood|container/i.test(name)) appendMesh(props, crateMesh(), xf)
    else if (/^box$/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 0.4, (x, z, _yaw, s) => addCrate(props, x, z, s))
    else if (/bench/i.test(name)) appendMesh(props, benchMesh(), xf)
    else if (/wagon/i.test(name)) appendMesh(props, wagonMesh(), xf)
    else if (/dead|maple|branch/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 1.1, (x, z, _yaw, s) => addDeadTree(props, x, z, s))
    else if (/huodui|camp/i.test(name)) sit(props, it, model, layout.ox, layout.oz, 1, (x, z, _yaw, s) => addCampfire(props, x, z, s))
    else addBox(props, xf, model, color, KIND_PROP)
  }
  return {
    trees: finish(trees, true),
    rocks: finish(rocks, true),
    grass: finish(grass, false),
    props: finish(props, true),
  }
}
