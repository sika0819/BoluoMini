/** Exact rpgpp_ag_barrel_01d mesh; UVs remapped into oil wood atlas cell. */
import { barrel01dRaw } from './data/barrel01d.gen'
import type { MeshData } from './mesh'

export function barrelMesh(): MeshData {
  const { interleaved, indices } = barrel01dRaw()
  return { interleaved, indices, receiveShadow: true }
}
