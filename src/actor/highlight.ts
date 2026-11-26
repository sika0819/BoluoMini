import { ACTOR_LIFT, ACTOR_SCALE, type Actor } from './skin'
import { KIND_BEAT, FLOATS, type MeshData } from '../scene/mesh'

/** Low-poly eye centers in bind space (Blender Z-up), from the rebuild. */
const EYES = [
  { x: -0.0945, y: -0.2557, z: 0.6282 },
  { x: 0.0945, y: -0.2557, z: 0.6282 },
]
/** Front bulge of the eye along bind -Y, which skinning turns into actor +Z. */
const EYE_DEPTH = 0.028
/** How far the white disc may travel across the pupil, in bind units. */
const PUPIL = 0.02
/** Resting catchlight: up, and toward screen-right when the face looks at the camera. */
const REST_X = 0.01
const REST_Y = 0.012
const DISC_R = 0.011
const SEGS = 14
const BIAS = 0.008

function hypot(x: number, y: number, z = 0): number {
  return Math.hypot(x, y, z)
}

/** Actor-local point (Y-up, after the chest) into world. Face is +Z, screen-right is +X. */
function toWorld(
  pose: { x: number; y: number; z: number; yaw: number; lift: number },
  px: number, py: number, pz: number,
): { x: number; y: number; z: number } {
  const cy = Math.cos(pose.yaw)
  const sy = Math.sin(pose.yaw)
  const s = ACTOR_SCALE
  return {
    x: pose.x + s * (cy * px + sy * pz),
    y: pose.y + ACTOR_LIFT + pose.lift + s * py,
    z: pose.z + s * (-sy * px + cy * pz),
  }
}

function toLocal(yaw: number, wx: number, wy: number, wz: number): { x: number; y: number; z: number } {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  return { x: cy * wx - sy * wz, y: wy, z: sy * wx + cy * wz }
}

export function createCatchlights(): MeshData {
  const verts = EYES.length * (SEGS + 1)
  const interleaved = new Float32Array(verts * FLOATS)
  const indices = new Uint16Array(EYES.length * SEGS * 3)
  for (let e = 0; e < EYES.length; e++) {
    const base = e * (SEGS + 1)
    for (let i = 0; i < SEGS; i++) {
      const o = (e * SEGS + i) * 3
      indices[o] = base
      indices[o + 1] = base + 1 + ((i + 1) % SEGS)
      indices[o + 2] = base + 1 + i
    }
    for (let i = 0; i < SEGS + 1; i++) {
      const o = (base + i) * FLOATS
      interleaved[o + 6] = 0.98
      interleaved[o + 7] = 0.98
      interleaved[o + 8] = 0.97
      interleaved[o + 9] = KIND_BEAT
    }
  }
  return { interleaved, indices, receiveShadow: false, doubleSided: true, dynamic: true }
}

/**
 * Two camera-facing discs. World radius stays fixed, so orbiting never turns them into ellipses.
 * The center slides a little on the pupil as the view direction changes.
 */
export function updateCatchlights(
  mesh: MeshData,
  actor: Actor,
  pose: { x: number; y: number; z: number; yaw: number; lift: number },
  cam: { x: number; y: number; z: number },
): void {
  const dst = mesh.interleaved
  const radius = DISC_R * ACTOR_SCALE
  for (let e = 0; e < EYES.length; e++) {
    const bind = EYES[e]
    const posed = actor.posePoint(bind.x, bind.y, bind.z)
    const eye = toWorld(pose, posed.x, posed.y, posed.z)
    let vx = cam.x - eye.x
    let vy = cam.y - eye.y
    let vz = cam.z - eye.z
    const vlen = hypot(vx, vy, vz) || 1
    vx /= vlen
    vy /= vlen
    vz /= vlen
    const view = toLocal(pose.yaw, vx, vy, vz)
    let ox = REST_X + view.x * 0.035
    let oy = REST_Y + view.y * 0.035
    const olen = Math.hypot(ox, oy)
    if (olen > PUPIL) {
      ox *= PUPIL / olen
      oy *= PUPIL / olen
    }
    const depth = Math.sqrt(Math.max(0.0004, EYE_DEPTH * EYE_DEPTH - ox * ox - oy * oy))
    const surf = toWorld(pose, posed.x + ox, posed.y + oy, posed.z + depth)
    const cx = surf.x + vx * BIAS
    const cy = surf.y + vy * BIAS
    const cz = surf.z + vz * BIAS
    // right = view × world-up, then disc-up = view × right, so the normal faces the camera.
    let rx = -vz
    let ry = 0
    let rz = vx
    const rl = Math.hypot(rx, rz) || 1
    rx /= rl
    rz /= rl
    const ux = ry * vz - rz * vy
    const uy = rz * vx - rx * vz
    const uz = rx * vy - ry * vx
    const base = e * (SEGS + 1)
    write(dst, base, cx, cy, cz, vx, vy, vz)
    for (let i = 0; i < SEGS; i++) {
      const a = (i / SEGS) * Math.PI * 2
      const c = Math.cos(a)
      const s = Math.sin(a)
      write(
        dst, base + 1 + i,
        cx + (rx * c + ux * s) * radius,
        cy + (ry * c + uy * s) * radius,
        cz + (rz * c + uz * s) * radius,
        vx, vy, vz,
      )
    }
  }
}

function write(dst: Float32Array, i: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
  const o = i * FLOATS
  dst[o] = x
  dst[o + 1] = y
  dst[o + 2] = z
  dst[o + 3] = nx
  dst[o + 4] = ny
  dst[o + 5] = nz
}
