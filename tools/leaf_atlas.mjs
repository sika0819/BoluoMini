import { deflateSync } from 'zlib'
import { writeFileSync } from 'fs'

const COLS = 4
const ROWS = 2
const T = 128
const W = COLS * T
const H = ROWS * T
const pix = new Uint8Array(W * H * 4)

function rngOf(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
}

function set(x, y, v) {
  x = x | 0
  y = y | 0
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  pix[i] = pix[i + 1] = pix[i + 2] = v
  pix[i + 3] = 255
}

function fillPoly(pts, v) {
  let minY = 1e9
  let maxY = -1e9
  for (const p of pts) {
    if (p[1] < minY) minY = p[1]
    if (p[1] > maxY) maxY = p[1]
  }
  for (let y = Math.floor(minY); y <= Math.ceil(maxY); y++) {
    const xs = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        const t = (y - a[1]) / (b[1] - a[1] || 1e-6)
        xs.push(a[0] + (b[0] - a[0]) * t)
      }
    }
    xs.sort((a, b) => a - b)
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const x0 = Math.floor(xs[i])
      const x1 = Math.ceil(xs[i + 1])
      for (let x = x0; x <= x1; x++) set(x, y, v)
    }
  }
}

function curve(p0, c, p1, n) {
  const o = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    o.push([
      u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0],
      u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1],
    ])
  }
  return o
}

function leafPoly(cx, cy, R, bx, by, ang, len, hw) {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const P = (u, v) => [cx + (bx + u * c - v * s) * R, cy + (by + u * s + v * c) * R]
  const p0 = P(-len * 0.04, 0)
  const tip = P(len, 0)
  const left = curve(p0, P(len * 0.28, -hw * 2.1), tip, 7)
  const right = curve(tip, P(len * 0.28, hw * 2.1), p0, 7)
  return left.concat(right.slice(1))
}

function fitLen(bx, by, ang, len) {
  for (let k = 0; k < 8; k++) {
    if (Math.hypot(bx + Math.cos(ang) * len, by + Math.sin(ang) * len) <= 0.9) break
    len *= 0.9
  }
  return len
}

for (let i = 0; i < COLS * ROWS; i++) {
  const rng = rngOf(911 + i * 53)
  const col = i % COLS
  const row = Math.floor(i / COLS)
  const cx = (col + 0.5) * T
  const cy = (ROWS - 1 - row + 0.5) * T
  const R = T / 2
  const range = (a, b) => a + rng() * (b - a)
  if (i < 6) {
    const nv = 9
    const r0 = range(0.38, 0.46)
    const blob = []
    for (let k = 0; k < nv; k++) {
      const a = (k / nv) * Math.PI * 2 + range(-0.2, 0.2)
      const r = r0 * range(0.82, 1.15)
      blob.push([cx + Math.cos(a) * r * R, cy + Math.sin(a) * r * R])
    }
    fillPoly(blob, 255)
    const n = 7 + Math.floor(rng() * 3)
    const a0 = rng() * Math.PI * 2
    for (let k = 0; k < n; k++) {
      const a = a0 + (k / n) * Math.PI * 2 + range(-0.22, 0.22)
      const rb = range(0.18, 0.34)
      const bx = Math.cos(a) * rb
      const by = Math.sin(a) * rb
      const dir = a + range(-0.5, 0.5)
      const len = fitLen(bx, by, dir, range(0.5, 0.68))
      fillPoly(leafPoly(cx, cy, R, bx, by, dir, len, len * range(0.21, 0.28)), 255)
    }
    for (let k = 0; k < 2; k++) {
      const a = rng() * Math.PI * 2
      const len = range(0.32, 0.48)
      fillPoly(leafPoly(cx, cy, R, Math.cos(a) * 0.8, Math.sin(a) * 0.8, a + Math.PI + range(-0.35, 0.35), len, 0.085), 0)
    }
  } else {
    fillPoly(leafPoly(cx, cy, R, 0, 0, 0, 0.2, 0.2), 255)
    const a0 = rng() * Math.PI * 2
    for (let k = 0; k < 3; k++) {
      const a = a0 + (k / 3) * Math.PI * 2 + range(-0.4, 0.4)
      const rb = range(0.08, 0.22)
      const bx = Math.cos(a) * rb
      const by = Math.sin(a) * rb
      const m = 2 + Math.floor(rng() * 2)
      for (let j = 0; j < m; j++) {
        const dir = a + (j - (m - 1) / 2) * 0.8 + range(-0.2, 0.2)
        const len = fitLen(bx, by, dir, range(0.55, 0.74))
        fillPoly(leafPoly(cx, cy, R, bx, by, dir, len, len * range(0.2, 0.26)), 255)
      }
    }
  }
}

const src = pix.slice()
for (let y = 1; y < H - 1; y++) {
  for (let x = 1; x < W - 1; x++) {
    let s = 0
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) s += src[((y + dy) * W + (x + dx)) * 4]
    }
    const v = (s / 9) | 0
    const i = (y * W + x) * 4
    pix[i] = pix[i + 1] = pix[i + 2] = v
  }
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const table = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  table[n] = c
}
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 255] ^ (c >>> 8)
  return c ^ 0xffffffff
}

const raw = Buffer.alloc(H * (W * 4 + 1))
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0
  Buffer.from(pix.buffer, pix.byteOffset + y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1)
}
const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(W, 0)
ihdr.writeUInt32BE(H, 4)
ihdr[8] = 8
ihdr[9] = 6
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
])
writeFileSync(new URL('../public/oil/leaves.png', import.meta.url), png)
console.log('leaves.png', png.length)
