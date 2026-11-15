from pathlib import Path

import bpy


ROOT = Path(__file__).resolve().parents[1]
BLEND = ROOT / "blender" / "stadiums_working_v001.blend"
OUTPUT = ROOT / "blender" / "stadiums_v001.glb"
EXPECTED_MESHES = 310
EXPECTED_TRIANGLES = 6494
STADIUM_ROOTS = {
    "ST_EAST_01_Root",
    "ST_EAST_02_Root",
    "ST_WEST_01_Root",
    "ST_WEST_02_Root",
}


def descendants(root):
    stack = list(root.children)
    result = []
    while stack:
        obj = stack.pop()
        result.append(obj)
        stack.extend(obj.children)
    return result


def triangle_count(meshes):
    total = 0
    for obj in meshes:
        obj.data.calc_loop_triangles()
        total += len(obj.data.loop_triangles)
    return total


def sync_materials_for_gltf(meshes):
    """Copy viewport colors into Principled nodes before glTF export.

    The working file was authored on a localized Blender build, so looking up
    the node by the English display name can miss it. glTF reads the shader
    node, while Workbench reads diffuse_color.
    """
    materials = {
        slot.material
        for obj in meshes
        for slot in obj.material_slots
        if slot.material is not None
    }
    for material in materials:
        material.use_nodes = True
        bsdf = next(
            (
                node
                for node in material.node_tree.nodes
                if node.bl_idname == "ShaderNodeBsdfPrincipled"
            ),
            None,
        )
        if bsdf is None:
            raise RuntimeError(f"材质缺少 Principled BSDF: {material.name}")
        bsdf.inputs["Base Color"].default_value = tuple(material.diffuse_color)
    return materials


def main():
    if Path(bpy.data.filepath).resolve() != BLEND.resolve():
        raise RuntimeError(f"必须从体育场 v001 工作文件执行，当前: {bpy.data.filepath}")

    sports_root = bpy.data.objects.get("REFINED_SPORTS")
    if sports_root is None:
        raise RuntimeError("缺少 REFINED_SPORTS")
    sports_objects = [sports_root, *descendants(sports_root)]
    meshes = [obj for obj in sports_objects if obj.type == "MESH"]
    roots = {obj.name for obj in sports_root.children}
    if roots != STADIUM_ROOTS:
        raise RuntimeError(f"四场根节点异常: {sorted(roots)}")
    if len(meshes) != EXPECTED_MESHES:
        raise RuntimeError(f"体育场 Mesh 数量异常: {len(meshes)}")
    triangles = triangle_count(meshes)
    if triangles != EXPECTED_TRIANGLES:
        raise RuntimeError(f"体育场三角形数量异常: {triangles}")
    if any(obj.type in {"CAMERA", "LIGHT"} for obj in sports_objects):
        raise RuntimeError("REFINED_SPORTS 层级中意外包含相机或灯光")
    materials = sync_materials_for_gltf(meshes)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in sports_objects:
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_set(False)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = sports_root

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
        f"STADIUMS_EXPORT output={OUTPUT} objects={len(sports_objects)} "
        f"meshes={len(meshes)} triangles={triangles} materials={len(materials)}"
    )


if __name__ == "__main__":
    main()
