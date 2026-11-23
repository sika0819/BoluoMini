#!/usr/bin/env python3
"""OBJ (cm, Y-up) → BoluoMini generated mesh TS module."""
from __future__ import annotations

import argparse
import base64
import math
import struct
from pathlib import Path


def parse_obj(path: Path):
    positions, texcoords, normals = [], [], []
    groups: dict[str, list] = {}
    group = "default"
    for line in path.read_text(errors="ignore").splitlines():
        if not line or line[0] == "#":
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


def face_normal(pts):
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
    ap = argparse.ArgumentParser()
    ap.add_argument("obj")
    ap.add_argument("--out", required=True, help="path to .gen.ts")
    ap.add_argument("--kind", type=float, default=6.0)
    ap.add_argument("--scale", type=float, default=0.01)
    ap.add_argument("--flip-x", action="store_true", default=True)
    ap.add_argument("--no-flip-x", action="store_true")
    ap.add_argument("--color", default="0.52,0.36,0.22")
    ap.add_argument("--atlas-uv", default="", help="col,row — remap mesh UV into 4x4 oil atlas cell")
    args = ap.parse_args()
    flip = not args.no_flip_x
    cr, cg, cb = (float(x) for x in args.color.split(","))
    atlas = None
    if args.atlas_uv:
        col, row = (int(x) for x in args.atlas_uv.split(","))
        atlas = (col, row)

    positions, texcoords, normals, groups = parse_obj(Path(args.obj))
    verts: list[float] = []
    indices: list[int] = []
    cache: dict = {}

    for _name, faces in groups.items():
        for face in faces:
            for i in range(1, len(face) - 1):
                tri = [face[0], face[i], face[i + 1]]
                pts, uvs, metas = [], [], []
                for vi, ti, ni in tri:
                    px, py, pz = positions[vi]
                    sx = -args.scale if flip else args.scale
                    pts.append((px * sx, py * args.scale, pz * args.scale))
                    u, v = texcoords[ti] if ti >= 0 else (0.0, 0.0)
                    uvs.append((u, v))
                    metas.append((vi, ti, ni))
                if flip:
                    pts[1], pts[2] = pts[2], pts[1]
                    uvs[1], uvs[2] = uvs[2], uvs[1]
                    metas[1], metas[2] = metas[2], metas[1]
                fn = face_normal(pts)
                tri_idx = []
                for k, (vi, ti, ni) in enumerate(metas):
                    px, py, pz = pts[k]
                    u, v = uvs[k]
                    if atlas is not None:
                        col, row = atlas
                        u = (col + min(1.0, max(0.0, u))) / 4.0
                        v = (3 - row + min(1.0, max(0.0, v))) / 4.0
                    if ni >= 0:
                        nx, ny, nz = normals[ni]
                        if flip:
                            nx = -nx
                    else:
                        nx, ny, nz = fn
                    key = (vi, ti, ni)
                    if key in cache:
                        tri_idx.append(cache[key])
                        continue
                    idx = len(verts) // 12
                    verts.extend([px, py, pz, nx, ny, nz, cr, cg, cb, args.kind, u, v])
                    cache[key] = idx
                    tri_idx.append(idx)
                indices.extend(tri_idx)

    if max(indices, default=0) > 65535:
        raise SystemExit("index overflow")

    header = struct.pack("<II", len(verts), len(indices))
    blob = header + struct.pack(f"<{len(verts)}f", *verts) + struct.pack(f"<{len(indices)}H", *indices)
    b64 = base64.b64encode(blob).decode("ascii")
    chunks = [b64[i : i + 120] for i in range(0, len(b64), 120)]
    lit = "\n".join(f'  "{c}" +' for c in chunks).rstrip(" +") + "\n"

    xs = [verts[i] for i in range(0, len(verts), 12)]
    ys = [verts[i + 1] for i in range(0, len(verts), 12)]
    zs = [verts[i + 2] for i in range(0, len(verts), 12)]
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    name = out.stem.replace(".gen", "").replace(".", "_").upper()
    out.write_text(
        f"""/* Generated by tools/mesh_extract/obj_to_gen.py — do not edit. */
export const {name}_VERT_FLOATS = {len(verts)}
export const {name}_INDEX_COUNT = {len(indices)}
export const {name}_BOUNDS = {{
  min: [{min(xs):.5f}, {min(ys):.5f}, {min(zs):.5f}] as const,
  max: [{max(xs):.5f}, {max(ys):.5f}, {max(zs):.5f}] as const,
}}
const B64 =
{lit}
export function {name.lower()}Raw(): {{ interleaved: Float32Array; indices: Uint16Array }} {{
  const bin = Uint8Array.from(atob(B64), (c) => c.charCodeAt(0))
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength)
  const vf = view.getUint32(0, true)
  const ic = view.getUint32(4, true)
  const interleaved = new Float32Array(bin.buffer, bin.byteOffset + 8, vf)
  const indices = new Uint16Array(bin.buffer, bin.byteOffset + 8 + vf * 4, ic)
  return {{ interleaved: new Float32Array(interleaved), indices: new Uint16Array(indices) }}
}}
"""
    )
    print(out, "verts", len(verts) // 12, "tris", len(indices) // 3)
    print("bounds", min(xs), min(ys), min(zs), "→", max(xs), max(ys), max(zs))


if __name__ == "__main__":
    main()
