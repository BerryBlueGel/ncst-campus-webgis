"""Read back the actual assembled GLB; create a separately editable review scene."""
import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Vector,Matrix
P=Path(__file__).resolve().parents[1]
glb=P/'output/campus_detail_preview_v001.glb'; blend=P/'blender/campus_detail_working_v001.blend'
reportpath=P/'blender/campus_detail_v001_readback.json'; previews=P/'blender/previews/campus_detail_v001'
assert not blend.exists() and not reportpath.exists()
manifest=json.loads((P/'output/campus_detail_preview_v001_validation.json').read_text(encoding='utf-8')); assert manifest['status']=='PASS'
params=json.loads((P/'reference/buildings/other_areas_detail_v001/parameters.json').read_text(encoding='utf-8'))
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=str(glb)); bpy.context.view_layer.update()
roots=[o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id') in params['allReviewedDetailIds']]
checks={'124UniqueRoots':len(roots)==len({o.get('feature_id') for o in roots})==124,
 'exactExpectedIds':{o.get('feature_id') for o in roots}==set(params['allReviewedDetailIds']),
 'all52NewPlacementsRetained':all(any(o.get('feature_id')==a['id'] and abs(o.matrix_world.translation.x-a['centerEastNorth'][0])<.0002 and abs(o.matrix_world.translation.z-a['centerEastNorth'][1])<.0002 for o in roots) for a in params['assets'])}
for label in ['AUDITORIUM_REFINED_ROOT','SOUTH_GATE_REFINED_ROOT','LIBRARY_REFINED_ROOT','FUS_Root','REFINED_SPORTS']:
    checks[label+'_present']=bpy.data.objects.get(label) is not None
scene=bpy.context.scene; scene.render.engine='BLENDER_EEVEE_NEXT'; scene.eevee.taa_render_samples=16
scene.render.resolution_x=1400; scene.render.resolution_y=1050; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'; scene.world=bpy.data.worlds.new('Detail_Daylight'); scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND'); bg.inputs[0].default_value=(.70,.83,.95,1); bg.inputs[1].default_value=.7
light=bpy.data.lights.new('Detail_Sun','SUN'); light.energy=3; sun=bpy.data.objects.new(light.name,light); scene.collection.objects.link(sun)
sun.rotation_euler=(math.radians(30),math.radians(-25),math.radians(-25))
data=bpy.data.cameras.new('Detail_ReviewCamera'); cam=bpy.data.objects.new(data.name,data); scene.collection.objects.link(cam)
data.type='ORTHO'; data.clip_end=6000; scene.camera=cam; previews.mkdir(parents=True,exist_ok=True)
def render(name,x,n,dx,dn,height,scale):
    cam.location=(x+dx,-height,n+dn); f=(Vector((x,-4,n))-cam.location).normalized(); up=Vector((0,-1,0))
    if abs(f.dot(up))>.99: up=Vector((0,0,1))
    right=f.cross(up).normalized(); cam.rotation_euler=Matrix((right,right.cross(f).normalized(),-f)).transposed().to_euler()
    data.ortho_scale=scale; scene.render.filepath=str(previews/name); bpy.ops.render.render(write_still=True)
render('whole_campus_top.png',990,900,0,0,1800,2800)
render('whole_campus_oblique.png',990,900,800,-1200,1000,2800)
for group in 'ABCD':
    selected=[a for a in params['assets'] if a['district']==group]
    points=[p for a in selected for c in (a['geometry']['coordinates'] if a['geometry']['type']=='MultiPolygon' else [a['geometry']['coordinates']]) for p in c[0]]
    x=(min(p[0] for p in points)+max(p[0] for p in points))/2; n=(min(p[1] for p in points)+max(p[1] for p in points))/2
    scale=max(max(p[0] for p in points)-min(p[0] for p in points),1.3*(max(p[1] for p in points)-min(p[1] for p in points)))+90
    render(group.lower()+'_campus_oblique.png',x,n,150,-220,220,scale)
scene['review_status']='INDEPENDENT_TYPE_STUDY_NOT_AS_BUILT_NOT_DEPLOYED'
scene['formal_model_unchanged']=True; scene['source_references']='Retained in individual batch working .blend files'
bpy.context.preferences.filepaths.save_version=0; bpy.ops.wm.save_as_mainfile(filepath=str(blend)); bpy.ops.wm.open_mainfile(filepath=str(blend))
checks['savedSceneReopened']=sum(o.type=='EMPTY' and o.get('feature_id') in params['allReviewedDetailIds'] for o in bpy.data.objects)==124
checks['sixRenderedPreviews']=len(list(previews.glob('*.png')))==6
checks['glbHashUnchanged']=hashlib.sha256(glb.read_bytes()).hexdigest().upper()==manifest['sha256']
report={'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
 'previews':[str(f.relative_to(P)) for f in sorted(previews.glob('*.png'))],
 'limits':['Blender LINE rendering can differ; actual unmodified GLB is used for browser tests.',
 'Five-point foundation probes do not prove complete terrain contact. Actual height/photo binding remains limited.']}
reportpath.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps({k:report[k] for k in ['status','passed','total']}))
if not all(checks.values()): raise RuntimeError('Campus readback failed')
