import { MOVE_SPEED, STICK_YAW_SPEED } from '../scene/collide'

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
 * A half-turn is the same length either way. `wrap` always takes the negative
 * side, and while the body faces the lens that side swings the nose screen-left.
 * Follow the stick instead: right turns through screen-right.
 */
function turnDelta(yaw: number, camYaw: number, target: number, dyaw: number): number {
  const delta = wrap(target - yaw)
  if (Math.abs(dyaw) <= 1e-5 || Math.PI - Math.abs(delta) > 0.45) return delta
  const facingLens = Math.cos(wrap(yaw - camYaw)) <= 0
  const screenRight = facingLens ? 1 : -1
  const prefer = dyaw < 0 ? screenRight : -screenRight
  return prefer * Math.abs(delta)
}

/**
 * Face a hunt ring. Portrait view is narrow, so a ring outside that cone
 * is snapped into frame instead of eased in from behind the camera.
 */
export function aimCamera(body: Body, targetYaw: number, dt: number): void {
  const err = Math.abs(wrap(targetYaw - body.camYaw))
  body.camYaw = err > 0.22 ? targetYaw : damp(body.camYaw, targetYaw, dt, 0.16)
}

const YAW_RATE = STICK_YAW_SPEED * Math.PI / 180

/**
 * Free-roam stick, matching CustomSRP `IslandJoystickCamera`.
 * Stick x yaws the lens (45°/s at full deflection). Stick y walks along the look,
 * forward or back. The pineapple does not write this body.
 * Returns horizontal speed over MOVE_SPEED.
 */
export function driveCamera(
  body: Body,
  stickX: number,
  stickY: number,
  dt: number,
  slide: (x: number, z: number, nx: number, nz: number) => { x: number; z: number },
): number {
  if (stickX * stickX + stickY * stickY > 1e-8) {
    // Positive camYaw turns toward screen-left, so stick-right decreases it.
    body.camYaw -= stickX * YAW_RATE * dt
  }
  body.yaw = body.camYaw
  if (Math.abs(stickY) <= 0.001) return 0
  const x0 = body.x
  const z0 = body.z
  const pace = stickY * MOVE_SPEED
  const next = slide(
    body.x, body.z,
    body.x + Math.sin(body.camYaw) * pace * dt,
    body.z + Math.cos(body.camYaw) * pace * dt,
  )
  body.x = next.x
  body.z = next.z
  return Math.hypot(body.x - x0, body.z - z0) / Math.max(dt, 1e-4) / MOVE_SPEED
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

/** Chase lens sits this far behind the look point. Matches the eye in app.ts. */
export const LENS_BACK = 7
/**
 * Idle distance from the free-roam lens to the pineapple, in metres.
 * The lens looks 7 m ahead and downward. This slot sits on that view,
 * so the body is centered and a little farther from the camera.
 */
const STAND_IN_FRONT = 5.2
/** Signed offset from the look point. Negative stands between the lens and the look point. */
const LEAD = STAND_IN_FRONT - LENS_BACK

/** Where the pineapple stands once the lens is the player. */
export function lensSlot(player: Body): { x: number; z: number } {
  return {
    x: player.x + Math.sin(player.camYaw) * LEAD,
    z: player.z + Math.cos(player.camYaw) * LEAD,
  }
}
/** Walk back to the slot when the stick is up and the gap is small. */
const WALK_SPEED = MOVE_SPEED * 0.42
/** Run back when the stick is up and the pineapple was left far behind. */
const RUN_SPEED = MOVE_SPEED * 1.35
const RUN_BACK = 2.2
const ARRIVE = 0.22
/** Ease a leftover gap after the body has been carried with the lens. */
const CARRY_TC = 0.12
/**
 * Last lens pose. While the stick is held the pineapple is carried with this
 * pose, instead of chasing a slot that orbits out from under it.
 */
let carriedFrom: { x: number; z: number; camYaw: number } | null = null

/**
 * Stay in front of the lens. While the camera walks or turns, the body is
 * carried with that motion and its face follows the way it is stepping, so a
 * stick held in a turn does not flip it between the slot and the lens.
 * Once the lens is still and the body has arrived, it turns toward the camera.
 * The stick does not touch `pine`, and `pine` does not move the camera.
 */
export function mascotFollow(
  pine: Body,
  player: Body,
  dt: number,
  slide: (x: number, z: number, nx: number, nz: number) => { x: number; z: number },
  pace01 = 0,
): number {
  const fx = Math.sin(player.camYaw)
  const fz = Math.cos(player.camYaw)
  const tx = player.x + fx * LEAD
  const tz = player.z + fz * LEAD
  const dx = tx - pine.x
  const dz = tz - pine.z
  const dist = Math.hypot(dx, dz)
  const prev = carriedFrom
  const anchorStep = prev ? Math.hypot(player.x - prev.x, player.z - prev.z) : Infinity
  const dyaw = prev ? wrap(player.camYaw - prev.camYaw) : 0
  const linked = prev != null && anchorStep < 1 && Math.abs(dyaw) < 1.2
  carriedFrom = { x: player.x, z: player.z, camYaw: player.camYaw }
  const driving = pace01 > 0.12
  // Any lens motion, including a slow shallow drag. A speed gate treated that
  // drag as "stopped" and the body flipped between the slot and the lens.
  const lensMoved = linked && (anchorStep > 1e-5 || Math.abs(dyaw) > 1e-5)
  if (prev && lensMoved) {
    const ox = pine.x - prev.x
    const oz = pine.z - prev.z
    const c = Math.cos(dyaw)
    const s = Math.sin(dyaw)
    let nx = player.x + ox * c + oz * s
    let nz = player.z - ox * s + oz * c
    const k = 1 - Math.exp(-dt / CARRY_TC)
    nx += (tx - nx) * k
    nz += (tz - nz) * k
    const next = slide(pine.x, pine.z, nx, nz)
    // Match the lens first. A half-turn then leaves on the stick's side,
    // not the side `wrap` always picks.
    pine.yaw += dyaw
    if (anchorStep > 1e-4) {
      const heading = Math.atan2(player.x - prev.x, player.z - prev.z)
      const delta = turnDelta(pine.yaw, player.camYaw, heading, dyaw)
      pine.yaw += delta * (1 - Math.exp(-dt / 0.1))
    }
    const mx = next.x - pine.x
    const mz = next.z - pine.z
    pine.x = next.x
    pine.z = next.z
    const travelled = Math.hypot(mx, mz) / Math.max(dt, 1e-4) / MOVE_SPEED
    return driving ? Math.max(travelled, pace01) : travelled
  }
  if (dist > ARRIVE) {
    const desired = Math.atan2(dx, dz)
    pine.yaw += dyaw
    pine.yaw += turnDelta(pine.yaw, player.camYaw, desired, dyaw) * (1 - Math.exp(-dt / TURN))
    let pace: number
    if (driving) {
      const cruise = pace01 * MOVE_SPEED
      const extra = Math.min(Math.max(0, dist - 0.45) * 1.6, cruise * 0.35)
      pace = cruise + extra
    } else {
      pace = dist > RUN_BACK ? RUN_SPEED : WALK_SPEED
    }
    const step = Math.min(dist, pace * dt)
    const next = slide(
      pine.x, pine.z,
      pine.x + (dx / dist) * step,
      pine.z + (dz / dist) * step,
    )
    const travelled = Math.hypot(next.x - pine.x, next.z - pine.z) / Math.max(dt, 1e-4) / MOVE_SPEED
    pine.x = next.x
    pine.z = next.z
    return driving ? Math.max(travelled, pace01) : travelled
  }
  const camX = player.x - fx * LENS_BACK
  const camZ = player.z - fz * LENS_BACK
  pine.yaw += dyaw
  const face = Math.atan2(camX - pine.x, camZ - pine.z)
  pine.yaw += turnDelta(pine.yaw, player.camYaw, face, dyaw) * (1 - Math.exp(-dt / 0.16))
  return 0
}
