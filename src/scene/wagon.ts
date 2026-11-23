/** Exact rpgpp_ag_wagon_01b; UV in oil wood atlas cell. */
import { wagon01bRaw } from './data/wagon01b.gen'
import type { MeshData } from './mesh'

export function wagonMesh(): MeshData {
  const { interleaved, indices } = wagon01bRaw()
  return { interleaved, indices, receiveShadow: true }
}
