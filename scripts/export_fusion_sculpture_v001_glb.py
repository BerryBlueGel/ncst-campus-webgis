from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "fusion_sculpture_working_v001.blend"
OUTPUT = ROOT / "blender" / "fusion_sculpture_v001.glb"


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"必须从融合雕塑 v001 工作文件执行，当前: {bpy.data.filepath}")

    root = bpy.data.objects.get("FUS_Root")
    if root is None:
        raise RuntimeError("缺少 FUS_Root")

    expected_meshes = {
        "FUS_Ribbon_01_WarmFront",
        "FUS_Ribbon_02_DarkOuterRight",
        "FUS_Ribbon_03_DarkOuterLeft",
        "FUS_Ribbon_04_DarkInner",
        "FUS_Ribbon_05_WarmInner",
        "FUS_Base",
        "FUS_LandscapeRing",
    }
    mesh_objects = [bpy.data.objects.get(name) for name in sorted(expected_meshes)]
    if any(obj is None or obj.type != "MESH" for obj in mesh_objects):
        missing = [name for name, obj in zip(sorted(expected_meshes), mesh_objects) if obj is None]
        raise RuntimeError(f"融合雕塑导出对象缺失或类型异常: {missing}")
    if any(obj.parent != root for obj in mesh_objects):
        raise RuntimeError("融合雕塑 Mesh 未全部挂接在 FUS_Root 下")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in [root, *mesh_objects]:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root

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
    print(
        f"FUSION_EXPORT output={OUTPUT} objects={1 + len(mesh_objects)} "
        f"meshes={len(mesh_objects)}"
    )


if __name__ == "__main__":
    main()
