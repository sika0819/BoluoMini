/**
 * Walk movement. Collision and island airwalls are off for now.
 * Foot height still follows terrain, or the ocean surface when the ground is under the sea.
 */
import { height, setActivePreset, type SceneKind } from './island'
import { OCEAN_Y } from './data/collision.gen'

export { OCEAN_Y }

export const EYE_HEIGHT = 3
export const MOVE_SPEED = 9
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

/** Foot height: terrain, or the ocean surface when the ground is under the sea. */
export function footY(lx: number, lz: number): number {
  const h = height(lx, lz)
  return h < OCEAN_Y ? OCEAN_Y : h
}

export function buildSolids(scene: SceneKind | string): Solid[] {
  setActivePreset(scene)
  return []
}

export function canOccupy(_lx: number, _lz: number, _fromX: number, _fromZ: number, _solids: Solid[]): boolean {
  return true
}

/** Collision is disabled, so the requested step is always taken. */
export function tryMove(_x: number, _z: number, nx: number, nz: number, _solids: Solid[]): { x: number; z: number } {
  return { x: nx, z: nz }
}
