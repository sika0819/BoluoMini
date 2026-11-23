/**
 * Bake CustomSRP airwalls + summit cliff boxes + ocean floor into
 * src/scene/data/collision.gen.ts
 *
 * Airwall: MapItemExtras instance × Common/Airwall.prefab child cubes.
 * Summit: IslandTerrain/SummitCliffBoxes (already world-space, root at origin).
 * Ocean: IslandOcean BoxCollider top (AmbienceZoneCatalog.OceanSurfaceY = 5.7).
 */
import { readFileSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const csrp = join(here, '../../../BoluoProjectNew/CustomSRP')
const outFile = join(here, '../../src/scene/data/collision.gen.ts')

const AIR_ROOT = { x: 494.6112976074219, y: 0.00006, z: 841.42724609375 }

function quatRotate(q, v) {
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

function axes(q) {
  const x = quatRotate(q, [1, 0, 0])
  const z = quatRotate(q, [0, 0, 1])
  const xl = Math.hypot(x[0], x[2]) || 1
  const zl = Math.hypot(z[0], z[2]) || 1
  return {
    ax: +(x[0] / xl).toFixed(6),
    az: +(x[2] / xl).toFixed(6),
    bx: +(z[0] / zl).toFixed(6),
    bz: +(z[2] / zl).toFixed(6),
  }
}

function parseCubes(prefabText) {
  const chunks = prefabText.split('--- !u!')
  const transforms = new Map()
  const boxes = new Map()
  const names = new Map()
  for (const chunk of chunks) {
    const head = chunk.slice(0, 80)
    if (head.startsWith('4 &')) {
      const id = head.match(/^4 &(\d+)/)?.[1]
      const go = chunk.match(/m_GameObject: \{fileID: (\d+)/)?.[1]
      const pos = chunk.match(/m_LocalPosition: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)/)
      const rot = chunk.match(/m_LocalRotation: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+), w: ([-\d.eE]+)/)
      const scale = chunk.match(/m_LocalScale: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)/)
      if (!id || !pos || !rot || !scale) continue
      transforms.set(id, {
        go,
        x: +pos[1], y: +pos[2], z: +pos[3],
        q: [+rot[1], +rot[2], +rot[3], +rot[4]],
        sx: +scale[1], sy: +scale[2], sz: +scale[3],
      })
    } else if (head.startsWith('1 &')) {
      const id = head.match(/^1 &(\d+)/)?.[1]
      const name = chunk.match(/m_Name: (.+)/)?.[1]?.trim()
      if (id && name) names.set(id, name)
    } else if (head.startsWith('65 &')) {
      const go = chunk.match(/m_GameObject: \{fileID: (\d+)/)?.[1]
      const size = chunk.match(/m_Size: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)/)
      const center = chunk.match(/m_Center: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)/)
      const trigger = /m_IsTrigger: 1/.test(chunk)
      if (!go || !size || trigger) continue
      boxes.set(go, {
        sx: +size[1], sy: +size[2], sz: +size[3],
        cx: center ? +center[1] : 0,
        cy: center ? +center[2] : 0,
        cz: center ? +center[3] : 0,
      })
    }
  }
  const out = []
  for (const t of transforms.values()) {
    const name = names.get(t.go) || ''
    const box = boxes.get(t.go)
    if (!box || name === 'Airwall' || name === 'SummitCliffBoxes' || name === 'IslandTerrain') continue
    out.push({ name, t, box })
  }
  return out
}

function wallFrom(name, worldPos, q, scale, box, infiniteY) {
  const c = quatRotate(q, [box.cx * scale.x, box.cy * scale.y, box.cz * scale.z])
  const a = axes(q)
  return {
    name,
    x: +(worldPos.x + c[0]).toFixed(3),
    y: +(worldPos.y + c[1]).toFixed(3),
    z: +(worldPos.z + c[2]).toFixed(3),
    hx: +Math.abs(box.sx * scale.x * 0.5).toFixed(3),
    hy: infiniteY ? 0 : +Math.abs(box.sy * scale.y * 0.5).toFixed(3),
    hz: +Math.abs(box.sz * scale.z * 0.5).toFixed(3),
    ...a,
  }
}

const airPrefab = readFileSync(join(csrp, 'Assets/GameMain/Environment/Prefabs/DaoYu1/Common/Airwall.prefab'), 'utf8')
const air = []
for (const cube of parseCubes(airPrefab)) {
  if (!cube.name.startsWith('Cube')) continue
  air.push(wallFrom(
    cube.name,
    {
      x: AIR_ROOT.x + cube.t.x,
      y: AIR_ROOT.y + cube.t.y,
      z: AIR_ROOT.z + cube.t.z,
    },
    cube.t.q,
    { x: cube.t.sx, y: cube.t.sy, z: cube.t.sz },
    cube.box,
    true,
  ))
}

const terrain = readFileSync(join(csrp, 'Assets/AssetRaw/Island/IslandTerrain.prefab'), 'utf8')
const summit = []
for (const cube of parseCubes(terrain)) {
  if (!cube.name.startsWith('SummitCliff_')) continue
  summit.push(wallFrom(
    cube.name,
    { x: cube.t.x, y: cube.t.y, z: cube.t.z },
    cube.t.q,
    { x: cube.t.sx, y: cube.t.sy, z: cube.t.sz },
    cube.box,
    false,
  ))
}

const oceanText = readFileSync(join(csrp, 'Assets/AssetRaw/Ocean/IslandOcean.prefab'), 'utf8')
const oceanPos = oceanText.match(/m_Name: IslandOcean[\s\S]*?m_LocalPosition: \{x: ([-\d.]+), y: ([-\d.]+), z: ([-\d.]+)/)
const oceanBox = oceanText.match(/BoxCollider:[\s\S]*?m_Size: \{x: ([-\d.]+), y: ([-\d.]+), z: ([-\d.]+)\}[\s\S]*?m_Center: \{x: ([-\d.]+), y: ([-\d.]+), z: ([-\d.]+)/)
if (!oceanPos || !oceanBox) throw new Error('IslandOcean collider not found')
const ocean = {
  x: +oceanPos[1] + +oceanBox[4],
  y: +(+oceanPos[2] + +oceanBox[5] + +oceanBox[2] / 2).toFixed(4),
  z: +oceanPos[3] + +oceanBox[6],
  hx: +oceanBox[1] / 2,
  hz: +oceanBox[3] / 2,
}

const spawns = [
  [610.0767, 706.1781],
  [560.7702, 582.0682],
  [466.472, 402.16],
  [390.6678, 480.2867],
  [325.88, 481],
  [233.5713, 663.811],
  [504.6723, 463.8487],
  [603.174, 650.0313],
  [566.793, 550.52],
  [356.8254, 400.8139],
]

function clearance(px, pz, walls) {
  let best = Infinity
  for (const w of walls) {
    const dx = px - w.x
    const dz = pz - w.z
    const lx = dx * w.ax + dz * w.az
    const lz = dx * w.bx + dz * w.bz
    const qx = Math.max(-w.hx, Math.min(w.hx, lx))
    const qz = Math.max(-w.hz, Math.min(w.hz, lz))
    const d = Math.hypot(lx - qx, lz - qz)
    if (d < best) best = d
  }
  return best
}

if (air.length < 8) throw new Error(`expected airwall cubes, got ${air.length}`)
if (summit.length < 8) throw new Error(`expected summit boxes, got ${summit.length}`)
for (const [x, z] of spawns) {
  const d = clearance(x, z, air)
  if (d < 5) throw new Error(`spawn ${x},${z} is ${d.toFixed(2)}m from an airwall`)
}

const row = (w) =>
  `  { x: ${w.x}, y: ${w.y}, z: ${w.z}, hx: ${w.hx}, hy: ${w.hy}, hz: ${w.hz}, ax: ${w.ax}, az: ${w.az}, bx: ${w.bx}, bz: ${w.bz} },`

const src = `/* auto-generated by tools/island_export/export_collision.mjs — do not edit */
export interface ColliderBox {
  x: number
  y: number
  z: number
  hx: number
  hy: number
  hz: number
  /** Unit local X axis in world XZ (Unity quaternion). */
  ax: number
  az: number
  /** Unit local Z axis in world XZ. */
  bx: number
  bz: number
}

/** IslandOcean top. hy 0 on airwalls means the fence is infinite in Y. */
export const OCEAN_Y = ${ocean.y}
export const OCEAN_CX = ${ocean.x}
export const OCEAN_CZ = ${ocean.z}
export const OCEAN_HX = ${ocean.hx}
export const OCEAN_HZ = ${ocean.hz}

export const AIRWALLS: ColliderBox[] = [
${air.map(row).join('\n')}
]

export const SUMMIT_CLIFFS: ColliderBox[] = [
${summit.map(row).join('\n')}
]
`
writeFileSync(outFile, src)
console.log(`airwalls ${air.length} summit ${summit.length} oceanY ${ocean.y}`)
for (let i = 0; i < spawns.length; i++) {
  console.log(`p${String(i + 1).padStart(2, '0')} air clearance ${clearance(spawns[i][0], spawns[i][1], air).toFixed(1)}m`)
}
