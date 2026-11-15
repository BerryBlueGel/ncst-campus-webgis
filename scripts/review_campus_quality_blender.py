"""Read back v002 into a new editable scene, without re-exporting the delivered GLB."""
import bpy,json,math,hashlib
from pathlib import Path
from mathutils import Matrix,Vector
P=Path(__file__).resolve().parents[1]
glb=P/'output/campus_detail_preview_v002.glb';blend=P/'blender/campus_detail_working_v002.blend'
dest=P/'reference/buildings/quality_v002/blender_readback.json'
assert not blend.exists() and not dest.exists(),'Preserve prior artifacts'
report=json.loads((dest.parent/'correction_report.json').read_text(encoding='utf-8'));assert report['status']=='PASS'
bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(glb));bpy.context.view_layer.update()
roots=[o for o in bpy.data.objects if o.type=='EMPTY' and o.get('feature_id')]
lookup={o['feature_id']:o for o in roots}
checks={'124UniqueRoots':len(roots)==len(lookup)==124}
changes=report['changes']
base_errors=[]
for c in changes:
    root=lookup[c['id']]
    bases=[o for o in root.children_recursive if o.type=='MESH' and o.get('mesh_role')=='base']
    bottom=min((o.matrix_world@v.co).y for o in bases for v in o.data.vertices)
    # Blender world up is -Y; the lower foundation altitude is the largest world Y.
    actual=-max((o.matrix_world@v.co).y for o in bases for v in o.data.vertices)
    base_errors.append(abs(actual-c['foundationBottomAfterMeters']))
checks['79CorrectedFoundationsReadBack']=len(base_errors)==79 and max(base_errors)<.0002
for label in ['AUDITORIUM_REFINED_ROOT','SOUTH_GATE_REFINED_ROOT','LIBRARY_REFINED_ROOT','FUS_Root','REFINED_SPORTS']:
    checks[label+'_preserved']=bpy.data.objects.get(label) is not None
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE_NEXT';scene.eevee.taa_render_samples=16
scene.render.resolution_x=1400;scene.render.resolution_y=1000;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.world=bpy.data.worlds.new('Quality_Daylight');scene.world.use_nodes=True
bg=next(n for n in scene.world.node_tree.nodes if n.type=='BACKGROUND');bg.inputs[0].default_value=(.70,.83,.95,1);bg.inputs[1].default_value=.7
data=bpy.data.lights.new('Quality_Sun','SUN');data.energy=3;sun=bpy.data.objects.new(data.name,data);scene.collection.objects.link(sun);sun.rotation_euler=(.5,-.4,-.4)
data=bpy.data.cameras.new('Quality_Camera');cam=bpy.data.objects.new(data.name,data);scene.collection.objects.link(cam);data.type='ORTHO';data.clip_end=6000;scene.camera=cam
previews=P/'blender/previews/campus_detail_v002';previews.mkdir(parents=True,exist_ok=True)
def render(name,x,n,dx,dn,h,scale):
    cam.location=(x+dx,-h,n+dn);f=(Vector((x,-4,n))-cam.location).normalized();up=Vector((0,-1,0))
    right=f.cross(up).normalized();cam.rotation_euler=Matrix((right,right.cross(f).normalized(),-f)).transposed().to_euler()
    data.ortho_scale=scale;scene.render.filepath=str(previews/name);bpy.ops.render.render(write_still=True)
render('lansouth_ground_contact.png',691.4834,690.0651,80,-110,75,180)
render('dmain_ground_contact.png',1404.5482,1605.7140,100,-120,85,220)
render('whole_campus_oblique.png',990,900,800,-1200,1000,2800)
scene['review_status']='INDEPENDENT_GROUND_CORRECTION_NOT_AS_BUILT_NOT_DEPLOYED'
scene['height_policy']='Existing placeholder heights unchanged; window rows are not verified storeys'
scene['auditorium_lattice_changed']=False;scene['formal_model_updated']=False
bpy.context.preferences.filepaths.save_version=0;bpy.ops.wm.save_as_mainfile(filepath=str(blend));bpy.ops.wm.open_mainfile(filepath=str(blend))
checks['workingSceneReopened']=sum(o.type=='EMPTY' and bool(o.get('feature_id')) for o in bpy.data.objects)==124
checks['threePreviewsRendered']=len(list(previews.glob('*.png')))==3
checks['GLBNotReexportedOrModified']=hashlib.sha256(glb.read_bytes()).hexdigest().upper()==report['sha256']
result={'status':'PASS' if all(checks.values()) else 'FAIL','checks':checks,'passed':sum(checks.values()),'total':len(checks),
    'maximumFoundationReadbackErrorMeters':max(base_errors),'workingFile':str(blend.relative_to(P)),
    'limits':['Blender LINE visualization differs from Three.js; original GLB line primitives are preserved.',
        'This readback validates existing-model ground contact, not surveyed terrain or real building heights.']}
dest.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps(result,ensure_ascii=False));assert all(checks.values())
