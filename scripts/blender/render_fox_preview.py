"""Render Fox.glb Survey clip to transparent PNG frames (Blender headless)."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy


def parse_args(argv: list[str]) -> tuple[Path, Path, int]:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    glb = Path(argv[0] if len(argv) > 0 else "").resolve()
    out_dir = Path(argv[1] if len(argv) > 1 else "").resolve()
    max_frames = int(argv[2]) if len(argv) > 2 else 36
    return glb, out_dir, max_frames


def main() -> None:
    glb, out_dir, max_frames = parse_args(sys.argv)
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob("frame_*.png"):
        old.unlink()

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(glb))

    # Find armature / animated object
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    act = None
    for a in bpy.data.actions:
        if "survey" in a.name.lower() or a.name == "Survey":
            act = a
            break
    if act is None and bpy.data.actions:
        act = bpy.data.actions[0]
    if arms and act:
        arm = arms[0]
        if arm.animation_data is None:
            arm.animation_data_create()
        arm.animation_data.action = act
        try:
            if getattr(act, "slots", None) and len(act.slots) > 0:
                arm.animation_data.action_slot = act.slots[0]
        except Exception:
            pass

    # Camera looking at model
    bpy.ops.object.camera_add(location=(0.0, -4.2, 1.4))
    cam = bpy.context.object
    cam.rotation_euler = (1.35, 0.0, 0.0)
    bpy.context.scene.camera = cam

    # Light
    bpy.ops.object.light_add(type="SUN", location=(2, -2, 5))
    bpy.context.object.data.energy = 2.5
    bpy.ops.object.light_add(type="AREA", location=(-2, 2, 3))
    bpy.context.object.data.energy = 40

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in dir(bpy.types.RenderEngine) else "BLENDER_EEVEE"
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except Exception:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.resolution_x = 512
    scene.render.resolution_y = 512
    scene.render.fps = 24
    scene.render.filepath = str(out_dir / "frame_")

    f0, f1 = 1, max_frames
    if act is not None:
        fr = act.frame_range
        f0, f1 = int(fr[0]), int(fr[1])
        if f1 <= f0:
            f1 = f0 + max_frames - 1
        # Cap length for small GIF
        if f1 - f0 + 1 > max_frames:
            f1 = f0 + max_frames - 1
    scene.frame_start = f0
    scene.frame_end = f1

    # Frame model
    for obj in bpy.data.objects:
        obj.select_set(obj.type in {"MESH", "ARMATURE"})
    bpy.ops.view3d.camera_to_view_selected() if False else None

    # Manual framing: compute bounds
    import mathutils

    min_c = mathutils.Vector((1e9, 1e9, 1e9))
    max_c = mathutils.Vector((-1e9, -1e9, -1e9))
    has = False
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            w = obj.matrix_world @ mathutils.Vector(corner)
            min_c = mathutils.Vector((min(min_c.x, w.x), min(min_c.y, w.y), min(min_c.z, w.z)))
            max_c = mathutils.Vector((max(max_c.x, w.x), max(max_c.y, w.y), max(max_c.z, w.z)))
            has = True
    if has:
        center = (min_c + max_c) * 0.5
        size = (max_c - min_c).length
        dist = max(2.5, size * 1.6)
        cam.location = (center.x, center.y - dist, center.z + size * 0.15)
        direction = center - cam.location
        cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

    bpy.ops.render.render(animation=True)
    print(f"[fox-preview] wrote frames {f0}-{f1} -> {out_dir}")


if __name__ == "__main__":
    main()
