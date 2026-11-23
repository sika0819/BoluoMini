/**
 * CustomSRP island frame: shared heightmap + per-preset local origin (TargetPos.xz).
 * Local XZ = worldXZ - origin; Y stays world meters (sea ≈ 0).
 */
import {
  HEIGHT_MAX,
  HEIGHT_MIN_X,
  HEIGHT_MIN_Z,
  HEIGHT_RES,
  HEIGHT_SIZE_X,
  HEIGHT_SIZE_Z,
  HEIGHT_U16,
  PRESET_LAYOUTS,
  WINDOW_R,
  type PresetLayout,
} from './data/layout.gen'

export const SEA = 0
export const SHORE = 0.35
export const ISLAND_RADIUS = WINDOW_R

export type Cover = 'sand' | 'grass' | 'rock'
/** Ten presets = ten scenes (1:1 with catalog). */
export type SceneKind =
  | 'p01' | 'p02' | 'p03' | 'p04' | 'p05'
  | 'p06' | 'p07' | 'p08' | 'p09' | 'p10'

let active: PresetLayout = PRESET_LAYOUTS[0]

export function setActivePreset(id: SceneKind | string): PresetLayout {
  const found = PRESET_LAYOUTS.find((p) => p.id === id) ?? PRESET_LAYOUTS[0]
  active = found
  return active
}

export function activePreset(): PresetLayout {
  return active
}

export function originX(): number { return active.ox }
export function originZ(): number { return active.oz }
export function originY(): number { return active.oy }

/** World XZ from local. */
export function toWorld(lx: number, lz: number): { x: number; z: number } {
  return { x: lx + active.ox, z: lz + active.oz }
}

/** Local XZ from world. */
export function toLocal(wx: number, wz: number): { x: number; z: number } {
  return { x: wx - active.ox, z: wz - active.oz }
}

function sampleHeightWorld(wx: number, wz: number): number {
  const u = (wx - HEIGHT_MIN_X) / HEIGHT_SIZE_X
  const v = (wz - HEIGHT_MIN_Z) / HEIGHT_SIZE_Z
  if (u < -0.02 || v < -0.02 || u > 1.02 || v > 1.02) return -1.2
  const x = Math.max(0, Math.min(HEIGHT_RES - 1.001, u * (HEIGHT_RES - 1)))
  const z = Math.max(0, Math.min(HEIGHT_RES - 1.001, v * (HEIGHT_RES - 1)))
  const x0 = Math.floor(x)
  const z0 = Math.floor(z)
  const x1 = Math.min(HEIGHT_RES - 1, x0 + 1)
  const z1 = Math.min(HEIGHT_RES - 1, z0 + 1)
  const tx = x - x0
  const tz = z - z0
  const h = (ix: number, iz: number) => (HEIGHT_U16[iz * HEIGHT_RES + ix] / 65535) * HEIGHT_MAX
  const h00 = h(x0, z0)
  const h10 = h(x1, z0)
  const h01 = h(x0, z1)
  const h11 = h(x1, z1)
  return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz
}

/** Terrain height in world Y at local (lx, lz). */
export function height(lx: number, lz: number): number {
  return sampleHeightWorld(lx + active.ox, lz + active.oz)
}

export function heightWorld(wx: number, wz: number): number {
  return sampleHeightWorld(wx, wz)
}

export function slope(lx: number, lz: number): number {
  const e = 0.85
  const hx = height(lx + e, lz) - height(lx - e, lz)
  const hz = height(lx, lz + e) - height(lx, lz - e)
  const ny = e * 2
  const len = Math.hypot(hx, ny, hz) || 1
  return 1 - ny / len
}

export function cover(lx: number, lz: number): Cover {
  const h = height(lx, lz)
  if (h < 1.2) return 'sand'
  if (slope(lx, lz) > 0.55 || h > 90) return 'rock'
  return 'grass'
}

/** Spawn is always local origin (CustomSRP TargetPos). */
export const SCENE_SPAWN: Record<SceneKind, { x: number; z: number; yaw: number }> =
  Object.fromEntries(
    PRESET_LAYOUTS.map((p) => [p.id, { x: 0, z: 0, yaw: p.yaw }]),
  ) as Record<SceneKind, { x: number; z: number; yaw: number }>

export const SPAWN = SCENE_SPAWN.p01

/** Landmark helpers: search current preset window items via world→local. */
export function landmarkLocal(
  kind: string,
  fallback: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  // filled by world when layout items are known; default near spawn
  void kind
  return fallback
}
