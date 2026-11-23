export interface MeshData {
  interleaved: Float32Array
  indices: Uint16Array
  receiveShadow: boolean
  doubleSided?: boolean
  /** Clouds, rain, and falls. Opaque meshes skip blending so the GPU can reject hidden pixels. */
  blended?: boolean
  /** Terrain keeps its mesh and is shaded with the painted-ground pass. */
  role?: 'ground'
  /** Drawn into the water mirror. Water surfaces stay out so the reflection cannot see itself. */
  reflect?: boolean
}

export type RGB = [number, number, number]

export const KIND_GROUND = 0
export const KIND_WATER = 1
export const KIND_GRASS = 2
export const KIND_RAIN = 3
export const KIND_FIRE = 4
export const KIND_CLOUD = 5
export const KIND_PROP = 6
export const KIND_WINDOW = 7
export const KIND_FALLS = 8
export const KIND_BARK = 9
export const KIND_ROCK = 10
/** Pineapple house — samples boluo1 BaseColor/Normal with authored UVs. */
export const KIND_BOLUO = 11
/** Dock — samples dock oil albedo with authored UVs. */
export const KIND_DOCK = 12
/** Wonderland leaf clump. Normal packs the billboard corner and size; UV is the leaf atlas. */
export const KIND_LEAF = 13

/** Floats per vertex: pos, normal, color, kind, uv. */
export const FLOATS = 12

/**
 * Atlas cell in texture space after UNPACK_FLIP_Y.
 * Row 0 is the top row of public/oil/atlas.png.
 */
export function atlasUv(col: number, row: number, u: number, v: number): [number, number] {
  return [(col + u) / 4, (3 - row + v) / 4]
}

export class Builder {
  private verts: number[] = []
  private idx: number[] = []

  vertex(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    color: RGB, kind: number,
    u = 0, v = 0,
  ): number {
    const i = this.verts.length / FLOATS
    const len = Math.hypot(nx, ny, nz) || 1
    this.verts.push(x, y, z, nx / len, ny / len, nz / len, color[0], color[1], color[2], kind, u, v)
    return i
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c)
  }

  card(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    c0: RGB, c1: RGB, c2: RGB, c3: RGB,
    kind: number,
    uvs?: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]],
  ): void {
    const ux = bx - ax
    const uy = by - ay
    const uz = bz - az
    const vx = dx - ax
    const vy = dy - ay
    const vz = dz - az
    const nx = uy * vz - uz * vy
    const ny = uz * vx - ux * vz
    const nz = ux * vy - uy * vx
    const uv = uvs ?? [[0, 0], [0, 0], [0, 0], [0, 0]] as const
    const i = this.vertex(ax, ay, az, nx, ny, nz, c0, kind, uv[0][0], uv[0][1])
    this.vertex(bx, by, bz, nx, ny, nz, c1, kind, uv[1][0], uv[1][1])
    this.vertex(cx, cy, cz, nx, ny, nz, c2, kind, uv[2][0], uv[2][1])
    this.vertex(dx, dy, dz, nx, ny, nz, c3, kind, uv[3][0], uv[3][1])
    this.tri(i, i + 1, i + 2)
    this.tri(i, i + 2, i + 3)
  }

  quad(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    cx: number, cy: number, cz: number,
    dx: number, dy: number, dz: number,
    color: RGB,
    kind: number,
    refX: number, refY: number, refZ: number,
    uvs?: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]],
  ): void {
    this.face(
      [ax, ay, az], [bx, by, bz], [cx, cy, cz], [dx, dy, dz],
      [color, color, color, color], kind, refX, refY, refZ, uvs,
    )
  }

  triangle(
    ax: number, ay: number, az: number, ca: RGB,
    bx: number, by: number, bz: number, cb: RGB,
    cx: number, cy: number, cz: number, cc: RGB,
    kind: number,
    refX: number, refY: number, refZ: number,
  ): void {
    let p0: [number, number, number] = [ax, ay, az]
    let p1: [number, number, number] = [bx, by, bz]
    let p2: [number, number, number] = [cx, cy, cz]
    let k0 = ca
    let k1 = cb
    let k2 = cc
    const ux = p1[0] - p0[0]
    const uy = p1[1] - p0[1]
    const uz = p1[2] - p0[2]
    const vx = p2[0] - p0[0]
    const vy = p2[1] - p0[1]
    const vz = p2[2] - p0[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const mx = (p0[0] + p1[0] + p2[0]) / 3
    const my = (p0[1] + p1[1] + p2[1]) / 3
    const mz = (p0[2] + p1[2] + p2[2]) / 3
    if (nx * (mx - refX) + ny * (my - refY) + nz * (mz - refZ) < 0) {
      nx = -nx; ny = -ny; nz = -nz
      const swap = p1; p1 = p2; p2 = swap
      const sc = k1; k1 = k2; k2 = sc
    }
    const i = this.vertex(p0[0], p0[1], p0[2], nx, ny, nz, k0, kind)
    this.vertex(p1[0], p1[1], p1[2], nx, ny, nz, k1, kind)
    this.vertex(p2[0], p2[1], p2[2], nx, ny, nz, k2, kind)
    this.tri(i, i + 1, i + 2)
  }

  face(
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    colors: [RGB, RGB, RGB, RGB],
    kind: number,
    refX: number, refY: number, refZ: number,
    uvs?: readonly [readonly [number, number], readonly [number, number], readonly [number, number], readonly [number, number]],
  ): void {
    const src = uvs ?? [[0, 0], [0, 0], [0, 0], [0, 0]] as const
    let u0 = src[0], u1 = src[1], u2 = src[2], u3 = src[3]
    const ux = b[0] - a[0]
    const uy = b[1] - a[1]
    const uz = b[2] - a[2]
    const vx = d[0] - a[0]
    const vy = d[1] - a[1]
    const vz = d[2] - a[2]
    let nx = uy * vz - uz * vy
    let ny = uz * vx - ux * vz
    let nz = ux * vy - uy * vx
    const mx = (a[0] + b[0] + c[0] + d[0]) * 0.25
    const my = (a[1] + b[1] + c[1] + d[1]) * 0.25
    const mz = (a[2] + b[2] + c[2] + d[2]) * 0.25
    let p0 = a, p1 = b, p2 = c, p3 = d
    let c0 = colors[0], c1 = colors[1], c2 = colors[2], c3 = colors[3]
    if (nx * (mx - refX) + ny * (my - refY) + nz * (mz - refZ) < 0) {
      nx = -nx; ny = -ny; nz = -nz
      p1 = d; p2 = c; p3 = b
      c1 = colors[3]; c2 = colors[2]; c3 = colors[1]
      u1 = src[3]; u2 = src[2]; u3 = src[1]
    }
    const i = this.vertex(p0[0], p0[1], p0[2], nx, ny, nz, c0, kind, u0[0], u0[1])
    this.vertex(p1[0], p1[1], p1[2], nx, ny, nz, c1, kind, u1[0], u1[1])
    this.vertex(p2[0], p2[1], p2[2], nx, ny, nz, c2, kind, u2[0], u2[1])
    this.vertex(p3[0], p3[1], p3[2], nx, ny, nz, c3, kind, u3[0], u3[1])
    this.tri(i, i + 1, i + 2)
    this.tri(i, i + 2, i + 3)
  }

  finish(receiveShadow: boolean, doubleSided = false): MeshData {
    if (this.idx.length > 65535) throw new Error('mesh index limit')
    return {
      interleaved: new Float32Array(this.verts),
      indices: new Uint16Array(this.idx),
      receiveShadow,
      doubleSided,
    }
  }

  get empty(): boolean {
    return this.idx.length === 0
  }
}

export function hash(x: number, z: number): number {
  const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453
  return n - Math.floor(n)
}

export function shade(color: RGB, x: number, z: number): RGB {
  const k = 0.92 + hash(x, z) * 0.14
  return [color[0] * k, color[1] * k, color[2] * k]
}

export function emptyMesh(): MeshData {
  return {
    interleaved: new Float32Array(FLOATS),
    indices: new Uint16Array([0, 0, 0]),
    receiveShadow: false,
  }
}
