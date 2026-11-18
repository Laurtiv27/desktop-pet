"""
Headless Blender: retarget Mixamo clips from a source GLB onto SAS (CS2-style bones).

Usage:
  blender.exe --background --python retarget_mixamo_to_sas.py -- \
    --target <sas.glb> --source <soldier.glb> --output <out.glb>
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Matrix


# Mixamo → SAS (Source2/CS naming). Fingers skipped (optional).
BONE_MAP = {
    "mixamorig:Hips": "pelvis_82",
    "mixamorig:Spine": "spine_0_68",
    "mixamorig:Spine1": "spine_1_67",
    "mixamorig:Spine2": "spine_2_66",
    "mixamorig:Neck": "neck_0_3",
    "mixamorig:Head": "head_0_0",
    "mixamorig:LeftShoulder": "clavicle_l_31",
    "mixamorig:LeftArm": "arm_upper_l_30",
    "mixamorig:LeftForeArm": "arm_lower_l_27",
    "mixamorig:LeftHand": "hand_l_24",
    "mixamorig:RightShoulder": "clavicle_r_59",
    "mixamorig:RightArm": "arm_upper_r_58",
    "mixamorig:RightForeArm": "arm_lower_r_55",
    "mixamorig:RightHand": "hand_r_52",
    "mixamorig:LeftUpLeg": "leg_upper_l_74",
    "mixamorig:LeftLeg": "leg_lower_l_71",
    "mixamorig:LeftFoot": "ankle_l_70",
    "mixamorig:LeftToeBase": "ball_l_69",
    "mixamorig:RightUpLeg": "leg_upper_r_81",
    "mixamorig:RightLeg": "leg_lower_r_77",
    "mixamorig:RightFoot": "ankle_r_76",
    "mixamorig:RightToeBase": "ball_r_75",
}

# Source clip name → export clip name
CLIP_RENAME = {
    "Idle": "idle",
    "Walk": "walk",
    "Run": "run",
    "idle": "idle",
    "walk": "walk",
    "run": "run",
}


def parse_args(argv: list[str]) -> argparse.Namespace:
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    p = argparse.ArgumentParser()
    p.add_argument("--target", required=True, help="SAS (or other) GLB path")
    p.add_argument("--source", required=True, help="Mixamo-rigged GLB with clips")
    p.add_argument("--output", required=True, help="Output GLB path")
    return p.parse_args(argv)


def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_gltf(path: Path) -> None:
    bpy.ops.import_scene.gltf(filepath=str(path))


def find_armatures() -> list[bpy.types.Object]:
    return [o for o in bpy.context.scene.objects if o.type == "ARMATURE"]


def pick_armature(candidates: list[bpy.types.Object], prefer_bones: set[str]) -> bpy.types.Object:
    best = None
    best_score = -1
    for arm in candidates:
        names = {b.name for b in arm.data.bones}
        score = len(names & prefer_bones)
        if score > best_score:
            best_score = score
            best = arm
    if best is None:
        raise RuntimeError("no armature found")
    return best


def clear_pose(arm: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="POSE")
    for pb in arm.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
    bpy.ops.object.mode_set(mode="OBJECT")


def remove_object_tree(obj: bpy.types.Object) -> None:
    children = list(obj.children)
    for ch in children:
        remove_object_tree(ch)
    bpy.data.objects.remove(obj, do_unlink=True)


def action_frame_range(action: bpy.types.Action) -> tuple[int, int]:
    # Blender 5: action may use layers/slots; fall back to frame_range
    try:
        fr = action.frame_range
        return int(fr[0]), int(fr[1])
    except Exception:
        return 1, 30


def list_source_actions(src_arm: bpy.types.Object) -> list[tuple[str, bpy.types.Action]]:
    found: list[tuple[str, bpy.types.Action]] = []
    seen = set()
    # Animations imported from glTF usually become actions named after clips
    for act in bpy.data.actions:
        name = act.name
        base = name.split("|")[-1].strip()
        key = CLIP_RENAME.get(base) or CLIP_RENAME.get(name)
        if not key:
            continue
        if key in seen:
            continue
        seen.add(key)
        found.append((key, act))
    # Also check NLA / animation_data
    if src_arm.animation_data and src_arm.animation_data.action:
        act = src_arm.animation_data.action
        base = act.name.split("|")[-1].strip()
        key = CLIP_RENAME.get(base) or CLIP_RENAME.get(act.name)
        if key and key not in seen:
            found.append((key, act))
    return found


def ensure_animation_data(arm: bpy.types.Object) -> bpy.types.AnimData:
    if arm.animation_data is None:
        arm.animation_data_create()
    return arm.animation_data


def apply_constraints(src_arm: bpy.types.Object, tgt_arm: bpy.types.Object) -> list[str]:
    used = []
    src_names = {b.name for b in src_arm.data.bones}
    tgt_names = {b.name for b in tgt_arm.data.bones}
    bpy.context.view_layer.objects.active = tgt_arm
    bpy.ops.object.mode_set(mode="POSE")
    for src_name, tgt_name in BONE_MAP.items():
        if src_name not in src_names or tgt_name not in tgt_names:
            print(f"[skip] map {src_name} -> {tgt_name}")
            continue
        pb = tgt_arm.pose.bones[tgt_name]
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])
        c = pb.constraints.new("COPY_ROTATION")
        c.target = src_arm
        c.subtarget = src_name
        c.mix_mode = "REPLACE"
        c.target_space = "WORLD"
        c.owner_space = "WORLD"
        if tgt_name == "pelvis_82":
            cl = pb.constraints.new("COPY_LOCATION")
            cl.target = src_arm
            cl.subtarget = src_name
            cl.use_x = True
            cl.use_y = True
            cl.use_z = True
            cl.target_space = "WORLD"
            cl.owner_space = "WORLD"
        used.append(tgt_name)
    bpy.ops.object.mode_set(mode="OBJECT")
    return used


def assign_action(arm: bpy.types.Object, action: bpy.types.Action | None) -> None:
    ad = ensure_animation_data(arm)
    ad.action = action
    # Blender 5 layered actions: try to pick a slot when present
    slots = getattr(action, "slots", None) if action is not None else None
    if slots is not None and len(slots) > 0:
        try:
            ad.action_slot = slots[0]
        except Exception:
            pass


def matrix_to_basis(pb: bpy.types.PoseBone, visual_matrix: Matrix) -> Matrix:
    """Convert a pose-space visual matrix into matrix_basis under current rest pose."""
    bone = pb.bone
    if pb.parent:
        parent_mat = pb.parent.matrix
        rest = bone.matrix_local
        parent_rest = pb.parent.bone.matrix_local
        return parent_rest.inverted() @ rest.inverted() @ parent_mat.inverted() @ visual_matrix
    arm_mat = pb.id_data.matrix_world
    # pose bone matrix is in armature space when using pb.matrix
    return bone.matrix_local.inverted() @ visual_matrix


def bake_action(
    tgt_arm: bpy.types.Object,
    bone_names: list[str],
    frame_start: int,
    frame_end: int,
    action_name: str,
) -> bpy.types.Action:
    bpy.ops.object.mode_set(mode="OBJECT")
    bpy.ops.object.select_all(action="DESELECT")
    tgt_arm.select_set(True)
    bpy.context.view_layer.objects.active = tgt_arm
    bpy.ops.object.mode_set(mode="POSE")

    if action_name in bpy.data.actions:
        bpy.data.actions.remove(bpy.data.actions[action_name])
    act = bpy.data.actions.new(name=action_name)
    assign_action(tgt_arm, act)

    for pb in tgt_arm.pose.bones:
        pb.rotation_mode = "QUATERNION"

    scene = bpy.context.scene
    for frame in range(int(frame_start), int(frame_end) + 1):
        # Evaluate with constraints ON
        for name in bone_names:
            for c in tgt_arm.pose.bones[name].constraints:
                c.mute = False
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        visuals = {name: tgt_arm.pose.bones[name].matrix.copy() for name in bone_names}

        # Mute constraints so keyframes stick to bones themselves
        for name in bone_names:
            for c in tgt_arm.pose.bones[name].constraints:
                c.mute = True
        bpy.context.view_layer.update()
        for name, mat in visuals.items():
            pb = tgt_arm.pose.bones[name]
            pb.matrix = mat
            pb.keyframe_insert(data_path="location", frame=frame)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=frame)
            pb.keyframe_insert(data_path="scale", frame=frame)

    strip_root_xz(tgt_arm, act, "pelvis_82")

    for name in bone_names:
        pb = tgt_arm.pose.bones[name]
        while pb.constraints:
            pb.constraints.remove(pb.constraints[0])

    bpy.ops.object.mode_set(mode="OBJECT")
    return act


def iter_action_fcurves(action: bpy.types.Action):
    """Blender 5 moved fcurves under action layers/channelbags; 3.x had action.fcurves."""
    fcurves = getattr(action, "fcurves", None)
    if fcurves is not None:
        for fc in fcurves:
            yield fc
        return
    for layer in getattr(action, "layers", []) or []:
        for strip in getattr(layer, "strips", []) or []:
            for bag in getattr(strip, "channelbags", []) or []:
                for fc in getattr(bag, "fcurves", []) or []:
                    yield fc


def strip_root_xz(arm: bpy.types.Object, action: bpy.types.Action, bone_name: str) -> None:
    """Keep first-frame X/Y (Blender) as constant so walk doesn't travel."""
    data_path = f'pose.bones["{bone_name}"].location'
    for fc in iter_action_fcurves(action):
        if fc.data_path != data_path:
            continue
        if fc.array_index not in (0, 1):  # X, Y
            continue
        if not fc.keyframe_points:
            continue
        base = fc.keyframe_points[0].co[1]
        for kp in fc.keyframe_points:
            kp.co[1] = base
            kp.handle_left[1] = base
            kp.handle_right[1] = base


def push_action_to_nla(arm: bpy.types.Object, action: bpy.types.Action) -> None:
    """Keep multiple clips on the armature for glTF export."""
    ad = ensure_animation_data(arm)
    track = ad.nla_tracks.new()
    track.name = action.name
    start = int(action.frame_range[0])
    track.strips.new(action.name, start, action)
    ad.action = None


def delete_source_objects(keep: set[bpy.types.Object]) -> None:
    for obj in list(bpy.data.objects):
        if obj in keep:
            continue
        # keep meshes parented under target armature / empty roots of target
        root = obj
        while root.parent is not None:
            root = root.parent
        if root in keep:
            continue
        try:
            bpy.data.objects.remove(obj, do_unlink=True)
        except Exception:
            pass


def main() -> None:
    args = parse_args(sys.argv)
    target_path = Path(args.target).resolve()
    source_path = Path(args.source).resolve()
    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"[retarget] target={target_path}")
    print(f"[retarget] source={source_path}")
    print(f"[retarget] output={output_path}")

    reset_scene()
    import_gltf(target_path)
    tgt_arms_before = set(find_armatures())
    tgt_objs = set(bpy.context.scene.objects)

    tgt_arm = pick_armature(
        list(tgt_arms_before),
        prefer_bones={"pelvis_82", "spine_0_68", "arm_upper_l_30"},
    )
    print(f"[retarget] target armature: {tgt_arm.name}")

    import_gltf(source_path)
    all_arms = find_armatures()
    src_arm = pick_armature(
        [a for a in all_arms if a != tgt_arm],
        prefer_bones={"mixamorig:Hips", "mixamorig:Spine"},
    )
    print(f"[retarget] source armature: {src_arm.name}")

    clear_pose(tgt_arm)
    clips = list_source_actions(src_arm)
    if not clips:
        # Force-assign each action that looks useful by scanning all actions again with looser match
        for act in bpy.data.actions:
            low = act.name.lower()
            for src_name, out_name in CLIP_RENAME.items():
                if src_name.lower() in low:
                    clips.append((out_name, act))
                    break
        # dedupe
        dedup = {}
        for k, a in clips:
            dedup[k] = a
        clips = list(dedup.items())

    print(f"[retarget] clips: {[(n, a.name) for n, a in clips]}")
    if not clips:
        raise RuntimeError("no Idle/Walk/Run actions found on source")

    # Drop empty SAS placeholder actions so they don't export
    for act in list(bpy.data.actions):
        if act.name.startswith("eye_test") or act.name.startswith("tools_preview"):
            bpy.data.actions.remove(act)

    baked: list[bpy.types.Action] = []
    for out_name, src_action in clips:
        print(f"[retarget] baking {src_action.name} -> {out_name}")
        clear_pose(tgt_arm)
        assign_action(src_arm, src_action)
        bone_names = apply_constraints(src_arm, tgt_arm)
        f0, f1 = action_frame_range(src_action)
        if f1 <= f0:
            f1 = f0 + 30
        # Prefer dense sampling from source action length at scene fps
        fps = bpy.context.scene.render.fps or 24
        # If range is tiny, expand from duration encoded in action
        if f1 - f0 < 5:
            f1 = f0 + max(24, int(round((f1 - f0) * fps)))
        bpy.context.scene.frame_start = f0
        bpy.context.scene.frame_end = f1
        act = bake_action(tgt_arm, bone_names, f0, f1, out_name)
        baked.append(act)
        push_action_to_nla(tgt_arm, act)
        print(f"[retarget] baked {out_name} frames={f0}-{f1}")

    # Remove source armature and its meshes so only SAS exports
    src_root_objects = set()
    for obj in bpy.data.objects:
        if obj == src_arm or obj.parent == src_arm:
            src_root_objects.add(obj)
        # meshes with armature modifier pointing at src
        for mod in getattr(obj, "modifiers", []):
            if getattr(mod, "type", "") == "ARMATURE" and getattr(mod, "object", None) == src_arm:
                src_root_objects.add(obj)

    # Also remove anything not in the original target import set, except we need careful keep
    keep = set()
    for obj in bpy.data.objects:
        if obj == tgt_arm:
            keep.add(obj)
            continue
        # keep if armature-mod targets tgt, or is child of tgt hierarchy
        root = obj
        while root.parent is not None:
            root = root.parent
        if root == tgt_arm:
            keep.add(obj)
            continue
        for mod in getattr(obj, "modifiers", []):
            if getattr(mod, "type", "") == "ARMATURE" and getattr(mod, "object", None) == tgt_arm:
                keep.add(obj)

    for obj in list(bpy.data.objects):
        if obj not in keep:
            try:
                bpy.data.objects.remove(obj, do_unlink=True)
            except Exception as e:
                print(f"[warn] remove {obj.name}: {e}")

    # Keep only our lowercase clips; drop Mixamo originals / TPose leftovers
    keep_actions = {a.name for a in baked}
    for act in list(bpy.data.actions):
        if act.name not in keep_actions:
            try:
                bpy.data.actions.remove(act)
            except Exception:
                pass

    if tgt_arm.animation_data:
        tgt_arm.animation_data.action = None

    bpy.ops.object.select_all(action="DESELECT")
    for obj in keep:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = tgt_arm

    export_kwargs = dict(
        filepath=str(output_path),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_def_bones=False,
        export_apply=False,
    )
    # Blender version differences around animation export flags
    try:
        bpy.ops.export_scene.gltf(
            **export_kwargs,
            export_animation_mode="ACTIONS",
            export_nla_strips=True,
            export_animate_action_slot=True,
        )
    except TypeError:
        bpy.ops.export_scene.gltf(**export_kwargs)
    print(f"[retarget] wrote {output_path}")


if __name__ == "__main__":
    main()
