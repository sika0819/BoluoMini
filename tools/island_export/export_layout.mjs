/**
 * Decode CustomSRP AllMapItem BLM1 + build a height grid and per-preset windows
 * for BoluoMini. Writes src/scene/data/layout.gen.ts
 *
 * Height: prefer tools/island_export/height.u16 from Unity ExportBoluoMiniLayout;
 * else IDW from MapItem Y (props + terrain share the same surface → feet align).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { inflateSync } from 'zlib'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../..')
const csrp = join(root, '../BoluoProjectNew/CustomSRP')
const outDir = join(root, 'src/scene/data')
const RES = 257
const WINDOW_R = 80

const PRESETS = [
  { id: 'p01', x: 610.0767, y: 12.80065, z: 706.1781, yaw: 130.443 },
  { id: 'p02', x: 560.7702, y: 23.856, z: 582.0682, yaw: -81.77 },
  { id: 'p03', x: 466.472, y: 37.88541, z: 402.16, yaw: -168.898 },
  { id: 'p04', x: 390.6678, y: 75.45603, z: 480.2867, yaw: -187.515 },
  { id: 'p05', x: 325.88, y: 81.40367, z: 481, yaw: -92.137 },
  { id: 'p06', x: 233.5713, y: 105.0471, z: 663.811, yaw: -12.449 },
  { id: 'p07', x: 504.6723, y: 38.82168, z: 463.8487, yaw: -94.024 },
  { id: 'p08', x: 603.174, y: 16.41668, z: 650.0313, yaw: 65.484 },
  { id: 'p09', x: 566.793, y: 26.33587, z: 550.52, yaw: -172.025 },
  { id: 'p10', x: 356.8254, y: 77.20639, z: 400.8139, yaw: -217.135 },
]

/** Categories that must keep every instance inside the window. */
const KEEP_ALL = new Set([
  'JianZhu', 'Qiao', 'Other', 'Common', 'texiao',
])

const TREE_CAP = { Songshu: 28, Lvshu: 22, Yeshu: 12, Guanmu: 18 }
const GRASS_CAP = 40
const FLOWER_CAP = 16
const ROCK_CAP = 24
const ZAWU_CAP = 10

function readBlm1(path) {
  const buf = readFileSync(path)
  const magic = buf.readUInt32LE(0)
  if (magic !== 0x314d4c42) throw new Error(`bad magic ${path}`)
  let o = 4
  const itemCount = buf.readInt32LE(o); o += 4
  const stringCount = buf.readInt32LE(o); o += 4
  const strings = []
  for (let i = 0; i < stringCount; i++) {
    let len = 0, shift = 0
    for (;;) {
      const b = buf[o++]; len |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
    }
    strings.push(buf.toString('utf8', o, o + len))
    o += len
  }
  const items = []
  for (let i = 0; i < itemCount; i++) {
    const index = buf.readInt32LE(o); o += 4
    const parent = strings[buf.readInt32LE(o)]; o += 4
    const objName = strings[buf.readInt32LE(o)]; o += 4
    const x = buf.readFloatLE(o); o += 4
    const y = buf.readFloatLE(o); o += 4
    const z = buf.readFloatLE(o); o += 4
    const rx = buf.readFloatLE(o); o += 4
    const ry = buf.readFloatLE(o); o += 4
    const rz = buf.readFloatLE(o); o += 4
    const sx = buf.readFloatLE(o); o += 4
    const sy = buf.readFloatLE(o); o += 4
    const sz = buf.readFloatLE(o); o += 4
    const active = buf[o++] !== 0
    items.push({ index, parent, objName, x, y, z, rx, ry, rz, sx, sy, sz, active })
  }
  return items
}

function prefabName(objName) {
  const p = objName.indexOf('(')
  return (p >= 0 ? objName.slice(0, p) : objName).trimEnd()
}

function classify(parent, name) {
  const n = name.toLowerCase()
  if (parent === 'Songshu') return 'pine'
  if (parent === 'Lvshu') return 'leaf'
  if (parent === 'Yeshu') return 'palm'
  if (parent === 'Guanmu') return 'bush'
  if (parent === 'Zacao') return 'grass'
  if (parent === 'Hua') return 'flower'
  if (parent === 'Qiao' || n.includes('pier') || n.includes('bridge') || n.includes('qiao')) return 'bridge'
  if (parent === 'JianZhu') {
    if (n.includes('boluo')) return 'pineapple'
    if (n.includes('dock')) return 'dock'
    if (n.includes('tent')) return 'tent'
    if (n.includes('house') || n.includes('cabin')) return 'farmhouse'
    if (n.includes('shed') || n.includes('peng')) return 'shed'
    if (n.includes('barrel') || n.includes('tong')) return 'barrel'
    if (n.includes('crate') || n.includes('box') || n.includes('xiang')) return 'crate'
    if (n.includes('bench') || n.includes('stool')) return 'bench'
    if (n.includes('wagon') || n.includes('cart') || n.includes('che')) return 'wagon'
    if (n.includes('fence') || n.includes('zha')) return 'fence'
    if (n.includes('canoe') || n.includes('boat') || n.includes('zhou')) return 'canoe'
    return 'farmhouse'
  }
  if (parent === 'ShiTou') {
    if (n.includes('cliff')) return 'cliff'
    return 'rock'
  }
  if (parent === 'ZaWu') {
    if (n.includes('dead') || n.includes('stump') || n.includes('maple')) return 'dead'
    return 'dead'
  }
  if (parent === 'Other') {
    if (n.includes('huodui') || n.includes('fire') || n.includes('camp')) return 'campfire'
    if (n.includes('mountain') || n.includes('shan')) return 'mountain'
    return 'prop'
  }
  if (parent === 'Common') {
    if (n.includes('river')) return 'river'
    if (n.includes('lake')) return 'lake'
    return 'water'
  }
  if (parent === 'texiao') {
    if (n.includes('waterfall') || n.includes('splash') || n.includes('falls')) return 'falls'
    return 'fx'
  }
  return 'prop'
}

function buildIdwHeight(items, presets, res) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity
  const samples = []
  for (const it of items) {
    if (!it.active) continue
    minX = Math.min(minX, it.x); maxX = Math.max(maxX, it.x)
    minZ = Math.min(minZ, it.z); maxZ = Math.max(maxZ, it.z)
    if (it.y > -5 && it.y < 200) samples.push([it.x, it.z, it.y])
  }
  for (const p of presets) {
    minX = Math.min(minX, p.x - WINDOW_R); maxX = Math.max(maxX, p.x + WINDOW_R)
    minZ = Math.min(minZ, p.z - WINDOW_R); maxZ = Math.max(maxZ, p.z + WINDOW_R)
    samples.push([p.x, p.z, p.y])
  }
  // pad
  const pad = 20
  minX -= pad; maxX += pad; minZ -= pad; maxZ += pad
  const sizeX = maxX - minX
  const sizeZ = maxZ - minZ

  // Spatial hash for IDW neighbors
  const cell = 40
  const grid = new Map()
  const key = (ix, iz) => `${ix},${iz}`
  for (const s of samples) {
    const ix = Math.floor((s[0] - minX) / cell)
    const iz = Math.floor((s[1] - minZ) / cell)
    const k = key(ix, iz)
    if (!grid.has(k)) grid.set(k, [])
    grid.get(k).push(s)
  }

  const heights = new Float32Array(res * res)
  let maxH = 1
  for (let jz = 0; jz < res; jz++) {
    for (let jx = 0; jx < res; jx++) {
      const x = minX + (jx / (res - 1)) * sizeX
      const z = minZ + (jz / (res - 1)) * sizeZ
      const ix = Math.floor((x - minX) / cell)
      const iz = Math.floor((z - minZ) / cell)
      let wsum = 0, hsum = 0
      let exact = null
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          const bucket = grid.get(key(ix + dx, iz + dz))
          if (!bucket) continue
          for (const s of bucket) {
            const d2 = (s[0] - x) ** 2 + (s[1] - z) ** 2
            if (d2 < 0.25) { exact = s[2]; break }
            const w = 1 / (d2 + 4)
            wsum += w
            hsum += w * s[2]
          }
          if (exact != null) break
        }
        if (exact != null) break
      }
      // Prefer nearest sample over sea-floor so empty cells do not punch pits.
      let h = exact != null ? exact : (wsum > 0 ? hsum / wsum : 0)
      if (wsum < 0.001 && exact == null) {
        // fallback: still 0 (sea), but filled later by blur from neighbors
        h = 0
      }
      heights[jz * res + jx] = h
      if (h > maxH) maxH = h
    }
  }
  // Soft stamp (no hard spikes) so prop feet stay close without tearing the surface.
  for (const s of samples) {
    const jx = Math.round(((s[0] - minX) / sizeX) * (res - 1))
    const jz = Math.round(((s[1] - minZ) / sizeZ) * (res - 1))
    if (jx < 0 || jz < 0 || jx >= res || jz >= res) continue
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = jx + dx, z = jz + dz
        if (x < 0 || z < 0 || x >= res || z >= res) continue
        const dist = Math.hypot(dx, dz)
        const t = Math.max(0, 1 - dist / 2.5) * 0.65
        if (t <= 0) continue
        const i = z * res + x
        heights[i] = heights[i] * (1 - t) + s[2] * t
        if (heights[i] > maxH) maxH = heights[i]
      }
    }
  }
  // 3×3 blur pass to close residual cracks / single-texel pits.
  const blurred = new Float32Array(heights.length)
  for (let jz = 0; jz < res; jz++) {
    for (let jx = 0; jx < res; jx++) {
      let sum = 0, w = 0
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = jx + dx, z = jz + dz
          if (x < 0 || z < 0 || x >= res || z >= res) continue
          const ww = dx === 0 && dz === 0 ? 4 : 1
          sum += heights[z * res + x] * ww
          w += ww
        }
      }
      blurred[jz * res + jx] = sum / w
    }
  }
  return { heights: blurred, minX, minZ, sizeX, sizeZ, maxH, source: 'idw' }
}

function loadUnityHeight() {
  const metaPath = join(here, 'height.meta.json')
  const binPath = join(here, 'height.u16')
  if (!existsSync(metaPath) || !existsSync(binPath)) return null
  const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
  // Only trust files produced by ExportBoluoMiniLayout (Unity TerrainData).
  if (meta.source !== 'unity') return null
  const buf = readFileSync(binPath)
  const u16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
  const res = meta.res
  if (u16.length !== res * res) throw new Error('height.u16 size mismatch')
  const heights = new Float32Array(res * res)
  for (let i = 0; i < u16.length; i++) heights[i] = (u16[i] / 65535) * meta.maxH
  return {
    heights,
    minX: meta.minX,
    minZ: meta.minZ,
    sizeX: meta.sizeX,
    sizeZ: meta.sizeZ,
    maxH: meta.maxH,
    source: 'unity',
    res,
  }
}

function packHeight(heights, maxH) {
  const u16 = new Uint16Array(heights.length)
  for (let i = 0; i < heights.length; i++) {
    const t = Math.max(0, Math.min(1, heights[i] / maxH))
    u16[i] = (t * 65535) | 0
  }
  return u16
}

/** Rivers and falls are drawn from their collision meshes. Airwall is invisible. */
const SKIP_DRAW = new Set(['Airwall', 'River_01', 'River_02', 'River_03', 'River_04', 'WaterfallSplash', 'WaterfallMist'])

function selectWindow(items, px, pz, r) {
  const r2 = r * r
  const picked = []
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it.active || SKIP_DRAW.has(it.name)) continue
    const dx = it.x - px
    const dz = it.z - pz
    if (dx * dx + dz * dz > r2) continue
    picked.push(i)
  }
  return picked
}

function walkFiles(dir, suffix, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walkFiles(p, suffix, out)
    else if (name.endsWith(suffix)) out.push(p)
  }
  return out
}

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

function applyTrs(t, p) {
  const r = quatRotate(t.q, [p[0] * t.sx, p[1] * t.sy, p[2] * t.sz])
  return [r[0] + t.x, r[1] + t.y, r[2] + t.z]
}

function guidIndex(root) {
  const map = new Map()
  for (const meta of walkFiles(root, '.meta')) {
    const text = readFileSync(meta, 'utf8')
    const guid = text.match(/^guid: ([0-9a-f]+)/m)?.[1]
    if (guid) map.set(guid, meta.slice(0, -5))
  }
  return map
}

function readFbxProp(buf, o) {
  const type = String.fromCharCode(buf[o]); o++
  if (type === 'Y') return { v: buf.readInt16LE(o), o: o + 2, type }
  if (type === 'C') return { v: buf[o], o: o + 1, type }
  if (type === 'I') return { v: buf.readInt32LE(o), o: o + 4, type }
  if (type === 'F') return { v: buf.readFloatLE(o), o: o + 4, type }
  if (type === 'D') return { v: buf.readDoubleLE(o), o: o + 8, type }
  if (type === 'L') return { v: buf.readBigInt64LE(o).toString(), o: o + 8, type }
  if (type === 'S' || type === 'R') {
    const len = buf.readUint32LE(o); o += 4
    const raw = buf.subarray(o, o + len)
    return { v: type === 'S' ? raw.toString('utf8') : raw, o: o + len, type }
  }
  if ('fdilb'.includes(type)) {
    const count = buf.readUint32LE(o); o += 4
    const enc = buf.readUint32LE(o); o += 4
    const clen = buf.readUint32LE(o); o += 4
    let data = buf.subarray(o, o + clen)
    o += clen
    if (enc === 1) data = inflateSync(data)
    return { v: data, count, o, type }
  }
  throw new Error('fbx type ' + type)
}

function readFbxNode(buf, o, version) {
  const wide = version >= 7500
  const end = wide ? Number(buf.readBigUint64LE(o)) : buf.readUint32LE(o)
  if (end === 0) return null
  const num = wide ? Number(buf.readBigUint64LE(o + 8)) : buf.readUint32LE(o + 4)
  const listLen = wide ? Number(buf.readBigUint64LE(o + 16)) : buf.readUint32LE(o + 8)
  const nameAt = wide ? 25 : 13
  const nameLen = buf[o + nameAt - 1]
  const name = buf.subarray(o + nameAt, o + nameAt + nameLen).toString('utf8')
  let p = o + nameAt + nameLen
  const props = []
  for (let i = 0; i < num; i++) {
    const r = readFbxProp(buf, p)
    props.push(r)
    p = r.o
  }
  const children = []
  while (p < end) {
    const c = readFbxNode(buf, p, version)
    if (!c) break
    children.push(c)
    p = c.end
  }
  return { name, props, children, end }
}

function fbxSetting(nodes, key) {
  let found = null
  const walk = (n) => {
    if (n.name === 'P' && typeof n.props[0]?.v === 'string' && n.props[0].v.split('\0')[0] === key) {
      const nums = n.props.filter((p) => typeof p.v === 'number')
      found = nums.length ? nums[nums.length - 1].v : null
    }
    for (const c of n.children) walk(c)
  }
  for (const n of nodes) walk(n)
  return found
}

/** Unity mesh AABB for one FBX node. LOD m_Size is only the longest side, so a cube of it is far too tall. */
function loadFbxBounds(assetPath) {
  const buf = readFileSync(assetPath)
  if (buf.toString('utf8', 0, 18) !== 'Kaydara FBX Binary') return null
  const version = buf.readUint32LE(23)
  const nodes = []
  let o = 27
  while (o < buf.length - 24) {
    const n = readFbxNode(buf, o, version)
    if (!n) break
    nodes.push(n)
    o = n.end
  }
  const unit = fbxSetting(nodes, 'UnitScaleFactor') ?? 1
  const up = fbxSetting(nodes, 'OriginalUpAxis')
  const upAxis = up == null || up < 0 ? (fbxSetting(nodes, 'UpAxis') ?? 1) : up
  let globalScale = 1
  let useFile = true
  try {
    const meta = readFileSync(assetPath + '.meta', 'utf8')
    const g = meta.match(/\n    globalScale: ([-\d.eE]+)/)
    if (g) globalScale = +g[1] || 1
    if (/useFileScale: 0/.test(meta)) useFile = false
  } catch { /* default cm → m */ }
  const scale = (useFile ? unit / 100 : 1) * globalScale
  const objects = nodes.find((n) => n.name === 'Objects')
  const connections = nodes.find((n) => n.name === 'Connections')
  const parentOf = new Map()
  if (connections) {
    for (const c of connections.children) {
      if (c.name !== 'C' || c.props.length < 3) continue
      const kind = String(c.props[0].v).split('\0')[0]
      if (kind !== 'OO') continue
      parentOf.set(String(c.props[1].v), String(c.props[2].v))
    }
  }
  const modelName = new Map()
  const geom = []
  if (objects) {
    for (const n of objects.children) {
      if (n.name === 'Model') {
        const id = String(n.props[0]?.v ?? '')
        const raw = String(n.props[1]?.v ?? '')
        modelName.set(id, raw.split('\0')[0])
      } else if (n.name === 'Geometry') {
        const id = String(n.props[0]?.v ?? '')
        const verts = n.children.find((c) => c.name === 'Vertices')
        if (!verts || !Buffer.isBuffer(verts.props[0]?.v)) continue
        geom.push({ id, buf: verts.props[0].v, type: verts.props[0].type, count: verts.props[0].count || 0 })
      }
    }
  }
  const out = new Map()
  let best = null
  for (const g of geom) {
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    const step = g.type === 'f' ? 12 : 24
    const read = g.type === 'f'
      ? (i) => g.buf.readFloatLE(i)
      : (i) => g.buf.readDoubleLE(i)
    let n = 0
    for (let i = 0; i + step <= g.buf.length; i += step) {
      let x = read(i) * scale
      let y = read(i + (g.type === 'f' ? 4 : 8)) * scale
      let z = read(i + (g.type === 'f' ? 8 : 16)) * scale
      if (upAxis === 2) { const yy = y; y = z; z = -yy }
      else if (upAxis === 0) { const xx = x; x = -y; y = xx }
      else x = -x
      if (x < min[0]) min[0] = x
      if (y < min[1]) min[1] = y
      if (z < min[2]) min[2] = z
      if (x > max[0]) max[0] = x
      if (y > max[1]) max[1] = y
      if (z > max[2]) max[2] = z
      n++
    }
    if (!n || min[0] === Infinity) continue
    const box = { min, max, n }
    const name = modelName.get(parentOf.get(g.id) ?? '')
    if (name) out.set(name, box)
    if (!best || n > best.n) best = box
  }
  if (best) out.set('__best', best)
  return out
}

const fbxCache = new Map()
let fbxHits = 0

function fbxAabb(assetPath, meshName) {
  if (!/\.fbx$/i.test(assetPath)) return null
  let doc = fbxCache.get(assetPath)
  if (doc === undefined) {
    try { doc = loadFbxBounds(assetPath) } catch { doc = null }
    fbxCache.set(assetPath, doc)
  }
  if (!doc) return null
  const hit = (meshName && doc.get(meshName)) || doc.get('__best')
  if (!hit) return null
  fbxHits++
  return { min: hit.min, max: hit.max }
}

function meshAabb(assetPath) {
  if (/\.fbx$/i.test(assetPath)) return null
  let text
  try { text = readFileSync(assetPath, 'utf8') } catch { return null }
  if (!text.startsWith('%YAML') && !text.startsWith('---')) return null
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  let n = 0
  const re = /m_LocalAABB:\s+m_Center: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)\}\s+m_Extent: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)\}/g
  for (const m of text.matchAll(re)) {
    const c = [+m[1], +m[2], +m[3]]
    const e = [Math.abs(+m[4]), Math.abs(+m[5]), Math.abs(+m[6])]
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], c[a] - e[a])
      max[a] = Math.max(max[a], c[a] + e[a])
    }
    n++
  }
  if (!n) return null
  return { min, max }
}

function unionPrefab(prefabPath, guids) {
  return unionPrefabIds(readFileSync(prefabPath, 'utf8'), guids)
}

function unionPrefabIds(text, guids) {
  const gos = new Map()
  const transforms = new Map()
  const meshGuid = new Map()
  const rendererGo = new Map()
  const rendererOn = new Map()
  let lod0 = null
  for (const chunk of text.split('--- !u!')) {
    const head = chunk.slice(0, 24)
    if (head.startsWith('1 &')) {
      const id = head.match(/^1 &(\d+)/)?.[1]
      const name = chunk.match(/m_Name: (.*)/)?.[1]?.trim() ?? ''
      const active = !/m_IsActive: 0/.test(chunk)
      if (id) gos.set(id, { name, active })
    } else if (head.startsWith('4 &')) {
      const id = head.match(/^4 &(\d+)/)?.[1]
      const go = chunk.match(/m_GameObject: \{fileID: (\d+)/)?.[1]
      const pos = chunk.match(/m_LocalPosition: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)/)
      const rot = chunk.match(/m_LocalRotation: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+), w: ([-\d.eE]+)/)
      const scale = chunk.match(/m_LocalScale: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)/)
      const father = chunk.match(/m_Father: \{fileID: (\d+)/)?.[1] ?? '0'
      if (!id || !pos || !rot || !scale) continue
      transforms.set(id, {
        go, father,
        x: +pos[1], y: +pos[2], z: +pos[3],
        q: [+rot[1], +rot[2], +rot[3], +rot[4]],
        sx: +scale[1] || 1, sy: +scale[2] || 1, sz: +scale[3] || 1,
      })
    } else if (head.startsWith('33 &')) {
      const go = chunk.match(/m_GameObject: \{fileID: (\d+)/)?.[1]
      const guid = chunk.match(/guid: ([0-9a-f]+)/)?.[1]
      if (go && guid) meshGuid.set(go, guid)
    } else if (head.startsWith('23 &')) {
      const id = head.match(/^23 &(\d+)/)?.[1]
      const go = chunk.match(/m_GameObject: \{fileID: (\d+)/)?.[1]
      if (id && go) {
        rendererGo.set(id, go)
        rendererOn.set(id, !/m_Enabled: 0/.test(chunk))
      }
    } else if (head.startsWith('205 &')) {
      const block = chunk.match(/m_LODs:([\s\S]*?)m_Enabled:/)
      const first = block?.[1]?.split(/- screenRelativeHeight:/)[1] ?? ''
      lod0 = [...first.matchAll(/renderer: \{fileID: (\d+)/g)].map((m) => m[1])
    }
  }
  const goTransform = new Map()
  for (const [id, t] of transforms) {
    t.id = id
    if (t.go) goTransform.set(t.go, t)
  }
  const use = []
  if (lod0 && lod0.length) {
    for (const id of lod0) {
      if (rendererOn.get(id) === false) continue
      const go = rendererGo.get(id)
      if (go) use.push(go)
    }
  } else {
    for (const [id, go] of rendererGo) {
      if (rendererOn.get(id) !== false) use.push(go)
    }
  }
  let min = [Infinity, Infinity, Infinity]
  let max = [-Infinity, -Infinity, -Infinity]
  for (const go of use) {
    const g = gos.get(go)
    if (!g || !g.active || /billboard/i.test(g.name)) continue
    const guid = meshGuid.get(go)
    const asset = guid ? guids.get(guid) : null
    const aabb = asset ? (meshAabb(asset) ?? fbxAabb(asset, gos.get(go)?.name)) : null
    if (!aabb) continue
    const start = goTransform.get(go)
    if (!start) continue
    // Prefab root pose is replaced by the MapItem. Only child offsets stay.
    const chain = []
    let cursor = start
    const seen = new Set()
    while (cursor && cursor.father !== '0' && !seen.has(cursor.id)) {
      seen.add(cursor.id)
      chain.push(cursor)
      cursor = transforms.get(cursor.father)
    }
    const corners = []
    for (const x of [aabb.min[0], aabb.max[0]]) {
      for (const y of [aabb.min[1], aabb.max[1]]) {
        for (const z of [aabb.min[2], aabb.max[2]]) corners.push([x, y, z])
      }
    }
    for (const c of corners) {
      let p = c
      for (const t of chain) p = applyTrs(t, p)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p[a])
        max[a] = Math.max(max[a], p[a])
      }
    }
  }
  if (min[0] === Infinity) {
    const sphere = text.match(/m_LocalReferencePoint: \{x: ([-\d.eE]+), y: ([-\d.eE]+), z: ([-\d.eE]+)\}\s+m_Size: ([-\d.eE]+)/)
    if (!sphere) return null
    const c = [+sphere[1], +sphere[2], +sphere[3]]
    const h = Math.abs(+sphere[4]) * 0.5
    return {
      cx: +c[0].toFixed(3), cy: +c[1].toFixed(3), cz: +c[2].toFixed(3),
      ex: +h.toFixed(3), ey: +h.toFixed(3), ez: +h.toFixed(3),
      src: 'lod',
    }
  }
  const c = min.map((v, i) => (v + max[i]) * 0.5)
  const e = min.map((v, i) => (max[i] - v) * 0.5)
  return {
    cx: +c[0].toFixed(3), cy: +c[1].toFixed(3), cz: +c[2].toFixed(3),
    ex: +Math.max(e[0], 0.05).toFixed(3),
    ey: +Math.max(e[1], 0.05).toFixed(3),
    ez: +Math.max(e[2], 0.05).toFixed(3),
    src: 'mesh',
  }
}

function loadModelBounds() {
  const env = join(csrp, 'Assets/GameMain/Environment')
  const guids = guidIndex(env)
  const byName = new Map()
  for (const prefab of walkFiles(env, '.prefab')) {
    const name = prefab.split('/').pop().replace(/\.prefab$/, '')
    if (byName.has(name)) continue
    const box = unionPrefab(prefab, guids)
    if (box) byName.set(name, box)
  }
  console.log(`prefab bounds ${byName.size}, fbx meshes ${fbxHits}`)
  return byName
}

function main() {
  mkdirSync(outDir, { recursive: true })
  const mainPath = join(csrp, 'Assets/AssetRaw/Configs/AllMapItem.bytes')
  const extraPath = join(csrp, 'Assets/AssetRaw/Configs/MapItemExtras.bytes')
  const items = [
    ...readBlm1(mainPath),
    ...readBlm1(extraPath),
  ]
  for (const it of items) {
    it.name = prefabName(it.objName)
    it.kind = classify(it.parent, it.name)
  }
  console.log(`items ${items.length}`)

  let heightInfo = loadUnityHeight()
  if (!heightInfo) {
    console.log('no Unity height.u16 — building IDW height from MapItem Y')
    heightInfo = buildIdwHeight(items, PRESETS, RES)
  }
  const res = heightInfo.res || RES
  const maxH = Math.max(heightInfo.maxH, 1)
  const u16 = packHeight(heightInfo.heights, maxH)

  const bounds = loadModelBounds()
  const modelList = []
  const modelIndex = new Map()
  let missingBounds = 0
  for (const it of items) {
    const key = `${it.parent}/${it.name}`
    if (modelIndex.has(key)) continue
    const box = bounds.get(it.name)
    if (!box) missingBounds++
    const rec = {
      n: it.name,
      p: it.parent,
      cx: box?.cx ?? 0, cy: box?.cy ?? 0.5, cz: box?.cz ?? 0,
      ex: box?.ex ?? 0.5, ey: box?.ey ?? 0.5, ez: box?.ez ?? 0.5,
    }
    modelIndex.set(key, modelList.length)
    modelList.push(rec)
  }
  console.log(`models ${modelList.length} missing bounds ${missingBounds} (1m fallback)`)
  for (const sample of ['Grand Fir 1', 'House_1_NoInterior', 'boluo1', 'SM_Env_Rock_Ground_01', 'Mountain 2', 'Huodui', 'rpgpp_ag_bench_wood_01a', 'SM_Env_Tree_Palm_04', 'SM_Veh_Canoe_Animated']) {
    const hit = modelList.find((m) => m.n === sample)
    if (hit) console.log(' ', sample, `${(hit.ex * 2).toFixed(1)} x ${(hit.ey * 2).toFixed(1)} x ${(hit.ez * 2).toFixed(1)}`)
  }

  // Full Unity TRS. Bounds are prefab-root AABB (center + half extents).
  const compact = items.map((it) => ({
    k: it.kind,
    m: modelIndex.get(`${it.parent}/${it.name}`),
    x: +it.x.toFixed(2),
    y: +it.y.toFixed(2),
    z: +it.z.toFixed(2),
    rx: +it.rx.toFixed(2),
    ry: +it.ry.toFixed(2),
    rz: +it.rz.toFixed(2),
    sx: +it.sx.toFixed(3),
    sy: +it.sy.toFixed(3),
    sz: +it.sz.toFixed(3),
  }))

  const presetOut = PRESETS.map((p) => {
    const idx = selectWindow(items, p.x, p.z, WINDOW_R)
    return {
      id: p.id,
      ox: +p.x.toFixed(3),
      oy: +p.y.toFixed(3),
      oz: +p.z.toFixed(3),
      yaw: +((p.yaw * Math.PI) / 180).toFixed(4),
      items: idx,
    }
  })

  for (const p of presetOut) {
    console.log(p.id, 'items', p.items.length)
  }

  // Emit TS module (typed arrays as base64 for height; items as JSON)
  const heightB64 = Buffer.from(u16.buffer, u16.byteOffset, u16.byteLength).toString('base64')
  const src = `/* auto-generated by tools/island_export/export_layout.mjs — do not edit */
export const WINDOW_R = ${WINDOW_R}
export const HEIGHT_RES = ${res}
export const HEIGHT_MIN_X = ${heightInfo.minX}
export const HEIGHT_MIN_Z = ${heightInfo.minZ}
export const HEIGHT_SIZE_X = ${heightInfo.sizeX}
export const HEIGHT_SIZE_Z = ${heightInfo.sizeZ}
export const HEIGHT_MAX = ${maxH}
export const HEIGHT_SOURCE = ${JSON.stringify(heightInfo.source)}
export const SEA_WORLD = 0

function b64ToU16(b64: string): Uint16Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Uint16Array(bytes.buffer)
}

export const HEIGHT_U16 = b64ToU16(${JSON.stringify(heightB64)})

export type ItemKind =
  | 'pine' | 'leaf' | 'palm' | 'bush' | 'grass' | 'flower' | 'dead'
  | 'rock' | 'cliff' | 'campfire' | 'pineapple' | 'farmhouse' | 'shed' | 'tent'
  | 'dock' | 'bridge' | 'mountain' | 'barrel' | 'crate' | 'bench' | 'wagon'
  | 'fence' | 'canoe' | 'river' | 'lake' | 'falls' | 'water' | 'fx' | 'prop'

export interface ModelBounds {
  n: string
  p: string
  cx: number
  cy: number
  cz: number
  ex: number
  ey: number
  ez: number
}

/** Prefab-root mesh AABB. Instance TRS is rx/ry/rz degrees (Unity Euler) and sx/sy/sz. */
export const MODELS: ModelBounds[] = ${JSON.stringify(modelList)}

export interface LayoutItem {
  k: ItemKind
  m: number
  x: number
  y: number
  z: number
  rx: number
  ry: number
  rz: number
  sx: number
  sy: number
  sz: number
}

export interface PresetLayout {
  id: string
  ox: number
  oy: number
  oz: number
  yaw: number
  items: number[]
}

export const ITEMS: LayoutItem[] = ${JSON.stringify(compact)}
export const PRESET_LAYOUTS: PresetLayout[] = ${JSON.stringify(presetOut)}
`
  writeFileSync(join(outDir, 'layout.gen.ts'), src)
  writeFileSync(join(here, 'height.meta.json'), JSON.stringify({
    res, minX: heightInfo.minX, minZ: heightInfo.minZ,
    sizeX: heightInfo.sizeX, sizeZ: heightInfo.sizeZ, maxH, source: heightInfo.source,
  }, null, 2))
  writeFileSync(join(here, 'height.u16'), Buffer.from(u16.buffer, u16.byteOffset, u16.byteLength))
  console.log('wrote', join(outDir, 'layout.gen.ts'), 'source=', heightInfo.source, 'bytes~', src.length)
}

main()
