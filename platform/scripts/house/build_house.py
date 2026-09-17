#!/usr/bin/env python3
"""
Builds the House of Videos entrance in Blender and exports it as a GLB.

This is real Blender — `bpy`, the same program, driven headlessly — because the
alternative kept producing a box with a cone on it. The building is constructed
the way a building actually is: piers and spandrels forming a concrete grid,
with the glass set back behind it. That is what makes the reveals, and the
reveals are what make it read as architecture rather than as a painted
rectangle. No boolean operations, so nothing is fragile.

    /home/user/bpyenv/bin/python platform/scripts/house/build_house.py

Output: platform/public/house/entrance.glb

Two limits of the `bpy` wheel, worked within rather than around:

  * it ships EEVEE only, no Cycles, so lightmaps cannot be baked. The scene is
    therefore lit at RUNTIME in three.js — image-based lighting, ambient
    occlusion and bloom — rather than carrying baked light.
  * Draco is not bundled, so the GLB is uncompressed. Caddy already serves
    /media with gzip, and the geometry is small enough that it does not matter
    yet.

Materials are image textures generated here with numpy, not procedural node
graphs: glTF can only carry images, and a procedural graph would export as a
flat colour. Generating them costs nothing and needs no download, which matters
because no texture library is reachable from this environment.

**The node names are load-bearing.** `lib/house.ts` binds routes to mesh names
and `npm run check:house` asserts the two agree, so `door_front` here is the
same `door_front` there. The window bays are named `bay_00`... in reading
order — left to right, top row first — because that is the order
`windowStates()` returns.
"""

import math
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "public", "house", "entrance.glb"))

# ---------------------------------------------------------------- dimensions
# Metres. A bay is the structural unit: one pier plus one window.
BAYS_ACROSS = 6
FLOORS = 4
BAY_PITCH = 3.0
PIER_W = 0.62  # concrete between windows
SPANDREL_H = 0.85  # concrete between floors
FLOOR_H = 3.4
GROUND_H = 5.2  # a tall ground floor, so the entrance is generous
DEPTH = 12.0
PARAPET_H = 1.1
GLASS_SETBACK = 0.34  # how far the glazing sits behind the concrete grid

WIDTH = BAYS_ACROSS * BAY_PITCH
GLASS_W = BAY_PITCH - PIER_W
GLASS_H = FLOOR_H - SPANDREL_H
TOP = GROUND_H + FLOORS * FLOOR_H

ENTRANCE_W = 6.4
ENTRANCE_H = 4.1
ENTRANCE_RECESS = 2.6


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def box(name, sx, sy, sz, loc, mat=None):
    """An axis-aligned box. Origin at its centre; `loc` is that centre."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if mat:
        ob.data.materials.append(mat)
    return ob


def bevel(ob, width=0.012, segments=2):
    """A hairline bevel. Every real edge catches light; a perfectly sharp one
    disappears, which is a large part of why untextured CG reads as fake."""
    m = ob.modifiers.new(name="Bevel", type="BEVEL")
    m.width = width
    m.segments = segments
    m.limit_method = "ANGLE"
    m.angle_limit = math.radians(40)


# ---------------------------------------------------------------- textures
def image_from_array(name, arr):
    """numpy RGBA float array (h, w, 4) -> a Blender image."""
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, width=w, height=h, alpha=False, float_buffer=False)
    # Blender's pixel buffer is bottom-up and flat.
    img.pixels = np.flipud(arr).reshape(-1).tolist()
    img.pack()
    return img


def fbm(h, w, octaves=5, seed=7):
    """Fractal value noise. Concrete is mottled at several scales at once; one
    octave of noise looks like television static instead."""
    rng = np.random.default_rng(seed)
    out = np.zeros((h, w), dtype=np.float32)
    amp, total = 1.0, 0.0
    res = 4
    for _ in range(octaves):
        g = rng.random((res + 1, res + 1)).astype(np.float32)
        ys = np.linspace(0, res, h, endpoint=False)
        xs = np.linspace(0, res, w, endpoint=False)
        y0 = ys.astype(int)
        x0 = xs.astype(int)
        fy = (ys - y0)[:, None]
        fx = (xs - x0)[None, :]
        # smoothstep, so the lattice does not show as diamonds
        fy = fy * fy * (3 - 2 * fy)
        fx = fx * fx * (3 - 2 * fx)
        g00 = g[np.ix_(y0, x0)]
        g10 = g[np.ix_(y0 + 1, x0)]
        g01 = g[np.ix_(y0, x0 + 1)]
        g11 = g[np.ix_(y0 + 1, x0 + 1)]
        out += amp * ((g00 * (1 - fy) + g10 * fy) * (1 - fx) + (g01 * (1 - fy) + g11 * fy) * fx)
        total += amp
        amp *= 0.5
        res *= 2
    return out / total


def concrete_texture(size=512):
    """Board-formed concrete: mottling, plus the faint horizontal banding the
    formwork boards leave behind."""
    n = fbm(size, size, octaves=6, seed=11)
    boards = 0.5 + 0.5 * np.sin(np.linspace(0, math.pi * 2 * 14, size))[:, None]
    v = 0.40 + 0.13 * (n - n.mean()) + 0.030 * (boards - 0.5)
    v = np.clip(v, 0.0, 1.0).astype(np.float32)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    # A faintly warm grey; a neutral one reads as plastic.
    rgba[..., 0] = v * 1.02
    rgba[..., 1] = v * 1.00
    rgba[..., 2] = v * 0.97
    return image_from_array("concrete", np.clip(rgba, 0, 1))


def rough_texture(size=512):
    n = fbm(size, size, octaves=5, seed=23)
    v = np.clip(0.72 + 0.22 * (n - n.mean()), 0, 1).astype(np.float32)
    rgba = np.ones((size, size, 4), dtype=np.float32)
    for c in range(3):
        rgba[..., c] = v
    img = image_from_array("concrete_rough", rgba)
    img.colorspace_settings.name = "Non-Color"
    return img


def make_concrete():
    mat = bpy.data.materials.new("Concrete")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]

    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.22, 0.22, 0.22)
    nt.links.new(coord.outputs["Object"], mapping.inputs["Vector"])

    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = concrete_texture()
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    rtex = nt.nodes.new("ShaderNodeTexImage")
    rtex.image = rough_texture()
    nt.links.new(mapping.outputs["Vector"], rtex.inputs["Vector"])
    nt.links.new(rtex.outputs["Color"], bsdf.inputs["Roughness"])

    bsdf.inputs["Metallic"].default_value = 0.0
    return mat


def flat(name, rgb, rough=0.5, metal=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    return mat


# ---------------------------------------------------------------- the building
def build():
    clear()
    concrete = make_concrete()
    glass = flat("Glass", (0.035, 0.045, 0.06), rough=0.06, metal=0.0)
    metal = flat("Metal", (0.09, 0.095, 0.105), rough=0.35, metal=1.0)
    ground = flat("Ground", (0.055, 0.058, 0.066), rough=0.85)

    half = WIDTH / 2

    # --- ground ------------------------------------------------------------
    box("ground", 120, 120, 0.2, (0, 0, -0.1), ground)

    # --- the mass behind the facade ---------------------------------------
    # Set back so the facade grid in front of it does the reading.
    core = box("shell_core", WIDTH - 0.1, DEPTH, TOP, (0, DEPTH / 2 + 0.4, TOP / 2), flat("Shell", (0.045, 0.05, 0.06), rough=0.9))

    # --- ground floor: solid concrete either side of the entrance ----------
    side_w = (WIDTH - ENTRANCE_W) / 2
    for sgn in (-1, 1):
        p = box(
            f"ground_pier_{'l' if sgn < 0 else 'r'}",
            side_w, 0.8, GROUND_H,
            (sgn * (ENTRANCE_W / 2 + side_w / 2), 0, GROUND_H / 2),
            concrete,
        )
        bevel(p)

    # --- the entrance recess ----------------------------------------------
    # Back wall of the recess, and the soffit over it.
    box("entrance_back", ENTRANCE_W, 0.3, ENTRANCE_H, (0, ENTRANCE_RECESS, ENTRANCE_H / 2), flat("EntranceWall", (0.10, 0.10, 0.115), rough=0.8))
    soffit = box("entrance_soffit", ENTRANCE_W, ENTRANCE_RECESS, 0.3, (0, ENTRANCE_RECESS / 2, ENTRANCE_H + 0.15), concrete)
    bevel(soffit)
    # The head above the opening, up to the first floor.
    head = box("entrance_head", ENTRANCE_W, 0.8, GROUND_H - ENTRANCE_H - 0.3, (0, 0, (ENTRANCE_H + 0.3 + GROUND_H) / 2), concrete)
    bevel(head)

    # Steps up to the threshold.
    for i in range(3):
        box(f"step_{i}", ENTRANCE_W + 1.6 - i * 0.5, 0.42, 0.16,
            (0, -0.24 - i * 0.42, 0.08 + (2 - i) * 0.16), concrete)

    # --- the door ----------------------------------------------------------
    # Named for lib/house.ts: this is the hotspot the routing table binds to.
    door = box("door_front", 2.5, 0.09, 3.0, (0, ENTRANCE_RECESS - 0.2, 1.5), glass)
    frame_t = 0.09
    for dx, w in ((-1.30, 0.12), (1.30, 0.12)):
        box(f"door_jamb_{'l' if dx < 0 else 'r'}", w, 0.14, 3.1, (dx, ENTRANCE_RECESS - 0.2, 1.55), metal)
    box("door_head", 2.72, 0.14, 0.12, (0, ENTRANCE_RECESS - 0.2, 3.06), metal)

    # --- the facade grid above the entrance --------------------------------
    bays = []
    for row in range(FLOORS):
        # Row 0 is the top floor, because windowStates() reads top-left first.
        floor_i = FLOORS - 1 - row
        z0 = GROUND_H + floor_i * FLOOR_H
        # spandrel: the concrete band under this floor's glazing
        sp = box(f"spandrel_{row}", WIDTH, 0.8, SPANDREL_H, (0, 0, z0 + SPANDREL_H / 2), concrete)
        bevel(sp)
        gz = z0 + SPANDREL_H + GLASS_H / 2
        for col in range(BAYS_ACROSS):
            cx = -half + PIER_W / 2 + col * BAY_PITCH + (BAY_PITCH - PIER_W) / 2 + PIER_W / 2
            cx = -half + col * BAY_PITCH + BAY_PITCH / 2
            # The glass, set back so the pier casts a reveal across it.
            b = box(f"bay_{row * BAYS_ACROSS + col:02d}", GLASS_W, 0.12, GLASS_H,
                    (cx, GLASS_SETBACK, gz), glass)
            bays.append(b)
            # mullion at the head and sill of each bay
            box(f"mullion_h_{row}_{col}", GLASS_W, 0.16, 0.1, (cx, GLASS_SETBACK - 0.04, gz + GLASS_H / 2), metal)

    # piers: full height of the glazed part, in front of the glass
    for col in range(BAYS_ACROSS + 1):
        px = -half + col * BAY_PITCH
        p = box(f"pier_{col}", PIER_W, 0.86, FLOORS * FLOOR_H,
                (px, 0, GROUND_H + FLOORS * FLOOR_H / 2), concrete)
        bevel(p)

    # --- parapet -----------------------------------------------------------
    par = box("parapet", WIDTH + 0.5, 1.0, PARAPET_H, (0, 0, TOP + PARAPET_H / 2), concrete)
    bevel(par)

    # --- the sign ----------------------------------------------------------
    box("sign_plate", 5.6, 0.10, 0.52, (0, -0.44, GROUND_H - 1.05), flat("Sign", (0.055, 0.06, 0.075), rough=0.28, metal=0.7))

    return bays


def export(bays):
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    # Object coordinates drive the concrete mapping, so origins must be sane
    # before export; they are, because every box is created at its centre.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format="GLB",
        export_apply=True,          # bake the bevel modifiers into the mesh
        export_yup=True,            # three.js is Y-up, Blender is Z-up
        export_cameras=False,
        export_lights=False,
    )
    print(f"HOUSE: {len(bays)} bays, wrote {OUT} ({os.path.getsize(OUT)} bytes)")


if __name__ == "__main__":
    bays = build()
    export(bays)
