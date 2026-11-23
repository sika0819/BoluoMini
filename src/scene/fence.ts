/** Exact rpgpp_ag_fence_01a_2m; UV in oil wood atlas cell. */
import { fence01aRaw } from './data/fence01a.gen'
import type { MeshData } from './mesh'

export function fenceMesh(): MeshData {
  const { interleaved, indices } = fence01aRaw()
  return { interleaved, indices, receiveShadow: true }
}
