export function perspective(fovy: number, aspect: number, near: number, far: number, out: Float32Array): void {
  const f = 1 / Math.tan(fovy / 2)
  out[0] = f / aspect; out[1] = 0; out[2] = 0; out[3] = 0
  out[4] = 0; out[5] = f; out[6] = 0; out[7] = 0
  out[8] = 0; out[9] = 0; out[10] = (far + near) / (near - far); out[11] = -1
  out[12] = 0; out[13] = 0; out[14] = (2 * far * near) / (near - far); out[15] = 0
}

export function lookAt(
  eye: number[], target: number[], up: number[], out: Float32Array,
): void {
  let zx = eye[0] - target[0]
  let zy = eye[1] - target[1]
  let zz = eye[2] - target[2]
  let len = Math.hypot(zx, zy, zz) || 1
  zx /= len; zy /= len; zz /= len
  let xx = up[1] * zz - up[2] * zy
  let xy = up[2] * zx - up[0] * zz
  let xz = up[0] * zy - up[1] * zx
  len = Math.hypot(xx, xy, xz) || 1
  xx /= len; xy /= len; xz /= len
  const yx = zy * xz - zz * xy
  const yy = zz * xx - zx * xz
  const yz = zx * xy - zy * xx
  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2])
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2])
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2])
  out[15] = 1
}

export function multiply(a: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3]
    }
  }
}

export function ortho(
  left: number, right: number, bottom: number, top: number, near: number, far: number, out: Float32Array,
): void {
  out.fill(0)
  out[0] = 2 / (right - left)
  out[5] = 2 / (top - bottom)
  out[10] = -2 / (far - near)
  out[12] = -(right + left) / (right - left)
  out[13] = -(top + bottom) / (top - bottom)
  out[14] = -(far + near) / (far - near)
  out[15] = 1
}

export function identity(out: Float32Array): void {
  out.fill(0)
  out[0] = out[5] = out[10] = out[15] = 1
}
