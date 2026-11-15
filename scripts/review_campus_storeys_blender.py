"""Readback of actual v003 GLB, editable working scene and storey-scale views."""
import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Matrix,Vector
P=Path(__file__).resolve().parents[1];dest=P/'reference/buildings/storeys_v003'
glb=P/'output/campus_detail_preview_v003.glb';blend=P/'blender/campus_detail_working_v003.blend'
assert not blend.exists() and not (dest/'blender_readback.json').exists()
ledger=json.loads((dest/'storey_parameters.json').read_text(encoding='utf-8'))
report=json.loads((dest/'build_validation.json').read_text(encoding='utf-8'));assert report['status']=='PASS'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(glb));bpy.context.view_layer.update()
roots=[o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')];lookup={o['feature_id']:o for o in roots}
checks={'124UniqueStableIds':len(roots)==len(lookup)==124};errors=[]
for a in ledger['assets']:
    root=lookup[a['id']];objects=[o for o in root.children_recursive if o.type=='MESH']
    h=-min((o.matrix_world@v.co).y for o in objects for v in o.data.vertices)+root.matrix_world.translation.y
    errors.append(abs(h-a['heightAboveRootMeters']))
    checks[a['id']+'_storeys']=root.get('floor_count')==a['storeys'] and root.get('height_status')=='ESTIMATED_FROM_STOREYS_NOT_MEASURED'
    panes=[o for o in objects if o.get('mesh_role') in ['glass','warm_glass']]
    expected=sorted(round(z,3) for row in a['windowRowsLocalZ'] for z in row)
    checks[a['id']+'_actualGlassRows']=all(sorted(set(round(-float(v.co.y),3) for v in o.data.vertices))==expected for o in panes)
checks['92EstimatedHeightsReadBack']=len(errors)==92 and max(errors)<.0003
for name in ['AUDITORIUM_REFINED_ROOT','SOUTH_GATE_REFINED_ROOT','LIBRARY_REFINED_ROOT','FUS_Root','REFINED_SPORTS']:
    checks[name+'_unchangedPresent']=bpy.data.objects.get(name) is not None
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=16
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
scene.world=bpy.data.worlds.new('Storeys_Daylight');scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs[0].default_value=(.70,.83,.95,1);bg.inputs[1].default_value=.7
d=bpy.data.lights.new('Storeys_Sun','SUN');d.energy=3;sun=bpy.data.objects.new(d.name,d);scene.collection.objects.link(sun);sun.rotation_euler=(.5,-.4,-.4)
d=bpy.data.cameras.new('Storeys_Camera');cam=bpy.data.objects.new(d.name,d);scene.collection.objects.link(cam);d.type='ORTHO';d.clip_end=6000;scene.camera=cam
previews=P/'blender/previews/campus_detail_v003';previews.mkdir(parents=True,exist_ok=True)
def render(name,x,n,dx,dn,h,scale):
    cam.location=(x+dx,-h,n+dn);f=(Vector((x,-10,n))-cam.location).normalized();up=Vector((0,-1,0));right=f.cross(up).normalized()
    cam.rotation_euler=Matrix((right,right.cross(f).normalized(),-f)).transposed().to_euler();d.ortho_scale=scale
    scene.render.filepath=str(previews/name);bpy.ops.render.render(write_still=True)
render('dormitory_five_storeys.png',691.4834,690.0651,80,-110,75,175)
render('teaching_four_storeys.png',1404.5482,1605.7140,100,-120,85,220)
render('central_teaching_four_storeys.png',990,1000,180,-240,200,600)
render('whole_campus_oblique.png',990,900,800,-1200,1000,2800)
scene['review_status']='USER_CONFIRMED_TYPICAL_STOREYS_ESTIMATED_METRE_HEIGHTS_NOT_DEPLOYED'
scene['height_policy']='Teaching 4 x 4.2m; dormitory 5 x 3.1m; parapet and plinth separate; not per-building measured'
scene['auditorium_lattice_changed']=False;scene['formal_model_updated']=False
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(blend));bpy.ops.wm.open_mainfile(filepath=str(blend))
checks['workingSceneReopened']=sum(o.type=='EMPTY' and bool(o.get('feature_id')) for o in bpy.data.objects)==124
checks['fourViewsRendered']=len(list(previews.glob('*.png')))==4
checks['actualGLBNotReexported']=hashlib.sha256(glb.read_bytes()).hexdigest().upper()==report['sha256']
result={'status':'PASS' if all(checks.values()) else 'FAIL','passed':sum(checks.values()),'total':len(checks),'checks':checks,
 'maxHeightReadbackErrorMeters':max(errors),'workingFile':str(blend.relative_to(P)),
 'limitation':'User-confirmed type-level floor counts; metre heights and individual facade design remain estimates.'}
(dest/'blender_readback.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({k:result[k] for k in ['status','passed','total','maxHeightReadbackErrorMeters']}));assert all(checks.values())
