#!/usr/bin/env python3
"""Convert boluo1.obj (Unity cm, Y-up) into a BoluoMini mesh module with UVs."""
from __future__ import annotations

import math
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OBJ = ROOT / "boluo1.obj"
OUT_TS = Path(__file__).resolve().parents[2] / "src" / "scene" / "data" / "boluo1.gen.ts"
OUT_BIN = Path(__file__).resolve().parents[2] / "public" / "oil" / "boluo1.mesh.bin"

# Unity FBX is authored in centimetres; CustomSRP AABB is metres.
SCALE = 0.01

# Window glass island centre on the oil UV sheet (from house_build UV layout).
GLASS_UV = (0.82, 0.72)
GLASS_R = 0.07


def parse_obj(path: Path):
    positions: list[tuple[float, float, float]] = []
    texcoords: list[tuple[float, float]] = []
    normals: list[tuple[float, float, float]] = []
    # group -> list of (v,vt,vn) triples per face
    groups: dict[str, list[list[tuple[int, int, int]]]] = {}
    group = "default"
    for line in path.read_text().splitlines():
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        tag = parts[0]
        if tag == "v":
            positions.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif tag == "vt":
            texcoords.append((float(parts[1]), float(parts[2])))
        elif tag == "vn":
            normals.append((float(parts[1]), float(parts[2]), float(parts[3])))
        elif tag == "g":
            group = parts[1] if len(parts) > 1 else "default"
            groups.setdefault(group, [])
        elif tag == "f":
            face = []
            for tok in parts[1:]:
                bits = tok.split("/")
                vi = int(bits[0]) - 1
                ti = int(bits[1]) - 1 if len(bits) > 1 and bits[1] else -1
                ni = int(bits[2]) - 1 if len(bits) > 2 and bits[2] else -1
                face.append((vi, ti, ni))
            groups.setdefault(group, []).append(face)
    return positions, texcoords, normals, groups


def is_glass_uv(u: float, v: float) -> bool:
    return (u - GLASS_UV[0]) ** 2 + (v - GLASS_UV[1]) ** 2 < GLASS_R ** 2


def face_normal(pts: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    ax, ay, az = pts[0]
    bx, by, bz = pts[1]
    cx, cy, cz = pts[2]
    ux, uy, uz = bx - ax, by - ay, bz - az
    vx, vy, vz = cx - ax, cy - ay, cz - az
    nx = uy * vz - uz * vy
    ny = uz * vx - ux * vz
    nz = ux * vy - uy * vx
    ln = math.hypot(nx, ny, nz) or 1.0
    return nx / ln, ny / ln, nz / ln


def main() -> None:
    positions, texcoords, normals, groups = parse_obj(OBJ)
    # interleaved floats + indices
    verts: list[float] = []
    indices: list[int] = []
    # dedupe key -> index
    cache: dict[tuple[int, int, int, int], int] = {}

    KIND_BOLUO = 11
    KIND_WINDOW = 7

    stats = {name: 0 for name in groups}

    for name, faces in groups.items():
        for face in faces:
            # triangulate fan
            for i in range(1, len(face) - 1):
                tri = [face[0], face[i], face[i + 1]]
                tri_idx: list[int] = []
                pts = []
                uvs = []
                for vi, ti, ni in tri:
                    px, py, pz = positions[vi]
                    # Assimp OBJ is mirrored vs Unity AABB (cx sign flips); undo with -X.
                    px, py, pz = -px * SCALE, py * SCALE, pz * SCALE
                    pts.append((px, py, pz))
                    u, v = texcoords[ti] if ti >= 0 else (0.0, 0.0)
                    uvs.append((u, v))
                # Mirrored X reverses winding — swap last two verts for CCW.
                pts[1], pts[2] = pts[2], pts[1]
                tri[1], tri[2] = tri[2], tri[1]
                uvs[1], uvs[2] = uvs[2], uvs[1]
                fn = face_normal(pts)
                for k, (vi, ti, ni) in enumerate(tri):
                    px, py, pz = pts[k]
                    u, v = uvs[k]
                    if ni >= 0:
                        nx, ny, nz = normals[ni]
                        nx = -nx
                    else:
                        nx, ny, nz = fn
                    # glass faces in the window UV island
                    kind = KIND_WINDOW if (name.startswith("Window") and is_glass_uv(u, v)) else KIND_BOLUO
                    if name.startswith("Window") and not is_glass_uv(u, v):
                        kind = KIND_BOLUO
                    key = (vi, ti, ni, kind)
                    if key in cache:
                        tri_idx.append(cache[key])
                        continue
                    idx = len(verts) // 12
                    # color unused for boluo (texture drives albedo); keep warm fallback
                    cr, cg, cb = (1.0, 0.78, 0.42) if kind == KIND_WINDOW else (0.86, 0.62, 0.22)
                    verts.extend([px, py, pz, nx, ny, nz, cr, cg, cb, float(kind), u, v])
                    cache[key] = idx
                    tri_idx.append(idx)
                    stats[name] = stats.get(name, 0) + 1
                indices.extend(tri_idx)

    if max(indices) > 65535:
        raise SystemExit(f"index overflow: {max(indices)}")

    interleaved = struct.pack(f"<{len(verts)}f", *verts)
    index_bytes = struct.pack(f"<{len(indices)}H", *indices)

    # Binary: uint32 vertFloatCount, uint32 indexCount, floats..., uint16...
    header = struct.pack("<II", len(verts), len(indices))
    OUT_BIN.parent.mkdir(parents=True, exist_ok=True)
    OUT_BIN.write_bytes(header + interleaved + index_bytes)

    # Also emit a compact TS that embeds base64 for sync load (mini-game friendly).
    import base64

    b64 = base64.b64encode(header + interleaved + index_bytes).decode("ascii")
    # chunk for readability
    chunks = [b64[i : i + 120] for i in range(0, len(b64), 120)]
    lit = "\n".join(f'  "{c}" +' for c in chunks)
    lit = lit.rstrip(" +") + "\n"

    xs = [verts[i] for i in range(0, len(verts), 12)]
    ys = [verts[i + 1] for i in range(0, len(verts), 12)]
    zs = [verts[i + 2] for i in range(0, len(verts), 12)]
    OUT_TS.write_text(
        f"""/* Generated by tools/boluo1_extract/obj_to_mesh.py — do not edit. */
/* Exact boluo1 mesh from CustomSRP FBX, metres, Y-up, authored UVs. */
export const BOLUO1_VERT_FLOATS = {len(verts)}
export const BOLUO1_INDEX_COUNT = {len(indices)}
export const BOLUO1_BOUNDS = {{
  min: [{min(xs):.5f}, {min(ys):.5f}, {min(zs):.5f}] as const,
  max: [{max(xs):.5f}, {max(ys):.5f}, {max(zs):.5f}] as const,
}}
const B64 =
{lit}
export function boluo1Raw(): {{ interleaved: Float32Array; indices: Uint16Array }} {{
  const bin = typeof atob === 'function'
    ? Uint8Array.from(atob(B64), (c) => c.charCodeAt(0))
    : (() => {{ throw new Error('atob') }})()
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const vf = view.getUint32(0, true)
  const ic = view.getUint32(4, true)
  const interleaved = new Float32Array(bin.buffer, bin.byteOffset + 8, vf)
  const indices = new Uint16Array(bin.buffer, bin.byteOffset + 8 + vf * 4, ic)
  return {{ interleaved: new Float32Array(interleaved), indices: new Uint16Array(indices) }}
}}
"""
    )
    print("groups", {k: len(v) for k, v in groups.items()})
    print("verts", len(verts) // 12, "tris", len(indices) // 3)
    print("bounds m", min(xs), min(ys), min(zs), "→", max(xs), max(ys), max(zs))
    print("wrote", OUT_TS)
    print("wrote", OUT_BIN, OUT_BIN.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
