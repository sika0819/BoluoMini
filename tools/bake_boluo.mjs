/**
 * Bake boluo2_rig.fbx into public/actor/boluo.json.
 * Mesh, skin, and BoluoIdle / BoluoWalk. Vertex colors come from the basecolor PNG.
 * Each eye and mouth is its own UV island in public/actor/face.png.
 * Body vertices never sample those islands.
 */
import { execFileSync } from 'child_process'
import { deflateSync } from 'zlib'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fbx = join(root, '../BoluoUnity/UnityProject/Assets/AssetRaw/Actor/Boluo/boluo2_rig.fbx')
const png = join(root, '../BoluoUnity/UnityProject/Assets/AssetRaw/Actor/Boluo/boluo2_rig_basecolor.png')
const outPath = join(root, 'public/actor/boluo.json')
const facePath = join(root, 'public/actor/face.png')

const NAMES = ['BoluoArmature', 'Root', 'Hips', 'Chest', 'LeftArm', 'RightArm', 'LeftFoot', 'RightFoot', 'BoluoMesh']
const PARENT = [-1, 0, 1, 2, 2, 2, 2, 2, -1]

const dir = mkdtempSync(join(tmpdir(), 'boluo-bake-'))
const glbPath = join(dir, 'boluo.glb')
const bmpPath = join(dir, 'color.bmp')
execFileSync('assimp', ['export', fbx, glbPath, '-fglb2'], { stdio: 'inherit' })
execFileSync('sips', ['-s', 'format', 'bmp', png, '--out', bmpPath], { stdio: 'inherit' })

const glb = readFileSync(glbPath)
const jsonLen = glb.readUInt32LE(12)
const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8'))
const binOff = 20 + jsonLen
const binLen = glb.readUInt32LE(binOff)
const bin = glb.subarray(binOff + 8, binOff + 8 + binLen)

const COMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }
function readAcc(index) {
  const acc = json.accessors[index]
  const view = json.bufferViews[acc.bufferView]
  const start = (view.byteOffset || 0) + (acc.byteOffset || 0)
  const n = COMP[acc.type]
  const width = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[acc.componentType]
  const stride = view.byteStride || width * n
  const out = []
  for (let i = 0; i < acc.count; i++) {
    const o = start + i * stride
    const row = []
    for (let k = 0; k < n; k++) {
      const p = o + k * width
      if (acc.componentType === 5126) row.push(bin.readFloatLE(p))
      else if (acc.componentType === 5123) row.push(bin.readUInt16LE(p))
      else if (acc.componentType === 5121) row.push(bin.readUInt8(p))
      else if (acc.componentType === 5125) row.push(bin.readUInt32LE(p))
      else throw new Error('component ' + acc.componentType)
    }
    out.push(row)
  }
  return out
}

const byName = new Map(json.nodes.map((node, i) => [node.name, i]))
const gltfIndex = NAMES.map((name) => {
  const i = byName.get(name)
  if (i == null) throw new Error('missing node ' + name)
  return i
})

function restOf(gltfNode) {
  const node = json.nodes[gltfNode]
  const t = node.translation || [0, 0, 0]
  const r = node.rotation || [0, 0, 0, 1]
  const s = node.scale || [1, 1, 1]
  return [...t, ...r, ...s]
}

const rest = new Float32Array(NAMES.length * 10)
NAMES.forEach((_, i) => rest.set(restOf(gltfIndex[i]), i * 10))

const skin = json.skins[0]
const jointNames = skin.joints.map((i) => json.nodes[i].name)
const joints = jointNames.map((name) => NAMES.indexOf(name))
if (joints.some((i) => i < 0)) throw new Error('joint missing from node list')
const ibmRows = readAcc(skin.inverseBindMatrices)
const ibm = new Float32Array(joints.length * 16)
ibmRows.forEach((row, i) => ibm.set(row, i * 16))

const mesh = json.meshes[0].primitives[0]
const posRows = readAcc(mesh.attributes.POSITION)
const nrmRows = readAcc(mesh.attributes.NORMAL)
const uvRows = readAcc(mesh.attributes.TEXCOORD_0)
const jointRows = readAcc(mesh.attributes.JOINTS_0)
const weightRows = readAcc(mesh.attributes.WEIGHTS_0)
const idxRows = readAcc(mesh.indices)
const vcount = posRows.length
const pos = new Float32Array(vcount * 3)
const nrm = new Float32Array(vcount * 3)
const jnt = new Uint8Array(vcount * 4)
const wgt = new Float32Array(vcount * 4)
for (let i = 0; i < vcount; i++) {
  pos.set(posRows[i], i * 3)
  nrm.set(nrmRows[i], i * 3)
  let sum = 0
  for (let k = 0; k < 4; k++) sum += weightRows[i][k]
  for (let k = 0; k < 4; k++) {
    jnt[i * 4 + k] = jointRows[i][k]
    wgt[i * 4 + k] = sum > 0 ? weightRows[i][k] / sum : 0
  }
}
let idx = Uint16Array.from(idxRows.map((row) => row[0]))

function quatMat(q, t, s) {
  const [x, y, z, w] = q
  const xx = x * x, yy = y * y, zz = z * z
  const xy = x * y, xz = x * z, yz = y * z
  const wx = w * x, wy = w * y, wz = w * z
  const m = new Array(16).fill(0)
  m[0] = (1 - 2 * (yy + zz)) * s[0]
  m[1] = (2 * (xy + wz)) * s[0]
  m[2] = (2 * (xz - wy)) * s[0]
  m[4] = (2 * (xy - wz)) * s[1]
  m[5] = (1 - 2 * (xx + zz)) * s[1]
  m[6] = (2 * (yz + wx)) * s[1]
  m[8] = (2 * (xz + wy)) * s[2]
  m[9] = (2 * (yz - wx)) * s[2]
  m[10] = (1 - 2 * (xx + yy)) * s[2]
  m[12] = t[0]
  m[13] = t[1]
  m[14] = t[2]
  m[15] = 1
  return m
}
function mul(a, b) {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
    }
  }
  return o
}
function apply(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
  ]
}
const globals = []
for (let i = 0; i < NAMES.length; i++) {
  const o = i * 10
  const local = quatMat(
    [rest[o + 3], rest[o + 4], rest[o + 5], rest[o + 6]],
    [rest[o], rest[o + 1], rest[o + 2]],
    [rest[o + 7], rest[o + 8], rest[o + 9]],
  )
  globals[i] = PARENT[i] < 0 ? local : mul(globals[PARENT[i]], local)
}
const jm = joints.map((node, j) => mul(globals[node], ibmRows[j]))
let min = [Infinity, Infinity, Infinity]
let max = [-Infinity, -Infinity, -Infinity]
const skinned = []
for (let i = 0; i < vcount; i++) {
  const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
  const out = [0, 0, 0]
  for (let k = 0; k < 4; k++) {
    const w = wgt[i * 4 + k]
    if (w <= 0) continue
    const tp = apply(jm[jnt[i * 4 + k]], p)
    out[0] += w * tp[0]
    out[1] += w * tp[1]
    out[2] += w * tp[2]
  }
  skinned.push(out)
  for (let k = 0; k < 3; k++) {
    min[k] = Math.min(min[k], out[k])
    max[k] = Math.max(max[k], out[k])
  }
}
const mid = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
let outward = 0
for (let i = 0; i < idx.length; i += 3) {
  const a = skinned[idx[i]]
  const b = skinned[idx[i + 1]]
  const c = skinned[idx[i + 2]]
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2]
  const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const cx = (a[0] + b[0] + c[0]) / 3 - mid[0]
  const cy = (a[1] + b[1] + c[1]) / 3 - mid[1]
  const cz = (a[2] + b[2] + c[2]) / 3 - mid[2]
  outward += nx * cx + ny * cy + nz * cz
}
if (outward < 0) {
  for (let i = 0; i < idx.length; i += 3) {
    const tmp = idx[i + 1]
    idx[i + 1] = idx[i + 2]
    idx[i + 2] = tmp
  }
}

const bmp = readFileSync(bmpPath)
const pixelOfs = bmp.readUInt32LE(10)
const width = bmp.readInt32LE(18)
const heightRaw = bmp.readInt32LE(22)
const height = Math.abs(heightRaw)
const bpp = bmp.readUInt16LE(28)
if (bpp !== 24 && bpp !== 32) throw new Error('bmp bpp ' + bpp)
const bottomUp = heightRaw > 0
const rowStride = Math.ceil((width * (bpp / 8)) / 4) * 4
function pixel(x, yTop) {
  const y = bottomUp ? height - 1 - yTop : yTop
  const o = pixelOfs + y * rowStride + x * (bpp / 8)
  return [bmp[o + 2] / 255, bmp[o + 1] / 255, bmp[o] / 255]
}
function mean(flip) {
  let top = [0, 0, 0], body = [0, 0, 0], nt = 0, nb = 0
  for (let i = 0; i < vcount; i++) {
    const u = Math.min(1, Math.max(0, uvRows[i][0]))
    const v = Math.min(1, Math.max(0, uvRows[i][1]))
    const vv = flip ? 1 - v : v
    const x = Math.min(width - 1, Math.max(0, Math.round(u * (width - 1))))
    const y = Math.min(height - 1, Math.max(0, Math.round(vv * (height - 1))))
    const rgb = pixel(x, y)
    const bucket = posRows[i][2] > 0.72 ? top : posRows[i][2] < 0.4 ? body : null
    if (!bucket) continue
    bucket[0] += rgb[0]
    bucket[1] += rgb[1]
    bucket[2] += rgb[2]
    if (bucket === top) nt++
    else nb++
  }
  const pack = (s, n) => s.map((c) => c / Math.max(1, n))
  return { top: pack(top, nt), body: pack(body, nb), nt, nb }
}
const upright = mean(false)
const flipped = mean(true)
const score = (m) => (m.top[1] - m.top[0]) - (m.body[1] - m.body[0])
const flipV = score(flipped) > score(upright)
const chosen = flipV ? flipped : upright
const uv = new Float32Array(vcount * 2)
for (let i = 0; i < vcount; i++) {
  const u = Math.min(1, Math.max(0, uvRows[i][0]))
  const v = Math.min(1, Math.max(0, uvRows[i][1]))
  uv[i * 2] = u
  uv[i * 2 + 1] = flipV ? 1 - v : v
}
function texelOf(vi) {
  const x = Math.min(width - 1, Math.max(0, Math.round(uv[vi * 2] * (width - 1))))
  const y = Math.min(height - 1, Math.max(0, Math.round(uv[vi * 2 + 1] * (height - 1))))
  return [x, y]
}

// Each dark mark is one eye or mouth. Highlights inside a mark stay with it.
const RIM = 16
const GUTTER = 16
const dark = new Uint8Array(width * height)
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const c = pixel(x, y)
    const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    if (l < 0.22 && c[0] < 0.32 && c[1] < 0.32 && c[2] < 0.32) dark[y * width + x] = 1
  }
}
const mark = new Int16Array(width * height)
const sizes = [0]
const stack = []
for (let i = 0; i < dark.length; i++) {
  if (!dark[i] || mark[i]) continue
  const id = sizes.length
  let n = 0
  stack.push(i)
  mark[i] = id
  while (stack.length) {
    const p = stack.pop()
    n++
    const x = p % width
    const nb = [p - 1, p + 1, p - width, p + width]
    for (const q of nb) {
      if (q < 0 || q >= dark.length || mark[q] || !dark[q]) continue
      if (Math.abs((q % width) - x) > 1) continue
      mark[q] = id
      stack.push(q)
    }
  }
  sizes.push(n)
}
for (let i = 0; i < mark.length; i++) {
  if (mark[i] && sizes[mark[i]] < 400) mark[i] = 0
}
const outside = new Uint8Array(width * height)
const flood = []
for (let x = 0; x < width; x++) {
  flood.push(x, (height - 1) * width + x)
}
for (let y = 0; y < height; y++) {
  flood.push(y * width, y * width + width - 1)
}
while (flood.length) {
  const p = flood.pop()
  if (p < 0 || p >= mark.length || outside[p] || mark[p]) continue
  outside[p] = 1
  const x = p % width
  if (x > 0) flood.push(p - 1)
  if (x + 1 < width) flood.push(p + 1)
  flood.push(p - width, p + width)
}
const holeQ = []
for (let i = 0; i < mark.length; i++) if (mark[i]) holeQ.push(i)
let holes = 0
while (holeQ.length) {
  const p = holeQ.pop()
  const x = p % width
  const nb = [p - 1, p + 1, p - width, p + width]
  for (const q of nb) {
    if (q < 0 || q >= mark.length || outside[q] || mark[q]) continue
    if (Math.abs((q % width) - x) > 1) continue
    mark[q] = mark[p]
    holes++
    holeQ.push(q)
  }
}

const triCount = idx.length / 3
const triFeat = new Int32Array(triCount)
let shared = 0
for (let t = 0; t < triCount; t++) {
  const ia = idx[t * 3]
  const ib = idx[t * 3 + 1]
  const ic = idx[t * 3 + 2]
  const ua = uv[ia * 2], va = uv[ia * 2 + 1]
  const ub = uv[ib * 2], vb = uv[ib * 2 + 1]
  const uc = uv[ic * 2], vc = uv[ic * 2 + 1]
  const counts = new Map()
  const hit = (x, y) => {
    const m = mark[y * width + x]
    if (m) counts.set(m, (counts.get(m) || 0) + 1)
  }
  for (const vi of [ia, ib, ic]) {
    const [x, y] = texelOf(vi)
    hit(x, y)
  }
  const minx = Math.max(0, Math.floor(Math.min(ua, ub, uc) * (width - 1)))
  const maxx = Math.min(width - 1, Math.ceil(Math.max(ua, ub, uc) * (width - 1)))
  const miny = Math.max(0, Math.floor(Math.min(va, vb, vc) * (height - 1)))
  const maxy = Math.min(height - 1, Math.ceil(Math.max(va, vb, vc) * (height - 1)))
  const den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc)
  if (Math.abs(den) > 1e-12 && (maxx - minx + 1) * (maxy - miny + 1) < 400000) {
    for (let y = miny; y <= maxy; y++) {
      for (let x = minx; x <= maxx; x++) {
        const u = x / (width - 1)
        const v = y / (height - 1)
        const w0 = ((vb - vc) * (u - uc) + (uc - ub) * (v - vc)) / den
        const w1 = ((vc - va) * (u - uc) + (ua - uc) * (v - vc)) / den
        const w2 = 1 - w0 - w1
        if (w0 >= -0.002 && w1 >= -0.002 && w2 >= -0.002) hit(x, y)
      }
    }
  }
  let best = 0
  let bestN = 0
  let second = 0
  for (const [id, n] of counts) {
    if (n > bestN) {
      second = bestN
      bestN = n
      best = id
    } else if (n > second) second = n
  }
  triFeat[t] = best
  if (second > 0) shared++
}

const islands = []
for (let id = 1; id < sizes.length; id++) {
  if (sizes[id] < 400) continue
  islands.push({ id, minX: width, minY: height, maxX: 0, maxY: 0, tris: 0 })
}
const byId = new Map(islands.map((island) => [island.id, island]))
for (let i = 0; i < mark.length; i++) {
  const island = byId.get(mark[i])
  if (!island) continue
  const x = i % width
  const y = (i / width) | 0
  island.minX = Math.min(island.minX, x)
  island.minY = Math.min(island.minY, y)
  island.maxX = Math.max(island.maxX, x)
  island.maxY = Math.max(island.maxY, y)
}
for (let t = 0; t < triCount; t++) {
  const island = byId.get(triFeat[t])
  if (!island) continue
  island.tris++
  for (let k = 0; k < 3; k++) {
    const [x, y] = texelOf(idx[t * 3 + k])
    island.minX = Math.min(island.minX, x)
    island.minY = Math.min(island.minY, y)
    island.maxX = Math.max(island.maxX, x)
    island.maxY = Math.max(island.maxY, y)
  }
}
for (const island of islands) {
  if (!island.tris) continue
  island.minX = Math.max(0, island.minX - RIM)
  island.minY = Math.max(0, island.minY - RIM)
  island.maxX = Math.min(width - 1, island.maxX + RIM)
  island.maxY = Math.min(height - 1, island.maxY + RIM)
  island.w = island.maxX - island.minX + 1
  island.h = island.maxY - island.minY + 1
}
const packed = islands.filter((island) => island.tris)
const widest = packed.reduce((m, island) => Math.max(m, island.w), 0) + 4
let atlasW = 256
while (atlasW < widest) atlasW *= 2
if (atlasW > 2048) throw new Error('face island wider than 2048')
let cursorX = 2
let cursorY = 2
let rowH = 0
for (const island of packed) {
  if (cursorX + island.w + 2 > atlasW) {
    cursorX = 2
    cursorY += rowH + GUTTER
    rowH = 0
  }
  island.ox = cursorX
  island.oy = cursorY
  cursorX += island.w + GUTTER
  rowH = Math.max(rowH, island.h)
}
let atlasH = 2
while (atlasH < cursorY + rowH + 2) atlasH *= 2
if (atlasH > 2048) throw new Error('face atlas taller than 2048')

const rim = new Map()
for (const island of packed) {
  let sr = 0
  let sg = 0
  let sb = 0
  let n = 0
  for (let y = island.minY; y <= island.maxY; y++) {
    for (let x = island.minX; x <= island.maxX; x++) {
      const i = y * width + x
      if (mark[i] !== island.id) continue
      const nb = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]
      for (const [nx, ny] of nb) {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (mark[ny * width + nx]) continue
        const c = pixel(nx, ny)
        sr += c[0]
        sg += c[1]
        sb += c[2]
        n++
      }
    }
  }
  rim.set(island.id, n ? [Math.round(sr / n * 255), Math.round(sg / n * 255), Math.round(sb / n * 255)] : [210, 170, 40])
}
const rgba = new Uint8Array(atlasW * atlasH * 4)
for (const island of packed) {
  for (let ly = 0; ly < island.h; ly++) {
    for (let lx = 0; lx < island.w; lx++) {
      const sx = island.minX + lx
      const sy = island.minY + ly
      const m = mark[sy * width + sx]
      let r
      let g
      let b
      if (m === 0 || m === island.id) {
        const c = pixel(sx, sy)
        r = Math.round(c[0] * 255)
        g = Math.round(c[1] * 255)
        b = Math.round(c[2] * 255)
      } else {
        const c = rim.get(island.id)
        r = c[0]
        g = c[1]
        b = c[2]
      }
      const o = ((island.oy + ly) * atlasW + (island.ox + lx)) * 4
      rgba[o] = r
      rgba[o + 1] = g
      rgba[o + 2] = b
      rgba[o + 3] = 255
    }
  }
}
const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
  CRC_TABLE[n] = c >>> 0
}
writePng(facePath, atlasW, atlasH, rgba)

function outsideColor(x, y) {
  for (let r = 1; r <= 96; r++) {
    for (let dy = -r; dy <= r; dy++) {
      const y2 = y + dy
      if (y2 < 0 || y2 >= height) continue
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
        const x2 = x + dx
        if (x2 < 0 || x2 >= width) continue
        if (mark[y2 * width + x2]) continue
        const c = pixel(x2, y2)
        return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]
      }
    }
  }
  return [210, 170, 40]
}
function colorOf(vi) {
  const [x, y] = texelOf(vi)
  if (!mark[y * width + x]) {
    const c = pixel(x, y)
    return [Math.round(c[0] * 255), Math.round(c[1] * 255), Math.round(c[2] * 255)]
  }
  return outsideColor(x, y)
}
function remap(u, v, island) {
  let dx = island.ox + (u * (width - 1) - island.minX)
  let dy = island.oy + (v * (height - 1) - island.minY)
  dx = Math.min(island.ox + island.w - 1, Math.max(island.ox, dx))
  dy = Math.min(island.oy + island.h - 1, Math.max(island.oy, dy))
  return [dx / (atlasW - 1), dy / (atlasH - 1)]
}

const posList = []
const nrmList = []
const jntList = []
const wgtList = []
const uvList = []
const rgbList = []
const outIdx = new Uint16Array(idx.length)
const copied = new Map()
let outCount = 0
let recolored = 0
function emit(vi, feat) {
  const key = vi + ':' + feat
  const have = copied.get(key)
  if (have != null) return have
  if (outCount >= 65535) throw new Error('actor vertex limit')
  const ni = outCount++
  copied.set(key, ni)
  posList.push(pos[vi * 3], pos[vi * 3 + 1], pos[vi * 3 + 2])
  nrmList.push(nrm[vi * 3], nrm[vi * 3 + 1], nrm[vi * 3 + 2])
  jntList.push(jnt[vi * 4], jnt[vi * 4 + 1], jnt[vi * 4 + 2], jnt[vi * 4 + 3])
  wgtList.push(wgt[vi * 4], wgt[vi * 4 + 1], wgt[vi * 4 + 2], wgt[vi * 4 + 3])
  const col = colorOf(vi)
  const [x, y] = texelOf(vi)
  if (mark[y * width + x]) recolored++
  rgbList.push(col[0], col[1], col[2])
  if (!feat) {
    uvList.push(0, 0)
  } else {
    const island = byId.get(feat)
    uvList.push(...remap(uv[vi * 2], uv[vi * 2 + 1], island))
  }
  return ni
}
for (let t = 0; t < triCount; t++) {
  const feat = triFeat[t]
  outIdx[t * 3] = emit(idx[t * 3], feat)
  outIdx[t * 3 + 1] = emit(idx[t * 3 + 1], feat)
  outIdx[t * 3 + 2] = emit(idx[t * 3 + 2], feat)
}
const outPos = Float32Array.from(posList)
const outNrm = Float32Array.from(nrmList)
const outJnt = Uint8Array.from(jntList)
const outWgt = Float32Array.from(wgtList)
const outUv = Float32Array.from(uvList)
const outRgb = Uint8Array.from(rgbList)
console.log(`face islands ${packed.length} holes ${holes} split ${outCount - vcount} recolored ${recolored} shared ${shared} atlas ${atlasW}x${atlasH}`)
for (const island of packed) {
  console.log(`  #${island.id} tris ${island.tris} ${island.w}x${island.h} at ${island.ox},${island.oy}`)
}

function clipOf(anim) {
  const byNode = new Map()
  for (const channel of anim.channels) {
    const sampler = anim.samplers[channel.sampler]
    const name = json.nodes[channel.target.node].name
    const slot = byNode.get(name) || { t: null, r: null, s: null }
    const times = readAcc(sampler.input).map((row) => row[0])
    const values = readAcc(sampler.output)
    slot[channel.target.path === 'translation' ? 't' : channel.target.path === 'rotation' ? 'r' : 's'] = { times, values }
    byNode.set(name, slot)
  }
  let duration = 0
  const tracks = NAMES.map((name) => {
    const slot = byNode.get(name)
    if (!slot || !slot.t || !slot.r || !slot.s) return null
    const times = slot.t.times
    duration = Math.max(duration, times[times.length - 1])
    const trs = new Float32Array(times.length * 10)
    for (let i = 0; i < times.length; i++) {
      trs.set(slot.t.values[i], i * 10)
      trs.set(slot.r.values[i], i * 10 + 3)
      trs.set(slot.s.values[i], i * 10 + 7)
    }
    return {
      times: Buffer.from(Float32Array.from(times).buffer).toString('base64'),
      trs: Buffer.from(trs.buffer).toString('base64'),
    }
  })
  return { duration, tracks }
}

const b64 = (typed) => Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength).toString('base64')
const file = {
  parents: PARENT,
  rest: b64(rest),
  joints,
  ibm: b64(ibm),
  pos: b64(outPos),
  nrm: b64(outNrm),
  jnt: b64(outJnt),
  wgt: b64(outWgt),
  idx: b64(outIdx),
  uv: b64(outUv),
  rgb: b64(outRgb),
  idle: clipOf(json.animations.find((a) => a.name.includes('Idle'))),
  walk: clipOf(json.animations.find((a) => a.name.includes('Walk'))),
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(file))
const bytes = readFileSync(outPath).length
console.log(`verts ${outCount} tris ${outIdx.length / 3} winding ${outward < 0 ? 'flipped' : 'kept'}`)
console.log(`bounds y ${min[1].toFixed(3)}..${max[1].toFixed(3)} x ${min[0].toFixed(3)}..${max[0].toFixed(3)} z ${min[2].toFixed(3)}..${max[2].toFixed(3)}`)
console.log(`uv flip ${flipV} crown ${chosen.top.map((c) => c.toFixed(2)).join(',')} body ${chosen.body.map((c) => c.toFixed(2)).join(',')}`)
console.log(`idle ${file.idle.duration.toFixed(3)}s walk ${file.walk.duration.toFixed(3)}s`)
console.log(`wrote ${outPath} ${bytes} bytes`)

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function pngChunk(type, data) {
  const head = Buffer.alloc(4)
  head.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([head, body, crc])
}
function writePng(path, w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1)
    raw[row] = 0
    raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), row + 1)
  }
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
  writeFileSync(path, png)
}
