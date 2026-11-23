/** Wood crate mesh (TAI stand-in for rpgpp crates); UV in oil wood atlas cell. */
import { crateRaw } from './data/crate.gen'
import type { MeshData } from './mesh'

export function crateMesh(): MeshData {
  const { interleaved, indices } = crateRaw()
  return { interleaved, indices, receiveShadow: true }
}
