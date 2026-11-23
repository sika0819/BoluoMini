/**
 * Procedural archetypes for every CustomSRP DaoYu1 category that must appear
 * at least once (trees/grass stay in world.ts; this file is built props).
 */
import { height, SEA } from './island'
import {
  atlasUv, Builder, emptyMesh, KIND_FIRE, KIND_GRASS, KIND_PROP, type MeshData, type RGB,
} from './mesh'

const ROOF_UV = [
  atlasUv(2, 1, 0, 0), atlasUv(2, 1, 1, 0), atlasUv(2, 1, 1, 1), atlasUv(2, 1, 0, 1),
] as const
const WOOD_UV = [
  atlasUv(1, 1, 0, 0), atlasUv(1, 1, 1, 0), atlasUv(1, 1, 1, 1), atlasUv(1, 1, 0, 1),
] as const
const MASONRY_UV = [
  atlasUv(0, 2, 0, 0), atlasUv(0, 2, 1, 0), atlasUv(0, 2, 1, 1), atlasUv(0, 2, 0, 1),
] as const
const STONE: RGB = [0.62, 0.56, 0.48]

const ROCK: RGB = [0.48, 0.46, 0.42]
const ROCK_DARK: RGB = [0.36, 0.34, 0.32]
const WOOD: RGB = [0.52, 0.36, 0.22]
const WOOD_DARK: RGB = [0.38, 0.26, 0.16]
const CANVAS: RGB = [0.78, 0.62, 0.42]
const FLOWER: RGB = [0.86, 0.42, 0.55]
const FLOWER_Y: RGB = [0.92, 0.78, 0.28]
const LEAF: RGB = [0.34, 0.58, 0.2]
const MOUNTAIN: RGB = [0.42, 0.44, 0.48]
const FLAME_LO: RGB = [0.4, 0.15, 0.05]
const FLAME_HI: RGB = [1, 0.45, 0.1]

/** When set, prop builders sit on CustomSRP exported Y instead of sampled height. */
let groundOverride: number | null = null

export function withGroundY<T>(y: number, fn: () => T): T {
  const prev = groundOverride
  groundOverride = y
  try { return fn() } finally { groundOverride = prev }
}

function groundY(x: number, z: number): number {
  return groundOverride != null ? groundOverride : height(x, z)
}

function rot(x: number, z: number, yaw: number): [number, number] {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  return [x * c - z * s, x * s + z * c]
}

function box(
  b: Builder,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  yaw: number,
  color: RGB,
  kind = KIND_PROP,
  uvs?: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]],
): void {
  const corners: [number, number, number][] = [
    [-hx, 0, -hz], [hx, 0, -hz], [hx, 0, hz], [-hx, 0, hz],
    [-hx, hy, -hz], [hx, hy, -hz], [hx, hy, hz], [-hx, hy, hz],
  ]
  const p = corners.map(([lx, ly, lz]) => {
    const [rx, rz] = rot(lx, lz, yaw)
    return [cx + rx, cy + ly, cz + rz] as [number, number, number]
  })
  const faces: [number, number, number, number][] = [
    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [0, 3, 2, 1],
  ]
  for (const f of faces) {
    const a = p[f[0]], c = p[f[1]], d = p[f[2]], e = p[f[3]]
    b.quad(a[0], a[1], a[2], c[0], c[1], c[2], d[0], d[1], d[2], e[0], e[1], e[2], color, kind, cx, cy + hy * 0.5, cz, uvs)
  }
}

function cyl(
  b: Builder,
  x: number, y0: number, z: number,
  y1: number, r: number,
  color: RGB,
  sides = 6,
): void {
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    b.quad(
      x + c0 * r, y0, z + s0 * r,
      x + c1 * r, y0, z + s1 * r,
      x + c1 * r, y1, z + s1 * r,
      x + c0 * r, y1, z + s0 * r,
      color, KIND_PROP, x, (y0 + y1) * 0.5, z,
    )
  }
}

/** Vertical cliff wall (ShiTou Cliff_*). */
export function addCliff(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z) - 0.4 * scale
  const w = 4.2 * scale
  const d = 1.4 * scale
  const h = 5.2 * scale
  box(b, x, y, z, w * 0.5, h, d * 0.5, yaw, ROCK)
  // jagged top teeth
  for (let i = -2; i <= 2; i++) {
    const [ox, oz] = rot(i * 0.85 * scale, 0.1 * scale, yaw)
    const th = (0.6 + (i & 1) * 0.5) * scale
    box(b, x + ox, y + h, z + oz, 0.35 * scale, th, 0.35 * scale, yaw, ROCK_DARK)
  }
  // base rubble
  for (let i = 0; i < 4; i++) {
    const [ox, oz] = rot((i - 1.5) * 1.1 * scale, -0.9 * scale, yaw)
    box(b, x + ox, y, z + oz, 0.45 * scale, 0.55 * scale, 0.4 * scale, yaw + 0.3, ROCK_DARK)
  }
}

/** Campfire Huodui: stone ring + logs + flame. */
export function addCampfire(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    const px = x + Math.cos(a) * 0.55 * scale
    const pz = z + Math.sin(a) * 0.55 * scale
    box(b, px, y, pz, 0.16 * scale, 0.22 * scale, 0.14 * scale, a, ROCK, KIND_PROP, MASONRY_UV)
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 1.05
    const c = Math.cos(a), s = Math.sin(a)
    b.quad(
      x - c * 0.45 * scale, y + 0.08 * scale, z - s * 0.45 * scale,
      x + c * 0.45 * scale, y + 0.08 * scale, z + s * 0.45 * scale,
      x + c * 0.45 * scale, y + 0.2 * scale, z + s * 0.45 * scale,
      x - c * 0.45 * scale, y + 0.2 * scale, z - s * 0.45 * scale,
      WOOD_DARK, KIND_PROP, x, y + 0.15 * scale, z, WOOD_UV,
    )
  }
  b.card(
    x - 0.22 * scale, y + 0.15 * scale, z,
    x + 0.22 * scale, y + 0.15 * scale, z,
    x + 0.14 * scale, y + 1.05 * scale, z,
    x - 0.14 * scale, y + 1.05 * scale, z,
    FLAME_LO, FLAME_LO, FLAME_HI, FLAME_HI, KIND_FIRE,
  )
  b.card(
    x, y + 0.15 * scale, z - 0.22 * scale,
    x, y + 0.15 * scale, z + 0.22 * scale,
    x, y + 0.95 * scale, z + 0.12 * scale,
    x, y + 0.95 * scale, z - 0.12 * scale,
    FLAME_LO, FLAME_LO, FLAME_HI, FLAME_HI, KIND_FIRE,
  )
}

/** Farmhouse House_1_NoInterior — masonry body + oil roof, nearer LOD silhouette. */
export function addFarmhouse(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z)
  const w = 1.95 * scale
  const d = 1.65 * scale
  const wall = 2.05 * scale
  const ridge = wall + 1.25 * scale
  const e = 0.32 * scale
  // stone foundation + masonry walls
  box(b, x, y, z, w + 0.08 * scale, 0.28 * scale, d + 0.08 * scale, yaw, STONE, KIND_PROP, MASONRY_UV)
  box(b, x, y + 0.28 * scale, z, w, wall - 0.28 * scale, d, yaw, STONE, KIND_PROP, MASONRY_UV)
  // gable roof halves
  const [p0x, p0z] = rot(-(w + e), -(d + e), yaw)
  const [p1x, p1z] = rot(-(w + e), d + e, yaw)
  const [p2x, p2z] = rot(0, d + e, yaw)
  const [p3x, p3z] = rot(0, -(d + e), yaw)
  b.quad(
    x + p0x, y + wall, z + p0z,
    x + p1x, y + wall, z + p1z,
    x + p2x, y + ridge, z + p2z,
    x + p3x, y + ridge, z + p3z,
    WOOD_DARK, KIND_PROP, x, y + wall, z, ROOF_UV,
  )
  const [q0x, q0z] = rot(w + e, d + e, yaw)
  const [q1x, q1z] = rot(w + e, -(d + e), yaw)
  b.quad(
    x + q0x, y + wall, z + q0z,
    x + q1x, y + wall, z + q1z,
    x + p3x, y + ridge, z + p3z,
    x + p2x, y + ridge, z + p2z,
    WOOD_DARK, KIND_PROP, x, y + wall, z, ROOF_UV,
  )
  // door + porch
  const [dx, dz] = rot(0, d + 0.02, yaw)
  box(b, x + dx, y + 0.28 * scale, z + dz, 0.34 * scale, 1.2 * scale, 0.05 * scale, yaw, WOOD_DARK, KIND_PROP, WOOD_UV)
  const [sx, sz] = rot(0, d + 0.4 * scale, yaw)
  box(b, x + sx, y, z + sz, 0.7 * scale, 0.14 * scale, 0.35 * scale, yaw, WOOD, KIND_PROP, WOOD_UV)
  // porch posts
  for (const side of [-1, 1] as const) {
    const [px, pz] = rot(side * 0.55 * scale, d + 0.55 * scale, yaw)
    box(b, x + px, y, z + pz, 0.06 * scale, 1.35 * scale, 0.06 * scale, yaw, WOOD_DARK, KIND_PROP, WOOD_UV)
  }
  // side windows
  for (const side of [-1, 1]) {
    const [wx, wz] = rot(side * (w + 0.02), 0.2 * scale, yaw)
    const [hx, hz] = rot(0.02 * scale, 0.3 * scale, yaw)
    const [vx, vz] = rot(0.24 * scale, 0, yaw)
    const cy = y + 1.15 * scale
    b.quad(
      x + wx - vx - hx, cy - 0.3 * scale, z + wz - vz - hz,
      x + wx + vx - hx, cy - 0.3 * scale, z + wz + vz - hz,
      x + wx + vx + hx, cy + 0.3 * scale, z + wz + vz + hz,
      x + wx - vx + hx, cy + 0.3 * scale, z + wz - vz + hz,
      WOOD_DARK, KIND_PROP, x, cy, z, WOOD_UV,
    )
  }
  // chimney
  const [cx, cz] = rot(0.65 * scale, -0.4 * scale, yaw)
  box(b, x + cx, y + wall, z + cz, 0.24 * scale, 0.95 * scale, 0.24 * scale, yaw, STONE, KIND_PROP, MASONRY_UV)
}

/** Open shed — proportions nearer rpgpp_ag_shed AABB (~0.9×1.5×1.4). */
export function addShed(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z)
  const w = 0.95 * scale
  const d = 1.25 * scale
  const hBack = 1.55 * scale
  const hFront = 1.15 * scale
  // three walls (open front +z), oil wood UV
  const [bx, bz] = rot(0, -d, yaw)
  box(b, x + bx, y, z + bz, w, hBack, 0.05 * scale, yaw, WOOD, KIND_PROP, WOOD_UV)
  const [lx, lz] = rot(-w, 0, yaw)
  box(b, x + lx, y, z + lz, 0.05 * scale, hBack, d, yaw, WOOD, KIND_PROP, WOOD_UV)
  const [rx, rz] = rot(w, 0, yaw)
  box(b, x + rx, y, z + rz, 0.05 * scale, hBack, d, yaw, WOOD, KIND_PROP, WOOD_UV)
  // lean-to roof (low front / high back)
  const [f0x, f0z] = rot(-w - 0.08 * scale, d + 0.08 * scale, yaw)
  const [f1x, f1z] = rot(w + 0.08 * scale, d + 0.08 * scale, yaw)
  const [b0x, b0z] = rot(-w - 0.08 * scale, -d - 0.08 * scale, yaw)
  const [b1x, b1z] = rot(w + 0.08 * scale, -d - 0.08 * scale, yaw)
  b.quad(
    x + f0x, y + hFront, z + f0z,
    x + f1x, y + hFront, z + f1z,
    x + b1x, y + hBack + 0.08 * scale, z + b1z,
    x + b0x, y + hBack + 0.08 * scale, z + b0z,
    WOOD_DARK, KIND_PROP, x, y + hBack, z, ROOF_UV,
  )
  // stacked log pile at open front
  for (let i = 0; i < 3; i++) {
    const [px, pz] = rot((i - 1) * 0.35 * scale, d * 0.55, yaw)
    box(b, x + px, y, z + pz, 0.16 * scale, 0.22 * scale, 0.45 * scale, yaw + 0.4, WOOD_DARK, KIND_PROP, WOOD_UV)
  }
}

/** Tent 2 — A-frame closer to AABB (~2.5×1.85×1.8) with oil canvas UV. */
export function addTent(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  const w = 1.35 * scale
  const d = 1.05 * scale
  const h = 1.75 * scale
  const peak = h
  // two long canvas slopes
  b.quad(
    x - w, y, z - d, x + w, y, z - d, x + w * 0.12, y + peak, z, x - w * 0.12, y + peak, z,
    CANVAS, KIND_PROP, x, y + peak * 0.5, z, WOOD_UV,
  )
  b.quad(
    x + w, y, z + d, x - w, y, z + d, x - w * 0.12, y + peak, z, x + w * 0.12, y + peak, z,
    CANVAS, KIND_PROP, x, y + peak * 0.5, z, WOOD_UV,
  )
  // end triangles
  b.triangle(x - w, y, z - d, CANVAS, x - w, y, z + d, CANVAS, x - w * 0.12, y + peak, z, CANVAS, KIND_PROP, x, y + 0.6 * scale, z)
  b.triangle(x + w, y, z + d, CANVAS, x + w, y, z - d, CANVAS, x + w * 0.12, y + peak, z, CANVAS, KIND_PROP, x, y + 0.6 * scale, z)
  // ridge pole + guy stakes
  cyl(b, x, y + peak * 0.15, z, y + peak, 0.035 * scale, WOOD_DARK, 5)
  for (const [sx, sz] of [[-w, -d], [w, -d], [-w, d], [w, d]] as const) {
    cyl(b, x + sx, y, z + sz, y + 0.35 * scale, 0.025 * scale, WOOD_DARK, 4)
  }
}

/** Dock into water — deck sits on sampled height (CustomSRP Y via heightmap). */
export function addDock(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const deckY = Math.max(SEA + 0.2, groundY(x, z))
  const len = 5.5 * scale
  const wid = 1.4 * scale
  const [cx, cz] = rot(0, len * 0.5, yaw)
  box(b, x + cx, deckY - 0.08 * scale, z + cz, wid * 0.5, 0.12 * scale, len * 0.5, yaw, WOOD)
  for (let i = 0; i < 4; i++) {
    const [px, pz] = rot((i % 2 === 0 ? -0.5 : 0.5) * scale, (0.6 + Math.floor(i / 2) * 2.2) * scale, yaw)
    cyl(b, x + px, Math.min(SEA - 0.4, deckY - 1.5 * scale), z + pz, deckY, 0.1 * scale, WOOD_DARK, 5)
  }
}

/** Short pier / bridge segment — deck follows terrain height. */
export function addBridge(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z) + 0.35 * scale
  const len = 6.5 * scale
  const wid = 1.35 * scale
  box(b, x, y - 0.08 * scale, z, wid * 0.5, 0.14 * scale, len * 0.5, yaw, WOOD, KIND_PROP, WOOD_UV)
  for (const side of [-1, 1]) {
    const [rx, rz] = rot(side * wid * 0.48, 0, yaw)
    box(b, x + rx, y, z + rz, 0.06 * scale, 0.55 * scale, len * 0.5, yaw, WOOD_DARK, KIND_PROP, WOOD_UV)
  }
  for (let i = 0; i < 4; i++) {
    const [px, pz] = rot(0, (i - 1.5) * 1.6 * scale, yaw)
    const gy = groundY(x + px, z + pz)
    cyl(b, x + px, gy - 0.15, z + pz, y, 0.1 * scale, WOOD_DARK, 5)
  }
}

/** Distant mountain silhouette. */
export function addMountain(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  const h = 8 * scale
  const w = 6 * scale
  b.triangle(
    x - w, y, z, MOUNTAIN,
    x + w, y, z, MOUNTAIN,
    x, y + h, z - 0.5 * scale, MOUNTAIN,
    KIND_PROP, x, y + h * 0.3, z,
  )
  b.triangle(
    x - w * 0.55, y, z + 1.2 * scale, MOUNTAIN,
    x + w * 0.35, y, z + 1.2 * scale, MOUNTAIN,
    x - 0.4 * scale, y + h * 0.72, z + 0.4 * scale, ROCK_DARK,
    KIND_PROP, x, y + h * 0.3, z,
  )
}

/** Flower plant (Hua). */
export function addFlower(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  const stem = 0.45 * scale
  cyl(b, x, y, z, y + stem, 0.02 * scale, LEAF, 4)
  const col = ((Math.floor(x * 12 + z * 7) & 1) === 0) ? FLOWER : FLOWER_Y
  for (let i = 0; i < 3; i++) {
    const a = i * 2.094
    const c = Math.cos(a), s = Math.sin(a)
    const w = 0.12 * scale
    b.card(
      x - c * w, y + stem * 0.85, z - s * w,
      x + c * w, y + stem * 0.85, z + s * w,
      x + c * w * 0.6, y + stem + 0.16 * scale, z + s * w * 0.6,
      x - c * w * 0.6, y + stem + 0.16 * scale, z - s * w * 0.6,
      col, col, col, col, KIND_GRASS,
    )
  }
}

/** Dead trunk / stump (ZaWu). */
export function addDeadTree(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  const h = 2.4 * scale
  // tapered trunk with bark oil (triplanar KIND_BARK via color only — use PROP+wood UV)
  cyl(b, x, y, z, y + h * 0.55, 0.16 * scale, WOOD_DARK, 6)
  cyl(b, x, y + h * 0.5, z, y + h, 0.09 * scale, WOOD_DARK, 5)
  for (const a of [0.5, 1.9, 3.4]) {
    const len = (0.55 + (a % 1) * 0.35) * scale
    const by = y + (0.9 + (a % 1.2) * 0.5) * scale
    const [tx, tz] = rot(Math.cos(a) * len, Math.sin(a) * len, 0)
    b.quad(
      x, by, z,
      x + tx, by + 0.12 * scale, z + tz,
      x + tx * 0.95, by + 0.22 * scale, z + tz * 0.95,
      x, by + 0.14 * scale, z,
      WOOD_DARK, KIND_PROP, x, by, z, WOOD_UV,
    )
  }
}

export function addBarrel(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  cyl(b, x, y, z, y + 0.7 * scale, 0.28 * scale, WOOD, 8)
}

export function addCrate(b: Builder, x: number, z: number, scale = 1): void {
  const y = groundY(x, z)
  box(b, x, y, z, 0.32 * scale, 0.4 * scale, 0.32 * scale, 0.2, WOOD)
}

export function addBench(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z)
  box(b, x, y + 0.32 * scale, z, 0.7 * scale, 0.08 * scale, 0.22 * scale, yaw, WOOD)
  const [lx, lz] = rot(-0.55 * scale, 0, yaw)
  const [rx, rz] = rot(0.55 * scale, 0, yaw)
  box(b, x + lx, y, z + lz, 0.06 * scale, 0.32 * scale, 0.06 * scale, yaw, WOOD_DARK)
  box(b, x + rx, y, z + rz, 0.06 * scale, 0.32 * scale, 0.06 * scale, yaw, WOOD_DARK)
}

export function addWagon(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z)
  box(b, x, y + 0.35 * scale, z, 0.9 * scale, 0.45 * scale, 0.5 * scale, yaw, WOOD)
  for (const side of [-1, 1]) {
    for (const along of [-1, 1]) {
      const [wx, wz] = rot(along * 0.7 * scale, side * 0.55 * scale, yaw)
      cyl(b, x + wx, y, z + wz, y + 0.45 * scale, 0.18 * scale, WOOD_DARK, 6)
    }
  }
}

export function addFence(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = groundY(x, z)
  for (let i = 0; i < 4; i++) {
    const [px, pz] = rot((i - 1.5) * 0.7 * scale, 0, yaw)
    cyl(b, x + px, y, z + pz, y + 0.85 * scale, 0.05 * scale, WOOD_DARK, 5)
  }
  for (const h of [0.3, 0.65]) {
    const [a0x, a0z] = rot(-1.2 * scale, 0, yaw)
    const [a1x, a1z] = rot(1.2 * scale, 0, yaw)
    b.quad(
      x + a0x, y + h * scale, z + a0z,
      x + a1x, y + h * scale, z + a1z,
      x + a1x, y + (h + 0.08) * scale, z + a1z,
      x + a0x, y + (h + 0.08) * scale, z + a0z,
      WOOD, KIND_PROP, x, y + 0.5 * scale, z,
    )
  }
}

export function addCanoe(b: Builder, x: number, z: number, yaw = 0, scale = 1): void {
  const y = Math.max(SEA + 0.05, groundY(x, z))
  const len = 1.85 * scale
  const wid = 0.38 * scale
  box(b, x, y, z, wid, 0.2 * scale, len * 0.72, yaw, WOOD_DARK, KIND_PROP, WOOD_UV)
  // pointed bow + stern
  for (const dir of [1, -1] as const) {
    const [fx, fz] = rot(0, dir * (len + 0.15 * scale), yaw)
    const [lx, lz] = rot(-wid, dir * len * 0.72, yaw)
    const [rx, rz] = rot(wid, dir * len * 0.72, yaw)
    b.triangle(
      x + lx, y, z + lz, WOOD,
      x + rx, y, z + rz, WOOD,
      x + fx, y + 0.12 * scale, z + fz, WOOD_DARK,
      KIND_PROP, x, y, z,
    )
  }
}

/** Day FX: a few butterfly cards. */
export function addButterflies(b: Builder, x: number, z: number): void {
  const y = groundY(x, z) + 1.2
  const tint: RGB = [0.95, 0.75, 0.35]
  for (let i = 0; i < 3; i++) {
    const px = x + (i - 1) * 0.4
    const pz = z + (i % 2) * 0.3
    b.card(px - 0.08, y + i * 0.15, pz, px + 0.08, y + i * 0.15, pz, px + 0.06, y + 0.12 + i * 0.15, pz, px - 0.06, y + 0.12 + i * 0.15, pz, tint, tint, tint, tint, KIND_GRASS)
  }
}

export function finishProps(b: Builder): MeshData {
  return b.empty ? emptyMesh() : b.finish(true, true)
}

export function newPropBuilder(): Builder {
  return new Builder()
}
