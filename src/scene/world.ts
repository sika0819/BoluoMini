/**
 * Build per-preset local scenes from CustomSRP layout data (shared height + windowed items).
 */
import {
  cover, height, heightWorld, SEA, SCENE_SPAWN, setActivePreset, SHORE, slope,
  toLocal, type SceneKind,
} from './island'
import { pineappleHouse } from './house'
import {
  Builder, emptyMesh, hash, KIND_CLOUD, KIND_FALLS, KIND_GRASS, KIND_GROUND,
  KIND_PROP, KIND_RAIN, KIND_WATER, shade, type MeshData, type RGB,
} from './mesh'
import {
  addBarrel, addBench, addBridge, addButterflies, addCampfire, addCanoe, addCliff,
  addCrate, addDeadTree, addDock, addFarmhouse, addFence, addFlower, addMountain,
  addShed, addTent, addWagon, finishProps, newPropBuilder,
} from './props'
import { ITEMS, PRESET_LAYOUTS, WINDOW_R, type LayoutItem } from './data/layout.gen'
import { buildPlaced } from './placed'
import { OCEAN_Y } from './collide'
import { FALLS_SPECS, RIVER_PATHS, type FallsSpec, type RiverPath } from './data/water.gen'

export type { MeshData, SceneKind }
export { height, SEA, SHORE, SCENE_SPAWN }

export {
  KIND_GROUND, KIND_WATER, KIND_GRASS, KIND_RAIN, KIND_FIRE, KIND_CLOUD, KIND_PROP,
} from './mesh'

const SAND: RGB = [0.76, 0.68, 0.48]
const GROUND: RGB = [0.36, 0.52, 0.22]
const ROCK: RGB = [0.48, 0.46, 0.42]
const BARK: RGB = [0.42, 0.30, 0.18]
const LEAF_TOP: RGB = [0.50, 0.74, 0.18]
const LEAF_BOTTOM: RGB = [0.24, 0.44, 0.10]
const CLOUD: RGB = [0.93, 0.94, 0.96]
const WATER: RGB = [0.16, 0.52, 0.72]
const FOAM: RGB = [0.82, 0.9, 0.94]

type Spot = { x: number; z: number; scale: number; kind: 'pine' | 'leaf' | 'palm' | 'bush'; yaw: number }

function terrainMesh(): MeshData {
  const b = new Builder()
  const half = WINDOW_R + 8
  const step = 2.0
  const n = Math.floor((half * 2) / step) + 1
  // Pre-sample + light blur so adjacent verts share one height (no cracks / pits).
  const ys = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      ys[iz * n + ix] = height(-half + ix * step, -half + iz * step)
    }
  }
  const smooth = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      let sum = 0, w = 0
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = ix + dx, z = iz + dz
          if (x < 0 || z < 0 || x >= n || z >= n) continue
          const ww = dx === 0 && dz === 0 ? 2 : 1
          sum += ys[z * n + x] * ww
          w += ww
        }
      }
      smooth[iz * n + ix] = sum / w
    }
  }
  // Clamp neighbor deltas so one bad sample cannot punch a hole.
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const i = iz * n + ix
      let lo = smooth[i], hi = smooth[i]
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue
          const x = ix + dx, z = iz + dz
          if (x < 0 || z < 0 || x >= n || z >= n) continue
          const v = smooth[z * n + x]
          if (v < lo) lo = v
          if (v > hi) hi = v
        }
      }
      const mid = (lo + hi) * 0.5
      const maxDelta = 6
      if (smooth[i] < mid - maxDelta) smooth[i] = mid - maxDelta
      if (smooth[i] > mid + maxDelta) smooth[i] = mid + maxDelta
    }
  }
  for (let iz = 0; iz < n - 1; iz++) {
    for (let ix = 0; ix < n - 1; ix++) {
      const x0 = -half + ix * step
      const z0 = -half + iz * step
      const x1 = x0 + step
      const z1 = z0 + step
      const y00 = smooth[iz * n + ix]
      const y10 = smooth[iz * n + ix + 1]
      const y01 = smooth[(iz + 1) * n + ix]
      const y11 = smooth[(iz + 1) * n + ix + 1]
      const c00 = y00 < 1.0 ? SAND : y00 > 85 || slope(x0, z0) > 0.55 ? ROCK : GROUND
      const c10 = y10 < 1.0 ? SAND : y10 > 85 || slope(x1, z0) > 0.55 ? ROCK : GROUND
      const c01 = y01 < 1.0 ? SAND : y01 > 85 || slope(x0, z1) > 0.55 ? ROCK : GROUND
      const c11 = y11 < 1.0 ? SAND : y11 > 85 || slope(x1, z1) > 0.55 ? ROCK : GROUND
      // Ref below the quad so face() always keeps an upward normal (no backface holes).
      const minY = Math.min(y00, y10, y01, y11)
      const cx = (x0 + x1) * 0.5
      const cz = (z0 + z1) * 0.5
      b.face(
        [x0, y00, z0], [x1, y10, z0], [x1, y11, z1], [x0, y01, z1],
        [shade(c00, x0, z0), shade(c10, x1, z0), shade(c11, x1, z1), shade(c01, x0, z1)],
        KIND_GROUND, cx, minY - 4, cz,
      )
    }
  }
  // doubleSided: belt-and-suspenders against any remaining winding flips
  const mesh = b.finish(true, true)
  mesh.role = 'ground'
  return mesh
}

function waterMesh(): MeshData {
  const b = new Builder()
  // One giant quad crosses the camera and gets clipped away. A grid stays visible.
  const half = 220
  const y = OCEAN_Y - 0.02
  const step = 16
  const n = Math.round((half * 2) / step)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x0 = -half + i * step
      const z0 = -half + j * step
      const x1 = x0 + step
      const z1 = z0 + step
      b.quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1, WATER, KIND_WATER, (x0 + x1) * 0.5, y - 4, (z0 + z1) * 0.5)
    }
  }
  const mesh = b.finish(false, true)
  mesh.reflect = false
  return mesh
}

function addPrism(
  b: Builder,
  x0: number, y0: number, z0: number, r0: number,
  x1: number, y1: number, z1: number, r1: number,
  color: RGB,
): void {
  const sides = 5
  const refX = (x0 + x1) * 0.5
  const refY = (y0 + y1) * 0.5
  const refZ = (z0 + z1) * 0.5
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2
    const a1 = ((i + 1) / sides) * Math.PI * 2
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    b.quad(
      x0 + c0 * r0, y0, z0 + s0 * r0,
      x0 + c1 * r0, y0, z0 + s1 * r0,
      x1 + c1 * r1, y1, z1 + s1 * r1,
      x1 + c0 * r1, y1, z1 + s0 * r1,
      color, KIND_PROP, refX, refY, refZ,
    )
  }
}

function addLeafCard(
  b: Builder,
  x: number, y: number, z: number,
  yaw: number, w: number, h: number, lean: number,
): void {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const tipX = x + Math.sin(yaw) * lean
  const tipZ = z - Math.cos(yaw) * lean
  b.card(
    x - c * w, y, z - s * w,
    x + c * w, y, z + s * w,
    tipX + c * w * 0.45, y + h, tipZ + s * w * 0.45,
    tipX - c * w * 0.45, y + h, tipZ - s * w * 0.45,
    LEAF_BOTTOM, LEAF_BOTTOM, LEAF_TOP, LEAF_TOP, KIND_GRASS,
  )
}

function addTree(b: Builder, tree: Spot): void {
  const y = height(tree.x, tree.z) - 0.05
  const s = tree.scale
  if (tree.kind === 'bush') {
    for (let i = 0; i < 5; i++) {
      addLeafCard(b, tree.x + Math.cos(i * 1.25) * 0.12 * s, y, tree.z + Math.sin(i * 1.25) * 0.12 * s, i * 1.25, 0.28 * s, 0.55 * s, 0.08 * s)
    }
    return
  }
  if (tree.kind === 'palm') {
    const yaw = tree.yaw || hash(tree.x, tree.z) * Math.PI * 2
    const tall = 2.6 * s
    for (let i = 0; i < 5; i++) {
      const t0 = i / 5, t1 = (i + 1) / 5
      const lean0 = t0 * t0 * 1.1 * s
      const lean1 = t1 * t1 * 1.1 * s
      addPrism(
        b,
        tree.x + Math.cos(yaw) * lean0, y + t0 * tall, tree.z + Math.sin(yaw) * lean0, (0.15 - t0 * 0.05) * s,
        tree.x + Math.cos(yaw) * lean1, y + t1 * tall, tree.z + Math.sin(yaw) * lean1, (0.15 - t1 * 0.05) * s,
        BARK,
      )
    }
    const topX = tree.x + Math.cos(yaw) * 1.1 * s
    const topZ = tree.z + Math.sin(yaw) * 1.1 * s
    const topY = y + tall
    for (let i = 0; i < 6; i++) {
      const a = yaw + (i / 6) * Math.PI * 2
      const len = 1.55 * s
      const dx = Math.cos(a), dz = Math.sin(a)
      const px = -dz, pz = dx
      b.card(
        topX + px * 0.06, topY, topZ + pz * 0.06,
        topX - px * 0.06, topY, topZ - pz * 0.06,
        topX + dx * len - px * 0.28, topY + 0.2 * s - 0.35 * s, topZ + dz * len - pz * 0.28,
        topX + dx * len + px * 0.28, topY + 0.2 * s - 0.35 * s, topZ + dz * len + pz * 0.28,
        LEAF_BOTTOM, LEAF_BOTTOM, LEAF_TOP, LEAF_TOP, KIND_GRASS,
      )
    }
    return
  }
  if (tree.kind === 'pine') {
    addPrism(b, tree.x, y, tree.z, 0.14 * s, tree.x, y + 1.5 * s, tree.z, 0.06 * s, BARK)
    for (let layer = 0; layer < 3; layer++) {
      const yy = y + (1.0 + layer * 0.72) * s
      const rad = (1.05 - layer * 0.28) * s
      const hh = (0.85 - layer * 0.08) * s
      for (let i = 0; i < 6; i++) {
        addLeafCard(b, tree.x, yy, tree.z, (i / 6) * Math.PI * 2 + layer * 0.2, rad * 0.55, hh, rad * 0.35)
      }
    }
    return
  }
  addPrism(b, tree.x, y, tree.z, 0.18 * s, tree.x, y + 1.0 * s, tree.z, 0.1 * s, BARK)
  for (let i = 0; i < 10; i++) {
    const yaw = (i / 10) * Math.PI * 2
    const lift = 0.7 + (i % 3) * 0.22
    addLeafCard(b, tree.x + Math.cos(yaw) * 0.2 * s, y + lift * s, tree.z + Math.sin(yaw) * 0.2 * s, yaw, 0.55 * s, 0.95 * s, 0.35 * s)
  }
}

function grassBlade(b: Builder, x: number, z: number): void {
  const y = height(x, z)
  const yaw0 = hash(x, z) * Math.PI
  const k = 0.92 + hash(x + 1, z + 1) * 0.16
  const bottom: RGB = [LEAF_BOTTOM[0] * k, LEAF_BOTTOM[1] * k, LEAF_BOTTOM[2] * k]
  const top: RGB = [LEAF_TOP[0] * k, LEAF_TOP[1] * k, LEAF_TOP[2] * k]
  const tall = 0.7
  const w = 0.18
  const card = (yaw: number, ox: number, oz: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw)
    const px = x + ox, pz = z + oz
    for (let r = 0; r < 3; r++) {
      const t0 = r / 3
      const t1 = (r + 1) / 3
      const lean0 = t0 * t0 * 0.12
      const lean1 = t1 * t1 * 0.12
      const w0 = w * (1 - t0 * 0.35)
      const w1 = w * (1 - t1 * 0.35)
      const y0 = y + tall * t0
      const y1 = y + tall * t1
      const c0 = t0 < 0.45 ? bottom : top
      const c1 = t1 < 0.45 ? bottom : top
      b.card(
        px - c * w0 + s * lean0, y0, pz - s * w0 - c * lean0,
        px + c * w0 + s * lean0, y0, pz + s * w0 - c * lean0,
        px + c * w1 + s * lean1, y1, pz + s * w1 - c * lean1,
        px - c * w1 + s * lean1, y1, pz - s * w1 - c * lean1,
        c0, c0, c1, c1, KIND_GRASS,
      )
    }
  }
  card(yaw0, 0.04, 0.03)
  card(yaw0 + 2.1, -0.04, 0.04)
  card(yaw0 + 4.0, 0.02, -0.05)
}

function addRock(b: Builder, x: number, z: number, scale: number): void {
  const y = height(x, z) - 0.08 * scale
  const sides = 5
  const rad = scale * (0.55 + hash(x + 1, z) * 0.35)
  const top = scale * (0.65 + hash(x, z + 1) * 0.55)
  const color = shade(ROCK, x, z)
  const refY = y + top * 0.4
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2 + hash(x, z)
    const a1 = ((i + 1) / sides) * Math.PI * 2 + hash(x, z)
    const c0 = Math.cos(a0), s0 = Math.sin(a0)
    const c1 = Math.cos(a1), s1 = Math.sin(a1)
    b.quad(
      x + c0 * rad, y, z + s0 * rad,
      x + c1 * rad, y, z + s1 * rad,
      x + c1 * rad * 0.35, y + top, z + s1 * rad * 0.35,
      x + c0 * rad * 0.35, y + top, z + s0 * rad * 0.35,
      color, KIND_PROP, x, refY, z,
    )
  }
}

const CLOUD_UV = [[0, 0], [1, 0], [1, 1], [0, 1]] as const

/** One painted cumulus card. UVs drive the puff cut-out in the cloud shader. */
function cloudCard(
  b: Builder,
  x: number, y: number, z: number,
  yaw: number, w: number, h: number, lift: number,
): void {
  const c = Math.cos(yaw), s = Math.sin(yaw)
  b.card(
    x - c * w, y, z - s * w,
    x + c * w, y, z + s * w,
    x + c * w * 0.78 + s * lift, y + h, z + s * w * 0.78 - c * lift,
    x - c * w * 0.78 + s * lift, y + h, z - s * w * 0.78 - c * lift,
    CLOUD, CLOUD, CLOUD, CLOUD, KIND_CLOUD, CLOUD_UV,
  )
}

function cloudMesh(): MeshData {
  const b = new Builder()
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    const rad = 34 + (i % 3) * 6
    const x = Math.cos(a) * rad
    const z = Math.sin(a) * rad * 0.72
    const y = 20 + (i % 3) * 2.5
    const puff = 3 + (i % 2)
    for (let k = 0; k < puff; k++) {
      const yaw = a + k * 0.9
      const ox = Math.cos(yaw) * (k - 1) * 3.2
      const oz = Math.sin(yaw) * (k - 1) * 2.4
      const w = 12.0 + (k % 2) * 3.5
      const h = 4.6 + (k % 3) * 0.9
      cloudCard(b, x + ox, y + k * 0.6, z + oz, yaw, w, h, 0.4)
      if (k === 1) cloudCard(b, x + ox, y + 1.2, z + oz, yaw + 1.2, w * 0.72, h * 0.85, 0.2)
    }
  }
  return b.finish(false, true)
}

function rainMesh(scene: SceneKind): MeshData {
  const b = new Builder()
  const spawn = SCENE_SPAWN[scene]
  const tint: RGB = [0.9, 0.92, 0.95]
  const baseY = height(0, 0) + 8
  for (let i = 0; i < 24; i++) {
    const x = spawn.x + (i % 6) * 2 - 5
    const z = spawn.z + Math.floor(i / 6) * 2 - 3
    const y = baseY + (i % 3)
    b.card(x, y, z, x + 0.05, y, z, x + 0.05, y - 0.8, z + 0.2, x, y - 0.8, z + 0.2, tint, tint, tint, tint, KIND_RAIN)
  }
  return b.finish(false, true)
}

/** Drape a CustomSRP river centerline onto BoluoMini terrain height. */
function addRiverPath(b: Builder, path: RiverPath, ox: number, oz: number): number {
  const pts = path.center
  if (pts.length < 2) return 0
  let segs = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0] - ox, az = pts[i][2] - oz
    const bx = pts[i + 1][0] - ox, bz = pts[i + 1][2] - oz
    // Skip segments fully outside the window.
    if (Math.hypot(ax, az) > WINDOW_R + 20 && Math.hypot(bx, bz) > WINDOW_R + 20) continue
    const dx = bx - ax, dz = bz - az
    const len = Math.hypot(dx, dz) || 1
    const px = -dz / len, pz = dx / len
    const w0 = (path.width[i] ?? 8) * 0.5
    const w1 = (path.width[i + 1] ?? w0 * 2) * 0.5
    const y0 = height(ax, az) + 0.22
    const y1 = height(bx, bz) + 0.22
    b.quad(
      ax + px * w0, y0, az + pz * w0,
      ax - px * w0, y0, az - pz * w0,
      bx - px * w1, y1, bz - pz * w1,
      bx + px * w1, y1, bz + pz * w1,
      WATER, KIND_WATER, (ax + bx) * 0.5, (y0 + y1) * 0.5, (az + bz) * 0.5,
    )
    segs++
  }
  return segs
}

/** CustomSRP waterfall sheet / splash / mist — real size & yaw; vertical span from terrain. */
function addFallsSpec(b: Builder, spec: FallsSpec, ox: number, oz: number): void {
  const x = spec.x - ox
  const z = spec.z - oz
  if (Math.hypot(x, z) > WINDOW_R + 25) return
  const ground = height(x, z)
  // Keep CustomSRP height proportions, but anchor bottom to local terrain.
  const top = ground + Math.max(6, spec.tall * 0.45)
  const bot = ground + spec.base
  const yaw = spec.yaw
  const c = Math.cos(yaw), s = Math.sin(yaw)
  const hw = spec.halfW
  const mist: RGB = [0.72, 0.86, 0.94]
  b.card(
    x - c * hw, top, z - s * hw,
    x + c * hw, top, z + s * hw,
    x + c * hw * 0.92, bot, z + s * hw * 0.92,
    x - c * hw * 0.92, bot, z - s * hw * 0.92,
    mist, mist, FOAM, FOAM, KIND_FALLS,
  )
  const sx = -s * Math.min(2.5, hw * 0.25), sz = c * Math.min(2.5, hw * 0.25)
  b.card(
    x - c * hw * 0.4 + sx, top, z - s * hw * 0.4 + sz,
    x + c * hw * 0.4 + sx, top, z + s * hw * 0.4 + sz,
    x + c * hw * 0.35 + sx, bot, z + s * hw * 0.35 + sz,
    x - c * hw * 0.35 + sx, bot, z - s * hw * 0.35 + sz,
    mist, mist, FOAM, FOAM, KIND_FALLS,
  )
  b.card(
    x - hw * 0.4, bot, z,
    x + hw * 0.4, bot, z,
    x + hw * 0.3, bot + Math.min(2.2, spec.tall * 0.08), z - s * 0.6,
    x - hw * 0.3, bot + Math.min(2.2, spec.tall * 0.08), z - s * 0.6,
    FOAM, FOAM, FOAM, FOAM, KIND_CLOUD,
  )
}

function buildInlandWater(ox: number, oz: number): { river: MeshData; falls: MeshData } {
  const riverB = new Builder()
  const fallsB = new Builder()
  for (const path of RIVER_PATHS) addRiverPath(riverB, path, ox, oz)
  for (const spec of FALLS_SPECS) addFallsSpec(fallsB, spec, ox, oz)
  const river = riverB.empty ? emptyMesh() : riverB.finish(false, true)
  river.reflect = false
  return {
    river,
    falls: fallsB.empty ? emptyMesh() : fallsB.finish(false, true),
  }
}

function placeItem(
  trees: Spot[],
  props: Builder,
  rocks: Builder,
  grass: Builder,
  it: LayoutItem,
): void {
  // Rivers / falls come from CustomSRP mesh paths (water.gen), not MapItem points.
  if (it.k === 'river' || it.k === 'falls' || it.k === 'water' || it.k === 'lake' || it.k === 'fx') return
  const loc = toLocal(it.x, it.z)
  const x = loc.x
  const z = loc.z
  if (Math.hypot(x, z) > WINDOW_R + 6) return
  const yaw = it.yaw
  const s = Math.max(0.35, Math.min(it.s, 4))
  switch (it.k) {
    case 'pine':
    case 'leaf':
    case 'palm':
    case 'bush':
      trees.push({ x, z, scale: s * (it.k === 'bush' ? 0.9 : 0.75), kind: it.k, yaw })
      break
    case 'grass':
      grassBlade(grass, x, z)
      break
    case 'flower':
      addFlower(props, x, z, s)
      break
    case 'dead':
      addDeadTree(props, x, z, s)
      break
    case 'rock':
      addRock(rocks, x, z, 0.55 * s)
      break
    case 'cliff':
      addCliff(props, x, z, yaw, Math.min(s, 1.6))
      break
    case 'campfire':
      addCampfire(props, x, z, Math.min(s, 1.2))
      break
    case 'pineapple':
      break
    case 'farmhouse':
      addFarmhouse(props, x, z, yaw, Math.min(s, 1.4))
      break
    case 'shed':
      addShed(props, x, z, yaw, Math.min(s, 1.3))
      break
    case 'tent':
      addTent(props, x, z, Math.min(s, 1.2))
      break
    case 'dock':
      addDock(props, x, z, yaw, Math.min(s, 1.5))
      break
    case 'bridge':
      addBridge(props, x, z, yaw, Math.max(1.1, Math.min(s, 1.8)))
      break
    case 'mountain':
      addMountain(props, x, z, Math.min(s, 2))
      break
    case 'barrel':
      addBarrel(props, x, z, s)
      break
    case 'crate':
      addCrate(props, x, z, s)
      break
    case 'bench':
      addBench(props, x, z, yaw, s)
      break
    case 'wagon':
      addWagon(props, x, z, yaw, s)
      break
    case 'fence':
      addFence(props, x, z, yaw, s)
      break
    case 'canoe':
      addCanoe(props, x, z, yaw, s)
      break
    default:
      break
  }
}

function windowItems(scene: SceneKind): LayoutItem[] {
  const layout = PRESET_LAYOUTS.find((p) => p.id === scene) ?? PRESET_LAYOUTS[0]
  return layout.items.map((i) => ITEMS[i]).filter(Boolean)
}

/** Distance from a point to a polyline, measured to the water edge (centerline minus half width). */
function shellToPath(wx: number, wz: number, path: RiverPath): number {
  const center = path.center
  const width = path.width
  let best = Infinity
  for (let i = 0; i < center.length - 1; i++) {
    const ax = center[i][0]
    const az = center[i][2]
    const bx = center[i + 1][0]
    const bz = center[i + 1][2]
    const abx = bx - ax
    const abz = bz - az
    const len2 = abx * abx + abz * abz
    let t = 0
    if (len2 > 1e-6) t = Math.max(0, Math.min(1, ((wx - ax) * abx + (wz - az) * abz) / len2))
    const d = Math.hypot(wx - (ax + abx * t), wz - (az + abz * t))
    const half = ((width[i] ?? 8) * (1 - t) + (width[i + 1] ?? width[i] ?? 8) * t) * 0.5
    best = Math.min(best, Math.max(0, d - half))
  }
  return best
}

/**
 * Sea cells that touch land, in local meters. Same idea as CustomSRP's live shoreline:
 * flood the open water in from the sample border, then keep the land edge.
 */
function shorePoints(ox: number, oz: number): Array<{ x: number; z: number }> {
  const reach = 150
  const step = 8
  const n = Math.ceil((reach * 2) / step)
  const landY = 5.7 + 0.4
  const land = new Uint8Array(n * n)
  for (let ix = 0; ix < n; ix++) {
    const wx = ox - reach + (ix + 0.5) * step
    for (let iz = 0; iz < n; iz++) {
      const wz = oz - reach + (iz + 0.5) * step
      if (heightWorld(wx, wz) > landY) land[ix * n + iz] = 1
    }
  }
  const sea = new Uint8Array(n * n)
  const queue: number[] = []
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      if (ix !== 0 && iz !== 0 && ix !== n - 1 && iz !== n - 1) continue
      const id = ix * n + iz
      if (land[id] || sea[id]) continue
      sea[id] = 1
      queue.push(id)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q]
    const ix = Math.floor(id / n)
    const iz = id - ix * n
    const push = (x: number, z: number) => {
      if (x < 0 || z < 0 || x >= n || z >= n) return
      const next = x * n + z
      if (land[next] || sea[next]) return
      sea[next] = 1
      queue.push(next)
    }
    push(ix - 1, iz)
    push(ix + 1, iz)
    push(ix, iz - 1)
    push(ix, iz + 1)
  }
  const pts: Array<{ x: number; z: number }> = []
  for (let ix = 0; ix < n; ix++) {
    for (let iz = 0; iz < n; iz++) {
      if (!sea[ix * n + iz]) continue
      const edge = (ix > 0 && land[(ix - 1) * n + iz])
        || (ix + 1 < n && land[(ix + 1) * n + iz])
        || (iz > 0 && land[ix * n + iz - 1])
        || (iz + 1 < n && land[ix * n + iz + 1])
      if (!edge) continue
      pts.push({ x: -reach + (ix + 0.5) * step, z: -reach + (iz + 0.5) * step })
    }
  }
  return pts
}

function nearestShore(pts: Array<{ x: number; z: number }>, x: number, z: number): number {
  let best = Infinity
  let bi = -1
  for (let i = 0; i < pts.length; i++) {
    const d = Math.hypot(x - pts[i].x, z - pts[i].z)
    if (d < best) {
      best = d
      bi = i
    }
  }
  if (bi < 0) return Infinity
  const a = pts[bi]
  for (let i = 0; i < pts.length; i++) {
    if (i === bi) continue
    const b = pts[i]
    if (Math.hypot(a.x - b.x, a.z - b.z) > 12) continue
    const abx = b.x - a.x
    const abz = b.z - a.z
    const len2 = abx * abx + abz * abz
    let t = 0
    if (len2 > 1e-6) t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2))
    best = Math.min(best, Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)))
  }
  return best
}

export interface AmbienceBed {
  name: string
  /** Full volume inside this many meters of the water. */
  full: number
  /** Silent at and beyond this distance. */
  reach: number
  trimDb: number
  /** Horizontal meters from the listener to the water edge. */
  distance(x: number, z: number, y: number): number
}

export function ambienceFor(scene: SceneKind): AmbienceBed[] {
  setActivePreset(scene)
  const layout = PRESET_LAYOUTS.find((p) => p.id === scene) ?? PRESET_LAYOUTS[0]
  const ox = layout.ox
  const oz = layout.oz
  const shore = shorePoints(ox, oz)
  const beds: AmbienceBed[] = [{
    name: 'Ocean_Calm_Quad',
    full: 40,
    reach: 125,
    trimDb: 0,
    distance(x, z, y) {
      const shell = nearestShore(shore, x, z)
      if (y > 18 && shell > 75) return Infinity
      return shell
    },
  }]
  if (RIVER_PATHS.length) {
    beds.push({
      name: 'River_Quad',
      full: 40,
      reach: 64,
      trimDb: -6,
      distance(x, z) {
        let best = Infinity
        const wx = x + ox
        const wz = z + oz
        for (const path of RIVER_PATHS) best = Math.min(best, shellToPath(wx, wz, path))
        return best
      },
    })
  }
  const big = FALLS_SPECS.filter((spec) => spec.tall >= 20)
  const small = FALLS_SPECS.filter((spec) => spec.tall < 20)
  const fallBed = (name: string, specs: FallsSpec[], full: number, reach: number, trimDb: number): AmbienceBed | null => {
    if (!specs.length) return null
    return {
      name,
      full,
      reach,
      trimDb,
      distance(x, z) {
        let best = Infinity
        for (const spec of specs) best = Math.min(best, Math.hypot(x + ox - spec.x, z + oz - spec.z))
        return best
      },
    }
  }
  const bigBed = fallBed('Waterfall_Big_Quad', big, 20, 64, -8)
  const smallBed = fallBed('Waterfall_Small_Quad', small, 24, 72, 0)
  if (bigBed) beds.push(bigBed)
  if (smallBed) beds.push(smallBed)
  return beds
}

export const FIRE_POS = { x: 2, y: 1, z: 2 }

export interface WorldMeshes {
  terrain: MeshData
  water: MeshData
  grass: MeshData
  trees: MeshData
  rocks: MeshData
  cabin: MeshData
  clouds: MeshData
  river: MeshData
  lake: MeshData
  falls: MeshData
  props: MeshData
  rain: MeshData
  fire: MeshData
  scene: SceneKind
}

export function buildWorld(scene: SceneKind = 'p01'): WorldMeshes {
  setActivePreset(scene)
  const layout = PRESET_LAYOUTS.find((p) => p.id === scene) ?? PRESET_LAYOUTS[0]
  const inland = buildInlandWater(layout.ox, layout.oz)
  const placed = buildPlaced(layout)
  const clouds = cloudMesh()
  clouds.blended = true
  inland.falls.blended = true
  const rain = rainMesh(scene)
  rain.blended = true

  return {
    terrain: terrainMesh(),
    water: waterMesh(),
    grass: placed.grass,
    trees: placed.trees,
    rocks: placed.rocks,
    cabin: emptyMesh(),
    clouds,
    river: inland.river,
    lake: (() => { const lake = emptyMesh(); lake.reflect = false; return lake })(),
    falls: inland.falls,
    props: placed.props,
    rain,
    fire: emptyMesh(),
    scene,
  }
}
