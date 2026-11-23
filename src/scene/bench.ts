/** Exact rpgpp_ag_bench_wood_01a; UV in oil wood atlas cell. */
import { bench01aRaw } from './data/bench01a.gen'
import type { MeshData } from './mesh'

export function benchMesh(): MeshData {
  const { interleaved, indices } = bench01aRaw()
  return { interleaved, indices, receiveShadow: true }
}
