/**
 * Walk the meadow. Feet follow the ground. The pond and the outer rim stop the step.
 */
import { height, shoreDist, WALK_R, type SceneKind } from './island'

export const EYE_HEIGHT = 1.7
export const MOVE_SPEED = 6
export const STICK_YAW_SPEED = 45

export interface Solid {
  x: number
  z: number
  hx: number
  hz: number
  ax: number
  az: number
  bx: number
  bz: number
  round: boolean
}

export function footY(lx: number, lz: number): number {
  return height(lx, lz)
}

export function canOccupy(lx: number, lz: number, _fromX = lx, _fromZ = lz, _solids: Solid[] = []): boolean {
  if (lx * lx + lz * lz > WALK_R * WALK_R) return false
  if (shoreDist(lx, lz) < 0.85) return false
  return true
}

export function buildSolids(_scene: SceneKind | string): Solid[] {
  return []
}

export function tryMove(x: number, z: number, nx: number, nz: number, solids: Solid[]): { x: number; z: number } {
  if (!canOccupy(nx, nz, x, z, solids)) return { x, z }
  return { x: nx, z: nz }
}
