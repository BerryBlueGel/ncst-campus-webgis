"""Compare geometry, not vertex-array order (glTF splits vertices by normals)."""
import json
import math
from pathlib import Path
import bpy

PROJECT=Path(__file__).resolve().parents[1]
TARGET=PROJECT/'blender/teaching_detail_v001_validation_v002.json'
if TARGET.exists():
    raise RuntimeError('Existing revised validation is protected')

def read_markers(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    markers={}
    for obj in bpy.data.objects:
        if obj.type=='MESH' and obj.name.startswith('plan-connection-'):
            obj.data.calc_loop_triangles()
            vertices=[list(obj.matrix_world@v.co) for v in obj.data.vertices]
            triangles=[[vertices[i] for i in t.vertices] for t in obj.data.loop_triangles]
            markers[obj.name]={'vertices':vertices,'triangles':triangles}
    return markers

def distance(p,q):
    return math.dist(p,q)

def hausdorff(left,right):
    return max(max(min(distance(p,q) for q in right) for p in left),max(min(distance(q,p) for p in left) for q in right))

source=read_markers(PROJECT/'output/teaching_area_preview_v004.glb')
exported=read_markers(PROJECT/'output/teaching_detail_preview_v001.glb')
records=[]
checks={}
for name,original in source.items():
    current=exported[name]
    position_error=hausdorff(original['vertices'],current['vertices'])
    triangle_error=max(max(min(hausdorff(t,u) for u in current['triangles']) for t in original['triangles']),
                       max(min(hausdorff(u,t) for t in original['triangles']) for u in current['triangles']))
    checks[name]=position_error<.0002 and triangle_error<.0002 and len(original['triangles'])==len(current['triangles'])
    records.append({'name':name,'originalVertices':len(original['vertices']),'exportedVertices':len(current['vertices']),
        'originalTriangles':len(original['triangles']),'exportedTriangles':len(current['triangles']),
        'maxBidirectionalVertexDistanceMeters':position_error,'maxUnorderedTriangleDistanceMeters':triangle_error})
validation=json.loads((PROJECT/'blender/teaching_detail_v001_validation.json').read_text(encoding='utf-8'))
validation['supersedes']='blender/teaching_detail_v001_validation.json'
validation['revisionReason']='Initial ordered vertex-array test rejected normal-split duplicate vertices. Recheck compares actual world-space points AND triangle surfaces without depending on vertex order.'
validation['checks']['groundMarkerVerticesUnchangedAfterExport']=len(source)==len(exported)==2 and all(checks.values())
validation['connectionGeometryRecheck']=records
validation['status']='PASS' if all(validation['checks'].values()) else 'FAIL'
validation['passed']=sum(validation['checks'].values())
TARGET.write_text(json.dumps(validation,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps({'status':validation['status'],'passed':validation['passed'],'total':validation['total'],'connections':records},ensure_ascii=False))
if validation['status']!='PASS':
    raise RuntimeError('Connection recheck failed')
