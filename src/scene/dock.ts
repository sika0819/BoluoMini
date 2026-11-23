/**
 * Exact SM_Env_Dock_02 from CustomSRP FBX + oil albedo.
 */
import { dock02Raw } from './data/dock02.gen'
import type { MeshData } from './mesh'

export function dockMesh(): MeshData {
  const { interleaved, indices } = dock02Raw()
  return {
    interleaved,
    indices,
    receiveShadow: true,
    doubleSided: false,
  }
}
