import { MOVE_SPEED } from '../scene/collide'

const TURN = 0.1
const CAM = 0.35
/** Below this stick length the body only turns. Past it, it walks. */
const PIVOT = 0.4
const SLOW = 50 * Math.PI / 180
/**
 * While the face is this far from the lens, the camera holds.
 * Otherwise holding the stick to one side spins the world, because the
 * stick is read relative to a camera that is chasing the body.
 */
const HOLD = 0.45

export interface Body {
  x: number
  z: number
  yaw: number
  camYaw: number
}

function wrap(rad: number): number {
  const t = Math.PI * 2
  let d = (rad + Math.PI) % t
  if (d < 0) d += t
  return d - Math.PI
}

function damp(current: number, target: number, dt: number, tc: number): number {
  return current + wrap(target - current) * (1 - Math.exp(-dt / tc))
}

/**
 * Face a hunt ring. Portrait view is narrow, so a ring outside that cone
 * is snapped into frame instead of eased in from behind the camera.
 */
export function aimCamera(body: Body, targetYaw: number, dt: number): void {
  const err = Math.abs(wrap(targetYaw - body.camYaw))
  body.camYaw = err > 0.22 ? targetYaw : damp(body.camYaw, targetYaw, dt, 0.16)
}

/**
 * Stick x is screen-right, y is screen-up, both already 0..1 outside the dead zone.
 * Returns horizontal speed over MOVE_SPEED for the walk clip.
 */
export function steer(
  body: Body,
  stickX: number,
  stickY: number,
  dt: number,
  slide: (x: number, z: number, nx: number, nz: number) => { x: number; z: number },
  followCam = true,
): number {
  const mag = Math.hypot(stickX, stickY)
  let speed01 = 0
  if (mag > 0.001) {
    const fx = Math.sin(body.camYaw)
    const fz = Math.cos(body.camYaw)
    // Screen-right from the chase camera (up × backward), not its opposite.
    const rx = -Math.cos(body.camYaw)
    const rz = Math.sin(body.camYaw)
    let dx = fx * stickY + rx * stickX
    let dz = fz * stickY + rz * stickX
    const len = Math.hypot(dx, dz) || 1
    dx /= len
    dz /= len
    const desired = Math.atan2(dx, dz)
    body.yaw = damp(body.yaw, desired, dt, TURN)
    const err = Math.abs(wrap(desired - body.yaw))
    if (mag >= PIVOT) {
      const pace = mag * MOVE_SPEED * (err > SLOW ? 0.45 : 1)
      const next = slide(
        body.x, body.z,
        body.x + Math.sin(body.yaw) * pace * dt,
        body.z + Math.cos(body.yaw) * pace * dt,
      )
      body.x = next.x
      body.z = next.z
      speed01 = pace / MOVE_SPEED
    }
  }
  if (followCam) {
    const lead = Math.abs(wrap(body.yaw - body.camYaw))
    if (mag < 0.15 || lead < HOLD) body.camYaw = damp(body.camYaw, body.yaw, dt, CAM)
  }
  return speed01
}

/** How far ahead of the player the mascot stands, in metres. */
const LEAD = 1.5
const MASCOT_SPEED = MOVE_SPEED * 0.42
const ARRIVE = 0.22

/**
 * Walk the pineapple to a slot in front of the player, then turn its face toward the camera.
 * Returns speed over MOVE_SPEED so the walk clip can play. The stick does not touch `pine`.
 */
export function mascotFollow(
  pine: Body,
  player: Body,
  dt: number,
  slide: (x: number, z: number, nx: number, nz: number) => { x: number; z: number },
): number {
  const fx = Math.sin(player.yaw)
  const fz = Math.cos(player.yaw)
  const tx = player.x + fx * LEAD
  const tz = player.z + fz * LEAD
  const dx = tx - pine.x
  const dz = tz - pine.z
  const dist = Math.hypot(dx, dz)
  if (dist > ARRIVE) {
    const desired = Math.atan2(dx, dz)
    pine.yaw = damp(pine.yaw, desired, dt, TURN)
    // It often faces the camera, opposite the slot. Turn before stepping, or it walks away.
    if (Math.abs(wrap(desired - pine.yaw)) > 0.5) return 0.2
    const step = Math.min(dist, MASCOT_SPEED * dt)
    const next = slide(
      pine.x, pine.z,
      pine.x + Math.sin(pine.yaw) * step,
      pine.z + Math.cos(pine.yaw) * step,
    )
    pine.x = next.x
    pine.z = next.z
    return (step / Math.max(dt, 1e-4)) / MOVE_SPEED
  }
  const camX = player.x - Math.sin(player.camYaw) * 7
  const camZ = player.z - Math.cos(player.camYaw) * 7
  pine.yaw = damp(pine.yaw, Math.atan2(camX - pine.x, camZ - pine.z), dt, 0.16)
  return 0
}
