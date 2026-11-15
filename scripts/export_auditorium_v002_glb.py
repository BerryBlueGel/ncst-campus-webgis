from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "auditorium_working_v002.blend"
OUTPUT = ROOT / "blender" / "auditorium_v002.glb"


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"必须从会堂 v002 工作文件执行，当前为: {bpy.data.filepath}")

    refined_root = bpy.data.objects.get("AUDITORIUM_REFINED_ROOT")
    source = bpy.data.objects.get("TPX_Buildings_14.001")
    if refined_root is None or source is None:
        raise RuntimeError("缺少精修根节点或原始会堂参考对象")

    refined_objects = [
        obj for obj in bpy.context.scene.objects
        if obj == refined_root or obj.name.startswith("AUD_")
    ]
    meshes = [obj for obj in refined_objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("没有找到可导出的会堂 Mesh")

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
        export_texcoords=False,
        export_vertex_color="NONE",
        check_existing=False,
    )
    print(
        f"AUDITORIUM_EXPORT output={OUTPUT} "
        f"objects={len(refined_objects)} meshes={len(meshes)} "
        f"source_selected={source.select_get()}"
    )


if __name__ == "__main__":
    main()
