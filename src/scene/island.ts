/**
 * Meadow from beautiful-wonderland. Metres, Y up, pond at the origin.
 * West (sunset) is -X, south is +Z.
 */
export const TERRAIN_SIZE = 760
export const WALK_R = 248
export const WATER_Y = 0

export type SceneKind = 'meadow'

const POND = { x: 0, z: 0, r: 50 }
const HILL = { x: -112, z: -74, h: 20, s: 36 }
const FOREST = { x: 62, z: -132, r: 80 }
const PATH: Array<[number, number]> = [[118, -92], [92, -66], [74, -40], [62, -18], [56, 2], [52, 8]]

function h2(ix: number, iy: number): number {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296
}

export function valueNoise2(x: number, y: number): number {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = x - ix
  const fy = y - iy
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10)
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10)
  const a = h2(ix, iy)
  const b = h2(ix + 1, iy)
  const c = h2(ix, iy + 1)
  const d = h2(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}

export function fbm2(x: number, y: number, oct = 5): number {
  let a = 0.5
  let s = 0
  for (let i = 0; i < oct; i++) {
    s += a * valueNoise2(x, y)
    x = x * 2.03 + 17.1
    y = y * 2.03 + 9.3
    a *= 0.5
  }
  return s
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export function pondRadius(theta: number): number {
  return POND.r
    + 8 * Math.sin(2 * theta + 1.0)
    + 5.5 * Math.sin(3 * theta + 0.3)
    + 3.5 * Math.sin(5 * theta + 2.1)
}

/** Signed distance to the shoreline. Negative is in the pond. */
export function shoreDist(x: number, z: number): number {
  const dx = x - POND.x
  const dz = z - POND.z
  return Math.hypot(dx, dz) - pondRadius(Math.atan2(dz, dx))
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const vx = bx - ax
  const vz = bz - az
  const wx = px - ax
  const wz = pz - az
  const t = Math.max(0, Math.min(1, (wx * vx + wz * vz) / (vx * vx + vz * vz)))
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t))
}

export function pathDist(x: number, z: number): number {
  let d = 1e9
  for (let i = 0; i < PATH.length - 1; i++) {
    d = Math.min(d, segDist(x, z, PATH[i][0], PATH[i][1], PATH[i + 1][0], PATH[i + 1][1]))
  }
  return d
}

export function height(x: number, z: number): number {
  let h = 2.4
    + (fbm2(x * 0.0075 + 3.1, z * 0.0075 + 1.7) - 0.5) * 13
    + (fbm2(x * 0.031 + 9, z * 0.031) - 0.5) * 2.2
  const hx = x - HILL.x
  const hz = z - HILL.z
  h += HILL.h * Math.exp(-(hx * hx + hz * hz) / (2 * HILL.s * HILL.s))
  h += 13 * smoothstep(-190, -330, x) * (0.55 + 0.45 * valueNoise2(z * 0.012 + 4, 2.2))
  const fx = x - FOREST.x
  const fz = z - FOREST.z
  h += 4 * Math.exp(-(fx * fx + fz * fz) / (2 * 70 * 70))
  const pd = pathDist(x, z)
  h = h + (2.1 - h) * 0.55 * smoothstep(9, 1.5, pd)
  const sd = shoreDist(x, z)
  const bed = Math.max(-1.7, -0.22 + sd * 0.13)
  h = bed + (h - bed) * smoothstep(-2, 13, sd)
  return h
}

export function forestAmount(x: number, z: number): number {
  const d = Math.hypot(x - FOREST.x, z - FOREST.z)
  return smoothstep(FOREST.r + 12, FOREST.r - 14, d + (valueNoise2(x * 0.04, z * 0.04) - 0.5) * 26)
}

export const HILL_POS = HILL
export const FOREST_POS = FOREST

/** South-east meadow, looking back toward the pond. */
export const SCENE_SPAWN = { x: 86, z: 58, yaw: Math.atan2(-86, -58) }
