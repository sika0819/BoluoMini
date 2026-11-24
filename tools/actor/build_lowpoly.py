"""Rebuild the pineapple actor as a low-poly cartoon mesh on the existing rig.

Shape follows boluo2_rig.fbx. Vertex colors replace the oil albedo. UVs are one
paintable island per part (body cylinder, caps, each limb, each leaf, face).
Bone weights are copied from the nearest point on the original skin, so BoluoIdle
and BoluoWalk keep driving the same joints. Output replaces the mesh block in
public/actor/boluo.json and leaves the clips, rest pose and inverse binds alone.
"""
import base64
import json
import math
import os
from array import array
from collections import defaultdict

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

FBX = "/Users/sika/Desktop/code/BoluoUnity/UnityProject/Assets/AssetRaw/Actor/Boluo/boluo2_rig.fbx"
JSON_PATH = "/Users/sika/Desktop/code/BoluoMini/public/actor/boluo.json"
BLEND_PATH = "/Users/sika/Desktop/code/BoluoMini/tools/actor/boluo_low.blend"
SHOTS = "/tmp/boluo_low"

BODY = (0.98, 0.78, 0.20)
BODY_DEEP = (0.93, 0.58, 0.14)
BLUSH = (0.98, 0.50, 0.45)
LEAF_A = (0.36, 0.70, 0.26)
LEAF_B = (0.20, 0.50, 0.22)
EYE = (0.08, 0.07, 0.08)
WHITE = (0.98, 0.98, 0.96)
MOUTH = (0.78, 0.24, 0.32)
FOOT = (0.95, 0.62, 0.14)

BONE_INDEX = {
    "Hips": 1,
    "Chest": 2,
    "LeftArm": 3,
    "RightArm": 4,
    "LeftFoot": 5,
    "RightFoot": 6,
}


def islands_of(me):
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    seen = set()
    groups = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack = [v]
        seen.add(v.index)
        group = []
        while stack:
            cur = stack.pop()
            group.append(cur.index)
            for e in cur.link_edges:
                other = e.other_vert(cur)
                if other.index not in seen:
                    seen.add(other.index)
                    stack.append(other)
        groups.append(group)
    bm.free()
    return groups


def bounds(pts):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for p in pts:
        for i in range(3):
            mn[i] = min(mn[i], p[i])
            mx[i] = max(mx[i], p[i])
    return mn, mx


def weight_map(ob):
    names = [g.name for g in ob.vertex_groups]
    out = []
    for v in ob.data.vertices:
        w = {}
        for g in v.groups:
            if g.weight > 0.001:
                w[names[g.group]] = g.weight
        out.append(w)
    return out


def smooth_circular(values, k):
    n = len(values)
    out = [0.0] * n
    for i in range(n):
        out[i] = values[i] * (1 - k) + (values[(i - 1) % n] + values[(i + 1) % n]) * 0.5 * k
    return out


def fill_zeros(values):
    n = len(values)
    out = values[:]
    for _ in range(n):
        for i in range(n):
            if out[i] > 1e-6:
                continue
            a = b = None
            for d in range(1, n):
                if out[(i - d) % n] > 1e-6:
                    a = out[(i - d) % n]
                    break
            for d in range(1, n):
                if out[(i + d) % n] > 1e-6:
                    b = out[(i + d) % n]
                    break
            if a is not None and b is not None:
                out[i] = (a + b) * 0.5
            elif a is not None:
                out[i] = a
            elif b is not None:
                out[i] = b
    return out


class Builder:
    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.island = self.bm.faces.layers.int.new("island")
        self.color_of = {}
        self.next_island = 1

    def vert(self, co, color):
        v = self.bm.verts.new(co)
        self.color_of[v] = color
        return v

    def face(self, verts, uvs, island):
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        f[self.island] = island
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
        return f

    def alloc_island(self):
        i = self.next_island
        self.next_island += 1
        return i


def add_ellipsoid(build, center, radii, segs, rings, color):
    island = build.alloc_island()
    rx, ry, rz = radii
    top = build.vert(center + Vector((0, 0, rz)), color)
    bot = build.vert(center + Vector((0, 0, -rz)), color)
    rows = []
    for i in range(1, rings):
        theta = math.pi * i / rings
        st, ct = math.sin(theta), math.cos(theta)
        row = []
        for j in range(segs):
            phi = math.tau * j / segs
            co = center + Vector((rx * st * math.cos(phi), ry * st * math.sin(phi), rz * ct))
            row.append(build.vert(co, color))
        rows.append(row)
    v1 = 1 / rings
    for j in range(segs):
        j2 = (j + 1) % segs
        u0, u1 = j / segs, (j + 1) / segs
        build.face((top, rows[0][j], rows[0][j2]), (((u0 + u1) * 0.5, 1.0), (u0, 1 - v1), (u1, 1 - v1)), island)
        build.face(
            (bot, rows[-1][j2], rows[-1][j]),
            (((u0 + u1) * 0.5, 0.0), (u1, v1), (u0, v1)),
            island,
        )
    for i in range(len(rows) - 1):
        v0 = 1 - (i + 1) / rings
        v1 = 1 - (i + 2) / rings
        for j in range(segs):
            j2 = (j + 1) % segs
            u0, u1 = j / segs, (j + 1) / segs
            build.face(
                (rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]),
                ((u0, v0), (u1, v0), (u1, v1), (u0, v1)),
                island,
            )
    return island


def add_mouth_oval(build, center, rx, rz, segs, color):
    """A flat vertical oval on the face. Normal points toward -Y, so it does not bulge out."""
    island = build.alloc_island()
    dark = tuple(c * 0.55 for c in color)
    hub = build.vert(center, dark)
    ring = []
    for j in range(segs):
        ang = math.tau * j / segs
        co = center + Vector((math.cos(ang) * rx, 0.0, math.sin(ang) * rz))
        ring.append(build.vert(co, color))
    for j in range(segs):
        j2 = (j + 1) % segs
        u0, u1 = j / segs, (j + 1) / segs
        # (hub, p, next) with angle increasing gives a -Y normal, toward the camera.
        build.face(
            (hub, ring[j], ring[j2]),
            ((0.5, 0.5), (0.5 + 0.5 * math.cos(math.tau * j / segs), 0.5 + 0.5 * math.sin(math.tau * j / segs)),
             (0.5 + 0.5 * math.cos(math.tau * j2 / segs), 0.5 + 0.5 * math.sin(math.tau * j2 / segs))),
            island,
        )
    return island


def tube(build, stations, radii, sides, color, island, embed=None):
    """stations: centerline. radii: one per station. Optional embed is an extra first ring."""
    if embed is not None:
        stations = [embed] + list(stations)
        radii = [radii[0]] + list(radii)
    if len(stations) < 2:
        return
    tangents = []
    for i in range(len(stations)):
        if i == 0:
            t = stations[1] - stations[0]
        elif i == len(stations) - 1:
            t = stations[-1] - stations[-2]
        else:
            t = stations[i + 1] - stations[i - 1]
        tangents.append(t.normalized() if t.length > 1e-8 else Vector((0, 0, 1)))
    side = tangents[0].cross(Vector((0, 0, 1)))
    if side.length < 1e-4:
        side = tangents[0].cross(Vector((0, 1, 0)))
    side.normalize()
    rings = []
    length = 0.0
    lengths = [0.0]
    for i in range(1, len(stations)):
        length += (stations[i] - stations[i - 1]).length
        lengths.append(length)
    total = max(length, 1e-6)
    for i, (center, radius, tangent) in enumerate(zip(stations, radii, tangents)):
        side = side - tangent * side.dot(tangent)
        if side.length < 1e-6:
            side = tangent.cross(Vector((0, 0, 1)))
        side.normalize()
        up = side.cross(tangent).normalized()
        ring = []
        for s in range(sides):
            a = math.tau * s / sides
            co = center + (side * math.cos(a) + up * math.sin(a)) * radius
            ring.append(build.vert(co, color))
        rings.append(ring)
    for i in range(len(rings) - 1):
        v0 = lengths[i] / total
        v1 = lengths[i + 1] / total
        for s in range(sides):
            s2 = (s + 1) % sides
            u0, u1 = s / sides, (s + 1) / sides
            build.face(
                (rings[i][s], rings[i][s2], rings[i + 1][s2], rings[i + 1][s]),
                ((u0, v0), (u1, v0), (u1, v1), (u0, v1)),
                island,
            )
    for end, sign in ((0, -1), (len(rings) - 1, 1)):
        tangent = tangents[end]
        center = stations[end] + tangent * (radii[end] * 0.85) * sign
        tip = build.vert(center, color)
        v_tip = 0.0 if end == 0 else 1.0
        v_ring = lengths[end] / total
        for s in range(sides):
            s2 = (s + 1) % sides
            u0, u1 = s / sides, (s + 1) / sides
            if end == 0:
                build.face((tip, rings[end][s2], rings[end][s]), (((u0 + u1) * 0.5, v_tip), (u1, v_ring), (u0, v_ring)), island)
            else:
                build.face((tip, rings[end][s], rings[end][s2]), (((u0 + u1) * 0.5, v_tip), (u0, v_ring), (u1, v_ring)), island)


def centerline(points, stations, shoulder):
    if len(points) < 8:
        return None
    origin = sum(points, Vector()) / len(points)
    cov = [[0.0] * 3 for _ in range(3)]
    for p in points:
        d = p - origin
        for i in range(3):
            for j in range(3):
                cov[i][j] += d[i] * d[j]
    axis = Vector((1, 0.2, 0.1)).normalized()
    for _ in range(32):
        axis = Vector((
            cov[0][0] * axis.x + cov[0][1] * axis.y + cov[0][2] * axis.z,
            cov[1][0] * axis.x + cov[1][1] * axis.y + cov[1][2] * axis.z,
            cov[2][0] * axis.x + cov[2][1] * axis.y + cov[2][2] * axis.z,
        ))
        if axis.length < 1e-8:
            return None
        axis.normalize()
    proj = [(p - origin).dot(axis) for p in points]
    lo, hi = min(proj), max(proj)
    span = max(hi - lo, 1e-4)
    centers = []
    radii = []
    for s in range(stations):
        t = lo + span * s / (stations - 1)
        band = [p for p, q in zip(points, proj) if abs(q - t) <= span / stations * 0.85]
        if len(band) < 3:
            continue
        c = sum(band, Vector()) / len(band)
        rs = []
        for p in band:
            d = p - c
            d = d - axis * d.dot(axis)
            rs.append(d.length)
        rs.sort()
        centers.append(c)
        radii.append(max(0.02, min(0.09, rs[int(len(rs) * 0.55)])))
    if len(centers) < 2:
        return None
    # Shoulder end is the center closest to the joint. Push a copy into the body.
    near = min(range(len(centers)), key=lambda i: (centers[i] - shoulder).length)
    if near != 0:
        centers.reverse()
        radii.reverse()
    inward = Vector((-math.copysign(1, centers[0].x), 0, 0))
    embed = centers[0] + inward * 0.055 + Vector((0, 0, 0.01))
    return centers, radii, embed


def leaf_blades(build, crown_pts, crown_bm_faces_unused=None):
    """One low-poly blade per leaf tip on the crown."""
    if len(crown_pts) < 30:
        return 0
    base = Vector((0, 0.04, 0.74))
    # Local maxima of distance from the crown base. Neighbors come from a grid hash.
    cell = 0.02
    buckets = defaultdict(list)
    for i, p in enumerate(crown_pts):
        key = (int(p.x / cell), int(p.y / cell), int(p.z / cell))
        buckets[key].append(i)
    dist = [(p - base).length for p in crown_pts]
    tips = []
    for i, p in enumerate(crown_pts):
        if dist[i] < 0.07:
            continue
        key = (int(p.x / cell), int(p.y / cell), int(p.z / cell))
        peak = True
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    for j in buckets[(key[0] + dx, key[1] + dy, key[2] + dz)]:
                        if j != i and dist[j] > dist[i] + 1e-4 and (crown_pts[j] - p).length < 0.035:
                            peak = False
                            break
                    if not peak:
                        break
                if not peak:
                    break
            if not peak:
                break
        if peak:
            tips.append(i)
    clusters = []
    used = set()
    for i in sorted(tips, key=lambda k: -dist[k]):
        if i in used:
            continue
        group = [i]
        used.add(i)
        for j in tips:
            if j in used:
                continue
            if (crown_pts[j] - crown_pts[i]).length < 0.055:
                group.append(j)
                used.add(j)
        clusters.append(group)
    made = 0
    for group in clusters:
        tip_i = max(group, key=lambda k: dist[k])
        tip = crown_pts[tip_i]
        direction = tip - base
        if direction.length < 0.06:
            continue
        direction.normalize()
        owned = []
        for p in crown_pts:
            along = (p - base).dot(direction)
            if along < 0.02:
                continue
            perp = (p - base - direction * along).length
            if perp < 0.055 and along < direction.dot(tip - base) + 0.02:
                # Keep the vert only if this tip is its nearest.
                nearest = min(clusters, key=lambda g: (crown_pts[max(g, key=lambda k: dist[k])] - p).length)
                if nearest is group:
                    owned.append(p)
        if len(owned) < 8:
            continue
        stations = []
        widths = []
        for t in (0.18, 0.48, 0.78):
            target = base + direction * (tip - base).length * t
            band = [p for p in owned if abs((p - base).dot(direction) - (tip - base).length * t) < 0.035]
            if len(band) < 2:
                band = owned
            c = sum(band, Vector()) / len(band)
            side = direction.cross(Vector((0, 0, 1)))
            if side.length < 1e-4:
                side = direction.cross(Vector((0, 1, 0)))
            side.normalize()
            width = max(abs((p - c).dot(side)) for p in band)
            stations.append(c)
            widths.append(max(0.012, min(0.07, width)))
        stations.append(tip)
        widths.append(0.004)
        # Sink the root into the head so the blade is attached.
        to_head = Vector((0, 0.02, 0.62)) - stations[0]
        if to_head.length > 1e-6:
            stations[0] = stations[0] + to_head.normalized() * 0.03
        color = LEAF_A if made % 2 == 0 else LEAF_B
        island = build.alloc_island()
        side = direction.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = direction.cross(Vector((0, 1, 0)))
        side.normalize()
        up = side.cross(direction).normalized()
        rings = []
        for c, w, s_i in zip(stations, widths, range(len(stations))):
            thick = max(0.005, w * 0.22)
            if s_i == len(stations) - 1:
                rings.append([build.vert(c, color)])
                continue
            rings.append([
                build.vert(c + side * w, color),
                build.vert(c + up * thick, color),
                build.vert(c - side * w, color),
                build.vert(c - up * thick, color),
            ])
        for i in range(len(rings) - 1):
            a = rings[i]
            b = rings[i + 1]
            v0 = i / (len(rings) - 1)
            v1 = (i + 1) / (len(rings) - 1)
            if len(b) == 1:
                for s in range(4):
                    s2 = (s + 1) % 4
                    build.face((a[s], a[s2], b[0]), ((s / 4, v0), (s2 / 4, v0), (0.5, v1)), island)
            else:
                for s in range(4):
                    s2 = (s + 1) % 4
                    build.face(
                        (a[s], a[s2], b[s2], b[s]),
                        ((s / 4, v0), (s2 / 4, v0), (s2 / 4, v1), (s / 4, v1)),
                        island,
                    )
        root = rings[0]
        cap_island = build.alloc_island()
        build.face(root, ((0.5, 0.12), (0.88, 0.5), (0.5, 0.88), (0.12, 0.5)), cap_island)
        made += 1
    return made


def pack_uvs(build):
    bm = build.bm
    groups = defaultdict(list)
    for f in bm.faces:
        groups[f[build.island]].append(f)
    packed = []
    for island, faces in groups.items():
        area = 0.0
        uv_area = 0.0
        loops = []
        for f in faces:
            area += f.calc_area()
            uvs = [loop[build.uv].uv.copy() for loop in f.loops]
            for i in range(1, len(uvs) - 1):
                a, b, c = uvs[0], uvs[i], uvs[i + 1]
                uv_area += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) * 0.5
            loops.append((f, uvs))
        if area < 1e-8 or uv_area < 1e-10:
            continue
        scale = math.sqrt(area / uv_area)
        pts = []
        for _, uvs in loops:
            for uv in uvs:
                pts.append((uv.x * scale, uv.y * scale))
        minx = min(p[0] for p in pts)
        miny = min(p[1] for p in pts)
        maxx = max(p[0] for p in pts)
        maxy = max(p[1] for p in pts)
        packed.append({
            "faces": loops,
            "scale": scale,
            "min": (minx, miny),
            "w": max(maxx - minx, 1e-4),
            "h": max(maxy - miny, 1e-4),
        })
    packed.sort(key=lambda item: -item["h"])
    gap = 0.012
    target = math.sqrt(sum(item["w"] * item["h"] for item in packed)) * 1.15
    x = y = row_h = 0.0
    max_x = 0.0
    for item in packed:
        if x > 0 and x + item["w"] > target:
            x = 0.0
            y += row_h + gap
            row_h = 0.0
        item["ox"] = x
        item["oy"] = y
        x += item["w"] + gap
        row_h = max(row_h, item["h"])
        max_x = max(max_x, x)
    span = max(max_x, y + row_h, 1e-4)
    fit = 0.96 / span
    ox = 0.02
    oy = 0.02
    for item in packed:
        for f, uvs in item["faces"]:
            for loop, uv in zip(f.loops, uvs):
                u = ox + ((uv.x * item["scale"] - item["min"][0]) + item["ox"]) * fit
                v = oy + ((uv.y * item["scale"] - item["min"][1]) + item["oy"]) * fit
                loop[build.uv].uv = (u, v)


def barycentric(p, a, b, c):
    v0 = b - a
    v1 = c - a
    v2 = p - a
    d00 = v0.dot(v0)
    d01 = v0.dot(v1)
    d11 = v1.dot(v1)
    d20 = v2.dot(v0)
    d21 = v2.dot(v1)
    denom = d00 * d11 - d01 * d01
    if abs(denom) < 1e-12:
        return (1.0, 0.0, 0.0)
    v = (d11 * d20 - d01 * d21) / denom
    w = (d00 * d21 - d01 * d20) / denom
    u = 1.0 - v - w
    return (u, v, w)


def transfer_weights(ob, src, src_weights):
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.faces.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    names = sorted({name for w in src_weights for name in w})
    groups = {name: ob.vertex_groups.new(name=name) for name in names if name in BONE_INDEX}
    for v in ob.data.vertices:
        loc, _normal, face_index, _dist = tree.find_nearest(v.co)
        if loc is None:
            groups["Chest"].add([v.index], 1.0, "REPLACE")
            continue
        face = bm.faces[face_index]
        tri = face.verts
        if len(tri) < 3:
            continue
        # Fan from the first corner. Nearest point is on some triangle of the ngon/quad.
        best = None
        best_d = 1e9
        coords = [tv.co for tv in tri]
        for i in range(1, len(coords) - 1):
            a, b, c = coords[0], coords[i], coords[i + 1]
            u, vv, w = barycentric(loc, a, b, c)
            if u < -0.05 or vv < -0.05 or w < -0.05:
                continue
            recon = a * u + b * vv + c * w
            d = (recon - loc).length
            if d < best_d:
                best_d = d
                best = (u, vv, w, 0, i, i + 1)
        if best is None:
            # Fall back to the nearest corner.
            nearest = min(tri, key=lambda tv: (tv.co - v.co).length)
            wmap = src_weights[nearest.index]
        else:
            u, vv, w, i0, i1, i2 = best
            s = u + vv + w
            if s <= 1e-8:
                s = 1.0
            u, vv, w = u / s, vv / s, w / s
            ids = (tri[i0].index, tri[i1].index, tri[i2].index)
            wmap = defaultdict(float)
            for weight, idx in zip((u, vv, w), ids):
                for name, value in src_weights[idx].items():
                    wmap[name] += value * weight
        ranked = sorted(((n, wt) for n, wt in wmap.items() if n in groups and wt > 0.02), key=lambda kv: -kv[1])[:4]
        total = sum(wt for _, wt in ranked)
        if total <= 1e-6:
            groups["Chest"].add([v.index], 1.0, "REPLACE")
            continue
        for name, wt in ranked:
            groups[name].add([v.index], wt / total, "REPLACE")
    bm.free()


def b64_array(typecode, values):
    buf = array(typecode)
    buf.fromlist(list(values))
    return base64.b64encode(buf.tobytes()).decode("ascii")


def export_json(ob):
    me = ob.data
    me.calc_loop_triangles()
    uv = me.uv_layers.active.data
    colors = me.color_attributes["Col"]
    groups = {g.index: BONE_INDEX[g.name] for g in ob.vertex_groups if g.name in BONE_INDEX}
    split = {}
    pos, nrm, jnt, wgt, rgb, uvs = [], [], [], [], [], []
    indices = []

    def emit(vert, loop_index):
        u, v = uv[loop_index].uv
        key = (vert, round(u, 4), round(v, 4))
        hit = split.get(key)
        if hit is not None:
            return hit
        vi = ob.data.vertices[vert]
        weights = sorted(
            ((groups[g.group], g.weight) for g in vi.groups if g.group in groups and g.weight > 0),
            key=lambda kv: -kv[1],
        )[:4]
        total = sum(w for _, w in weights) or 1.0
        js = [0, 0, 0, 0]
        ws = [0.0, 0.0, 0.0, 0.0]
        for k, (joint, weight) in enumerate(weights):
            js[k] = joint
            ws[k] = weight / total
        if not weights:
            js[0] = BONE_INDEX["Chest"]
            ws[0] = 1.0
        nid = len(split)
        split[key] = nid
        pos.extend((vi.co.x, vi.co.y, vi.co.z))
        n = vi.normal
        nrm.extend((n.x, n.y, n.z))
        jnt.extend(js)
        wgt.extend(ws)
        col = colors.data[vert].color
        rgb.extend(int(round(max(0, min(1, c)) * 255)) for c in col[:3])
        uvs.extend((u, v))
        return nid

    for tri in me.loop_triangles:
        for k in range(3):
            indices.append(emit(tri.vertices[k], tri.loops[k]))
    with open(JSON_PATH) as handle:
        file = json.load(handle)
    file["pos"] = b64_array("f", pos)
    file["nrm"] = b64_array("f", nrm)
    file["jnt"] = b64_array("B", jnt)
    file["wgt"] = b64_array("f", wgt)
    file["idx"] = b64_array("H", indices)
    file["uv"] = b64_array("f", uvs)
    file["rgb"] = b64_array("B", rgb)
    with open(JSON_PATH, "w") as handle:
        json.dump(file, handle, separators=(",", ":"))
    return {
        "verts": len(pos) // 3,
        "tris": len(indices) // 3,
        "islands": len({key[0] for key in []}) if False else None,
    }


def _ctx(ob):
    return bpy.context.temp_override(
        object=ob, active_object=ob, selected_objects=[ob], selected_editable_objects=[ob],
    )


def piece_from_verts(src, indices, ratio, cap_holes=False, tuck=0.0, bury=0.0):
    """Copy one region of the source and decimate it. Cap and tuck happen after, so the cut stays shut."""
    keep = set(indices)
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.verts.ensure_lookup_table()
    dead = [f for f in bm.faces if any(v.index not in keep for v in f.verts)]
    bmesh.ops.delete(bm, geom=dead, context="FACES")
    loose = [v for v in bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    mesh = bpy.data.meshes.new("piece")
    bm.to_mesh(mesh)
    bm.free()
    ob = bpy.data.objects.new("piece", mesh)
    bpy.context.scene.collection.objects.link(ob)
    mod = ob.modifiers.new("Decimate", "DECIMATE")
    mod.ratio = ratio
    with _ctx(ob):
        bpy.ops.object.modifier_apply(modifier=mod.name)
    if cap_holes or tuck:
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        if cap_holes:
            boundary = [e for e in bm.edges if e.is_boundary]
            cut = {v for e in boundary for v in e.verts}
            if boundary:
                # sides=0 fills every open loop. The shoulder cut is wider than 16.
                bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
                filled = [f for f in bm.faces if len(f.verts) > 4]
                if bury > 0:
                    # Slide the cut inside the egg. Keep its height so the rim does not poke out.
                    for v in cut:
                        horiz = Vector((v.co.x, v.co.y, 0.0))
                        if horiz.length > 1e-6:
                            v.co -= horiz.normalized() * bury
                else:
                    if filled:
                        poked = bmesh.ops.poke(bm, faces=filled)
                        for v in poked.get("verts", []):
                            v.co.x *= 0.7
                            v.co.y *= 0.7
                    for v in cut:
                        v.co.x -= math.copysign(0.025, v.co.x)
                bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 3])
                bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        if tuck:
            for v in bm.verts:
                v.co.x -= math.copysign(tuck, v.co.x)
        ob.data.clear_geometry()
        bm.to_mesh(ob.data)
        bm.free()
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    for other in bpy.context.view_layer.objects:
        other.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(
        angle_limit=math.radians(55), island_margin=0.02, area_weight=0.0,
        correct_aspect=True, scale_to_bounds=True,
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    return ob


def absorb(build, ob, color_fn):
    island = build.alloc_island()
    uv_data = ob.data.uv_layers.active.data
    made = {}
    faces = 0
    for poly in ob.data.polygons:
        verts = []
        uvs = []
        for li in poly.loop_indices:
            vi = ob.data.loops[li].vertex_index
            if vi not in made:
                co = ob.data.vertices[vi].co.copy()
                made[vi] = build.vert(co, color_fn(co))
            verts.append(made[vi])
            uvs.append((uv_data[li].uv.x, uv_data[li].uv.y))
        if build.face(tuple(verts), tuple(uvs), island):
            faces += 1
    bpy.data.objects.remove(ob, do_unlink=True)
    return faces


def fuse_body_arms(build, arm_obs):
    """Union the arms into the egg, then voxel-remesh so the shoulder is one surface."""
    mesh = bpy.data.meshes.new("body_fuse")
    build.bm.to_mesh(mesh)
    body = bpy.data.objects.new("body_fuse", mesh)
    bpy.context.scene.collection.objects.link(body)
    for arm in arm_obs:
        mod = body.modifiers.new("Union", "BOOLEAN")
        mod.operation = "UNION"
        mod.object = arm
        mod.solver = "FLOAT"
        with _ctx(body):
            bpy.ops.object.modifier_apply(modifier=mod.name)
        bpy.data.objects.remove(arm, do_unlink=True)
    body.data.remesh_voxel_size = 0.03
    body.data.remesh_voxel_adaptivity = 0.0
    with _ctx(body):
        bpy.ops.object.voxel_remesh()
    # The voxel pass welds the shoulder. Collapse the shell so the facets read as low poly.
    dec = body.modifiers.new("Decimate", "DECIMATE")
    dec.ratio = 0.45
    with _ctx(body):
        bpy.ops.object.modifier_apply(modifier=dec.name)
    build.bm.free()
    build.bm = bmesh.new()
    build.uv = build.bm.loops.layers.uv.new("UVMap")
    build.island = build.bm.faces.layers.int.new("island")
    build.color_of = {}
    side = build.alloc_island()
    top = build.alloc_island()
    bot = build.alloc_island()
    src = bmesh.new()
    src.from_mesh(body.data)
    src.faces.ensure_lookup_table()
    src.normal_update()
    zmin = min(v.co.z for v in src.verts)
    zmax = max(v.co.z for v in src.verts)
    made = {}
    for face in src.faces:
        normal = face.normal
        island = top if normal.z > 0.62 else bot if normal.z < -0.62 else side
        verts = []
        uvs = []
        center = face.calc_center_median()
        fa = math.atan2(center.x, center.y)
        for v in face.verts:
            if v not in made:
                span = max(zmax - zmin, 1e-4)
                deep = 0.14 * (1 - (v.co.z - zmin) / span) + 0.05 * max(0.0, -v.co.y)
                color = tuple(BODY[k] * (1 - deep) + BODY_DEEP[k] * deep for k in range(3))
                made[v] = build.vert(v.co.copy(), color)
            verts.append(made[v])
            if island == side:
                ang = math.atan2(v.co.x, v.co.y)
                da = (ang - fa + math.pi) % math.tau - math.pi
                u = (fa + da + math.pi) / math.tau
                vv = (v.co.z - zmin) / max(zmax - zmin, 1e-4)
            else:
                u = v.co.x * 2.2 + 0.5
                vv = v.co.y * 2.2 + 0.5
            uvs.append((u, vv))
        build.face(tuple(verts), tuple(uvs), island)
    src.free()
    bpy.data.objects.remove(body, do_unlink=True)


def base_color(co):
    """Legs share the body yellow and only darken toward the sole."""
    deep = 0.28 * (1.0 - max(0.0, min(co.z, 0.16)) / 0.16) + 0.05 * max(0.0, -co.y)
    deep = min(0.5, deep)
    return tuple(BODY[k] * (1.0 - deep) + BODY_DEEP[k] * deep for k in range(3))


def leaf_color(co):
    t = max(0.0, min(1.0, (co.z - 0.73) / 0.27))
    wobble = 0.5 + 0.5 * math.sin(co.x * 14.0 + co.y * 9.0)
    base = tuple(LEAF_B[k] * (1 - t) + LEAF_A[k] * t for k in range(3))
    return tuple(min(1.0, base[k] * (0.86 + 0.24 * wobble)) for k in range(3))


def look(cam, loc, target):
    cam.location = loc
    direction = Vector(target) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_to(scene, cam, name, loc, target=(0, -0.02, 0.46)):
    look(cam, loc, target)
    scene.render.filepath = os.path.join(SHOTS, name + ".png")
    bpy.ops.render.render(write_still=True)


def main():
    os.makedirs(SHOTS, exist_ok=True)
    os.makedirs(os.path.dirname(BLEND_PATH), exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=FBX, automatic_bone_orientation=False)
    src = bpy.data.objects["BoluoMesh"]
    arm = bpy.data.objects["BoluoArmature"]
    me = src.data
    coords = [v.co.copy() for v in me.vertices]
    weights = weight_map(src)
    parts = {"body": [], "armL": [], "armR": [], "footL": [], "footR": [], "crown": [], "eyeL": [], "eyeR": [], "mouth": []}
    part_ids = {key: [] for key in parts}
    for group in islands_of(me):
        pts = [coords[i] for i in group]
        mn, mx = bounds(pts)
        center = (mn + mx) * 0.5
        size = mx - mn
        if center.z > 0.8:
            parts["crown"].extend(pts)
            part_ids["crown"].extend(group)
        elif size.x < 0.12 and center.y < -0.2 and center.z > 0.6 and abs(center.x) > 0.04:
            key = "eyeL" if center.x < 0 else "eyeR"
            parts[key].extend(pts)
            part_ids[key].extend(group)
        elif size.x < 0.08 and center.y < -0.25 and center.z < 0.62:
            parts["mouth"].extend(pts)
            part_ids["mouth"].extend(group)
        else:
            for i in group:
                w = weights[i]
                p = coords[i]
                if w.get("LeftArm", 0) > 0.18:
                    parts["armL"].append(p)
                    part_ids["armL"].append(i)
                elif w.get("RightArm", 0) > 0.18:
                    parts["armR"].append(p)
                    part_ids["armR"].append(i)
                elif w.get("LeftFoot", 0) > 0.45:
                    parts["footL"].append(p)
                    part_ids["footL"].append(i)
                elif w.get("RightFoot", 0) > 0.45:
                    parts["footR"].append(p)
                    part_ids["footR"].append(i)
                elif w.get("LeftArm", 0) < 0.22 and w.get("RightArm", 0) < 0.22 and w.get("LeftFoot", 0) < 0.22 and w.get("RightFoot", 0) < 0.22:
                    parts["body"].append(p)
                    part_ids["body"].append(i)

    build = Builder()
    body = parts["body"]
    mn, mx = bounds(body)
    angles = 18
    steps = 12
    profile = []
    for s in range(steps):
        z0 = mn.z + (mx.z - mn.z) * s / (steps - 1)
        band_h = (mx.z - mn.z) / steps * 0.32
        band = [p for p in body if abs(p.z - z0) <= band_h]
        radii = [0.0] * angles
        for p in band:
            ang = math.atan2(p.x, p.y)  # 0 at the back (+Y)
            sector = int((ang + math.pi) / math.tau * angles) % angles
            radii[sector] = max(radii[sector], math.hypot(p.x, p.y))
        radii = fill_zeros(radii)
        radii = smooth_circular(radii, 0.28)
        profile.append((z0, radii))
    # Relax the middle only. The crown and the soles keep the slices they were measured from.
    for _ in range(2):
        nxt = []
        for s, (z, radii) in enumerate(profile):
            if s < 2 or s > steps - 3:
                nxt.append((z, radii))
                continue
            prev = profile[s - 1][1]
            fol = profile[s + 1][1]
            nxt.append((z, [radii[i] * 0.7 + prev[i] * 0.15 + fol[i] * 0.15 for i in range(angles)]))
        profile = nxt
    # Round the lid so the head is a dome under the leaves, not a cut cylinder.
    profile[-2] = (profile[-2][0], [r * 0.9 for r in profile[-2][1]])
    profile[-1] = (profile[-1][0], [r * 0.68 for r in profile[-1][1]])
    side_island = build.alloc_island()
    top_island = build.alloc_island()
    bot_island = build.alloc_island()
    rings = []
    for s, (z, radii) in enumerate(profile):
        v = s / (steps - 1)
        ring = []
        for a in range(angles):
            ang = -math.pi + math.tau * a / angles
            # ang 0 in atan2(x, y) is +Y. sector 0 is ang -pi, which is -Y? 
            # atan2(x, y): angle from +Y toward +X. We stored sector from (ang+pi).
            # Reconstruct: stored sector a corresponds to atan2 = -pi + tau*a/angles.
            theta = -math.pi + math.tau * (a + 0.5) / angles
            # theta is atan2(x, y): x = r sin(theta), y = r cos(theta)
            r = radii[a]
            co = Vector((math.sin(theta) * r, math.cos(theta) * r, z))
            deep = 0.15 * (1 - v) + 0.05 * max(0, -co.y)
            color = tuple(BODY[k] * (1 - deep) + BODY_DEEP[k] * deep for k in range(3))
            ring.append(build.vert(co, color))
        rings.append((v, ring))
    for s in range(steps - 1):
        v0 = rings[s][0]
        v1 = rings[s + 1][0]
        for a in range(angles):
            a2 = (a + 1) % angles
            u0, u1 = a / angles, (a + 1) / angles
            build.face(
                (rings[s][1][a], rings[s][1][a2], rings[s + 1][1][a2], rings[s + 1][1][a]),
                ((u0, v0), (u1, v0), (u1, v1), (u0, v1)),
                side_island,
            )
    def cap(ring_verts, z, island, top):
        c = Vector((0, 0, z))
        # Average the ring so the pole sits in the middle of the opening.
        acc = sum((v.co for v in ring_verts), Vector()) / len(ring_verts)
        acc.z = z
        pole_color = BODY if top else BODY_DEEP
        pole = build.vert(acc, pole_color)
        span = bounds([v.co for v in ring_verts])
        lo, hi = span
        for a in range(angles):
            a2 = (a + 1) % angles
            va, vb = ring_verts[a], ring_verts[a2]
            def planar(co):
                return (
                    (co.x - lo.x) / max(hi.x - lo.x, 1e-4),
                    (co.y - lo.y) / max(hi.y - lo.y, 1e-4),
                )
            if top:
                build.face((pole, va, vb), (planar(pole.co), planar(va.co), planar(vb.co)), island)
            else:
                build.face((pole, vb, va), (planar(pole.co), planar(vb.co), planar(va.co)), island)
    cap(rings[-1][1], mx.z + 0.02, top_island, True)
    bot_z = 0.0 if mn.z < 0.06 else mn.z
    cap(rings[0][1], bot_z, bot_island, False)

    # Cheeks: pull nearby body verts toward blush. Eyes are known from the source.
    eye_centers = []
    for key in ("eyeL", "eyeR"):
        if parts[key]:
            eye_centers.append(sum(parts[key], Vector()) / len(parts[key]))
    for v in list(build.color_of):
        if v.co.z < 0.5 or v.co.y > -0.12:
            continue
        for eye in eye_centers:
            cheek = Vector((eye.x * 1.15, eye.y + 0.01, eye.z - 0.055))
            d = (v.co - cheek).length
            if d < 0.07:
                t = (1 - d / 0.07) * 0.7
                src_c = build.color_of[v]
                build.color_of[v] = tuple(src_c[k] * (1 - t) + BLUSH[k] * t for k in range(3))

    arms = []
    for key in ("armL", "armR"):
        if len(part_ids[key]) < 12:
            continue
        arms.append(piece_from_verts(src, part_ids[key], 0.45, cap_holes=True, tuck=0.0))
    if arms:
        fuse_body_arms(build, arms)
        for v in list(build.color_of):
            if v.co.z < 0.5 or v.co.y > -0.12:
                continue
            for eye in eye_centers:
                cheek = Vector((eye.x * 1.15, eye.y + 0.01, eye.z - 0.055))
                d = (v.co - cheek).length
                if d < 0.07:
                    t = (1 - d / 0.07) * 0.7
                    src_c = build.color_of[v]
                    build.color_of[v] = tuple(src_c[k] * (1 - t) + BLUSH[k] * t for k in range(3))

    # The egg's bottom is a smooth dome that swallows the legs. Cut it off and
    # put the original lower shell back, so the two short columns keep their shape.
    # Join on the belly, above the legs, so the bridge is a short cuff
    # and the columns below stay the original surface.
    cut_z = 0.2
    low_faces = [f for f in build.bm.faces if f.calc_center_median().z < cut_z]
    if low_faces:
        bmesh.ops.delete(build.bm, geom=low_faces, context="FACES")
    loose = [v for v in build.bm.verts if not v.link_faces]
    if loose:
        bmesh.ops.delete(build.bm, geom=loose, context="VERTS")
    base_ids = [
        i for i, p in enumerate(coords)
        if p.z < cut_z + 0.012
        and weights[i].get("LeftArm", 0) < 0.25
        and weights[i].get("RightArm", 0) < 0.25
    ]
    base = piece_from_verts(src, base_ids, 0.55, cap_holes=False)
    legs = absorb(build, base, base_color)
    before_faces = set(build.bm.faces)
    boundary = [e for e in build.bm.edges if e.is_boundary]
    if len(boundary) > 3:
        bmesh.ops.bridge_loops(build.bm, edges=boundary)
    join = build.alloc_island()
    for face in build.bm.faces:
        if face in before_faces:
            continue
        face[build.island] = join
        for loop in face.loops:
            co = loop.vert.co
            loop[build.uv].uv = (
                (math.atan2(co.x, co.y) + math.pi) / math.tau,
                (co.z - 0.12) / 0.2,
            )
        us = [loop[build.uv].uv.x for loop in face.loops]
        if max(us) - min(us) > 0.5:
            for loop in face.loops:
                if loop[build.uv].uv.x < 0.5:
                    loop[build.uv].uv.x += 1.0
    band = [v for v in build.bm.verts if 0.16 < v.co.z < 0.24]
    for _ in range(3):
        bmesh.ops.smooth_vert(
            build.bm, verts=band, factor=0.45,
            use_axis_x=True, use_axis_y=True, use_axis_z=True,
        )
    foot_report = {"shell": legs, "src": len(base_ids)}
    eye_report = []
    for key in ("eyeL", "eyeR"):
        pts = parts[key]
        if not pts:
            continue
        lo, hi = bounds(pts)
        center = (lo + hi) * 0.5
        # Sit just proud of the original bump so the lid does not z-fight the egg.
        center.y -= 0.004
        radii = (
            max(0.02, (hi.x - lo.x) * 0.55),
            max(0.012, (hi.y - lo.y) * 0.7),
            max(0.02, (hi.z - lo.z) * 0.55),
        )
        add_ellipsoid(build, center, radii, 16, 8, EYE)
        eye_report.append({
            "center": [round(center.x, 4), round(center.y, 4), round(center.z, 4)],
            "radii": [round(radii[0], 4), round(radii[1], 4), round(radii[2], 4)],
        })
    if parts["mouth"]:
        lo, hi = bounds(parts["mouth"])
        zmid = (lo.z + hi.z) * 0.5
        # Drop the old bump. Plant the oval on the egg so every rim vert stays within 2 mm.
        tree = BVHTree.FromBMesh(build.bm)
        hit = tree.find_nearest(Vector(((lo.x + hi.x) * 0.5, -0.45, zmid)))
        center = hit[0].copy() if hit[0] is not None else Vector((0.0, lo.y, zmid))
        center.y -= 0.0006
        add_mouth_oval(build, center, 0.011, 0.02, 16, MOUTH)
    # Close the egg, eyes and feet before the crown and arms bring their own normals.
    build.bm.normal_update()
    bmesh.ops.recalc_face_normals(build.bm, faces=list(build.bm.faces))
    crown = piece_from_verts(src, part_ids["crown"], 0.2, cap_holes=False)
    leaves = absorb(build, crown, leaf_color)
    arm_report = {"armL": len(part_ids["armL"]), "armR": len(part_ids["armR"])}
    pack_uvs(build)
    mesh = bpy.data.meshes.new("SM_Boluo")
    build.bm.verts.ensure_lookup_table()
    ordered = [build.color_of[v] for v in build.bm.verts]
    build.bm.to_mesh(mesh)
    build.bm.free()
    ob = bpy.data.objects.new("SM_Boluo", mesh)
    bpy.context.scene.collection.objects.link(ob)
    for poly in mesh.polygons:
        poly.use_smooth = True
    col = mesh.color_attributes.new(name="Col", type="BYTE_COLOR", domain="POINT")
    for i, color in enumerate(ordered):
        col.data[i].color = (color[0], color[1], color[2], 1.0)
    mat = bpy.data.materials.new("M_Boluo")
    bsdf = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    vc = mat.node_tree.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mat.node_tree.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.55
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.3
    mesh.materials.append(mat)
    transfer_weights(ob, src, weights)
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    src.hide_render = True
    src.hide_set(True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 720
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    try:
        scene.view_settings.view_transform = "Standard"
    except TypeError:
        pass
    try:
        scene.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    world = bpy.data.worlds.new("World")
    scene.world = world
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.62, 0.74, 0.86, 1)
    bg.inputs[1].default_value = 0.9
    sun = bpy.data.lights.new("Key", "SUN")
    sun.energy = 3.2
    sun_ob = bpy.data.objects.new("Key", sun)
    bpy.context.scene.collection.objects.link(sun_ob)
    sun_ob.rotation_euler = (math.radians(48), math.radians(-18), math.radians(24))
    cam_data = bpy.data.cameras.new("Cam")
    cam_data.lens = 50
    cam = bpy.data.objects.new("Cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    scene.camera = cam
    bpy.context.view_layer.update()
    render_to(scene, cam, "front", (0, -1.65, 0.5))
    render_to(scene, cam, "side", (1.65, -0.05, 0.5))
    render_to(scene, cam, "back", (0, 1.65, 0.5))
    render_to(scene, cam, "threeq", (1.05, -1.15, 0.72))
    render_to(scene, cam, "low", (0.2, -0.9, 0.05), (0, 0, 0.08))
    render_to(scene, cam, "face", (0, -0.72, 0.68), (0, -0.2, 0.62))

    # Jump-like pose on the real bones: hips up, feet tucked, arms raised.
    arm.data.pose_position = "POSE"
    for bone in arm.pose.bones:
        bone.rotation_mode = "XYZ"
    arm.pose.bones["Hips"].location = (0.0, 0.16, 0.0)
    arm.pose.bones["LeftFoot"].rotation_euler = (0.9, 0.0, 0.15)
    arm.pose.bones["RightFoot"].rotation_euler = (0.9, 0.0, -0.15)
    arm.pose.bones["LeftArm"].rotation_euler = (0.2, 0.4, 1.1)
    arm.pose.bones["RightArm"].rotation_euler = (0.2, -0.4, -1.1)
    bpy.context.view_layer.update()
    render_to(scene, cam, "jump", (1.05, -1.15, 0.78))
    for bone in arm.pose.bones:
        bone.location = (0.0, 0.0, 0.0)
        bone.rotation_euler = (0.0, 0.0, 0.0)
    arm.data.pose_position = "REST"
    bpy.context.view_layer.update()

    stats = export_json(ob)
    tris = sum(len(p.vertices) - 2 for p in mesh.polygons)
    summary = {
        "verts_blender": len(mesh.vertices),
        "tris_blender": tris,
        "export_verts": stats["verts"],
        "export_tris": stats["tris"],
        "leaves": leaves,
        "arms": arm_report,
        "feet": foot_report,
        "eyes": eye_report,
        "parts": {k: len(v) for k, v in parts.items()},
        "body_z": [round(mn.z, 3), round(mx.z, 3)],
    }
    # Deformation check: the shipped walk clip has to move the foot.
    summary["walk_foot_y"] = walk_foot_span()
    sys_path_qa()
    import qa_check
    summary["qa"] = qa_check.run(objects=["SM_Boluo"], profile="game")
    bpy.ops.wm.save_as_mainfile(filepath=BLEND_PATH)
    print("@@JSON@@" + json.dumps(summary))


def sys_path_qa():
    import sys
    path = "/Users/sika/.agents/skills/blender-asset-qa/scripts"
    if path not in sys.path:
        sys.path.insert(0, path)


def walk_foot_span():
    with open(JSON_PATH) as handle:
        file = json.load(handle)

    def dec(text, typecode):
        buf = array(typecode)
        buf.frombytes(base64.b64decode(text))
        return buf

    rest = dec(file["rest"], "f")
    ibm = dec(file["ibm"], "f")
    pos = dec(file["pos"], "f")
    jnt = dec(file["jnt"], "B")
    wgt = dec(file["wgt"], "f")
    parents = file["parents"]
    joints = file["joints"]
    walk = file["walk"]

    def quat_mat(trs):
        tx, ty, tz, x, y, z, w, sx, sy, sz = trs
        xx, yy, zz = x * x, y * y, z * z
        xy, xz, yz = x * y, x * z, y * z
        wx, wy, wz = w * x, w * y, w * z
        m = [0.0] * 16
        m[0] = (1 - 2 * (yy + zz)) * sx
        m[1] = 2 * (xy + wz) * sx
        m[2] = 2 * (xz - wy) * sx
        m[4] = 2 * (xy - wz) * sy
        m[5] = (1 - 2 * (xx + zz)) * sy
        m[6] = 2 * (yz + wx) * sy
        m[8] = 2 * (xz + wy) * sz
        m[9] = 2 * (yz - wx) * sz
        m[10] = (1 - 2 * (xx + yy)) * sz
        m[12], m[13], m[14], m[15] = tx, ty, tz, 1.0
        return m

    def mul(a, b):
        o = [0.0] * 16
        for c in range(4):
            for r in range(4):
                o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]
        return o

    def apply(m, v):
        return (
            m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
            m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
            m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
        )

    tracks = []
    for track in walk["tracks"]:
        if not track:
            tracks.append(None)
            continue
        tracks.append((dec(track["times"], "f"), dec(track["trs"], "f")))
    n = len(pos) // 3
    foot = [
        i for i in range(n)
        if any(jnt[i * 4 + k] == BONE_INDEX["LeftFoot"] and wgt[i * 4 + k] > 0.5 for k in range(4))
    ]
    heights = []
    duration = walk["duration"]
    for frame in range(4):
        time = duration * frame / 4
        locals_ = []
        for i in range(len(parents)):
            base = list(rest[i * 10:(i + 1) * 10])
            track = tracks[i] if i < len(tracks) else None
            if track:
                times, trs = track
                # Step sample, same segments the runtime interpolates.
                t = time % duration if duration else 0
                idx = 0
                while idx < len(times) - 2 and times[idx + 1] < t:
                    idx += 1
                u = 0 if times[idx + 1] <= times[idx] else max(0, min(1, (t - times[idx]) / (times[idx + 1] - times[idx])))
                a = idx * 10
                b = (idx + 1) * 10
                for k in range(3):
                    base[k] = trs[a + k] * (1 - u) + trs[b + k] * u
                for k in range(3, 7):
                    base[k] = trs[a + k] * (1 - u) + trs[b + k] * u
                for k in range(7, 10):
                    base[k] = trs[a + k] * (1 - u) + trs[b + k] * u
            locals_.append(base)
        glob = []
        for i in range(len(parents)):
            local = quat_mat(locals_[i])
            glob.append(local if parents[i] < 0 else mul(glob[parents[i]], local))
        jm = [mul(glob[node], list(ibm[j * 16:(j + 1) * 16])) for j, node in enumerate(joints)]
        acc = 0.0
        count = 0
        for i in foot:
            p = (pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
            out = [0.0, 0.0, 0.0]
            for k in range(4):
                w = wgt[i * 4 + k]
                if w <= 0:
                    continue
                tp = apply(jm[jnt[i * 4 + k]], p)
                out[0] += w * tp[0]
                out[1] += w * tp[1]
                out[2] += w * tp[2]
            acc += out[1]
            count += 1
        heights.append(round(acc / max(count, 1), 4))
    return heights


if __name__ == "__main__":
    main()
