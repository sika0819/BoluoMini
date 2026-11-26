export interface MeshData {
  interleaved: Float32Array
  indices: Uint16Array
  receiveShadow: boolean
  doubleSided?: boolean
  /** Clouds, rain, and falls. Opaque meshes skip blending so the GPU can reject hidden pixels. */
  blended?: boolean
  /** Terrain keeps its mesh and is shaded with the painted-ground pass. Trees join the same outline list. */
  role?: 'ground' | 'tree'
  /** Drawn into the water mirror. Water surfaces stay out so the reflection cannot see itself. */
  reflect?: boolean
  /** Positions change every frame. The renderer reuploads the vertex buffer. */
  dynamic?: boolean
  /** Noise-fire card. Drawn with the campfire pass, not the lit shader. */
  flame?: boolean
}

export type RGB = [number, number, number]

export const KIND_GROUND = 0
export const KIND_WATER = 1
export const KIND_GRASS = 2
export const KIND_RAIN = 3
export const KIND_FIRE = 4
export const KIND_CLOUD = 5
export const KIND_PROP = 6
/**
 * Player pineapple. Flat cartoon vertex color on the low-poly mesh.
 * On the rind, uv is the unit axis angle. Kind packs height and the
 * grid strength, so a fade cannot bend the scales.
 */
export const KIND_ACTOR = 15
export const KIND_FALLS = 8
/**
 * Bark stroke. Normal is the surface. Color is the grain direction, not a pigment.
 * Kind is 9 plus 0.2 times the species (0 beech, 1 birch, 2 oak).
 * UV is the signed half-size, across then along the grain.
 */
export const KIND_BARK = 9
export const KIND_ROCK = 10
/** Dock — samples dock oil albedo with authored UVs. */
export const KIND_DOCK = 12
/** Wonderland leaf clump. Normal packs the billboard corner and size; UV is the leaf atlas. */
export const KIND_LEAF = 13
/**
 * Autumn-wood crown touch. Normal is the outward direction of the clump.
 * UV is the signed half-size of the stroke (across, along). The shader picks brush cells 4 and 5.
 */
export const KIND_CROWN = 14
/**
 * Wonderland wildflower. Kind is 16 plus 0.1 times the species
 * (0 poppy, 1 daisy, 2 pink, 3 lupin, 4 yellow).
 * A blossom fan shares one root. Normal xy is the unit disc, nz is 1 on a petal tip and 2 in a notch.
 * UV is the radius in metres, then the height of the head.
 * A stem uses nz 0, normal x as the side, normal y as the height fraction, and a negative UV height.
 */
export const KIND_FLOWER = 16
/** Beat ring. Vertex color is the signal, not a lit surface. */
export const KIND_BEAT = 17

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

  /**
   * One camera-facing brush touch. Every corner shares the center.
   * Normal xy is the signed half-size; nz stays 1 so the shader can recover it after normalization.
   * Cell is a mark on oil/brush.png (4 columns, 2 rows, row 0 at the top).
   */
  stroke(
    x: number, y: number, z: number,
    hx: number, hy: number,
    foot: RGB, tip: RGB,
    cell: number,
    flipU = false,
  ): void {
    const col = cell % 4
    const row = (cell / 4) | 0
    const u0 = col / 4
    const u1 = u0 + 0.25
    const vTop = (2 - row) / 2
    const vBot = vTop - 0.5
    const ul = flipU ? u1 : u0
    const ur = flipU ? u0 : u1
    const i = this.vertex(x, y, z, -hx, -hy, 1, foot, KIND_LEAF, ul, vBot)
    this.vertex(x, y, z, hx, -hy, 1, foot, KIND_LEAF, ur, vBot)
    this.vertex(x, y, z, hx, hy, 1, tip, KIND_LEAF, ur, vTop)
    this.vertex(x, y, z, -hx, hy, 1, tip, KIND_LEAF, ul, vTop)
    this.tri(i, i + 1, i + 2)
    this.tri(i, i + 2, i + 3)
  }

  private vertexRaw(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    color: RGB, kind: number,
    u = 0, v = 0,
  ): number {
    const i = this.verts.length / FLOATS
    this.verts.push(x, y, z, nx, ny, nz, color[0], color[1], color[2], kind, u, v)
    return i
  }

  /**
   * One bark stroke. It faces the camera and runs along the grain.
   * hx and hy are half-sizes in metres. Species is 0 beech, 1 birch, 2 oak.
   */
  barkDab(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    dx: number, dy: number, dz: number,
    hx: number, hy: number,
    species: number,
  ): void {
    const kind = KIND_BARK + species * 0.2
    const i = this.vertexRaw(x, y, z, nx, ny, nz, [dx, dy, dz], kind, -hx, -hy)
    this.vertexRaw(x, y, z, nx, ny, nz, [dx, dy, dz], kind, hx, -hy)
    this.vertexRaw(x, y, z, nx, ny, nz, [dx, dy, dz], kind, hx, hy)
    this.vertexRaw(x, y, z, nx, ny, nz, [dx, dy, dz], kind, -hx, hy)
    this.tri(i, i + 1, i + 2)
    this.tri(i, i + 2, i + 3)
  }

  /**
   * One wonderland blossom: ten petals around a centre, facing the camera in the shader.
   * radius is half the width. rise is how far above the root the head sits.
   */
  blossom(x: number, y: number, z: number, radius: number, rise: number, species: number): void {
    const kind = KIND_FLOWER + species * 0.1
    const color: RGB = [1, 1, 1]
    const rim = 10
    const i = this.vertexRaw(x, y, z, 0, 0, 1, color, kind, radius, rise)
    for (let k = 0; k < rim; k++) {
      const a = (k / rim) * Math.PI * 2
      this.vertexRaw(x, y, z, Math.cos(a), Math.sin(a), k % 2 ? 2 : 1, color, kind, radius, rise)
    }
    for (let k = 0; k < rim; k++) this.tri(i, i + 1 + k, i + 1 + ((k + 1) % rim))
  }

  /** Thin stem under a blossom. rise is the full height. The shader keeps it facing the camera. */
  flowerStem(x: number, y: number, z: number, rise: number, species: number): void {
    const kind = KIND_FLOWER + species * 0.1
    const color: RGB = [0.3, 0.46, 0.22]
    const hw = 0.012
    const i = this.vertexRaw(x, y, z, -1, 0, 0, color, kind, hw, -rise)
    this.vertexRaw(x, y, z, 1, 0, 0, color, kind, hw, -rise)
    this.vertexRaw(x, y, z, -1, 1, 0, color, kind, hw, -rise)
    this.vertexRaw(x, y, z, 1, 1, 0, color, kind, hw, -rise)
    this.tri(i, i + 1, i + 2)
    this.tri(i + 1, i + 3, i + 2)
  }

  /**
   * One crown stroke from the autumn wood. It faces the camera, runs across the clump's
   * outline, and is longer along the stroke than across it. hx and hy are half-sizes in metres.
   */
  dab(
    x: number, y: number, z: number,
    nx: number, ny: number, nz: number,
    hx: number, hy: number,
    color: RGB,
  ): void {
    const i = this.vertexRaw(x, y, z, nx, ny, nz, color, KIND_CROWN, -hx, -hy)
    this.vertexRaw(x, y, z, nx, ny, nz, color, KIND_CROWN, hx, -hy)
    this.vertexRaw(x, y, z, nx, ny, nz, color, KIND_CROWN, hx, hy)
    this.vertexRaw(x, y, z, nx, ny, nz, color, KIND_CROWN, -hx, hy)
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

  get indexCount(): number {
    return this.idx.length
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
