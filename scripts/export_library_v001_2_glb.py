from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "library_working_v001_2.blend"
OUTPUT = ROOT / "blender" / "library_v001_2.glb"


def has_ancestor(obj, ancestor):
    current = obj.parent
    while current is not None:
        if current == ancestor:
            return True
        current = current.parent
    return False


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"必须从图书馆 v001.2 工作文件执行，当前: {bpy.data.filepath}")
    refined_root = bpy.data.objects.get("LIBRARY_REFINED_ROOT")
    if refined_root is None:
        raise RuntimeError("缺少图书馆精修根节点")
    refined_objects = [
        obj for obj in bpy.context.scene.objects
        if obj == refined_root or has_ancestor(obj, refined_root)
    ]
    meshes = [obj for obj in refined_objects if obj.type == "MESH"]
    if len(meshes) != 72:
        raise RuntimeError(f"图书馆 Mesh 数量异常: {len(meshes)}")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in refined_objects:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = refined_root

    bpy.ops.export_scene.gltf(
        filepath=str(OUTPUT),
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_cameras=False,
        export_lights=False,
        export_extras=True,
        export_materials="EXPORT",
        export_normals=True,
        export_tangents=False,
        export_texcoords=True,
        export_vertex_color="NONE",
        check_existing=False,
    )
    print(f"LIBRARY_EXPORT output={OUTPUT} objects={len(refined_objects)} meshes={len(meshes)}")


if __name__ == "__main__":
    main()
